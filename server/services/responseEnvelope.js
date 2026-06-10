// Canonical JSON response envelope for new/migrated task-manager endpoints.
//
// Convention: every migrated endpoint returns either
//   { data, meta? }   on success
//   { error: { code, message } }   on failure (status >= 400)
//
// `data` carries the payload (object, array, or null for "no body" mutations).
// `meta` is optional — used by paginated list endpoints to carry
// `{ limit, offset, total }` etc.
// `error.code` is a stable, machine-readable string ('not_found',
// 'forbidden', 'validation_error', 'internal_error') so the frontend can
// branch on it without parsing user-facing copy.
//
// Migration is incremental: existing endpoints continue to return
// named-key shapes (`{ workspaces: rows }`, `{ ok: true }`, etc.) until they
// are individually migrated. The frontend shim in
// `src/api/responseEnvelope.js` reads both shapes so callers see no
// breakage as the migration rolls out endpoint-by-endpoint.

const DEFAULT_ERROR_CODES = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'validation_error',
  429: 'rate_limited',
  500: 'internal_error'
};

function buildSuccessBody(data, meta) {
  const body = { data: data === undefined ? null : data };
  if (meta !== undefined && meta !== null) body.meta = meta;
  return body;
}

/** 200 OK with `{ data, meta? }`. */
export function respondOk(res, data, { meta } = {}) {
  return res.status(200).json(buildSuccessBody(data, meta));
}

/** 201 Created with `{ data, meta? }`. */
export function respondCreated(res, data, { meta } = {}) {
  return res.status(201).json(buildSuccessBody(data, meta));
}

/** Arbitrary 2xx with `{ data, meta? }` (rarely needed). */
export function respondSuccess(res, status, data, { meta } = {}) {
  return res.status(status).json(buildSuccessBody(data, meta));
}

/**
 * 4xx/5xx with `{ error: { code, message } }`.
 *
 * `code` defaults to a stable string derived from the HTTP status. Pass an
 * explicit code when the default is too generic ('workspace_not_empty' vs
 * 'conflict', for example).
 */
export function respondError(res, status, message, { code } = {}) {
  const errorCode = code || DEFAULT_ERROR_CODES[status] || 'error';
  return res.status(status).json({ error: { code: errorCode, message } });
}
