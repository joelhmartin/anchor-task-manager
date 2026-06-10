# Role: Mapper

You are auditing the entire codebase to produce a complete map of every connection, dependency, data flow, and resource.

## Before You Start
1. Verify you're on `refactor/wip` branch. If not, run `git checkout refactor/wip && git pull`.
2. Sync with main: `git fetch origin && git rebase origin/main`. Fix conflicts before proceeding.
3. Read `docs/refactoring/STATE.md`
4. Read the project's `CLAUDE.md` if it exists
5. Read any existing files in `docs/refactoring/architecture/`

## What To Do

Scan every file in the project. For each, document:

### Dependency Map → write to `docs/refactoring/architecture/dependency-graph.md`
- Every file: what it imports, what imports it, what it exports
- Flag circular dependencies
- Flag dead code (files nothing imports)
- Flag duplicated logic across files

### Database Map → write to `docs/refactoring/architecture/database-schema.md`
- Every table, column, type, index, foreign key
- Every SQL query or ORM call: where it lives (file:line), what tables it touches
- Flag N+1 query patterns
- Flag queries missing WHERE clauses or doing full table scans
- Flag SELECT * usage
- Flag missing indexes
- Flag unused indexes

### API Map → write to `docs/refactoring/architecture/api-surface.md`
- Every HTTP endpoint: route, method, handler file/function
- What middleware runs on each
- What DB queries each triggers
- What external services each calls
- Auth requirements per endpoint

### GCP Resources → write to `docs/refactoring/architecture/gcp-resources.md`
- Cloud Run: services, configs, scaling settings, memory/CPU found in code
- Cloud SQL: connection patterns, pool sizes
- Cloud Storage: bucket references, upload/download patterns
- Pub/Sub: topics, subscriptions, message flows
- BigQuery: datasets, query patterns, scheduled queries
- Environment variables that configure GCP resources

### Connections Map → write to `docs/refactoring/architecture/connections.md`
- Service-to-service HTTP calls
- Pub/Sub message flows (publisher → topic → subscriber)
- Cron/scheduler triggers
- External API calls (third-party services)
- Which services share a database

### Critical Findings → write to `docs/refactoring/architecture/critical-findings.md`
- Circular dependencies (CRITICAL)
- Security concerns — exposed secrets, missing auth (CRITICAL)
- Performance red flags — N+1, full table scans, unindexed lookups (HIGH)
- Cost red flags — oversized instances, unnecessary scans (HIGH)
- Dead code (MEDIUM)
- Duplicated logic (MEDIUM)

## Rules
- Include file paths and line numbers for every claim
- If you can't determine something, write "UNKNOWN — needs verification"
- Do NOT modify any application code during mapping
- Be exhaustive — scan everything, don't skip files

## When You're Done
1. Update `docs/refactoring/STATE.md`: set phase to "Mapping complete", update metrics
2. Add an entry to `docs/refactoring/CHANGELOG.md`
3. If anything in the project's `CLAUDE.md` is wrong or missing, note it in critical findings
4. Commit and push all changes to `origin/refactor/wip`
