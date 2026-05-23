"""Helper de plantillas de email.

  - render(template_str, variables)        → sustituye {{var}}
  - trigger(evento, id_manager, ctx)       → busca plantillas activas y envía

ctx debe incluir, según el evento:
  lead_name, lead_email, lead_phone, lead_message,
  trainer_name, trainer_phone, trainer_email,
  centro_name, centro_email, centro_slug, centro_ciudad,
  cuota_interes, lead_url, lead_id

Eventos definidos:
  - lead_creado_lead         → al lead recién registrado
  - lead_creado_trainer      → al trainer del centro
  - etapa_contactado_lead    → cuando trainer mueve a "Contactado"
  - etapa_visita_lead        → idem etapa "Visita"
  - etapa_prueba_lead        → idem etapa "Prueba"
  - etapa_alta_lead          → idem etapa "Alta" (won)
  - lead_perdido_lead        → cuando el lead se marca perdido
"""
import re, logging
from .db import get_conn
from .email_sender import enviar as enviar_email

log = logging.getLogger(__name__)

# ── Render de variables ─────────────────────────────────────────────────────
_VAR_RE = re.compile(r'\{\{\s*(\w+)\s*\}\}')


def render(text, variables):
    if not text: return text or ''
    def sub(m):
        k = m.group(1)
        v = variables.get(k, '')
        return '' if v is None else str(v)
    return _VAR_RE.sub(sub, text)


def html_to_text(html):
    """Conversión naive html→texto para body alterno."""
    if not html: return ''
    t = re.sub(r'<br\s*/?>', '\n', html, flags=re.I)
    t = re.sub(r'</p>', '\n\n', t, flags=re.I)
    t = re.sub(r'<[^>]+>', '', t)
    t = re.sub(r'\n{3,}', '\n\n', t)
    return t.strip()


def _resolver_destino(destinatario, ctx):
    """Devuelve el email destino según 'lead' / 'trainer' / 'manager'."""
    if destinatario == 'lead':
        return ctx.get('lead_email') or ''
    if destinatario == 'trainer':
        return ctx.get('centro_email') or ctx.get('trainer_email') or ''
    if destinatario == 'manager':
        return ctx.get('manager_email') or ''
    return ''


def trigger(evento, id_manager, ctx):
    """Busca plantillas activas para (manager, evento) y las envía a sus
    destinatarios respectivos. Devuelve lista de (destinatario, ok)."""
    if not id_manager or not evento:
        return []
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id, evento, destinatario, subject, body_html
                  FROM email_template
                 WHERE id_manager=%s AND evento=%s AND active=TRUE
            """, (str(id_manager), evento))
            templates = cur.fetchall()
    except Exception as e:
        log.warning(f'trigger {evento}: {e}')
        return []

    results = []
    # id_trainer del ctx para que el sender resuelva proveedor por centro
    id_trainer = ctx.get('id_trainer') or ctx.get('centro_id_trainer')
    for tpl in templates:
        dest = _resolver_destino(tpl['destinatario'], ctx)
        if not dest:
            log.info(f'trigger {evento}/{tpl["destinatario"]}: sin destino')
            results.append((tpl['destinatario'], False))
            continue
        subject = render(tpl['subject'], ctx)
        body_html = render(tpl['body_html'], ctx)
        body_text = html_to_text(body_html)
        # Reply-to: si va al lead, ponemos al trainer; si va al trainer, ponemos al lead.
        reply_to = None
        if tpl['destinatario'] == 'lead':
            reply_to = ctx.get('centro_email') or None
        elif tpl['destinatario'] == 'trainer':
            reply_to = ctx.get('lead_email') or None
        ok = enviar_email(dest, subject, body_text, body_html=body_html,
                          reply_to=reply_to, id_manager=id_manager,
                          id_trainer=id_trainer)
        log.info(f'trigger {evento} → {tpl["destinatario"]}({dest}) ok={ok}')
        results.append((tpl['destinatario'], ok))
    return results


# ── Plantillas por defecto (seed inicial al primer arranque) ────────────────
DEFAULT_TEMPLATES = [
    # ── Cuando se crea un lead ──
    {
        'evento': 'lead_creado_lead',
        'destinatario': 'lead',
        'subject': '¡Hola {{lead_name}}! Hemos recibido tu solicitud',
        'body_html': """<p>Hola <b>{{lead_name}}</b>,</p>
