# Setup Backblaze B2 (Fase 2 backups off-site)

> Tiempo estimado: 30 min. Coste estimado: < 2 €/mes para Round.
> Cuando hayas completado los pasos 1-4 (web), avísame por chat y monto el
> resto (pasos 5-7) en 10 min.

## Por qué B2

- **EU-Central (Amsterdam)** → cumple GDPR sin papeleo adicional.
- **Object Lock** → un atacante con root en el VPS **no puede borrar** las
  copias anteriores (las claves del VPS son write-only).
- **S3-compatible** → funciona con restic, pgBackRest, rclone, etc.
- **Barato** → 10 GB primeros gratis, después ~6 $/TB/mes. Round ocupará
  bastante menos.

## Lo que tienes que hacer tú (en la web de Backblaze)

### 1. Crear cuenta

1. Ve a https://www.backblaze.com/cloud-storage
2. Sign Up → email + password fuerte (apúntalo en tu gestor de contraseñas).
3. Verifica el email.
4. En el panel, eligh **B2 Cloud Storage**.

### 2. Crear bucket

1. **Buckets** → **Create a Bucket**
2. Nombre: `round-backup` (ha de ser único globalmente, si está tomado prueba
   `round-backup-wiemspro` o similar — apunta el nombre que uses).
3. **Files in Bucket are**: `Private`.
4. **Default Encryption**: `Enabled` (server-side).
5. **Region**: `EU Central (Amsterdam)` 🇪🇺 — ojo de elegir esta, no la US.
6. **Object Lock**: `Enable`.
7. **Default retention**: `Compliance` mode, `30 days`. (Esto es lo que evita
   que un atacante borre snapshots anteriores.)
8. Create Bucket.

### 3. Crear 2 Application Keys

Necesitamos 2 claves separadas:
- Una **write-only** que vivirá en el VPS (si te la roban, el atacante puede
  añadir backups pero NO borrar).
- Una **master** que vivirá solo en tu PC, para emergencias (restore, borrar
  bucket, etc.).

#### Key A — VPS (write-only)

1. **Account → Application Keys** → **Add a New Application Key**.
2. Name: `round-vps-writer`
3. Allow access to: `round-backup` (el bucket, no all)
4. Type of Access: **Write Only**
5. Allow List All Bucket Names: `No`
6. File name prefix: (vacío)
7. Duration: (vacío = no expira)
8. Create.
9. **APÚNTATE** lo que sale (la verás una sola vez):
   - keyID:    `…`
   - applicationKey: `K…`

#### Key B — admin (tu PC)

1. Otra vez **Add a New Application Key**.
2. Name: `round-admin-master`
3. Allow access to: `round-backup`
4. Type of Access: **Read and Write**
5. Crea y **apunta** keyID + applicationKey.
6. **Guarda esta key en Bitwarden o gestor de contraseñas** + copia en papel
   (junto a la passphrase de restic).

### 4. Configurar lifecycle rule en el bucket

1. Entra al bucket `round-backup` → **Lifecycle Settings**.
2. Selecciona **Keep prior versions for 30 days** (o lo que te encaje con tu
   política).
3. Save.

## Lo que haré yo (cuando me pases las credenciales)

Solo tienes que pegarme el `keyID` y `applicationKey` de la **Key A** (la
write-only), y el `endpoint` del bucket (lo ves en el bucket → Bucket Info →
algo como `s3.eu-central-003.backblazeb2.com`).

Yo me encargo de:

5. **Añadir las credenciales a `/root/.config-b2`** en el VPS (modo 600).
6. **Reconfigurar restic** para usar el repo en B2 además del local. Se
   convierte de `repo único` → `repo local + copia automática a B2`.
7. **Adaptar el script** `/usr/local/bin/round-backup.sh` para que tras el
   backup local haga `restic copy` al repo B2.
8. **Ejecutar un backup completo** para subir todo lo que hay actualmente
   (~125 MB, tardará 1-2 min).
9. **Actualizar `docs/BACKUPS.md`** y `docs/RECOVERY.md` con los nuevos
   comandos (incluyendo el `RESTIC_REPOSITORY=b2:...` para restaurar desde B2
   en un servidor nuevo).

## Checklist final (cuando esté todo activo)

- [ ] Cuenta B2 creada
- [ ] Bucket `round-backup` con Object Lock + retención 30 días
- [ ] Key A (writer) generada y comunicada
- [ ] Key B (admin) generada y guardada en gestor de contraseñas + papel
- [ ] Lifecycle rule configurada
- [ ] (Yo) restic configurado en VPS con B2 como repo secundario
- [ ] (Yo) primer backup subido a B2
- [ ] (Yo) verificado que `restic snapshots` desde B2 lista correctamente
- [ ] (Yo) docs actualizadas

## Coste real esperado

Con un repo de ~125 MB de Round (creciendo lentamente) y 23 snapshots
deduplicados, el tamaño total en B2 será del orden de **500 MB – 1 GB** en
6 meses.

Los primeros 10 GB son **gratis**. Probablemente no pagarás nada durante el
primer año. Cuando superes 10 GB (si Odoo crece mucho), pagarás ~0.06 €/mes
por GB adicional.

## Si decides NO seguir con B2

Es válido seguir solo con Fase 1 (local). Pero quedas expuesto a:
- Si el VPS muere → pierdes todo.
- Si te entran con root → pueden borrar `/root/backups/`.

Si vas a operar con datos de clientes pagados (Round Training Center es un
SaaS de gestión real), recomiendo fuertemente activar B2 ANTES de tener un
incidente.
