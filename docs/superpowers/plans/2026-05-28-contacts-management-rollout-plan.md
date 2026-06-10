# Contacts Management — 3-Phase Rollout (Execution Plan)

> **For the executor:** This is the orchestration plan. Each phase has its own task-by-task implementation plan in this same directory. Your job is to execute the phases in order, with a PR + CodeRabbit pass + merge between each. **Read this whole file before starting.**

**Branch:** `feat/contacts-management` (already created; off `main`).
**Spec:** `docs/superpowers/specs/2026-05-27-contacts-management-ui-design.md`.
**Per-phase plans:**
- A: `docs/superpowers/plans/2026-05-27-contacts-ui-phase-a-list.md`
- B: `docs/superpowers/plans/2026-05-27-contacts-ui-phase-b-profile.md`
- C: `docs/superpowers/plans/2026-05-27-contacts-ui-phase-c-merge-split.md` *(amended 2026-05-28 — see §"Plan amendments" below)*

---

## 0. Pre-flight — verify before any code

Run these checks first. Don't start Phase A until all four pass:

```bash
# (a) On the right branch, up-to-date with origin
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard"
git fetch origin && git checkout feat/contacts-management && git rebase origin/main

# (b) Contacts schema is live + populated
psql "postgresql://bif@localhost:5432/anchor" -tAc "
  SELECT
    (SELECT COUNT(*) FROM contacts) AS contacts,
    (SELECT COUNT(*) FROM call_logs WHERE contact_id IS NOT NULL) AS call_logs_with_contact,
    (SELECT 1 FROM information_schema.columns WHERE table_name='contacts' AND column_name='display_name_source') AS dns_col;
"
# Expect: contacts > 0, call_logs_with_contact > 0, dns_col = 1.

# (c) PR #105 (rename) is MERGED into main
gh pr view 105 --json state | jq -r '.state'
# Expect: MERGED. If still OPEN, finish #105 first (see §"PR #105 prerequisite").

# (d) Rename endpoint actually exists on main
grep -n "router.patch.*contacts/:id/name" server/routes/hub.js
# Expect: a match. If none, #105 hasn't merged — see §"PR #105 prerequisite".
```

---

## PR #105 prerequisite

PR #105 (`feat/edit-contact-name`) ships the rename endpoint + inline-edit UI that Phase B's drawer header reuses. As of 2026-05-28 it has been rebased onto current main and re-submitted for CodeRabbit review. **It must be merged before Phase B starts.** Phase A doesn't strictly need it (the `display_name_source` column exists either way), but it's simpler to merge #105 first and start from a clean base.

If #105 is still open when you start:
1. Check PR state: `gh pr view 105 --json state,statusCheckRollup,mergeable`
2. If CodeRabbit's actionable count is 0 and mergeable=CLEAN, merge: `gh api -X PUT repos/joelhmartin/Anchor-Client-Dashboard/pulls/105/merge -f merge_method=squash`
3. If actionable > 0, read findings (`gh api repos/.../pulls/105/reviews`), apply fixes, push, wait for re-review, merge.
4. After merge: `git checkout feat/contacts-management && git rebase origin/main` to pull in the rename code.

---

## Workflow per phase (apply to A, B, and C identically)

1. **Switch to branch + rebase**: `git checkout feat/contacts-management && git rebase origin/main`. If conflicts → resolve, don't `--skip`.
2. **Read the phase's plan doc fully** before any edit. Don't deviate without flagging.
3. **Execute tasks in order**, following the checkboxes in the phase doc. Commit per task as the plan instructs.
4. **Verify locally** after each task:
   - `yarn build` must succeed
   - `npx eslint <files-you-touched>` — no NEW errors (pre-existing errors are fine)
   - Run the local-DB scenario the plan specifies
5. **Push** when all tasks complete: `git push origin feat/contacts-management`
6. **Open the PR** with `gh pr create --base main --head feat/contacts-management --title "<phase title>" --body "<see PR body template below>"`
7. **Trigger CodeRabbit**: `gh api repos/joelhmartin/Anchor-Client-Dashboard/issues/<num>/comments -f body="@coderabbitai review"`
8. **Wait for CodeRabbit** to leave `PENDING` → `SUCCESS`/`FAILURE`. Poll loop:
   ```bash
   until {
     state=$(gh pr view <num> --json statusCheckRollup 2>/dev/null);
     cr=$(echo "$state" | jq -r '.statusCheckRollup[] | select(.context == "CodeRabbit") | .state' | head -1);
     [ "$cr" != "PENDING" ] && [ -n "$cr" ];
   }; do sleep 60; done
   ```
