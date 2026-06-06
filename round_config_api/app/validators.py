"""Validadores de documentos españoles (NIF/NIE/CIF) — Audit Fase 7, mayo 2026.

Compartido con `src/utils/validators.js` (mismo algoritmo). Aceptamos NIF,
NIE y CIF. Útil tanto para facturas proveedor como para validar clientes
nuevos.
"""
import re

_NIF_LETTER = 'TRWAGMYFPDXBNJZSQVHLCKE'   # módulo 23
_CIF_CONTROL = 'JABCDEFGHI'                # 0..9 → letra

_RE_NIF = re.compile(r'^\d{8}[A-Z]$')
_RE_NIE = re.compile(r'^[XYZ]\d{7}[A-Z]$')
_RE_CIF = re.compile(r'^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$')


def validate_nif(v: str) -> tuple[bool, str]:
    if not _RE_NIF.match(v):
        return False, 'formato_NIF_incorrecto'
    num, letter = v[:8], v[8]
    expected = _NIF_LETTER[int(num) % 23]
    if letter != expected:
        return False, f'letra_NIF_incorrecta (debería ser {expected})'
    return True, 'ok'


def validate_nie(v: str) -> tuple[bool, str]:
    if not _RE_NIE.match(v):
        return False, 'formato_NIE_incorrecto'
    # Sustituir X/Y/Z por 0/1/2 y aplicar mismo módulo 23
    prefix_map = {'X': '0', 'Y': '1', 'Z': '2'}
    num = prefix_map[v[0]] + v[1:8]
    letter = v[8]
    expected = _NIF_LETTER[int(num) % 23]
    if letter != expected:
        return False, f'letra_NIE_incorrecta (debería ser {expected})'
    return True, 'ok'


def validate_cif(v: str) -> tuple[bool, str]:
    if not _RE_CIF.match(v):
        return False, 'formato_CIF_incorrecto'
    digits = v[1:8]
    control = v[8]
    # Suma pares (i=1,3,5) tal cual + suma impares (i=0,2,4,6) duplicados y
    # con cifras sumadas si >9
    par = sum(int(d) for d in digits[1::2])
    impar = 0
    for d in digits[0::2]:
        x = int(d) * 2
        impar += x if x < 10 else (x // 10) + (x % 10)
    s = par + impar
    cd = (10 - (s % 10)) % 10
    # Dependiendo de la letra inicial, el control es número o letra
    first = v[0]
    if first in 'KPQRSNW':
        expected = _CIF_CONTROL[cd]
    elif first in 'ABEH':
        expected = str(cd)
    else:
        # Resto admiten ambos
        if control == str(cd) or control == _CIF_CONTROL[cd]:
            return True, 'ok'
        return False, f'control_CIF_incorrecto (debería ser {cd} o {_CIF_CONTROL[cd]})'
    if control != expected:
        return False, f'control_CIF_incorrecto (debería ser {expected})'
    return True, 'ok'


def validate_nif_cif_nie(v: str) -> tuple[bool, str]:
    """Acepta NIF/NIE/CIF. Devuelve (válido, mensaje)."""
    if not v:
        return False, 'vacío'
    v = v.strip().upper().replace('-', '').replace(' ', '')
    if _RE_NIF.match(v):
        return validate_nif(v)
    if _RE_NIE.match(v):
        return validate_nie(v)
    if _RE_CIF.match(v):
        return validate_cif(v)
    return False, 'formato_no_reconocido (esperaba NIF / NIE / CIF español)'
