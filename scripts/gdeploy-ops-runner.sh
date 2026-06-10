#!/bin/bash
set -euo pipefail

# ===== CONFIGURATION =====
PROJECT_ID="anchor-hub-480305"
REGION="us-central1"
JOB_NAME="anchor-ops-runner"
ARTIFACT_REPO_NAME="anchor-hub-repo"
IMAGE_NAME="anchor-ops-runner"
SERVICE_ACCOUNT_EMAIL="anchor-hub@anchor-hub-480305.iam.gserviceaccount.com"

DRY_RUN="false"
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="true"
fi

GIT_COMMIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "manual")
IMAGE_TAG="${GIT_COMMIT_SHA}-$(date +%Y%m%d%H%M%S)"
FULL_ARTIFACT_PATH="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO_NAME}/${IMAGE_NAME}:${IMAGE_TAG}"

echo ""
echo "=== Cloud Run Job Deploy: ${JOB_NAME} ==="
echo "Project: ${PROJECT_ID}"
echo "Region: ${REGION}"
echo "Image Tag: ${IMAGE_TAG}"
echo "Artifact Path: ${FULL_ARTIFACT_PATH}"
echo "Service Account: ${SERVICE_ACCOUNT_EMAIL}"
echo "Dry-run: ${DRY_RUN}"
echo ""

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "[dry-run] Would build Dockerfile.opsRunner, push to ${FULL_ARTIFACT_PATH},"
  echo "[dry-run] then 'gcloud run jobs deploy ${JOB_NAME}' (idempotent)."
  exit 0
fi

echo "=== Building Docker image (Dockerfile.opsRunner) ==="
docker build -f Dockerfile.opsRunner -t "${IMAGE_NAME}:${IMAGE_TAG}" .
echo ""

echo "=== Tagging image for Artifact Registry ==="
docker tag "${IMAGE_NAME}:${IMAGE_TAG}" "${FULL_ARTIFACT_PATH}"
echo ""

echo "=== Authenticating Docker with Artifact Registry ==="
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
echo ""

echo "=== Pushing image ==="
docker push "${FULL_ARTIFACT_PATH}"
echo ""

# `gcloud run jobs deploy` creates the job on first run and updates on subsequent
# runs. It is idempotent.
echo "=== Deploying Cloud Run Job ${JOB_NAME} ==="
gcloud run jobs deploy "${JOB_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${FULL_ARTIFACT_PATH}" \
  --service-account="${SERVICE_ACCOUNT_EMAIL}" \
  --max-retries=3 \
  --task-timeout=3600 \
  --set-env-vars="NODE_ENV=production,OPS_RUN_SUBSCRIPTION=ops-runner,OPS_RUNNER_CONCURRENCY=4"

echo ""
echo "=== Cloud Run Job deploy complete ==="
echo "Trigger manually: gcloud run jobs execute ${JOB_NAME} --region=${REGION} --project=${PROJECT_ID}"