<p>Gracias por interesarte en <b>Round Training Center</b>. Te asignamos a
<b>{{centro_name}}</b> y en las próximas 24h te contactará tu trainer
<b>{{trainer_name}}</b> para concertar tu primera visita.</p>
<p>Si quieres adelantar algo, puedes responder directamente a este email
o llamarnos al <a href="tel:{{trainer_phone}}">{{trainer_phone}}</a>.</p>
<p>Un saludo,<br/>Equipo Round</p>"""
    },
    {
        'evento': 'lead_creado_trainer',
        'destinatario': 'trainer',
        'subject': 'Nuevo lead web — {{lead_name}} ({{centro_name}})',
        'body_html': """<p>Hola,</p>
<p>Te ha llegado un nuevo lead a tu centro <b>{{centro_name}}</b>:</p>
<table style="border-collapse:collapse">
  <tr><td><b>Nombre:</b></td><td>{{lead_name}}</td></tr>
  <tr><td><b>Email:</b></td><td><a href="mailto:{{lead_email}}">{{lead_email}}</a></td></tr>
  <tr><td><b>Teléfono:</b></td><td><a href="tel:{{lead_phone}}">{{lead_phone}}</a></td></tr>
  <tr><td><b>Cuota interés:</b></td><td>{{cuota_interes}}</td></tr>
  <tr><td><b>Mensaje:</b></td><td>{{lead_message}}</td></tr>
