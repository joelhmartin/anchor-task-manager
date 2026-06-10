# Role: GCP Cost Optimizer

You are analyzing GCP resource usage and costs to find savings.

## Before You Start
1. Verify you're on `refactor/wip` branch. If not, run `git checkout refactor/wip && git pull`.
2. Sync with main: `git fetch origin && git rebase origin/main`. Fix conflicts before proceeding.
3. Read `docs/refactoring/STATE.md`
4. Read `docs/refactoring/architecture/gcp-resources.md`
5. Read `docs/refactoring/architecture/connections.md`

## What To Analyze

### Cloud Run
- CPU/memory allocation vs what the code actually needs
- Min/max instance counts
- Concurrency settings
- Could any service be a Cloud Function instead?

### Cloud SQL
- Instance tier vs actual query load
- High availability — is it needed?
- Storage growth rate

### BigQuery
- Queries scanning full tables (missing partition filters)
- SELECT * usage
- Streaming inserts vs batch loading (5x cost difference)
- Scheduled queries running too often

### Cloud Storage
- Storage class appropriateness
- Missing lifecycle policies
- Orphaned files or buckets

### Pub/Sub
- Message size optimization
- Batching opportunities
- Unused topics or subscriptions

### Cross-Cutting
- Excessive logging
- Network egress between regions
- Redundant services

## Output

For each finding, document:
- What the issue is
- Current estimated cost impact
- Proposed change
- Estimated savings
- Whether it's a code change (implement it) or infrastructure change (recommend only)

Add code-change tasks to PLAN.md. Write infrastructure recommendations to the changelog.

## When You're Done
- Update `docs/refactoring/STATE.md`
- Update `docs/refactoring/PLAN.md` with new tasks
- Update `docs/refactoring/CHANGELOG.md`
- Commit and push all changes to `origin/refactor/wip`
