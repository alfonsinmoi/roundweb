# PayComet — integración Round

## Estado actual

- **Sandbox activo** desde 2026-05.
- Terminal sandbox: **86879** (BANKSTORE TEST, no llama al banco real).
- Dominio configurado: `https://roundtrainingcenter.com/`.
- Límite por operación en sandbox: **250,00 €**.
- Solo admite **pagos seguros** (3DSecure). MIT (Merchant-Initiated
  Transactions) requiere activación manual por PayComet — pendiente para
  producción.

## Acceso al panel PayComet (Lens)

- URL: <https://lens.paycomet.com/>
- Usuario: `carlos_sandbox_yWF63uYa@paycomet.com`
- Contraseña: **NO se guarda en el repo** — está en Bitwarden / gestor
  de contraseñas. Pídela al administrador.

En el panel: `Terminales → Datos del terminal` → ahí están los **datos
de integración** (API Key, Número de terminal, Código de cliente,
Contraseña) que hay que copiar a la BD `round_config` (tabla
`pasarela_credenciales`).

## Decisión arquitectónica: NO usamos suscripciones de PayComet

PayComet ofrece dos formas de cobro recurrente:

1. `execute_purchase` con excepción **MIT** y `TYPE="R"` indicando día
   de finalización + frecuencia.
2. Endpoint `/suscripciones` con fecha inicio, fin y periodicidad.

**Round NO usa ninguna de las dos.** El módulo `round_facturacion` de
Odoo es la fuente de verdad para:

- Generar los recibos según periodicidad (mensual, trimestral, semestral,
  anual).
- Calcular fechas de cobro y aplicar descuentos / modificaciones.
- Disparar el cobro vía nuestro backend Flask cuando llega el día.

Cuando llega el día de cobrar un recibo, Round simplemente llama a
PayComet con un **`execute_purchase` puntual** usando el `tokenUser` y el
`idUser` que guardamos del pago inicial autenticado (3DSecure).

**Ventajas de este diseño:**

- Una sola lógica de cobros (Odoo) — no se duplica entre PayComet y
  nuestro lado.
- Podemos cambiar de pasarela (PayComet → Stripe → Redsys) sin tocar la
  lógica de suscripción.
- Trazabilidad completa: cada recibo Odoo tiene su pago vinculado.

**Implicación operativa:** para cobros recurrentes en producción
necesitamos que PayComet active **MIT** en nuestro TPV (en sandbox no
hace falta porque cada pago es 3DSecure).

## Paso a producción

Cuando se active el TPV real, los **únicos cambios** son sustituir en
la tabla `pasarela_credenciales` (per trainer):

- `api_token` (API Key)
- `terminal` (número de terminal)
- y los códigos derivados (código de cliente, password)

Más:

- Cambiar `sandbox = FALSE` en la fila correspondiente.
- Confirmar con PayComet que **MIT está activado** para suscripciones.

URLs OK / KO / notificación (`PAYCOMET_URL_OK`, `_URL_KO`, `_URL_NOTIF`
en `.env` o las columnas `url_ok / url_ko / url_notif` por trainer)
deben apuntar a `https://noofit.wiemspro.com` o `https://round.noofit.com`.
Hoy están preconfiguradas a:

```
url_ok    = https://noofit.wiemspro.com/cuotas-clientes
url_ko    = https://noofit.wiemspro.com/cuotas-clientes
url_notif = https://noofit.wiemspro.com/api/cuotas/paycomet-callback
```

Si necesitas cambiar el dominio en sandbox (porque el JS no permite el
dominio actual), se solicita por ticket: panel → `Soporte → Notificación
de incidencia`.

## Tarjetas de prueba

Documentadas por PayComet aquí: <https://docs.paycomet.com> (sección
"Tarjetas de Prueba"). Si la respuesta es **error 102** = datos de
tarjeta/mes/año/cvv incorrectos.

## Configurar las credenciales en Round

1. Entrar en el panel Lens y copiar los 4 valores: API Key, Terminal,
   Código de cliente, Contraseña.
2. En la web Round → `Configuración → Pasarelas (PayComet)` (visible
   solo para el manager).
3. Pegar los valores en el formulario del trainer correspondiente
   (Málaga Centro id 17675 / Añoreta id 17674) y guardar.
4. Marcar `sandbox: ON` mientras estemos en BANKSTORE TEST. Cambiar a
   `OFF` el día del paso a producción.

Alternativa rápida vía SQL (sólo para administrador, sustituir XXX):

```sql
INSERT INTO pasarela_credenciales
       (id_manager, id_trainer, proveedor, api_token, terminal, sandbox, active)
VALUES ('17677', '17675', 'paycomet', 'XXX', '86879', TRUE, TRUE)
ON CONFLICT (id_manager, id_trainer, proveedor) DO UPDATE
   SET api_token = EXCLUDED.api_token,
       terminal  = EXCLUDED.terminal,
       sandbox   = EXCLUDED.sandbox,
       active    = EXCLUDED.active;
```

## Endpoints internos involucrados

- `POST /api/cuotas/recibo/<id>/cobrar-link` → genera link hospedado de
  pago (PayComet REST `payments/form`) para el cliente.
- `POST /api/cuotas/paycomet-callback` → webhook server-to-server que
  recibe el resultado del pago y marca el recibo como pagado en Odoo.
- `app/paycomet_client.py` → cliente REST mínimo (PayCometClient).
- `app/routes/pasarelas.py` → CRUD de credenciales por trainer.

## Pendientes

- [ ] Pegar credenciales reales del terminal 86879 en
      `pasarela_credenciales` para trainers Málaga Centro y Añoreta
      (modo sandbox=TRUE).
- [ ] Probar un cobro end-to-end con tarjeta de prueba: alta cliente →
      recibo Odoo → link PayComet → callback → recibo pagado.
- [ ] Activar MIT en el TPV de producción cuando se haga el switch.
