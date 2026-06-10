#!/bin/bash
set -euo pipefail

# Idempotently provision the three Cloud Scheduler jobs that fan out ops runs.
#
# Each job POSTs to /api/ops/internal/fanout?tier=<tier> with an OIDC bearer
# token signed by the scheduler service account. The fanout handler matches
# enabled subscriptions, inserts queued ops_runs rows, and publishes one
# Pub/Sub message per (client, definition) to ops.run.requested.
#
# Run this script once per environment after deploying the main service. It
# uses `gcloud scheduler jobs describe ... || create / update` to stay
# idempotent.

PROJECT_ID="anchor-hub-480305"
LOCATION="us-central1"
SERVICE_URL="${OPS_SERVICE_URL:-https://anchor-hub-PLACEHOLDER.a.run.app}"
SERVICE_ACCOUNT="anchor-hub@anchor-hub-480305.iam.gserviceaccount.com"
TIME_ZONE="America/Chicago"

if [[ "${SERVICE_URL}" == *"PLACEHOLDER"* ]]; then
  echo "ERROR: Set OPS_SERVICE_URL=<deployed Cloud Run URL> before running."
  echo "  e.g. OPS_SERVICE_URL=https://anchor-hub-xxxxx-uc.a.run.app bash $0"
  exit 1
fi

upsert_job() {
  local name="$1"
  local schedule="$2"
  local tier="$3"

  local uri="${SERVICE_URL}/api/ops/internal/fanout?tier=${tier}"
  local audience="${SERVICE_URL}"

  if gcloud scheduler jobs describe "${name}" \
        --project="${PROJECT_ID}" \
        --location="${LOCATION}" >/dev/null 2>&1; then
    echo "=== Updating Cloud Scheduler job: ${name} ==="
    gcloud scheduler jobs update http "${name}" \
      --project="${PROJECT_ID}" \
      --location="${LOCATION}" \
      --schedule="${schedule}" \
      --time-zone="${TIME_ZONE}" \
      --uri="${uri}" \
      --http-method=POST \
      --oidc-service-account-email="${SERVICE_ACCOUNT}" \
      --oidc-token-audience="${audience}"
  else
    echo "=== Creating Cloud Scheduler job: ${name} ==="
    gcloud scheduler jobs create http "${name}" \
      --project="${PROJECT_ID}" \
      --location="${LOCATION}" \
      --schedule="${schedule}" \
      --time-zone="${TIME_ZONE}" \
      --uri="${uri}" \
      --http-method=POST \
      --oidc-service-account-email="${SERVICE_ACCOUNT}" \
      --oidc-token-audience="${audience}"
  fi
}

# Generic upserter for non-fanout internal endpoints (Command Center pivot adds
# /internal/attention-recompute; future internal jobs reuse this helper).
upsert_internal_job() {
  local name="$1"
  local schedule="$2"
  local path="$3"

  local uri="${SERVICE_URL}${path}"
  local audience="${SERVICE_URL}"

  if gcloud scheduler jobs describe "${name}" \
        --project="${PROJECT_ID}" \
        --location="${LOCATION}" >/dev/null 2>&1; then
    echo "=== Updating Cloud Scheduler job: ${name} ==="
    gcloud scheduler jobs update http "${name}" \
      --project="${PROJECT_ID}" \
      --location="${LOCATION}" \
      --schedule="${schedule}" \
      --time-zone="${TIME_ZONE}" \
      --uri="${uri}" \
      --http-method=POST \
      --oidc-service-account-email="${SERVICE_ACCOUNT}" \
      --oidc-token-audience="${audience}"
  else
    echo "=== Creating Cloud Scheduler job: ${name} ==="
    gcloud scheduler jobs create http "${name}" \
      --project="${PROJECT_ID}" \
      --location="${LOCATION}" \
      --schedule="${schedule}" \
      --time-zone="${TIME_ZONE}" \
      --uri="${uri}" \
      --http-method=POST \
      --oidc-service-account-email="${SERVICE_ACCOUNT}" \
      --oidc-token-audience="${audience}"
  fi
}

upsert_job "ops-daily-essentials" "0 6 * * *"  "daily_essential"
upsert_job "ops-weekly-deep"      "0 7 * * 1"  "weekly_deep"
upsert_job "ops-monthly-audit"    "0 8 1 * *"  "monthly_audit"

# Command Center pivot — recompute attention_score nightly so recency-decayed
# rows stay sorted correctly even when no run/status-change recompute runs.
upsert_internal_job "ops-attention-recompute" "0 5 * * *" "/api/ops/internal/attention-recompute"

echo ""
echo "=== Done. Trigger manually with: ==="
echo "  gcloud scheduler jobs run ops-daily-essentials --location=${LOCATION} --project=${PROJECT_ID}"
