#!/bin/bash
set -euo pipefail

# ===== CONFIGURATION =====
PROJECT_ID="anchor-hub-480305"
REGION="us-central1"
SERVICE_NAME="anchor-hub"
ARTIFACT_REPO_NAME="anchor-hub-repo"
IMAGE_NAME="anchor-hub"

# Git SHA plus timestamp for unique tags, fallback to manual if not in a git repo
GIT_COMMIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "manual")
IMAGE_TAG="${GIT_COMMIT_SHA}-$(date +%Y%m%d%H%M%S)"

# Full path to the image in Artifact Registry
FULL_ARTIFACT_PATH="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO_NAME}/${IMAGE_NAME}:${IMAGE_TAG}"

# Optional Cloud SQL and service account if needed
CLOUD_SQL_INSTANCE_NAME="${PROJECT_ID}:${REGION}:anchor"
SERVICE_ACCOUNT_EMAIL="jmartin@anchorcorps.com"
CONTAINER_PORT="8080"

echo ""
echo "=== Cloud Run Deploy Script for ${SERVICE_NAME} ==="
echo "Project: ${PROJECT_ID}"
echo "Region: ${REGION}"
echo "Image Tag: ${IMAGE_TAG}"
echo "Artifact Path: ${FULL_ARTIFACT_PATH}"
echo ""

echo "=== Building Docker image locally ==="
docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" .
echo ""

echo "=== Tagging image for Artifact Registry ==="
docker tag "${IMAGE_NAME}:${IMAGE_TAG}" "${FULL_ARTIFACT_PATH}"
echo ""

echo "=== Authenticating Docker with Artifact Registry ==="
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
echo ""

echo "=== Pushing image to Artifact Registry ==="
docker push "${FULL_ARTIFACT_PATH}"
echo ""

echo "=== Deploying to Cloud Run ==="
# Phase 1 Reports requires 1 GiB minimum for Puppeteer + Chromium
gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${FULL_ARTIFACT_PATH}" \
  --platform=managed \
  --memory=1Gi
  # Uncomment below to override defaults
  # --add-cloudsql-instances="${CLOUD_SQL_INSTANCE_NAME}" \
  # --service-account="${SERVICE_ACCOUNT_EMAIL}" \
  # --port="${CONTAINER_PORT}" \
  # --cpu="1" \
  # --concurrency="80" \
  # --allow-unauthenticated

echo ""
echo "=== Deployment complete, fetching service URL ==="

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(status.url)')

if [ -n "${SERVICE_URL}" ]; then
  echo "Service URL: ${SERVICE_URL}"
else
  echo "Could not retrieve service URL, check Cloud Run console."
fi

echo ""
echo "Deploy script finished."
