"""Emisión mensual de recibos — modo α (recibo + trimestral).

Diferencia con preemisión v1:
  - v1: crea account.move borradores Odoo → emisión postea + SEPA
  - v2: crea filas en BD `recibo`. Para SEPA/tarjeta crea account.payment en Odoo
        (cobro). NO crea account.move (factura) — eso se hace trimestralmente.

Endpoints:
  POST  /api/cuotas/preemision-v2/<mes>     genera recibos del mes (recibo BD)
  GET   /api/cuotas/preemision-v2/<mes>     lista recibos del mes
  POST  /api/cuotas/emitir-v2/<mes>         confirma: crea payments para SEPA pagados + genera fichero SEPA si toca
  DELETE /api/cuotas/preemision-v2/<mes>/recibo/<id>   borra recibo borrador
"""
import datetime as dt
import logging
from collections import defaultdict
from flask import Blueprint, request, jsonify, g

from ..auth import auth_required
from ..db import get_conn
from ..audit_log import log_action, actor_from_request

bp = Blueprint('preemision_v2', __name__)
log = logging.getLogger(__name__)


def _odoo():
    from ..odoo_alta import OdooAlta
    o = OdooAlta(); o._connect()
    return o


def _company_id():
    from .. import config as appconfig
    return getattr(appconfig, 'ODOO_COMPANY', 3) or 3


# ─── helpers ────────────────────────────────────────────────────────────────

def _calc_fecha_hasta(fecha_emision_iso, periodicidad):
    """Devuelve la fecha (ISO) hasta la que el pago cubre, según periodicidad.

    Convención: emisión + N meses − 1 día (último día cubierto inclusive).
    - mensual:    NULL  (cobertura del mes natural ya implícita en `periodo`)
    - trimestral: emisión + 3 meses − 1 día
    - semestral:  emisión + 6 meses − 1 día
    - anual:      emisión + 12 meses − 1 día
    - puntual:    NULL

    Necesario para que la idempotencia `ya_cubiertos_post_mes` detecte que
    un cliente trimestral / semestral / anual ya está cubierto cuando llega
    el siguiente mes (si fecha_hasta fuese NULL, el validador NO lo detecta
    y podría emitir un recibo duplicado).
    """
    meses = {'mensual': 0, 'bimensual': 2, 'trimestral': 3,
             'semestral': 6, 'anual': 12, 'puntual': 0}.get(periodicidad, 0)
    if meses == 0:
        return None
    try:
        d = dt.date.fromisoformat(fecha_emision_iso)
    except Exception:
        return None
    y = d.year + (d.month - 1 + meses) // 12
    m = (d.month - 1 + meses) % 12 + 1
    day = min(d.day, 28)
    fin = dt.date(y, m, day)
    return (fin - dt.timedelta(days=1)).isoformat()


def _toca_emitir(sub, mes_str):
    """Decide si una subscription debe emitir recibo en `mes_str` (YYYY-MM).

    Lógica (según definición del usuario):
    - mensual: emite cada mes desde fecha_inicio
    - trimestral: emite cada 3 meses (mes 0, 3, 6, 9 desde inicio)
    - semestral: cada 6 meses
    - anual: cada 12 meses
    """
    fi = sub.get('fecha_inicio')
    if not fi: return False
    if isinstance(fi, str):
        fi = dt.datetime.fromisoformat(fi[:10]).date()
    fi_mes = fi.year * 12 + fi.month
    target_y, target_m = map(int, mes_str.split('-'))
    target_mes = target_y * 12 + target_m
    if target_mes < fi_mes: return False
    n = target_mes - fi_mes
    per = sub.get('periodicidad', 'mensual')
    step = {'mensual': 1, 'trimestral': 3, 'semestral': 6, 'anual': 12}.get(per, 1)
    return n % step == 0


def _precio_para(cuota, periodicidad):
    if not cuota: return 0
    return float(cuota.get(f'precio_{periodicidad}') or 0)


