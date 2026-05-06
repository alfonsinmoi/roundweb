"""Extractor LLM para documentos contables.

Usa Claude CLI headless (mismo patrón que carajfam) para extraer campos
estructurados de PDFs / imágenes de facturas, nóminas, extractos e impuestos.

Requisitos en el VPS:
  - `claude` CLI instalado (/usr/local/bin/claude)
  - El user que ejecuta tiene HOME con `.claude.json` autenticado.
    Para round_config_api (user=odoo): HOME=/opt/odoo17

Estrategia:
  1. Build prompt incluyendo el catálogo de categorías del manager.
  2. Llamada a `claude -p "..." --add-dir <carpeta_doc>` con timeout.
  3. Parsear JSON respuesta.
  4. Validar matemática (base + iva ≈ total ±0.05).
  5. Devolver dict con campos + confidence.

Si claude no está disponible o falla, devolvemos un dict con
`extraction_failed=True` y la app sigue funcionando (el user rellena a mano).
"""
import os
import json
import re
import logging
import subprocess
from pathlib import Path

log = logging.getLogger(__name__)

CLAUDE_BIN = '/usr/local/bin/claude'
CLAUDE_HOME = '/opt/odoo17'   # donde vive el .claude.json del user odoo
CLAUDE_TIMEOUT = 90           # segundos


def _build_prompt(categorias: list, filename: str) -> str:
    """Construye el prompt con el catálogo de categorías para que el LLM
    sugiera la mejor coincidencia."""
    cats_lines = []
    for c in categorias:
        if not c.get('activa'): continue
        nm = c.get('nombre', '')
        co = c.get('codigo', '')
        tp = c.get('tipo', '')
        cats_lines.append(f"  - {co} ({tp}): {nm}")
    cats_str = '\n'.join(cats_lines) or '  (sin categorías definidas)'

    return f"""Eres un asistente experto en contabilidad española. Tu tarea es extraer
campos estructurados del documento contable adjunto: {filename}

Tipos posibles de documento (campo "tipo_documento"):
  - factura       (factura de gasto recibida de un proveedor)
  - nomina        (nómina mensual de empleado)
  - extracto      (extracto bancario)
  - impuesto      (modelo 303/111/200/111/etc, recibo Seg.Social, autónomo)
  - otro

Subtipo SOLO para tipo_documento='factura' (campo "subtipo"):
  - factura       (factura COMPLETA: lleva razón social + CIF tanto del
                   emisor COMO del receptor/cliente)
  - ticket        (factura SIMPLIFICADA o ticket: NO lleva datos del
                   receptor — típico comercio menor, parking, gasolineras,
                   restaurantes pequeños, supermercados)
  - otro          (cuando no aplica)

Catálogo de categorías disponibles del manager (codigo, tipo, nombre):
{cats_str}

Extrae los siguientes campos del documento. Devuelve EXCLUSIVAMENTE un objeto
JSON (sin markdown, sin texto explicativo), con esta forma exacta:

{{
  "tipo_documento": "factura|nomina|extracto|impuesto|otro",
  "subtipo": "factura|ticket|otro",
  "categoria_codigo_sugerida": "<codigo del catálogo o null>",
  "proveedor": "<razón social del EMISOR>",
  "proveedor_vat": "<CIF/NIF/NIE del EMISOR, formato ESxxxxxxx o null>",
  "recipiente_nombre": "<razón social del RECEPTOR/cliente, null si es ticket>",
  "recipiente_vat": "<CIF/NIF/NIE del RECEPTOR, null si es ticket>",
  "num_factura": "<número de factura/recibo o null>",
  "fecha_documento": "YYYY-MM-DD",
  "periodo": "YYYY-MM o YYYY-T1..T4 o null",
  "importe_base": 0.00,
  "importe_iva": 0.00,
  "importe_total": 0.00,
  "iva_pct": 21.00,
  "concepto": "<descripción breve, máx 200 chars>",
  "confidence": 0.85,
  "notes": "<dudas/observaciones, vacío si todo OK>"
}}

Reglas:
- importe_base + importe_iva == importe_total (±0.05). Si no cuadra, marca
  confidence < 0.7 y explica en notes.
- Para nóminas: importe_base = bruto, importe_iva = retenciones (suma IRPF +
  SS empleado), importe_total = líquido a cobrar.
- Para extractos bancarios: deja casi todos los campos null y escribe en
  notes "extracto: N movimientos del DD/MM/YYYY al DD/MM/YYYY".
- Si no encuentras un campo, ponlo a null (no inventes).
- iva_pct: si no aparece explícito, deduce de base/total (ej. 21%, 10%, 4%, 0%).
- categoria_codigo_sugerida: elige el código que mejor case con el documento.
  Si dudas, prefiere null antes que inventar.
- subtipo: marca "ticket" SOLO si el documento NO identifica al receptor
  (no aparece nombre/razón social ni CIF del cliente). Si aparece cualquier
  dato del receptor, márcalo como "factura".

Responde SOLO con el JSON. Sin texto antes ni después."""


