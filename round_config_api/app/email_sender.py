"""Envío de emails con proveedor configurable por manager.

Soporta:
  - Resend  (API key, https://api.resend.com/emails)
  - Postmark (API token, https://api.postmarkapp.com/email)
  - SMTP    (cualquier servidor estándar)

Lee la configuración desde la tabla email_proveedor (BD VPS). Si no hay
config para el manager, cae al .env (variables ROUND_SMTP_*) por
compatibilidad.
"""
import os, smtplib, logging
from email.message import EmailMessage
import requests
from .db import get_conn

log = logging.getLogger(__name__)


def _get_config(id_manager, id_trainer=None):
    """Resuelve config de email con prioridad:
       1) (id_manager, id_trainer) si trainer especificado y hay fila
       2) (id_manager, NULL) — config global del manager
       3) Fallback: primer email_proveedor activo del sistema
          (cubre el caso de gestor multi-manager sin config propia).
    """
    if not id_manager: id_manager = ''
    try:
        with get_conn() as conn, conn.cursor() as cur:
            if id_manager and id_trainer:
                cur.execute("""SELECT * FROM email_proveedor
                                WHERE id_manager=%s AND id_trainer=%s AND active=TRUE
                                LIMIT 1""",
                            (str(id_manager), str(id_trainer)))
                row = cur.fetchone()
                if row: return row
            if id_manager:
                cur.execute("""SELECT * FROM email_proveedor
                                WHERE id_manager=%s AND id_trainer IS NULL AND active=TRUE
                                LIMIT 1""", (str(id_manager),))
                row = cur.fetchone()
                if row: return row
            # Fallback global (no fail-soft anterior)
            cur.execute("""SELECT * FROM email_proveedor
                            WHERE active=TRUE
                            ORDER BY id_trainer NULLS FIRST
                            LIMIT 1""")
            row = cur.fetchone()
            if row:
                log.info(f'_get_config: usando fallback global (manager={id_manager} sin config propia)')
            return row
    except Exception as e:
        log.error(f'_get_config email: {e}')
        return None


def _normaliza_gmail(cfg):
    """Si proveedor='gmail', autorrellena los campos SMTP de Google."""
    if not cfg or cfg.get('proveedor') != 'gmail': return cfg
    cfg = dict(cfg)
    cfg.setdefault('smtp_host', 'smtp.gmail.com')
    cfg.setdefault('smtp_port', 587)
    if not cfg.get('smtp_host'): cfg['smtp_host'] = 'smtp.gmail.com'
    if not cfg.get('smtp_port'): cfg['smtp_port'] = 587
    cfg['smtp_tls'] = True
    # En Gmail, smtp_user normalmente coincide con from_email
    if not cfg.get('smtp_user'): cfg['smtp_user'] = cfg.get('from_email') or ''
    return cfg


def _enviar_resend(cfg, to, subject, body_text, body_html, cc, reply_to, attachments=None):
    payload = {
        'from': f"{cfg.get('from_name') or 'Round'} <{cfg['from_email']}>",
        'to': to if isinstance(to, list) else [to],
        'subject': subject,
        'text': body_text or '',
    }
    if body_html: payload['html'] = body_html
    if cc:        payload['cc'] = cc if isinstance(cc, list) else [cc]
    if reply_to or cfg.get('reply_to'):
        payload['reply_to'] = [reply_to or cfg['reply_to']]
    if attachments:
        # Resend: attachments como base64 + filename + content_type
        import base64
        payload['attachments'] = [{
            'filename':     a[0],
            'content':      base64.b64encode(a[1]).decode('ascii'),
            'content_type': a[2] if len(a) > 2 else 'application/octet-stream',
        } for a in attachments]
    r = requests.post('https://api.resend.com/emails', json=payload,
        headers={'Authorization': f'Bearer {cfg["api_key"]}',
                 'Content-Type': 'application/json'}, timeout=20)
    if r.status_code >= 300:
        log.error(f'Resend {r.status_code}: {r.text[:200]}')
        return False
    return True


def _enviar_postmark(cfg, to, subject, body_text, body_html, cc, reply_to, attachments=None):
    payload = {
        'From': f"{cfg.get('from_name') or 'Round'} <{cfg['from_email']}>",
        'To': to if isinstance(to, str) else ', '.join(to),
        'Subject': subject,
        'TextBody': body_text or '',
    }
    if body_html: payload['HtmlBody'] = body_html
    if cc:        payload['Cc'] = cc if isinstance(cc, str) else ', '.join(cc)
    if reply_to or cfg.get('reply_to'):
        payload['ReplyTo'] = reply_to or cfg['reply_to']
    if attachments:
        import base64
        payload['Attachments'] = [{
            'Name':        a[0],
            'Content':     base64.b64encode(a[1]).decode('ascii'),
            'ContentType': a[2] if len(a) > 2 else 'application/octet-stream',
        } for a in attachments]
    r = requests.post('https://api.postmarkapp.com/email', json=payload,
        headers={'X-Postmark-Server-Token': cfg['api_key'],
                 'Accept': 'application/json',
                 'Content-Type': 'application/json'}, timeout=20)
    if r.status_code >= 300:
        log.error(f'Postmark {r.status_code}: {r.text[:200]}')
        return False
    return True


