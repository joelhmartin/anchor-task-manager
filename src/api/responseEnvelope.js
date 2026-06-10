// Frontend shim for the in-progress response envelope migration.
//
// Backend endpoints are migrating from per-endpoint named-key shapes
//   { workspaces: [...] }     { workspace: {...} }
//   { ok: true }              { success: true }
// to a single canonical envelope:
//   { data, meta?, error? }
//
// Each migrated endpoint can swap its server-side shape independently. To
// avoid coordinating a big-bang frontend release with the backend, this
// helper reads both shapes — preferring the new envelope when present and
// falling back to the legacy named key otherwise. Once every task-manager
// endpoint is migrated, callers can drop the legacy key and just read
// `res.data.data`.
//
// `unwrapData(res, opts)` returns the payload (object/array/null).
// `unwrapMeta(res)` returns the `meta` object or null.
//
// Example call sites (drop the second arg once the matching backend
// endpoint is migrated and its legacy key is removed):
//   client.get('/tasks/workspaces').then((res) => unwrapData(res, { legacyKey: 'workspaces', fallback: [] }))

function getBody(res) {
  return (res && res.data) || null;
}

/**
 * Extract the success payload from a response that may use either the new
 * `{ data }` envelope or a legacy `{ <legacyKey>: ... }` named-key shape.
 *
 * @param {object} res - axios response
 * @param {object} [opts]
 * @param {string} [opts.legacyKey] - named key in the legacy shape (e.g. 'workspaces')
 * @param {*} [opts.fallback] - returned when both shapes are absent (default null)
 * @returns {*} the payload
 */
export function unwrapData(res, { legacyKey, fallback = null } = {}) {
  const body = getBody(res);
  if (!body) return fallback;
  if (Object.prototype.hasOwnProperty.call(body, 'data')) return body.data;
  if (legacyKey && Object.prototype.hasOwnProperty.call(body, legacyKey)) {
    return body[legacyKey];
  }
  return fallback;
}

/**
 * Extract the `meta` block (limit/offset/total) from a response. Returns
 * null when the endpoint hasn't been migrated or doesn't carry meta.
 */
export function unwrapMeta(res) {
  const body = getBody(res);
  if (!body) return null;
  return body.meta || null;
}
