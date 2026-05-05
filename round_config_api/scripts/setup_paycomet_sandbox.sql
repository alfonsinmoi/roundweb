-- ─────────────────────────────────────────────────────────────────────────
-- Setup credenciales PayComet sandbox para los trainers de Round.
--
-- Manager:           17677 (Round Config interno, no NoofitPro 7673)
-- Trainer Málaga:    17675
-- Trainer Añoreta:   17674
-- Terminal sandbox:  86879  (BANKSTORE TEST, límite 250 €/op)
-- Panel:             https://lens.paycomet.com  →  Terminales → Datos
--
-- ANTES de ejecutar:
--   1) Sustituye los placeholders <PEGAR_AQUI_*> por los valores que
--      saques del panel PayComet (Terminales → Datos del terminal).
--   2) Si solo vas a configurar UN trainer, comenta el bloque del otro
--      con `--`.
--
-- Cómo ejecutar (desde local, leyendo desde stdin → VPS):
--   ssh round-vps "sudo -u postgres psql round_config" \
--     < round_config_api/scripts/setup_paycomet_sandbox.sql
--
-- O subiendo y ejecutando en el VPS:
--   scp round_config_api/scripts/setup_paycomet_sandbox.sql \
--       round-vps:/tmp/setup_paycomet_sandbox.sql
--   ssh round-vps "sudo -u postgres psql round_config -f /tmp/setup_paycomet_sandbox.sql && rm /tmp/setup_paycomet_sandbox.sql"
-- ─────────────────────────────────────────────────────────────────────────

\echo '== Antes:'
SELECT id_manager, id_trainer, proveedor, terminal, sandbox, active,
       LEFT(api_token, 8) || '…' AS api_token_preview, updated_at
  FROM pasarela_credenciales
 WHERE id_manager = '17677'
 ORDER BY id_trainer;

-- ─────────────────────────────────────────────────────────────────────────
-- Trainer Málaga Centro (17675)
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO pasarela_credenciales (
    id_manager, id_trainer, proveedor,
    api_token, terminal,
    url_ok, url_ko, url_notif,
    sandbox, active, notas
) VALUES (
    '17677', '17675', 'paycomet',
    '<PEGAR_AQUI_API_KEY_MALAGA>',                 -- ← API Key del panel
    '86879',                                        -- terminal sandbox
    'https://round.wiemspro.com/cuotas-clientes',
    'https://round.wiemspro.com/cuotas-clientes',
    'https://round.wiemspro.com/api/cuotas/paycomet-callback',
    TRUE,                                           -- sandbox=TRUE
    TRUE,                                           -- active=TRUE
    'Sandbox BANKSTORE TEST — límite 250€/op. Cambiar a sandbox=FALSE en paso a producción.'
)
ON CONFLICT (id_manager, id_trainer, proveedor) DO UPDATE SET
    api_token  = EXCLUDED.api_token,
    terminal   = EXCLUDED.terminal,
    url_ok     = EXCLUDED.url_ok,
    url_ko     = EXCLUDED.url_ko,
    url_notif  = EXCLUDED.url_notif,
    sandbox    = EXCLUDED.sandbox,
    active     = EXCLUDED.active,
    notas      = EXCLUDED.notas;

-- ─────────────────────────────────────────────────────────────────────────
-- Trainer Añoreta (17674) — comparten terminal sandbox por simplicidad.
-- En producción cada trainer debería tener SU propio API Key + Terminal.
-- Si todavía no tienes credenciales separadas para Añoreta, comenta este
-- bloque (añade `--` al inicio de cada línea hasta el `;`).
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO pasarela_credenciales (
    id_manager, id_trainer, proveedor,
    api_token, terminal,
    url_ok, url_ko, url_notif,
    sandbox, active, notas
) VALUES (
    '17677', '17674', 'paycomet',
    '<PEGAR_AQUI_API_KEY_ANORETA>',                -- ← API Key del panel (puede ser la misma que Málaga en sandbox)
    '86879',                                        -- terminal sandbox compartido
    'https://round.wiemspro.com/cuotas-clientes',
    'https://round.wiemspro.com/cuotas-clientes',
    'https://round.wiemspro.com/api/cuotas/paycomet-callback',
    TRUE,
    TRUE,
    'Sandbox BANKSTORE TEST — comparte terminal con Málaga.'
)
ON CONFLICT (id_manager, id_trainer, proveedor) DO UPDATE SET
    api_token  = EXCLUDED.api_token,
    terminal   = EXCLUDED.terminal,
    url_ok     = EXCLUDED.url_ok,
    url_ko     = EXCLUDED.url_ko,
    url_notif  = EXCLUDED.url_notif,
    sandbox    = EXCLUDED.sandbox,
    active     = EXCLUDED.active,
    notas      = EXCLUDED.notas;

\echo ''
\echo '== Después:'
SELECT id_manager, id_trainer, proveedor, terminal, sandbox, active,
       LEFT(api_token, 8) || '…' AS api_token_preview, updated_at
  FROM pasarela_credenciales
 WHERE id_manager = '17677'
 ORDER BY id_trainer;

\echo ''
\echo 'OK — recuerda probar /api/cuotas/recibo/<id>/cobrar-link con un recibo de prueba.'