9. **Read all CodeRabbit findings** (review + inline comments):
   ```bash
   gh api repos/joelhmartin/Anchor-Client-Dashboard/pulls/<num>/reviews --jq '.[] | select(.user.login | test("coderabbitai"; "i")) | .body'
   gh api repos/joelhmartin/Anchor-Client-Dashboard/pulls/<num>/comments --jq '.[] | select(.user.login | test("coderabbitai"; "i")) | "\(.path):\(.line // .original_line)\n\(.body)"'
   ```
10. **Address findings**: verify each against current code; fix only still-valid ones; commit + push; re-trigger CodeRabbit; wait again. Loop until `Actionable comments posted: 0` on the latest pass.
11. **Merge via REST API** (the `gh pr merge` subcommand has been intermittently failing with 401 — use the direct API):
    ```bash
    gh api -X PUT repos/joelhmartin/Anchor-Client-Dashboard/pulls/<num>/merge -f merge_method=squash
    ```
    **Merging to main auto-deploys to prod via Cloud Build.** Do NOT merge if any of A/B/C left the build broken or has unaddressed CodeRabbit findings.
12. **Verify merge**: `git fetch origin && git log --oneline origin/main -2` — see the new squash commit.
13. **Rebase the working branch** so the next phase starts clean: `git rebase origin/main`.
14. **Move to next phase.**

### PR body template

