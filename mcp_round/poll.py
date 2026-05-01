#!/usr/bin/env python3
"""Entry point del poller para systemd timer.

Uso:
    /opt/round_mcp/venv/bin/python /opt/round_mcp/poll.py [--force]

  --force  Ignora el cursor y procesa todo el histórico (solo para testing).

Variables de entorno (ver .env):
    MCP_ODOO_URL, MCP_ODOO_DB, MCP_ODOO_USER, MCP_ODOO_PWD
    MCP_NOOFIT_API_URL, MCP_NOOFIT_API_TOKEN
    MCP_PUSH_API_URL, MCP_PUSH_API_TOKEN
    MCP_POLLER_DRY_RUN (1 = no llamadas reales, solo log)
    MCP_POLLER_IMPAGO_DIAS (default 5)
    MCP_POLLER_CURSOR_FILE (default /var/lib/round_mcp/poller_cursor)
"""
import sys
import logging
import argparse


def main():
    parser = argparse.ArgumentParser(description='Round MCP poller')
    parser.add_argument('--force', action='store_true',
                        help='Ignora el cursor (procesa histórico desde 1970)')
    parser.add_argument('--debug', action='store_true', help='Log nivel DEBUG')
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    )

    from poller.poller import run
    try:
        result = run(force=args.force)
        logging.info(f"Resultado: {result}")
        return 0
    except Exception as e:
        logging.exception(f"Error en poller: {e}")
        return 1


if __name__ == '__main__':
    sys.exit(main())
