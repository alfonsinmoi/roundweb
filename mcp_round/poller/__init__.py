"""Poller MCP — detecta cambios en Odoo y notifica a NoofitPro.

Cron cada 30 min (configurable). Por cada cambio relevante (cobro confirmado,
devolución SEPA, impago detectado), llama a NoofitPro y dispara push HTML al cliente.

Mientras Wiemspro no exponga los endpoints reales, los notifiers están en
modo simulado (registran en log y no llaman a nadie). Para activar producción
hay que rellenar NOOFIT_API_URL, NOOFIT_API_TOKEN, PUSH_API_URL y PUSH_API_TOKEN
en el .env y poner POLLER_DRY_RUN=0.
"""
