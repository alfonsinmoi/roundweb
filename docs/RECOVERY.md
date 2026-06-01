# Round — Runbook de recuperación de backups

> **Antes de tocar nada**: lee el escenario que tienes en `ESCENARIO 1`, `2` o `3`
> y sigue los pasos en orden. Si dudas, pregunta antes de ejecutar.

## Pre-requisitos comunes

- Acceso SSH al VPS (`ssh round-vps`).
- Passphrase de restic. Vive en:
  - `/root/.config-restic-passphrase` (en el VPS)
  - Papel en sitio seguro (custodia tuya)
- Conocer el snapshot a restaurar. Listarlos:
  ```bash
  ssh round-vps "RESTIC_PASSWORD_FILE=/root/.config-restic-passphrase \
    restic -r /root/backups/restic-repo snapshots"
  ```

## ESCENARIO 1 — He borrado/corrompido una tabla

> Ejemplo: ejecuté `DELETE FROM cliente_categoria` sin WHERE y vacié la
> tabla. Hace 3 h del último pg_dump.

**Plan**: extraer SOLO esa tabla del último pg_dump y reinsertarla. No tocamos
las demás (que están bien y tienen cambios de hoy).

1. **Identifica el dump más reciente**:
   ```bash
   ssh round-vps "ls -lah /root/backups/postgres/round_config_*.sql.gz | tail -5"
   ```

2. **Extrae solo la tabla a un fichero temporal**:
   ```bash
   ssh round-vps "zcat /root/backups/postgres/round_config_FECHA.sql.gz \
     | awk '/^-- Data for Name: cliente_categoria/,/^-- Data for Name:/' \
     > /tmp/cliente_categoria_restore.sql"
   ```

3. **(Opcional pero MUY recomendado)** Inspecciona el contenido:
   ```bash
   ssh round-vps "head -30 /tmp/cliente_categoria_restore.sql"
   ```

4. **Restaura la tabla** (asume que está vacía o las filas conflictivas se
   deben sobreescribir):
   ```bash
   ssh round-vps "sudo -u postgres psql -d round_config -c 'TRUNCATE cliente_categoria;'"
   ssh round-vps "sudo -u postgres psql -d round_config -f /tmp/cliente_categoria_restore.sql"
   ```

5. **Verifica row count**:
   ```bash
   ssh round-vps "sudo -u postgres psql -d round_config -c 'SELECT COUNT(*) FROM cliente_categoria;'"
   ```

## ESCENARIO 2 — Necesito restaurar TODA la BD a un snapshot anterior

> Ejemplo: un cron mal escrito ha tocado 1000 filas en `lead_asignacion`
> y no sé exactamente cuáles. Quiero volver al estado de anoche.

⚠️ Esto **destruye** los cambios entre el snapshot y ahora. Confirma con
el equipo antes.

1. **Para el servicio** para que nadie escriba mientras restauramos:
   ```bash
   ssh round-vps "systemctl stop round_config_api"
   ```

2. **Lista pg_dumps disponibles**:
   ```bash
   ssh round-vps "ls -lah /root/backups/postgres/round_config_*.sql.gz"
   ```

3. **Restaura** (el script de dump usa `--clean --if-exists`, así que esto
   borra y recrea todas las tablas):
   ```bash
   ssh round-vps "zcat /root/backups/postgres/round_config_FECHA.sql.gz \
     | sudo -u postgres psql -d round_config"
   ```

4. **Arranca el servicio**:
   ```bash
   ssh round-vps "systemctl start round_config_api && sleep 3 \
     && systemctl is-active round_config_api"
   ```

5. **Smoke test**:
   ```bash
   curl -s "https://noofit.wiemspro.com/api/crm/slots-disponibles?centro=malagacentro" \
     | head -c 200
   ```

Para `round_facturacion` (Odoo) lo mismo, con `systemctl stop odoo17`.

## ESCENARIO 3 — Pérdida total del VPS (servidor nuevo)

> Caso: el VPS murió. Hay un servidor nuevo (IP nueva, otra máquina)
> con Ubuntu 24.04 limpio.

⚠️ **Solo es viable si los backups ESTÁN OFF-SITE** (Fase 2 con B2). Con
solo backups locales, si el VPS muere los pierdes con él. Por eso urge
configurar B2 (ver `BACKBLAZE_SETUP.md`).

Asumiendo Fase 2 activa:

1. **Provisiona Ubuntu 24.04** + instala dependencias:
   ```bash
   apt update && apt install -y postgresql-16 nginx certbot python3-certbot-nginx \
     python3-venv restic curl
   ```

