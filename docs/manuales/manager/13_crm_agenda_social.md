# Manual Manager · 13 de 38 · CRM · Agenda Social

Programa publicaciones en **Instagram** y **Facebook** desde Round.

## Cómo llegar

Menú → **CRM ▾ → Agenda Social**.

> 📷 **Captura: `13_agenda_social.png`** — pantalla principal con
> calendario y posts programados.

## Requisito previo

Tienes que haber configurado al menos una **cuenta Meta** en
Configuración → Cuentas Meta (doc 38). Necesitas:

- App Meta aprobada por Meta (App Review)
- Page Access Token de larga duración (60 días)
- Cuenta de Instagram Business vinculada a la página Facebook

## Qué muestra

- **Calendario** con los posts programados
- **Lista de posts** pendientes y publicados
- Filtros por cuenta + tipo (foto, vídeo, carrusel)

## Crear post

1. Botón "+ Nuevo post"
2. Elige cuenta (Instagram, Facebook o ambas)
3. Sube imagen / vídeo
4. Texto + hashtags
5. Fecha+hora de publicación (o "Publicar ahora")
6. Guardar

## Cómo publica

El cron `round_social_publish.timer` corre cada 5 minutos. Cuando llega
la hora programada, llama a Meta Graph API y publica.

Si falla (token caducado, foto inválida), el post queda como "fallido"
y puedes reintentarlo.

## Tips

- El Access Token de Meta caduca cada 60 días — tienes que renovarlo en
  Configuración → Cuentas Meta antes de que caduque.
- Para Instagram solo se pueden subir **fotos / vídeos**, no enlaces.
- Para Facebook puedes hacer todo: foto, vídeo, link, texto solo.
