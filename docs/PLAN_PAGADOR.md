# Plan — Figura "Pagador" (instrumento de cobro compartido)

> Estado: **F1 (BD+backend) y F2 (frontend) HECHAS y desplegadas (jun 2026).** F3 (emisión +
> Odoo) y F4 (pulido) pendientes. Estudio previo en el chat de auditoría.
>
> **⚠️ INFRA (recovery, NO en git):** la ruta `/api/pagadores` necesita su propio bloque
> `location ^~ /api/pagadores { proxy_pass http://127.0.0.1:8095/api/pagadores; ... }` en el
> vhost nginx `noofit.wiemspro.com` (el vhost no tiene catch-all `/api/`; sin el bloque, la ruta
> cae al SPA y el frontend recibe HTML). Añadido el 2026-06-15. Si se reconstruye el VPS,
> reaplicar (igual que el resto de prefijos `/api/*`).

## 1. Concepto (acordado)

Un **pagador** es una figura que **cede su instrumento de cobro** para que se carguen en su
cuenta los recibos de uno o varios clientes (p. ej. un padre que paga a sus hijos).

- **Cede IBAN** si la forma de pago es **SEPA**, o **nº de tarjeta (token)** si es **tokenizada**.
- **La factura/recibo sigue siendo del CLIENTE** (su 430XXX, su analítica de trainer, su IVA).
  El `account.payment` en Odoo sigue siendo del cliente → conciliación **mismo partner** (limpia).
- **Lo ÚNICO que cambia**: al generar el adeudo, si el cliente tiene pagador activo, se debita el
  **IBAN/mandato (o token) del pagador** en vez del suyo. **No se factura al pagador. Odoo no
  cambia su estructura.**
- "Separados por cliente": **un adeudo por cliente** (cada recibo su línea), todos contra la
  cuenta del pagador. No se fusionan → devoluciones y conciliación siguen por cliente.

## 2. Decisiones cerradas

1. **Alcance: un pagador pertenece a UN trainer.** Solo agrupa clientes de ese trainer.
   (`pagador.id_trainer` obligatorio; el selector de clientes filtra por ese trainer.)
2. **Cliente con pagador sin mandato firmado**: NO se bloquea → **se emite el adeudo CON AVISO**
   (incidencia/aviso). **El trainer decide**.
