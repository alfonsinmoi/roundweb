"""Generación del fichero SEPA pain.008.001.02 (Direct Debit B2C / CORE).

Replica el formato GestPlus (verificado contra BT MALAGA mayo 2026):
  - xmlns urn:iso:std:iso:20022:tech:xsd:pain.008.001.02 (sin namespaces extra)
  - SvcLvl=SEPA, LclInstrm=CORE, SeqTp=RCUR, ChrgBr=SLEV, PmtMtd=DD
  - BIC=NOTPROVIDED (los bancos españoles lo deducen del IBAN)
  - MndtId derivado del DNI: `MA` + últimos 7 dígitos + `26` (sufijo institución)
  - DtOfSgntr FIJO `2009-10-31` (fecha histórica adhesión SEPA, igual GP)
  - AmdmntInd false
  - Ustrd con `MES:<m>,<DNI> C:<recibo_id>/<cuota>` (estilo GP)

Acreedor: viene de `centro_contacto` (CIF, razón social, IBAN cobro,
Creditor SEPA ID). Ya configurado para el manager 17675 (B72349137 - Best
Training Rincón Victoria SL).

Endpoint:
  POST /api/cuotas/sepa/<mes>      Genera pain.008 del mes y lo devuelve.
"""
import re
import logging
import datetime as dt
from xml.etree import ElementTree as ET
from xml.etree.ElementTree import Element, SubElement, tostring

from flask import Blueprint, request, jsonify, g, Response

from ..auth import auth_required, require_permission
from ..db import get_conn
from ..odoo_alta import OdooAlta
from ..audit_log import log_action, actor_from_request

bp = Blueprint('sepa', __name__)
log = logging.getLogger(__name__)


# Constantes según convención GP / práctica española
SEPA_NS = 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.02'
FECHA_FIRMA_MANDATO_HISTORICA = '2009-10-31'  # igual que GestPlus BT MALAGA
BIC_NOTPROVIDED = 'NOTPROVIDED'


# ─── Helpers ─────────────────────────────────────────────────────────────────
def _solo_digitos(s):
    return re.sub(r'\D', '', str(s or ''))


def _mandate_id(dni, cliente_idnoofit):
    """Construye el MndtId siguiendo la convención GestPlus:
       `MA` + últimos 7 dígitos del DNI + `26` (sufijo fijo de la institución).
       Si no hay DNI numérico, fallback a `ROUND-NF<idnoofit>RM`.
    """
    digits = _solo_digitos(dni)
    if len(digits) >= 7:
        return f'MA{digits[-7:]}26'
    # Fallback: cliente sin DNI legible → ref derivada del id NoofitPro
    return f'ROUND-NF{cliente_idnoofit}RM'


def _pad_left(s, width):
    return str(s).rjust(width)


def _format_eur(v):
    return f'{float(v or 0):.2f}'


def _xml_pretty(root):
    """Devuelve XML como string sin saltos (formato GP).

    Replica EXACTAMENTE la declaración XML de GestPlus para máxima
    compatibilidad bancaria:
      `<?xml version="1.0" encoding="UTF-8" standalone="no"?>`
    (ElementTree por defecto emite `version='1.0'` con comillas simples
    y sin `standalone`, y algunos validadores bancarios lo rechazan).
    """
    body = tostring(root, encoding='UTF-8', xml_declaration=False,
                    short_empty_elements=False)
    header = b'<?xml version="1.0" encoding="UTF-8" standalone="no"?>'
    return header + body


