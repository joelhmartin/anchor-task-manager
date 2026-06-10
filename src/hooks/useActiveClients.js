import { useCallback, useEffect, useState } from 'react';

import {
  addServicesToActiveClient,
  archiveActiveClient,
  fetchActiveClients,
  redactOldServices as redactOldServicesApi,
  restoreActiveClient
} from 'api/services';

export default function useActiveClients({ autoLoad = true, status = 'active' } = {}) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchActiveClients(status);
      setClients(data);
      return data;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [status]);

  // Re-run whenever autoLoad or status changes. Manual-load consumers (autoLoad=false)
  // call load() themselves after the status flips.
  useEffect(() => {
    if (!autoLoad) return;
    load().catch(() => {});
  }, [autoLoad, load]);

  const archive = useCallback(async (clientRow) => {
    if (!clientRow?.id) return;
    await archiveActiveClient(clientRow.id);
    setClients((prev) => prev.filter((c) => c.id !== clientRow.id));
  }, []);

  const restore = useCallback(async (clientRow) => {
    if (!clientRow?.id) return;
    await restoreActiveClient(clientRow.id);
    setClients((prev) => prev.filter((c) => c.id !== clientRow.id));
  }, []);

  const redactOldServices = useCallback(async () => {
    const result = await redactOldServicesApi();
    // Reconcile locally using the same predicate the server applied (services with
    // agreed_date older than 90 days). The endpoint only returns counts, so we mark
    // matching rows in place rather than waiting for a refetch.
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const nowIso = new Date().toISOString();
    setClients((prev) =>
      prev.map((client) => {
        if (!Array.isArray(client.services)) return client;
        let mutated = false;
        const nextServices = client.services.map((s) => {
          if (s.redacted_at) return s;
          const agreed = s.agreed_date ? Date.parse(s.agreed_date) : NaN;
          if (Number.isFinite(agreed) && agreed < ninetyDaysAgo) {
            mutated = true;
            return { ...s, redacted_at: nowIso };
          }
          return s;
        });
        return mutated ? { ...client, services: nextServices } : client;
      })
    );
    // Refresh in the background to pick up any server-derived fields we don't model locally.
    load().catch(() => {});
    return result;
  }, [load]);

  const addServices = useCallback(async (activeClientId, servicesPayload) => {
    if (!activeClientId) throw new Error('activeClientId is required');
    const fresh = await addServicesToActiveClient(activeClientId, servicesPayload);
    if (fresh) {
      setClients((prev) => prev.map((c) => (c.id === fresh.id ? { ...c, ...fresh } : c)));
    }
    return fresh;
  }, []);

  return { clients, loading, error, load, archive, restore, redactOldServices, addServices };
}
