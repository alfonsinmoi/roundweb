# Importar clientes desde otros softwares — proceso estandarizado

> Referencia inmutable. Toda importación masiva de clientes (desde GestPlus,
> Excel manual, sistema legacy, etc.) DEBE seguir este proceso completo.
> Si algún paso se salta, hay que justificarlo y documentar la excepción.

## Por qué este documento

Cada vez que se importa hay errores recurrentes: emails malformados, DNIs
inválidos, IBANs sin formato ES, cuotas duplicadas, IDs NoofitPro que no
son los que NoofitPro devuelve, partners Odoo duplicados… Este proceso
captura todos los pitfalls reales encontrados en importaciones previas
(la primera grande: Round Añoreta, junio 2026, 333 clientes).

---

## 1. Pre-requisitos del fichero origen

El cliente debe entregar una **hoja Excel/CSV** con UNA fila por cliente
y estas columnas mínimas (los nombres pueden variar; lo importante es que
existan los datos):

### Obligatorias (rechazar si falta alguna)

| Campo | Por qué | Validación |
|---|---|---|
| Nombre | NoofitPro + Odoo | No vacío |
| Apellidos | NoofitPro + Odoo | No vacío |
| Email | Login portal + recibos | Regex `^[A-Za-z0-9._%+-]+@…$` y rechazar acentos en local-part (ñ, ó, í) — NoofitPro los rechaza |
| DNI/NIE/CIF | Identificación inequívoca, VAT Odoo | Sin validar letra (ver pitfall #3) |
| Móvil | Notificaciones, login emergencia | Solo dígitos preferible |

### Muy recomendadas (no bloquean pero reducen calidad)

| Campo | Para qué |
|---|---|
| Fecha nacimiento | Edad, segmentación, AEPD menor de edad |
| Dirección, CP, Población, Provincia | Facturas (Odoo `street`, `zip`, `city`) |
| IBAN | Remesas SEPA (si forma_pago=B) |
| Titular pago + DNI titular | SEPA con pagador distinto al cliente |
| Forma de pago | "B"=SEPA, "C"=manual, etc. |
| Cuotas activas (códigos) | Asignación inicial |
| Importe mensual | Cuadre con cuota |

### Cómo entregar

- **CSV UTF-8** o **XLSX** (preferible, evita problemas de encoding ñ/á).
- Una hoja por entidad: si hay catálogo de cuotas/descuentos del software
  origen, en hojas separadas para hacer matching.
- Sin filas vacías ni cabeceras dobles.

---

## 2. Análisis de integridad obligatorio (NUNCA saltar)

Antes de tocar ningún sistema externo, ejecutar análisis y reportar al
usuario qué se va a hacer. **Nunca importar a ciegas.**

### 2.1 Validar fila por fila

```python
RE_EMAIL = re.compile(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
RE_IBAN_ES = re.compile(r'^ES\d{22}$')
RE_DNI = re.compile(r'^\d{8}[A-HJ-NP-TV-Z]$', re.IGNORECASE)
RE_NIE = re.compile(r'^[XYZ]\d{7}[A-HJ-NP-TV-Z]$', re.IGNORECASE)
```

Categorizar problemas:

- 🔴 **Bloqueantes** (saltar el cliente):
  - Email vacío o sin `@`
  - Email con acentos en local-part (`rosalinda1982muñiz@…`) — NoofitPro lo rechaza
  - Nombre + apellidos vacíos
- 🟡 **Avisar pero importar**:
  - DNI/NIE letra inválida (Odoo intenta, si falla guarda en comment)
  - DNI tipo CIF (`A63574719`) o pasaporte
  - Móvil no formato ES (<9 dígitos o no empieza por 6/7)
  - IBAN no-ES o con longitud distinta de 24
  - Sin CP / población / domicilio
- ℹ️ **Informativos**:
  - Duplicados de email (mismo `nomail@nomail.es` repetido)
  - Duplicados de DNI (ERROR si los hay)

### 2.2 Cobertura por sistema destino

Calcular % de cobertura de los campos requeridos por cada sistema:

| Sistema | Mínimos |
|---|---|
| **`cliente_cache` Round** | id NoofitPro (asignado al crear), name+surname, email |
| **NoofitPro** (`post_cliente_as_trainer`) | name, surname, email válido, tlf, dni |
| **Odoo `res.partner`** | name combinado, vat (DNI), email; street/zip/city opcionales |

### 2.3 Matching de cuotas

- Cargar catálogo de cuotas del manager/trainer destino (`SELECT codigo FROM cuota WHERE id_manager=X AND scope='trainer' AND id_trainer=Y`).
- Por cada cliente, parsear su lista de cuotas (separador típico `|`).
- Reportar códigos no encontrados → puede requerir crear cuotas nuevas antes del import.
- **Regla de deduplicación**: máximo 1 cuota por categoría (1 RT + 1 MyGym + etc.). Si el origen tiene `RT 2 dias | RT 2 dias`, conservar solo una.

### 2.4 Reportar al usuario y pedir confirmación

Plantilla del reporte:

```
=== DRY-RUN ===
Total filas:     N
A importar:      M       (cobertura crítica >=95%)
Skip por email:  E       (lista detallada)
Ya en cache:     X       (se actualizarán, no duplican)
Con cuotas:      C
Sin cuotas:      C2

Combinaciones de cuotas:
  K× cuota_A
  K× cuota_B
  K× cuota_A + cuota_B

Clientes saltados:
  Cod ... | DNI ... | ...
```

**Esperar OK explícito antes de continuar.**

---

## 3. Pitfalls conocidos (errores reales que ya cometimos)

### 🐛 Pitfall #1 — NoofitPro `clientePlusv2` devuelve el id incorrecto

**Síntoma:** llamas a `post_cliente_as_trainer([cliente])` y la respuesta
contiene `clientes: [{id: 1821059, …}]` siempre **el mismo id** para
cualquier cliente que crees. Es el id del primer cliente del trainer, no
del recién creado.

**Solución:** tras crear, **re-listar** con `getClienteSimple` y buscar por
DNI:

```python
def get_clientes_as_trainer(email, pwd):
    tok, mgr = _login_as(email, pwd)
    r = _request_as(tok, mgr, 'GET', '/api/dispositivos/getClienteSimple')
    r.raise_for_status()
    return (r.json() or {}).get('clientes') or []

# Crear
post_cliente_as_trainer([payload], email_trainer, pwd_trainer, send_welcome=False)
# IGNORAR el id de la respuesta — está roto
# Buscar por DNI en la lista actualizada
nf_clientes = get_clientes_as_trainer(email_trainer, pwd_trainer)
match = next((c for c in nf_clientes if (c.get('dni') or '').upper() == dni), None)
if not match:
    raise RuntimeError(f'cliente {dni} no aparece en NF tras crearlo')
id_nf = match['id']
```

**Optimización para batches grandes:** cachear el `nf_by_dni` y refrescarlo
después de cada `post`, no re-listar todo el catálogo cada vez (el endpoint
tarda 1-3 s).

### 🐛 Pitfall #2 — UPSERT en `cliente_cache` aplasta filas si IDs colisionan

`cliente_cache` tiene PK `(id_manager, id)`. Si por error metes el mismo
`id` para varios clientes (consecuencia del pitfall #1 si confías en el
id devuelto por NoofitPro), tu UPSERT con `ON CONFLICT DO UPDATE` machaca
las filas anteriores. Acabas con UNA fila que tiene los datos del último.

**Prevención:**
- Resolver el `id_nf` correctamente (pitfall #1) ANTES del INSERT
- Como safety net adicional: verificar que el id no está ya en cache antes
  de cada INSERT, y si lo está, abortar con error

### 🐛 Pitfall #3 — DNIs/NIE inválidos en Odoo

Odoo valida el VAT con módulo `account_intracom_invoice` y rechaza:
- CIFs interpretados como VAT extranjero (`GR…` → cree IVA griego)
- DNIs con letra incorrecta (datos sucios del origen)
- Pasaportes / documentos no estándar

**Solución ya implementada** en `OdooAlta.upsert_partner`:

```python
try:
    new_id = self._call('res.partner', 'create', vals_to_write)
except Exception as e:
    if write_vals.get('vat') and ('IVA' in str(e) or 'VAT' in str(e).upper()):
        # Guarda el documento en comment y crea sin vat
        doc = write_vals.pop('vat')
        write_vals['comment'] = f'Documento (no validado como IVA): {doc}'
        new_id = self._call('res.partner', 'create', write_vals)
```

Comportamiento: el partner se crea SIN VAT pero queda anotado en el comentario.

### 🐛 Pitfall #4 — Emails con acentos en el local-part

NoofitPro y muchos proveedores de email rechazan `nombre.ñ@dominio` o
`apellidoé@dominio.es`. El estándar RFC los permite pero la realidad
operativa no.

**Filtrar antes del import:**

```python
RE_EMAIL = re.compile(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
```

Esta regex rechaza acentos. Los clientes con email así se saltan y se
reportan para que el operador los arregle manualmente.

### 🐛 Pitfall #5 — Cuotas duplicadas en el origen

GestPlus y otros sistemas exportan cada periodicidad activa como fila
separada, así que un cliente con "RT 2 días" cobrado mensual + otro
recibo histórico activo puede aparecer como `RT 2 dias | RT 2 dias`.
También combos como `MYGYM | MYGYM` por arrastre de datos.

**Regla:** deduplicar por **categoría** (RT vs MyGym vs R4W vs AC),
quedándose con la primera aparición:

```python
def normalizar_cuotas(raw):
    items = [x.strip() for x in (raw or '').split('|')]
    out, tipos = [], set()
    for item in items:
        base = re.split(r'\s*\(', item)[0].strip()  # quita "(s=0.85)"
        if not base or base.upper() == 'SIN MATCH': continue
        tipo = 'RT' if 'RT' in base.upper() else (
               'MG' if 'MYGYM' in base.upper() else
               'R4W' if 'R4W' in base.upper() else '?')
        if tipo in tipos: continue
        # ... buscar match en catálogo y añadir
        tipos.add(tipo)
        out.append(...)
    return out
```

### 🐛 Pitfall #6 — IBAN sin formato (espacios, lowercase, longitud rara)

GestPlus a veces exporta IBAN con espacios cada 4 caracteres
(`ES65 0081 0548 9200 0184 1490`). Normalizar antes de validar:

```python
iban_clean = (iban or '').replace(' ', '').upper()
if not RE_IBAN_ES.match(iban_clean):
    # No-ES o longitud distinta → guardar tal cual en raw_data, no en Odoo bank
```

### 🐛 Pitfall #7 — Encoding del CSV

Google Sheets exporta CSV en UTF-8 pero con doble codificación de los
acentos si la hoja se editó alguna vez en Excel (`AÑORETA` → `AÃORETA`).
La forma segura: **descargar como XLSX**, no como CSV.

```bash
# CSV (frágil con acentos)
curl "https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<GID>"
# XLSX (siempre correcto)
curl "https://docs.google.com/spreadsheets/d/<ID>/export?format=xlsx"
```

### 🐛 Pitfall #8 — Partners Odoo duplicados

Si una primera tirada del import asigna mal el `id_noofit` (pitfall #1),
en Odoo quedan partners con `id_noofit` repetido. En la re-tirada
correcta, `upsert_partner` busca:

1. Por `id_noofit` → no encuentra el nuevo (porque era erróneo)
2. Por `vat` (DNI) → encuentra el partner viejo → lo actualiza con el id
   correcto

Resultado: los partners viejos quedan **huérfanos** con un `id_noofit`
genérico que no corresponde a ningún cliente NoofitPro.

**Limpieza post-import:**

```sql
-- Detectar partners con id_noofit duplicado (señal de error de la primera tirada)
SELECT id_noofit, COUNT(*) FROM res.partner
 WHERE company_id IN (...) AND id_noofit IS NOT NULL
 GROUP BY id_noofit HAVING COUNT(*) > 1;
```

Los duplicados se archivan o se borran si no tienen facturas.

### 🐛 Pitfall #9 — Forma de pago y subscriptions

**NO crear `round.subscription` en Odoo durante el import masivo**. El
flujo `crear_subscription` requiere periodicidad, forma de pago Odoo,
analytic… mucha lógica que puede romper. Guardar las cuotas en
`cliente_cache.raw_data` y dejar que el operador haga la activación
formal después con el endpoint `/api/cuotas/alta-cliente` o el modal
"Alta ERP" del frontend (1 click por cliente).

### 🐛 Pitfall #10 — Credenciales NoofitPro del trainer correcto

Para que el cliente quede en NoofitPro **dentro del espacio del trainer**
(no del manager raíz), hay que loguearse con la cuenta NoofitPro de ese
trainer concreto:

```python
from app.noofit_client import get_trainer_creds, post_cliente_as_trainer

email, pwd = get_trainer_creds(id_manager, id_trainer)
if not email: raise SystemExit('sin credenciales para trainer')
post_cliente_as_trainer([payload], email, pwd, send_welcome=False)
```

Si usas `post_cliente` (sin `_as_trainer`), el cliente acaba en la cuenta
**manager raíz** (`NOOFIT_EMAIL` del `.env`), no en el trainer. Es muy
difícil de corregir a posteriori — NoofitPro no expone API para "mover de
trainer".

---

## 4. Receta paso a paso

### Fase 1: preparación (sin tocar nada)

1. **Recibir hoja origen** del cliente (XLSX preferido).
2. **Subir al VPS**: `scp hoja.xlsx round-vps:/tmp/import.xlsx`.
3. **Análisis de integridad** (script tipo `analyze_clientes.py`):
   - Cobertura por campo
   - Validar emails, DNIs, IBANs
   - Detectar duplicados
   - Matching de cuotas con catálogo destino
4. **Reportar al usuario** y obtener OK explícito.

### Fase 2: verificación de pre-requisitos

5. **Catálogo de cuotas existe**: el manager/trainer destino debe tener
   en `cuota` los códigos que vienen en la hoja. Si no, crearlos antes
   (`scope='trainer'`).
6. **Credenciales NoofitPro del trainer**: verificar que
   `trainer_noofit_creds(id_manager, id_trainer)` tiene una fila con
   `activo=TRUE`. Si no, registrarlas primero.
7. **Manager con módulos activados**: si vas a tocar Odoo, el manager
   debe tener `odoo_company_id` válido y `odoo_cuotas_enabled=TRUE`.
8. **Backup BD**:
   ```bash
   ssh round-vps "sudo -u postgres pg_dump round_config -t cliente_cache -t cuota -t descuento > /root/backup_pre_import_$(date +%F).sql"
   ```

### Fase 3: dry-run

9. Ejecutar el script con `LIMIT=0` o flag `--dry-run`. Verifica:
   - Catálogo de cuotas carga bien
   - Credenciales NF responden
   - Listado actual NF se obtiene
   - Lógica de normalización de cuotas devuelve lo esperado
10. **No imprime hacia NoofitPro/Odoo todavía**, solo lo que haría.

### Fase 4: prueba real con 5 clientes

11. Ejecutar con `LIMIT=5` o equivalente.
12. Comprobar en BD:
    ```sql
    SELECT id, name, raw_data->>'dni' FROM cliente_cache
    WHERE id_manager='X' ORDER BY synced_at DESC LIMIT 10;
    ```
13. Comprobar en NoofitPro (vía API o web): los 5 deben aparecer con
    sus DNIs correctos.
14. Comprobar en Odoo: 5 nuevos `res.partner` con id_noofit, vat, email.
15. Si algún paso falla, **parar** y diagnosticar antes de seguir.

### Fase 5: tirada completa

16. Lanzar en background con log a archivo:
    ```bash
    ssh round-vps "cd /opt/round_config_api && \
      sudo -u odoo bash -c 'cd /opt/round_config_api && set -a && \
      source .env && set +a && exec venv/bin/python import_X.py' \
      > /tmp/import_full.log 2>&1 &"
    ```
17. Monitorear con `tail -f /tmp/import_full.log`.
18. Esperar el `=== RESULTADO ===` final.

### Fase 6: verificación y limpieza

19. Contar lo importado:
    ```sql
    SELECT COUNT(*) FROM cliente_cache WHERE id_manager='X';
    ```
20. Comparar con NoofitPro:
    ```python
    cs = get_clientes_as_trainer(email, pwd)
    ```
    El número debe coincidir.
21. **Limpieza de duplicados huérfanos** (si hubo errores previos):
    - cliente_cache: borrar filas con `id` que no exista en NoofitPro
    - Odoo: borrar partners con `id_noofit` duplicado y sin facturas
22. **Borrar clientes de test** (tipo `99999999R` o `test@local`).

### Fase 7: cierre

23. Reportar al usuario:
    - Total importados / saltados / errores
    - Lista de saltados con motivo
    - Cuotas asignadas (en raw_data)
    - Siguiente paso: activar Alta ERP por cada cliente cuando confirme.
24. Guardar el script de import en `docs/imports/<fecha>_<centro>.py`
    (no en producción) para auditoría.

---

## 5. Plantilla de script

Ubicación: `docs/imports/template_import_clientes.py`. Adaptarla a cada
import cambiando solo:

- `MGR`, `TRAINER` (identidad destino)
- `XLSX` (ruta del fichero)
- Mapeo de columnas si los nombres difieren
- Lógica `normalizar_cuotas` si el formato del origen varía

El script de Round Añoreta (junio 2026) sirve de plantilla validada en
producción.

---

## 6. Qué NO se hace en el import masivo

- ❌ **No se crean subscriptions Odoo** — el flujo es muy específico
  (periodicidad, forma de pago, recibo de alta opcional, descuentos…).
  Se hace 1-a-1 después con Alta ERP.
- ❌ **No se generan recibos** — depende del calendario de emisión del
  manager.
- ❌ **No se asignan descuentos** — los descuentos van con la
  subscription en Odoo. Se aplican en el flujo Alta ERP.
- ❌ **No se envían emails de bienvenida** (`send_welcome=False`). El
  cliente ya estaba en otro sistema, no es nuevo en términos prácticos.
- ❌ **No se borran clientes existentes** en el destino. El import es
  ADITIVO (UPSERT). Si hay que limpiar el destino antes, eso es paso
  manual.

---

## 7. Métricas de éxito

Un import se considera exitoso si:

- ✅ ≥ 95% de clientes con email válido se crean en NoofitPro
- ✅ 100% de los creados en NF aparecen en `cliente_cache`
- ✅ ≥ 90% se crean también como `res.partner` en Odoo (el resto cae al
  fallback "sin VAT" — aceptable)
- ✅ 0 partners Odoo con `id_noofit` duplicado tras la limpieza
- ✅ Los clientes saltados por email inválido están listados y
  documentados para que el operador los arregle

---

## 8. Caso real documentado: Round Añoreta — junio 2026

- **Origen**: GestPlus (export a Google Sheets)
- **Total**: 333 clientes (hoja "Clientes alta")
- **Saltados**: 5 por email inválido (acentos en local-part)
- **Importados**: 328 (321 con al menos 1 cuota)
- **Combinaciones de cuotas**: 215× "RT 2 dias", 56× "I MYGYM",
  50× "RT 2 dias + I MYGYM"
- **Errores conocidos durante el proceso**:
  - Pitfall #1 (id NoofitPro incorrecto) — detectado tras primeros 5
  - Limpieza: 5 partners Odoo huérfanos id_noofit=1821059
- **Script** usado: ver `docs/imports/2026-06-01_anyoreta.py`
