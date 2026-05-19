# Manual Trainer · 10 de 12 · Notificar a un Cliente

## Cómo llegar

Tres entradas:

1. Clientes → ficha cliente → botón **📩 Notificar**
2. Clientes → tabla → seleccionar varios → **📩 Notificar selección**
3. Informe → **Análisis patrones** → tarjeta cluster → **Notificar al
   cluster**

> 📷 **Captura: `10_notif_modal_trainer.png`** — modal con cliente
> prefilteado.

## Modal de envío

### Selección destinatarios

- **Cliente único**: si entras desde la ficha
- **Multi-cliente**: chips con cada cliente seleccionado, puedes
  añadir más buscando en el dropdown
- **Toggle "Incluir inactivos"**: por defecto OFF

> 📷 **Captura: `10_notif_chips.png`** — chips con varios clientes
> seleccionados.

### Contenido

- **Sección destino**: Cobros / Clases / Centro / Noticias
- **Tipo**: según sección (ver doc 12 del manager)
- **Título** (corto, va al subject del push)
- **Cuerpo** (mensaje principal)
- **CTA opcional**: link de acción dentro de la app
- **Plantilla** (opcional): selector con plantillas predefinidas

### Programación

- **Enviar ahora** (default ✓)
- O programar para fecha + hora concretas

## Qué ocurre al enviar

1. Round llama a OneSignal REST API v1 con `external_user_ids` =
   IDs NoofitPro de los clientes
2. mynoofit (la app) recibe el push y lo clasifica en la sección
   indicada
3. El sistema registra **estado leído / no leído** por cliente

## Lo que NO puedes hacer

- Enviar a clientes de **otros centros** del manager
- Enviar broadcast a "Todos los activos del manager" (eso lo hace
  el Manager)

## Tips

- Para que un cliente **reciba** el push, mynoofit debe haber hecho
  `OneSignal.login(idCliente)`. Si dice "no le llegó", confirma que
  ha entrado al menos una vez en mynoofit.
- En envío multi-cliente, en la pantalla de **Notificaciones del
  manager** puedes ver la lista de destinatarios y quién lo ha leído.
