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
"""


def init_schema():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(SCHEMA_SQL)