2. **Recupera el repo restic desde B2**:
   ```bash
   export B2_ACCOUNT_ID=…             # de tu password manager
   export B2_ACCOUNT_KEY=…
   export RESTIC_REPOSITORY=b2:round-backup:/restic
   export RESTIC_PASSWORD=…           # de tu papel/gestor
   restic snapshots
   ```

3. **Restaura todos los archivos**:
   ```bash
   restic restore latest --target /
   # Esto sobreescribe /opt/round_config_api, /etc/nginx/..., /etc/letsencrypt/..., etc.
   ```

4. **Restaura las BDs**:
   ```bash
   sudo -u postgres createdb round_config
   sudo -u postgres createdb round_facturacion
   zcat /root/backups/postgres/round_config_LATEST.sql.gz | sudo -u postgres psql -d round_config
   zcat /root/backups/postgres/round_facturacion_LATEST.sql.gz | sudo -u postgres psql -d round_facturacion
   ```

5. **DNS**: apunta `noofit.wiemspro.com` a la nueva IP del VPS.

6. **Renueva certificados** (Let's Encrypt, los del backup pueden estar
   asociados a otra IP — usualmente no importa, pero por seguridad):
   ```bash
   certbot --nginx -d noofit.wiemspro.com
   ```

7. **Arranca todos los servicios**:
   ```bash
   systemctl daemon-reload
   systemctl enable --now postgresql nginx odoo17 round_config_api round-backup.timer
   ```

8. **Verifica**:
   ```bash
   curl -I https://noofit.wiemspro.com/
   curl https://noofit.wiemspro.com/api/manager/odoo-status -H "X-Round-Token: ..." -H "X-Round-Manager-Id: 17675"
   ```

## ESCENARIO 4 — Restaurar un único fichero (un PDF / un .env)

```bash
ssh round-vps "RESTIC_PASSWORD_FILE=/root/.config-restic-passphrase \
  restic -r /root/backups/restic-repo restore latest \
  --include /opt/round_config_api/.env \
  --target /tmp/restaurado"
# El fichero queda en /tmp/restaurado/opt/round_config_api/.env
```

## ESCENARIO 5 — Restaurar una `pos_venta` (TPV) puntual

Una venta del TPV se borró por error (DELETE en psql, no por anulación).
El backup tiene la fila + sus líneas + el movimiento de stock que la
acompañaba.

```bash
ssh round-vps "sudo -u postgres -c '
gunzip -c /root/backups/postgres/round_config-2026-06-01.sql.gz \
  | awk \"/COPY public.pos_venta /,/\\\\\\.$/\" \
  > /tmp/venta_dump.sql
# Buscar la línea de la venta concreta:
grep \"^123\\b\" /tmp/venta_dump.sql > /tmp/venta_123.sql
# Recrear (3 tablas en una transacción):
psql round_config -c \"BEGIN;
  INSERT INTO pos_venta SELECT ... FROM /tmp/venta_123.sql;
  INSERT INTO pos_venta_linea SELECT ... WHERE venta_id=123;
  INSERT INTO pos_stock_movimiento SELECT ... WHERE venta_id=123;
COMMIT;\"
'"
```

**IMPORTANTE — paso 2 (Odoo)**: la venta restaurada tiene un
`odoo_move_id` que puede estar en estado `cancel` (porque al borrar la
venta original alguien lanzó revert) o seguir vivo. Para reconciliar:

```sql
-- En round_config:
UPDATE pos_venta SET odoo_move_id=NULL, sync_status='pending' WHERE id=123;
-- Luego POST /api/pos/ventas/123/sync-odoo
-- La idempotency por ref=numero recuperará el move existente o creará uno
-- nuevo según corresponda.
```

## ESCENARIO 6 — Resync Odoo tras restore parcial POS

Tras restaurar `round_config` a un snapshot anterior, las `pos_venta`
sincronizadas en el intervalo perdido pueden apuntar a moves Odoo que
existen pero ya están cancelados (o ventas que SÍ existen en Odoo y NO
en BD).

**Pasos:**

1. Listar ventas con `odoo_move_id` no nulo cuyo move NO existe / está
   cancel en Odoo:
   ```sql
   -- En round_config:
   SELECT v.id, v.numero, v.odoo_move_id FROM pos_venta v
    WHERE v.sync_status='synced' AND v.odoo_move_id IS NOT NULL;
   -- Para cada una verificar en round_facturacion:
   SELECT id, state FROM account_move WHERE id = <odoo_move_id>;
   ```
2. Marcar como pending las que no encontraron move o están en `cancel`:
   ```sql
   UPDATE pos_venta
      SET odoo_move_id=NULL, odoo_payment_id=NULL,
          sync_status='pending', sync_error=NULL
    WHERE id IN (...);
   ```
