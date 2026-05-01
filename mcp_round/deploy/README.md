# Despliegue del MCP Round

Estos archivos se copian al VPS para arrancar los servicios MCP. Reproducible
con `scp` + `systemctl daemon-reload` + `systemctl enable --now`.

## Servicios

- `round_mcp.service` — receptor de webhooks (gunicorn en :8090)
- `round_poller.service` — poller one-shot (lo lanza el timer)
- `round_poller.timer` — cada 30 min, dispara el poller

## Instalación

```bash
# Subir
scp deploy/round_mcp.service     root@vps:/etc/systemd/system/
scp deploy/round_poller.service  root@vps:/etc/systemd/system/
scp deploy/round_poller.timer    root@vps:/etc/systemd/system/

# Crear directorios
ssh root@vps "mkdir -p /var/log/round_mcp /var/lib/round_mcp && chown odoo:odoo /var/log/round_mcp /var/lib/round_mcp"

# Activar
ssh root@vps "systemctl daemon-reload && systemctl enable --now round_mcp.service && systemctl enable --now round_poller.timer"
```

## Test

```bash
# Health del receiver
curl https://round.carajfam.com/mcp/health

# Disparar poller manualmente (sin esperar al timer)
ssh root@vps "systemctl start round_poller.service && sleep 5 && tail /var/log/round_mcp/poller.log"
```
