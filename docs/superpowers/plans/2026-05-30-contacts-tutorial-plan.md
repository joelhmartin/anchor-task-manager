# Contacts Tutorial — Build Plan (handoff for a fresh agent)

> **Goal:** A guided, in-app tutorial for the **Contacts** experience shipped in the Contacts Master List rollout (Phase 5). Teaches a client user how to find any person regardless of lifecycle (new lead, in journey, active client, **archived**), filter precisely (status + multi-select tags/services), open a profile, archive/restore, see services + attribution, and export — plus how the Leads switcher relates to Contacts.
>
> **Status when written (2026-05-30):** Phase 5 is on branch `feat/contacts-master-list` (PR #123), verified clean, **awaiting user merge**. Decide with the user whether to build this **on that branch** (ships with Phase 5) or as a **follow-up PR after Phase 5 merges**. If on the branch, `git rebase origin/main` first.
>
> **This plan was written after reading the actual tutorial engine — the field names and mechanics below are verified against the code, not assumed.**

---

## 0. Read these first
- `src/tutorials/gettingStarted.js` — **the canonical template** (shortest, cleanest). Copy its shape exactly.
- `src/tutorials/leadJourneys.js` — richest multi-step tour with `navigateTo` hops + a drawer (uses a mock-journey pattern, see §4).
- `src/tutorials/index.js` — the registry array `TUTORIALS`. New tutorials are imported + added here. Order = display order in the Tutorials tab.
- `src/contexts/TutorialContext.jsx` — engine: `startTutorial(id)`, auto-launch of `getting-started`, and the **`?tutorial=<id>` deep-link launcher** (a Portal Update "Learn more" link can deep-link straight into this tutorial).
- `src/ui-component/extended/TutorialRunner.jsx` — the renderer (reacts to `target`, `title`, `content`, `placement`, `disableScrolling`).
- `server/routes/tutorials.js` — completion API.

---

## 1. Verified step + tutorial shape (USE THESE EXACT FIELDS)
Tutorial object:
```js
const contactsOverview = {
  id: 'contacts-overview',          // NOTE: new unique id — see §5 re: completion model
  label: 'Your Contacts Hub',
  description: 'Find anyone, filter precisely, and export — your whole people directory in one place.',
  estimatedMinutes: 3,
  audience: 'client',
  steps: [ /* ... */ ]
};
export default contactsOverview;
```
Step object (these are the ONLY fields the renderer reads):
```js
{
  target: '[data-tutorial="contacts-status"]', // CSS selector, or 'body' for a centered modal
  title: 'Filter by status',
  content: 'One or two sentences, warm + plain.',   // NOTE: field is `content`, NOT `body`
  placement: 'bottom',           // top | bottom | left | right | center
  navigateTo: '/portal?tab=contacts', // optional; navigate before showing the step (NOT `route`)
  disableScrolling: true         // optional; auto-true for centered/body steps
}
```
- **Centered modal** = `target: 'body'` + `placement: 'center'` (that's how `TutorialRunner` detects it). Use for intro/outro and for any step that can't reliably spotlight a live element.
- There is **no** `version`, `spotlightPadding`, or `disableInteraction` field. Don't invent fields.

---

## 2. Completion model — IMPORTANT (no versioning)
Completion is stored in `user_tutorial_completions` keyed on `(user_id, tutorial_id)` only — **there is no version column** (`server/routes/tutorials.js`). Implications:
- A brand-new tutorial with a **new id** (e.g. `contacts-overview`) will show to everyone, including users who completed older tours. ✅ This is what we want — **use a fresh id, not an existing one.**
- Do NOT try to "bump a version" to re-trigger; that mechanism doesn't exist.
- Don't reuse an old id expecting a re-show — past completers would never see it.

---

## 3. Prerequisite: add `data-tutorial` anchors (REQUIRED — none exist yet on Contacts)
`ContactsTab.jsx` has **zero** `data-tutorial` attributes today, and the nav has no `nav-contacts`. The runner spotlights by `document.querySelector`, so add stable anchors first (inert in normal use). Put them on stable wrapper elements that don't conditionally unmount.

**`src/menu-items/portal.js`** (Contacts nav item): add `dataTutorial: 'nav-contacts'` — matches existing `nav-leads`/`nav-journey`. Confirm the Sidebar renderer forwards `dataTutorial` → `data-tutorial` (it does for the others; verify).

**`src/views/client/ClientPortal/ContactsTab.jsx`** — add `data-tutorial="…"` to:
- `contacts-search` (search TextField)
- `contacts-status` (Status SelectField)
- `contacts-tags` (Tags multi-select)
- `contacts-services` (Services multi-select)
- `contacts-export` (Export CSV button)
- `contacts-table` (the DataTable wrapper / list)

**`src/views/client/ClientPortal/LeadsTab.jsx`** — add `data-tutorial="leads-switcher"` to the New Leads / Lead Journeys / Contacts tab bar (the `repeat(3, 1fr)` grid) so a step can show Contacts is reachable from Leads too.

> The **profile drawer** (services history + archive/restore) is hard to spotlight without an open drawer and a real contact. **Recommended: describe those with centered-modal steps** (`target: 'body'`) rather than anchoring — no seeded PHI, no empty-state stalls. (Only if the user wants true spotlighting: mirror the `leadJourneys` mock pattern — `ClientPortal.jsx` `drawerTutorialMode` + `src/tutorials/mockData.js` — which is real work; default to centered modals.)

---

## 4. What it must teach (user's explicit ask: "encompass contacts — how all leads/statuses are found, archived, whatever")
1. Contacts is the **master directory** — everyone who's reached out, one row each, regardless of lifecycle. Replaces the old Client List + Archive.
2. **Status filter** finds people by lifecycle: New Lead / In Journey / Active Client / **Archived**. Note archived are **hidden by default** and live under Status = Archived.
3. **Tags + Services are multi-select (AND)** — pick two services → only people with BOTH; same for tags. The precise-targeting feature.
4. **Search** — name / phone / email.
5. **Reading a row** — status chip, tags, services, last activity, activity count.
6. **Profile drawer** — identifiers, tags, consent, **services history** (source + date), full activity timeline, **inline Archive / Restore**.
7. **Export CSV** — exports the **current filtered set across all pages** (not just the page); column-picker dialog (Name/Phone/Email/Tags/Services default; optional Status, First source, Sources touched, activity dates).
8. **Relationship to Leads** — Leads = inbox for brand-new activity; its top bar switches to Lead Journeys and Contacts. Contacts = browse/manage the whole directory.

Keep each `content` to 1–2 sentences; warm, plain brand voice ("Find anyone in seconds," not "Utilize the filtration controls").

---

## 5. Proposed steps (~11; adapt)
0. `target:'body', placement:'center', navigateTo:'/portal?tab=contacts'` — intro: "Meet Contacts — everyone who's reached out, in one place."
1. `[data-tutorial="leads-switcher"]` (navigateTo `/portal?tab=leads`) — "Contacts also lives right here on your Leads bar."
2. back to contacts (navigateTo `/portal?tab=contacts`), `[data-tutorial="contacts-search"]` — search by name/phone/email.
3. `[data-tutorial="contacts-status"]` — filter by lifecycle; Archived hidden by default, found here.
4. `[data-tutorial="contacts-tags"]` — multi-select tags (AND).
5. `[data-tutorial="contacts-services"]` — multi-select services (AND); "everyone interested in two specific services."
6. `[data-tutorial="contacts-table"]` — reading a row.
7. `target:'body', placement:'center'` — "Click any contact to open their full profile." (centered; no live drawer needed)
8. `target:'body', placement:'center'` — services history + activity timeline (centered).
9. `target:'body', placement:'center'` — inline Archive / Restore; archived move out of the default view.
10. `[data-tutorial="contacts-export"]` — export the filtered set; choose columns.
11. `target:'body', placement:'center', navigateTo:'/portal?tab=tutorials'` — outro.

---

## 6. Register
- Create `src/tutorials/contacts.js` (default export the object from §1).
- In `src/tutorials/index.js`: `import contactsOverview from './contacts';` and add it to the `TUTORIALS` array in the **Client-audience** group (e.g. after `leads`). `audience: 'client'` keeps it out of the admin set.
- **Optional nicety:** update the Portal Update body's CTA to deep-link the tour: a link to `/portal?tab=contacts&tutorial=contacts-overview` launches it (the `?tutorial=` deep-link handler in TutorialContext). (`portal_updates.link_url` must be an absolute `https://` URL per the route validator — so for prod use the full dashboard URL; confirm the BannerUpdate renders link_url as the CTA.)

---

## 7. Verify (no test suite — `.claude/skills/verify-without-tests/`)
- `yarn build` + `npx eslint` on every touched file — no new errors.
- `./dev.sh`, log in as a client (or impersonate). Launch via **Tutorials tab → this tutorial** (and/or `?tutorial=contacts-overview`). Click through **every** step: each spotlight lands on the right element, `navigateTo` hops work, centered steps render, the tour is escapable, and completion persists (doesn't re-show once finished).
- Confirm the other tab tutorials still work (shared engine/renderer).
- Seed a couple of local contacts + tags/services so the spotlighted Contacts UI isn't empty during the walkthrough.

---

## 8. Guardrails (CLAUDE.md)
- No PHI in tutorial copy or logs; don't seed real PHI to make a step work — centered modals avoid it.
- Co-located relative imports OK; shared components via `ui-component/*`.
- Warm brand voice; short steps.
- If on `feat/contacts-master-list`: rebase first, then PR + CodeRabbit + **stop for user merge approval** (main auto-deploys to prod). Re-review after any Major finding.

---

## 9. Decisions to confirm with the user up front
- Build **on the Phase 5 branch** (ships together) or **separate follow-up PR** (after merge)?
- Drawer steps: **centered-modal** (default, simplest) vs **true spotlight** with the mock-drawer pattern (more work)?
- Should the Portal Update CTA **deep-link** into the tutorial (`?tutorial=contacts-overview`)?
- Auto-launch behavior: leave as Tutorials-tab/deep-link only (recommended), since auto-launch is currently hardcoded to `getting-started` for first-time clients — making this one auto-launch would require touching TutorialContext.
