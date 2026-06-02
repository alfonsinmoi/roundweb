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
    id_manager = str(d.get('id_manager') or '').strip()
    email      = (d.get('email') or '').strip().lower() or None
    password   = (d.get('password') or '').strip() or None
    nombre     = (d.get('nombre') or '').strip() or None

    if not id_user or not id_manager:
        return jsonify({'ok': False, 'error': 'missing_ids'}), 400
    # Email obligatorio (lo tenemos siempre). Password opcional: si falta,
    # creamos placeholder de manager_config sin creds NF. Los crons que
    # necesitan re-loguearse fallarán hasta que el manager haga un login
    # fresh (al hacerlo, mandará el password y el endpoint UPDATEa la fila).
    # Este modo "soft" sirve para sesiones que arrancaron antes de añadir
    # el auto-registro: se autoregistran sin password al primer render.
    if not email:
        return jsonify({'ok': False, 'error': 'missing_email'}), 400

    # ── Guard anti-manager-fantasma ──────────────────────────────────────────
    # Si este id ya es un TRAINER de otro manager, NO creamos un manager_config
    # para él (esto es lo que silenciosamente creó el manager 17674 de Añoreta
    # cuando un trainer entró con login directo). Lo registramos/actualizamos
    # como trainer de su manager padre y devolvemos ese manager.
    parent = parent_manager_si_es_trainer(id_user)
    if parent and parent != id_user:
        if password:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO trainer_noofit_creds (id_manager, id_trainer,
                                                        noofit_email, noofit_password, activo)
                    VALUES (%s, %s, %s, %s, TRUE)
                    ON CONFLICT (id_manager, id_trainer) DO UPDATE SET
                        noofit_email    = EXCLUDED.noofit_email,
                        noofit_password = EXCLUDED.noofit_password,
                        activo          = TRUE,
                        updated_at      = NOW()
                """, (parent, id_user, email, password))
            log_action({'kind': 'trainer_nf', 'id': id_user, 'email': email,
                        'label': nombre or email, 'id_manager': parent, 'id_trainer': id_user},
                       entidad='sesion', accion='login', entidad_id=id_user,
                       resumen=(f"Login web (NoofitPro) · {email} · "
                                f"trainer {id_user} del manager {parent}"))
        return jsonify({
            'ok': True, 'id_manager': parent, 'id_user': id_user,
            'is_manager_login': False, 'remapped_to_parent': parent,
            'mensaje': f'Trainer del manager {parent}; no se crea manager nuevo.',
        })

    is_manager_login = (id_user == id_manager)
    creado_manager = False
    creado_trainer = False
    wc_resolved = False

    # 1) manager_config — INSERT si no existe; UPDATE creds si el que se
    # loguea ES el manager principal Y tenemos password (login fresh).
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO manager_config (id_manager, nombre, noofit_email,
                                         noofit_password, activo)
            VALUES (%s, %s, %s, %s, TRUE)
            ON CONFLICT (id_manager) DO NOTHING
            RETURNING id_manager
        """, (id_manager,
              nombre or f'Manager {id_manager}',
              email if is_manager_login else None,
              (password or None) if is_manager_login else None))
        creado_manager = cur.fetchone() is not None

        # Si ya existía y es el manager principal, actualizar nombre y
        # creds (creds solo si nos las pasaron — no pisar con NULL si
        # vino el bootstrap soft sin password).
        if not creado_manager and is_manager_login:
            if password:
                cur.execute("""
                    UPDATE manager_config
                       SET noofit_email = %s,
                           noofit_password = %s,
                           nombre = COALESCE(NULLIF(nombre,''), %s),
                           activo = TRUE
                     WHERE id_manager = %s
                """, (email, password,
                      nombre or f'Manager {id_manager}', id_manager))
            else:
                cur.execute("""
                    UPDATE manager_config
                       SET nombre = COALESCE(NULLIF(nombre,''), %s),
                           activo = TRUE
                     WHERE id_manager = %s
                """, (nombre or f'Manager {id_manager}', id_manager))

    # 2) trainer_noofit_creds — solo escribimos creds si tenemos password
    # (modo bootstrap fresh tras login). En modo soft sin password, no
    # tocamos esta tabla (no podemos guardar creds inválidas).
    if password:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO trainer_noofit_creds (id_manager, id_trainer,
                                                    noofit_email, noofit_password,
                                                    activo)
                VALUES (%s, %s, %s, %s, TRUE)
                ON CONFLICT (id_manager, id_trainer) DO UPDATE SET
                    noofit_email    = EXCLUDED.noofit_email,
                    noofit_password = EXCLUDED.noofit_password,
                    activo          = TRUE,
                    updated_at      = NOW()
                RETURNING (xmax = 0) AS inserted
            """, (id_manager, id_user, email, password))
            r = cur.fetchone()
            creado_trainer = bool(r and r.get('inserted'))

    # 3) Match wcommerce automático — SOLO si:
    #    a) es el manager principal el que se loguea (no un trainer)
    #    b) wcommerce_cliente_id sigue NULL (no se ha resuelto antes)
    wc_info = {}
    if is_manager_login:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""SELECT wcommerce_cliente_id FROM manager_config
                            WHERE id_manager = %s""", (id_manager,))
            row = cur.fetchone()
        if row and not row.get('wcommerce_cliente_id'):
            wc_info = _try_match_wcommerce(id_manager, email)
            wc_resolved = bool(wc_info.get('matched'))

    # Registro del LOGIN en accion_log — solo en login real / impersonación
    # (viene `password`). En modo soft (restauración de sesión en cada
    # recarga) NO se registra para no llenar el log de ruido.
    if password:
        actor = {
            'kind': 'manager' if is_manager_login else 'trainer_nf',
            'id': id_user,
            'email': email,
            'label': nombre or email,
            'id_manager': id_manager,
            'id_trainer': None if is_manager_login else id_user,
        }
        log_action(actor, entidad='sesion', accion='login',
                   entidad_id=id_user,
                   resumen=(f"Login web (NoofitPro) · {email} · "
                            f"{'manager' if is_manager_login else 'trainer ' + id_user}"))

    return jsonify({
        'ok': True,
        'id_manager': id_manager,
        'id_user': id_user,
        'is_manager_login': is_manager_login,
        'creado_manager': creado_manager,
        'creado_trainer': creado_trainer,
        'wc_match': wc_info,
        'mensaje': ('Manager registrado en Round.'
                    if creado_manager else 'Manager ya estaba registrado.'),
    })


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
