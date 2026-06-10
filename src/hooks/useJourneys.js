import { useCallback, useMemo, useState } from 'react';
import { fetchJourneys, createJourney, updateJourney, archiveJourney } from 'api/journeys';

/**
 * Shared journey CRUD hook — owns journey list state so it can be
 * consumed by any tab without cross-tab ref hacks.
 */
export default function useJourneys(triggerMessage) {
  const [journeys, setJourneys] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchJourneys()
      .then((data) => setJourneys(Array.isArray(data) ? data : []))
      .catch((err) => triggerMessage('error', err.message || 'Unable to load lead journeys'))
      .finally(() => setLoading(false));
  }, [triggerMessage]);

  // Merge one updated journey into local state (replace if present, else prepend)
  // so drawer/board actions reflect immediately without a refetch.
  const applyJourneyUpdate = useCallback((updated) => {
    if (!updated) return;
    setJourneys((prev) => {
      if (!prev) return [updated];
      const exists = prev.some((j) => j.id === updated.id);
      return exists ? prev.map((j) => (j.id === updated.id ? updated : j)) : [updated, ...prev];
    });
  }, []);

  const create = useCallback(
    async (payload) => {
      const journey = await createJourney(payload);
      // Immediately upsert the created journey so it appears without waiting for refetch
      applyJourneyUpdate(journey);
      // Background refetch to pick up any server-side normalisation (stage, status, etc.)
      setLoading(true);
      fetchJourneys()
        .then((data) => setJourneys(Array.isArray(data) ? data : []))
        .catch((err) => console.error('[useJourneys] background refetch after create failed:', err))
        .finally(() => setLoading(false));
      return journey;
    },
    [applyJourneyUpdate]
  );

  const update = useCallback(async (id, payload) => {
    const journey = await updateJourney(id, payload);
    // Upsert into local state
    setJourneys((prev) => {
      if (!prev) return [journey];
      const idx = prev.findIndex((j) => j.id === journey.id);
      if (idx === -1) return [journey, ...prev];
      const clone = [...prev];
      clone[idx] = journey;
      return clone;
    });
    return journey;
  }, []);

  const upsert = useCallback((journey) => {
    if (!journey) return;
    setJourneys((prev) => {
      if (!prev) return [journey];
      const idx = prev.findIndex((j) => j.id === journey.id);
      if (idx === -1) return [journey, ...prev];
      const clone = [...prev];
      clone[idx] = journey;
      return clone;
    });
  }, []);

  const archive = useCallback(
    async (journey) => {
      if (!journey?.id) return;
      const label = journey.client_name || journey.client_phone || journey.client_email || 'this lead';
      await archiveJourney(journey.id);
      setJourneys((prev) => (prev ? prev.filter((j) => j.id !== journey.id) : prev));
      triggerMessage('success', `${label}'s journey archived`);
    },
    [triggerMessage]
  );

  const journeyByLeadId = useMemo(() => {
    const map = new Map();
    (Array.isArray(journeys) ? journeys : []).forEach((j) => {
      const normalizedStatus = String(j?.status || 'active').toLowerCase();
      if (['converted', 'archived'].includes(normalizedStatus)) return;
      // Map by lead_call_key (CTM string ID) since the frontend uses call.id which is the CTM string.
      // Also map by lead_call_id (UUID) as fallback for any code using row_id.
      if (j.lead_call_key) map.set(j.lead_call_key, j);
      if (j.lead_call_id) map.set(j.lead_call_id, j);
    });
    return map;
  }, [journeys]);

  return { journeys, loading, load, reload: load, create, update, upsert, applyJourneyUpdate, archive, setJourneys, journeyByLeadId };
}
