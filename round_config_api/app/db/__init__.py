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
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mod_trainer ON modificacion(id_trainer);
CREATE INDEX IF NOT EXISTS idx_mod_fechas  ON modificacion(fecha_desde, fecha_hasta);


-- ─── TRIGGER updated_at ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cuota_upd        ON cuota;
DROP TRIGGER IF EXISTS trg_descuento_upd    ON descuento;
DROP TRIGGER IF EXISTS trg_modificacion_upd ON modificacion;

CREATE TRIGGER trg_cuota_upd        BEFORE UPDATE ON cuota
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_descuento_upd    BEFORE UPDATE ON descuento
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_modificacion_upd BEFORE UPDATE ON modificacion
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
"""


def init_schema():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(SCHEMA_SQL)
