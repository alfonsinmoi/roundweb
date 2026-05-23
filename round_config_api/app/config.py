"""Config del backend round_config_api."""
import os

# Postgres
DB_HOST = os.getenv('CONFIG_DB_HOST', 'localhost')
DB_PORT = int(os.getenv('CONFIG_DB_PORT', '5432'))
DB_NAME = os.getenv('CONFIG_DB_NAME', 'round_config')
DB_USER = os.getenv('CONFIG_DB_USER', 'odoo')
DB_PWD  = os.getenv('CONFIG_DB_PWD',  '')

# Odoo (sincronización de catálogos a round.cuota.catalogo, round.descuento.catalogo, round.modificacion.recibo)
ODOO_URL     = os.getenv('CONFIG_ODOO_URL',  'http://localhost:8069')
ODOO_DB      = os.getenv('CONFIG_ODOO_DB',   'round_facturacion')
ODOO_USER    = os.getenv('CONFIG_ODOO_USER', 'adminround')
ODOO_PWD     = os.getenv('CONFIG_ODOO_PWD',  '')
ODOO_COMPANY = int(os.getenv('CONFIG_ODOO_COMPANY', '1'))
ODOO_SYNC_ENABLED = os.getenv('CONFIG_ODOO_SYNC', '1') == '1'

# Token compartido entre frontend Round y este backend
API_TOKEN = os.getenv('CONFIG_API_TOKEN', '')

# wcommerce.wiemspro.com — consulta de tipoPago para el gate de Odoo
# (managers con tipoPago='S' pueden desplegar su propio Odoo).
# Las credenciales se comparten con GestionNoofit, por eso reutilizamos los
# mismos nombres de variable.
WCOMMERCE_BASE     = os.getenv('WCOMMERCE_BASE', 'https://wcommerce.wiemspro.com/Wcommerce_2020').rstrip('/')
WCOMMERCE_EMAIL    = os.getenv('WCOMMERCE_EMAIL', '')
WCOMMERCE_PASSWORD = os.getenv('WCOMMERCE_PASSWORD', '')
WCOMMERCE_APP_VER  = os.getenv('WCOMMERCE_APP_VERSION', '1.0')
WCOMMERCE_APP_ID   = os.getenv('WCOMMERCE_APP_ID', '1')

# CORS — orígenes permitidos
CORS_ORIGINS = [
    o.strip() for o in os.getenv(
        'CONFIG_CORS_ORIGINS',
        'https://round.wiemspro.com,http://localhost:5173'
    ).split(',') if o.strip()
]

# Listas cerradas (no se modifican desde la UI, son enum)
FORMAS_PAGO = ['sepa', 'tpv', 'efectivo', 'tokenizacion']
PERIODICIDADES = ['mensual', 'bimensual', 'trimestral', 'semestral', 'anual']
TIPOS_MODIFICACION = ['descuento', 'cargo_extra', 'precio_alternativo']
TIPOS_DESCUENTO = ['porcentaje', 'importe', 'precio_combo', 'varias_cuotas', 'familiares']

def conn_string():
    return (f"host={DB_HOST} port={DB_PORT} dbname={DB_NAME} "
            f"user={DB_USER} password={DB_PWD}")
