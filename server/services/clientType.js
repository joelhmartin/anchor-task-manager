import { query } from '../db.js';

const normalizeType = (v) => String(v || '').toLowerCase().replace(/[\s-]+/g, '_');

/**
 * Resolve the EFFECTIVE client type (medical vs non-medical) — the single source of truth
 * for every HIPAA gate in the app. Returns 'medical' | 'non_medical' | null.
 *
 * The value lives in two independent places:
 *   - `client_profiles.client_type` — set by the admin create/edit-client form. Optional,
 *     so it is frequently NULL.
 *   - `tracking_configs.client_type` — set by the tracking wizard (step 1). NOT NULL +
 *     CHECK-constrained to medical|non_medical, so it is reliably populated for any client
 *     that has been through tracking setup.
 *
 * The two routinely disagree — a client onboarded through the tracking wizard is
 * 'non_medical' there while the profile column is still NULL. Reading only one column
 * misclassifies those clients (this caused non-medical form emails to be stripped), so
 * every gate must resolve through here.
 *
 * Merge rule is fail-closed for HIPAA: if EITHER source says 'medical', the client is
 * medical. Treat as 'non_medical' only when a source explicitly says so and nothing says
 * 'medical'. null = unknown → callers must fail closed and treat it as potentially
 * PHI-bearing.
 */
export async function resolveClientType(userId) {
  if (!userId) return null;
  let profileType = null;
  let anyMedical = false;
  let anyNonMedical = false;
  try {
    const { rows } = await query('SELECT client_type FROM client_profiles WHERE user_id = $1', [userId]);
    profileType = normalizeType(rows[0]?.client_type);
  } catch (err) {
    console.error('[clientType] profile lookup failed:', err.message);
  }
  try {
    // bool_or guards against a client having more than one tracking_configs row.
    const { rows } = await query(
      `SELECT bool_or(client_type = 'medical') AS any_medical,
              bool_or(client_type = 'non_medical') AS any_non_medical
         FROM tracking_configs WHERE user_id = $1`,
      [userId]
    );
    anyMedical = rows[0]?.any_medical === true;
    anyNonMedical = rows[0]?.any_non_medical === true;
  } catch (err) {
    console.error('[clientType] tracking lookup failed:', err.message);
  }

  if (profileType === 'medical' || anyMedical) return 'medical';
  if (profileType === 'non_medical' || anyNonMedical) return 'non_medical';
  return null;
}

/** True only when the effective client type resolves to non_medical (fail-closed otherwise). */
export async function isNonMedicalClient(userId) {
  return (await resolveClientType(userId)) === 'non_medical';
}
