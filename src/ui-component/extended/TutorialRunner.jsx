import { useCallback, useEffect, useRef, useState } from 'react';
import { Joyride, ACTIONS, EVENTS, STATUS } from 'react-joyride';
import { useTheme } from '@mui/material/styles';

import { useTutorialContext } from 'contexts/TutorialContext';

/**
 * Bring a step's target into a comfortable position before Joyride spotlights it.
 *
 * Joyride only ever top-aligns a target (it has no "center" scroll mode), and the
 * app's fixed header then overlaps anything scrolled to the top. So we take over
 * scrolling: center the element within the region *below* the fixed header, and —
 * importantly — don't scroll at all when it's already comfortably in view (an
 * element a quarter of the way down the page should just stay put).
 */
function positionStepTarget(step) {
  // Centered / body steps have no element — anchor the overlay over the top.
  if (!step || step.placement === 'center' || step.target === 'body') {
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }
  // Drawer / fixed-panel steps opt out — their target lives in a fixed panel that
  // page scroll can't move.
  if (step.disableScrolling) return;

  const el = typeof step.target === 'string' ? document.querySelector(step.target) : null;
  if (!el) return;

  const header = document.querySelector('header');
  const headerH = header ? header.getBoundingClientRect().height : 90;
  const margin = 24;
  const rect = el.getBoundingClientRect();
  const viewportH = window.innerHeight;

  // Already sitting comfortably below the header and above the fold — leave it.
  if (rect.top >= headerH + margin && rect.bottom <= viewportH - margin) return;

  // Center the element within the region below the fixed header.
  const region = viewportH - headerH;
  const desiredTop = headerH + Math.max(margin, (region - rect.height) / 2);
  window.scrollBy({ top: rect.top - desiredTop, behavior: 'auto' });
}

/**
 * TutorialRunner
 *
 * Renders the react-joyride overlay when a tutorial is active.
 * Mount this once in MainLayout so it works globally.
 *
 * Uses **controlled mode** (`stepIndex` prop) so we can delay step
 * transitions, giving dynamically-opened dialogs/drawers time to
 * mount before Joyride tries to find their targets.
 */
