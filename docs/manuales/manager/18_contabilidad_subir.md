# Manual Manager · 18 de 38 · Contabilidad — Subir documento (con IA)

## Abrir el modal

Contabilidad → tab Documentos → **📎 Subir documento**.

> 📷 **Captura: `18_subir_fase1.png`** — modal en fase "Selecciona archivo".

## Flujo en 3 fases

### Fase 1: seleccionar archivo

1. **File picker** — formatos aceptados: `.pdf .jpg .png .xlsx .csv .xml .txt`
2. Muestra el nombre del archivo + tamaño
3. Botón **"Subir y escanear"**

### Fase 2: escaneo IA (15-60 segundos)

Spinner mientras la IA procesa el PDF / imagen.

> 📷 **Captura: `18_subir_fase2.png`** — pantalla de spinner con texto
> "Subiendo y extrayendo datos con IA…".

### Fase 3: revisar y validar

Al completar, el modal muestra el formulario **prefilled con los datos
extraídos por IA**:

- Proveedor + CIF
- Núm factura + fecha
- Categoría sugerida (mapeada del catálogo del manager)
- Base + IVA% + Total + IVA importe
- Concepto

Banner verde/ámbar/rojo arriba con la **% confianza** de la IA.

> 📷 **Captura: `18_subir_review.png`** — formulario rellenado con
> banner de confianza.

## Detección automática

La IA detecta:

- **Subtipo**: `factura` (con CIF receptor) o `ticket` (sin receptor)
- Si **ticket** → autoasigna a "gastos generales" (sin trainer)
- Si **factura** y CIF receptor coincide con un centro tuyo → autoasigna
  a ese trainer
- Si **factura** y CIF NO coincide con ningún centro → marca para **doble
  autorización**

## Doble autorización

Si la IA detecta CIF receptor que no coincide:

> 📷 **Captura: `18_subir_doble_auth.png`** — banner rojo con CIF
> detectado + lista de centros disponibles + checkbox de confirmación.

Banner rojo muestra:

- CIF detectado del receptor
- Lista de centros tuyos con sus CIF
- Checkbox **"Confirmo bajo mi responsabilidad…"** — obligatorio para
  habilitar el botón Validar

## Botones

- **Cancelar** — cierra sin guardar (el archivo se queda como borrador)
- **Guardar como borrador** — actualiza datos pero NO valida (queda en
  estado borrador, sin asiento Odoo)
- **Validar** — pide confirmación explícita y crea `account.move` en Odoo

## Tips

- Si la IA falla (timeout, formato raro), el modal igualmente te deja
  subir y rellenar a mano.
- Re-escaneable: si los datos extraídos están mal, puedes corregir
  manualmente y validar.
- El archivo se guarda en disco VPS bajo `/var/round/contabilidad/<…>/
  <categoría>/<fecha>_archivo.pdf` para trazabilidad.