def _enviar_smtp(cfg, to, subject, body_text, body_html, cc, reply_to, attachments=None):
    host = cfg.get('smtp_host') if cfg else os.getenv('ROUND_SMTP_HOST')
    if not host: return False
    port = (cfg.get('smtp_port') if cfg else None) or int(os.getenv('ROUND_SMTP_PORT', '587'))
    user = (cfg.get('smtp_user') if cfg else None) or os.getenv('ROUND_SMTP_USER', '')
    pwd  = (cfg.get('smtp_pass') if cfg else None) or os.getenv('ROUND_SMTP_PASS', '')
    sender = ((cfg.get('from_name') or 'Round') + ' <' + cfg['from_email'] + '>'
              if cfg else os.getenv('ROUND_SMTP_FROM', user))
    use_tls = (cfg.get('smtp_tls') if cfg else None) if cfg is not None else (os.getenv('ROUND_SMTP_TLS', '1') == '1')

    msg = EmailMessage()
    msg['From'] = sender
    msg['To'] = to if isinstance(to, str) else ', '.join(to)
    if cc: msg['Cc'] = cc if isinstance(cc, str) else ', '.join(cc)
    if reply_to or (cfg and cfg.get('reply_to')):
        msg['Reply-To'] = reply_to or cfg['reply_to']
    msg['Subject'] = subject
    msg.set_content(body_text or '')
    if body_html:
        msg.add_alternative(body_html, subtype='html')

    # Attachments (lista de tuplas: (filename, bytes, mime_type opcional))
    if attachments:
        for a in attachments:
            filename = a[0]
            data = a[1]
            mime = a[2] if len(a) > 2 else 'application/octet-stream'
            maintype, _, subtype = mime.partition('/')
            msg.add_attachment(data, maintype=maintype or 'application',
                               subtype=subtype or 'octet-stream',
                               filename=filename)

    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=15) as s:
                if user: s.login(user, pwd)
                s.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=15) as s:
                if use_tls:
                    s.ehlo(); s.starttls(); s.ehlo()
                if user: s.login(user, pwd)
                s.send_message(msg)
        return True
    except Exception as e:
        log.error(f'SMTP error: {e}')
        return False


def enviar(to, subject, body_text, body_html=None, cc=None, reply_to=None,
           id_manager=None, id_trainer=None, attachments=None):
    """attachments: lista de (filename, bytes, mime_type opcional)."""
    cfg = _get_config(id_manager, id_trainer) if id_manager else None
    cfg = _normaliza_gmail(cfg)
    proveedor = (cfg or {}).get('proveedor') or 'smtp'

    try:
        if cfg and proveedor == 'resend' and cfg.get('api_key'):
            ok = _enviar_resend(cfg, to, subject, body_text, body_html, cc, reply_to, attachments)
        elif cfg and proveedor == 'postmark' and cfg.get('api_key'):
            ok = _enviar_postmark(cfg, to, subject, body_text, body_html, cc, reply_to, attachments)
        else:
            # 'gmail' y 'smtp' van por la misma vía SMTP
            ok = _enviar_smtp(cfg, to, subject, body_text, body_html, cc, reply_to, attachments)
        scope = f'manager={id_manager}' + (f' trainer={id_trainer}' if id_trainer else '')
        if ok: log.info(f'Email enviado a {to}: {subject} (via {proveedor}, {scope})')
        else:  log.warning(f'Email NO enviado a {to}: {subject} ({scope})')
        return ok
    except Exception as e:
        log.exception('email enviar')
        return False


# Test del proveedor configurado (envía un email a from_email para validar)
def test_proveedor(id_manager, dest_email, id_trainer=None):
    cfg = _get_config(id_manager, id_trainer)
    if not cfg:
        scope = 'manager' if not id_trainer else f'trainer {id_trainer}'
        return False, f'No hay config para este {scope}'
    return enviar(dest_email, '[Round] Email de prueba',
                  'Si recibes esto, la configuración del proveedor funciona.',
                  body_html='<p>Si recibes esto, la configuración del proveedor funciona ✅</p>',
                  id_manager=id_manager, id_trainer=id_trainer), 'OK'