3. **Devoluciones**: se mantienen **por cliente** (cada adeudo es de un cliente). El matcher de
   devoluciones (auditoría #16) **no cambia**.
4. **Baja de un cliente del pagador**: **vuelve a auto-pago**. Al dar de baja, el sistema
   **avisa qué forma de pago le quedará** (su `forma_pago_cliente` activa, o "sin forma de pago
   configurada" si no tiene).

## 3. Base de datos (round_config) — 2 tablas nuevas (`OWNER TO odoo`)

```
pagador
  id PK, id_manager, id_trainer (NOT NULL),        -- atado a UN trainer (decisión 1)
  nombre, nif,
  forma_pago ('sepa'|'tarjeta_token'),
  iban, iban_titular, bic, mandate_ref,            -- instrumento SEPA (IBAN)
  card_token, card_brand, card_last4,              -- instrumento tarjeta (token)
  odoo_partner_id, odoo_bank_id, odoo_mandate_id,  -- presencia mínima en Odoo (titular del mandato)
  estado ('activo'|'inactivo'),
  created_at/by, updated_at/by

pagador_cliente                                    -- qué clientes paga (histórico alta/baja)
  id PK, id_manager, pagador_id FK,
  cliente_idnoofit,
  estado ('activo'|'baja'), fecha_inicio, fecha_fin, motivo,
  created_at/by, updated_at/by
  UNIQUE parcial (id_manager, cliente_idnoofit) WHERE estado='activo'   -- 1 pagador activo/cliente
```
- IBAN validado con `iban_validator` (espejo de `forma_pago`). Token nunca en claro en logs.
- **Retrocompat**: cliente sin fila activa → auto-pago, como hoy. Cero migración.

## 4. Backend — blueprint `routes/pagadores.py`

| Endpoint | Permiso | Función |
|---|---|---|
| `GET /api/pagadores` | `cuotas_clientes.pagadores.ver` | lista (nombre, NIF, instrumento enmascarado, nº clientes) |
| `POST /api/pagadores` | `…pagadores.editar` | alta pagador (datos + instrumento + trainer) |
| `PATCH /api/pagadores/<id>` | `…pagadores.editar` | **modificar mandato/IBAN/token** (cierra histórico, no pisa) |
| `DELETE /api/pagadores/<id>` | `…pagadores.editar` | inactivar (solo sin clientes activos) |
| `GET /api/pagadores/<id>/clientes` | `…pagadores.ver` | clientes que paga |
| `POST /api/pagadores/<id>/clientes` | `…pagadores.editar` | **alta** cliente(s) al pagador |
| `DELETE /api/pagadores/<id>/clientes/<idnoofit>` | `…pagadores.editar` | **baja** cliente → devuelve la forma de pago que le queda (decisión 4) |

- `@require_permission` + `@require_feature('cuotas')` + `log_action` en toda mutación.
- **Scope**: pagador y selector de clientes filtrados por `id_trainer` (decisión 1) usando
  `cliente_pertenece_a_trainer` / `clientes_id_noofit_del_manager`.
- Al crear/editar el instrumento → sincronizar presencia en Odoo del pagador:
  `res.partner` + `res.partner.bank` (IBAN) + `account.banking.mandate` → guardar
  `odoo_partner_id/bank_id/mandate_id`. (Solo titular del mandato; NO se le factura.)
- Helper central **`instrumento_de_cobro(id_manager, cliente_idnoofit)`** →
  `(forma_pago, mandate_id|card_token, bank_id, origen='pagador'|'cliente', mandato_ok: bool)`.

## 5. Punto de sustitución en la emisión (corazón)

El pain.008 lo genera **`odoo_cuotas.emitir_remesa`** (vía v1). Hoy:
```python
'mandate_id': inv['mandate_id'][0],   # mandato del CLIENTE
'partner_bank_id': acc[0],            # IBAN del CLIENTE
```
Cambio: resolver `instrumento_de_cobro(cliente)`:
```
if instrumento.origen == 'pagador':
    mandate_id      = pagador.odoo_mandate_id
    partner_bank_id = pagador.odoo_bank_id
    if not instrumento.mandato_ok:           # decisión 2
        crear_incidencia_admin('pagador_sin_mandato', severidad='warning', ...)
        # NO se bloquea: se emite igual, el trainer decide
# partner_id de la línea sigue siendo el CLIENTE (factura intacta)
```
- **Tarjeta tokenizada**: mismo helper en el cobro PayComet → usar `card_token` del pagador.
- **v2** (`emision_v2`): el `account.payment` sigue siendo del cliente (no toca IBAN); si en el
  futuro v2 generara fichero, mismo punto.

## 6. Único punto que roza Odoo (no estructural — coordinar con el chat de Odoo)

El pagador debe existir en Odoo como `res.partner` + `res.partner.bank` + `account.banking.mandate`
para ser el **deudor** del pain.008. **NO se le factura.** A validar con el chat de Odoo: que el
módulo SEPA OCA acepte una `account.payment.line` con `partner_id`=cliente y
`mandate_id`/`partner_bank_id`=pagador (deudor ≠ titular factura — legal en SEPA). Si OCA lo
forzara igual, se relaja en el addon o se genera esa línea/fichero del lado noofitweb. **Es el
único riesgo técnico; no cambia la facturación.**

## 7. Frontend — pestaña "Pagadores" en Cuotas clientes

- `CuotasClientes.jsx` → `TABS`: `{ id:'pagadores', label:'Pagadores', comp:PagadoresTab, modes:['*'] }`.
- **`PagadoresTab.jsx`**:
  - Lista de pagadores (instrumento enmascarado `****1234`, nº clientes, estado).
  - **Alta pagador**: modal con datos + instrumento (IBAN validado en cliente / token; selección
    de trainer). Espejo de `validarNifCifNie`.
  - **Detalle**: gestión de clientes → **selector** (buscador, solo clientes del trainer) para
    **alta**; lista con **baja** por cliente (al pulsar baja, muestra "forma de pago que quedará"
    — decisión 4); botón **modificar mandato** (edita IBAN/mandate_ref/token, con histórico).
  - `useCan('cuotas_clientes.pagadores.*')` en los botones.
- Ficha de cliente (fase 4): badge "Paga: <pagador>".

## 8. Permisos (`src/config/permissions.js`)
Bajo `cuotas_clientes`: `pagadores: { ver, editar (✗) }`. Backend con `@require_permission`.

## 9. Fases
- **F1** — BD (2 tablas) + backend CRUD + permisos + audit + helper `instrumento_de_cobro`.
- **F2** — Frontend pestaña Pagadores (alta + selector clientes + alta/baja con aviso + modificar mandato).
- **F3** — Sustitución del instrumento en `emitir_remesa` + aviso sin-mandato (decisión 2) +
  presencia del pagador en Odoo (coordinar §6 con chat Odoo).
- **F4** — Pulido: badge en ficha cliente, histórico de mandato, cobro tokenizado del pagador.

## 10. Casos borde cubiertos
- Cliente sin pagador → auto-pago (intacto).
- Pagador sin mandato → emite con aviso (decisión 2).
- Baja cliente → vuelve a auto-pago, avisa forma de pago resultante (decisión 4).
- Devolución → por cliente (decisión 3).
- Aislamiento trainer → pagador atado a un trainer (decisión 1).
