---
name: deploy-via-gdeploy
description: Use when deploying the Anchor Client Dashboard to Google Cloud Run. Covers the gdeploy.sh script, yarn.lock sync requirement, and Cloud Build inline trigger context.
---

# Deploy to Cloud Run via gdeploy.sh

## Prerequisites

- `gcloud` CLI authenticated: `gcloud auth login` and `gcloud config set project anchor-hub-480305`
- Docker daemon running
- `yarn.lock` in sync with `package.json` (see below)

## Run the deploy

```bash
./scripts/gdeploy.sh
```

The script does:
1. Derives an image tag from `git rev-parse --short HEAD` + timestamp
2. `docker build` locally
3. `docker tag` for Artifact Registry (`us-central1-docker.pkg.dev/anchor-hub-480305/anchor-hub-repo/anchor-hub:<tag>`)
4. `gcloud auth configure-docker` for the registry
5. `docker push`
6. `gcloud run services update anchor-hub` with the new image

## Critical: yarn.lock must be in sync

The Docker build runs `yarn install --immutable`. If `yarn.lock` is out of date with `package.json`, the build fails with:
```
YN0028: The lockfile would have been modified by this install, which is explicitly forbidden.
```

Fix before deploying:
```bash
yarn install
git add yarn.lock
git commit -m "chore: sync yarn.lock"
git push
```

## cloudbuild.yaml is ORPHANED

`cloudbuild.yaml` in the repo root has a header saying it's orphaned and exits 1 if invoked. The real CI pipeline is an **inline trigger** configured in the GCP Cloud Build console, not in this file. Do not edit `cloudbuild.yaml` expecting it to change anything. Do not try to trigger builds via it.

## After deploy

Cloud Run health checks hit the server immediately after deploy. Migrations run in the background after the port is bound — they will not block the health check. Watch Cloud Run logs for migration errors:

```bash
gcloud run services logs read anchor-hub --region us-central1 --limit 100
```

## Rollback

To roll back to a previous revision:
```bash
gcloud run services update-traffic anchor-hub --to-revisions=<previous-revision>=100 --region us-central1
```

List revisions:
```bash
gcloud run revisions list --service anchor-hub --region us-central1
```