def _run_claude(prompt: str, file_path: Path) -> str:
    """Ejecuta claude CLI con --add-dir apuntando al directorio del archivo."""
    if not Path(CLAUDE_BIN).exists():
        raise RuntimeError('claude CLI no disponible')

    env = {
        **os.environ,
        'HOME': CLAUDE_HOME,
        # Anthropic respeta XDG_CONFIG_HOME si no, usa HOME/.claude
    }
    try:
        res = subprocess.run(
            [CLAUDE_BIN, '-p', prompt + f"\n\nThe file to analyze is: {file_path.name}",
             '--output-format', 'text',
             '--permission-mode', 'bypassPermissions',
             '--add-dir', str(file_path.parent)],
            cwd=str(file_path.parent),
            env=env,
            capture_output=True,
            text=True,
            timeout=CLAUDE_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f'claude CLI timeout ({CLAUDE_TIMEOUT}s)')

    if res.returncode != 0:
        tail = (res.stderr or '')[-500:]
        raise RuntimeError(f'claude CLI failed rc={res.returncode}: {tail}')
    return res.stdout.strip()


def _parse_json_response(text: str) -> dict:
    """Extrae JSON del output. Tolera prefijo/sufijo extra (markdown, etc.)."""
    if not text:
        raise ValueError('respuesta vacía')
    # Si viene en bloque markdown ```json ... ```
    m = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if m:
        text = m.group(1)
    else:
        # Intentar agarrar el primer objeto JSON balanceado
        start = text.find('{')
        end = text.rfind('}')
        if start >= 0 and end > start:
            text = text[start:end+1]
    return json.loads(text)


def _validate_math(d: dict) -> dict:
    """Verifica que base + iva ≈ total. Si no, baja confidence."""
    try:
        base = float(d.get('importe_base') or 0)
        iva  = float(d.get('importe_iva')  or 0)
        tot  = float(d.get('importe_total') or 0)
        if tot > 0 and abs(base + iva - tot) > 0.05:
            d['confidence'] = min(float(d.get('confidence', 0.5)), 0.6)
            existing = d.get('notes') or ''
            d['notes'] = (f'⚠️ Math mismatch: {base:.2f}+{iva:.2f}={base+iva:.2f}'
                          f' != {tot:.2f}. {existing}').strip()
    except Exception:
        pass
    return d


# ── API pública ─────────────────────────────────────────────────────────────

def extract_from_file(file_path: Path, categorias: list) -> dict:
    """Devuelve el dict extraído + estado.

    Si el LLM no está disponible o falla, devuelve:
      {'extraction_failed': True, 'error': '...', 'raw': None}

    Si OK:
      {tipo_documento, categoria_codigo_sugerida, proveedor, proveedor_vat,
       num_factura, fecha_documento, periodo, importe_base, importe_iva,
       importe_total, iva_pct, concepto, confidence, notes,
       extraction_failed: False, raw: <texto crudo del LLM>}
    """
    if not file_path.exists():
        return {'extraction_failed': True, 'error': 'archivo no existe', 'raw': None}

    try:
        prompt = _build_prompt(categorias or [], file_path.name)
        raw = _run_claude(prompt, file_path)
    except Exception as e:
        log.warning(f'extract_from_file claude error: {e}')
        return {'extraction_failed': True, 'error': str(e), 'raw': None}

    try:
        data = _parse_json_response(raw)
    except Exception as e:
        log.warning(f'extract_from_file parse error: {e} raw={raw[:300]}')
        return {
            'extraction_failed': True,
            'error': f'parse_json: {e}',
            'raw': raw[:2000],
        }

    data = _validate_math(data)
    data['extraction_failed'] = False
    data['raw'] = raw[:2000]
    return data