# ─── Fetch helpers ───────────────────────────────────────────────────────────
def _datos_acreedor(id_manager, id_trainer=None):
    """Datos del acreedor SEPA. POLÍTICA (mayo 2026): por defecto manager-wide.

    Si todos los centros del manager con datos SEPA comparten el mismo
    (cif, iban_cobro, sepa_creditor_id), devolvemos uno cualquiera — el
    acreedor es único para todos los trainers. Si difieren entre centros,
    devolvemos `(None, lista_acreedores_distintos)` y el endpoint reportará
    al cliente que tiene que pasar `id_trainer` explícito.

    Si se pasa `id_trainer` explícito, devolvemos el de ese centro solo.

    Retorna: (acreedor_row | None, error_msg | None)
    """
    with get_conn() as conn, conn.cursor() as cur:
        sql = """SELECT id_trainer, nombre_centro, cif, razon_social,
                        iban_cobro, bic, sepa_creditor_id
                   FROM centro_contacto
                  WHERE id_manager=%s AND iban_cobro IS NOT NULL
                    AND sepa_creditor_id IS NOT NULL AND cif IS NOT NULL"""
        vals = [str(id_manager)]
        if id_trainer:
            sql += ' AND id_trainer=%s'
            vals.append(str(id_trainer))
        sql += ' ORDER BY id_trainer'
        cur.execute(sql, vals)
        rows = cur.fetchall()
    if not rows:
        return None, 'sin_datos_sepa_empresa'
    # Si hay varios, comprobar que comparten el mismo acreedor jurídico
    unique = {(r['cif'], r['iban_cobro'], r['sepa_creditor_id']) for r in rows}
    if len(unique) == 1:
        return rows[0], None
    # Varios acreedores distintos → pedir trainer explícito
    return None, ('multiple_creditores: los centros del manager tienen CIF / '
                  'IBAN / Creditor SEPA distintos. Llama el endpoint con '
                  '`?id_trainer=X` para generar el SEPA de un centro concreto.')