3. Disparar resync masivo:
   ```bash
   for vid in 1 2 3; do
     curl -s -X POST "https://noofit.wiemspro.com/api/pos/ventas/$vid/sync-odoo" \
       -H "X-Round-Manager-Id: 17675" -H "X-Round-Token: $TOK"
   done
   ```
   La idempotency search-by-ref reusará moves existentes si los hay, o
   creará nuevos si faltan.

4. Moves Odoo huérfanos (ventas borradas en restore que dejaron move en
   Odoo): listarlos vía:
   ```sql
   -- En round_facturacion:
   SELECT m.id, m.name, m.amount_total, m.ref FROM account_move m
    WHERE m.ref LIKE 'T-%' AND m.company_id=3 AND m.state='posted'
      AND NOT EXISTS (
        SELECT 1 FROM dblink('round_config','SELECT odoo_move_id FROM pos_venta')
                AS t(id bigint) WHERE t.id = m.id);
   ```
   (Si no hay extensión dblink, exportar pos_venta.odoo_move_id a CSV y
   cruzar manualmente.) Reverse manual desde Odoo UI para esos moves.

## ESCENARIO 7 — Restaurar uploads POS (PDFs proveedor + imágenes producto)

`/var/www/round/uploads/pos/<manager>/<uuid>.{pdf,png,...}` se backupea
junto con `/var/www/round`. Restore selectivo:

```bash
ssh round-vps "RESTIC_PASSWORD_FILE=/root/.config-restic-passphrase \
  RESTIC_REPOSITORY=/root/backups/restic \
  restic restore latest \
    --include /var/www/round/uploads/pos \
    --target /tmp/restore-pos"

# Verificar contenido y copiar:
ls -R /tmp/restore-pos/var/www/round/uploads/pos/
rsync -av /tmp/restore-pos/var/www/round/uploads/pos/ \
       /var/www/round/uploads/pos/
chown -R odoo:www-data /var/www/round/uploads/pos
chmod -R 755 /var/www/round/uploads/pos
find /var/www/round/uploads/pos -type f -exec chmod 644 {} \;
```

Verificar que las URLs `/uploads/pos/.../<uuid>.pdf` siguen sirviéndose
por nginx: `curl -I https://noofit.wiemspro.com/uploads/pos/17675/<uuid>.pdf`.

## ESCENARIO 8 — Extraer datos de UN solo manager (multi-tenant)

Caso: separar tenants o exportar un manager a otro VPS. No hay one-liner
porque las claves foráneas cruzan tablas. Receta orientativa:

```bash
ssh round-vps "sudo -u postgres pg_dump round_config --data-only \
  --table=pos_categoria --table=pos_producto --table=pos_descuento \
  --table=pos_stock_movimiento --table=pos_venta --table=pos_venta_linea \
  --table=pos_cierre_caja --table=pos_factura_proveedor \
  --table=cuota --table=cuota_cliente --table=descuento --table=descuento_asignacion \
  --table=manager_config --table=centro_contacto --table=lead_asignacion \
  > /tmp/dump_full.sql"
# Filtrar por id_manager con awk/grep (cuidado con claves foráneas):
grep -E '^[0-9]+\s+17675' /tmp/dump_full.sql > /tmp/manager_17675.sql
```

> **Consultar al asesor** antes de ejecutar — algunas tablas no llevan
> `id_manager` directo y dependen de joins (e.g. `pos_venta_linea` se
> filtra por `venta_id` ya filtrado). Caso por caso.

## Verificación post-restore

Independientemente del escenario, después de restaurar comprueba:

1. **Servicios activos**:
   ```bash
   ssh round-vps "systemctl is-active round_config_api odoo17 nginx postgresql"
   ```
2. **API responde**:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://noofit.wiemspro.com/
   curl -s "https://noofit.wiemspro.com/api/crm/slots-disponibles?centro=malagacentro" | head -c 200
   ```
3. **Login web** desde el navegador (`https://noofit.wiemspro.com/login`).
4. **Cuotas / facturas Odoo** en `/contabilidad` y `/cuotas-clientes`.

## Comandos de emergencia (cuando algo va mal durante un restore)

| Síntoma | Comando diagnóstico |
|---|---|
| Backend no arranca | `journalctl -u round_config_api -n 50` |
| Postgres no conecta | `sudo -u postgres psql -c '\l'` |
| Permisos raros en filestore | `chown -R odoo:odoo /var/lib/odoo/filestore` |
| Frontend 404 | `ls -la /var/www/round/` (debe tener `index.html`) |
| Certificado SSL caducado | `certbot renew --dry-run; certbot renew` |
