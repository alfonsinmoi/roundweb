"""Config específica del poller (extiende app/config.py)."""
import os

# NoofitPro API (donde el MCP empuja estado de cobranza)
NOOFIT_API_URL    = os.getenv('MCP_NOOFIT_API_URL',  '')
NOOFIT_API_TOKEN  = os.getenv('MCP_NOOFIT_API_TOKEN', '')

# Servicio noofit de push (donde el MCP envía notificaciones HTML al cliente)
PUSH_API_URL      = os.getenv('MCP_PUSH_API_URL',   '')
PUSH_API_TOKEN    = os.getenv('MCP_PUSH_API_TOKEN', '')

# Modo simulación: si es 1, no se hacen llamadas HTTP reales (solo log).
# Por defecto activado: hasta que Wiemspro exponga los endpoints reales.
DRY_RUN           = os.getenv('MCP_POLLER_DRY_RUN', '1') == '1'

# Días sin cobrar tras vencimiento para considerar 'impagado'
IMPAGO_DIAS       = int(os.getenv('MCP_POLLER_IMPAGO_DIAS', '5'))

# Archivo donde se guarda el cursor de última ejecución
CURSOR_FILE       = os.getenv('MCP_POLLER_CURSOR_FILE', '/var/lib/round_mcp/poller_cursor')