def _recibos_sepa_mes(id_manager, mes, id_trainer=None, remesa_id=None):
    """Recibos del mes pagados con SEPA — los candidatos a meter en el
    pain.008.

    POLÍTICA (mayo 2026): por defecto MANAGER-WIDE (todos los trainers del
    manager). Solo se filtra por trainer si el llamador pasa `id_trainer`
    explícito (caso multi-acreedor).

    B12c — anti re-remesa: si `remesa_id` se pasa, devuelve los recibos de ESA
    remesa (re-descarga idempotente); si no, solo los AÚN no remesados."""
    where = ["r.id_manager=%s", "r.periodo=%s",
             "r.metodo_pago='sepa'", "r.estado='pagado'"]
    vals = [str(id_manager), mes]
    if remesa_id:
        where.append('r.sepa_remesa_id=%s'); vals.append(remesa_id)
    else:
        where.append('r.sepa_remesa_id IS NULL')
    if id_trainer:
        where.append('r.id_trainer=%s')
        vals.append(str(id_trainer))
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT r.id, r.cliente_idnoofit, r.cliente_nombre,
                   r.cuota_codigo, r.importe_total, r.fecha_emision,
                   r.id_trainer,
                   fp.iban AS cliente_iban
              FROM recibo r
              LEFT JOIN forma_pago_cliente fp
                ON fp.id_manager = r.id_manager
               AND fp.cliente_idnoofit = r.cliente_idnoofit
               AND fp.estado = 'activa'
             WHERE {' AND '.join(where)}
             ORDER BY r.id
        """, vals)
        return cur.fetchall()


def _dni_por_cliente(cliente_idnoofits):
    """Devuelve {idnoofit: dni} desde Odoo res.partner.vat (limpio).
    Si el partner está duplicado, prioriza el partner con menor id."""
    if not cliente_idnoofits:
        return {}
    o = OdooAlta(); o._connect()
    rows = o._call('res.partner', 'search_read',
                   [('id_noofit', 'in', [str(i) for i in cliente_idnoofits])],
                   ['id', 'id_noofit', 'vat'])
    # Si hay duplicados, nos quedamos con el primero (menor id) por idnoofit
    seen = {}
    for r in rows:
        idn = str(r.get('id_noofit') or '')
        if idn and idn not in seen:
            seen[idn] = (r.get('vat') or '').strip().upper().replace(' ', '')
    return seen


# ─── Generador XML pain.008 ─────────────────────────────────────────────────
def _build_pain008(acreedor, recibos, dni_by_idn, mes):
    """Construye el árbol XML pain.008.001.02.

    Args:
      acreedor: row de `centro_contacto` con cif, razon_social, iban_cobro,
                sepa_creditor_id (y opcional bic).
      recibos: list[row] de recibos SEPA pagados.
      dni_by_idn: {cliente_idnoofit: dni}.
      mes: 'YYYY-MM' del periodo.

    Returns:
      (Element, stats_dict)
    """
    ahora = dt.datetime.now()
    fecha_cobro = f'{mes}-01'   # día 1 del mes (típico SEPA RCUR)
    cif = acreedor['cif']
    creditor_id = acreedor['sepa_creditor_id']
    razon_social = (acreedor['razon_social'] or acreedor['nombre_centro'] or '').upper()
    iban_acreedor = (acreedor['iban_cobro'] or '').replace(' ', '').upper()
    bic_acreedor = (acreedor.get('bic') or BIC_NOTPROVIDED).upper()

    # MsgId: estilo GP `PRE` + YYYYMMDDHHMMSS + sufijo 8 dígitos + CIF
    msg_id = f'PRE{ahora.strftime("%Y%m%d%H%M%S")}28028000{cif}'
    pmt_inf_id = f'{creditor_id}-{ahora.strftime("%Y%m%d%H%M%S0000")}'
    create_dttm = ahora.strftime('%Y-%m-%dT%H:%M:%S')

    # Totales
    total_eur = sum(float(r['importe_total'] or 0) for r in recibos)

    # Namespace por defecto (sin prefijo, como hace GP)
    ET.register_namespace('', SEPA_NS)
    doc = Element(f'{{{SEPA_NS}}}Document')
    cstmr = SubElement(doc, f'{{{SEPA_NS}}}CstmrDrctDbtInitn')

    # ─── GrpHdr ──────────────────────────────────────────────────────────────
    grp = SubElement(cstmr, f'{{{SEPA_NS}}}GrpHdr')
    SubElement(grp, f'{{{SEPA_NS}}}MsgId').text = msg_id
    SubElement(grp, f'{{{SEPA_NS}}}CreDtTm').text = create_dttm
    SubElement(grp, f'{{{SEPA_NS}}}NbOfTxs').text = str(len(recibos))
    SubElement(grp, f'{{{SEPA_NS}}}CtrlSum').text = _format_eur(total_eur)
    initg = SubElement(grp, f'{{{SEPA_NS}}}InitgPty')
    SubElement(initg, f'{{{SEPA_NS}}}Nm').text = razon_social
    org_id = SubElement(SubElement(SubElement(initg, f'{{{SEPA_NS}}}Id'),
                                   f'{{{SEPA_NS}}}OrgId'),
                        f'{{{SEPA_NS}}}Othr')
    SubElement(org_id, f'{{{SEPA_NS}}}Id').text = creditor_id

    # ─── PmtInf (un solo grupo por todo el mes, como hace GP) ────────────────
    pmt = SubElement(cstmr, f'{{{SEPA_NS}}}PmtInf')
    SubElement(pmt, f'{{{SEPA_NS}}}PmtInfId').text = pmt_inf_id
    SubElement(pmt, f'{{{SEPA_NS}}}PmtMtd').text = 'DD'
    SubElement(pmt, f'{{{SEPA_NS}}}BtchBookg').text = 'true'
    pmt_tp = SubElement(pmt, f'{{{SEPA_NS}}}PmtTpInf')
    SubElement(SubElement(pmt_tp, f'{{{SEPA_NS}}}SvcLvl'),
               f'{{{SEPA_NS}}}Cd').text = 'SEPA'
    SubElement(SubElement(pmt_tp, f'{{{SEPA_NS}}}LclInstrm'),
               f'{{{SEPA_NS}}}Cd').text = 'CORE'
    SubElement(pmt_tp, f'{{{SEPA_NS}}}SeqTp').text = 'RCUR'
    SubElement(pmt, f'{{{SEPA_NS}}}ReqdColltnDt').text = fecha_cobro
    cdtr = SubElement(pmt, f'{{{SEPA_NS}}}Cdtr')
    SubElement(cdtr, f'{{{SEPA_NS}}}Nm').text = razon_social
    SubElement(SubElement(cdtr, f'{{{SEPA_NS}}}PstlAdr'),
               f'{{{SEPA_NS}}}Ctry').text = 'ES'
    cdtr_acct = SubElement(pmt, f'{{{SEPA_NS}}}CdtrAcct')
    SubElement(SubElement(cdtr_acct, f'{{{SEPA_NS}}}Id'),
               f'{{{SEPA_NS}}}IBAN').text = iban_acreedor
    SubElement(cdtr_acct, f'{{{SEPA_NS}}}Ccy').text = 'EUR'
    cdtr_agt = SubElement(pmt, f'{{{SEPA_NS}}}CdtrAgt')
    SubElement(SubElement(cdtr_agt, f'{{{SEPA_NS}}}FinInstnId'),
               f'{{{SEPA_NS}}}BIC').text = bic_acreedor
    SubElement(pmt, f'{{{SEPA_NS}}}ChrgBr').text = 'SLEV'
    cdtr_scheme = SubElement(pmt, f'{{{SEPA_NS}}}CdtrSchmeId')
    prvt = SubElement(SubElement(SubElement(cdtr_scheme, f'{{{SEPA_NS}}}Id'),
                                 f'{{{SEPA_NS}}}PrvtId'),
                      f'{{{SEPA_NS}}}Othr')
    SubElement(prvt, f'{{{SEPA_NS}}}Id').text = creditor_id
    scheme_nm = SubElement(prvt, f'{{{SEPA_NS}}}SchmeNm')
    SubElement(scheme_nm, f'{{{SEPA_NS}}}Prtry').text = 'SEPA'

    # ─── DrctDbtTxInf (una por cada recibo SEPA) ─────────────────────────────
    saltados = []
    incluidos = 0
    sec = 0
    for r in recibos:
        idn = str(r['cliente_idnoofit'])
        iban = (r.get('cliente_iban') or '').replace(' ', '').upper()
        if not iban or iban.startswith('ES000') or len(iban) < 20:
            saltados.append({'idnoofit': idn, 'razon': 'iban_invalido'})
            continue
        sec += 1
        dni = dni_by_idn.get(idn, '')
        mndt_id = _mandate_id(dni, idn)
        # InstrId secuencial: HHMMSS-NNNN
        instr_id = f'{ahora.strftime("%Y%m%d%H%M%S")}-{sec:04d}'
        # EndToEndId ancho fijo estilo GP: `<codcli> /0000000  <MsgId-tail>`
        # GP usa codcli de su sistema. Aquí usamos el recibo BD id como referencia única.
        e2e = f'{_pad_left(r["id"], 6)} /0000000  {ahora.strftime("%Y%m%d%H%M%S")}{sec-1:04d}'

        dd = SubElement(pmt, f'{{{SEPA_NS}}}DrctDbtTxInf')
        pmt_id = SubElement(dd, f'{{{SEPA_NS}}}PmtId')
        SubElement(pmt_id, f'{{{SEPA_NS}}}InstrId').text = instr_id
        SubElement(pmt_id, f'{{{SEPA_NS}}}EndToEndId').text = e2e
        SubElement(dd, f'{{{SEPA_NS}}}InstdAmt', Ccy='EUR').text = _format_eur(r['importe_total'])
        dd_tx = SubElement(dd, f'{{{SEPA_NS}}}DrctDbtTx')
        mndt = SubElement(dd_tx, f'{{{SEPA_NS}}}MndtRltdInf')
        SubElement(mndt, f'{{{SEPA_NS}}}MndtId').text = mndt_id
        SubElement(mndt, f'{{{SEPA_NS}}}DtOfSgntr').text = FECHA_FIRMA_MANDATO_HISTORICA
        SubElement(mndt, f'{{{SEPA_NS}}}AmdmntInd').text = 'false'
        dbtr_agt = SubElement(dd, f'{{{SEPA_NS}}}DbtrAgt')
        fin_inst = SubElement(dbtr_agt, f'{{{SEPA_NS}}}FinInstnId')
        SubElement(SubElement(fin_inst, f'{{{SEPA_NS}}}Othr'),
                   f'{{{SEPA_NS}}}Id').text = BIC_NOTPROVIDED
        dbtr = SubElement(dd, f'{{{SEPA_NS}}}Dbtr')
        SubElement(dbtr, f'{{{SEPA_NS}}}Nm').text = (r['cliente_nombre'] or '').upper()
        SubElement(SubElement(dbtr, f'{{{SEPA_NS}}}PstlAdr'),
                   f'{{{SEPA_NS}}}Ctry').text = 'ES'
        SubElement(SubElement(SubElement(dd, f'{{{SEPA_NS}}}DbtrAcct'),
                              f'{{{SEPA_NS}}}Id'),
                   f'{{{SEPA_NS}}}IBAN').text = iban
        ustrd = SubElement(SubElement(dd, f'{{{SEPA_NS}}}RmtInf'),
                           f'{{{SEPA_NS}}}Ustrd')
        mes_num = int(mes.split('-')[1])
        ustrd.text = f'MES:{mes_num},{dni} C:{r["id"]}/{r["cuota_codigo"] or ""}'
        incluidos += 1

    # Recalcular CtrlSum y NbOfTxs si hubo saltados
    if saltados:
        nuevo_total = sum(float(r['importe_total'] or 0) for r in recibos
                           if r['cliente_idnoofit'] not in
                           {s['idnoofit'] for s in saltados})
        grp.find(f'{{{SEPA_NS}}}NbOfTxs').text = str(incluidos)
        grp.find(f'{{{SEPA_NS}}}CtrlSum').text = _format_eur(nuevo_total)

    stats = {
        'incluidos': incluidos,
        'saltados': saltados,
        'total_eur': _format_eur(sum(float(r['importe_total'] or 0)
                                      for r in recibos
                                      if r['cliente_idnoofit'] not in
                                      {s['idnoofit'] for s in saltados})),
        'msg_id': msg_id,
        'fecha_cobro': fecha_cobro,
    }
    return doc, stats


# ─── Endpoint ───────────────────────────────────────────────────────────────
@bp.route('/<mes>', methods=['POST', 'GET'])
@auth_required
@require_permission('economico.cuotas_mensuales.procesar_sepa')
def generar_sepa(mes):
    """Genera el fichero pain.008 SEPA del mes y lo devuelve como descarga.

    Params querystring opcionales:
      ?preview=1    devuelve JSON con stats sin descargar el XML
    """
    try:
        # POLÍTICA (jun 2026 · auditoría #22, ANULA la nota manager-wide de
        # mayo-2026): la remesa se restringe al trainer si el llamador pasa
        # `?id_trainer=X` (o `body.id_trainer`) O si la sesión actúa COMO un
        # trainer concreto (`g.id_trainer` set por impersonación / login de
        # trainer). El manager sin impersonar (g.id_trainer None y sin param)
        # sigue manager-wide. Decisión del propietario: operar como un trainer
        # aísla TODO el flujo de emisión (preemisión + emitir + SEPA).
        body_trainer = None
        try:
            body = request.get_json(silent=True) or {}
            body_trainer = (body.get('id_trainer') or '').strip() or None
        except Exception:
            pass
        target_trainer = (request.args.get('id_trainer') or '').strip() or body_trainer
        if not target_trainer and getattr(g, 'id_trainer', None):
            target_trainer = str(g.id_trainer)

        acreedor, err = _datos_acreedor(g.id_manager, target_trainer)
        if not acreedor:
            return jsonify({'ok': False,
                            'error': err or 'sin_datos_sepa_empresa',
                            'detalle': ('Configura CIF, IBAN cobro y Creditor '
                                        'SEPA ID en Configuración → Centros, '
                                        'o llama con `?id_trainer=X` si hay '
                                        'varios acreedores distintos.')}), 400
        # B12c — idempotencia de remesa: si este mes/acreedor YA se generó,
        # se RE-DESCARGA la misma (mismos adeudos) en vez de crear adeudos
        # nuevos. Evita el doble cobro bancario por generar 2 ficheros distintos.
        acreedor_scope = str(target_trainer or g.id_manager)
        with get_conn() as _c, _c.cursor() as _cur:
            _cur.execute("SELECT id FROM sepa_remesa WHERE id_manager=%s AND periodo=%s "
                         "AND id_trainer=%s ORDER BY id DESC LIMIT 1",
                         (str(g.id_manager), mes, acreedor_scope))
            _ex = _cur.fetchone()
        remesa_existente = _ex['id'] if _ex else None
        recibos = _recibos_sepa_mes(g.id_manager, mes, target_trainer,
                                    remesa_id=remesa_existente)
        if not recibos:
            return jsonify({'ok': False, 'error': 'sin_recibos_sepa',
                            'detalle': f'No hay recibos SEPA pagados en {mes} '
                                       f'pendientes de remesar.'}), 404

        idnoofits = [r['cliente_idnoofit'] for r in recibos]
        dni_by_idn = _dni_por_cliente(idnoofits)

        doc, stats = _build_pain008(acreedor, recibos, dni_by_idn, mes)
        xml_bytes = _xml_pretty(doc)

        if request.args.get('preview') == '1':
            return jsonify({'ok': True, 'mes': mes,
                            'stats': stats,
                            'acreedor': {
                                'razon_social': acreedor['razon_social'],
                                'cif': acreedor['cif'],
                                'iban_cobro': acreedor['iban_cobro'],
                                'sepa_creditor_id': acreedor['sepa_creditor_id'],
                            }})

        # B12c — sellar la remesa solo la PRIMERA vez (no en re-descargas):
        # crea sepa_remesa y marca los recibos incluidos (IBAN válido) para
        # que no puedan entrar en una remesa NUEVA y distinta → anti doble cobro.
        if not remesa_existente:
            saltados_idn = {str(s.get('idnoofit')) for s in stats.get('saltados', [])}
            incluidos_ids = [r['id'] for r in recibos
                             if str(r['cliente_idnoofit']) not in saltados_idn]
            if incluidos_ids:
                filename_sello = f'remesa_{mes}_{acreedor["cif"]}.xml'
                with get_conn() as _c, _c.cursor() as _cur:
                    _cur.execute(
                        "INSERT INTO sepa_remesa (id_manager, id_trainer, periodo, "
                        "fichero, estado) VALUES (%s,%s,%s,%s,'generada') RETURNING id",
                        (str(g.id_manager), acreedor_scope, mes, filename_sello))
                    _rid = _cur.fetchone()['id']
                    _cur.execute("UPDATE recibo SET sepa_remesa_id=%s "
                                 "WHERE id = ANY(%s) AND sepa_remesa_id IS NULL",
                                 (_rid, incluidos_ids))
                    _c.commit()

        log_action(actor_from_request(), entidad='sepa_fichero',
                   entidad_id=mes, accion='generar',
                   resumen=(f'SEPA {mes}: {stats["incluidos"]} adeudos '
                            f'· {stats["total_eur"]} € · '
                            f'{len(stats["saltados"])} saltados'))

        filename = f'remesa_{mes}_{acreedor["cif"]}.xml'
        return Response(
            xml_bytes,
            mimetype='application/xml',
            headers={
                'Content-Disposition': f'attachment; filename="{filename}"',
                'X-SEPA-Stats': f'incluidos={stats["incluidos"]};saltados={len(stats["saltados"])};total={stats["total_eur"]}',
            },
        )
    except Exception as e:
        log.exception('generar_sepa')
        return jsonify({'ok': False, 'error': str(e)}), 500
