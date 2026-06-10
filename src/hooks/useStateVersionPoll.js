import { useEffect, useRef } from 'react';
import { fetchStateVersion } from 'api/contacts';

/**
 * Lightweight cross-client sync poll.
 *
 * Periodically fetches the owner-scoped opaque state version
 * (GET /api/hub/state-version). When the version changes relative to the
 * last seen value, calls `onChange()` so the caller can refetch the visible
 * board. The first successful fetch only records the baseline (never fires).
 *
 * Pauses while the tab is hidden (visibilitychange) and does an immediate
 * check when the tab becomes visible again. Fetch errors are swallowed so a
 * transient 500 never breaks the UI or spams the user.
 *
 * @param {() => void} onChange   Called when the version differs from the last seen value.
 * @param {object}     [options]
 * @param {number}     [options.intervalMs=15000]  Poll interval in ms.
 * @param {boolean}    [options.enabled=true]       When false, no polling occurs.
 */
export default function useStateVersionPoll(onChange, { intervalMs = 15000, enabled = true } = {}) {
  // Hold onChange in a ref so a changing callback identity doesn't reset the interval.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Last seen version string. null = no baseline recorded yet.
  const lastVersionRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    let intervalId = null;

    const check = () => {
      fetchStateVersion()
        .then((data) => {
          if (cancelled || !data) return;
          const version = data.version;
          if (version == null) return;
          if (lastVersionRef.current === null) {
            // First successful fetch — record baseline only.
            lastVersionRef.current = version;
            return;
          }
          if (version !== lastVersionRef.current) {
            lastVersionRef.current = version;
            onChangeRef.current?.();
          }
        })
        .catch(() => {
          // Swallow transient errors quietly.
        });
    };

    const start = () => {
      if (intervalId === null) {
        intervalId = setInterval(check, intervalMs);
      }
    };

    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        // Tab became visible — check immediately and resume polling.
        check();
        start();
      }
    };

    // Kick off only if the tab is currently visible.
    if (!document.hidden) {
      check();
      start();
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [intervalMs, enabled]);
}
