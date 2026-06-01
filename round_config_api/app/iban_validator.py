"""Validador IBAN español (mayo 2026).

Reglas verificadas:
  1. Longitud correcta para el país (España: 24).
  2. Check digit ISO 13616 (mod 97 = 1 tras rotar 4 chars y mapear letras).
  3. Dígitos de control del CCC español (los 2 dígitos justo después de
     bank+branch). Algoritmo bancario español "pesos 1,2,4,8,5,10,9,7,3,6".

Si los 3 chequeos pasan, el IBAN es estructuralmente válido. (El banco
del cliente confirmará luego si la cuenta concreta existe — eso no se
puede validar offline.)

Usado en:
  - `routes/forma_pago.py` POST/PATCH (rechaza inválidos al guardar).
  - `routes/preemision_validar.py` validación pre-emisión (warning
    `iban_invalido` para que el operador lo corrija antes de generar SEPA).
"""

LONGITUDES_PAIS = {
    'ES': 24, 'PT': 25, 'FR': 27, 'IT': 27, 'DE': 22, 'GB': 22,
    # … otros países SEPA si se requieren en el futuro
}


def normalizar(iban):
    """Devuelve el IBAN sin espacios y en mayúsculas. None → ''."""
    return (iban or '').replace(' ', '').upper().strip()


def check_iban_mod97(iban):
    """Devuelve (ok, mod97). Implementa ISO 13616."""
    iban = normalizar(iban)
    if len(iban) < 5:
        return False, None
    rearr = iban[4:] + iban[:4]
    convertido = ''.join(str(ord(c) - 55) if c.isalpha() else c for c in rearr)
    try:
        n = int(convertido)
    except ValueError:
        return False, None
    return n % 97 == 1, n % 97


def check_ccc_espanol(iban):
    """Comprueba los 2 dígitos de control del CCC español (DC1, DC2).
    Solo aplicable a IBANs `ES`. Devuelve (ok, info_str)."""
    iban = normalizar(iban)
    if len(iban) != 24 or not iban.startswith('ES'):
        return False, 'no_es_iban'
    ccc = iban[4:]                          # 20 dígitos: bank+branch+dc+cuenta
    if not ccc.isdigit():
        return False, 'ccc_no_numerico'
    bank_branch = '00' + ccc[:8]            # 10 dígitos
    dc1_real, dc2_real = int(ccc[8]), int(ccc[9])
    cuenta = ccc[10:]
    pesos = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6]
    s1 = sum(int(bank_branch[i]) * pesos[i] for i in range(10))
    dc1 = (11 - (s1 % 11)) % 11
    if dc1 == 10: dc1 = 1
    s2 = sum(int(cuenta[i]) * pesos[i] for i in range(10))
    dc2 = (11 - (s2 % 11)) % 11
    if dc2 == 10: dc2 = 1
    ok = (dc1_real == dc1 and dc2_real == dc2)
    detalle = f'dc1={dc1_real}(esperado={dc1}) dc2={dc2_real}(esperado={dc2})'
    return ok, detalle


def validar_iban(iban):
    """Punto de entrada principal.

    Devuelve dict:
      {ok: bool, iban_normalizado: str, error: str | None, detalle: str | None}

    `error` es un código corto identificable para el frontend:
      - 'iban_vacio'
      - 'longitud_invalida'
      - 'mod97_invalido'   (check digit IBAN incorrecto)
      - 'ccc_invalido'     (dígitos de control bancarios mal — solo ES)
    """
    iban_norm = normalizar(iban)
    if not iban_norm:
        return {'ok': False, 'iban_normalizado': '',
                'error': 'iban_vacio', 'detalle': None}
    pais = iban_norm[:2]
    long_esperada = LONGITUDES_PAIS.get(pais)
    if long_esperada and len(iban_norm) != long_esperada:
        return {'ok': False, 'iban_normalizado': iban_norm,
                'error': 'longitud_invalida',
                'detalle': f'esperaba {long_esperada} chars para {pais}, '
                           f'recibido {len(iban_norm)}'}
    ok_mod, mod = check_iban_mod97(iban_norm)
    if not ok_mod:
        return {'ok': False, 'iban_normalizado': iban_norm,
                'error': 'mod97_invalido',
                'detalle': f'check digit IBAN incorrecto (mod97={mod}, debe ser 1)'}
    if pais == 'ES':
        ok_ccc, info = check_ccc_espanol(iban_norm)
        if not ok_ccc:
            return {'ok': False, 'iban_normalizado': iban_norm,
                    'error': 'ccc_invalido',
                    'detalle': f'dígitos de control del CCC incorrectos: {info}'}
    return {'ok': True, 'iban_normalizado': iban_norm,
            'error': None, 'detalle': None}
