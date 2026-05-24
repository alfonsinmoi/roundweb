"""Cómputo del checklist post-activación para cada módulo Odoo.

Para cada módulo (crm / cuotas / contabilidad), define los items que el
manager debe tener configurados para que el módulo funcione end-to-end.
Cada item tiene:
  - id            (clave estable, no traducir)
  - label         (descripción humana)
  - severity      'critical' (rompe el flujo) | 'recommended' (mejora UX)
  - check_fn      callable(id_manager) -> dict {status, detail}
  - deeplink      hash del tab destino en Configuración

Estados:
  - 'ok'      → configurado, no requiere acción
  - 'warn'    → falta o incompleto, no crítico
  - 'missing' → falta crítico, rompe la funcionalidad
"""
import logging
from .db import get_conn

log = logging.getLogger(__name__)


# ─── Checks individuales ─────────────────────────────────────────────────────
def _count(query, params):
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(query, params)
            r = cur.fetchone()
        # postgres devuelve dict_row → primer valor del row
        return next(iter(r.values())) if r else 0
    except Exception as e:
        log.warning(f'checklist count failed: {e}')
        return 0


def chk_centros(idm):
    n = _count("""SELECT COUNT(*) FROM centro_contacto
                   WHERE id_manager=%s AND activo=TRUE
                     AND slug IS NOT NULL AND email IS NOT NULL AND email<>''""",
               (str(idm),))
    if n >= 1: return {'status': 'ok', 'detail': f'{n} centro(s) configurado(s)'}
    return {'status': 'missing', 'detail': 'Necesitas ≥1 centro con slug y email'}


def chk_email_proveedor(idm):
    n = _count("""SELECT COUNT(*) FROM email_proveedor
                   WHERE id_manager=%s AND id_trainer IS NULL AND active=TRUE""",
               (str(idm),))
    if n >= 1: return {'status': 'ok', 'detail': 'Proveedor email manager configurado'}
    return {'status': 'missing', 'detail': 'Sin proveedor email (Resend / SMTP / Gmail)'}


def chk_email_templates_crm(idm):
    eventos_crm = (
        'lead_creado_lead', 'slot_reservado_lead', 'slot_confirmado_lead',
        'slot_recordatorio_lead', 'etapa_visita_lead',
    )
    n = _count("""SELECT COUNT(*) FROM email_template
                   WHERE id_manager=%s AND active=TRUE
                     AND evento = ANY(%s)""",
               (str(idm), list(eventos_crm)))
    if n >= 3: return {'status': 'ok', 'detail': f'{n} de {len(eventos_crm)} plantillas activas'}
    if n >= 1: return {'status': 'warn',
                       'detail': f'{n} de {len(eventos_crm)} plantillas. Recomendado tener todas.'}
    return {'status': 'warn', 'detail': 'Sin plantillas CRM (usará defaults genéricos)'}


def chk_canales_captacion(idm):
    n = _count("""SELECT COUNT(*) FROM canal_captacion
                   WHERE id_manager=%s AND activa=TRUE""",
               (str(idm),))
    if n >= 1: return {'status': 'ok', 'detail': f'{n} canal(es) configurado(s)'}
    return {'status': 'warn',
            'detail': 'Sin canales: no podrás medir eficacia por UTM source'}


def chk_cuotas(idm):
    n = _count("""SELECT COUNT(*) FROM cuota WHERE id_manager=%s AND active=TRUE""",
               (str(idm),))
    if n >= 1: return {'status': 'ok', 'detail': f'{n} cuota(s) activa(s)'}
    return {'status': 'missing', 'detail': 'Sin catálogo de cuotas → no se pueden dar de alta clientes'}


def chk_sistemas_cobro(idm):
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT sistemas_cobro FROM manager_config
                            WHERE id_manager=%s""", (str(idm),))
            r = cur.fetchone()
        sc = (r['sistemas_cobro'] or []) if r else []
        if isinstance(sc, str):
            import json; sc = json.loads(sc) or []
    except Exception:
        sc = []
    if sc: return {'status': 'ok', 'detail': f'{len(sc)} método(s): {", ".join(sc)}'}
    return {'status': 'missing', 'detail': 'Sin métodos de cobro elegidos (SEPA / TPV / link / efectivo)'}


def chk_pasarela_paycomet(idm):
    n = _count("""SELECT COUNT(*) FROM pasarela_credenciales
                   WHERE id_manager=%s AND proveedor='paycomet' AND active=TRUE""",
               (str(idm),))
    # Solo crítico si sistemas_cobro incluye tpv_virtual o link_pago.
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT sistemas_cobro FROM manager_config WHERE id_manager=%s",
                        (str(idm),))
            r = cur.fetchone()
        sc = (r['sistemas_cobro'] or []) if r else []
        if isinstance(sc, str):
            import json; sc = json.loads(sc) or []
    except Exception:
        sc = []
    necesita = any(m in sc for m in ('tpv_virtual', 'link_pago', 'tokenizacion'))
    if n >= 1: return {'status': 'ok', 'detail': f'{n} pasarela(s) configurada(s)'}
    if necesita:
        return {'status': 'missing',
                'detail': 'PayComet requerido para tpv/link/tokenización pero sin credenciales'}
    return {'status': 'warn',
            'detail': 'Sin PayComet (sólo necesario si cobras por TPV o link)'}


def chk_categorias_gasto(idm):
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT COUNT(*) FROM gasto_categoria
                            WHERE id_manager=%s AND activa=TRUE
                              AND cuenta_contable_odoo IS NOT NULL""",
                        (str(idm),))
            r = cur.fetchone()
        n = next(iter(r.values())) if r else 0
    except Exception:
        n = 0
    if n >= 5: return {'status': 'ok', 'detail': f'{n} categorías con cuenta contable'}
    if n >= 1: return {'status': 'warn', 'detail': f'Solo {n} categorías. Recomendado ≥5'}
    return {'status': 'missing',
            'detail': 'Sin categorías de gasto con cuenta contable → el LLM no podrá imputar'}


