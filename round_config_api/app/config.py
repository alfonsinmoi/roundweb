"""Config del backend round_config_api."""
import os

# Postgres
DB_HOST = os.getenv('CONFIG_DB_HOST', 'localhost')
DB_PORT = int(os.getenv('CONFIG_DB_PORT', '5432'))
DB_NAME = os.getenv('CONFIG_DB_NAME', 'round_config')
DB_USER = os.getenv('CONFIG_DB_USER', 'odoo')
DB_PWD  = os.getenv('CONFIG_DB_PWD',  '')

# Token compartido entre frontend Round y este backend
API_TOKEN = os.getenv('CONFIG_API_TOKEN', '')

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
TIPOS_DESCUENTO = ['porcentaje', 'importe']

def conn_string():
    return (f"host={DB_HOST} port={DB_PORT} dbname={DB_NAME} "
            f"user={DB_USER} password={DB_PWD}")
