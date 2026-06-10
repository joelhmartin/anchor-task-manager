# Fold Priority into Qualified (display-only) — Design

**Date:** 2026-05-21
**Branch:** `feature/priority-in-qualified`
**Status:** Approved design

## Problem

After the Qualified/Returning split (PR #86), `Qualified` is the default landing view. **Priority** (`needs_attention`) — real, urgent leads — is a *separate* filter chip. Users landing on Qualified may never click Priority, so genuinely urgent leads get overlooked. The separate chip makes the dashboard *less* functional now that the noise (Returning/Other) is already siphoned off.

## Goal

Surface Priority leads inside the Qualified view instead of behind their own chip — **display-only**. No classification, scoring, storage, or AI changes; `needs_attention` stays exactly as-is in the DB.

## Decisions (confirmed with user)

1. **Remove Priority from the filter-chip row.** Chips become: `Qualified · Returning/Other · Unanswered · Not a Fit · Spam · Pending Review`.
2. **Qualified contains qualified + `needs_attention` leads.** Priority rows **sort to the top** of the Qualified list (primary sort key), then the rest in normal order. **Not** pinned/sticky — normal scroll + pagination (a Priority row may land on a later page if there are many; accepted).
3. **Per-row chips unchanged.** A `needs_attention` row keeps its amber **Priority** chip; qualified rows show **Qualified**. Staff still see at a glance which are priority.
4. **Qualified badge count = qualified + priority** (matches the list length).
5. **The per-lead category editor keeps its Priority option** — staff can still classify/reclassify a lead as Priority; it just lands atop Qualified.

## Implementation

### Server (`server/routes/hub.js`)

- **Filter** (`category === 'qualified'` branch): match `not-pending AND ( (lead-bucket AND (non-call OR score≥3)) OR category='needs_attention' )`. The `returning` branch is unchanged.
- **Ordering**: when `category === 'qualified'`, prepend a priority-first key to the main listing `ORDER BY`:
  `(CASE WHEN COALESCE(meta->>'category','unreviewed') = 'needs_attention' THEN 0 ELSE 1 END), <existing sort>`. Apply to the post-sync listing query too if it sorts.
- **Count aggregate** (`qualified`, both initial + post-sync): same predicate as the filter (include `needs_attention`), so badge == list. The `returning` aggregate is unchanged.

### Frontend (`src/views/client/ClientPortal/LeadsTab.jsx`)

- The filter-chip row stops iterating all of `VISIBLE_CATEGORY_LABELS`; instead iterate an explicit `CATEGORY_FILTER_CHIPS = ['qualified','returning','unanswered','not_a_fit','spam','pending_review']` (no `needs_attention`). Labels/colors are still looked up from `VISIBLE_CATEGORY_LABELS`/`COLORS`, which **retain** `needs_attention` for the per-row chip.
- `getVisibleCategory`/per-row chip: **no change** — a `needs_attention` row already resolves to key `needs_attention` → label "Priority" → amber. `LeadActivityRow` unchanged.
- Qualified badge already reads `categoryCounts.qualified`, which now includes `needs_attention` server-side. The "other chips" sum loop already skips `qualified`/`returning`/`pending_review`; `needs_attention` raw counts simply aren't rendered as a chip.

## Edge cases

- No priority leads → no priority rows; Qualified looks as today.
- `needs_attention` no longer reachable as its own filter — intended; it only appears within Qualified now.
- All Activity + Qualified applies the same combined view + priority-first sort — consistent.
- Pending `needs_attention` (rare) stays excluded via the not-pending guard → Pending Review only.

## Compliance

Display-only. No new SQL injection surface (parameterized `$n::text[]` array reused; the `'needs_attention'` literal is a constant). No PHI. No auth/scope changes.

## Verification

`node --check`, `npx eslint` on changed files, `yarn build`, and run the updated `qualified` filter + count SQL against the local DB. Browser visual check (chip row no longer shows Priority; needs_attention rows sit atop Qualified with their amber chip; badge == list) is user-run.
