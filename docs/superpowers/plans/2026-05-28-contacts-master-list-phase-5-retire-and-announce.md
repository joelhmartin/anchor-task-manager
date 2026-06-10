# Contacts Master List — Phase 5: Retire Surfaces + Announce

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`. Steps use `- [ ]`. This phase **removes** UI surfaces — be conservative: unlink + redirect, verify usages before deleting anything, and keep staff/admin access intact.

**Goal:** Now that Contacts is the master list, retire the overlapping surfaces: the portal's standalone **Client List** (`/active-clients`) nav item, the **Archive** tab, and the **In-Journey / Active-Client sub-views inside Leads**. Add redirects so deep links land on the right Contacts filter. Then offer the user a client-facing Portal Update.

**Architecture:** Prefer **unlink + redirect** over hard-delete. Remove nav items from `src/menu-items/portal.js` and the Archive tab from `ClientPortal.jsx` `SECTION_CONFIG`; add route redirects. Reduce the Leads `lifecycleFilter` to the inbox. Do NOT delete the `ActiveClients` component/route if anything outside the portal nav (e.g. AdminHub, deep links) still uses it — verify first.

**Tech Stack:** React 19 + MUI. Verify with `yarn build` + lint + manual nav check.

**Spec:** §2 (retired), §6, §8 (phase 6 announce). **Depends on:** Phase 4 (Contacts must fully cover these jobs first).

---

## File Structure
- Modify: `src/menu-items/portal.js` — remove `Client List` + `Archive` items (keep `Contacts`).
- Modify: `src/views/client/ClientPortal.jsx` — remove `archive` from `SECTION_CONFIG` + its render; add redirects for `?tab=archive` and the active-clients deep link.
- Modify: `src/views/client/ClientPortal/LeadsTab.jsx` — collapse the `lifecycleFilter` sub-views to the inbox.
- (Possibly) Modify: route config for `/active-clients` — redirect to Contacts if the portal was its only consumer.

---

## Task 1: Verify what still uses Active Clients + Archive before removing

**Files:** none (investigation).

- [ ] **Step 1: Map consumers.** Removal is only safe once you know who reads these.
```bash
grep -rn "active-clients\|/active-clients\|ActiveClients" src/ | grep -vE "node_modules"
grep -rn "tab=archive\|ArchiveTab\|'archive'" src/ | grep -vE "node_modules"
grep -rn "lifecycleFilter" src/views/client/ClientPortal/LeadsTab.jsx
```
- [ ] **Step 2: Decide per surface.**
  - If `/active-clients` (the `ActiveClients` view) is **only** reached from the portal nav → safe to unlink + redirect to `/portal?tab=contacts&status=active_client`.
  - If it's **also** an AdminHub/staff route → keep the route, just remove the *portal nav* item (`Client List`), and leave staff access as-is.
  - The Archive tab is portal-only → remove from `SECTION_CONFIG` + nav, redirect `?tab=archive` → `?tab=contacts&status=archived`.
- [ ] **Step 3: Write findings into the PR description** so the reviewer/user sees what was kept vs removed and why.

---

## Task 2: Remove portal nav items (Client List + Archive)

**Files:** Modify `src/menu-items/portal.js`.

- [ ] **Step 1:** In the `clientManagementGroup.children`, remove the `portal-archive` item and the `active-clients` ("Client List") item, leaving `portal-leads`, `portal-contacts`, `portal-journey`. Remove now-unused icon imports (`IconArchive`, and `IconUsers` if nothing else uses it — `grep` within the file).
- [ ] **Step 2: Verify.** `yarn build 2>&1 | tail -3`; eslint clean on the file (no new unused-import errors — remove imports you orphan).
- [ ] **Step 3: Commit.** `git add src/menu-items/portal.js && git commit -m "feat(contacts): remove Client List + Archive from portal nav (folded into Contacts)"`

---

## Task 3: Remove Archive tab from the portal + add redirects

**Files:** Modify `src/views/client/ClientPortal.jsx`.

- [ ] **Step 1: Remove `{ value: 'archive', label: 'Archive' }` from `SECTION_CONFIG`** and delete the `{activeTab === 'archive' && <ArchiveTab .../>}` render line + the `ArchiveTab` import (if unused elsewhere).
- [ ] **Step 2: Redirect stale deep links.** Where `tabParam`/`activeTab` is resolved (`grep -n "tabParam\|activeTab" src/views/client/ClientPortal.jsx`), map `archive` → contacts+archived. Minimal approach: in the `activeTab` `useMemo`, translate the legacy value:
```js
  // Legacy deep links: Archive folded into Contacts (Status = Archived).
  if (tabParam === 'archive') return 'contacts';