def chk_trainer_contab(idm):
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT COUNT(*) FROM trainer_contab_config
                            WHERE id_manager=%s AND activo=TRUE""",
                        (str(idm),))
            r = cur.fetchone()
        n = next(iter(r.values())) if r else 0
    except Exception:
        n = 0
    if n >= 1: return {'status': 'ok', 'detail': f'{n} trainer(s) con contabilidad activa'}
    return {'status': 'missing',
            'detail': 'Ningún trainer tiene contabilidad activa → pestaña Contab oculta'}


def chk_analytic_default(idm):
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT odoo_analytic_default_id FROM manager_config
                            WHERE id_manager=%s""", (str(idm),))
            r = cur.fetchone()
        v = r['odoo_analytic_default_id'] if r else None
    except Exception:
        v = None
    if v: return {'status': 'ok', 'detail': f'analytic_account_id={v}'}
    return {'status': 'warn',
            'detail': 'Sin analytic por defecto: facturas no se separarán por trainer'}


def chk_modo_facturacion(idm):
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT modo_facturacion FROM manager_config
                            WHERE id_manager=%s""", (str(idm),))
            r = cur.fetchone()
        m = (r['modo_facturacion'] if r else None) or 'recibo_trimestre'
    except Exception:
        m = 'recibo_trimestre'
    labels = {'recibo_trimestre': 'Recibo + factura trimestral',
              'factura_draft':    'Factura draft + post mensual',
              'factura_directa':  'Factura directa mensual'}
    return {'status': 'ok',
            'detail': f'Modo: {labels.get(m, m)}'}


def chk_notif_config(idm):
    n = _count("""SELECT COUNT(*) FROM notif_config WHERE id_manager=%s""",
               (str(idm),))
    if n >= 1: return {'status': 'ok', 'detail': 'Notificaciones configuradas'}
    return {'status': 'warn', 'detail': 'Sin OneSignal: no se envían push'}


# ─── Definición de checklist por módulo ──────────────────────────────────────
CHECKS = {
    'crm': [
        ('centros',       'Al menos 1 centro con slug + email',  'critical',
         chk_centros,           'centros'),
        ('email_proveedor','Proveedor de email transaccional',   'critical',
         chk_email_proveedor,   'email'),
        ('templates',     'Plantillas email del flujo CRM',      'recommended',
         chk_email_templates_crm,'email_tpl'),
        ('canales',       'Canales de captación (UTMs → canal)', 'recommended',
         chk_canales_captacion, 'canales'),
    ],
    'cuotas': [
        ('cuotas',          'Catálogo de cuotas',                 'critical',
         chk_cuotas,            'cuotas'),
        ('sistemas_cobro',  'Métodos de cobro elegidos',          'critical',
         chk_sistemas_cobro,    'suscrip'),
        ('pasarela',        'Pasarela PayComet (si TPV o link)',  'recommended',
         chk_pasarela_paycomet, 'pasarelas'),
        ('modo_facturacion','Modo de facturación elegido',        'recommended',
         chk_modo_facturacion,  'forma_fact'),
        ('notif',           'Notificaciones push (OneSignal)',    'recommended',
         chk_notif_config,      'notif'),
        ('email_proveedor', 'Proveedor de email (envío facturas)','critical',
         chk_email_proveedor,   'email'),
    ],
    'contabilidad': [
        ('categorias_gasto','Categorías de gasto con cuenta contable', 'critical',
         chk_categorias_gasto,  'contab'),
        ('trainer_contab',  'Algún trainer con contabilidad activa',  'critical',
         chk_trainer_contab,    'contab'),
        ('analytic',        'Analytic por defecto del manager',       'recommended',
         chk_analytic_default,  'contab'),
    ],
}


def compute_checklist(id_manager: str, modulo: str | None = None) -> dict:
    """Calcula el checklist. Si modulo=None devuelve los 3 módulos.

    Estructura:
      {
        'ok': True,
        'modulos': {
          'crm': {
            'items': [{id, label, severity, status, detail, deeplink, deeplink_tab}, ...],
            'critical_missing': int,
            'warn': int,
            'ok_count': int,
          },
          ...
        }
      }
    """
    modulos = [modulo] if modulo else list(CHECKS.keys())
    out = {}
    for m in modulos:
        items = []
        crit_missing = 0
        warn = 0
        ok_count = 0
        for (cid, label, severity, fn, dl) in CHECKS.get(m, []):
            try:
                r = fn(id_manager) or {}
            except Exception as e:
                log.exception(f'checklist {m}/{cid} failed: {e}')
                r = {'status': 'warn', 'detail': f'Error: {e}'}
            status = r.get('status', 'warn')
            if status == 'missing' and severity == 'critical':
                crit_missing += 1
            elif status in ('warn', 'missing'):
                warn += 1
            else:
                ok_count += 1
            items.append({
                'id': cid,
                'label': label,
                'severity': severity,
                'status': status,
                'detail': r.get('detail', ''),
                'deeplink': f'/configuracion#{dl}',
                'deeplink_tab': dl,
            })
        out[m] = {
            'items': items,
            'critical_missing': crit_missing,
            'warn': warn,
            'ok_count': ok_count,
            'total': len(items),
        }
    return {'ok': True, 'modulos': out}
