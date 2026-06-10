// Server-side equivalents of src/hooks/useClientLabel.js — for places that have
// already loaded a user/client row and need to compose a display name in JS.

function trim(value) {
  if (value == null) return '';
  return String(value).trim();
}

/**
 * Compose a person's display name from a user row.
 * Fallback chain: first+last → email → fallback.
 *
 * @param {object} row — a row with first_name, last_name, email
 * @param {string} [fallback='Unknown']
 * @returns {string}
 */
export function formatUserName(row, fallback = 'Unknown') {
  if (!row) return fallback;
  return (
    trim(`${row.first_name || ''} ${row.last_name || ''}`) ||
    trim(row.email) ||
    fallback
  );
}

/**
 * Compose a client's display name from a row that may carry the canonical
 * fields (client_label / client_identifier_value / business_name) or just the
 * user fields. Mirrors the frontend hook.
 *
 * @param {object} row
 * @param {string} [fallback='Unknown']
 * @returns {string}
 */
export function formatClientLabel(row, fallback = 'Unknown') {
  if (!row) return fallback;
  const idPrefix = row.id ? `Client ${String(row.id).slice(0, 8)}` : null;
  return (
    trim(row.client_label) ||
    trim(row.client_identifier_value) ||
    trim(row.business_name) ||
    trim(`${row.first_name || ''} ${row.last_name || ''}`) ||
    trim(row.email) ||
    idPrefix ||
    fallback
  );
}
