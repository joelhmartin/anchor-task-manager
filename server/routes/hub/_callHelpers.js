// Shared call/lead-list helpers used by BOTH the /calls route handlers (extracted into
// ./calls.js) AND the /leads + /contacts tag routes that remain in ../hub.js. Anything
// here must stay free of a back-import from hub.js so there is no import cycle once
// calls.js is mounted on the hub router.
//
// Tag-name validation cluster — shared by /calls/:id/tags (in calls.js), /lead-tags and
// /contacts/:id/tags + /contacts/tag-options (in hub.js). Kept together so the reserved
// namespace has a single source of truth across all three tag surfaces.

// Category / lifecycle words are reserved — those states are rendered from derived disposition
// & lifecycle, never from free-form tags. Block them from the Tags namespace so the two systems
// can't overlap. Used by the tag-options filter, the tag-creation guards, and the cleanup
// migration (migrate_purge_reserved_category_tags.sql) alike.
// Matching is canonical: lowercase + collapse any run of separators (space/hyphen/underscore)
// to one space + trim — so "in-journey", "pending__review", "Not A Fit" all map onto their
// reserved form and can't slip past the guard. RESERVED_TAG_NAMES holds the canonical forms;
// keep this list in sync with the SQL array in migrate_purge_reserved_category_tags.sql.
export const normalizeTagName = (name) => String(name || '').toLowerCase().replace(/[-_\s]+/g, ' ').trim();
export const RESERVED_TAG_NAMES = [
  'qualified', 'spam', 'not a fit', 'unanswered', 'voicemail',
  'needs attention', 'priority', 'pending', 'pending review',
  'lead', 'new lead', 'in journey', 'active client'
].map(normalizeTagName);
export const RESERVED_TAG_NAME_SET = new Set(RESERVED_TAG_NAMES);
export const isReservedTagName = (name) => RESERVED_TAG_NAME_SET.has(normalizeTagName(name));
