# Sistema de backups Round

> Última actualización: 2026-05-24. Mantén este doc actualizado en cada cambio del sistema de backup.

## Arquitectura actual (Fase 1 — local)

```
VPS (212.227.40.122)
├── /root/backups/postgres/     ← pg_dump *.sql.gz (14 días en plano)
├── /root/backups/restic-repo/  ← repo cifrado restic
│     · 7 snapshots diarios
│     · 4 snapshots semanales
│     · 12 snapshots mensuales
├── /var/log/round-backup/      ← logs + last-status
│     · *.log (60 días)
│     · last-status  → "ok (timestamp)" o "fail"
└── systemd timer round-backup.timer  → 03:30 diario
```

**Estado**: ✅ activo desde 2026-05-24. Cifrado con passphrase guardada en
`/root/.config-restic-passphrase` (modo 600, sólo root).

⚠️ **Esto es Fase 1**. Protege contra:
- ✅ Corrupción de datos (rollback a snapshot anterior)
- ✅ Borrado accidental por admin
- ✅ Rollback de un cambio que rompió algo

NO protege contra:
- ❌ Pérdida total del VPS (hardware muere, IONOS cae)
- ❌ Ransomware con root (puede borrar `/root/backups/`)

Para cubrir esos casos → **Fase 2**: Backblaze B2 EU. Ver `BACKBLAZE_SETUP.md`.

## Qué se copia

| Origen | Contenido | Recuperable de otro lado? |
|---|---|---|
| `pg_dump round_config` | Catálogos Round, leads CRM, cuotas, perfiles, configuración | NO (datos únicos) |
| `pg_dump round_facturacion` | Odoo: facturas, partners, asientos, secuencias | NO (datos únicos) |
| `/var/lib/odoo/filestore` | Adjuntos Odoo: PDFs facturas, documentos gasto, ir.attachment | NO (datos únicos) |
| `/opt/round_config_api` | Código Flask + `.env` con secrets | Parcial: código en git, `.env` NO |
| `/etc/nginx/sites-enabled` | Configuración nginx vhosts | Reconstruible pero tedioso |
| `/etc/systemd/system` | Services + timers Round | Reconstruible pero tedioso |
| `/etc/letsencrypt` | Certificados SSL emitidos | Re-emitible con certbot |
| `/var/www/round/index.html`, `/var/www/round/assets/` | Frontend bundle compilado | Reconstruible con `npm run build` |
| `/var/www/round/uploads/` | **PDFs facturas proveedor TPV + imágenes producto** | **NO (datos únicos)** — Sprint 6 audit 2026-06 |

> **Aviso importante** (audit Sprint 6, junio 2026): `/var/www/round/uploads/`
> está dentro del backup `/var/www/round` pero el doc decía "reconstruible
> con npm run build" — solo aplica a `index.html` y `assets/`. Los uploads
> POS (PDFs adjuntos a `pos_factura_proveedor` y imágenes/vídeos de
> `pos_producto.imagen_url|video_url`) NO se reconstruyen. Si excluyes
> `/var/www/round` del backup se pierden TPV adjuntos.

Lo que **no se copia** (excluido en el script):
- `node_modules`, `.git`, `venv`, `__pycache__`, `*/cache/*`, `*/tmp/*`, `/var/log/*` — todo reconstruible o efímero.

## Comandos útiles

### Ver snapshots disponibles
```bash
ssh round-vps "RESTIC_PASSWORD_FILE=/root/.config-restic-passphrase \
  restic -r /root/backups/restic-repo snapshots"
```

### Ver tamaño del repo
```bash
ssh round-vps "RESTIC_PASSWORD_FILE=/root/.config-restic-passphrase \
  restic -r /root/backups/restic-repo stats"
```

### Ejecutar backup manual (fuera del schedule)
```bash
ssh round-vps "systemctl start round-backup.service"
# Ver progreso:
ssh round-vps "journalctl -u round-backup.service -f"
```

### Comprobar el último estado del backup
```bash
ssh round-vps "cat /var/log/round-backup/last-status"
# → "ok (2026-05-24T16:47:46+02:00)"  o  "fail"
```

### Listar próxima ejecución del timer
```bash
ssh round-vps "systemctl list-timers round-backup.timer --no-pager"
```

## Política de retención

Configurada en el script (`/usr/local/bin/round-backup.sh`, sección `restic forget`):

| Tipo | Cuántos | Cubre |
|---|---:|---|
| Diarios | 7 | Última semana, día a día |
| Semanales | 4 | Último mes, semana a semana |
| Mensuales | 12 | Último año, mes a mes |

Total: ~23 snapshots únicos. Restic deduplica entre snapshots, así que el tamaño total es muy inferior a "23 × tamaño_origen".

## Verificación periódica (recomendada)

**Mensual**:
```bash
ssh round-vps "RESTIC_PASSWORD_FILE=/root/.config-restic-passphrase \
  restic -r /root/backups/restic-repo check"
```
Verifica integridad del repo (hashes, índice, packs).

**Trimestral / Semestral** — **DRILL de restore**:
1. Levantar un VPS de prueba (o usar uno local).
2. Restaurar BD + filestore en él siguiendo `RECOVERY.md`.
3. Verificar que la web arranca y los datos están.
4. Apagarlo.

Si nunca probamos el restore, los backups no valen nada el día que los necesitemos.

## Custodia de la passphrase

La passphrase de cifrado (~80 bits, formato `palabra-palabra-…-NN`) vive en
**3 sitios** (regla de redundancia):

1. **`/root/.config-restic-passphrase`** en el VPS (modo 600). El script
   la lee automáticamente.
2. **Papel** en sitio seguro (cajón con llave, caja fuerte). Por si el VPS
   muere y hay que restaurar todo en uno nuevo.
3. (Opcional) En un gestor de contraseñas (Bitwarden / 1Password).

Si pierdes los 3, los backups en restic son INRECUPERABLES (cifrado AES-256, ~2^256 combinaciones).

## Próximos pasos

- **Fase 2**: añadir Backblaze B2 EU. Ver `BACKBLAZE_SETUP.md`. Convierte
  el repo restic local en repo "primario + off-site mirror". Protege contra
  pérdida total del VPS y ransomware.

- **Fase 3** (opcional): PITR con WAL archiving a B2. Recuperación a
  cualquier segundo. Requiere pgBackRest configurado. Solo si los 24h del
  pg_dump nocturno se quedan cortos.

- **Healthcheck activo**: integrar `healthchecks.io` (gratis hasta 20
  checks). Si el script no envía ping en 26h, te llega email automático.
  La URL se guarda en `/root/.config-healthcheck-url`.
