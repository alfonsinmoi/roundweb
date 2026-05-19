# Manual Manager · 35 de 38 · Configuración — Notificaciones (OneSignal)

## Cómo llegar

Configuración → tab **🔔 Notificaciones**.

> 📷 **Captura: `35_notif_config.png`** — config OneSignal.

## Qué muestra

Configuración del proveedor de push **OneSignal** integrado con la app
**mynoofit**.

### Credenciales

- **App ID** (OneSignal) — `15462ceb-3d30-492d-9789-215a63c91818`
- **REST API Key** — clave master (oculto, solo últimos 4 dígitos)
- **IP Allowed** (recomendado, opcional)

> 📷 **Captura: `35_notif_credenciales.png`** — formulario de
> credenciales OneSignal.

### Mapeo cliente → device

mynoofit identifica al cliente con `OneSignal.login(idCliente)`. Aquí
ves el estado:

| Cliente | OneSignal external ID | Subscripto | Última conexión |
|---|---|---|---|
| Carlos Alcalde | 1817155 | ✓ push | hace 2 min |
| Barbi Yuyu | 1817156 | ✗ no | nunca |

### Secciones / Tipos de notificación

Tabla con los tipos de notificación que el manager puede emitir y que
mynoofit debe saber clasificar:

| Tipo | Sección destino app | Trigger |
|---|---|---|
| `cobro_pendiente` | Cobros | Recibo emitido |
| `cobro_devuelto` | Cobros | SEPA devuelta |
| `enlace_pago` | Cobros | Manager genera link |
| `clase_recordatorio` | Clases | Cron 1h antes |
| `clase_cancelada` | Clases | Trainer cancela |
| `centro_aviso` | Centro | Manager comunica al centro |
| `noticia` | Noticias | Manager publica genérico |
| `slot_reservado_lead` | Centro | Lead reserva prueba |
| `devolucion` | Cobros | Devolución bancaria |

## Probar envío

Botón **🧪 Enviar push de prueba** → escribe player ID + texto y dispara
hacia un dispositivo concreto.

## Tips

- mynoofit **debe llamar** `OneSignal.login(idCliente)` al hacer
  login en la app, si no, no recibirá pushes individuales.
- El **App ID** es público; la **REST API Key** es secreta, NUNCA la
  expongas en frontend.
- Si una notificación falla con "All included players are not
  subscribed", el cliente no ha logueado aún en mynoofit con su id.
