"""Bootstrap automático del manager/trainer en BD local tras login NF.

Cualquier usuario de NoofitPro (manager o trainer) puede loguearse en
Round; este endpoint garantiza que su `manager_config` y `trainer_noofit_creds`
existan en BD local, **sin requerir registro manual previo**.

Llamado desde `AuthContext.login` en el frontend, fire-and-forget, justo
después del login exitoso en NoofitPro.

Idempotente:
  - manager_config (id_manager) → INSERT si no existe; UPDATE creds NF si
    quien se loguea ES el manager (id_user == id_manager).
  - trainer_noofit_creds (id_manager, id_trainer) → siempre UPSERT con las
    creds recibidas (el trainer/manager se identifica con sus propias creds).
  - wcommerce_cliente_id → si está NULL en manager_config y el que se
    loguea ES el manager, intenta match por email contra wcommerce. Si
    hay match único, lo guarda; si no, deja NULL.

Body POST:
  {
    "id_user":     "17675",
    "id_manager":  "17675",
    "email":       "roundgestion@noofit.com",
    "password":    "1234abcd",    # en claro, ya lo tiene el frontend
    "nombre":      "ROUND MGR"    # opcional
  }
"""
import logging

from flask import Blueprint, request, jsonify

from ..auth import auth_required, parent_manager_si_es_trainer
from ..db import get_conn
from ..audit_log import log_action

bp = Blueprint('auth_bootstrap', __name__)
log = logging.getLogger(__name__)


