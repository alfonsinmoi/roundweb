-- Esquema de configuración de facturación Round (punto 1).
-- Idempotente. Se aplica como postgres. Persistido también en db/__init__.py.
BEGIN;

-- Config de facturación por EMPRESA (entidad jurídica) del manager
CREATE TABLE IF NOT EXISTS facturacion_config (
  id          serial PRIMARY KEY,
  id_manager  varchar(64) NOT NULL,
  company_id  integer,                        -- res.company Odoo (entidad jurídica)
  sistema     varchar(16) NOT NULL DEFAULT 'fin_de_mes'  CHECK (sistema IN ('inmediata','fin_de_mes')),
  destino     varchar(16) NOT NULL DEFAULT 'por_cliente' CHECK (destino IN ('por_cliente','agregada_430')),
  activo      boolean NOT NULL DEFAULT false,  -- gate: si false → comportamiento actual
  updated_by  varchar(80),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id_manager, company_id)
);

-- Series de numeración (compartibles entre trainers)
CREATE TABLE IF NOT EXISTS facturacion_serie (
  id               serial PRIMARY KEY,
  id_manager       varchar(64) NOT NULL,
  clave            varchar(40) NOT NULL,
  prefijo          varchar(20),
  descripcion      varchar(120),
  es_cliente_final boolean NOT NULL DEFAULT false,
  ir_sequence_id   integer,                    -- id ir.sequence Odoo (rellena el provisioner)
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id_manager, clave)
);

-- Config por trainer: cuenta 430XXX (sufijo 1..999) + serie asignada
CREATE TABLE IF NOT EXISTS facturacion_trainer (
  id                serial PRIMARY KEY,
  id_manager        varchar(64) NOT NULL,
  id_trainer        varchar(64) NOT NULL,
  cuenta_430_sufijo integer CHECK (cuenta_430_sufijo IS NULL OR (cuenta_430_sufijo BETWEEN 1 AND 999)),
  serie_id          integer REFERENCES facturacion_serie(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id_manager, id_trainer)
);

-- Tipos de IVA por trainer (cada cuota se asigna a un tipo)
CREATE TABLE IF NOT EXISTS facturacion_tipo_iva (
  id          serial PRIMARY KEY,
  id_manager  varchar(64) NOT NULL,
  id_trainer  varchar(64) NOT NULL,
  nombre      varchar(60) NOT NULL,
  pct         numeric(5,2) NOT NULL DEFAULT 21.00,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Registro de facturas "cliente final" (b.1) para reducir base el mes siguiente
CREATE TABLE IF NOT EXISTS factura_cliente_final (
  id               serial PRIMARY KEY,
  id_manager       varchar(64) NOT NULL,
  id_trainer       varchar(64) NOT NULL,
  cliente_idnoofit varchar(32) NOT NULL,
  periodo          varchar(7) NOT NULL,
  importe          numeric(12,2) NOT NULL,
  factura_ref      varchar(120),
  reducido         boolean NOT NULL DEFAULT false,
  reducido_periodo varchar(7),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- cuota → tipo de IVA
ALTER TABLE cuota ADD COLUMN IF NOT EXISTS tipo_iva_id integer
  REFERENCES facturacion_tipo_iva(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fact_trainer_mgr ON facturacion_trainer(id_manager);
CREATE INDEX IF NOT EXISTS idx_fact_tipoiva_mgr ON facturacion_tipo_iva(id_manager, id_trainer);
CREATE INDEX IF NOT EXISTS idx_fcf_mgr_periodo  ON factura_cliente_final(id_manager, periodo, reducido);

-- La app conecta como 'odoo' (CONFIG_DB_USER). Si esta migración se aplica
-- como 'postgres', las tablas quedarían sin acceso para 'odoo'. Aseguramos
-- ownership = odoo (idempotente; no-op si ya lo es).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facturacion_config','facturacion_serie','facturacion_trainer',
                           'facturacion_tipo_iva','factura_cliente_final'] LOOP
    EXECUTE format('ALTER TABLE %I OWNER TO odoo', t);
    EXECUTE format('ALTER SEQUENCE IF EXISTS %I OWNER TO odoo', t||'_id_seq');
  END LOOP;
END$$;

COMMIT;
