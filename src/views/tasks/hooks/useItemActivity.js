import { useState, useCallback, useRef } from 'react';
import { fetchTaskItemEvents } from 'api/tasks';

export default function useItemActivity(setError) {
  const [itemEvents, setItemEvents] = useState([]);
  const [itemEventsLoading, setItemEventsLoading] = useState(false);
  const latestRequestRef = useRef(0);

  const loadActivity = useCallback(async (itemId) => {
    if (!itemId) return [];
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    setItemEventsLoading(true);
    try {
      const data = await fetchTaskItemEvents(itemId);
      const events = data.events || [];
      if (requestId !== latestRequestRef.current) return events;
      setItemEvents(events);
      return events;
    } catch (err) {
      if (requestId !== latestRequestRef.current) return [];
      setError(err.message || 'Unable to load activity');
      return [];
    } finally {
      if (requestId === latestRequestRef.current) setItemEventsLoading(false);
    }
  }, [setError]);

  const reset = useCallback(() => {
    latestRequestRef.current += 1;
    setItemEvents([]);
    setItemEventsLoading(true);
  }, []);

  return { itemEvents, itemEventsLoading, loadActivity, reset };
}
