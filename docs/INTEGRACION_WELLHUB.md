# Integración Wellhub (ex-Gympass) ↔ Web

> Estado: **solicitando acceso API** (jun 2026). Solo tenemos login de portal
> (usuario/contraseña), que NO da acceso a la API. La API Key la entrega el
> equipo **Techsales** de Wellhub, no el portal.

## Objetivo
Que cada **check-in de un cliente Wellhub** en un centro Round entre en la web
como **entrada puntual** (Económico → Entradas puntuales, filtrable por origen
`wellhub`), con su unidad/centro y fecha, para cobro/control. Config de las
credenciales en **Configuración → Wellhub**.

## Modelo de integración (según developers.wellhub.com)
- **Access Control API**: el partner (gimnasio) autoriza/valida los accesos
  (check-ins) de usuarios Wellhub en cada **unidad** (centro). Auth por **API
  Key**; cada request lleva el identificador de la **unit** → control segmentado
  por centro. Una sola API Key puede cubrir la red de gimnasios.
- **Check-in Webhook**: Wellhub **empuja** cada check-in al partner (ideal para
  crear la entrada puntual automáticamente). Requiere un **secret key** (de
  Techsales) para verificar la firma del webhook.
- Otras APIs disponibles: Events API, User Registration API, Eligibility API.
- Credenciales inválidas → `401`.

### ⛔ Aislamiento por trainer (OBLIGATORIO)
Igual que el resto de la web: **cada trainer solo ve/gestiona los check-ins de
SU centro**; nunca los de otro trainer del mismo manager. El mecanismo es el
**`unit_id` de Wellhub** (una unidad = un centro = un trainer): todo check-in se
etiqueta con el `id_trainer` que corresponde a su `unit_id`.

➡️ **Plan técnico (cuando lleguen las credenciales):**
1. **Dos tablas** (separa credenciales de la red vs mapeo por centro):
   - `wellhub_config` (PK `id_manager`): `api_key`, `webhook_secret`,
     `entorno` (sandbox/prod), `activo`. Credenciales de **red** (Wellhub emite
     una API Key para toda la red; el `unit_id` discrimina por centro).
   - `wellhub_unit` (`id_manager`, `id_trainer`, `unit_id`): **mapeo
     unidad↔trainer**, `UNIQUE(id_manager, unit_id)`. Es la pieza de
     aislamiento: cada `unit_id` pertenece a UN trainer.
2. Webhook `POST /api/webhooks/wellhub/checkin` (verifica firma con el
   `webhook_secret`): del payload saca el `unit_id` → resuelve `(id_manager,
   id_trainer)` en `wellhub_unit` → crea `entrada_puntual_evento` con
   **`id_trainer` puesto** + `origen='wellhub'`. Si el `unit_id` **no está
   mapeado** → rechazo + log (NUNCA crea una entrada sin trainer).
3. **Listado** (Económico → Entradas puntuales, filtro `wellhub`): scopeado por
   trainer con los helpers existentes (`apply_trainer_filter_*`) — el trainer ve
   solo SUS check-ins; el manager, los de todos sus centros.
4. **Config → Wellhub** (managerOnly + permiso): el manager gestiona la API Key
   de red + da de alta el `unit_id` de **cada** centro/trainer (la fila
   `wellhub_unit`). Un trainer sin `unit_id` no recibe check-ins.
5. (Opcional) Validación en recepción vía Access Control API (QR/token del
   cliente → autorizar), también scopeada al `unit_id` del centro.

> **Nota para la petición a Wellhub:** confirmar si pueden emitir **API Key por
> unidad** (aislamiento aún más fuerte) o si es **una Key de red + `unit_id` por
> request** (su modelo estándar). En ambos casos el aislamiento de datos se
> garantiza con el mapeo `unit_id → id_trainer` de arriba.

## Qué hay que pedir a Wellhub (Techsales / Account Manager)
Contacto: **integrations@gympass.com** o tu **Account Manager** de Wellhub.
Portal de docs: https://developers.wellhub.com (= developers.gympass.com).

1. **API Key de la Access Control API** para nuestra red de centros.
2. **Identificador de unidad (`unit_id`/gymId)** de **cada centro**:
   - Round Málaga Centro
   - Round Añoreta
   - (cualquier otro centro futuro)
3. **Check-in Webhook**: activar el envío de check-ins a nuestra URL +
   **secret key** para verificar la firma. URL destino que les daremos:
   `https://noofit.wiemspro.com/api/webhooks/wellhub/checkin` (la creamos al
   implementar).
4. **Entorno sandbox/test** + credenciales de prueba (para integrar sin tocar
   producción).
5. **Documentación** de auth, formato de payload del webhook y rate limits.
6. Si aplica: **IP allowlist** / requisitos de seguridad.

---

## Email listo para enviar

> **Asunto:** Solicitud de acceso API (Access Control API + Check-in Webhook) — [Nombre del partner / Round]
>
> Hola,
>
> Somos partner de Wellhub (centros **Round Málaga Centro** y **Round Añoreta**)
> y queremos integrar los check-ins de Wellhub con nuestro software de gestión
> para registrar automáticamente cada acceso de un usuario Wellhub.
>
> Solicitamos:
> 1. **API Key de la Access Control API** para nuestra red de centros.
> 2. El **identificador de unidad (unit_id)** de cada uno de nuestros centros
>    (Round Málaga Centro y Round Añoreta).
> 3. Activación del **Check-in Webhook** hacia nuestra URL
>    `https://noofit.wiemspro.com/api/webhooks/wellhub/checkin`, junto con el
>    **secret key** para verificar la firma de los eventos.
> 4. Acceso a **entorno sandbox/test** con credenciales de prueba.
> 5. Documentación técnica (autenticación, payload del webhook, rate limits) y,
>    si aplica, requisitos de IP allowlist.
> 6. Necesitamos **separar los datos por centro**: ¿es posible una **API Key por
>    unidad**, o el modelo es una **Key de red con el `unit_id` en cada request**?
>    (Nos vale cualquiera; el `unit_id` por centro es imprescindible.)
>
> Contacto técnico: c.alcalde@wiemspro.com
>
> Gracias,
> [Nombre]

---

## Fuentes
- Getting Started — Access Control API: https://developers.gympass.com/product/access-control-api/1.0/getting-started
- Endpoints — Access Control API: https://developers.wellhub.com/product/access-control-api/1.0/endpoints
- Check-in Webhook: https://developers.gympass.com/product/access-control-api/1.0/check-in-webhook
- Portal developers: https://developers.wellhub.com/
- Solicitud de API Key: equipo Techsales / Account Manager / integrations@gympass.com

_Última actualización: 2026-06-05._