@bp.route('/round-bootstrap', methods=['POST'])
@auth_required
def round_bootstrap():
    d = request.get_json(silent=True) or {}
    id_user    = str(d.get('id_user') or '').strip()
    id_manager_hint = str(d.get('id_manager') or '').strip()  # pista frontend (no autoritativa)
    email      = (d.get('email') or '').strip().lower() or None
    password   = (d.get('password') or '').strip() or None
    nombre     = (d.get('nombre') or '').strip() or None
    # X-TRAINER_MANAGER de loginEasy: "true"=MANAGER, "false"=TRAINER (jun 2026,
    # verificado contra NoofitPro). El flag decide el ROL; el TENANT se resuelve
    # de trainer_noofit_creds, NO del frontend.
    es_manager = str(d.get('es_manager', '')).strip().lower() in ('true', '1', 'yes')

    if not id_user:
        return jsonify({'ok': False, 'error': 'missing_ids'}), 400
    # Email obligatorio (lo tenemos siempre). Password opcional: si falta,
    # creamos placeholder de manager_config sin creds NF. Los crons que
    # necesitan re-loguearse fallarán hasta que el manager haga un login
    # fresh (al hacerlo, mandará el password y el endpoint UPDATEa la fila).
    # Este modo "soft" sirve para sesiones que arrancaron antes de añadir
    # el auto-registro: se autoregistran sin password al primer render.
    if not email:
        return jsonify({'ok': False, 'error': 'missing_email'}), 400

    # ── NoofitPro es la ÚNICA autoridad de las credenciales ──────────────────
    # Round solo CACHEA la contraseña NoofitPro (para que los syncs/crons se
    # reautentiquen). Por eso solo la persistimos si NoofitPro la VALIDA
    # (loginEasy 200). Si no valida (stale/errónea/NF caído), NUNCA pisamos la
    # copia buena que ya hubiera → evita corromper creds y tumbar el sync de un
    # centro. Regla documentada en CLAUDE.md.
    from ..noofit_client import credenciales_validas
    password_valida = bool(password) and credenciales_validas(email, password)
    pw_store = password if password_valida else None
    if password and not password_valida:
        log.warning(f'round-bootstrap: NoofitPro NO valida la contraseña de '
                    f'{email} (id_user={id_user}); no se sobrescriben las creds.')

    # ── Resolución de identidad (jun 2026): manager(true)/trainer(false) ─────
    # El TENANT (id_manager) NO se toma del frontend: se resuelve de
    # trainer_noofit_creds (prefiriendo un manager padre != id_user). El ROL lo
    # decide X-TRAINER_MANAGER (es_manager): manager → id_trainer=None (ve todo
    # el grupo); trainer → id_trainer=id_user (scopeado a su propio centro).
    tenant = _tenant_desde_creds(id_user)
    remapped = bool(tenant and tenant != id_user)
    if tenant is None:
        if es_manager:
            tenant = id_user                  # manager nuevo → su propio tenant
        else:
            # Trainer DESCONOCIDO y NO es manager: buscar su grupo Round (hermanos
            # NoofitPro). Si no pertenece a ningún manager Round → NO crear tenant
            # fantasma (refuerzo anti-fantasma; incidente Hugo 16702: cuenta de
            # otro manager ajeno que se logueó y creó un tenant Round con 49
            # clientes ajenos).
            tenant = _tenant_via_hermanos(id_user, email, password) if password else None
            if tenant is None:
                log.warning(f'round-bootstrap RECHAZO fantasma: id_user={id_user} '
                            f'({email}) es trainer (flag false) sin manager Round.')
                return jsonify({'ok': False, 'error': 'trainer_sin_manager',
                                'mensaje': ('Esta cuenta NoofitPro no pertenece a ningún '
                                            'manager de Round. Pide acceso como usuario web.')}), 409
            remapped = True

    id_trainer_res = None if es_manager else id_user
    es_dueno_tenant = es_manager and (tenant == id_user)
    creado_manager = False
    creado_trainer = False
    wc_info = {}

    # 1) manager_config — SOLO un manager (flag true) que sea dueño del tenant
    # crea/refresca el tenant. Un trainer NUNCA crea manager_config.
    if es_dueno_tenant:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO manager_config (id_manager, nombre, noofit_email,
                                             noofit_password, activo)
                VALUES (%s, %s, %s, %s, TRUE)
                ON CONFLICT (id_manager) DO NOTHING
                RETURNING id_manager
            """, (tenant, nombre or f'Manager {tenant}', email, pw_store))
            creado_manager = cur.fetchone() is not None
            if not creado_manager:
                if password_valida:
                    cur.execute("""UPDATE manager_config
                                      SET noofit_email=%s, noofit_password=%s,
                                          nombre=COALESCE(NULLIF(nombre,''),%s), activo=TRUE
                                    WHERE id_manager=%s""",
                                (email, pw_store, nombre or f'Manager {tenant}', tenant))
                else:
                    cur.execute("""UPDATE manager_config
                                      SET nombre=COALESCE(NULLIF(nombre,''),%s), activo=TRUE
                                    WHERE id_manager=%s""",
                                (nombre or f'Manager {tenant}', tenant))

    # 2) trainer_noofit_creds — registrar al que entra como (tenant, id_user) si
    # NoofitPro validó las creds (regla: solo cacheamos lo que NF acepta).
    if password_valida:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO trainer_noofit_creds (id_manager, id_trainer,
                                                    noofit_email, noofit_password, activo)
                VALUES (%s, %s, %s, %s, TRUE)
                ON CONFLICT (id_manager, id_trainer) DO UPDATE SET
                    noofit_email    = EXCLUDED.noofit_email,
                    noofit_password = COALESCE(EXCLUDED.noofit_password, trainer_noofit_creds.noofit_password),
                    activo          = TRUE, updated_at = NOW()
                RETURNING (xmax = 0) AS inserted
            """, (tenant, id_user, email, pw_store))
            r = cur.fetchone()
            creado_trainer = bool(r and r.get('inserted'))

    # 3) Match wcommerce — solo el dueño del tenant, si wcommerce_cliente_id NULL
    if es_dueno_tenant:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT wcommerce_cliente_id FROM manager_config
                            WHERE id_manager = %s""", (tenant,))
            row = cur.fetchone()
        if row and not row.get('wcommerce_cliente_id'):
            wc_info = _try_match_wcommerce(tenant, email)

    # Registro del LOGIN en accion_log — solo login real (viene password).
    if password:
        actor = {
            'kind': 'manager' if es_manager else 'trainer_nf',
            'id': id_user, 'email': email, 'label': nombre or email,
            'id_manager': tenant, 'id_trainer': id_trainer_res,
        }
        log_action(actor, entidad='sesion', accion='login', entidad_id=id_user,
                   resumen=(f"Login web (NoofitPro) · {email} · "
                            f"{'manager' if es_manager else 'trainer ' + id_user} · "
                            f"tenant {tenant}" + (' (reconducido)' if remapped else '')))

    return jsonify({
        'ok': True,
        'id_manager': tenant,
        'id_trainer': id_trainer_res,
        'es_manager': es_manager,
        'is_manager_login': es_manager,
        'id_user': id_user,
        'remapped_to_parent': tenant if remapped else None,
        'creado_manager': creado_manager,
        'creado_trainer': creado_trainer,
        'wc_match': wc_info,
        'mensaje': ('Manager registrado en Round.' if creado_manager
                    else (f'Trainer reconducido al manager {tenant}.' if remapped
                          else 'Identidad resuelta.')),
    })


def _tenant_desde_creds(id_user):
    """Tenant (id_manager Round) al que pertenece `id_user` según
    trainer_noofit_creds. Prefiere un manager padre (id_manager != id_user)
    sobre la fila "self" (id_manager == id_user). Devuelve None si no consta."""
    if not id_user:
        return None
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id_manager FROM trainer_noofit_creds
                 WHERE id_trainer = %s AND activo = TRUE
                 ORDER BY (id_manager = %s) ASC, id_manager ASC
                 LIMIT 1
            """, (str(id_user), str(id_user)))
            row = cur.fetchone()
        return str(row['id_manager']) if row and row.get('id_manager') else None
    except Exception:
        return None