export default function TutorialRunner() {
  const theme = useTheme();
  const { activeTutorial, stopTutorial, markComplete, setStepIndex, navigateForStep } = useTutorialContext();

  // Local Joyride step index — lags behind context stepIndex by a short
  // delay so effects (dialog opens, drawer opens) have time to render.
  const [joyrideStep, setJoyrideStep] = useState(0);
  const [retryKey, setRetryKey] = useState(0); // bump to force Joyride remount/retry
  const timerRef = useRef(null);
  const retryRef = useRef(null);
  const retryCount = useRef(0);

  // Sync joyrideStep when the context stepIndex changes (with a delay)
  const contextStepIndex = activeTutorial?.stepIndex ?? 0;

  useEffect(() => {
    // Clear any pending timers
    if (timerRef.current) clearTimeout(timerRef.current);
    if (retryRef.current) clearTimeout(retryRef.current);

    if (!activeTutorial) {
      setJoyrideStep(0);
      return;
    }

    // We own scrolling (see positionStepTarget): center the target below the
    // fixed header, or anchor centered/body steps at the top.
    const step = activeTutorial.tutorial?.steps?.[contextStepIndex];

    // If this is the first step (tutorial just started), set immediately
    if (contextStepIndex === 0) {
      positionStepTarget(step);
      setJoyrideStep(0);
      return;
    }

    // Reset retry counter for the new step
    retryCount.current = 0;

    // Delay Joyride step update so any triggered effects (dialog/drawer
    // opens from useEffect watchers in other components) can render first.
    timerRef.current = setTimeout(() => {
      positionStepTarget(step);
      setJoyrideStep(contextStepIndex);
    }, 400);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [activeTutorial, contextStepIndex]);

  const handleCallback = useCallback(
    (data) => {
      const { action, index, status, type } = data;

      if (type === EVENTS.STEP_AFTER) {
        const nextIndex = index + (action === ACTIONS.PREV ? -1 : 1);
        const nextStep = activeTutorial?.tutorial?.steps?.[nextIndex];

        if (nextStep) {
          // Update context first (triggers effects in other components)
          setStepIndex(nextIndex);
          // Navigate if needed
          navigateForStep(nextStep);
          // joyrideStep is updated via the useEffect above after a delay
        } else if (action !== ACTIONS.PREV) {
          // No next step — tutorial is complete
          // Navigate for the last step if it has a navigateTo (e.g. back to tutorials page)
          const lastStep = activeTutorial?.tutorial?.steps?.[index];
          if (lastStep) navigateForStep(lastStep);
          markComplete(activeTutorial.tutorial.id);
          stopTutorial();
          return; // skip further status checks
        }
      }

      // TARGET_NOT_FOUND — the element isn't in the DOM yet (dialog still
      // rendering). Retry up to 3 times by bumping the key, which forces
      // Joyride to remount and re-query the DOM.
      if (type === EVENTS.TARGET_NOT_FOUND) {
        if (retryRef.current) clearTimeout(retryRef.current);
        if (retryCount.current < 3) {
          retryCount.current += 1;
          retryRef.current = setTimeout(() => {
            setRetryKey((k) => k + 1);
          }, 400);
        }
      }

      if (status === STATUS.FINISHED) {
        markComplete(activeTutorial.tutorial.id);
        stopTutorial();
      }

      if (status === STATUS.SKIPPED || action === ACTIONS.CLOSE) {
        markComplete(activeTutorial.tutorial.id);
        stopTutorial();
      }
    },
    [activeTutorial, markComplete, navigateForStep, setStepIndex, stopTutorial]
  );

  if (!activeTutorial) return null;

  const { tutorial } = activeTutorial;

  const joyrideSteps = tutorial.steps.map((step) => ({
    target: step.target,
    title: step.title,
    content: step.content,
    placement: step.placement || 'bottom',
    disableBeacon: true,
    // We handle all scrolling ourselves (positionStepTarget) so targets land
    // centered below the fixed header instead of top-aligned under it. Joyride's
    // own scroll only top-aligns, so disable it for every step; it still tracks
    // and repositions the tooltip/spotlight on our manual scroll.
    disableScrolling: true
  }));

  return (
    <Joyride
      key={retryKey}
      steps={joyrideSteps}
      stepIndex={joyrideStep}
      run
      continuous
      // Scrolling is handled manually (positionStepTarget) so targets center
      // below the fixed header rather than top-align under it.
      onEvent={handleCallback}
      locale={{ last: 'Got it', next: 'Next', skip: 'Skip tour', back: 'Back', close: 'Close' }}
      options={{
        primaryColor: theme.palette.primary.main,
        backgroundColor: theme.palette.background.paper,
        arrowColor: theme.palette.background.paper,
        overlayColor: 'rgba(0, 0, 0, 0.55)',
        zIndex: 10000,
        showProgress: true,
        buttons: ['back', 'skip', 'primary'],
        overlayClickAction: false,
        skipBeacon: true
      }}
      styles={{
        // react-joyride reads zIndex from styles.options.zIndex (default 100) and
        // renders the overlay at this value, the spotlight at +1, and the tooltip
        // at +100. The journey tutorial opens a Drawer at z-index 9999, so we sit
        // everything ABOVE it: the overlay/spotlight (10000/10001) dim the drawer
        // and cut a highlight hole over the targeted element, and the tooltip
        // (10100) floats on top. Below the drawer (the old 9990) the spotlight was
        // hidden, so drawer elements never highlighted.
        options: {
          zIndex: 10000
        },
        buttonPrimary: {
          backgroundColor: theme.palette.primary.main,
          color: '#fff',
          borderRadius: 6,
          padding: '8px 18px',
          fontFamily: theme.typography.fontFamily,
          fontSize: 14,
          fontWeight: 600,
          border: 'none'
        },
        buttonBack: {
          color: theme.palette.text.secondary,
          fontFamily: theme.typography.fontFamily,
          fontSize: 14,
          marginRight: 8
        },
        buttonSkip: {
          color: theme.palette.text.secondary,
          fontFamily: theme.typography.fontFamily,
          fontSize: 13
        },
        tooltip: {
          padding: '20px 24px',
          boxShadow: theme.shadows?.[8] || '0 8px 32px rgba(0,0,0,0.18)',
          borderRadius: Number(theme.shape?.borderRadius) * 2 || 8
        },
        tooltipTitle: {
          fontFamily: theme.typography.fontFamily,
          fontWeight: 700,
          fontSize: 16,
          marginBottom: 6,
          color: theme.palette.text.primary
        },
        tooltipContent: {
          fontFamily: theme.typography.fontFamily,
          fontSize: 14,
          lineHeight: 1.6,
          color: theme.palette.text.secondary,
          padding: '4px 0 8px'
        },
        tooltipFooter: {
          marginTop: 12
        }
      }}
    />
  );
}
