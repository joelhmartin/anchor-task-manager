# Leads / Journey / Contacts — UX & Ease-of-Use Audit Plan

> **For the auditing agent:** This is a **read-only audit plan**, not a code-implementation plan. You produce ONE deliverable: a prioritized findings report. **Do NOT modify application code.** The only file you create/edit is the audit report. Work the tasks in order; each appends findings to the report using the schema in §3.
>
> **REQUIRED SUB-SKILL:** Use `superpowers:executing-plans` to work this task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit the entire client-facing **Leads → Lead Journeys → Contacts** experience for ease of use, inconsistencies, oddities, and concrete UI/UX improvements — from the perspective of a non-technical client user (front-desk staff at a healthcare practice).

**Approach:** Static audit by reading the actual components + tracing user flows, scored against (a) Nielsen's usability heuristics and (b) this repo's own UX rules in `CLAUDE.md`. The populated demo account (`demo@anchorcorps.com` / Bright Smiles Family Dentistry — 40 calls, 39 contacts, 9 journeys, 3 active clients) is your reference dataset for "what real data looks like." Output is a prioritized findings report with file:line evidence, severity, and a recommended change for each item.

**Constraints:**
- **Read-only.** No edits to `src/` or `server/`. Findings only.
- **No browser automation on this machine** (hard rule — see `CLAUDE.md` / global rules). You cannot click, screenshot, or drive Chrome. Audit via code + reasoning, and accumulate a **Human Verification Checklist** (§3.4) of things that genuinely need a live click-through, so the human can confirm them.
- **No PHI in the report** (HIPAA). Refer to demo/sample names only; never paste real client data.
- **Client-experience first.** Staff-only features inside these surfaces (merge queue, split, impersonation banner, `isStaff` branches) are in scope but tag them `audience: staff` and prioritize client-facing findings.

**Tech context:** React 19 + MUI 7 (note: `@mui/material/Grid` is aliased to GridLegacy), JSX (no TS), Vite. Shared component library in `src/ui-component/extended/`. No automated test suite — verification is build/lint + visual.

---

## 1. Orientation — read these before auditing anything

Read fully (or with offsets for the large ones). These ARE the section under audit:

| File | What it owns |
|------|--------------|
| `src/views/client/ClientPortal.jsx` (~465 ln) | Portal shell, `SECTION_CONFIG` tab routing, `?tab=`/`?status=`/`archive` redirects, shared journey-drawer + dialog choreography, keyboard shortcuts (number keys) |
| `src/views/client/ClientPortal/LeadsTab.jsx` (~3,575 ln) | Lead inbox + All-Activity firehose, the 3-way lifecycle switcher (New Leads / Lead Journeys / Contacts), search, filters, category chips, lead-detail drawer, row actions (start journey, convert, tag, hide/dismiss) |
| `src/views/client/ClientPortal/JourneyTab.jsx` | Journey Pipeline board + Email Templates sub-tab |
| `src/hooks/useJourneyDrawer.jsx` | The journey drawer (Notes / Activity tabs, Send Email, Convert to Client, Archive) |
| `src/views/client/ClientPortal/ContactsTab.jsx` (~490 ln) | Contacts master list, status/tags/services filters, search, CSV export dialog, merge badge |
| `src/views/client/ClientPortal/contacts/ContactProfileDrawer.jsx` | Contact profile: identifiers, tags, consent, services ledger, activity timeline, archive/restore, split |
| `src/views/client/ClientPortal/contacts/MergeQueuePanel.jsx` + `SplitContactDialog.jsx` | Staff merge/split |
| `src/views/client/ClientPortal/leads/LeadActivityRow.jsx` + `leads/leadCategory.js` | Activity row rendering + the visible-category mapping |
| `src/views/client/ClientPortal/ConcernDialog.jsx` + `ServiceDialog.jsx` | Start-journey concerns + convert-to-client/agree-to-service flows |
| `src/menu-items/portal.js` | Sidebar nav items + grouping for these surfaces |