```markdown
## Summary

<2–3 bullets describing what this phase delivers — list the new endpoints + UI components.>

## Spec
- `docs/superpowers/specs/2026-05-27-contacts-management-ui-design.md` (§<the relevant sections>)
- Plan: `docs/superpowers/plans/2026-05-27-contacts-ui-phase-<x>-<name>.md`

## Files

<bulleted list of files touched, grouped backend/frontend>

## Verification

- [x] `yarn build` passes
- [x] `npx eslint` on touched files — no new errors
- [x] Local-DB scenarios per the plan
- [ ] CodeRabbit clean
- [ ] Cross-owner check: an owner cannot read/mutate another owner's contact (run a probe with two users)

## Compliance

Owner-scoped in SQL (not just UI). Mutations audited via `logSecurityEvent` without PHI values. Parameterized queries throughout. No PHI in error messages or logs.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Phase A — Contacts list (read-only)

**Plan file:** `docs/superpowers/plans/2026-05-27-contacts-ui-phase-a-list.md`.
**Delivers:** `GET /hub/contacts` (owner-scoped, paginated, search/lifecycle/tag filters) + `src/api/contacts.js` (`fetchContacts`) + `ContactsTab.jsx` (DataTable list) + registration in `ClientPortal.jsx`.

**Follow the plan exactly.** No deviations except where this rollout doc overrides it.

**After-merge action (required by CLAUDE.md):** Phase A adds a new visible client-portal tab → **offer the user a client-facing Portal Update**. Draft `{type:'feature', title, body}` for posting via `POST /api/portal-updates/admin`. Do NOT post without the user's go-ahead.

---

## Phase B — Contact profile drawer

**Plan file:** `docs/superpowers/plans/2026-05-27-contacts-ui-phase-b-profile.md`.
**Delivers:** `GET /hub/contacts/:id` + `?contact_id=` on `/hub/calls` + client-accessible owner-scoped tags/consent endpoints + `ContactProfileDrawer.jsx` with inline rename / tag autocomplete / consent switches / paginated activity timeline.

**Prerequisites:** Phase A merged AND PR #105 merged (drawer reuses the rename inline-edit pattern from #105).

**Follow the plan exactly.** No amendments.

---

## Phase C — Merge queue + split (staff-only)

**Plan file:** `docs/superpowers/plans/2026-05-27-contacts-ui-phase-c-merge-split.md` — **amended 2026-05-28** (see §"Plan amendments" below).
**Delivers:** `POST /hub/contacts/:id/split` (transactional, audited, staff-only) + `MergeQueuePanel.jsx` + `SplitContactDialog.jsx` + staff gating in `ContactsTab.jsx` and `ContactProfileDrawer.jsx`.

**Prerequisites:** Phase A + Phase B merged.

**Plan amendments** (already applied to the Phase C doc):

1. **Split scope widened to match spec §3.** Original Phase C draft moved only `call_logs.contact_id`. The spec says split must also reassign `client_journeys` and `active_clients` whose identifier matches the split-off phone/email. The amended Phase C doc now does all three in the same transaction, owner-scoped, with separate row counts. Response shape changed from `{ moved: <int> }` to `{ moved: { calls, journeys, activeClients } }`. The dialog should surface these in the success toast (e.g. `"Split complete — moved 3 calls, 1 journey"`).

2. **Owner predicate added to every UPDATE** (`AND owner_user_id = $4`). Defense-in-depth; the source contact lookup already locks the owner via `FOR UPDATE`, but reassignment UPDATEs should also assert the owner so a stale transaction never touches the wrong tenant's rows.

---

## Cross-cutting reminders (apply to every phase)

- **Owner-scoping is in SQL, not just UI.** Every read/write predicate includes `owner_user_id = $N` where `N = req.portalUserId || req.user.id`.
- **Parameterized queries only.** Never concatenate `req.query` / `req.body` into SQL.
- **Audit mutations** with `logSecurityEvent` — `eventCategory: 'contacts'`, `eventType` per action, success bool, `details` WITHOUT PHI values (use IDs and counts, never names/phones/emails).
- **No PHI in `console.error`** — log error codes (`err.code`), not error messages that may carry row content.
- **Immediate UI updates** (CLAUDE.md hard rule). After every mutation, update local state from the server response. Don't rely on refetch alone. Toast on success AND failure for every state change.
- **No `window.alert/confirm/prompt`**. Use `ConfirmDialog` from `ui-component/extended/ConfirmDialog`.
- **Shared components only** — `DataTable`, `StatusChip`, `EmptyState`, `LoadingButton`, `FormDialog`, `SelectField`, `useToast`. Don't reinvent.
- **CodeRabbit is the gate.** A phase doesn't merge until CodeRabbit posts `Actionable comments posted: 0` on the latest commit.
- **Auto-deploy on merge to main.** Cloud Build watches main; every squash merge ships to prod within ~10 min. Don't merge a phase if the local build is broken or if findings are outstanding.

---

## What is NOT in this rollout

- Manual contact creation (contacts only arise from activity ingest).
- Editing identifiers directly (add/remove a phone/email beyond what split does).
- Bulk operations (bulk tag, bulk export).
- An AdminHub-native contacts surface (staff use the client portal via acting-user).
- Delete/archive a contact.

Future work — out of scope for this rollout, but the contact-entity surface this delivers is the foundation. Don't try to slip them in.

---

## Status tracking

After each phase merges, append a row here (the executor updates this file in the same commit as the merge-completion):

| Phase | PR # | Merged at (UTC) | Notes |
|---|---|---|---|
| #105 (rename — prerequisite) | 105 | 2026-05-28 | Merged (squash `d827ef6`). All 5 CodeRabbit findings addressed in `8012ca6`; check SUCCESS, MERGEABLE/CLEAN at merge. |
| A — list | 113 | 2026-05-29 | Merged (squash `28139ab`). 1 CodeRabbit finding (loose tag UUID → 400) fixed in `1df6a83`, marked Addressed; check SUCCESS. |
| B — profile drawer | 114 | 2026-05-29 | Merged (squash `6db93f8`). 4 CodeRabbit findings (contact_id 400, audit profile read, UUID validation, preserve email_unsubscribed_at) fixed in `ea3fb24`; check SUCCESS. |
| C — merge queue + split | 115 | 2026-05-29 | Merged (squash `c925356`). 1 CodeRabbit finding (recompute source primary_phone/email after split) fixed in `b272511`; 2 relative-import nits declined (co-located convention). Merged on explicit user go. |

---

## When the rollout is done

After Phase C merges:

1. Run the cross-phase smoke check locally (instructions below).
2. Confirm the Portal Update for Phase A was posted (or recorded as declined).
3. Delete the working branch *only if the user asks*: `git push origin --delete feat/contacts-management` and `git branch -d feat/contacts-management`. Default = keep it as a record.

### Cross-phase smoke check (local)

With the dev server running (`./dev.sh`), as a client-portal user:
1. Open the Contacts tab → list loads with pagination + search works.
2. Click a row → drawer opens, name editable, tags add/remove, consent toggles, timeline shows the contact's calls.
3. Sign in as a staff user with the same client as `actingClient` → "Review merges" button appears; "Split" appears in the drawer.
4. Run a split on a contact with two distinct identifiers + activity from each → expect both contacts visible in the list, activity split correctly.

All of these should round-trip without a page reload (CLAUDE.md immediate-UI-updates rule).