</table>
<p>Recuerda contactar en las próximas 24h. Puedes ver y gestionar este lead desde
<a href="https://noofit.wiemspro.com/crm">tu panel CRM</a>.</p>
<hr/>
<p style="color:#888;font-size:12px">Round Training Center · Lead #{{lead_id}}</p>"""
    },
    # ── Etapa "Contactado" ──
    {
        'evento': 'etapa_contactado_lead',
        'destinatario': 'lead',
        'subject': '{{lead_name}}, hemos hablado contigo',
        'body_html': """<p>Hola <b>{{lead_name}}</b>,</p>
<p>Acabamos de hablar contigo desde <b>{{centro_name}}</b>. Tal como
comentamos, te dejamos los detalles del próximo paso. Si necesitas
algo, contesta a este email o llámanos.</p>
<p>Un saludo,<br/>{{trainer_name}} · Round</p>"""
    },
    # ── Etapa "Visita" ──
    {
        'evento': 'etapa_visita_lead',
        'destinatario': 'lead',
        'subject': 'Tu visita en {{centro_name}}',
        'body_html': """<p>Hola <b>{{lead_name}}</b>,</p>
<p>Confirmamos tu visita en <b>{{centro_name}}</b>. Te esperamos pronto
para enseñarte las instalaciones y resolver tus dudas.</p>
<p>Si necesitas reagendar, responde a este email o llama al
<a href="tel:{{trainer_phone}}">{{trainer_phone}}</a>.</p>
<p>Hasta pronto,<br/>{{trainer_name}}</p>"""
    },
    # ── Etapa "Prueba" ──
    {
        'evento': 'etapa_prueba_lead',
        'destinatario': 'lead',
        'subject': 'Tu sesión de prueba en Round — {{centro_name}}',
        'body_html': """<p>Hola <b>{{lead_name}}</b>,</p>
<p>Tu sesión de prueba en <b>{{centro_name}}</b> está reservada. Recuerda
traer ropa cómoda y agua. Si quieres, llega 10 minutos antes para que
te enseñemos el centro.</p>
<p>Cualquier duda, respóndenos.</p>
<p>¡Te esperamos!<br/>{{trainer_name}}</p>"""
    },
    # ── Etapa "Alta" ──
    {
        'evento': 'etapa_alta_lead',
        'destinatario': 'lead',
        'subject': '¡Bienvenido a Round, {{lead_name}}! 🎉',
        'body_html': """<p>Hola <b>{{lead_name}}</b>,</p>
<p>¡Enhorabuena! Ya formas parte de la familia <b>Round</b> en
<b>{{centro_name}}</b>. En breve recibirás los datos de acceso a la app
y al panel de cliente.</p>
<p>Si tienes cualquier duda, escríbenos a
<a href="mailto:{{centro_email}}">{{centro_email}}</a>.</p>
<p>¡Nos vemos en el centro!<br/>Equipo Round</p>"""
    },
    # ── Lead perdido ──
    {
        'evento': 'lead_perdido_lead',
        'destinatario': 'lead',
        'subject': '{{lead_name}}, seguimos a tu disposición',
        'body_html': """<p>Hola <b>{{lead_name}}</b>,</p>
<p>Lamentamos no haber podido cerrar tu alta esta vez. Si más adelante
quieres retomar tu plan de entrenamiento, en <b>{{centro_name}}</b>
estamos a tu disposición.</p>
<p>Un saludo,<br/>Equipo Round</p>"""
    },
    # ── Slot reservado (pendiente de confirmación) ──
    {
        'evento': 'slot_reservado_lead',
        'destinatario': 'lead',
        'subject': 'Confirma tu prueba en {{centro_name}}',
        'body_html': """<p>Hola <b>{{lead_name}}</b>,</p>
<p>Hemos pre-reservado tu plaza en <b>{{centro_name}}</b>:</p>
<table style="border-collapse:collapse;background:#f8f9fa;padding:12px;border-radius:8px;margin:12px 0">
  <tr><td style="padding:6px 12px"><b>Clase:</b></td><td>{{slot_nombre}}</td></tr>
  <tr><td style="padding:6px 12px"><b>Día y hora:</b></td><td>{{slot_fecha}} a las {{slot_hora}}</td></tr>
</table>
<p style="background:#fef3c7;padding:12px;border-radius:8px;border-left:3px solid #fbbf24">
⏰ <b>Importante:</b> tienes hasta las <b>{{expira_at}}</b> (1 hora desde ahora) para
confirmar la plaza. Si no confirmas, el sistema la liberará automáticamente.</p>
<p style="text-align:center;margin:24px 0">
  <a href="{{confirm_url}}" style="background:#2DD4A8;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">
    ✓ Confirmar mi prueba
  </a>
</p>
<p style="text-align:center;font-size:13px;color:#666">
  ¿Te viene mal este horario? Puedes <a href="{{confirm_url}}">cambiar a otro día/hora</a>
  desde el mismo enlace.
</p>
<p>Un saludo,<br/>{{centro_name}}</p>"""
    },
    # ── Slot confirmado (todo OK, te esperamos) ──
    {
        'evento': 'slot_confirmado_lead',
        'destinatario': 'lead',
        'subject': '¡Plaza confirmada! Te esperamos en {{centro_name}}',
        'body_html': """<p>Hola <b>{{lead_name}}</b>,</p>
<p>¡Perfecto! Tu plaza para la prueba en <b>{{centro_name}}</b> está confirmada:</p>
<table style="border-collapse:collapse;background:#f8f9fa;padding:12px;border-radius:8px;margin:12px 0">
  <tr><td style="padding:6px 12px"><b>Clase:</b></td><td>{{slot_nombre}}</td></tr>
  <tr><td style="padding:6px 12px"><b>Día y hora:</b></td><td>{{slot_fecha}} a las {{slot_hora}}</td></tr>
</table>
<p>Recuerda traer ropa cómoda, agua y muchas ganas. Te recomendamos llegar
10 minutos antes para que te enseñemos el centro.</p>
<p>Si tienes cualquier duda o necesitas cancelar, contáctanos directamente.</p>
<p>¡Nos vemos pronto!<br/>{{centro_name}}</p>"""
    },
    # ── Recordatorio 24h antes de la prueba ──
    {
        'evento': 'slot_recordatorio_lead',
        'destinatario': 'lead',
        'subject': 'Recordatorio: tu prueba mañana en {{centro_name}}',
        'body_html': """<p>Hola <b>{{lead_name}}</b>,</p>
<p>Te recordamos que mañana tienes tu sesión de prueba en
<b>{{centro_name}}</b>:</p>
<table style="border-collapse:collapse;background:#f8f9fa;padding:12px;border-radius:8px;margin:12px 0">
  <tr><td style="padding:6px 12px"><b>Clase:</b></td><td>{{slot_nombre}}</td></tr>
  <tr><td style="padding:6px 12px"><b>Día y hora:</b></td><td>{{slot_fecha}} a las {{slot_hora}}</td></tr>
</table>
<p>Recuerda traer ropa cómoda, agua y llegar 10 minutos antes.</p>
<p>Si por algún motivo no puedes asistir, avísanos contestando a este email.</p>
<p>¡Nos vemos mañana!<br/>{{centro_name}}</p>"""
    },
]


def seed_templates(id_manager):
    """Inserta plantillas por defecto si no existen para este manager."""
    if not id_manager: return 0
    inserted = 0
    try:
        with get_conn() as conn, conn.cursor() as cur:
            for t in DEFAULT_TEMPLATES:
                cur.execute("""
                    INSERT INTO email_template
                      (id_manager, evento, destinatario, subject, body_html, active)
                    VALUES (%s,%s,%s,%s,%s,TRUE)
                    ON CONFLICT (id_manager, evento, destinatario) DO NOTHING
                """, (str(id_manager), t['evento'], t['destinatario'],
                      t['subject'], t['body_html']))
                if cur.rowcount: inserted += 1
        log.info(f'seed_templates manager={id_manager} insertadas={inserted}')
    except Exception as e:
        log.exception('seed_templates')
    return inserted
