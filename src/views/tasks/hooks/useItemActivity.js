import { useState, useCallback } from 'react';
import { fetchTaskItemEvents } from 'api/tasks';

export default function useItemActivity(setError) {
  const [itemEvents, setItemEvents] = useState([]);
  const [itemEventsLoading, setItemEventsLoading] = useState(false);

  const loadActivity = useCallback(async (itemId) => {
    if (!itemId) return [];
    setItemEventsLoading(true);
    try {
      const data = await fetchTaskItemEvents(itemId);
      const events = data.events || [];
      setItemEvents(events);
      return events;
    } catch (err) {
      setError(err.message || 'Unable to load activity');
      return [];
    } finally {
      setItemEventsLoading(false);
    }
  }, [setError]);

  const reset = useCallback(() => {
    setItemEvents([]);
    setItemEventsLoading(true);
  }, []);

  return { itemEvents, itemEventsLoading, loadActivity, reset };
}
