import { useEffect, useState, useCallback } from 'react';
import { fetchTaskItemTimeEntries, createTaskItemTimeEntry } from 'api/tasks';
import { useToast } from 'contexts/ToastContext';

function clampNonNegInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function normalizeHm({ hours, minutes }) {
  const h = clampNonNegInt(hours);
  let mRaw = Number(minutes);
  if (!Number.isFinite(mRaw)) mRaw = 0;
  mRaw = Math.max(0, mRaw);
  const mRounded = Math.round(mRaw / 15) * 15;
  const carry = Math.floor(mRounded / 60);
  const m = mRounded % 60;
  return { hours: h + carry, minutes: m };
}

export { clampNonNegInt, normalizeHm };

export default function useItemTimeTracking(setError) {
  const toast = useToast();
  const [timeEntries, setTimeEntries] = useState([]);
  const [timeEntriesLoading, setTimeEntriesLoading] = useState(false);
  const [loggingTime, setLoggingTime] = useState(false);
  const [timeBillable, setTimeBillable] = useState(true);
  const [timeCategory, setTimeCategory] = useState('Other');
  const [timeDescription, setTimeDescription] = useState('');
  const [timeHours, setTimeHours] = useState(0);
  const [timeMins, setTimeMins] = useState(0);
  const [billableHours, setBillableHours] = useState(0);
  const [billableMins, setBillableMins] = useState(0);
  const [billableTouched, setBillableTouched] = useState(false);

  // When billable is toggled, keep billable duration in sync unless user overrides it.
  useEffect(() => {
    if (!timeBillable) {
      setBillableTouched(false);
      setBillableHours(0);
      setBillableMins(0);
      return;
    }
    if (!billableTouched) {
      const next = normalizeHm({ hours: timeHours, minutes: timeMins });
      setBillableHours(next.hours);
      setBillableMins(next.minutes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeBillable]);

  // If billable duration hasn't been manually edited, keep it mirrored to Duration.
  useEffect(() => {
    if (!timeBillable) return;
    if (billableTouched) return;
    const next = normalizeHm({ hours: timeHours, minutes: timeMins });
    if (billableHours !== next.hours) setBillableHours(next.hours);
    if (billableMins !== next.minutes) setBillableMins(next.minutes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeHours, timeMins, timeBillable, billableTouched]);

  const loadTimeEntries = useCallback(async (itemId) => {
    if (!itemId) return [];
    setTimeEntriesLoading(true);
    try {
      const data = await fetchTaskItemTimeEntries(itemId);
      const times = data.time_entries || [];
      setTimeEntries(times);
      return times;
    } catch (err) {
      setError(err.message || 'Unable to load time entries');
      return [];
    } finally {
      setTimeEntriesLoading(false);
    }
  }, [setError]);

  const handleLogTime = useCallback(async (activeItemId, loadBoardViewFn) => {
    if (!activeItemId) return;
    const dur = normalizeHm({ hours: timeHours, minutes: timeMins });
    const minutes = dur.hours * 60 + dur.minutes;
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    setLoggingTime(true);
    setError('');
    try {
      const payload = {
        time_spent_minutes: minutes,
        is_billable: timeBillable,
        work_category: timeCategory,
        description: timeDescription || ''
      };
      if (timeBillable) {
        const bdur = billableTouched ? normalizeHm({ hours: billableHours, minutes: billableMins }) : dur;
        let billableMinutes = bdur.hours * 60 + bdur.minutes;
        if (!Number.isFinite(billableMinutes) || billableMinutes < 0) billableMinutes = minutes;
        billableMinutes = Math.min(minutes, billableMinutes);
        payload.billable_minutes = billableMinutes;
      }
      await createTaskItemTimeEntry(activeItemId, payload);
      const data = await fetchTaskItemTimeEntries(activeItemId);
      setTimeEntries(data.time_entries || []);
      if (loadBoardViewFn) await loadBoardViewFn();
      setTimeHours(0);
      setTimeMins(0);
      setTimeDescription('');
      setBillableHours(0);
      setBillableMins(0);
      setBillableTouched(false);
      toast.success('Time logged');
    } catch (err) {
      setError(err.message || 'Unable to log time');
    } finally {
      setLoggingTime(false);
    }
  }, [timeHours, timeMins, timeBillable, timeCategory, timeDescription, billableTouched, billableHours, billableMins, setError, toast]);

  const reset = useCallback(() => {
    setTimeEntries([]);
    setTimeEntriesLoading(true);
    setTimeHours(0);
    setTimeMins(0);
    setTimeBillable(true);
    setTimeCategory('Other');
    setTimeDescription('');
    setBillableHours(0);
    setBillableMins(0);
    setBillableTouched(false);
  }, []);

  return {
    timeEntries, timeEntriesLoading, loggingTime,
    timeBillable, setTimeBillable, timeCategory, setTimeCategory, timeDescription, setTimeDescription,
    timeHours, setTimeHours, timeMins, setTimeMins,
    billableHours, setBillableHours, billableMins, setBillableMins, billableTouched, setBillableTouched,
    handleLogTime, loadTimeEntries, reset,
    normalizeHm, clampNonNegInt
  };
}
