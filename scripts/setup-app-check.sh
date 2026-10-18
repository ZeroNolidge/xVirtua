#!/usr/bin/env bash
# Sets up Firebase App Check (reCAPTCHA Enterprise) for the web app and
# writes APPCHECK_SITE_KEY to $GITHUB_ENV. Safe to re-run: reuses the key.
# Needs PROJECT_ID and gcloud signed in as the deployer.
set -euo pipefail
: "${PROJECT_ID:?}"

gcloud services enable recaptchaenterprise.googleapis.com firebaseappcheck.googleapis.com \
  --project "$PROJECT_ID" --quiet

NAME="PlainSpeak web"
KEY=$(gcloud recaptcha keys list --project "$PROJECT_ID" --format='value(name)' \
  --filter="displayName=\"$NAME\"" | head -n1)
if [ -z "$KEY" ]; then
  echo "Creating reCAPTCHA Enterprise key"
  KEY=$(gcloud recaptcha keys create --project "$PROJECT_ID" --display-name="$NAME" --web \
    --domains="$PROJECT_ID.web.app,$PROJECT_ID.firebaseapp.com,localhost" \
    --integration-type=score --format='value(name)')
fi
SITE_KEY="${KEY##*/}"
[ -n "$SITE_KEY" ] || { echo "No site key"; exit 1; }

APP_ID=$(npx firebase apps:list WEB --project "$PROJECT_ID" --json | node -e \
  "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).result[0].appId))")
TOKEN=$(gcloud auth print-access-token)
curl -sSf -X PATCH \
  "https://firebaseappcheck.googleapis.com/v1/projects/$PROJECT_ID/apps/$APP_ID/recaptchaEnterpriseConfig?updateMask=siteKey" \
  -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT_ID" \
  -H 'Content-Type: application/json' -d "{\"siteKey\":\"$SITE_KEY\"}" >/dev/null
echo "App Check registered for web app $APP_ID"
echo "APPCHECK_SITE_KEY=$SITE_KEY" >> "$GITHUB_ENV"
