# Manual Manager · 34 de 38 · Configuración — Pasarelas de Pago

## Cómo llegar

Configuración → tab **💳 Pasarelas**.

> 📷 **Captura: `34_pasarelas_listado.png`** — credenciales PayComet
> por trainer.

## Qué muestra

Credenciales **PayComet** configuradas por centro:

| Columna | Contenido |
|---|---|
| Trainer | Centro |
| Terminal | ID PayComet |
| API key | (oculto, solo últimos 4 dígitos) |
| Modo | Producción / Sandbox |
| Estado | Activo / Pausado |
| Acciones | Editar · Probar · Borrar |

## Editar pasarela

Modal con:

- **Terminal ID** (PayComet)
- **API Key REST** (lo da PayComet)
- **API Key BACK** (para webhooks)
- **Currency** (EUR)
- **Modo** Producción / Sandbox
- **URL de retorno OK** / **URL de retorno KO**
- **URL de notificación** (webhook)

> 📷 **Captura: `34_pasarela_editar.png`** — modal de credenciales.

## Probar conexión

Botón **🧪 Probar** crea una operación de prueba 0,01€ contra el
terminal. Devuelve OK / error con código.

## Tips

- El **API Key REST** y **BACK** se obtienen desde el panel
  PayComet → Configuración → Integraciones.
- En **Sandbox** puedes probar sin cobrar; usa tarjeta `4111 1111
  1111 1111` con CVV cualquiera.
- Cada centro puede tener **terminal distinto** si quiere conciliar
  cobros por sociedad.
- La URL de webhook tiene que coincidir con tu dominio
  (`https://noofit.wiemspro.com/api/cobros/paycomet-webhook`).
