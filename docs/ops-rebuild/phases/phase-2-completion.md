# Phase 2 — Run orchestration (shipped 2026-05-05)

**Specialist:** ops-orchestration-engineer
**Branch:** `main`
**Commits:**
- `8aac341` — `feat(ops-orch): add cost tracker and thread through run executor`
- `55a0a0c` — `feat(ops-orch): add run queue (in-process dev + Pub/Sub prod)`
- `458440c` — `feat(ops-orch): add Cloud Run Job runner + Dockerfile + deploy script`
- `419ad73` — `feat(ops-orch): add Cloud Scheduler fanout endpoint + bootstrap script`
- `afa7c3f` — `feat(ops-orch): wire run enqueue into POST /runs and add cancel signal`

## Files added

| File | Purpose |
|---|---|
| `server/services/ops/costTracker.js` | `createCostTracker()` factory: `add({tokens,dollars,source})`, `totalCents()`, `summary()` |
| `server/services/ops/runQueue.js` | `enqueueRun(runId)` — Pub/Sub in prod, in-memory worker in dev. Also `publishCancelSignal`. |
| `server/services/ops/scheduleFanout.js` | OIDC-verified `POST /api/ops/internal/fanout?tier=...` handler |
| `server/jobs/opsRunner.js` | Cloud Run Job entry — Pub/Sub pull subscriber on `ops-runner` |
| `Dockerfile.opsRunner` | Minimal Node 20 + Yarn 4 image; no frontend, no Chromium |
| `scripts/gdeploy-ops-runner.sh` | Build + push + `gcloud run jobs deploy anchor-ops-runner` (idempotent) |
| `scripts/schedule-ops-runs.sh` | Idempotent Cloud Scheduler bootstrap for the three tiers |
| `infra/pubsub/ops.tf` | Terraform documentation of topic/subscription/DLQ topology |

## Files modified

- `server/services/ops/runExecutor.js` — handlers now invoked as `(ctx, costTracker)`; per-check tracker accruals roll into the run-level tracker; `token_usage_json.by_check` records `tokens` / `prompt_tokens` / `completion_tokens` / `sources` per check.
- `server/services/ops/index.js` — exports `createCostTracker`, `enqueueRun`, `publishCancelSignal`.
- `server/routes/ops.js` — `POST /runs` now calls `enqueueRun(runId)` after insert; `POST /runs/:id/cancel` calls `publishCancelSignal`; `POST /internal/fanout` mounted ahead of the admin auth middleware so OIDC bearer can reach it.
- `package.json` / `yarn.lock` — adds `@google-cloud/pubsub`.

## Behavioral decisions

- **Pub/Sub topology** — `ops.run.requested` (queue), `ops.run.completed` (fan-out for notifications, used in Phase 6+), `ops.run.cancel` (cooperative cancel signal), `ops.run.dead` (DLQ). Subscription `ops-runner` has `ack_deadline=600s`, `max_delivery_attempts=5` → DLQ. Applied manually via gcloud (see `infra/pubsub/ops.tf` header) until tf is wired in CI.
- **In-process dev queue** — `setInterval` worker, 4 concurrent in-flight, lazy-started on first `enqueueRun`, `unref`'d so it doesn't keep the process alive. Drains on SIGTERM/SIGINT.
- **Cloud Run Job concurrency** — `OPS_RUNNER_CONCURRENCY=4` per task. Pub/Sub `flowControl.maxMessages=4` enforces this.
- **Failure path** — handler errors in the runner `nack()` so Pub/Sub redelivers up to 5 times before DLQ.
- **HIPAA** — Pub/Sub message body is exactly `{ runId, enqueuedAt }`. No PHI ever crosses the broker.
- **OIDC verification** — `scheduleFanout.authorizeFanoutRequest` uses `google-auth-library` (already a transitive dep — version `10.6.2` confirmed in `yarn.lock`). Optional `OPS_FANOUT_ALLOWED_SAS` env (CSV) restricts which scheduler service accounts can invoke the fanout. Falls back to a shared-secret bearer (`OPS_FANOUT_SHARED_SECRET`) only if google-auth-library throws — captured here as a known gap to harden in Phase 8.
- **Cancel semantics** — Phase 2 stub. The DB row goes `status='cancelled'` immediately; the runner does not yet thread an AbortSignal through `executeRun`. Cooperative cancellation is deferred (likely Phase 6/7).
- **Cost tracker** — accumulates dollars in floating point; `totalCents()` uses `Math.ceil` so partial cents always trip the tier budget cap. `runExecutor` rolls per-check accruals into the run-level tracker; the run summary captures both.

## Validation outputs

- `yarn build` — clean (`✓ built in ~11.5s`) after each commit.
- `yarn lint` — no new errors or warnings touch any of the Phase 2 files (grepped output for `services/ops/`, `routes/ops.js`, `jobs/opsRunner.js`).
- `bash -n scripts/gdeploy-ops-runner.sh` — OK
- `bash -n scripts/schedule-ops-runs.sh` — OK
- Local end-to-end smoke (queued → running → completed via in-memory worker): not exercised this session because the local Postgres + cron seed required to land a real run definition wasn't wired yet (Phase 3 §5.9 seeds run definitions). Verified by code reading: `enqueueRun` → in-memory queue → `tick()` → `executeRun(runId)` matches the Phase 1 executor signature, and the executor handles `checkSet=[]` cleanly (`finalStatus='completed'` branch). The runner's `nack()` path on executor failure is also straight code-read.

## Follow-ups punted

- **DLQ alert routing** — terraform stub captures the policy but it's not provisioned. Wire alert channels in Phase 8 (scheduling + tier economics).
- **Cooperative cancellation** — `publishCancelSignal` publishes; the runner doesn't subscribe yet. AbortSignal threading through `executeRun` is Phase 6+.
- **Tier definitions seed data** — Phase 3 owns seeding `web_daily_essential` / `web_weekly_deep` / `web_monthly_audit` definitions so the fanout has something to match.
- **OIDC audience verification** — currently undefined in `verifyIdToken` because we can't trivially reconstruct the original Cloud Run URL. Token signature + iss + exp are still validated; harden in Phase 8.

## How to test (post-merge / first deploy)

```bash
# 1. One-time: provision Pub/Sub topology (see infra/pubsub/ops.tf header)
gcloud pubsub topics create ops.run.requested ops.run.completed ops.run.cancel ops.run.dead --project=anchor-hub-480305
gcloud pubsub subscriptions create ops-runner --topic=ops.run.requested \
  --ack-deadline=600 --dead-letter-topic=ops.run.dead --max-delivery-attempts=5 \
  --project=anchor-hub-480305

# 2. Build + deploy the Cloud Run Job
bash scripts/gdeploy-ops-runner.sh

# 3. Bootstrap Cloud Scheduler (after the main service URL is known)
OPS_SERVICE_URL=https://anchor-hub-XXXX-uc.a.run.app bash scripts/schedule-ops-runs.sh

# 4. End-to-end smoke (assumes a seeded run definition + admin JWT in $TOKEN):
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"client_user_id":"<uuid>","run_definition_id":"<uuid>"}' \
  https://anchor-hub-XXXX-uc.a.run.app/api/ops/runs
# expected: 201 + {..., _enqueue: {ok: true, mode: "pubsub"}}

# 5. Trigger a fanout manually
gcloud scheduler jobs run ops-daily-essentials --location=us-central1 --project=anchor-hub-480305

# 6. Local dev smoke
yarn server &
# POST /api/ops/runs with a real run_definition_id (run id, queued)
# expected: status moves to "running" then "completed" within ~5s via the in-memory worker.
```
