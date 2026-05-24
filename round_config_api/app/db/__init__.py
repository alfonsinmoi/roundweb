"""Conexión a Postgres y schema."""
import psycopg
from psycopg.rows import dict_row
from contextlib import contextmanager
from .. import config


@contextmanager
def get_conn():
    """Devuelve una conexión con autocommit y cursores en modo dict."""
    conn = psycopg.connect(config.conn_string(), row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


SCHEMA_SQL = """
-- ─── Migrations idempotentes (alter table si las columnas no existen) ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='cuota')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cuota' AND column_name='odoo_id') THEN
    ALTER TABLE cuota ADD COLUMN odoo_id INTEGER;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='descuento')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='descuento' AND column_name='odoo_id') THEN
    ALTER TABLE descuento ADD COLUMN odoo_id INTEGER;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='modificacion')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='modificacion' AND column_name='odoo_id') THEN
    ALTER TABLE modificacion ADD COLUMN odoo_id INTEGER;
  END IF;
  -- modificacion.cliente_idnoofit pasa a ser obligatorio (no nulo)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='modificacion') THEN
    BEGIN
      ALTER TABLE modificacion ALTER COLUMN cliente_idnoofit SET NOT NULL;
    EXCEPTION
      WHEN others THEN NULL;  -- ya es NOT NULL o tiene rows con NULL → ignorar
    END;
  END IF;

  -- slot_reserva: marcador de recordatorio enviado (cron 24h antes)
  -- + motivo de cancelación cuando el lead anula desde la web
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='slot_reserva') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='slot_reserva' AND column_name='recordatorio_at') THEN
      ALTER TABLE slot_reserva ADD COLUMN recordatorio_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='slot_reserva' AND column_name='motivo_cancelacion') THEN
      ALTER TABLE slot_reserva ADD COLUMN motivo_cancelacion VARCHAR(500);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='slot_reserva' AND column_name='cancelado_at') THEN
      ALTER TABLE slot_reserva ADD COLUMN cancelado_at TIMESTAMPTZ;
    END IF;
  END IF;

  -- manager_config: modo_facturacion (cómo se gestionan facturas/recibos)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='manager_config') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='manager_config' AND column_name='modo_facturacion') THEN
      ALTER TABLE manager_config ADD COLUMN modo_facturacion VARCHAR(20) DEFAULT 'recibo_trimestre';
    END IF;

    -- Multi-company Odoo (cada manager S = una res.company en Odoo)
    -- ─────────────────────────────────────────────────────────────────────
    -- odoo_enabled:       el manager tiene contabilidad/CRM/recibos desplegados
    -- odoo_company_id:    id de la res.company en Odoo (NULL = sin desplegar)
    -- odoo_url:           opcional, URL del Odoo del manager. Si NULL usa el
    --                     ODOO_URL global del backend. Permite migrar
    --                     managers grandes a otro VPS en el futuro.
    -- odoo_activated_at:  timestamp del primer despliegue (punto de corte)
    -- wcommerce_cliente_id: id del cliente en wcommerce.wiemspro.com
    -- tipo_pago_wc:       letra del tipoPago en wcommerce (S/B/C/T/…)
    --                     Solo S permite desplegar Odoo desde la UI.
    -- ─────────────────────────────────────────────────────────────────────
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='manager_config' AND column_name='odoo_enabled') THEN
      ALTER TABLE manager_config ADD COLUMN odoo_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='manager_config' AND column_name='odoo_company_id') THEN
      ALTER TABLE manager_config ADD COLUMN odoo_company_id INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='manager_config' AND column_name='odoo_url') THEN
      ALTER TABLE manager_config ADD COLUMN odoo_url VARCHAR(255);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='manager_config' AND column_name='odoo_activated_at') THEN
      ALTER TABLE manager_config ADD COLUMN odoo_activated_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='manager_config' AND column_name='wcommerce_cliente_id') THEN
      ALTER TABLE manager_config ADD COLUMN wcommerce_cliente_id VARCHAR(32);
    END IF;
    -- Si la columna ya existe como INTEGER (de un deploy previo de fase 0),
    -- la migramos a VARCHAR(32). En wcommerce el "id" real es el campo
    -- `codigo`, una cadena tipo '00004645' con ceros a la izquierda.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name='manager_config' AND column_name='wcommerce_cliente_id'
         AND data_type='integer'
    ) THEN
      ALTER TABLE manager_config
        ALTER COLUMN wcommerce_cliente_id TYPE VARCHAR(32)
        USING wcommerce_cliente_id::VARCHAR(32);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='manager_config' AND column_name='tipo_pago_wc') THEN
      ALTER TABLE manager_config ADD COLUMN tipo_pago_wc VARCHAR(20);
    END IF;

    -- Backfill: el manager actual (Round, id=17675) ya tiene Odoo desplegado
    -- en company_id=3 desde hace tiempo. No pasa por el wizard.
    UPDATE manager_config
       SET odoo_enabled = TRUE,
           odoo_company_id = 3,
           odoo_activated_at = COALESCE(odoo_activated_at, created_at)
     WHERE id_manager = '17675'
       AND odoo_company_id IS NULL;

    -- ─── Suscripciones granulares: CRM / Cuotas / Contabilidad ────────
    -- Permiten activar cada módulo Odoo de forma independiente. Un
    -- manager puede tener solo CRM, solo Cuotas, solo Contabilidad o
    -- cualquier combinación. `odoo_enabled` queda como helper computado
    -- (TRUE si cualquiera de los 3 está activo).
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='manager_config'
                      AND column_name='odoo_crm_enabled') THEN
      ALTER TABLE manager_config
        ADD COLUMN odoo_crm_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN odoo_cuotas_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN odoo_contabilidad_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        -- sistemas_cobro: array JSONB de strings con los métodos
        -- habilitados por el manager al activar Cuotas. Valores válidos:
        -- 'sepa', 'tpv_virtual', 'link_pago', 'efectivo', 'transferencia',
        -- 'tokenizacion'. Solo se rellena cuando odoo_cuotas_enabled=TRUE.
        ADD COLUMN sistemas_cobro            JSONB DEFAULT '[]'::jsonb;
    END IF;

    -- Backfill: si Round actual (17675) tiene odoo_enabled=true, marcamos
    -- los 3 sub-flags a true (no hay forma técnica de saber si solo usa
    -- una parte; asumimos completo porque históricamente lo tiene todo).
    UPDATE manager_config
       SET odoo_crm_enabled          = TRUE,
           odoo_cuotas_enabled       = TRUE,
           odoo_contabilidad_enabled = TRUE
     WHERE odoo_enabled = TRUE
       AND odoo_crm_enabled = FALSE
       AND odoo_cuotas_enabled = FALSE
       AND odoo_contabilidad_enabled = FALSE;

    -- ─── Control horario laboral (módulo de fichaje de trabajadores) ──
    -- Activación por manager (sus trainers heredan). El secret se usa
    -- para firmar los JWT del QR rotativo (HS256, exp 10 min). Se
    -- genera al activar el módulo y se rota si hay sospecha de fuga.
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='manager_config'
                      AND column_name='control_horario_enabled') THEN
      ALTER TABLE manager_config
        ADD COLUMN control_horario_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN control_horario_activated_at TIMESTAMPTZ,
        ADD COLUMN control_horario_qr_secret    TEXT;
    END IF;
  END IF;

  -- email_proveedor: añadir id_trainer y eliminar unique antiguo (sólo manager)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='email_proveedor') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='email_proveedor' AND column_name='id_trainer') THEN
      ALTER TABLE email_proveedor ADD COLUMN id_trainer VARCHAR(64);
    END IF;
    -- drop el viejo UNIQUE de id_manager solo si existe (PostgreSQL crea constraint con nombre auto-generado)
    BEGIN
      ALTER TABLE email_proveedor DROP CONSTRAINT IF EXISTS email_proveedor_id_manager_key;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;

  -- centro_contacto: CIF + razón social del centro/empresa del trainer
  -- (para validar que las facturas recibidas coincidan con la empresa).
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='centro_contacto') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='centro_contacto' AND column_name='cif') THEN
      ALTER TABLE centro_contacto ADD COLUMN cif VARCHAR(40);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='centro_contacto' AND column_name='razon_social') THEN
      ALTER TABLE centro_contacto ADD COLUMN razon_social VARCHAR(160);
    END IF;
  END IF;

  -- gasto_documento: subtipo (ticket|factura) + receptor + flags doble auth
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='gasto_documento') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gasto_documento' AND column_name='subtipo') THEN
      ALTER TABLE gasto_documento ADD COLUMN subtipo VARCHAR(20);  -- 'ticket'|'factura'|'otro'
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gasto_documento' AND column_name='recipiente_nombre') THEN
      ALTER TABLE gasto_documento ADD COLUMN recipiente_nombre VARCHAR(160);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gasto_documento' AND column_name='recipiente_vat') THEN
      ALTER TABLE gasto_documento ADD COLUMN recipiente_vat VARCHAR(40);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gasto_documento' AND column_name='requiere_autorizacion') THEN
      ALTER TABLE gasto_documento ADD COLUMN requiere_autorizacion BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gasto_documento' AND column_name='autorizado_doble') THEN
      ALTER TABLE gasto_documento ADD COLUMN autorizado_doble BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gasto_documento' AND column_name='autorizado_doble_by') THEN
      ALTER TABLE gasto_documento ADD COLUMN autorizado_doble_by VARCHAR(80);
    END IF;
  END IF;

  -- Phase D: campos de qualification + scoring + lost_reason en lead_asignacion
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='lead_asignacion') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lead_asignacion' AND column_name='qualification') THEN
      ALTER TABLE lead_asignacion ADD COLUMN qualification JSONB DEFAULT '{}'::jsonb;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lead_asignacion' AND column_name='score') THEN
      ALTER TABLE lead_asignacion ADD COLUMN score INTEGER NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lead_asignacion' AND column_name='last_contact_at') THEN
      ALTER TABLE lead_asignacion ADD COLUMN last_contact_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lead_asignacion' AND column_name='lost_reason') THEN
      ALTER TABLE lead_asignacion ADD COLUMN lost_reason VARCHAR(120);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lead_asignacion' AND column_name='lost_at') THEN
      ALTER TABLE lead_asignacion ADD COLUMN lost_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lead_asignacion' AND column_name='stage_history') THEN
      ALTER TABLE lead_asignacion ADD COLUMN stage_history JSONB DEFAULT '[]'::jsonb;
    END IF;
  END IF;
END $$;

-- ─── CUOTAS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cuota (
  id                       SERIAL PRIMARY KEY,
  scope                    VARCHAR(20) NOT NULL CHECK (scope IN ('plantilla_manager','trainer')),
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64),
  plantilla_origen_id      INTEGER REFERENCES cuota(id) ON DELETE SET NULL,
  codigo                   VARCHAR(64) NOT NULL,
  descripcion              TEXT,
  precio_mensual           NUMERIC(10,2) DEFAULT 0,
  precio_bimensual         NUMERIC(10,2) DEFAULT 0,
  precio_trimestral        NUMERIC(10,2) DEFAULT 0,
  precio_semestral         NUMERIC(10,2) DEFAULT 0,
  precio_anual             NUMERIC(10,2) DEFAULT 0,
  matricula                NUMERIC(10,2) DEFAULT 0,
  formas_pago              TEXT[] DEFAULT ARRAY[]::TEXT[],
  periodicidades           TEXT[] DEFAULT ARRAY[]::TEXT[],
  actividades_idnoofit     INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  odoo_id                  INTEGER,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cuota_scope_trainer CHECK (
    (scope = 'plantilla_manager' AND id_trainer IS NULL) OR
    (scope = 'trainer'           AND id_trainer IS NOT NULL)
  ),
  CONSTRAINT cuota_codigo_unique UNIQUE (id_manager, id_trainer, codigo)
);
CREATE INDEX IF NOT EXISTS idx_cuota_manager  ON cuota(id_manager);
CREATE INDEX IF NOT EXISTS idx_cuota_trainer  ON cuota(id_trainer);


-- ─── DESCUENTOS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS descuento (
  id                       SERIAL PRIMARY KEY,
  scope                    VARCHAR(20) NOT NULL CHECK (scope IN ('plantilla_manager','trainer')),
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64),
  plantilla_origen_id      INTEGER REFERENCES descuento(id) ON DELETE SET NULL,
  codigo                   VARCHAR(64) NOT NULL,
  descripcion              TEXT,
  tipo                     VARCHAR(20) NOT NULL CHECK (tipo IN ('porcentaje','importe')),
  valor                    NUMERIC(10,2) NOT NULL,
  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  odoo_id                  INTEGER,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT desc_scope_trainer CHECK (
    (scope = 'plantilla_manager' AND id_trainer IS NULL) OR
    (scope = 'trainer'           AND id_trainer IS NOT NULL)
  ),
  CONSTRAINT desc_codigo_unique UNIQUE (id_manager, id_trainer, codigo)
);
CREATE INDEX IF NOT EXISTS idx_desc_manager  ON descuento(id_manager);
CREATE INDEX IF NOT EXISTS idx_desc_trainer  ON descuento(id_trainer);

-- Columnas añadidas posteriormente (mayo 2026):
-- Tipo "varias_cuotas": cuando un cliente tiene la cuota_requerida activa Y
-- se da de alta con alguna de las cuotas secundarias, esa cuota se cobra al
-- precio especificado en `combo_secundarias` en lugar del precio de tarifa.
--
-- Tipo "familiares" (nov 2026): se aplica AUTOMÁTICAMENTE a la `cuota_aplicada_codigo`
-- cuando el cliente pertenece a un grupo familiar con ≥2 miembros activos.
-- Si `unidad='porcentaje'`: precio = precio * (1 - valor/100)
-- Si `unidad='importe'`:    precio = precio - valor (mín 0)
ALTER TABLE descuento
  ADD COLUMN IF NOT EXISTS cuota_requerida_codigo VARCHAR(64),
  ADD COLUMN IF NOT EXISTS cuota_aplicada_codigo  VARCHAR(64),  -- legacy precio_combo + familiares
  ADD COLUMN IF NOT EXISTS precio_final           NUMERIC(10,2),  -- legacy precio_combo
  ADD COLUMN IF NOT EXISTS combo_secundarias      JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS unidad                 VARCHAR(20);  -- 'porcentaje'|'importe' (familiares)
-- Ampliar tipos permitidos: precio_combo (legacy) + varias_cuotas + familiares
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'descuento_tipo_check'
  ) THEN
    ALTER TABLE descuento DROP CONSTRAINT descuento_tipo_check;
  END IF;
  ALTER TABLE descuento ADD CONSTRAINT descuento_tipo_check
    CHECK (tipo IN ('porcentaje','importe','precio_combo','varias_cuotas','familiares'));
EXCEPTION WHEN OTHERS THEN NULL;
END$$;


-- ─── FAMILIAS (grupos familiares para descuentos automáticos) ───────────────
-- Cada familia agrupa N clientes (≥2 = condición para descuento "familiares").
-- Un cliente pertenece a 0 o 1 familia (UNIQUE en miembros).
CREATE TABLE IF NOT EXISTS familia (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  nombre                   VARCHAR(120),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_familia_manager ON familia(id_manager);

CREATE TABLE IF NOT EXISTS familia_miembro (
  id                       SERIAL PRIMARY KEY,
  familia_id               INTEGER NOT NULL REFERENCES familia(id) ON DELETE CASCADE,
  id_manager               VARCHAR(64) NOT NULL,
  cliente_idnoofit         VARCHAR(64) NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT familia_miembro_unique UNIQUE (id_manager, cliente_idnoofit)
);
CREATE INDEX IF NOT EXISTS idx_familia_miembro_familia ON familia_miembro(familia_id);
CREATE INDEX IF NOT EXISTS idx_familia_miembro_cliente ON familia_miembro(cliente_idnoofit);


-- ─── MODIFICACIONES ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS modificacion (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64) NOT NULL,
  cliente_idnoofit         VARCHAR(64),
  cuota_id                 INTEGER REFERENCES cuota(id) ON DELETE SET NULL,
  tipo                     VARCHAR(30) NOT NULL CHECK (tipo IN ('descuento','cargo_extra','precio_alternativo')),
  valor                    NUMERIC(10,2) NOT NULL,
  fecha_desde              DATE NOT NULL,
  fecha_hasta              DATE,
  razon                    TEXT,
  estado                   VARCHAR(20) NOT NULL DEFAULT 'activa'
                                       CHECK (estado IN ('activa','aplicada','cancelada')),
  odoo_id                  INTEGER,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mod_trainer ON modificacion(id_trainer);
CREATE INDEX IF NOT EXISTS idx_mod_fechas  ON modificacion(fecha_desde, fecha_hasta);


-- ─── ASIGNACIÓN DE DESCUENTOS A CLIENTES ────────────────────────────────────
CREATE TABLE IF NOT EXISTS descuento_asignacion (
  id                       SERIAL PRIMARY KEY,
  descuento_id             INTEGER NOT NULL REFERENCES descuento(id) ON DELETE CASCADE,
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64) NOT NULL,
  cliente_idnoofit         VARCHAR(64) NOT NULL,
  fecha_desde              DATE,
  fecha_hasta              DATE,
  estado                   VARCHAR(20) NOT NULL DEFAULT 'activa'
                                       CHECK (estado IN ('activa','pausada','cancelada')),
  odoo_id                  INTEGER,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT desc_asig_unique UNIQUE (descuento_id, cliente_idnoofit)
);
CREATE INDEX IF NOT EXISTS idx_desc_asig_cliente  ON descuento_asignacion(cliente_idnoofit);
CREATE INDEX IF NOT EXISTS idx_desc_asig_descuento ON descuento_asignacion(descuento_id);
CREATE INDEX IF NOT EXISTS idx_desc_asig_trainer  ON descuento_asignacion(id_trainer);


-- ─── PLANTILLAS DE EMAIL DEL FUNNEL CRM ────────────────────────────────────
-- Cada plantilla se dispara por un evento (lead_creado, etapa_visita, etc).
-- Variables disponibles en subject/body: {{lead_name}}, {{trainer_name}},
-- {{centro_name}}, {{centro_email}}, {{lead_email}}, {{lead_phone}},
-- {{lead_message}}, {{lead_url}}, {{cuota_interes}}, {{trainer_phone}}.
CREATE TABLE IF NOT EXISTS email_template (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  evento                   VARCHAR(40) NOT NULL,    -- ej. 'lead_creado_lead', 'etapa_visita_lead'
  destinatario             VARCHAR(20) NOT NULL,    -- 'lead' / 'trainer' / 'manager'
  subject                  TEXT NOT NULL,
  body_html                TEXT NOT NULL,
  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  delay_minutes            INTEGER NOT NULL DEFAULT 0,  -- futuro: enviar diferido
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_tpl_unique UNIQUE (id_manager, evento, destinatario)
);
CREATE INDEX IF NOT EXISTS idx_email_tpl_manager ON email_template(id_manager);


-- ─── PROVEEDOR DE EMAIL TRANSACCIONAL (Resend / Postmark / SMTP / Gmail) ──
-- id_trainer NULL = config global del manager (fallback).
-- id_trainer NOT NULL = override por centro (ej. cada centro con su Gmail).
CREATE TABLE IF NOT EXISTS email_proveedor (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64),
  proveedor                VARCHAR(20) NOT NULL DEFAULT 'resend',  -- resend / postmark / smtp / gmail
  api_key                  TEXT,
  smtp_host                VARCHAR(160),
  smtp_port                INTEGER,
  smtp_user                VARCHAR(160),
  smtp_pass                TEXT,
  smtp_tls                 BOOLEAN DEFAULT TRUE,
  from_name                VARCHAR(120),
  from_email               VARCHAR(160) NOT NULL,
  reply_to                 VARCHAR(160),
  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  notas                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Unique parcial: una fila por (manager, trainer); manager-only es id_trainer IS NULL
CREATE UNIQUE INDEX IF NOT EXISTS email_prov_mgr_trn_unique
  ON email_proveedor (id_manager, id_trainer)
  WHERE id_trainer IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS email_prov_mgr_only_unique
  ON email_proveedor (id_manager)
  WHERE id_trainer IS NULL;


-- ─── CENTROS / CONTACTOS DE TRAINER (para CRM, leads, notificaciones) ─────
CREATE TABLE IF NOT EXISTS centro_contacto (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64) NOT NULL,
  nombre_centro            VARCHAR(120) NOT NULL,
  slug                     VARCHAR(64),                 -- para URLs ?centro=malagacentro
  email                    VARCHAR(160) NOT NULL,
  email_cc                 VARCHAR(500),                -- separados por coma
  telefono                 VARCHAR(50),
  ciudad                   VARCHAR(120),
  direccion                TEXT,
  activo                   BOOLEAN NOT NULL DEFAULT TRUE,
  recibe_round_robin       BOOLEAN NOT NULL DEFAULT TRUE,
  notas                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT centro_unique UNIQUE (id_manager, id_trainer)
);
CREATE INDEX IF NOT EXISTS idx_centro_manager ON centro_contacto(id_manager);
CREATE INDEX IF NOT EXISTS idx_centro_slug ON centro_contacto(id_manager, slug);

-- Columnas añadidas posteriormente (mayo 2026):
--   - dias_permitidos:        array JSON de int 0-6 (lun=0 ... dom=6) que el
--                              endpoint /api/crm/slots-disponibles permitirá
--                              mostrar al público. Vacío = sin restricción.
--   - actividades_permitidas: array JSON de id_actividad NoofitPro a mostrar.
--                              Vacío = todas las actividades.
ALTER TABLE centro_contacto
  ADD COLUMN IF NOT EXISTS dias_permitidos        JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS actividades_permitidas JSONB DEFAULT '[]'::jsonb;


-- ─── ASIGNACIÓN LEADS (para tracking trainer ↔ odoo lead) ───────────────────
CREATE TABLE IF NOT EXISTS lead_asignacion (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64) NOT NULL,
  odoo_lead_id             INTEGER NOT NULL,            -- crm.lead.id en Odoo
  origen                   VARCHAR(40),                 -- 'web_form' / 'meta_lead_ad' / 'manual'
  utm_source               VARCHAR(120),
  utm_medium               VARCHAR(120),
  utm_campaign             VARCHAR(120),
  raw_payload              JSONB,                       -- dump del form para auditoría
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_odoo_unique UNIQUE (odoo_lead_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_manager ON lead_asignacion(id_manager);
CREATE INDEX IF NOT EXISTS idx_lead_trainer ON lead_asignacion(id_trainer);


-- ─── PASARELAS DE PAGO POR TRAINER (PayComet, Redsys, Stripe...) ───────────
CREATE TABLE IF NOT EXISTS pasarela_credenciales (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64) NOT NULL,
  proveedor                VARCHAR(20) NOT NULL DEFAULT 'paycomet',
  api_token                TEXT NOT NULL,
  terminal                 VARCHAR(50) NOT NULL,
  url_ok                   TEXT,
  url_ko                   TEXT,
  url_notif                TEXT,
  sandbox                  BOOLEAN NOT NULL DEFAULT FALSE,
  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  notas                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pasarela_unique UNIQUE (id_manager, id_trainer, proveedor)
);
CREATE INDEX IF NOT EXISTS idx_pasarela_manager ON pasarela_credenciales(id_manager);
CREATE INDEX IF NOT EXISTS idx_pasarela_trainer ON pasarela_credenciales(id_trainer);


-- ─── RESERVA DE SLOT (prueba gratuita lead → clase NoofitPro) ──────────────
CREATE TABLE IF NOT EXISTS slot_reserva (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64) NOT NULL,
  odoo_lead_id             INTEGER,
  noofit_cliente_id        INTEGER,                   -- idClient en NoofitPro
  noofit_sala_id           INTEGER NOT NULL,          -- idSala (clase reservada)
  fecha_clase              TIMESTAMPTZ NOT NULL,      -- dateStart parseado
  nombre_clase             VARCHAR(160),
  estado                   VARCHAR(20) NOT NULL DEFAULT 'pendiente',
                                          -- pendiente · confirmada · expirada · cancelada · asistio
  token                    VARCHAR(64) NOT NULL UNIQUE,
  dni                      VARCHAR(20),
  nombre_lead              VARCHAR(120),
  apellidos_lead           VARCHAR(120),
  email_lead               VARCHAR(160),
  telefono_lead            VARCHAR(40),
  expira_at                TIMESTAMPTZ NOT NULL,      -- now() + 1 hora
  confirmado_at            TIMESTAMPTZ,
  cambiado_de_sala_id      INTEGER,                   -- si cambió: sala anterior
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_slot_token       ON slot_reserva(token);
CREATE INDEX IF NOT EXISTS idx_slot_estado_exp  ON slot_reserva(estado, expira_at);
CREATE INDEX IF NOT EXISTS idx_slot_lead        ON slot_reserva(odoo_lead_id);
CREATE INDEX IF NOT EXISTS idx_slot_dni_email   ON slot_reserva(dni, email_lead);


-- ─── REDES SOCIALES: cuentas Meta (Instagram + Facebook) por trainer ───────
-- Una cuenta por (manager, trainer, red). Si id_trainer NULL = config manager.
-- access_token = Page Access Token de larga duración (60 días, renovable).
CREATE TABLE IF NOT EXISTS social_cuenta (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64),
  red                      VARCHAR(20) NOT NULL,         -- 'instagram' / 'facebook' / 'meta'
  nombre                   VARCHAR(120),                  -- alias amigable
  fb_page_id               VARCHAR(64),
  fb_page_name             VARCHAR(160),
  ig_business_account_id   VARCHAR(64),                  -- IG Business Account ID
  ig_username              VARCHAR(60),
  access_token             TEXT,
  token_type               VARCHAR(20) DEFAULT 'page',    -- 'page' / 'user'
  expires_at               TIMESTAMPTZ,
  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  notas                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS social_cuenta_mgr_trn_unique
  ON social_cuenta (id_manager, id_trainer, red)
  WHERE id_trainer IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS social_cuenta_mgr_only_unique
  ON social_cuenta (id_manager, red)
  WHERE id_trainer IS NULL;


-- ─── REDES SOCIALES: agenda de publicaciones programadas ───────────────────
CREATE TABLE IF NOT EXISTS social_post (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64),
  social_cuenta_id         INTEGER NOT NULL REFERENCES social_cuenta(id) ON DELETE CASCADE,
  red                      VARCHAR(20) NOT NULL,
  tipo                     VARCHAR(20) NOT NULL,          -- image / carousel / reel / story / fb_post
  media_urls               JSONB DEFAULT '[]'::jsonb,     -- URLs públicas accesibles por Meta
  caption                  TEXT,
  hashtags                 TEXT,
  schedule_at              TIMESTAMPTZ NOT NULL,
  estado                   VARCHAR(20) NOT NULL DEFAULT 'pendiente',
                                          -- pendiente / publicando / publicado / fallido / cancelado
  publicado_at             TIMESTAMPTZ,
  meta_post_id             VARCHAR(120),                  -- ig_media_id o fb_post_id tras publicar
  meta_permalink           TEXT,                          -- URL pública del post publicado
  error_msg                TEXT,
  attempts                 INTEGER NOT NULL DEFAULT 0,
  created_by               VARCHAR(120),                  -- email del usuario que lo programó
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_social_post_estado_at
  ON social_post(estado, schedule_at);
CREATE INDEX IF NOT EXISTS idx_social_post_manager
  ON social_post(id_manager, schedule_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_post_cuenta
  ON social_post(social_cuenta_id, schedule_at DESC);


-- ─── LOG DE CAMBIOS DE ESTADO DE CLIENTE (activo ↔ archivado) ──────────────
-- Cron diario detecta cambios respecto a la última observación. Útil para:
--   · Saber la "fecha de baja" exacta de un cliente archivado
--   · Saber cuándo se reactivó (recaptación)
--   · Analítica de rotación / churn rate
CREATE TABLE IF NOT EXISTS cliente_estado_log (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  cliente_id               INTEGER NOT NULL,           -- id NoofitPro
  cliente_nombre           VARCHAR(240),               -- snapshot al detectar
  cliente_email            VARCHAR(160),
  cliente_dni              VARCHAR(40),
  estado_nuevo             VARCHAR(20) NOT NULL,       -- 'activo' / 'archivado'
  estado_anterior          VARCHAR(20),                -- NULL si es primera observación
  motivo_archivado         VARCHAR(240),
  id_trainer               VARCHAR(64),                -- snapshot
  detected_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notas                    TEXT
);
CREATE INDEX IF NOT EXISTS idx_cli_log_cliente ON cliente_estado_log(cliente_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_cli_log_manager ON cliente_estado_log(id_manager, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_cli_log_estado  ON cliente_estado_log(estado_nuevo);


-- ─── CLIENTE GYMPASS (extensión local — NoofitPro no persiste gympassId) ────
CREATE TABLE IF NOT EXISTS cliente_gympass (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64),
  cliente_idnoofit         VARCHAR(64) NOT NULL,
  gympass_id               TEXT NOT NULL,
  notas                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cligym_unique UNIQUE (id_manager, cliente_idnoofit)
);
CREATE INDEX IF NOT EXISTS idx_cligym_cliente ON cliente_gympass(cliente_idnoofit);
CREATE INDEX IF NOT EXISTS idx_cligym_manager ON cliente_gympass(id_manager);


-- ─── CANALES DE CAPTACIÓN (mapping UTM → canal con nombre amigable) ────────
-- Cada manager define sus canales (Instagram orgánico, Google Ads, Recom., …)
-- y los patrones `utm_source` que entran por la web del lead. Al crear un
-- lead el backend busca match (case-insensitive) en `utm_source_match` y
-- guarda el canal_id en lead_asignacion.canal_id. Permite analítica de
-- eficacia por canal.
CREATE TABLE IF NOT EXISTS canal_captacion (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  nombre                   VARCHAR(80) NOT NULL,        -- 'Instagram', 'Google Ads'…
  color                    VARCHAR(20),                  -- badge color
  utm_source_match         TEXT[] DEFAULT ARRAY[]::TEXT[], -- ['instagram','ig','meta_ad']
  notas                    TEXT,
  activa                   BOOLEAN NOT NULL DEFAULT TRUE,
  orden                    INTEGER DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canal_captacion_unique UNIQUE (id_manager, nombre)
);
CREATE INDEX IF NOT EXISTS idx_canal_capt_manager ON canal_captacion(id_manager);

-- Añadir canal_id a lead_asignacion (referencia opcional al canal detectado).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='lead_asignacion')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name='lead_asignacion' AND column_name='canal_id') THEN
    ALTER TABLE lead_asignacion ADD COLUMN canal_id INTEGER REFERENCES canal_captacion(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_lead_asig_canal ON lead_asignacion(canal_id);
  END IF;
END $$;


-- ─── CATEGORÍAS DE CLIENTE (manager-level catalog) ──────────────────────────
-- Reemplaza progresivamente al campo Gympass hardcoded. Cada cliente puede
-- tener una sola categoría (Gympass, Trabajador, Invitado, …). Sin asignación
-- = "Pagador con cuota" implícito. Se sincronizará con NoofitPro cuando el
-- servicio remoto esté disponible (campo noofit_alias para mapping).
CREATE TABLE IF NOT EXISTS categoria (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  nombre                   VARCHAR(80) NOT NULL,
  color                    VARCHAR(20),                 -- hex o nombre badge (purple/cyan/amber/…)
  puede_reservar           BOOLEAN NOT NULL DEFAULT TRUE,
  tiene_cuota              BOOLEAN NOT NULL DEFAULT FALSE,
  activa                   BOOLEAN NOT NULL DEFAULT TRUE,
  noofit_alias             VARCHAR(80),                 -- para mapping futuro con NoofitPro
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT categoria_unique UNIQUE (id_manager, nombre)
);
CREATE INDEX IF NOT EXISTS idx_categoria_manager ON categoria(id_manager);


-- ─── CLIENTE ↔ CATEGORÍA (asignación 1:1) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS cliente_categoria (
  id_manager               VARCHAR(64) NOT NULL,
  cliente_idnoofit         VARCHAR(64) NOT NULL,
  categoria_id             INTEGER NOT NULL REFERENCES categoria(id) ON DELETE CASCADE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_manager, cliente_idnoofit)
);
CREATE INDEX IF NOT EXISTS idx_clicat_categoria ON cliente_categoria(categoria_id);
CREATE INDEX IF NOT EXISTS idx_clicat_manager   ON cliente_categoria(id_manager);


-- ─── TEST DE ESTADO FÍSICO — cache local de NoofitPro ────────────────────
-- NoofitPro solo permite consultar por idUser y tarda ~50ms por cliente,
-- así que recorrer 300 clientes son 15s. Esta tabla cachea los resultados
-- y solo refresca en background cuando son antiguos.
-- `id` es el UUID que devuelve NoofitPro, así el UPSERT es idempotente.
CREATE TABLE IF NOT EXISTS test_estado_fisico (
  id                  UUID PRIMARY KEY,
  id_manager          VARCHAR(64) NOT NULL,
  id_trainer          VARCHAR(64),
  user_id             INTEGER NOT NULL,
  cliente_nombre      VARCHAR(240),
  cliente_email       VARCHAR(160),
  test_date           TIMESTAMPTZ,
  edad                INTEGER,
  peso_kg             NUMERIC(5,2),
  sexo                VARCHAR(2),
  categoria           VARCHAR(40),
  has_squat_jump      BOOLEAN NOT NULL DEFAULT FALSE,
  has_box_squat       BOOLEAN NOT NULL DEFAULT FALSE,
  has_flamenco        BOOLEAN NOT NULL DEFAULT FALSE,
  has_plancha         BOOLEAN NOT NULL DEFAULT FALSE,
  has_push_up         BOOLEAN NOT NULL DEFAULT FALSE,
  observations        TEXT,
  is_completed        BOOLEAN NOT NULL DEFAULT FALSE,
  puntuacion          NUMERIC(4,2),
  last_modified_date  TIMESTAMPTZ,
  raw_data            JSONB,
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_test_ef_manager
  ON test_estado_fisico(id_manager, test_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_test_ef_user
  ON test_estado_fisico(id_manager, user_id, test_date DESC NULLS LAST);

-- Estado de sincronización por cliente (cuándo se pidió por última vez a NF)
CREATE TABLE IF NOT EXISTS test_estado_fisico_sync_cliente (
  id_manager     VARCHAR(64) NOT NULL,
  id_trainer     VARCHAR(64),
  user_id        INTEGER NOT NULL,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  n_tests        INTEGER NOT NULL DEFAULT 0,
  ultima_falla   TEXT,
  PRIMARY KEY (id_manager, user_id)
);
CREATE INDEX IF NOT EXISTS idx_test_ef_sync_synced
  ON test_estado_fisico_sync_cliente(id_manager, synced_at);


-- ─── CLIENTE CACHE — réplica local de getClienteSimple de NoofitPro ─────
-- La lista de clientes de NoofitPro tarda 2-3 s en la 1ª llamada del día
-- (login + getClienteSimple). Esta tabla cachea la lista por manager para
-- que las lecturas sean instantáneas (~50 ms). El sync se ejecuta:
--   • En background al abrir la lista (anti-stampede de 60 s)
--   • Vía cron horario (round_clientes_sync.timer)
-- Guardamos el objeto entero como JSONB para no perder ningún campo;
-- solo las columnas usadas para filtrar/ordenar van como columnas reales.
CREATE TABLE IF NOT EXISTS cliente_cache (
  id              INTEGER NOT NULL,
  id_manager      VARCHAR(64) NOT NULL,
  id_trainer      INTEGER,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  name            VARCHAR(160),
  surname         VARCHAR(240),
  email           VARCHAR(160),
  dt_edition_date BIGINT,
  raw_data        JSONB NOT NULL,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_manager, id)
);
CREATE INDEX IF NOT EXISTS idx_cliente_cache_trainer
  ON cliente_cache(id_manager, id_trainer);
CREATE INDEX IF NOT EXISTS idx_cliente_cache_enabled
  ON cliente_cache(id_manager, enabled);

-- Estado de sync por manager (1 fila por manager activo).
CREATE TABLE IF NOT EXISTS cliente_cache_sync (
  id_manager   VARCHAR(64) NOT NULL,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  n_clientes   INTEGER NOT NULL DEFAULT 0,
  ultima_falla TEXT,
  PRIMARY KEY (id_manager)
);


-- ─── Fase 4: multi-trainer con analytic accounts ────────────────────────
-- En Odoo cada `res.company` tendrá un `account.analytic.plan` propio
-- (p. ej. "Trainers Round Málaga") y dentro un `account.analytic.account`
-- por trainer. Así, cada factura / payment lleva su analytic_distribution
-- y los informes contables se pueden filtrar por trainer.
--
-- Política por defecto: cuando un trainer se da de alta o existe ya, su
-- contabilidad HEREDA del manager (todos van al analytic "GENERAL").
-- Si el manager decide independizar a un trainer, se le crea analytic
-- propio y `heredar_contabilidad=FALSE`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_name='manager_config') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='manager_config'
                      AND column_name='odoo_analytic_plan_id') THEN
      ALTER TABLE manager_config
        ADD COLUMN odoo_analytic_plan_id    INTEGER,
        ADD COLUMN odoo_analytic_default_id INTEGER;
    END IF;
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS trainer_odoo_config (
  id_manager           VARCHAR(64) NOT NULL,
  id_trainer           VARCHAR(64) NOT NULL,
  heredar_contabilidad BOOLEAN     NOT NULL DEFAULT TRUE,
  -- Si heredar=true → analytic_account_id es NULL y los movimientos van
  -- al `manager_config.odoo_analytic_default_id`. Si heredar=false →
  -- apunta al analytic propio del trainer.
  analytic_account_id  INTEGER,
  notas                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_manager, id_trainer)
);
CREATE INDEX IF NOT EXISTS idx_trainer_odoo_manager
  ON trainer_odoo_config(id_manager);


-- ─── Fase 3: tracking del sync inicial de partners ──────────────────────
-- Tras un provisioning OK, replicamos los clientes de NoofitPro
-- (cliente_cache) a res.partner de la nueva company. Estas columnas
-- se rellenan en background y se actualizan a medida que progresa.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_name='odoo_solicitud_despliegue') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='odoo_solicitud_despliegue'
                      AND column_name='partners_sync_started_at') THEN
      ALTER TABLE odoo_solicitud_despliegue
        ADD COLUMN partners_sync_started_at  TIMESTAMPTZ,
        ADD COLUMN partners_sync_finished_at TIMESTAMPTZ,
        ADD COLUMN partners_total            INTEGER,
        ADD COLUMN partners_synced           INTEGER,
        ADD COLUMN partners_errors           JSONB DEFAULT '[]'::jsonb;
    END IF;
  END IF;
END$$;


-- ─── SOLICITUD DE DESPLIEGUE ODOO (Fase 2 — opción híbrida) ───────────────
-- Cuando un manager con tipoPago='S' pulsa "Aceptar y continuar" en el
-- wizard de despliegue, sus datos fiscales/contables se guardan aquí.
-- Un admin de Wiemspro:
--   1) Ve la solicitud (estado='pendiente')
--   2) Crea manualmente la `res.company` en Odoo UI con esos datos
--   3) Vuelve a Round, introduce el `odoo_company_id` recién creado
--   4) Round automatiza el resto: journals, bank, secuencia, permisos
-- Estados: 'pendiente' → 'en_proceso' → 'completada' / 'rechazada'
CREATE TABLE IF NOT EXISTS odoo_solicitud_despliegue (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  estado                   VARCHAR(20) NOT NULL DEFAULT 'pendiente',
  -- Datos del wizard (los del manager) ──────────────────────────────────
  razon_social             VARCHAR(240) NOT NULL,
  cif                      VARCHAR(40)  NOT NULL,
  direccion                VARCHAR(240),
  poblacion                VARCHAR(120),
  cp                       VARCHAR(20),
  provincia                VARCHAR(120),
  pais                     VARCHAR(80) DEFAULT 'España',
  telefono                 VARCHAR(40),
  email_facturacion        VARCHAR(160),
  -- Plan contable + numeración ──────────────────────────────────────────
  plan_contable            VARCHAR(40) DEFAULT 'es_pymes',  -- es_pymes / es_full / es_assoc
  factura_secuencia_prefijo VARCHAR(20),                    -- p.ej. "F-2026-"
  factura_ultimo_numero    INTEGER DEFAULT 0,               -- p.ej. 247 → siguiente F-2026-248
  -- Cuentas bancarias y journals ────────────────────────────────────────
  iban_principal           VARCHAR(40),
  banco_nombre             VARCHAR(120),
  journals_extra           JSONB DEFAULT '[]'::jsonb,   -- [{nombre, tipo, ...}, ...]
  -- Notas y resultado del provisioner ────────────────────────────────────
  notas_manager            TEXT,
  -- Tras procesar
  odoo_company_id          INTEGER,                     -- el admin lo introduce
  procesado_at             TIMESTAMPTZ,
  procesado_por            VARCHAR(120),                -- email admin Wiemspro
  resultado                JSONB,                       -- log del provisioner
  motivo_rechazo           TEXT,
  -- Auditoría
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_solicitud_manager   ON odoo_solicitud_despliegue(id_manager);
CREATE INDEX IF NOT EXISTS idx_solicitud_estado    ON odoo_solicitud_despliegue(estado, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_solicitud_activa
  ON odoo_solicitud_despliegue(id_manager)
  WHERE estado IN ('pendiente','en_proceso');


-- ─── RETO SNAPSHOT — histórico diario del estado de cada reto ─────────────
-- El cron `round_retos_snapshot.timer` invoca POST /api/retos/snapshot una
-- vez al día. Se almacena (id_manager, reto_id, fecha) como clave única,
-- así si se ejecuta varias veces el mismo día solo se actualiza la fila.
CREATE TABLE IF NOT EXISTS reto_snapshot (
  id                   SERIAL PRIMARY KEY,
  id_manager           VARCHAR(64) NOT NULL,
  id_trainer           VARCHAR(64),
  reto_id              INTEGER NOT NULL,
  fecha                DATE NOT NULL,
  nombre               VARCHAR(240),
  descripcion          TEXT,
  tipo_reto            INTEGER,
  tipo_metrica         INTEGER,
  estado               VARCHAR(40),
  fecha_inicio         DATE,
  fecha_fin            DATE,
  n_participantes      INTEGER NOT NULL DEFAULT 0,
  n_equipos            INTEGER NOT NULL DEFAULT 0,
  datos_raw            JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reto_snapshot_unique UNIQUE (id_manager, reto_id, fecha)
);
CREATE INDEX IF NOT EXISTS idx_reto_snap_mgr_fecha
  ON reto_snapshot(id_manager, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_reto_snap_reto
  ON reto_snapshot(reto_id, fecha DESC);


-- ─── BANNER "Nuevos clientes esperando cobro": dismiss persistente ─────────
-- Cuando el trainer pulsa "✕" en el banner para descartar un cliente sin
-- procesarlo, guardamos aquí el descarte para que se persista entre navega-
-- dores y dispositivos (antes era localStorage por navegador). Asignar
-- categoría sigue siendo la señal canónica de "atendido"; esta tabla solo
-- guarda dismisses manuales sin categoría.
CREATE TABLE IF NOT EXISTS cliente_atendido_banner (
  id_manager               VARCHAR(64) NOT NULL,
  cliente_idnoofit         VARCHAR(64) NOT NULL,
  atendido_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atendido_por             VARCHAR(120),
  PRIMARY KEY (id_manager, cliente_idnoofit)
);
CREATE INDEX IF NOT EXISTS idx_cli_atendido_manager ON cliente_atendido_banner(id_manager);


-- ─── MANAGER CONFIG (multi-tenant — N managers, cada uno con sus creds NoofitPro) ──
-- Cada Round que se conecta tiene su propia cuenta NoofitPro. Los crons
-- iteran sobre las filas activas de esta tabla para procesar a todos los
-- managers en lugar de leer un único id por env (ROUND_DEFAULT_MANAGER).
-- Compat: si la tabla está vacía, se usa el env como fallback.
CREATE TABLE IF NOT EXISTS manager_config (
  id_manager               VARCHAR(64) PRIMARY KEY,
  nombre                   VARCHAR(120),
  noofit_email             VARCHAR(160),
  noofit_password          TEXT,                          -- TODO: cifrar at-rest con master key
  activo                   BOOLEAN NOT NULL DEFAULT TRUE,
  notas                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_manager_config_activo ON manager_config(activo);


-- ─── NOTIFICACIONES (push via OneSignal a la app mynoofit) ─────────────────
-- Estructura:
--  notif_envio        — 1 fila por envío conceptual (1 manda → N reciben).
--                       Guarda título, cuerpo, sección, tipo, estado, audiencia,
--                       y un onesignal_id si OneSignal aceptó el push masivo.
--  notif_destinatario — 1 fila por cliente que recibió. Aquí va el tracking
--                       individual (leida, fecha_lectura). La app llama a
--                       PUT /notif/<id>/leida para marcarlo.
--  notif_config       — config per (manager,trainer) de cuándo dispararse las
--                       notificaciones automáticas (día del mes, on/off por
--                       tipo, plantillas custom).
--
-- Catálogo de SECCIONES y TIPOS NO se guarda en BD: es un enum hardcoded en
-- app.notif_catalog (Python) + espejo en frontend. Si se añade un tipo, va
-- al deploy del código, no a la BD.
CREATE TABLE IF NOT EXISTS notif_envio (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64),                       -- NULL = a nivel manager (broadcast manager-wide)
  seccion                  VARCHAR(20) NOT NULL,              -- 'cobros'|'clases'|'centro'|'noticias'
  tipo                     VARCHAR(40) NOT NULL,              -- ver notif_catalog.TIPOS
  scope                    VARCHAR(20) NOT NULL,              -- 'cliente'|'lista'|'cluster'|'broadcast'
  scope_ref                JSONB,                              -- cluster_id, lista de ids, filtros, NULL para broadcast
  titulo                   VARCHAR(160) NOT NULL,
  cuerpo                   TEXT,
  cuerpo_html              TEXT,                               -- para noticias (webview)
  url                      TEXT,                               -- deep link opcional
  programada_at            TIMESTAMPTZ,                        -- futuro envío programado (si está, el cron lo dispara)
  fecha_envio              TIMESTAMPTZ,                        -- cuando se envió a OneSignal
  fecha_desaparicion       TIMESTAMPTZ,                        -- la app oculta la notif tras esto
  estado                   VARCHAR(20) NOT NULL DEFAULT 'pendiente',  -- 'pendiente'|'enviada'|'fallida'|'cancelada'
  onesignal_id             VARCHAR(80),                        -- id devuelto por OneSignal /notifications
  error                    TEXT,                               -- si falló envío
  origen                   VARCHAR(40) NOT NULL DEFAULT 'manual',
  origen_ref               VARCHAR(120),                       -- ej "recibo:1234" o "pago:789"
  total_destinatarios      INTEGER NOT NULL DEFAULT 0,
  created_by               VARCHAR(80),                        -- email del manager/trainer que creó
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notif_envio_seccion_chk CHECK (seccion IN ('cobros','clases','centro','noticias')),
  CONSTRAINT notif_envio_estado_chk  CHECK (estado IN ('pendiente','enviada','fallida','cancelada')),
  CONSTRAINT notif_envio_scope_chk   CHECK (scope IN ('cliente','lista','cluster','broadcast','subscription'))
);
CREATE INDEX IF NOT EXISTS idx_notif_envio_manager      ON notif_envio(id_manager, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_envio_trainer      ON notif_envio(id_trainer, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_envio_seccion_tipo ON notif_envio(seccion, tipo);
CREATE INDEX IF NOT EXISTS idx_notif_envio_estado       ON notif_envio(estado) WHERE estado IN ('pendiente','fallida');
CREATE INDEX IF NOT EXISTS idx_notif_envio_programada   ON notif_envio(programada_at) WHERE programada_at IS NOT NULL AND estado = 'pendiente';

CREATE TABLE IF NOT EXISTS notif_destinatario (
  id                       SERIAL PRIMARY KEY,
  envio_id                 INTEGER NOT NULL REFERENCES notif_envio(id) ON DELETE CASCADE,
  id_manager               VARCHAR(64) NOT NULL,               -- denorm para queries rápidas
  id_trainer               VARCHAR(64),                         -- denorm
  cliente_idnoofit         VARCHAR(64) NOT NULL,
  leida                    BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_lectura            TIMESTAMPTZ,
  onesignal_player_id      VARCHAR(80),                         -- opcional, si OneSignal devuelve player_ids
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_dest_cliente ON notif_destinatario(cliente_idnoofit, leida, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_dest_envio   ON notif_destinatario(envio_id);
CREATE INDEX IF NOT EXISTS idx_notif_dest_manager ON notif_destinatario(id_manager, created_at DESC);

CREATE TABLE IF NOT EXISTS notif_config (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64),                         -- NULL = config manager-wide (default)
  -- Día del mes (1..31, 0=desactivado) en que el cron busca recibos efectivo impagados y avisa
  dia_envio_impago_efectivo INTEGER NOT NULL DEFAULT 5,
  -- Activadores per tipo automático (manager o trainer pueden silenciar)
  auto_impago_efectivo     BOOLEAN NOT NULL DEFAULT TRUE,
  auto_devolucion          BOOLEAN NOT NULL DEFAULT TRUE,
  auto_enlace_pago         BOOLEAN NOT NULL DEFAULT TRUE,
  auto_pago_alta           BOOLEAN NOT NULL DEFAULT TRUE,
  -- Plantillas custom: { tipo: {titulo: '...', cuerpo: '...'} } sobreescriben los defaults
  -- Variables soportadas: {{cliente_nombre}}, {{importe}}, {{fecha_emision}}, {{centro}}, etc.
  plantillas               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notif_config_unique UNIQUE (id_manager, id_trainer),
  CONSTRAINT notif_config_dia_chk CHECK (dia_envio_impago_efectivo BETWEEN 0 AND 31)
);
CREATE INDEX IF NOT EXISTS idx_notif_cfg_manager ON notif_config(id_manager);

-- Columnas añadidas posteriormente — ALTER idempotente (mayo 2026):
-- Auto-cobro online: si hay TPV virtual configurado (PayComet u otra) se
-- pueden mandar links de pago automáticos junto con avisos de impago/devol.
ALTER TABLE notif_config
  ADD COLUMN IF NOT EXISTS auto_link_devolucion       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_link_impago_efectivo  BOOLEAN NOT NULL DEFAULT TRUE,
  -- Día del mes (1..31) en que se envía link de pago masivo a TODOS los
  -- clientes con forma_pago=efectivo que tengan recibo del mes pendiente.
  -- 0 = desactivado (proceso manual).
  ADD COLUMN IF NOT EXISTS auto_link_efectivo_dia     INTEGER NOT NULL DEFAULT 0;


-- ─── CONTABILIDAD ──────────────────────────────────────────────────────────
-- Sistema de gestión de gastos / nóminas / extractos / impuestos del centro.
-- Round Config sirve como capa de UI + storage de archivos. La contabilidad
-- real (apuntes, IVA, conciliación) vive en Odoo (round_facturacion). Cada
-- documento validado crea/actualiza un account.move en Odoo y guardamos el
-- odoo_move_id como puente.

-- Toggle "se controla la contabilidad de este trainer".
-- Si activo=false, la pestaña Contabilidad no aparece para ese trainer.
CREATE TABLE IF NOT EXISTS trainer_contab_config (
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64) NOT NULL,
  activo                   BOOLEAN NOT NULL DEFAULT FALSE,
  notas                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_manager, id_trainer)
);

-- Catálogo de categorías de gasto per manager.
-- Mapping a cuenta contable Odoo (account.account.code) — el manager puede
-- editarlo para alinearse a su plan contable.
CREATE TABLE IF NOT EXISTS gasto_categoria (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  codigo                   VARCHAR(40) NOT NULL,            -- ej 'luz', 'irpf', 'nomina'
  nombre                   VARCHAR(120) NOT NULL,
  tipo                     VARCHAR(20) NOT NULL,            -- 'gasto'|'nomina'|'banco'|'impuesto'|'otro'
  periodicidad             VARCHAR(20),                      -- 'mensual'|'trimestral'|'anual'|null (one-shot)
  proveedor_default        VARCHAR(120),
  cuenta_contable_odoo     VARCHAR(20),                      -- ej '628000', '640000'
  iva_default              NUMERIC(5,2),                     -- ej 21.00
  color                    VARCHAR(20),
  orden                    INTEGER DEFAULT 100,
  activa                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gasto_cat_unique UNIQUE (id_manager, codigo),
  CONSTRAINT gasto_cat_tipo_chk CHECK (tipo IN ('gasto','nomina','banco','impuesto','otro'))
);
CREATE INDEX IF NOT EXISTS idx_gasto_cat_manager ON gasto_categoria(id_manager);
CREATE INDEX IF NOT EXISTS idx_gasto_cat_tipo    ON gasto_categoria(tipo);

-- Visibilidad per (categoría, trainer). Si no hay fila → visible por default.
CREATE TABLE IF NOT EXISTS gasto_categoria_visibilidad (
  categoria_id             INTEGER NOT NULL REFERENCES gasto_categoria(id) ON DELETE CASCADE,
  id_trainer               VARCHAR(64) NOT NULL,
  visible                  BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (categoria_id, id_trainer)
);

-- Visibilidad de listados per trainer (mismo patrón).
-- listado_id es enum hardcoded: 'facturas','totales_periodo','banco_sin_cuadrar',
-- 'faltantes','resultados'.
CREATE TABLE IF NOT EXISTS gasto_listado_visibilidad (
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64) NOT NULL,
  listado_id               VARCHAR(40) NOT NULL,
  visible                  BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id_manager, id_trainer, listado_id)
);

-- Documento subido (factura, nómina, extracto, recibo impuesto…).
-- Vive como archivo en disco + metadata aquí + odoo_move_id (puente).
CREATE TABLE IF NOT EXISTS gasto_documento (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64),                       -- a quién se asigna; NULL = manager-wide
  categoria_id             INTEGER REFERENCES gasto_categoria(id) ON DELETE SET NULL,
  -- Datos del documento (rellena el LLM o el usuario)
  proveedor                VARCHAR(160),
  proveedor_vat            VARCHAR(40),                       -- CIF/NIF
  num_factura              VARCHAR(80),
  fecha_documento          DATE,
  fecha_recepcion          DATE,
  periodo                  VARCHAR(10),                       -- 'YYYY-MM' o 'YYYY-T1'..'YYYY-T4'
  importe_base             NUMERIC(12,2),
  importe_iva              NUMERIC(12,2),
  importe_total            NUMERIC(12,2),
  iva_pct                  NUMERIC(5,2),
  concepto                 TEXT,
  -- Storage
  filename_original        VARCHAR(240),
  storage_path             TEXT,                              -- absoluta en VPS
  mime_type                VARCHAR(80),
  tamaño_bytes             BIGINT,
  hash_sha256              CHAR(64),
  -- Estado del flujo
  estado                   VARCHAR(20) NOT NULL DEFAULT 'borrador',
                                                              -- 'borrador'|'validado'|'rechazado'|'duplicado'
  -- Puente Odoo
  odoo_move_id             INTEGER,
  odoo_move_state          VARCHAR(20),                       -- 'draft'|'posted'|'cancel'|'paid'
  odoo_partner_id          INTEGER,
  -- LLM
  extraido_por_llm         BOOLEAN NOT NULL DEFAULT FALSE,
  confianza_llm            NUMERIC(5,4),                      -- 0..1
  llm_data                 JSONB,                             -- snapshot completo
  -- Audit
  notas                    TEXT,
  motivo_rechazo           TEXT,
  created_by               VARCHAR(80),
  validado_by              VARCHAR(80),
  validado_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gasto_doc_estado_chk
    CHECK (estado IN ('borrador','validado','rechazado','duplicado'))
);
CREATE INDEX IF NOT EXISTS idx_gasto_doc_manager   ON gasto_documento(id_manager, fecha_documento DESC);
CREATE INDEX IF NOT EXISTS idx_gasto_doc_trainer   ON gasto_documento(id_trainer, fecha_documento DESC);
CREATE INDEX IF NOT EXISTS idx_gasto_doc_categoria ON gasto_documento(categoria_id);
CREATE INDEX IF NOT EXISTS idx_gasto_doc_estado    ON gasto_documento(estado);
CREATE INDEX IF NOT EXISTS idx_gasto_doc_periodo   ON gasto_documento(id_manager, periodo);
CREATE INDEX IF NOT EXISTS idx_gasto_doc_hash      ON gasto_documento(id_manager, hash_sha256) WHERE hash_sha256 IS NOT NULL;

-- Movimiento bancario (importado de extracto). Vinculable a una factura.
CREATE TABLE IF NOT EXISTS banco_movimiento (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64),
  documento_origen_id      INTEGER REFERENCES gasto_documento(id) ON DELETE SET NULL,
                                                              -- el extracto del que vino esta línea
  banco                    VARCHAR(80),
  cuenta_iban              VARCHAR(40),
  fecha                    DATE NOT NULL,
  fecha_valor              DATE,
  concepto                 TEXT,
  importe                  NUMERIC(12,2) NOT NULL,
  saldo                    NUMERIC(14,2),
  ref_externa              VARCHAR(80),
  estado                   VARCHAR(20) NOT NULL DEFAULT 'sin_cuadrar',
                                                              -- 'sin_cuadrar'|'cuadrado'|'manual'|'ignorado'
  factura_relacionada_id   INTEGER REFERENCES gasto_documento(id) ON DELETE SET NULL,
  odoo_statement_line_id   INTEGER,                            -- puente a account.bank.statement.line
  hash_dedupe              VARCHAR(64),                        -- para evitar duplicar líneas al re-importar
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT banco_estado_chk
    CHECK (estado IN ('sin_cuadrar','cuadrado','manual','ignorado'))
);
CREATE INDEX IF NOT EXISTS idx_banco_mov_manager  ON banco_movimiento(id_manager, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_banco_mov_estado   ON banco_movimiento(id_manager, estado);
CREATE INDEX IF NOT EXISTS idx_banco_mov_factura  ON banco_movimiento(factura_relacionada_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_banco_mov_dedupe
  ON banco_movimiento(id_manager, hash_dedupe);

-- Faltantes archivados: el manager dice "este mes/trimestre concreto no
-- me importa que falte" para que no salga en el listado de faltantes.
-- Ej: si nunca pago Modelo 200 en T2 porque es trimestre vacío.
CREATE TABLE IF NOT EXISTS gasto_faltante_ignorado (
  id_manager               VARCHAR(64) NOT NULL,
  categoria_id             INTEGER NOT NULL REFERENCES gasto_categoria(id) ON DELETE CASCADE,
  periodo                  VARCHAR(10) NOT NULL,    -- '2026-05' o '2026-T2' o '2026'
  ignored_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ignored_by               VARCHAR(80),
  motivo                   TEXT,
  PRIMARY KEY (id_manager, categoria_id, periodo)
);
CREATE INDEX IF NOT EXISTS idx_falt_ign_manager ON gasto_faltante_ignorado(id_manager);


-- ─── USUARIOS WEB + PERFILES ─────────────────────────────────────────────────
-- Sistema de niveles de acceso a la web Round.
-- Manager crea usuarios para sus trainers. Cada usuario tiene un perfil que
-- define qué puede hacer en cada pantalla.
CREATE TABLE IF NOT EXISTS perfil (
  id              SERIAL PRIMARY KEY,
  id_manager      VARCHAR(64) NOT NULL,
  nombre          VARCHAR(120) NOT NULL,
  descripcion     TEXT,
  -- Árbol JSONB con permisos por pantalla:
  --   { "clientes": { "_": true, "ver": true, "archivar": false }, ... }
  -- "_" = acceso al item de menú; el resto = permisos finos.
  permisos        JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_admin        BOOLEAN NOT NULL DEFAULT FALSE,  -- saltarse comprobaciones (super-trainer)
  activa          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id_manager, nombre)
);
CREATE INDEX IF NOT EXISTS idx_perfil_manager ON perfil(id_manager);

CREATE TABLE IF NOT EXISTS usuario_web (
  id                      SERIAL PRIMARY KEY,
  id_manager              VARCHAR(64) NOT NULL,
  id_trainer              VARCHAR(64),                       -- centro al que entra; NULL = corporativo
  perfil_id               INTEGER REFERENCES perfil(id) ON DELETE SET NULL,
  email                   VARCHAR(255) NOT NULL UNIQUE,
  nombre                  VARCHAR(120),
  apellidos               VARCHAR(160),
  telefono                VARCHAR(40),
  password_hash           VARCHAR(255),                      -- bcrypt
  email_verificado        BOOLEAN NOT NULL DEFAULT FALSE,
  verif_token             VARCHAR(64),
  verif_exp               TIMESTAMPTZ,
  reset_token             VARCHAR(64),
  reset_exp               TIMESTAMPTZ,
  must_change_password    BOOLEAN NOT NULL DEFAULT TRUE,     -- en alta sí; tras 30d sí
  last_password_change    TIMESTAMPTZ,
  failed_login_count      INTEGER NOT NULL DEFAULT 0,
  locked_until            TIMESTAMPTZ,                       -- antibruteforce
  activo                  BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at           TIMESTAMPTZ,
  last_login_ip           VARCHAR(64),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usrweb_manager ON usuario_web(id_manager);
CREATE INDEX IF NOT EXISTS idx_usrweb_perfil  ON usuario_web(perfil_id);
CREATE INDEX IF NOT EXISTS idx_usrweb_email   ON usuario_web(LOWER(email));

CREATE TABLE IF NOT EXISTS usuario_web_audit (
  id           SERIAL PRIMARY KEY,
  usuario_id   INTEGER REFERENCES usuario_web(id) ON DELETE CASCADE,
  email        VARCHAR(255),                                 -- denormalizado por si borran usuario
  evento       VARCHAR(40) NOT NULL,                         -- login_ok / login_fail / pwd_change / reset_request / verify / locked / etc.
  ip           VARCHAR(64),
  user_agent   VARCHAR(255),
  detalle      TEXT,
  ts           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usrweb_audit_user ON usuario_web_audit(usuario_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_usrweb_audit_evt  ON usuario_web_audit(evento, ts DESC);


-- ─── AUDIT LOG GENÉRICO ──────────────────────────────────────────────────────
-- Captura toda modificación relevante: quién, qué entidad, qué acción.
-- - actor_kind: 'manager' (login NoofitPro) o 'usuario_web' (login propio)
-- - actor_id:   id_usuario_web (NULL si manager)
-- - actor_email: denormalizado para informes (incluso si borran usuario)
-- - actor_label: 'Manager' o nombre+apellidos del usuario_web
-- - entidad: 'cliente', 'cuota', 'documento_gasto', 'lead', 'nota', 'perfil', 'usuario_web', etc.
-- - entidad_id: VARCHAR para soportar ints, ids NoofitPro y composite keys
-- - accion: 'create', 'update', 'archive', 'unarchive', 'delete', 'validar', 'rechazar', etc.
-- - cambios: JSONB con {before, after} o resumen libre
CREATE TABLE IF NOT EXISTS accion_log (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  id_manager      VARCHAR(64) NOT NULL,
  id_trainer      VARCHAR(64),
  actor_kind      VARCHAR(20) NOT NULL,                 -- 'manager' | 'usuario_web'
  actor_id        INTEGER,                              -- usuario_web.id si aplica
  actor_email     VARCHAR(255),
  actor_label     VARCHAR(160),                         -- denormalizado, lo que se muestra
  entidad         VARCHAR(40) NOT NULL,
  entidad_id      VARCHAR(80),
  accion          VARCHAR(40) NOT NULL,
  resumen         VARCHAR(255),                         -- 1 línea legible humana
  cambios         JSONB,                                -- detalle estructurado opcional
  ip              VARCHAR(64),
  user_agent      VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_accionlog_manager ON accion_log(id_manager, ts DESC);
CREATE INDEX IF NOT EXISTS idx_accionlog_entidad ON accion_log(entidad, entidad_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_accionlog_actor   ON accion_log(actor_kind, actor_id, ts DESC);


-- ─── NOTAS DE CLIENTE ────────────────────────────────────────────────────────
-- Sistema de notas con asignación a usuarios web.
-- Estado: abierta (visible en banner si asignada), archivada (oculta del banner),
-- recordatorio (oculta del banner hasta `recordatorio_hasta`).
CREATE TABLE IF NOT EXISTS cliente_nota (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64),
  cliente_idnoofit         VARCHAR(64) NOT NULL,         -- id NoofitPro del cliente
  cliente_nombre           VARCHAR(160),                  -- denormalizado, para popups
  contenido                TEXT NOT NULL,
  -- Quien creó la nota
  created_by_kind          VARCHAR(20) NOT NULL,          -- 'manager' | 'usuario_web'
  created_by_id            INTEGER,                       -- usuario_web.id si aplica
  created_by_email         VARCHAR(255),
  created_by_label         VARCHAR(160),
  -- Asignación a otro usuario (NULL = solo informativa)
  asignada_a_usuario_id    INTEGER REFERENCES usuario_web(id) ON DELETE SET NULL,
  asignada_a_email         VARCHAR(255),                  -- denormalizado
  asignada_a_label         VARCHAR(160),
  -- Estado
  estado                   VARCHAR(20) NOT NULL DEFAULT 'abierta',  -- 'abierta'|'archivada'|'recordatorio'|'contestada'
  recordatorio_hasta       TIMESTAMPTZ,                   -- si estado=recordatorio
  -- Hilo: si es respuesta a otra
  parent_id                INTEGER REFERENCES cliente_nota(id) ON DELETE CASCADE,
  -- Auditoría intrínseca
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at              TIMESTAMPTZ,
  archived_by_email        VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_nota_manager  ON cliente_nota(id_manager);
CREATE INDEX IF NOT EXISTS idx_nota_cliente  ON cliente_nota(cliente_idnoofit);
CREATE INDEX IF NOT EXISTS idx_nota_asignada ON cliente_nota(asignada_a_usuario_id, estado);
CREATE INDEX IF NOT EXISTS idx_nota_estado   ON cliente_nota(estado, recordatorio_hasta);
CREATE INDEX IF NOT EXISTS idx_nota_parent   ON cliente_nota(parent_id);


-- ─── CREDENCIALES NOOFIT POR TRAINER ────────────────────────────────────────
-- Cada trainer/centro en NoofitPro tiene su propia cuenta. Para que un
-- usuario_web pueda ver los clientes de su centro (vía proxy), el backend
-- necesita las credenciales NoofitPro de ESE trainer concreto.
-- Es complementaria a manager_config (que tiene la cuenta del manager raíz).
CREATE TABLE IF NOT EXISTS trainer_noofit_creds (
  id_manager      VARCHAR(64) NOT NULL,
  id_trainer      VARCHAR(64) NOT NULL,
  noofit_email    VARCHAR(255) NOT NULL,
  noofit_password VARCHAR(255) NOT NULL,           -- en claro (igual que manager_config)
  notas           TEXT,
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_manager, id_trainer)
);
CREATE INDEX IF NOT EXISTS idx_trainer_creds_manager ON trainer_noofit_creds(id_manager);


-- ─── RECIBOS Y LOTES DE FACTURACIÓN TRIMESTRAL ─────────────────────────────
-- Modelo nuevo (mayo 2026 en adelante):
--   1. Mensual emite RECIBOS por cliente activo (no facturas)
--   2. SEPA / tarjeta tokenizada → recibo PAGADO al emitir
--   3. Caja (efectivo, TPV físico/virtual) → recibo IMPAGADO
--   4. A lo largo del trimestre: pagos manuales, devoluciones SEPA, links pago
--   5. Al cerrar trimestre: wizard que permite seleccionar recibos COBRADOS
--      → genera account.move (out_invoice) en bloque por los marcados
--   6. No marcados → quedan pendientes de revisión en contabilidad

CREATE TABLE IF NOT EXISTS recibo (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64),
  cliente_idnoofit         VARCHAR(64) NOT NULL,
  cliente_nombre           VARCHAR(160),                    -- denormalizado
  cuota_id                 INTEGER,                          -- ref. cuota tabla
  cuota_codigo             VARCHAR(64),                      -- ej. RT LX 0915
  cuota_descripcion        VARCHAR(255),
  -- Periodo
  periodo                  VARCHAR(7) NOT NULL,              -- YYYY-MM
  fecha_desde              DATE,
  fecha_hasta              DATE,
  periodicidad             VARCHAR(20),                       -- mensual|trimestral|...
  -- Importes
  importe_base             NUMERIC(10,2) NOT NULL DEFAULT 0,
  importe_iva              NUMERIC(10,2) NOT NULL DEFAULT 0,
  importe_total            NUMERIC(10,2) NOT NULL DEFAULT 0,
  iva_pct                  NUMERIC(5,2) DEFAULT 21.00,
  -- Pago
  metodo_pago              VARCHAR(30) NOT NULL,              -- sepa|tarjeta_tok|caja_efectivo|caja_tpv_fisico|caja_tpv_virtual|enlace_pago
  estado                   VARCHAR(20) NOT NULL,              -- emitido|pagado|impagado|devuelto|facturado|cancelado
  fecha_emision            DATE NOT NULL,
  fecha_pago               TIMESTAMPTZ,
  fecha_devolucion         TIMESTAMPTZ,
  fecha_facturacion        TIMESTAMPTZ,
  -- Vínculos Odoo
  account_payment_id       INTEGER,                          -- id account.payment Odoo
  account_move_id          INTEGER,                          -- id account.move (cuando facturado)
  account_move_ref         VARCHAR(64),                      -- ref legible (INV/2026/001)
  -- Link de pago PayComet
  link_pago_token          VARCHAR(64),
  link_pago_url            VARCHAR(500),
  link_pago_creado_at      TIMESTAMPTZ,
  link_pago_pagado_at      TIMESTAMPTZ,
  -- Anti-duplicado / control
  intentos_cobro           INTEGER NOT NULL DEFAULT 0,
  origen                   VARCHAR(40) DEFAULT 'manual',     -- 'manual'|'cron_emision'|'gestplus_migracion'
  origen_ref               VARCHAR(64),                      -- numRec GestPlus, etc.
  notas                    TEXT,
  -- Lote facturación
  lote_facturacion_id      INTEGER,                          -- ref a recibo_lote_facturacion
  -- Auditoría intrínseca
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               VARCHAR(160),
  updated_by               VARCHAR(160)
);
CREATE INDEX IF NOT EXISTS idx_recibo_manager  ON recibo(id_manager);
CREATE INDEX IF NOT EXISTS idx_recibo_trainer  ON recibo(id_trainer);
CREATE INDEX IF NOT EXISTS idx_recibo_cliente  ON recibo(cliente_idnoofit, periodo);
CREATE INDEX IF NOT EXISTS idx_recibo_estado   ON recibo(estado, fecha_emision);
CREATE INDEX IF NOT EXISTS idx_recibo_periodo  ON recibo(periodo);
CREATE INDEX IF NOT EXISTS idx_recibo_amove    ON recibo(account_move_id);
CREATE INDEX IF NOT EXISTS idx_recibo_lote     ON recibo(lote_facturacion_id);
CREATE INDEX IF NOT EXISTS idx_recibo_origen   ON recibo(origen, origen_ref);


CREATE TABLE IF NOT EXISTS recibo_lote_facturacion (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  trimestre                VARCHAR(7) NOT NULL,             -- '2026-T2'
  fecha_inicio             DATE NOT NULL,
  fecha_fin                DATE NOT NULL,
  -- Estado del lote
  estado                   VARCHAR(20) NOT NULL DEFAULT 'pendiente',  -- pendiente|notificado|en_revision|facturado|cerrado
  notificado_at            TIMESTAMPTZ,
  abierto_at               TIMESTAMPTZ,                       -- cuando el manager abre el wizard
  facturado_at             TIMESTAMPTZ,
  cerrado_at               TIMESTAMPTZ,
  cerrado_por              VARCHAR(160),
  -- Stats
  total_recibos_disponibles INTEGER DEFAULT 0,
  total_recibos_marcados    INTEGER DEFAULT 0,
  total_recibos_facturados  INTEGER DEFAULT 0,
  total_recibos_pendientes  INTEGER DEFAULT 0,                -- los no marcados al cerrar
  total_facturado_eur       NUMERIC(12,2) DEFAULT 0,
  -- Odoo journal usado
  account_journal_id        INTEGER,
  notas                     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id_manager, trimestre)
);
CREATE INDEX IF NOT EXISTS idx_lote_manager   ON recibo_lote_facturacion(id_manager);
CREATE INDEX IF NOT EXISTS idx_lote_trimestre ON recibo_lote_facturacion(trimestre, estado);


-- ─── FORMA DE PAGO POR CLIENTE (con histórico) ─────────────────────────────
-- Cada cliente tiene UNA forma de pago activa que aplica a TODOS sus recibos.
-- Al cambiar: se cierra la actual (fecha_fin=hoy, estado=cancelada) y se
-- crea una nueva (mismo patrón que las cuotas).
CREATE TABLE IF NOT EXISTS forma_pago_cliente (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  cliente_idnoofit         VARCHAR(64) NOT NULL,
  forma_pago               VARCHAR(30) NOT NULL,           -- sepa|tarjeta_token|efectivo|enlace_pago
  iban                     VARCHAR(40),
  iban_titular             VARCHAR(160),
  bic                      VARCHAR(20),
  mandate_ref              VARCHAR(50),
  card_token               VARCHAR(100),
  card_brand               VARCHAR(20),
  card_last4               VARCHAR(4),
  estado                   VARCHAR(20) NOT NULL DEFAULT 'activa',  -- activa | cancelada
  fecha_inicio             DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin                DATE,
  motivo_cambio            TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               VARCHAR(160),
  updated_by               VARCHAR(160)
);
CREATE INDEX IF NOT EXISTS idx_fpcli_manager       ON forma_pago_cliente(id_manager);
CREATE INDEX IF NOT EXISTS idx_fpcli_cliente_act   ON forma_pago_cliente(cliente_idnoofit, estado);
-- Solo UNA forma activa por (manager, cliente).
CREATE UNIQUE INDEX IF NOT EXISTS uq_fpcli_activa
  ON forma_pago_cliente(id_manager, cliente_idnoofit)
  WHERE estado = 'activa';


-- ═══════════════════════════════════════════════════════════════════════════
-- ║  CONTROL HORARIO LABORAL — Fase 1                                       ║
-- ║                                                                          ║
-- ║  Cumple art. 34.9 ET + RD-Ley 8/2019: registro diario individualizado    ║
-- ║  con hora exacta de inicio/fin, accesible a trabajador/representantes/   ║
-- ║  ITSS, conservado 4 años. Hash-chain SHA-256 prepara el módulo para la   ║
-- ║  exigencia de "log de auditoría inmutable" del RD en trámite (oct-2025). ║
-- ║                                                                          ║
-- ║  Empleador = trainer (siempre). El manager ve a todos sus trainers.     ║
-- ║  Un trabajador puede prestar servicios en varios trainers del mismo     ║
-- ║  manager (pivote `trabajador_trainer`) pero la entidad jurídica         ║
-- ║  empleadora es única (`trabajador.id_trainer_empleador`).               ║
-- ║                                                                          ║
-- ║  Detalle en docs/CONTROL_HORARIO.md.                                    ║
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── CONVENIOS (catálogo) ──────────────────────────────────────────────────
-- id_manager NULL = convenio global del sistema (siembra inicial).
-- id_manager NOT NULL = convenio creado por un manager para sus trainers.
-- Los valores aquí (horas, vacaciones, asuntos propios) son los defaults
-- que `trainer_empresa` hereda; cada trainer puede sobreescribirlos.
CREATE TABLE IF NOT EXISTS convenio (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64),
  nombre                   VARCHAR(160) NOT NULL,
  horas_anuales            INTEGER NOT NULL DEFAULT 1772,
  horas_semana             NUMERIC(5,2) NOT NULL DEFAULT 40,
  vacaciones_dias          INTEGER NOT NULL DEFAULT 30,
  vacaciones_tipo          VARCHAR(12) NOT NULL DEFAULT 'naturales'
                                       CHECK (vacaciones_tipo IN ('naturales','laborales')),
  asuntos_propios_dias     INTEGER NOT NULL DEFAULT 0,
  descanso_min_jornada_h   NUMERIC(4,2) NOT NULL DEFAULT 12,
  notas                    TEXT,
  activo                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT convenio_unique UNIQUE (id_manager, nombre)
);
CREATE INDEX IF NOT EXISTS idx_convenio_manager ON convenio(id_manager);

-- Migracion idempotente: si la tabla ya existia sin vacaciones_tipo, la añadimos.
ALTER TABLE convenio
  ADD COLUMN IF NOT EXISTS vacaciones_tipo VARCHAR(12) NOT NULL DEFAULT 'naturales';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='convenio_vacaciones_tipo_check'
  ) THEN
    ALTER TABLE convenio ADD CONSTRAINT convenio_vacaciones_tipo_check
      CHECK (vacaciones_tipo IN ('naturales','laborales'));
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

-- Siembra global (sólo si no hay convenios globales aún).
INSERT INTO convenio (id_manager, nombre, horas_anuales, horas_semana, vacaciones_dias, asuntos_propios_dias, notas)
  SELECT NULL::VARCHAR(64), v.nombre, v.horas_anuales, v.horas_semana, v.vacaciones, v.asuntos, v.notas
    FROM (VALUES
      ('Estatuto de los Trabajadores (general)' , 1826, 40.0, 30, 0,
       'Jornada legal 40h/sem promedio anual (art. 34.1 ET). Vacaciones 30 días naturales (art. 38 ET).'),
      ('Oficinas y Despachos (Málaga)'          , 1772, 40.0, 30, 6,
       'Convenio provincial Oficinas y Despachos Málaga. Horas anuales ≈1772, AP 6 días.'),
      ('Instalaciones Deportivas y Gimnasios'    , 1800, 40.0, 30, 4,
       'Convenio estatal Instalaciones Deportivas y Gimnasios. Horas anuales ≈1800, AP 4 días.')
    ) AS v(nombre, horas_anuales, horas_semana, vacaciones, asuntos, notas)
   WHERE NOT EXISTS (SELECT 1 FROM convenio WHERE id_manager IS NULL);


-- ─── DATOS DE EMPRESA POR TRAINER ──────────────────────────────────────────
-- El trainer es la entidad jurídica empleadora a efectos del registro
-- horario. Una fila por trainer. Los datos hereda los trabajadores
-- (salvo override en su fila).
CREATE TABLE IF NOT EXISTS trainer_empresa (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64) NOT NULL,
  razon_social             VARCHAR(160),
  cif                      VARCHAR(40),
  direccion_fiscal         TEXT,
  convenio_id              INTEGER REFERENCES convenio(id) ON DELETE SET NULL,
  -- Overrides opcionales. NULL = hereda del convenio.
  horas_anuales_override        INTEGER,
  horas_semana_override         NUMERIC(5,2),
  vacaciones_dias_override      INTEGER,
  vacaciones_tipo_override      VARCHAR(12)
                                       CHECK (vacaciones_tipo_override IS NULL
                                              OR vacaciones_tipo_override IN ('naturales','laborales')),
  asuntos_propios_dias_override INTEGER,
  representante_legal              VARCHAR(160),
  fecha_acuerdo_representantes     DATE,
  notas                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT trainer_empresa_unique UNIQUE (id_manager, id_trainer)
);
CREATE INDEX IF NOT EXISTS idx_trainer_empresa_manager ON trainer_empresa(id_manager);

-- Migracion idempotente para tablas ya existentes
ALTER TABLE trainer_empresa
  ADD COLUMN IF NOT EXISTS vacaciones_tipo_override VARCHAR(12);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='trainer_empresa_vac_tipo_check'
  ) THEN
    ALTER TABLE trainer_empresa ADD CONSTRAINT trainer_empresa_vac_tipo_check
      CHECK (vacaciones_tipo_override IS NULL
             OR vacaciones_tipo_override IN ('naturales','laborales'));
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END$$;


-- ─── TRABAJADORES ──────────────────────────────────────────────────────────
-- Espejo local de los clientes NoofitPro con categoría "Trabajadores".
-- Modelo híbrido: NoofitPro propone (la categoría), admin confirma con
-- los datos laborales obligatorios (NIF, jornada, trainer empleador).
--   pendiente_alta = aparece como candidato sin datos completos.
--   activo         = puede fichar.
--   baja           = fichaje deshabilitado, histórico conservado (4 años).
CREATE TABLE IF NOT EXISTS trabajador (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  cliente_idnoofit         VARCHAR(64) NOT NULL,
  id_trainer_empleador     VARCHAR(64),
  nif                      VARCHAR(40),
  nombre_completo          VARCHAR(240),
  email                    VARCHAR(160),
  jornada_h_semana         NUMERIC(5,2),
  categoria_profesional    VARCHAR(120),
  tipo_contrato            VARCHAR(40),
  fecha_alta_laboral       DATE,
  fecha_baja_laboral       DATE,
  -- Overrides opcionales sobre los heredados del trainer_empresa.
  vacaciones_dias_override      INTEGER,
  asuntos_propios_dias_override INTEGER,
  -- Estados:
  --   pendiente_autorizacion = el trabajador la solicito desde mynoofit/portal,
  --                            esperando autorizacion del manager/trainer.
  --   activo                 = autorizado, puede fichar.
  --   rechazada              = la solicitud fue rechazada. Puede volver a solicitar.
  --   baja                   = activo previo, dado de baja. Histórico conservado.
  --   pendiente_alta         = LEGACY (modelo admin-iniciado), se mantiene por
  --                            compat retro mientras no migremos datos viejos.
  estado                   VARCHAR(24) NOT NULL DEFAULT 'pendiente_autorizacion'
                                       CHECK (estado IN (
                                         'pendiente_autorizacion','activo','rechazada','baja',
                                         'pendiente_alta'
                                       )),
  solicitud_motivo         TEXT,                -- comentario libre del trabajador al solicitar
  rechazo_motivo           TEXT,                -- comentario del admin al rechazar
  autorizado_por_usuario_id INTEGER,            -- usuario_web.id del admin que autorizo
  resuelto_at              TIMESTAMPTZ,         -- timestamp de autorizar/rechazar
  notas                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT trabajador_unique UNIQUE (id_manager, cliente_idnoofit)
);
CREATE INDEX IF NOT EXISTS idx_trabajador_manager   ON trabajador(id_manager);
CREATE INDEX IF NOT EXISTS idx_trabajador_empleador ON trabajador(id_manager, id_trainer_empleador);
CREATE INDEX IF NOT EXISTS idx_trabajador_estado    ON trabajador(id_manager, estado);

-- Migracion idempotente para tablas ya existentes (sin las columnas nuevas).
ALTER TABLE trabajador
  ADD COLUMN IF NOT EXISTS solicitud_motivo        TEXT,
  ADD COLUMN IF NOT EXISTS rechazo_motivo          TEXT,
  ADD COLUMN IF NOT EXISTS autorizado_por_usuario_id INTEGER,
  ADD COLUMN IF NOT EXISTS resuelto_at             TIMESTAMPTZ;

-- Ampliar el CHECK de estado (Postgres no soporta IF NOT EXISTS en constraints).
DO $$
BEGIN
  ALTER TABLE trabajador DROP CONSTRAINT IF EXISTS trabajador_estado_check;
  ALTER TABLE trabajador ADD CONSTRAINT trabajador_estado_check
    CHECK (estado IN ('pendiente_autorizacion','activo','rechazada','baja','pendiente_alta'));
  -- Ampliar tamaño VARCHAR si la columna se creo con 20.
  BEGIN
    ALTER TABLE trabajador ALTER COLUMN estado TYPE VARCHAR(24);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
EXCEPTION WHEN OTHERS THEN NULL;
END$$;


-- ─── HORARIO TEÓRICO SEMANAL DEL TRABAJADOR (Fase 2 A) ────────────────────
-- Cada trabajador tiene N bloques horarios por día de la semana (ISO:
-- 1=Lunes, 7=Domingo). Soporta jornadas partidas con varios bloques en
-- un mismo día (Lun 09:00-14:00 + 16:00-19:00). Jornadas nocturnas
-- (22:00-06:00) se modelan como dos bloques en días consecutivos.
--
-- Sin versionado histórico — una sola versión activa por trabajador.
-- Cuando se edita, se reemplaza el horario entero en una transacción.
-- La auditoría de "qué cambió" vive en `accion_log` con resumen del diff.
CREATE TABLE IF NOT EXISTS horario_trabajador (
  id              SERIAL PRIMARY KEY,
  trabajador_id   INTEGER NOT NULL REFERENCES trabajador(id) ON DELETE CASCADE,
  dia_semana      SMALLINT NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
  hora_inicio     TIME NOT NULL,
  hora_fin        TIME NOT NULL,
  tipo            VARCHAR(20) NOT NULL DEFAULT 'trabajo'
                              CHECK (tipo IN ('trabajo','comida','descanso','otros')),
  orden           SMALLINT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT horario_bloque_valido CHECK (hora_fin > hora_inicio)
);
CREATE INDEX IF NOT EXISTS idx_horario_trabajador
  ON horario_trabajador(trabajador_id, dia_semana, orden);

-- Migracion idempotente para tablas ya creadas sin la columna tipo
ALTER TABLE horario_trabajador
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'trabajo';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='horario_trabajador_tipo_check'
  ) THEN
    ALTER TABLE horario_trabajador ADD CONSTRAINT horario_trabajador_tipo_check
      CHECK (tipo IN ('trabajo','comida','descanso','otros'));
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END$$;


-- ─── TRABAJADOR ↔ TRAINER (pivote N:M) ─────────────────────────────────────
-- Un trabajador puede prestar servicios en varios trainers del mismo
-- manager (cubrir turnos en otro centro). La entidad empleadora sigue
-- siendo única (`trabajador.id_trainer_empleador`).
CREATE TABLE IF NOT EXISTS trabajador_trainer (
  id                       SERIAL PRIMARY KEY,
  trabajador_id            INTEGER NOT NULL REFERENCES trabajador(id) ON DELETE CASCADE,
  id_manager               VARCHAR(64) NOT NULL,
  id_trainer               VARCHAR(64) NOT NULL,
  fecha_inicio             DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin                DATE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT trabajador_trainer_unique UNIQUE (trabajador_id, id_trainer, fecha_inicio)
);
CREATE INDEX IF NOT EXISTS idx_trab_trainer_trab    ON trabajador_trainer(trabajador_id);
CREATE INDEX IF NOT EXISTS idx_trab_trainer_trainer ON trabajador_trainer(id_manager, id_trainer);


-- ─── MOTIVOS DE PAUSA (catálogo global + override por manager) ─────────────
-- id_manager NULL = motivo global (siembra). id_manager NOT NULL = motivo
-- propio del manager. Para "desactivar" un motivo global, el manager
-- inserta una fila con el mismo `codigo` y `activo=FALSE`.
--   `computa_jornada=TRUE`  → la pausa cuenta como tiempo trabajado.
--   `requiere_justificante` → la UI obliga a indicarlo (médico, etc.).
CREATE TABLE IF NOT EXISTS pausa_motivo (
  id                       SERIAL PRIMARY KEY,
  id_manager               VARCHAR(64),
  codigo                   VARCHAR(40) NOT NULL,
  etiqueta                 VARCHAR(120) NOT NULL,
  computa_jornada          BOOLEAN NOT NULL DEFAULT FALSE,
  requiere_justificante    BOOLEAN NOT NULL DEFAULT FALSE,
  orden                    INTEGER NOT NULL DEFAULT 0,
  activo                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pausa_motivo_unique UNIQUE (id_manager, codigo)
);
CREATE INDEX IF NOT EXISTS idx_pausa_motivo_manager ON pausa_motivo(id_manager);

-- Siembra global.
INSERT INTO pausa_motivo (id_manager, codigo, etiqueta, computa_jornada, requiere_justificante, orden)
  SELECT NULL::VARCHAR(64), v.codigo, v.etiqueta, v.computa, v.justif, v.orden
    FROM (VALUES
      ('comida'           , 'Comida'                                    , FALSE, FALSE, 10),
      ('descanso_corto'   , 'Descanso corto / café'                     , TRUE , FALSE, 20),
      ('descanso_obligat' , 'Descanso obligatorio (art. 34.4 ET)'       , TRUE , FALSE, 30),
      ('medico'           , 'Asuntos médicos'                           , FALSE, TRUE , 40),
      ('personal'         , 'Asuntos personales'                        , FALSE, FALSE, 50),
      ('otros'            , 'Otros'                                     , FALSE, FALSE, 99)
    ) AS v(codigo, etiqueta, computa, justif, orden)
   WHERE NOT EXISTS (SELECT 1 FROM pausa_motivo WHERE id_manager IS NULL);


-- ─── FICHAJES (append-only, hash-chain SHA-256) ───────────────────────────
-- Una fila por evento atómico: ENTRADA, SALIDA, PAUSA_INI, PAUSA_FIN, o
-- corrección (CORRECCION_INSERT / CORRECCION_ANULAR). NUNCA UPDATE/DELETE.
-- Las correcciones son eventos nuevos con `corrige_evento_id` apuntando al
-- evento original.
--
-- Integridad por hash-chain: cada evento guarda `hash` (SHA-256 del
-- payload + prev_hash) y `prev_hash` (del último evento del mismo
-- trabajador, ordenado por id). Una edición manual rompe la cadena y la
-- función verify_chain lo detecta. Cumple con la exigencia de inmutabilidad
-- del RD en trámite (sin esperar a su aprobación).
--
-- Verificación de ubicación (`verificacion_ubicacion`):
--   NO  → fichaje sin token QR válido (clic remoto). El admin lo ve marcado.
--   QR  → token QR válido (firmado por nosotros o validado en NoofitPro).
--   GPS → reservado, no usado en Fase 1.
-- `qr_origen` = 'menu' (QR rotativo HS256 propio) o 'clase' (QR de clase
-- activa de NoofitPro validado contra NoofitPro).
CREATE TABLE IF NOT EXISTS fichaje_evento (
  id                       BIGSERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  trabajador_id            INTEGER NOT NULL REFERENCES trabajador(id) ON DELETE RESTRICT,
  id_trainer               VARCHAR(64) NOT NULL,
  tipo                     VARCHAR(24) NOT NULL CHECK (tipo IN (
    'ENTRADA','SALIDA','PAUSA_INI','PAUSA_FIN',
    'CORRECCION_INSERT','CORRECCION_ANULAR'
  )),
  ts_evento                TIMESTAMPTZ NOT NULL,
  pausa_motivo_id          INTEGER REFERENCES pausa_motivo(id) ON DELETE SET NULL,
  -- Origen
  origen                   VARCHAR(20) NOT NULL CHECK (origen IN ('web','mynoofit','admin')),
  origen_version           VARCHAR(40),
  origen_ip                INET,
  origen_user_agent        TEXT,
  -- Verificación
  verificacion_ubicacion   VARCHAR(20) NOT NULL DEFAULT 'NO'
                                       CHECK (verificacion_ubicacion IN ('NO','QR','GPS')),
  qr_origen                VARCHAR(20)
                                       CHECK (qr_origen IS NULL OR qr_origen IN ('menu','clase')),
  qr_token_jti             VARCHAR(80),
  qr_clase_id              INTEGER,
  lat                      NUMERIC(10,7),
  lng                      NUMERIC(10,7),
  geo_accuracy_m           INTEGER,
  -- Correcciones (sólo si tipo IN ('CORRECCION_INSERT','CORRECCION_ANULAR'))
  corrige_evento_id        BIGINT REFERENCES fichaje_evento(id) ON DELETE RESTRICT,
  correccion_solicitud_id  BIGINT,
  correccion_motivo        TEXT,
  -- Autoría
  autor_rol                VARCHAR(20) NOT NULL CHECK (autor_rol IN ('trabajador','admin','sistema')),
  autor_usuario_id         INTEGER,
  autor_cliente_idnoofit   VARCHAR(64),
  -- Integridad
  prev_hash                CHAR(64),
  hash                     CHAR(64) NOT NULL,
  creado_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fichaje_evento_trab_ts
  ON fichaje_evento (trabajador_id, ts_evento DESC);
CREATE INDEX IF NOT EXISTS idx_fichaje_evento_manager_ts
  ON fichaje_evento (id_manager, ts_evento DESC);
CREATE INDEX IF NOT EXISTS idx_fichaje_evento_trainer_ts
  ON fichaje_evento (id_manager, id_trainer, ts_evento DESC);


-- ─── SOLICITUDES DE CORRECCIÓN (flujo trabajador → admin) ──────────────────
-- El trabajador propone una corrección desde mynoofit/web; queda
-- 'pendiente' hasta que un admin la aprueba o rechaza. Al aprobar, se
-- inserta el evento CORRECCION en `fichaje_evento` y se enlaza con
-- `evento_resultante_id`. El admin puede saltarse este flujo e insertar
-- la corrección directamente.
CREATE TABLE IF NOT EXISTS correccion_solicitud (
  id                       BIGSERIAL PRIMARY KEY,
  id_manager               VARCHAR(64) NOT NULL,
  trabajador_id            INTEGER NOT NULL REFERENCES trabajador(id) ON DELETE CASCADE,
  tipo_propuesto           VARCHAR(24) NOT NULL CHECK (tipo_propuesto IN (
    'ENTRADA','SALIDA','PAUSA_INI','PAUSA_FIN','ANULAR'
  )),
  ts_propuesto             TIMESTAMPTZ NOT NULL,
  pausa_motivo_id          INTEGER REFERENCES pausa_motivo(id) ON DELETE SET NULL,
  corrige_evento_id        BIGINT REFERENCES fichaje_evento(id) ON DELETE SET NULL,
  motivo                   TEXT NOT NULL,
  estado                   VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                                       CHECK (estado IN ('pendiente','aprobada','rechazada')),
  ts_resolucion            TIMESTAMPTZ,
  comentario_resolucion    TEXT,
  resuelto_por_usuario_id  INTEGER,
  evento_resultante_id     BIGINT REFERENCES fichaje_evento(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_correccion_trab
  ON correccion_solicitud(trabajador_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_correccion_manager_estado
  ON correccion_solicitud(id_manager, estado, created_at DESC);

-- FK diferida: fichaje_evento.correccion_solicitud_id → correccion_solicitud.id
-- (las dos tablas se referencian mutuamente; primero creamos sin la FK y luego la añadimos aquí).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name='fichaje_evento'
       AND constraint_name='fichaje_evento_correccion_solicitud_fk'
  ) THEN
    ALTER TABLE fichaje_evento
      ADD CONSTRAINT fichaje_evento_correccion_solicitud_fk
      FOREIGN KEY (correccion_solicitud_id)
      REFERENCES correccion_solicitud(id) ON DELETE SET NULL;
  END IF;
END$$;


-- ─── TRIGGER updated_at ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cuota_upd        ON cuota;
DROP TRIGGER IF EXISTS trg_descuento_upd    ON descuento;
DROP TRIGGER IF EXISTS trg_modificacion_upd ON modificacion;
DROP TRIGGER IF EXISTS trg_desc_asig_upd    ON descuento_asignacion;
DROP TRIGGER IF EXISTS trg_cligym_upd       ON cliente_gympass;
DROP TRIGGER IF EXISTS trg_pasarela_upd     ON pasarela_credenciales;
DROP TRIGGER IF EXISTS trg_centro_upd       ON centro_contacto;
DROP TRIGGER IF EXISTS trg_email_prov_upd   ON email_proveedor;
DROP TRIGGER IF EXISTS trg_email_tpl_upd    ON email_template;
DROP TRIGGER IF EXISTS trg_slot_reserva_upd ON slot_reserva;
DROP TRIGGER IF EXISTS trg_social_cuenta_upd ON social_cuenta;
DROP TRIGGER IF EXISTS trg_social_post_upd  ON social_post;
DROP TRIGGER IF EXISTS trg_categoria_upd     ON categoria;
DROP TRIGGER IF EXISTS trg_cli_categoria_upd ON cliente_categoria;
DROP TRIGGER IF EXISTS trg_manager_config_upd ON manager_config;
DROP TRIGGER IF EXISTS trg_notif_envio_upd     ON notif_envio;
DROP TRIGGER IF EXISTS trg_notif_config_upd    ON notif_config;
DROP TRIGGER IF EXISTS trg_trainer_contab_upd  ON trainer_contab_config;
DROP TRIGGER IF EXISTS trg_gasto_categoria_upd ON gasto_categoria;
DROP TRIGGER IF EXISTS trg_gasto_documento_upd ON gasto_documento;
DROP TRIGGER IF EXISTS trg_banco_mov_upd       ON banco_movimiento;
DROP TRIGGER IF EXISTS trg_perfil_upd          ON perfil;
DROP TRIGGER IF EXISTS trg_usuario_web_upd     ON usuario_web;
DROP TRIGGER IF EXISTS trg_cliente_nota_upd    ON cliente_nota;
DROP TRIGGER IF EXISTS trg_trainer_creds_upd   ON trainer_noofit_creds;
DROP TRIGGER IF EXISTS trg_recibo_upd          ON recibo;
DROP TRIGGER IF EXISTS trg_recibo_lote_upd     ON recibo_lote_facturacion;
DROP TRIGGER IF EXISTS trg_fpcli_upd            ON forma_pago_cliente;
DROP TRIGGER IF EXISTS trg_trainer_odoo_upd     ON trainer_odoo_config;
DROP TRIGGER IF EXISTS trg_convenio_upd         ON convenio;
DROP TRIGGER IF EXISTS trg_trainer_empresa_upd  ON trainer_empresa;
DROP TRIGGER IF EXISTS trg_trabajador_upd       ON trabajador;
DROP TRIGGER IF EXISTS trg_pausa_motivo_upd     ON pausa_motivo;
DROP TRIGGER IF EXISTS trg_correccion_sol_upd   ON correccion_solicitud;
DROP TRIGGER IF EXISTS trg_horario_trab_upd     ON horario_trabajador;

CREATE TRIGGER trg_cuota_upd        BEFORE UPDATE ON cuota
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_descuento_upd    BEFORE UPDATE ON descuento
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_modificacion_upd BEFORE UPDATE ON modificacion
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_desc_asig_upd    BEFORE UPDATE ON descuento_asignacion
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_cligym_upd       BEFORE UPDATE ON cliente_gympass
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_pasarela_upd     BEFORE UPDATE ON pasarela_credenciales
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_centro_upd       BEFORE UPDATE ON centro_contacto
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_email_prov_upd   BEFORE UPDATE ON email_proveedor
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_email_tpl_upd    BEFORE UPDATE ON email_template
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_slot_reserva_upd BEFORE UPDATE ON slot_reserva
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_social_cuenta_upd BEFORE UPDATE ON social_cuenta
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_social_post_upd  BEFORE UPDATE ON social_post
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_categoria_upd     BEFORE UPDATE ON categoria
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_cli_categoria_upd BEFORE UPDATE ON cliente_categoria
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_manager_config_upd BEFORE UPDATE ON manager_config
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_notif_envio_upd     BEFORE UPDATE ON notif_envio
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_notif_config_upd    BEFORE UPDATE ON notif_config
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_trainer_contab_upd  BEFORE UPDATE ON trainer_contab_config
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_gasto_categoria_upd BEFORE UPDATE ON gasto_categoria
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_gasto_documento_upd BEFORE UPDATE ON gasto_documento
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_banco_mov_upd       BEFORE UPDATE ON banco_movimiento
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_perfil_upd          BEFORE UPDATE ON perfil
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_usuario_web_upd     BEFORE UPDATE ON usuario_web
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_cliente_nota_upd    BEFORE UPDATE ON cliente_nota
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_trainer_creds_upd   BEFORE UPDATE ON trainer_noofit_creds
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_recibo_upd          BEFORE UPDATE ON recibo
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_recibo_lote_upd     BEFORE UPDATE ON recibo_lote_facturacion
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_fpcli_upd           BEFORE UPDATE ON forma_pago_cliente
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_trainer_odoo_upd    BEFORE UPDATE ON trainer_odoo_config
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_convenio_upd         BEFORE UPDATE ON convenio
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_trainer_empresa_upd  BEFORE UPDATE ON trainer_empresa
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_trabajador_upd       BEFORE UPDATE ON trabajador
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_pausa_motivo_upd     BEFORE UPDATE ON pausa_motivo
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_correccion_sol_upd   BEFORE UPDATE ON correccion_solicitud
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_horario_trab_upd     BEFORE UPDATE ON horario_trabajador
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
"""


# Categorías por defecto que se sembran la primera vez que un manager
# accede al sistema. NoofitPro categorías habituales: Gympass, Trabajador,
# Invitado. El "Pagador con cuota" no se siembra porque equivale a "sin
# categoría" en la lista (queda vacía en la columna).
DEFAULT_CATEGORIAS = [
    # (nombre,       color,    puede_reservar, tiene_cuota)
    ('Gympass',     'purple',  True,  False),
    ('Trabajador',  'cyan',    True,  False),
    ('Invitado',    'amber',   True,  False),
]


# Catálogo inicial de categorías de gasto. Plan contable PGC español adaptado
# a un centro fitness. El manager puede editar libremente.
DEFAULT_GASTO_CATEGORIAS = [
    # (codigo,        nombre,                tipo,       periodicidad, cuenta,  iva,   color)
    # ── Gastos generales del centro ──
    ('luz',           'Luz / electricidad',  'gasto',    'mensual',    '628000', 21.00, 'amber'),
    ('agua',          'Agua',                'gasto',    'mensual',    '628000', 10.00, 'blue'),
    ('gas',           'Gas',                 'gasto',    'mensual',    '628000', 21.00, 'orange'),
    ('alquiler',      'Alquiler local',      'gasto',    'mensual',    '621000',  0.00, 'purple'),
    ('comunidad',     'Gastos comunidad',    'gasto',    'mensual',    '622000',  0.00, 'gray'),
    ('seguros',       'Seguros',             'gasto',    'anual',      '625000',  0.00, 'cyan'),
    ('mantenimiento', 'Mantenimiento / repar.', 'gasto', None,         '622000', 21.00, 'gray'),
    ('limpieza',      'Limpieza',            'gasto',    'mensual',    '622000', 21.00, 'green'),
    ('marketing',     'Marketing / publicidad','gasto',  None,         '627000', 21.00, 'red'),
    ('suministros',   'Material / suministros','gasto',  None,         '602000', 21.00, 'amber'),
    ('software',      'Software / licencias','gasto',    'mensual',    '629000', 21.00, 'cyan'),
    ('telefono',      'Teléfono / internet', 'gasto',    'mensual',    '629000', 21.00, 'blue'),
    ('asesoria',      'Asesoría / gestoría', 'gasto',    'mensual',    '623000', 21.00, 'gray'),
    # ── Personal ──
    ('nomina',        'Nómina',              'nomina',   'mensual',    '640000',  0.00, 'green'),
    ('finiquito',     'Finiquito',           'nomina',   None,         '640000',  0.00, 'green'),
    # ── Banco ──
    ('extracto_banco','Extracto bancario',   'banco',    'mensual',    None,      0.00, 'blue'),
    # ── Impuestos ──
    ('iva_trim',      'IVA trimestral (modelo 303)', 'impuesto', 'trimestral', '475000', 0.00, 'red'),
    ('irpf_retenciones','IRPF retenciones (modelo 111)', 'impuesto', 'trimestral', '475100', 0.00, 'red'),
    ('seg_social',    'Seguridad Social',    'impuesto', 'mensual',    '476000',  0.00, 'red'),
    ('soc_ss_autonomos','Cuota autónomos',   'impuesto', 'mensual',    '476000',  0.00, 'red'),
    ('is_anual',      'Impuesto Sociedades (modelo 200)', 'impuesto', 'anual', '630000',  0.00, 'red'),
    # ── Otros ──
    ('otro',          'Otro gasto',          'otro',     None,         '629000', 21.00, 'gray'),
]


# Perfiles por defecto que se siembran la primera vez que un manager
# crea su primer usuario web. El manager puede borrarlos / editarlos.
# Los permisos se rellenan dinámicamente desde el catálogo del frontend en
# cuanto el manager edita el perfil; aquí solo dejamos el placeholder.
DEFAULT_PERFILES = [
    # (nombre,         is_admin, descripcion)
    ('Administrador',  True,     'Control total. Equivale al manager.'),
    ('Trainer',        False,    'Acceso al centro: ver clientes, clases, cuotas, notificar.'),
    ('Recepción',      False,    'Atención al cliente: alta, cuotas, cobros, agenda.'),
    ('Solo lectura',   False,    'Visualizar sin modificar nada.'),
]


# Matrices de permisos por defecto que se siembran junto al perfil.
# El árbol completo vive en src/config/permissions.js. Aquí marcamos las
# acciones a TRUE; el resto queda implícito FALSE (deny by default).
# La capa de auth (hasPermission) hace una traversal por path 'a.b.c'.
# Si el path no existe → false.
#
# Administrador no necesita matriz: is_admin=TRUE devuelve true a todo.
DEFAULT_PERMISOS = {
    'Trainer': {
        'inicio': {'ver': True},
        'clientes': {
            'ver_listado': True, 'ver_perfil': True, 'editar_datos': True,
            'pausar': True, 'archivar': True, 'asignar_categoria': True,
            'modificar_datos_erp': True, 'exportar_excel': True,
        },
        'clases': {'ver_listado': True, 'ver_detalle': True, 'marcar_asistencia': True},
        'informe_asistencia': {
            # Tabs reales (espejo de VALID_TABS en InformeAsistencia.jsx):
            # faltas, control, distribucion, revisar, riesgo, patrones,
            # retos, estado_fisico.
            'faltas': True, 'control': True, 'distribucion': True,
            'revisar': True, 'riesgo': True, 'patrones': True,
            'retos': True, 'estado_fisico': True,
        },
        'configuracion': {
            'centros_trainers': {'ver': True},
            'categorias_cliente': {'ver': True},
        },
    },
    'Recepción': {
        'inicio': {'ver': True},
        'clientes': {
            'ver_listado': True, 'ver_perfil': True, 'editar_datos': True,
            'crear': True, 'pausar': True, 'asignar_categoria': True,
            'notificar': True, 'reenviar_factura': True,
            'generar_link_pago': True, 'ver_datos_erp': True,
            'exportar_excel': True,
        },
        'crm': {
            'leads': {'ver_kanban': True, 'mover_etapa': True, 'editar_lead': True},
            'clientes_actuales': {'ver_listado': True, 'notificar_masivo': True},
            'notas': {
                'ver_listado': True, 'crear_nota': True,
                'editar_nota': True, 'cerrar_nota': True,
            },
            'agenda_social': {'ver_posts': True},
        },
        'clases': {
            'ver_listado': True, 'ver_detalle': True, 'marcar_asistencia': True,
        },
        'economico': {
            'cuotas_mensuales': {
                'ver': True, 'reenviar_factura': True,
                'generar_link_pago': True, 'marcar_pagado_manual': True,
            },
        },
        'informe_asistencia': {
            # Recepción ve los informes operativos (faltas/control/retos),
            # no el avanzado de patrones ni el de riesgo (analítica fina).
            'faltas': True, 'control': True, 'distribucion': True,
            'retos': True,
        },
        'configuracion': {
            'centros_trainers':   {'ver': True},
            'categorias_cliente': {'ver': True},
            'canales_captacion':  {'ver': True},
            'checklist':          {'ver': True},
            # Catálogos básicos en modo lectura (precios, descuentos) para
            # que Recepción pueda informar al cliente.
            'cuotas':             {'ver': True},
            'descuentos':         {'ver': True},
        },
    },
    'Solo lectura': {
        'inicio': {'ver': True},
        'clientes': {
            'ver_listado': True, 'ver_perfil': True,
            'ver_datos_erp': True, 'exportar_excel': True,
        },
        'crm': {
            'leads':              {'ver_kanban': True},
            'clientes_actuales':  {'ver_listado': True},
            'agenda_social':      {'ver_posts': True},
            'notas':              {'ver_listado': True},
        },
        'clases': {'ver_listado': True, 'ver_detalle': True},
        'economico': {
            'cuotas_mensuales': {'ver': True},
            'contabilidad': {
                'documentos':        {'ver': True},
                'banco':             {'ver': True},
                'totales':           {'ver': True},
                'faltantes':         {'ver': True},
                'cuenta_resultados': {'ver': True},
            },
        },
        'informe_asistencia': {
            # Tabs reales (espejo de VALID_TABS en InformeAsistencia.jsx):
            # faltas, control, distribucion, revisar, riesgo, patrones,
            # retos, estado_fisico.
            'faltas': True, 'control': True, 'distribucion': True,
            'revisar': True, 'riesgo': True, 'patrones': True,
            'retos': True, 'estado_fisico': True,
        },
        'configuracion': {
            'centros_trainers':   {'ver': True},
            'cuotas':             {'ver': True},
            'descuentos':         {'ver': True},
            'modificaciones':     {'ver': True},
            'modo_facturacion':   {'ver': True},
            'cuotas_descuentos':  {'ver': True},
            'email':              {'ver': True},
            'email_templates':    {'ver': True},
            'pasarelas':          {'ver': True},
            'notificaciones':     {'ver': True},
            'categorias_cliente': {'ver': True},
            'catalogos':          {'ver': True},
            'contabilidad_tab':   {'ver': True},
            'meta':               {'ver': True},
            'canales_captacion':  {'ver': True},
            'suscripciones':      {'ver': True},
            'checklist':          {'ver': True},
        },
        # Configuración ERP en modo lectura (datos fiscales del manager).
        'erp_configuracion': {'ver': True},
    },
}


def seed_perfiles_for_manager(id_manager: str) -> None:
    """Siembra los perfiles default si el manager no tiene ninguno.

    Cada perfil arranca con su matriz por defecto (DEFAULT_PERMISOS). El
    manager puede editarla después desde Configuración → Perfiles.
    """
    if not id_manager:
        return
    import json as _json
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM perfil WHERE id_manager=%s LIMIT 1", (str(id_manager),))
        if cur.fetchone():
            return
        for nombre, is_admin, descripcion in DEFAULT_PERFILES:
            permisos = DEFAULT_PERMISOS.get(nombre, {})
            cur.execute("""
                INSERT INTO perfil (id_manager, nombre, descripcion, is_admin, permisos)
                VALUES (%s, %s, %s, %s, %s::jsonb)
                ON CONFLICT (id_manager, nombre) DO NOTHING
            """, (str(id_manager), nombre, descripcion, is_admin,
                  _json.dumps(permisos)))


def seed_gasto_categorias_for_manager(id_manager: str) -> None:
    """Siembra el catálogo de categorías de gasto si el manager no tiene ninguna."""
    if not id_manager:
        return
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM gasto_categoria WHERE id_manager=%s LIMIT 1", (str(id_manager),))
        if cur.fetchone():
            return
        for i, (codigo, nombre, tipo, periodicidad, cuenta, iva, color) in enumerate(DEFAULT_GASTO_CATEGORIAS):
            cur.execute("""
                INSERT INTO gasto_categoria
                  (id_manager, codigo, nombre, tipo, periodicidad,
                   cuenta_contable_odoo, iva_default, color, orden, activa)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s, TRUE)
                ON CONFLICT (id_manager, codigo) DO NOTHING
            """, (str(id_manager), codigo, nombre, tipo, periodicidad,
                  cuenta, iva, color, (i+1) * 10))


def seed_categorias_for_manager(id_manager: str) -> None:
    """Crea las categorías por defecto si el manager no tiene ninguna.

    Tras sembrar, auto-migra los clientes marcados en `cliente_gympass`
    al catálogo nuevo (asignándolos a la categoría "Gympass") para que el
    sistema heredado siga funcionando sin re-asignación manual.

    Idempotente: usa ON CONFLICT en todos los inserts.
    """
    if not id_manager:
        return
    with get_conn() as conn, conn.cursor() as cur:
        # Si ya hay alguna, no sembramos (el manager pudo borrar las default a propósito)
        cur.execute("SELECT 1 FROM categoria WHERE id_manager=%s LIMIT 1", (str(id_manager),))
        ya_tiene = cur.fetchone() is not None
        if not ya_tiene:
            for nombre, color, puede_reservar, tiene_cuota in DEFAULT_CATEGORIAS:
                cur.execute("""
                    INSERT INTO categoria (id_manager, nombre, color, puede_reservar, tiene_cuota, activa)
                    VALUES (%s,%s,%s,%s,%s,TRUE)
                    ON CONFLICT (id_manager, nombre) DO NOTHING
                """, (str(id_manager), nombre, color, puede_reservar, tiene_cuota))

        # Auto-migración cliente_gympass → cliente_categoria con categoría "Gympass".
        # Idempotente: ON CONFLICT no hace nada si ya está asignado.
        cur.execute("""
            SELECT id FROM categoria
             WHERE id_manager=%s AND nombre='Gympass'
        """, (str(id_manager),))
        cat_gympass = cur.fetchone()
        if cat_gympass:
            cur.execute("""
                INSERT INTO cliente_categoria (id_manager, cliente_idnoofit, categoria_id)
                SELECT id_manager, cliente_idnoofit, %s
                  FROM cliente_gympass
                 WHERE id_manager = %s
                ON CONFLICT (id_manager, cliente_idnoofit) DO NOTHING
            """, (cat_gympass['id'], str(id_manager)))


def init_schema():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(SCHEMA_SQL)
    # Bootstrap manager_config con el manager por defecto del .env
    # si la tabla está vacía y existen las variables de entorno necesarias.
    bootstrap_default_manager()


def bootstrap_default_manager() -> None:
    """Si manager_config está vacío, mete una fila desde las variables de
    entorno (ROUND_DEFAULT_MANAGER + NOOFIT_EMAIL/NOOFIT_PASSWORD).

    Pensado para que el primer despliegue funcione sin tocar manualmente la
    tabla. Cuando haya N managers, el admin añadirá filas con sus propias
    credenciales y los crons las procesarán automáticamente.
    """
    import os
    id_manager = os.getenv('ROUND_DEFAULT_MANAGER', '').strip()
    email = os.getenv('NOOFIT_EMAIL', '').strip()
    pwd = os.getenv('NOOFIT_PASSWORD', '').strip()
    if not id_manager:
        return
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1 FROM manager_config LIMIT 1")
            if cur.fetchone():
                return  # ya hay datos, no machacamos
            cur.execute("""
                INSERT INTO manager_config (id_manager, nombre, noofit_email, noofit_password, activo, notas)
                VALUES (%s, %s, %s, %s, TRUE, %s)
                ON CONFLICT (id_manager) DO NOTHING
            """, (id_manager, 'Round (default)', email or None, pwd or None,
                  'Bootstrap inicial desde .env. Editar para añadir más managers.'))
    except Exception:
        # init_schema no debe romper la app si esto falla
        pass


def iter_active_managers():
    """Devuelve la lista de managers activos como dicts.

    Cada dict: {id_manager, nombre, noofit_email, noofit_password}.

    Si la tabla manager_config está vacía (despliegue antiguo),
    devuelve un único manager construido desde el env (fallback).
    """
    import os
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id_manager, nombre, noofit_email, noofit_password
                  FROM manager_config
                 WHERE activo = TRUE
                 ORDER BY id_manager
            """)
            rows = cur.fetchall()
        if rows:
            return rows
    except Exception:
        pass
    # Fallback al env (legacy)
    id_manager = os.getenv('ROUND_DEFAULT_MANAGER', '').strip()
    if not id_manager:
        return []
    return [{
        'id_manager': id_manager,
        'nombre': 'Round (env fallback)',
        'noofit_email': os.getenv('NOOFIT_EMAIL', ''),
        'noofit_password': os.getenv('NOOFIT_PASSWORD', ''),
    }]
