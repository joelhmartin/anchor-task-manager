# Contacts Master List — Consolidation Rollout (Execution Plan)

> **For the executor (fresh agent):** This is the orchestration plan. Each phase has its own task-by-task plan in this directory. Execute phases **in order**, one PR per phase, with a CodeRabbit pass and an **explicit user merge approval** between each. **Read this whole file before starting**, then read the phase plan before each phase. REQUIRED SUB-SKILL: `superpowers:executing-plans` (or `superpowers:subagent-driven-development`).

**Spec:** `docs/superpowers/specs/2026-05-28-contacts-master-list-consolidation-design.md` — read it first.
**Builds on:** the completed Contacts entity + UI rollout (PRs #105, #113, #114, #115 — all merged to `main`). The `contacts`, `contact_phones`, `contact_emails`, `contact_tags` tables and `GET /hub/contacts` already exist in prod.

**Branch:** create `feat/contacts-master-list` off `main` **after PR #116 (Contacts nav link) is merged** so you start from current main:
```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard"
git fetch origin && git checkout main && git pull --ff-only origin main
git checkout -b feat/contacts-master-list
```

**Per-phase plans:**
- 1: `docs/superpowers/plans/2026-05-28-contacts-master-list-phase-1-data-foundation.md`
- 2: `docs/superpowers/plans/2026-05-28-contacts-master-list-phase-2-backfill.md`
- 3: `docs/superpowers/plans/2026-05-28-contacts-master-list-phase-3-master-list-api.md`
- 4: `docs/superpowers/plans/2026-05-28-contacts-master-list-phase-4-ui.md`
- 5: `docs/superpowers/plans/2026-05-28-contacts-master-list-phase-5-retire-and-announce.md`

---

## 0. Pre-flight (run before Phase 1)

```bash
# (a) Branch created off current main
git rev-parse --abbrev-ref HEAD          # → feat/contacts-master-list
git log --oneline origin/main -1         # note the SHA

# (b) Contacts foundation present + populated locally
psql "postgresql://bif@localhost:5432/anchor" -tAc "
  SELECT (SELECT COUNT(*) FROM contacts) AS contacts,
         (SELECT COUNT(*) FROM call_logs WHERE contact_id IS NOT NULL) AS stamped,
         (SELECT 1 FROM information_schema.columns WHERE table_name='contacts' AND column_name='display_name_source') AS dns;"
# Expect contacts>0, stamped>0, dns=1.

# (c) Source data the services ledger reads from exists
psql "postgresql://bif@localhost:5432/anchor" -tAc "
  SELECT (SELECT COUNT(*) FROM client_services) AS client_services,
         (SELECT COUNT(*) FROM client_journeys WHERE service_id IS NOT NULL) AS journey_services;"
```

---

## Per-phase workflow (apply to every phase identically)

1. `git checkout feat/contacts-master-list && git rebase origin/main` (resolve conflicts, never `--skip`).
2. **Read the phase plan doc fully** before editing. Don't deviate without flagging to the user.
3. Execute tasks in order; **commit per task** as the plan instructs.
4. After each task verify (this repo has **no test suite** — see `.claude/skills/verify-without-tests/`):
   - `yarn build` must succeed (catches import/JSX/tree-shaking errors).
   - `node --check <server file>` for any backend file touched.
   - `npx eslint <files-you-touched>` — no NEW errors. (Pre-existing errors are fine; `server/routes/hub.js` has a known `50_000` numeric-separator parser error, and `src/menu-items/portal.js` has pre-existing unused-import errors — ignore those.)
   - Run the phase plan's local-DB scenario via `psql "postgresql://bif@localhost:5432/anchor"` (NEVER the prod `.env` URL).
5. `git push origin feat/contacts-master-list`.
6. Open the PR: `gh pr create --base main --head feat/contacts-master-list --title "<phase title>" --body "<see template below>"`.
7. Trigger CodeRabbit: `gh api repos/joelhmartin/Anchor-Client-Dashboard/issues/<num>/comments -f body="@coderabbitai review"`.
8. Wait for CodeRabbit, then read findings:
   ```bash
   gh api repos/joelhmartin/Anchor-Client-Dashboard/pulls/<num>/reviews --jq '.[]|select(.user.login|test("coderabbitai";"i"))|.body' | grep -i "actionable comments posted"
   gh api repos/joelhmartin/Anchor-Client-Dashboard/pulls/<num>/comments --jq '.[]|select(.user.login|test("coderabbitai";"i"))|"\(.path):\(.line // .original_line)\n\(.body)"'
   ```
   Note: CodeRabbit is **incremental** — after you push a fix it auto-reviews the new commit and marks resolved inline comments "✅ Addressed"; it will NOT re-post a "0 actionable" review for an already-reviewed commit. Treat "all inline comments Addressed + check SUCCESS" as clean.
9. Verify each finding against current code; fix only still-valid ones (push + let CodeRabbit re-review). Decline invalid ones with a reason posted as a PR comment.
10. **STOP. Ask the user for explicit merge approval.** Do NOT merge on your own — merging `main` auto-deploys to prod via Cloud Build. ([[feedback-review-before-prod-merge]] — a plan's gate does not override this.)
11. On the user's go, merge via REST API (the `gh pr merge` subcommand has intermittently 401'd):
    ```bash
    gh api -X PUT repos/joelhmartin/Anchor-Client-Dashboard/pulls/<num>/merge -f merge_method=squash
    ```
12. **Squash-merge resets history** — do NOT `git rebase` the old phase commits onto main (they'll conflict). Instead: `git fetch origin && git checkout feat/contacts-master-list && git reset --hard origin/main && git push --force-with-lease`. Then start the next phase from clean main.
13. Verify the deploy: `gcloud builds list --limit=3 --format="value(status,substitutions.SHORT_SHA)"` → SUCCESS for the squash SHA.
14. Update this file's status table (below) in the next phase's first commit.

### PR body template
```markdown
## Summary
<2-3 bullets: endpoints/tables/components this phase delivers>

## Spec
- `docs/superpowers/specs/2026-05-28-contacts-master-list-consolidation-design.md` (§<sections>)
- Plan: `docs/superpowers/plans/2026-05-28-contacts-master-list-phase-<n>-<name>.md`

## Files
<backend / frontend bullets>

## Verification
- [x] `yarn build` passes
- [x] `npx eslint` on touched files — no new errors
- [x] Local-DB scenarios per the plan
- [ ] CodeRabbit clean
- [x] Owner-scoping: cross-owner probe returns nothing (where applicable)

## Compliance
Owner-scoped in SQL (`owner_user_id = $N`, N = `req.portalUserId || req.user.id`). Mutations/exports audited via `logSecurityEvent` (IDs/counts only, no PHI). Parameterized queries throughout. No PHI in logs/errors (`console.error` logs `err.code`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Phases

| # | Phase | Delivers | Plan |
|---|---|---|---|
| 1 | Data foundation | `contact_services` append-only table + idempotent migration + forward-propagation hooks (journey start/convert, agree-to-service) | phase-1 |
| 2 | Backfill | `contactServicesBackfill.js` + `scripts/backfill-contact-services.js`; one-time Cloud Run job populating the ledger from `client_services` + `client_journeys.service_id` | phase-2 |
| 3 | Master list API | extend `GET /hub/contacts` (status incl. `archived`, `service`, date filters) + `GET /hub/contacts/export.csv` (audited) | phase-3 |
| 4 | UI | ContactsTab filters + Services column + Export CSV button; ContactProfileDrawer services-history section + inline archive/unarchive | phase-4 |
| 5 | Retire + announce | remove standalone Active Clients list + Archive tab + Leads in-journey/active sub-views; redirects; offer client-facing Portal Update | phase-5 |

**Sequencing rule:** Phase 2 backfill runs in prod only **after** Phase 1's migration has deployed (the table must exist in prod first). Phase 3 depends on Phase 1 (reads `contact_services`). Phase 4 depends on Phase 3. Phase 5 depends on Phase 4 (Contacts must fully replace the surfaces before retiring them).

---

## Cross-cutting rules (every phase)

- **Owner-scope in SQL, not just UI.** Every read/write/export predicate includes `owner_user_id = $N` where `N = req.portalUserId || req.user.id`. For staff routes in `server/routes/contacts.js`, scope by the contact's `owner_user_id`.
- **Parameterized queries only.** Never concatenate `req.query`/`req.body` into SQL. Table names in dynamic SQL must come from a fixed allowlist (not user input).
- **Audit** mutations + the CSV export via `logSecurityEvent` (`eventCategory: 'contacts'`), `details` with IDs/counts only — **never** names/phones/emails/service names.
- **No PHI in `console.error`** — log `err.code`.
- **Immediate UI updates** (CLAUDE.md hard rule): update local state from the server response after every mutation; toast on success AND failure.
- **No `window.alert/confirm/prompt`** — use `ConfirmDialog`.
- **Shared components only** — `DataTable`, `StatusChip`, `EmptyState`, `LoadingButton`, `FormDialog`, `SelectField`, `useToast`.
- **Co-located imports are relative** here (`./contacts/X`, `../leads/Y`) — that's the repo convention; the `baseUrl:'src'` rule is only for shared `ui-component/*`. Don't "fix" co-located relative imports.
- **Migrations are append-only + idempotent**, registered as `maybeRunXMigration()` and appended to the `.then()` chain in `server/index.js` (see `.claude/skills/add-migration/`). Server binds the port before migrations run — never `await` DDL before `app.listen`.
- **Test migrations on a fresh scratch DB**, not just the local dev DB ([[feedback-test-migrations-on-fresh-db]]) — re-runs mask first-apply ordering bugs.

---

## Status tracking

| Phase | PR # | Merged at (UTC) | Notes |
|---|---|---|---|
| (prereq hotfix) | #120 | 2026-05-29 ~14:00 | `5a313ca`. Unbreaks the startup migration chain (journey example-template seed rethrew a dup-key → skipped all later migrations in prod, incl. `display_name_source` + `contact_services`). Also unshadows `GET /contacts/merge-candidates`. This is what actually made Phase 1 live in prod. |
| 1 — data foundation | #118 | 2026-05-29 ~12:30 | Squash SHA `f2f37f5`. Deploy build flaked twice on transient apt-mirror network errors; re-ran trigger → SUCCESS, revision `anchor-hub-00579-9rd`. `contact_services` table live in prod. 4 CodeRabbit findings (source CHECK, per-service isolation, journey append-on-create/change, service-ownership before insert) all fixed. |
| 2 — backfill | #119 | 2026-05-29 ~15:17 | Squash SHA `54f1deb`. CodeRabbit clean. Prod backfill ran as one-off Cloud Run job (Cloud SQL backup taken first): **161 rows** (`active_client=161, journey=0`); re-run dry-run 0/0 (idempotent); job deleted. |
| 3 — master list API | — | — | — |
| 4 — UI | — | — | — |
| 5 — retire + announce | — | — | — |

---

## What is NOT in this rollout
- Exposing billing/revenue to client users (stays staff-only, unchanged).
- A `source` filter on contacts (no contact-level source column — needs a grounding decision first; fast-follow, see spec §5).
- Journey concerns (`symptoms`) as contact data.
- A manual/custom status field (status stays derived).
- Bulk actions beyond CSV export (bulk tag/merge).
