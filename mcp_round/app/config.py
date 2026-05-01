"""Config del MCP — leída de variables de entorno."""
import os

# Odoo
ODOO_URL  = os.getenv('MCP_ODOO_URL',  'http://localhost:8069')
ODOO_DB   = os.getenv('MCP_ODOO_DB',   'round_facturacion')
ODOO_USER = os.getenv('MCP_ODOO_USER', 'adminround')
ODOO_PWD  = os.getenv('MCP_ODOO_PWD',  '')  # obligatorio en producción

# Auth webhook NoofitPro → MCP
WEBHOOK_TOKEN  = os.getenv('MCP_WEBHOOK_TOKEN',  '')        # X-Webhook-Token
WEBHOOK_SECRET = os.getenv('MCP_WEBHOOK_SECRET', '').encode()  # HMAC

# Modo desarrollo: relajar HMAC para tests locales
DEV_MODE = os.getenv('MCP_DEV_MODE', '0') == '1'

# Empresa Odoo por defecto (Round Málaga)
DEFAULT_COMPANY_ID = int(os.getenv('MCP_DEFAULT_COMPANY_ID', '1'))
