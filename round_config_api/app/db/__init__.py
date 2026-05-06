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
