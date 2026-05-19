# Manual Manager · 33 de 38 · Configuración — Email

## Cómo llegar

Configuración → tab **✉ Email**.

> 📷 **Captura: `33_email_proveedores.png`** — lista de proveedores
> configurados.

## Qué muestra

Dos sub-pestañas:

### Proveedores

Configuración del proveedor SMTP / API que envía los emails:

| Columna | Contenido |
|---|---|
| Trainer | Centro al que aplica (o "Manager" para global) |
| Tipo | Resend / Postmark / SMTP / Gmail |
| From email | Remitente visible |
| From name | Nombre visible |
| Estado | Verificado / Pendiente DNS / Error |
| Acciones | Editar · Probar · Borrar |

**Tipos soportados**:

- **Resend** — API key + dominio verificado (recomendado)
- **Postmark** — server token + signature
- **SMTP** — host + puerto + user + password (TLS/STARTTLS)
- **Gmail** — OAuth (deprecated, no usar)

> 📷 **Captura: `33_email_editar.png`** — modal con campos del
> proveedor.

### Plantillas

Plantillas reutilizables con variables `{{var}}`:

| Evento | Cuándo se dispara |
|---|---|
| `slot_reservado_lead` | Lead reserva prueba gratuita |
| `slot_confirmado_lead` | Lead confirma reserva |
| `slot_recordatorio_lead` | 24h antes de la prueba |
| `recibo_emitido` | Cuota mensual emitida |
| `recibo_devuelto` | SEPA devuelta |
| `enlace_pago` | Generaste link PayComet |
| `cliente_alta` | Alta de nuevo cliente confirmada |

Editor con **vista previa** (HTML + texto plano) y test de envío.

> 📷 **Captura: `33_email_plantilla_editor.png`** — editor de plantilla
> con preview a la derecha.

## Variables disponibles por evento

Cada evento tiene su set: `{{cliente.nombre}}`, `{{slot.fecha}}`,
`{{recibo.importe}}`, `{{centro.nombre}}`, `{{cta_link}}`…

## Tips

- Verifica el **dominio** en Resend antes de enviar (DKIM + SPF), o los
  emails irán a SPAM.
- El **From name** se ve más que el subject; ponlo claro
  ("ROUND Málaga" mejor que "noreply").
- Cada centro puede tener su propio proveedor; útil si cada centro
  factura como sociedad distinta.