Also read these conventions (they are scoring criteria, not background):
- `CLAUDE.md` → **Conventions** section: *Client Display Name* (HARD RULE), *Immediate UI Updates* (HARD RULE), *Toast on Every State Change*, *No Browser Dialogs*, *Client Portal Updates — ask before big changes*, *Shared Component Library* table, *Brand Voice & Tone*.
- `CLAUDE.md` → **Known Gotchas** #12 (`hidden_at` is inbox-triage only) and the **AI Classification** section (the canonical 5 categories + Pending Review, tag semantics, first-touch attribution) — terminology the UI must use consistently.
- `src/ui-component/extended/` — confirm what shared components exist (DataTable, StatusChip, SelectField, EmptyState, LoadingButton, FormDialog, ConfirmDialog) so you can flag any place these surfaces hand-roll something a shared component already does.

- [ ] **Step 1:** Read the Orientation files above. Note the structure of each in scratch notes (you'll cite file:line in findings).
- [ ] **Step 2:** Read the cited `CLAUDE.md` sections. Write the rule list into the report's "Scoring criteria" section (§3.3) so findings can reference rule IDs.

---

## 2. Heuristic lenses (apply every one to every surface)

Score each surface against these. A finding usually = a heuristic violated at a specific place.

**A. Nielsen usability heuristics (general):**
1. Visibility of system status (loading, saving, counts, "what tab am I on")
2. Match between system and the real world (client-friendly words, not internal jargon)
3. User control & freedom (undo, escape, back, cancel, restore)
4. Consistency & standards (same word/icon/action means the same thing everywhere)
5. Error prevention (confirm destructive acts; disable invalid actions)
6. Recognition over recall (don't make the user remember a filter/state)
7. Flexibility & efficiency (search, shortcuts, bulk, sensible defaults)
8. Aesthetic & minimalist design (no redundant/competing controls)
9. Help users recognize/recover from errors (clear, kind error messages)
10. Help & documentation (empty states, tooltips, the tutorials)

**B. Repo-specific rules (from `CLAUDE.md` — cite these by name):**
- `R-NAME`: Client display name uses `client_identifier_value` (business name), never email/first-last.
- `R-IMMEDIATE`: Every action reflects in the UI immediately (no need to reopen drawer / switch tab / reload).
- `R-TOAST`: Every state change shows a toast on **both** success and failure.
- `R-NODIALOG`: No `window.alert/confirm/prompt` — use `ConfirmDialog`/`FormDialog`.
- `R-SHARED`: Reuse shared components instead of hand-rolling.
- `R-VOICE`: Warm, plain, playful-but-professional copy (not corporate/jargon).
- `R-HIDDEN`: `hidden_at` is inbox-triage only; shouldn't leak into other tabs' meaning.
- `R-TERMS`: Categories are the canonical 5 (+ Pending Review); tags ≠ categories; "Existing Client" / "Active Client" used consistently.

**C. Cross-surface flow lens (the thing the user most cares about):**
- Is the **relationship** between Leads, Lead Journeys, and Contacts obvious to a client? Or do the three overlapping "lists of people" confuse?
- Can a client follow one person from first inquiry → journey → active client → archived **without getting lost**?
- Are there **two doors to the same room** that aren't explained (e.g. Contacts as a sidebar item AND a Leads switcher tab; Client List/Archive redirecting into Contacts)?

---

## 3. The report — format, location, schema

### 3.1 Location
Create: `docs/superpowers/audits/2026-05-31-leads-journey-contacts-ux-audit.md`
(Create the `docs/superpowers/audits/` directory if it doesn't exist.)

### 3.2 Report skeleton (write this first, fill as you go)
```markdown
# Leads / Journey / Contacts — UX Audit Findings
_Audited: <date>. Auditor: <agent>. Method: static code review (no live browser — see Human Verification Checklist)._

## Executive summary
<filled last — 5-8 sentences: overall ease-of-use verdict, the 3 biggest themes, the single highest-impact fix.>

## Top 10 recommendations (prioritized)
<filled last — table: # | Finding ID | Title | Severity | Effort | Why it matters to a client>

## Scoring criteria
<the heuristic + repo-rule lists from §2, so findings can cite IDs>

## Findings
<one entry per finding, grouped by surface: Navigation/IA, Leads, Journeys, Contacts, Cross-surface, Cross-cutting quality>

## Human Verification Checklist
<things the agent could not confirm without a live click-through>

## Out of scope / explicitly OK
<patterns you checked and judged fine — prevents re-litigation later>
```

### 3.3 Finding schema (use verbatim for every finding)
```markdown
### [F-##] <Short imperative title>
- **Surface:** Navigation | Leads | Journeys | Contacts | Cross-surface | Cross-cutting
- **Audience:** client | staff | both
- **Severity:** P0 (blocks/ misleads a client) | P1 (frequent friction) | P2 (polish) | P3 (nice-to-have)
- **Heuristics/Rules:** <e.g. "Consistency (#4), R-TERMS">
- **Evidence:** `path/to/file.jsx:LINE` — <1-line of what the code does>
- **What a client experiences:** <plain description of the friction/oddity>
- **Recommended change:** <specific, actionable — what to do, not "improve this">
- **Effort:** S (<1h) | M (half-day) | L (multi-day) | XL (needs design)
- **Needs live confirm?:** yes/no (if yes, add to Human Verification Checklist)
```

### 3.4 Rules for findings
- Every finding cites **at least one `file:line`**. No vibes-only findings.
- Severity is from the **client's** point of view, not engineering difficulty.
- If you're unsure whether something is actually broken vs. just looks odd in code, mark **Needs live confirm? yes** and add a precise click-path to the Human Verification Checklist (e.g. "Log in as demo, Leads → switch to Lead Journeys → confirm the date filter resets visibly").
- Prefer **specific** recommendations ("rename the switcher tab 'New Leads' label's sub-count unit from 'Leads' to 'New' to disambiguate from journeys count") over generic ones.

- [ ] **Step 1:** Create the directory + report file with the §3.2 skeleton and the §2 criteria filled into "Scoring criteria."
- [ ] **Step 2:** Commit nothing (read-only repo work) — just save the report file. You'll append to it through Tasks 4–10.

---

## 4. Navigation & Information Architecture

**Read:** `src/menu-items/portal.js`, `src/views/client/ClientPortal.jsx` (esp. `SECTION_CONFIG`, `resolvedTabParam`, `contactsInitialStatus`, the number-key shortcut `tabMap`), `src/layout/MainLayout/MenuList/NavItem/index.jsx`.

- [ ] **Look for / record findings on:**
  - **Dual surfacing of Contacts:** it's both a sidebar item (`portal-contacts`) and a tab inside the Leads switcher (`lifecycleFilter === 'contacts'` renders `ContactsTab` inline). Is this explained, or does it create "why is this in two places?" confusion? Do both routes land in the same state?
  - **Redirect semantics:** `?tab=archive` → Contacts (Status=Archived); `/active-clients` → Contacts (status=active_client). Does the page **tell** the user "Client List & Archive now live in Contacts," or do they just get silently teleported? (Check for an explanatory banner / heading.)
  - **Tab naming consistency:** sidebar says "Lead Journeys" (`portal-journey`) and "Leads"; `SECTION_CONFIG` labels the journey tab "Lead Journey" (singular) and the leads switcher uses "New Leads / Lead Journeys / Contacts." Catalog every label for the same surface and flag mismatches (`R-TERMS`, Consistency #4).
  - **Hidden number-key shortcuts** (`tabMap` 1–7 in `ClientPortal.jsx`): undiscoverable; `6=contacts`, `7=reviews` even though Reviews is hidden from the sidebar. Flag as oddity + accidental-trigger risk.
  - **Header visibility:** `activeTab !== 'analytics' && activeTab !== 'leads'` hides the `<Typography h4>` section title. So Leads has no page heading — intentional? Is the user oriented?
  - **Sidebar grouping:** Leads + Lead Journeys + Contacts sit under group "My Clients" while Profile/Analytics/etc. sit under "Client Portal." Does the grouping label make sense to a client?

---

## 5. Leads tab

**Read:** `src/views/client/ClientPortal/LeadsTab.jsx` (use offsets; key regions: the lifecycle switcher ~1390–1463, search/filter bar ~1471+, card list `data-tutorial="leads-card-list"`, table `leads-table`, the lead-detail drawer, row actions `lead-actions`/`lead-start-journey`), `leads/LeadActivityRow.jsx`, `leads/leadCategory.js`.

- [ ] **Look for / record findings on:**
  - **Inbox vs All-Activity mental model:** "New Leads owns both the qualified inbox and the All-Activity firehose." Is the toggle between qualified inbox and all-activity obvious, or buried? Can a client tell *why* a row is or isn't shown?
  - **Category chips:** confirm the UI only ever surfaces the canonical 5 + Pending Review (`leadCategory.js` `VISIBLE_CATEGORY_*`). Flag any place an internal label (`warm`, `very_good`, `applicant`, etc.) leaks to the client (`R-TERMS`).
  - **Switcher counts & units:** the 3 tabs show `{count} {unit}` ("Leads"/"Contacts"). Check the counts are correct & not confusing (e.g. journeys count vs lead count vs contacts count meaning three different things).
  - **Search & filters:** placement, debounce, whether filters visibly reset when switching tabs (the switcher resets some state for `in_journey` — does the user *see* that happen? Recognition #6), empty-result messaging.
  - **Row actions:** Start Journey, Convert, Tag, Hide/Dismiss. Are destructive/irreversible actions confirmed (`R-NODIALOG`, Error prevention #5)? Do they update the list immediately (`R-IMMEDIATE`)? Toast on success+failure (`R-TOAST`)?
  - **Hide/Dismiss semantics (`R-HIDDEN`):** confirm hide is inbox-only and the affordance communicates "this hides from the inbox," not "deletes the lead." Is a hidden lead recoverable from the UI?
  - **Lead drawer:** overview/notes/tags/AI summary/activity — scan for missing loading states, empty states, and whether closing/reopening is required to see changes.
  - **Empty & loading states:** what does a brand-new client with zero leads see? Is it welcoming (`EmptyState`, `R-VOICE`) or a blank table?
  - **Large-file smell:** 3,575 lines — note (as a maintainability aside, low client severity) any obviously duplicated UI that a shared component or extraction would DRY up.

---

## 6. Lead Journeys

**Read:** `src/views/client/ClientPortal/JourneyTab.jsx`, `src/hooks/useJourneyDrawer.jsx`, `ConcernDialog.jsx`, `ServiceDialog.jsx`, and the journey-create wrapper + `handleConvertJourney`/`handleServiceAgreed` in `ClientPortal.jsx`.

- [ ] **Look for / record findings on:**
  - **Pipeline legibility:** stages First Touch → … → Awaiting Decision. Are stage names client-friendly and self-explanatory? Is it clear how a card *moves* between stages (drag? button? "Mark Complete")?
  - **Drawer tabs:** Notes (default) vs Activity. Is the distinction clear? Is the note composer obvious? Does a new note appear immediately (`R-IMMEDIATE`) with a toast (`R-TOAST`)?
  - **Convert-to-Client flow:** Journey drawer "Convert to Client" → `ServiceDialog` (agree-to-service) → creates active client, closes journey, drops the lead. Trace the full path and flag: surprise steps, missing confirmation, unclear "what just happened / where did they go" (the person now lives in Contacts as Active Client — is that communicated?).
  - **Start-journey from a lead:** `ConcernDialog` — are concern/service presets sensible? Required fields clear? Cancel-safe?
  - **Pause / Archive / Mark Complete:** confirm-on-archive? Is "Archive" here the same concept as Contacts archive, or a different thing wearing the same word? (Consistency #4 — likely a real oddity: journey archive ≠ contact archive.)
  - **"Send Email" + Templates:** is the templates sub-tab discoverable from where you'd compose? Token usage (e.g. client name) explained? What happens with zero templates (empty state)?
  - **Empty states:** zero active journeys — does the pipeline invite the user to start one from a lead, or show an empty board?

---

## 7. Contacts

**Read:** `src/views/client/ClientPortal/ContactsTab.jsx`, `contacts/ContactProfileDrawer.jsx`, `contacts/MergeQueuePanel.jsx`, `contacts/SplitContactDialog.jsx`.

- [ ] **Look for / record findings on:**
  - **Filter model:** Status (single) + Tags (multi, AND) + Services (multi, AND) + search. Is the **AND** semantics for tags/services discoverable, or will a client expect OR and get confused by "0 results"? (Match real-world #2, Recognition #6.)
  - **Archived-hidden-by-default:** is it obvious archived contacts exist but are hidden until Status=Archived? (Visibility #1.)
  - **Multi-select summary text:** `"N tags" / "N services"` renderValue — clear enough, or cryptic? Does selecting show checkmarks?
  - **Export dialog:** column picker (Name/Phone/Email/Tags/Services default + derived). Is "exports the **filtered set across all pages**, not just this page" communicated (it is in copy — verify it's prominent)? Cap at 10k — is the user warned if truncated? (Visibility #1, no silent caps.)
  - **Profile drawer sections:** Identifiers, Tags (add/remove), Consent (SMS/email opt-out), Services ledger (source + date), Activity timeline (load-more), Archive/Restore, Split (staff). For each: loading state? empty state? immediate update + toast on every mutation (`R-IMMEDIATE`, `R-TOAST`)? Is "rename contact" discoverable (the pencil icon)?
  - **Consent toggles labeled "opted out":** double-negative ("SMS opted out" ON = they DON'T get SMS). Flag as comprehension risk (Match real-world #2).
  - **Display name (`R-NAME`):** confirm contact rows/drawers show a sensible human/business name and the "✎ set by you" affordance is clear; flag any fallback to raw email/phone where a name should be.
  - **Merge queue (staff):** badge count, the review flow, undo-ability. **Audience: staff.**
  - **Split (staff):** only shows with >1 identifier; is the action's consequence explained? **Audience: staff.**
  - **Status chip taxonomy:** New Lead / In Journey / Active Client / Archived vs the Leads category chips — make sure a client isn't seeing two different chip systems for "the same person" without explanation (Cross-surface; Consistency #4).

---

## 8. Cross-surface flow & terminology

**Read:** re-trace using `ClientPortal.jsx` (drawer/dialog choreography, `lead-converted` custom event, `leadDrawerOpenerRef`, `closeJourneyDrawerRef`).

- [ ] **Look for / record findings on:**
  - **One person, three views:** follow a single demo person (e.g. "Marcus Williams" appears as a lead, a won journey, AND an active client). Does the app make these feel like **one person** or three disconnected rows? Is there cross-linking (open the contact from a lead row / from a journey)?
  - **Vocabulary audit:** make a table of every user-facing noun used for a person across the three surfaces — *lead, contact, client, active client, journey, caller, existing client, new lead* — and flag where the same thing has different names or different things share a name (`R-TERMS`, Consistency #4). This is likely the richest source of "ease of use" findings.
  - **Navigation continuity:** when an action moves a person (convert lead → active client; archive contact), does the UI guide the user to where they went, or just make them vanish? (User control #3, Visibility #1.)
  - **Duplicate controls:** Contacts reachable two ways (§4) — decide & recommend whether that's a feature (convenience) or a confusion, with a concrete recommendation.
  - **Deep-link / tutorial coherence:** the `?tutorial=` deep-links and the new Contacts tour — do the tours describe the CURRENT IA accurately? (Note: a separate task already fixed stale "Client List" copy; spot-check nothing else is stale.)

---

## 9. Cross-cutting quality sweep

Apply across all four surfaces; record findings tagged **Cross-cutting**.

- [ ] **Toast coverage (`R-TOAST`):** grep each surface for state-changing calls (`addContactTag`, `archiveContact`, `convertJourney`, tag/hide/convert in `LeadsTab`, etc.) and verify a toast fires on **both** success and failure. List any silent action.
- [ ] **Immediate UI update (`R-IMMEDIATE`):** for each mutation, verify local state updates from the server response (not refetch-only). Flag any action that needs a manual reload/reopen to reflect.
- [ ] **No browser dialogs (`R-NODIALOG`):** grep all four surfaces for `window.confirm`/`alert`/`prompt`. Any hit = P1 finding.
- [ ] **Shared-component compliance (`R-SHARED`):** flag hand-rolled tables/empty-states/selects/confirm-modals where `DataTable`/`EmptyState`/`SelectField`/`ConfirmDialog`/`FormDialog` exist.
- [ ] **Loading & empty states:** every async list/drawer should show a loader and a kind empty state. List the gaps.
- [ ] **Error copy & brand voice (`R-VOICE`):** sample error/empty/success strings; flag corporate/jargon/robotic copy and propose warmer rewrites (give the rewrite).
- [ ] **Responsive / mobile:** scan `sx` for fixed widths (e.g. `width: 150` selects, `repeat(3, 1fr)` switcher, drawer widths) and flag where the filter bar / switcher / drawers likely break or overflow on a phone. **Needs live confirm? yes** for the worst offenders.
- [ ] **Accessibility:** check for icon-only buttons missing `aria-label`, color-only status signaling (chips), focus management on drawer open/close, and keyboard operability of card lists (`role="button"` + key handlers exist in `LeadActivityRow` — verify it's consistent elsewhere).
- [ ] **MUI Grid gotcha:** note any new layout that assumes Grid2 API (aliased to GridLegacy) — low client severity, flag as risk.

---

## 10. Synthesize & prioritize

- [ ] **Step 1:** Re-read all findings. **Dedupe** (same root cause across surfaces → one finding with multiple evidence lines). Ensure every finding has a severity, effort, and a concrete recommendation.
- [ ] **Step 2:** Fill **Top 10 recommendations** — sort by client impact ÷ effort. Call out **Quick Wins** (S-effort, P0/P1) explicitly as a sub-list.
- [ ] **Step 3:** Write the **Executive summary** (themes, biggest fix, overall ease-of-use verdict in plain language the user can act on).
- [ ] **Step 4:** Finalize the **Human Verification Checklist** — concrete click-paths against the demo account for everything marked "Needs live confirm." Group by surface.
- [ ] **Step 5:** Fill **Out of scope / explicitly OK** with patterns you checked and judged fine.
- [ ] **Step 6:** Sanity pass: every finding cites file:line; no PHI; no generic "improve X" recommendations; severities are client-perspective. Save the report.

---

## Self-review checklist (run before declaring done)
- [ ] Every surface in §4–§9 has at least one finding **or** an explicit "explicitly OK" note (silence ≠ audited).
- [ ] Every finding cites a real `file:line` and a specific recommendation.
- [ ] The vocabulary table (§8) exists — it's the heart of "ease of use."
- [ ] No application code was modified (`git status` shows only the new report file).
- [ ] No PHI anywhere in the report.
- [ ] Top 10 + Quick Wins + Executive summary are filled.
- [ ] Human Verification Checklist gives exact click-paths against the demo account.

## Handoff
Present the report path + a 5-line summary of the top themes, and offer the human a follow-up: "Want me to turn the Top N findings into an implementation plan?" (That would be a *separate* `writing-plans` pass — not part of this audit.)