def _split_iva(total, pct=21.0):
    """Devuelve (base, iva) sumando = total."""
    base = round(total / (1 + pct/100), 2)
    iva = round(total - base, 2)
    return base, iva


# ─── POST /<mes> — generar recibos del mes ─────────────────────────────────

@bp.route('/<mes>', methods=['POST'])
@auth_required
def generar(mes):
    """mes: 'YYYY-MM'. Crea filas en `recibo` para cada cliente con sub activa
    que TOCA emitir ese mes. Idempotente: si ya existe recibo (cliente, periodo)
    con origen='cron_emision', salta."""
    try:
        # Recalcular descuentos automáticos JUSTO ANTES de emitir, para que
        # cualquier cambio reciente (cuota nueva, familia editada, etc.) se
        # refleje en los recibos del mes. Imprescindible si el manager hizo
        # cambios desde el último cron diario.
        try:
            from ..cron_descuentos_auto import recalcular_descuentos_auto
            recalcular_descuentos_auto(g.id_manager)
        except Exception as _e:
            log.warning(f'recalcular_descuentos_auto pre-emisión: {_e}')

        company_id = _company_id()
        o = _odoo()

        # Subs activas
        subs = o._call('round.subscription', 'search_read',
            [('estado', '=', 'activa'), ('company_id', '=', company_id)],
            ['id', 'partner_id', 'cuota_id', 'periodicidad', 'forma_pago',
             'fecha_inicio', 'fecha_fin'])

        # Cuotas catálogo
        cuotas = o._call('round.cuota.catalogo', 'search_read', [],
            ['id', 'codigo', 'descripcion',
             'precio_mensual', 'precio_trimestral', 'precio_semestral', 'precio_anual'])
        cuotas_by_id = {c['id']: c for c in cuotas}

        # Partners
        pids = list(set(s['partner_id'][0] for s in subs if s.get('partner_id')))
        partners = o._call('res.partner', 'read', pids,
            ['id', 'name', 'id_noofit', 'email', 'active'])
        partners_by_id = {p['id']: p for p in partners}

        # Forma de pago activa por cliente
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT cliente_idnoofit, forma_pago, iban
                  FROM forma_pago_cliente
                 WHERE id_manager=%s AND estado='activa'
            """, (str(g.id_manager),))
            fp_by_idnoofit = {r['cliente_idnoofit']: r for r in cur.fetchall()}

        # Idempotencia 1: recibos del MISMO periodo (mes de emisión). Incluye
        # todos los orígenes (cron_emision, manual, etc.) y todos los estados
        # no anulados — basta con que exista uno del mes para no emitir otro.
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT cliente_idnoofit, id FROM recibo
                 WHERE id_manager=%s AND periodo=%s
                   AND estado IN ('emitido','pagado','facturado','impagado')
            """, (str(g.id_manager), mes))
            ya_existen = {r['cliente_idnoofit']: r['id'] for r in cur.fetchall()}

        # Idempotencia 2: recibos PAGADOS cuya `fecha_hasta` se extiende más
        # allá del último día del mes de emisión (típico de pagos trimestrales,
        # semestrales o anuales). Si el cliente ya pagó hasta una fecha
        # posterior al mes que estamos emitiendo, NO se le emite otro.
        target_y_tmp, target_m_tmp = map(int, mes.split('-'))
        if target_m_tmp == 12:
            ultimo_dia_mes_emision = dt.date(target_y_tmp, 12, 31)
        else:
            ultimo_dia_mes_emision = (
                dt.date(target_y_tmp, target_m_tmp + 1, 1) - dt.timedelta(days=1))
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT cliente_idnoofit FROM recibo
                 WHERE id_manager=%s
                   AND estado IN ('pagado','emitido','facturado')
                   AND fecha_hasta IS NOT NULL
                   AND fecha_hasta > %s
            """, (str(g.id_manager), ultimo_dia_mes_emision))
            ya_cubiertos_post_mes = {r['cliente_idnoofit'] for r in cur.fetchall()}

        # Clientes con baja efectiva el día 1 del mes que se emite. No
        # importa si `cliente_baja_programada.ejecutada_at` está NULL: solo
        # cuenta `fecha_baja`. Esto permite que la regla funcione para bajas
        # que aún no ha ejecutado el cron diario (porque el día 1 del mes
        # entró antes que la noche de la fecha de baja).
        # Si el cliente estaba inactivo el día 1 → no emite recibo.
        target_y, target_m = map(int, mes.split('-'))
        primer_dia = dt.date(target_y, target_m, 1)
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT cliente_idnoofit FROM cliente_baja_programada
                 WHERE id_manager = %s AND fecha_baja <= %s
            """, (str(g.id_manager), primer_dia))
            inactivos_dia_1 = {str(r['cliente_idnoofit']) for r in cur.fetchall()}

        # Cache local NoofitPro: estado real de cada cliente.
        #   - cliente_cache.enabled = TRUE  → en alta en NF
        #   - cliente_cache.enabled = FALSE → archivado (inactivo) en NF
        #   - NO está en cliente_cache      → desvinculado (NF ya no lo
        #     devuelve para ningún trainer del manager)
        # `id_trainer` se guarda en el recibo para que la emisión sea
        # agrupable por trainer (antes se metía NULL).
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id::text AS id, id_trainer::text AS id_trainer, enabled
                  FROM cliente_cache WHERE id_manager=%s
            """, (str(g.id_manager),))
            cache_rows = cur.fetchall()
        cache_idnoofit_enabled = {r['id']: bool(r['enabled']) for r in cache_rows}
        cache_idnoofit_trainer = {r['id']: r['id_trainer'] for r in cache_rows}

        # Filtrar subs que tocan + agrupar por cliente
        # Skipea clientes que estaban inactivos el día 1 del mes (regla
        # de baja programada), inactivos en NF o desvinculados.
        # Agrupación por id_noofit (no partner_id) para deduplicar partners
        # duplicados en Odoo con el mismo cliente NoofitPro.
        por_cliente = defaultdict(list)
        canonico_por_idn = {}    # idnoofit → partner_id canónico (menor id)
        skipped_baja = 0
        skipped_inactivo_nf = 0
        skipped_desvinculado = 0
        for s in subs:
            if not _toca_emitir(s, mes): continue
            pid = s['partner_id'][0] if s.get('partner_id') else None
            if not pid: continue
            partner = partners_by_id.get(pid) or {}
            idnoofit = str(partner.get('id_noofit') or '')
            if not idnoofit: continue
            if idnoofit in inactivos_dia_1:
                skipped_baja += 1
                continue
            # Cliente_cache: comprueba estado real en NoofitPro.
            if idnoofit not in cache_idnoofit_enabled:
                # No está en cache de ningún trainer del manager = desvinculado.
                skipped_desvinculado += 1
                continue
            if not cache_idnoofit_enabled[idnoofit]:
                # enabled=False en NoofitPro = archivado/inactivo.
                skipped_inactivo_nf += 1
                continue
            # Dedup por idnoofit: si ya hay un canónico, añadir al suyo.
            existente = canonico_por_idn.get(idnoofit)
            if existente is None:
                canonico_por_idn[idnoofit] = pid
                por_cliente[pid].append(s)
            elif pid < existente:
                # Cambiar canónico al pid menor.
                por_cliente[pid] = por_cliente.pop(existente) + [s]
                canonico_por_idn[idnoofit] = pid
            else:
                por_cliente[existente].append(s)
        if skipped_baja:
            log.info(f'preemision {mes}: {skipped_baja} subs saltadas por baja efectiva día 1')
        if skipped_inactivo_nf:
            log.info(f'preemision {mes}: {skipped_inactivo_nf} subs saltadas por cliente inactivo en NoofitPro')
        if skipped_desvinculado:
            log.info(f'preemision {mes}: {skipped_desvinculado} subs saltadas por cliente desvinculado (no en cache)')

        # Pre-cómputo para descuentos "familiares":
        #   1) cuotas activas (de TODAS las subs activas, no solo las que tocan)
        #      por idnoofit — sirve para contar "miembros con la cuota X".
        #   2) familias del manager (familia_id → [idnoofit])
        #   3) descuentos tipo='familiares' del manager
        cuotas_activas_by_idnoofit = defaultdict(set)
        for s in subs:
            pid = s['partner_id'][0] if s.get('partner_id') else None
            if not pid: continue
            partner = partners_by_id.get(pid, {})
            idn = partner.get('id_noofit')
            if not idn: continue
            cuota = cuotas_by_id.get(s['cuota_id'][0]) if s.get('cuota_id') else None
            if cuota and cuota.get('codigo'):
                cuotas_activas_by_idnoofit[idn].add(cuota['codigo'])

        familia_por_cliente = {}   # idnoofit → [idnoofit_miembro,...]
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT m.cliente_idnoofit AS yo, ARRAY(
                    SELECT cliente_idnoofit FROM familia_miembro mm
                     WHERE mm.familia_id = m.familia_id
                ) AS miembros
                  FROM familia_miembro m
                 WHERE m.id_manager = %s
            """, (str(g.id_manager),))
            for r in cur.fetchall():
                familia_por_cliente[r['yo']] = r.get('miembros') or []

        from ..descuentos_apply import (
            calcular_precio_con_descuentos, aplicar_descuentos_familiares,
            get_descuentos_familiares_activos,
            aplicar_descuentos_varias_cuotas_auto,
            get_descuentos_varias_cuotas_activos,
        )
        descuentos_familiares = get_descuentos_familiares_activos(g.id_manager)
        # Cargamos los descuentos `varias_cuotas` UNA vez por emisión —
        # son automáticos: se aplican a cualquier cliente que cumpla
        # condiciones (req + secundaria activa) sin necesitar asignación
        # manual al cliente.
        descuentos_varias = get_descuentos_varias_cuotas_activos(g.id_manager)

        # Iterar
        creados = []
        skipped_ya = 0
        skipped_ya_cubierto = 0   # paid recibo con fecha_hasta > fin del mes
        skipped_nf_inactivo = 0
        skipped_sin_fp = 0
        skipped_sin_subs = 0

        actor = actor_from_request()
        actor_label = actor.get('label') or actor.get('email') or 'API'

        for pid, subs_cliente in por_cliente.items():
            partner = partners_by_id.get(pid, {})
            idnoofit = partner.get('id_noofit') or ''
            nombre = partner.get('name') or '?'
            if not idnoofit:
                continue

            # Idempotencia 1: recibo del mismo mes ya existe
            if idnoofit in ya_existen:
                skipped_ya += 1
                continue

            # Idempotencia 2: el cliente ya pagó hasta una fecha POSTERIOR
            # al mes de emisión (típico trimestral/anual). No emitir otro.
            if idnoofit in ya_cubiertos_post_mes:
                skipped_ya_cubierto += 1
                continue

            # Cliente NF inactivo → no emite
            # (El partner Odoo puede no estar sincronizado con NF.enabled, asumimos que la sub activa = OK)
            # Comprobamos forma_pago
            fp = fp_by_idnoofit.get(idnoofit)
            if not fp:
                skipped_sin_fp += 1
                continue
            forma_pago = fp['forma_pago']

            # Calcular importe unión (suma de subs que tocan) APLICANDO
            # los descuentos activos del cliente (porcentaje, importe,
            # varias_cuotas, precio_combo legacy) + modificaciones puntuales
            # (descuento, cargo_extra, precio_alternativo) vigentes en el mes
            # + descuentos automáticos por familia.
            from ..modificaciones_apply import (
                get_modificaciones_activas_mes, aplicar_modif_a_cuota,
                aplicar_modif_globales, marcar_modificaciones_aplicadas,
                resumen_aplicadas,
            )
            # Set de códigos de cuotas activas del cliente — necesario para
            # validar la condición de 'varias_cuotas' (cliente tiene cuota
            # requerida X + cuota aplicada Y).
            cuotas_activas_cli = cuotas_activas_by_idnoofit.get(idnoofit, set())

            # Cuotas por miembro de la familia (para descuento 'familiares')
            miembros_fam = familia_por_cliente.get(idnoofit) or []
            cuotas_por_familiar = {
                idn: cuotas_activas_by_idnoofit.get(idn, set())
                for idn in miembros_fam
            }

            # Modificaciones del cliente vigentes en el mes (una sola query)
            modifs_mes = get_modificaciones_activas_mes(g.id_manager, idnoofit, mes)

            total_eur = 0
            cuota_codigos = []
            cuota_descripciones = []
            descuentos_aplicados = []   # para trazabilidad en notas
            modif_ids_consumidos = []   # ids a marcar 'aplicada' tras crear el recibo
            modif_info_por_cuota = []
            for s in subs_cliente:
                cuota = cuotas_by_id.get(s['cuota_id'][0]) if s.get('cuota_id') else None
                if not cuota: continue
                p_normal = _precio_para(cuota, s.get('periodicidad', 'mensual'))
                # 1) Descuentos del catálogo asignados al cliente
                #    (porcentaje/importe — varias_cuotas YA no entra aquí
                #    desde mayo 2026, se aplica en el paso 2b automático)
                p_tras_desc, info_desc = calcular_precio_con_descuentos(
                    g.id_manager, idnoofit, cuota.get('codigo'), p_normal,
                    cuotas_activas_codigos=cuotas_activas_cli)
                # 2a) Descuento AUTOMÁTICO por "dos cuotas" (varias_cuotas):
                #     se aplica si el cliente tiene la cuota requerida + la
                #     secundaria activa, SIN necesitar asignación manual.
                p_tras_varias, info_varias = aplicar_descuentos_varias_cuotas_auto(
                    g.id_manager, idnoofit, cuota.get('codigo'), p_tras_desc,
                    cuotas_activas_codigos=cuotas_activas_cli,
                    descuentos_varias=descuentos_varias)
                # 2b) Descuento AUTOMÁTICO por familia (≥2 miembros con la
                #     cuota indicada — no requiere asignación).
                p_tras_fam, info_fam = aplicar_descuentos_familiares(
                    g.id_manager, idnoofit, cuota.get('codigo'), p_tras_varias,
                    cuotas_por_familiar,
                    descuentos_familiares=descuentos_familiares)
                # 3) Modificaciones puntuales para esta cuota concreta —
                # match por código (los IDs locales no coinciden con Odoo).
                p_final, info_mod, ids_mod = aplicar_modif_a_cuota(
                    modifs_mes, cuota['id'], p_tras_fam,
                    cuota_codigo=cuota.get('codigo'))
                total_eur += p_final
                cuota_codigos.append(cuota.get('codigo'))
                if info_desc:
                    descuentos_aplicados.extend(info_desc)
                if info_varias:
                    descuentos_aplicados.extend(info_varias)
                if info_fam:
                    descuentos_aplicados.extend(info_fam)
                if info_mod:
                    modif_info_por_cuota.append(info_mod)
                    modif_ids_consumidos.extend(ids_mod)
                if info_desc or info_fam or info_mod:
                    cuota_descripciones.append(
                        f"{cuota.get('codigo')} ({s.get('periodicidad')}) "
                        f"{p_normal}€→{p_final}€"
                    )
                else:
                    cuota_descripciones.append(f"{cuota.get('codigo')} ({s.get('periodicidad')})")

            # 3) Modificaciones globales (sin cuota_id) sobre el total
            total_eur, info_global, ids_global = aplicar_modif_globales(
                modifs_mes, total_eur)
            modif_ids_consumidos.extend(ids_global)

            if total_eur <= 0:
                skipped_sin_subs += 1
                continue

            base, iva = _split_iva(total_eur, 21.0)

            # Estado: SEPA/tarjeta_token = pagado al emitir, resto = impagado
            estado = 'pagado' if forma_pago in ('sepa', 'tarjeta_token') else 'impagado'
            fecha_emision = f'{mes}-01'
            fecha_pago = fecha_emision if estado == 'pagado' else None
            # Cobertura: emisión + N meses según periodicidad de la sub
            # principal. Crítico para que trimestrales / semestrales / anuales
            # bloqueen futuros recibos via `ya_cubiertos_post_mes`.
            periodicidad_recibo = subs_cliente[0].get('periodicidad', 'mensual')
            fecha_hasta_calc = _calc_fecha_hasta(fecha_emision, periodicidad_recibo)

            # Periodo en formato YYYY-MM (sirve también para recibos trimestrales:
            # se guarda el mes de emisión; la cobertura efectiva queda implícita en
            # el campo periodicidad de las subs)
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO recibo
                      (id_manager, id_trainer, cliente_idnoofit, cliente_nombre,
                       cuota_codigo, cuota_descripcion,
                       periodo, fecha_desde, fecha_hasta, periodicidad,
                       importe_base, importe_iva, importe_total, iva_pct,
                       metodo_pago, estado, fecha_emision, fecha_pago,
                       origen, origen_ref, notas, created_by, updated_by)
                    VALUES (%s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s,
                            %s, %s, %s, 21.00,
                            %s, %s, %s, %s,
                            'cron_emision', NULL, %s, %s, %s)
                    RETURNING id
                """, (
                    str(g.id_manager),
                    cache_idnoofit_trainer.get(idnoofit),  # id_trainer real del cliente
                    idnoofit, nombre,
                    ','.join(cuota_codigos),
                    ' + '.join(cuota_descripciones),
                    mes, fecha_emision, fecha_hasta_calc,
                    periodicidad_recibo,
                    base, iva, total_eur,
                    forma_pago, estado, fecha_emision, fecha_pago,
                    f'Recibo unión: {len(subs_cliente)} sub(s) · forma_pago activa: {forma_pago}'
                    + (' · descuentos: ' + ', '.join(
                        f"{x['descuento_codigo']} ({x['precio_antes']}€→{x['precio_despues']}€)"
                        for x in descuentos_aplicados) if descuentos_aplicados else '')
                    + (' · modificaciones: ' + resumen_aplicadas(modif_info_por_cuota, info_global)
                        if (modif_info_por_cuota or info_global) else ''),
                    actor_label, actor_label,
                ))
                rid = cur.fetchone()['id']

            # Marcar modificaciones consumidas como 'aplicada' (no se reusan)
            if modif_ids_consumidos:
                marcar_modificaciones_aplicadas(modif_ids_consumidos, recibo_id=rid)

            creados.append({
                'id': rid, 'cliente': nombre, 'idnoofit': idnoofit,
                'importe': total_eur, 'estado': estado,
                'forma_pago': forma_pago, 'cuotas': cuota_codigos,
                'descuentos': [
                    f"{x['descuento_codigo']} ({x['precio_antes']}€→{x['precio_despues']}€)"
                    for x in descuentos_aplicados
                ] if descuentos_aplicados else [],
                'modificaciones': resumen_aplicadas(modif_info_por_cuota, info_global)
                                  if (modif_info_por_cuota or info_global) else '',
            })

        # ── Definitivizar borradores manuales del mes ───────────────────────
        # Los recibos creados manualmente desde "Recibos manuales" (estado=
        # 'borrador_remesa') pasan ahora a su estado FINAL según su método de
        # pago, igual que los auto-generados:
        #   - sepa / tarjeta_tok → estado='pagado' (el cobro Odoo se crea
        #     luego al pulsar "Emitir")
        #   - resto              → estado='impagado'
        # Set fecha_emision si no la tenía. Idempotente: si no quedan
        # borradores, no toca nada.
        PAGADOS_AL_EMITIR = {'sepa', 'tarjeta_tok'}
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id, metodo_pago, fecha_emision FROM recibo
                 WHERE id_manager=%s AND periodo=%s
                   AND estado='borrador_remesa'
            """, (str(g.id_manager), mes))
            borradores = cur.fetchall()
        manuales_definitivizados = 0
        for b in borradores:
            nuevo_estado = 'pagado' if b['metodo_pago'] in PAGADOS_AL_EMITIR else 'impagado'
            nueva_emision = b['fecha_emision'] or dt.date.fromisoformat(f'{mes}-01')
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""
                    UPDATE recibo
                       SET estado=%s, fecha_emision=%s, updated_by=%s
                     WHERE id=%s AND estado='borrador_remesa'
                """, (nuevo_estado, nueva_emision, actor_label, b['id']))
            manuales_definitivizados += 1

        log_action(actor, entidad='recibo_lote', entidad_id=mes, accion='preemision_v2',
                   resumen=(f'Preemisión {mes}: {len(creados)} recibos · '
                            f'{manuales_definitivizados} manuales definitivos · '
                            f'{skipped_ya} ya · {skipped_ya_cubierto} ya_cubierto · '
                            f'{skipped_inactivo_nf} inactivos · '
                            f'{skipped_desvinculado} desvinculados · '
                            f'{skipped_sin_fp} sin forma_pago'))

        # Breakdown por trainer (cuántos recibos y cuánto importe)
        from collections import defaultdict as _dd
        por_trainer = _dd(lambda: {'n': 0, 'importe': 0.0})
        for c in creados:
            t = cache_idnoofit_trainer.get(c.get('idnoofit')) or 'sin_trainer'
            por_trainer[t]['n'] += 1
            por_trainer[t]['importe'] += float(c.get('importe') or 0)
        por_trainer_out = {t: {'n': v['n'], 'importe': round(v['importe'], 2)}
                           for t, v in por_trainer.items()}

        return jsonify({
            'ok': True, 'mes': mes,
            'creados': len(creados),
            'manuales_definitivizados': manuales_definitivizados,
            'skipped_ya_existentes': skipped_ya,
            'skipped_ya_cubierto_post_mes': skipped_ya_cubierto,
            'skipped_inactivo_nf': skipped_inactivo_nf,
            'skipped_desvinculado': skipped_desvinculado,
            'skipped_baja_efectiva_dia_1': skipped_baja,
            'skipped_sin_forma_pago': skipped_sin_fp,
            'skipped_sin_subs': skipped_sin_subs,
            'por_trainer': por_trainer_out,
            'detalle': creados[:50],
        })
    except Exception as e:
        log.exception('preemision_v2.generar')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<mes>', methods=['GET'])
@auth_required
def listar(mes):
    """Lista los recibos del mes (origen=cron_emision).

    Incluye las notas (con desglose de descuentos / modificaciones aplicados)
    y la descripción de cuotas, para que la UI los pueda mostrar.
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, cliente_idnoofit, cliente_nombre, cuota_codigo,
                   cuota_descripcion,
                   importe_base, importe_iva, importe_total,
                   metodo_pago, estado, fecha_emision, fecha_pago,
                   account_payment_id, notas
              FROM recibo
             WHERE id_manager=%s AND periodo=%s AND origen='cron_emision'
             ORDER BY estado DESC, cliente_nombre
        """, (str(g.id_manager), mes))
        rows = cur.fetchall()
    return jsonify({'ok': True, 'recibos': rows, 'count': len(rows)})


@bp.route('/<mes>/recibo/<int:rid>', methods=['DELETE'])
@auth_required
def borrar_recibo(mes, rid):
    """Borra un recibo borrador del mes (solo si no tiene account_payment_id)."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT estado, account_payment_id FROM recibo
             WHERE id_manager=%s AND id=%s AND periodo=%s AND origen='cron_emision'
        """, (str(g.id_manager), rid, mes))
        r = cur.fetchone()
        if not r: return jsonify({'ok': False, 'error': 'not_found'}), 404
        if r['account_payment_id']:
            return jsonify({'ok': False, 'error': 'tiene_pago_asociado'}), 400
        cur.execute("DELETE FROM recibo WHERE id_manager=%s AND id=%s",
                    (str(g.id_manager), rid))
    log_action(actor_from_request(), entidad='recibo', entidad_id=rid, accion='delete_preemision')
    return jsonify({'ok': True})