def _tenant_via_hermanos(id_user, email, password):
    """Para un trainer DESCONOCIDO localmente: si comparte grupo NoofitPro
    (getTrainersByManager) con un manager Round ya existente, devuelve ese
    manager. None si no pertenece a ningún grupo Round."""
    try:
        from ..noofit_client import hermanos_trainer_ids
        hermanos = hermanos_trainer_ids(email, password)
        hermanos.discard(str(id_user))
        if not hermanos:
            return None
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT id_manager FROM manager_config
                            WHERE id_manager = ANY(%s) ORDER BY id_manager LIMIT 1""",
                        (list(hermanos),))
            row = cur.fetchone()
        return str(row['id_manager']) if row and row.get('id_manager') else None
    except Exception:
        return None


def _try_match_wcommerce(id_manager, email):
    """Busca un cliente wcommerce con email coincidente. Si hay match único,
    guarda wcommerce_cliente_id + tipo_pago_wc en manager_config. Devuelve
    {matched, codigo?, tipo_pago?, motivo?}."""
    try:
        from ..wcommerce_check import _get_json
        d = _get_json('getClientes', params={'start': 0, 'limit': 10000})
    except Exception as e:
        log.warning(f'bootstrap wc_match {id_manager}: no llega a wcommerce: {e}')
        return {'matched': False, 'motivo': 'wcommerce_unreachable'}

    lista = next((v for v in (d or {}).values() if isinstance(v, list)), [])
    target = email.lower()
    candidatos = []
    for c in lista:
        ce = (c.get('email') or '').strip().lower()
        if ce and ce == target:
            candidatos.append(c)

    if not candidatos:
        return {'matched': False, 'motivo': 'no_match_email'}
    if len(candidatos) > 1:
        log.info(f'bootstrap wc_match {id_manager}: {len(candidatos)} matches '
                 f'por email {email!r}, dejamos NULL (manual)')
        return {'matched': False, 'motivo': 'multiple_matches',
                'count': len(candidatos)}

    c = candidatos[0]
    codigo = str(c.get('codigo') or '').strip() or None
    tipo_pago = (c.get('tipoPago') or '').strip().upper() or None
    if not codigo:
        return {'matched': False, 'motivo': 'no_codigo'}

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE manager_config
               SET wcommerce_cliente_id = %s,
                   tipo_pago_wc = %s
             WHERE id_manager = %s
               AND wcommerce_cliente_id IS NULL
        """, (codigo, tipo_pago, id_manager))
    log.info(f'bootstrap wc_match {id_manager}: codigo={codigo} tipoPago={tipo_pago}')
    return {
        'matched': True,
        'codigo': codigo,
        'tipo_pago': tipo_pago,
        'nombre_wc': c.get('nombre'),
        'persona_juridica': c.get('personaJuridica'),
    }
