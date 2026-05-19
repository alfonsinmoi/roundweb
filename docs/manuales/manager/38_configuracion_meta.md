# Manual Manager · 38 de 38 · Configuración — Meta (Instagram + Facebook)

## Cómo llegar

Configuración → tab **📱 Meta**.

> 📷 **Captura: `38_meta_cuentas.png`** — cuentas Meta conectadas por
> trainer.

## Qué muestra

Cuentas **Instagram + Facebook** vinculadas a cada centro para la
agenda social automática.

| Columna | Contenido |
|---|---|
| Trainer | Centro |
| Página Facebook | ID + nombre |
| Cuenta Instagram | ID + handle (@…) |
| Token | Page Access Token (oculto, expiración mostrada) |
| Estado | Verificado / Token caducado |
| Acciones | Editar · Refrescar token · Borrar |

## Conectar nueva cuenta

Botón **"➕ Conectar cuenta"** → flujo OAuth con Meta:

1. Login con Facebook con la cuenta admin de la página
2. Selecciona la página
3. Selecciona la cuenta Instagram vinculada
4. Acepta permisos: `pages_manage_posts`, `pages_read_engagement`,
   `instagram_basic`, `instagram_content_publish`, `pages_show_list`
5. Round guarda el **Page Access Token** (60 días) y refresca
   automáticamente

> 📷 **Captura: `38_meta_oauth.png`** — pantalla de Meta autorizando
> permisos.

## Refrescar token

Botón **🔄 Refrescar** intercambia un token corto por uno largo
(válido 60 días) usando `GET /oauth/access_token?grant_type=fb_exchange_token`.

El sistema **avisa por email** 7 días antes de expirar.

## Tips

- Los permisos requieren **App Review aprobado** en Meta. Sin App
  Review puedes probar sólo con cuentas dev.
- Si el token caduca, los posts programados **fallan**; el sistema
  los marca como "error_token" y avisa por email.
- Cada centro tiene su propia cuenta IG/FB; no hay mezcla.
- Para programar un post nuevo → ver doc 13 (Agenda Social).

---

# Fin del Manual del Manager (38 documentos)

Si encuentras algún apartado sin captura, sigue las instrucciones del
README para sacarla y guardarla en `docs/pantallas/manager/` con el
nombre indicado en cada doc.