```
and, when navigating from such a link, also set the status filter — simplest is to read an initial `status` query param in `ContactsTab` and seed `statusFilter` from it (add: `const [searchParams] = useSearchParams();` already present in ClientPortal; pass `initialStatus={tabParam === 'archive' ? 'archived' : (searchParams.get('status') || '')}` into `ContactsTab` and seed its state from it). Keep it small.
- [ ] **Step 3: Active-clients deep link.** If Task 1 decided `/active-clients` is portal-only, add a redirect at its route (in the router config — `grep -rn "active-clients" src/routes`) to `/portal?tab=contacts&status=active_client`. If staff still use it, skip this and leave the route.
- [ ] **Step 4: Verify.** `yarn build 2>&1 | tail -5`; eslint clean; manually confirm `/portal?tab=archive` lands on Contacts with the Archived filter applied.
- [ ] **Step 5: Commit.** `git add src/views/client/ClientPortal.jsx && git commit -m "feat(contacts): retire Archive tab → Contacts(status=archived) + redirects"`

---

## Task 4: Collapse Leads lifecycle sub-views to the inbox

**Files:** Modify `src/views/client/ClientPortal/LeadsTab.jsx`.

- [ ] **Step 1: Reduce `lifecycleFilter`.** Today Leads offers Lead Inbox / In Journey / Active Client / All Activity. Contacts now owns In-Journey + Active-Client browsing. Remove the **In Journey** and **Active Client** options from the Leads `lifecycleFilter` control, leaving the inbox (and "All Activity" if it's the firehose triage view). `grep -n "lifecycleFilter\|In Journey\|Active Client\|ActiveClientGroupedView" src/views/client/ClientPortal/LeadsTab.jsx` to find the filter options + the grouped views they render. Remove those option entries and the now-unreachable grouped-view branches; keep the inbox + all-activity table.
- [ ] **Step 2: Don't break shared pieces.** `ActiveClientGroupedView`/`ActiveClientDrawer` may still be used by the standalone Active Clients view — only remove their usage *inside LeadsTab*, not the components.
- [ ] **Step 3: Verify.** `yarn build 2>&1 | tail -5`; eslint clean (remove imports orphaned by the deletion); click through Leads to confirm the inbox still works and the removed sub-views are gone.
- [ ] **Step 4: Commit.** `git add src/views/client/ClientPortal/LeadsTab.jsx && git commit -m "feat(contacts): collapse Leads in-journey/active sub-views (Contacts owns the directory)"`

---

## Task 5: Phase PR
- [ ] Push, open PR (`feat(contacts): retire Active Clients/Archive/Leads sub-views (Phase 5)`), CodeRabbit, address findings, **stop for user merge approval**. In the PR body, list exactly what was unlinked vs deleted vs kept (from Task 1).

---

## Task 6: Client-facing Portal Update (on user go)

**Files:** none (API call / DB insert).

- [ ] **Step 1: Draft the announcement** (`type: 'feature'`):
  - **Title:** "Your new Contacts hub"
  - **Body:** "Everything about the people who reach out now lives in one place — your new **Contacts** list. See each person's status (new lead, in journey, active client, archived), the services they're interested in, tags, and full history; filter by any of it and export to CSV. The old Client List and Archive views have moved here."
- [ ] **Step 2: Confirm with the user, then post** via `POST /api/portal-updates/admin` (admin-only) — see `server/routes/portalUpdates.js` / `src/api/portalUpdates.js`. In local dev you may insert into `portal_updates` directly. Do **not** post without the user's go-ahead (CLAUDE.md rule).
- [ ] **Step 3: Record** in the rollout status table whether the Update was posted or declined.

## Notes for the executor
- **Unlink before delete.** Verify consumers (Task 1) before removing any component/route. When in doubt, keep the component and just remove the portal nav link + add a redirect.
- This phase changes what clients see → the Portal Update (Task 6) is the right place to announce; don't announce earlier phases separately.
- After this merges, the "people" surfaces are: **Leads** (inbox), **Contacts** (master list), **Pipeline/Lead Journey** (workflow). That's the simplification goal.
