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

        # Recibos ya existentes en este periodo (idempotencia)
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT cliente_idnoofit, id FROM recibo
                 WHERE id_manager=%s AND periodo=%s AND origen='cron_emision'
            """, (str(g.id_manager), mes))
            ya_existen = {r['cliente_idnoofit']: r['id'] for r in cur.fetchall()}

        # Filtrar subs que tocan + agrupar por cliente
        por_cliente = defaultdict(list)
        for s in subs:
            if not _toca_emitir(s, mes): continue
            pid = s['partner_id'][0] if s.get('partner_id') else None
            if pid: por_cliente[pid].append(s)

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
        )
        descuentos_familiares = get_descuentos_familiares_activos(g.id_manager)

        # Iterar
        creados = []
        skipped_ya = 0
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

            # Idempotencia
            if idnoofit in ya_existen:
                skipped_ya += 1
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
                p_tras_desc, info_desc = calcular_precio_con_descuentos(
                    g.id_manager, idnoofit, cuota.get('codigo'), p_normal,
                    cuotas_activas_codigos=cuotas_activas_cli)
                # 2) Descuento automático por familia (si ≥2 miembros con la cuota)
                p_tras_fam, info_fam = aplicar_descuentos_familiares(
                    g.id_manager, idnoofit, cuota.get('codigo'), p_tras_desc,
                    cuotas_por_familiar,
                    descuentos_familiares=descuentos_familiares)
                # 3) Modificaciones puntuales para esta cuota concreta
                p_final, info_mod, ids_mod = aplicar_modif_a_cuota(
                    modifs_mes, cuota['id'], p_tras_fam)
                total_eur += p_final
                cuota_codigos.append(cuota.get('codigo'))
                if info_desc:
                    descuentos_aplicados.extend(info_desc)
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
                    str(g.id_manager), None, idnoofit, nombre,
                    ','.join(cuota_codigos),
                    ' + '.join(cuota_descripciones),
                    mes, fecha_emision, None,
                    subs_cliente[0].get('periodicidad', 'mensual'),
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

        log_action(actor, entidad='recibo_lote', entidad_id=mes, accion='preemision_v2',
                   resumen=f'Preemisión {mes}: {len(creados)} recibos · {skipped_ya} ya · {skipped_sin_fp} sin forma_pago')

        return jsonify({
            'ok': True, 'mes': mes,
            'creados': len(creados),
            'skipped_ya_existentes': skipped_ya,
            'skipped_sin_forma_pago': skipped_sin_fp,
            'skipped_sin_subs': skipped_sin_subs,
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
