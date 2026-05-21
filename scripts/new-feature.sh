#!/usr/bin/env bash
# new-feature.sh — Crea una rama feature desde main siguiendo la convención
# del proyecto: tipo/descripcion-en-kebab-case.
#
# Uso:
#   ./scripts/new-feature.sh [tipo] [descripcion]
#
# Ejemplos:
#   ./scripts/new-feature.sh feat "Botón exportar Excel en clientes"
#       → crea rama feat/boton-exportar-excel-en-clientes
#   ./scripts/new-feature.sh fix "login no redirige tras éxito"
#       → crea rama fix/login-no-redirige-tras-exito
#
# Sin argumentos lanza un wizard interactivo.

set -euo pipefail

# ── Comprobaciones previas ────────────────────────────────────────────────
if [[ ! -d .git ]]; then
  echo "Error: ejecuta este script desde la raíz del repo (no encuentro .git)" >&2
  exit 1
fi

# Hay cambios sin commitear?
if ! git diff-index --quiet HEAD --; then
  echo "Tienes cambios sin commitear. Haz commit o stash antes de cambiar de rama." >&2
  git status --short
  exit 1
fi

# ── Parsear argumentos / wizard ────────────────────────────────────────────
TIPOS=(feat fix refactor chore docs style test perf)

TIPO="${1:-}"
DESC="${2:-}"

if [[ -z "$TIPO" ]]; then
  echo "Tipos disponibles: ${TIPOS[*]}"
  printf "Tipo de rama (default: feat): "
  read -r TIPO
  TIPO="${TIPO:-feat}"
fi

if [[ ! " ${TIPOS[*]} " =~ " ${TIPO} " ]]; then
  echo "Tipo inválido: $TIPO" >&2
  echo "Permitidos: ${TIPOS[*]}" >&2
  exit 1
fi

if [[ -z "$DESC" ]]; then
  printf "Descripción corta: "
  read -r DESC
fi

if [[ -z "$DESC" ]]; then
  echo "Error: descripción vacía" >&2
  exit 1
fi

# ── Slug: lowercase, kebab, sin acentos, máx 50 chars ─────────────────────
SLUG=$(echo "$DESC" \
  | iconv -t ASCII//TRANSLIT 2>/dev/null \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g' \
  | cut -c1-50 \
  | sed 's/-$//')

BRANCH="${TIPO}/${SLUG}"

# ── Confirmación ──────────────────────────────────────────────────────────
echo ""
echo "Voy a crear la rama: $BRANCH"
echo "Desde:               main (actualizado)"
printf "¿Continuar? [Y/n]: "
read -r CONFIRM
CONFIRM="${CONFIRM:-Y}"
if [[ ! "$CONFIRM" =~ ^[Yy] ]]; then
  echo "Cancelado."
  exit 0
fi

# ── Crear rama ────────────────────────────────────────────────────────────
echo ""
echo "git checkout main"
git checkout main

echo "git pull origin main"
git pull origin main --ff-only

echo "git checkout -b $BRANCH"
git checkout -b "$BRANCH"

echo "git push -u origin $BRANCH"
git push -u origin "$BRANCH"

echo ""
echo "Rama $BRANCH lista y publicada en remoto."
echo "Cuando termines:"
echo "   git add . && git commit -m \"${TIPO}: ${DESC}\""
echo "   git push"
echo "   Luego abre la PR a main en GitHub."
