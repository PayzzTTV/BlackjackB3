#!/usr/bin/env bash
# Remplace l'URL factice de config.js par la valeur de $BJ_API_URL (secret GitHub).
# - secret absent : avertissement, le site est publié sans API (« Configuration manquante »)
# - secret mal formé : échec du déploiement
# La valeur n'est jamais affichée dans les logs.
set -euo pipefail

FICHIER="${1:?usage: injecter-config.sh <config.js>}"
FACTICE='https://script.google.com/macros/s/REMPLACER_PAR_ID_DEPLOIEMENT/exec'

if [ -z "${BJ_API_URL:-}" ]; then
  echo "::warning::Secret BJ_API_URL absent : le site est publié sans API (« Configuration manquante »)."
  exit 0
fi

# Liste blanche stricte : rien d'autre qu'une URL de Web App Apps Script ne peut entrer dans le JS publié.
if ! printf '%s' "$BJ_API_URL" | grep -Eq '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]{20,200}/exec$'; then
  echo "::error::BJ_API_URL invalide : format attendu https://script.google.com/macros/s/<id>/exec"
  exit 1
fi

grep -qF "$FACTICE" "$FICHIER" || { echo "::error::URL factice introuvable dans $FICHIER"; exit 1; }

# Caractères validés ci-dessus ([A-Za-z0-9_-], / et :) : sans danger avec le délimiteur « | ».
sed -i "s|$FACTICE|$BJ_API_URL|" "$FICHIER"

grep -qF "$BJ_API_URL" "$FICHIER" || { echo "::error::Injection échouée"; exit 1; }
echo "Configuration injectée dans $FICHIER."
