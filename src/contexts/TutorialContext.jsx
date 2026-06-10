import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import TUTORIALS from 'tutorials';
import { getTutorialCompletions, markTutorialComplete } from 'api/tutorials';
import { getMockDataForTutorial } from 'tutorials/mockData';
import useAuth from 'hooks/useAuth';

const TutorialContext = createContext(null);

function getAudience(user) {
  if (!user) return null;
  const role = user.effective_role || user.role;
  if (role === 'client') return 'client';
  return 'admin';
}

export function TutorialProvider({ children }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [completedIds, setCompletedIds] = useState(new Set());
  const [activeTutorial, setActiveTutorial] = useState(null); // { tutorial, stepIndex }
  const [hasAutoLaunched, setHasAutoLaunched] = useState(false);
  const handledDeepLinkRef = useRef(null);

  // Filter tutorials to the user's audience
  const audience = getAudience(user);
  const filteredTutorials = useMemo(() => TUTORIALS.filter((t) => !t.audience || t.audience === audience), [audience]);

  // Load completions when user is authenticated
  useEffect(() => {
    if (!user) return;
    getTutorialCompletions()
      .then((ids) => setCompletedIds(new Set(ids)))
      .catch(() => {}); // non-critical — silently ignore failures
  }, [user]);

  // Auto-launch "getting-started" for newly activated clients who haven't completed it
  useEffect(() => {
    if (!user || hasAutoLaunched) return;
    const isClient = user.role === 'client' || user.effective_role === 'client';
    if (!isClient) return;
    if (completedIds.has('getting-started')) return;
    // An explicit deep-link (?tutorial=) is intentional user action and must win
    // over the first-visit auto-launch.
    if (new URLSearchParams(location.search).has('tutorial')) return;

    // Only auto-launch if we've already fetched completions (so Set is accurate)
    // The Set starts empty, so we only trigger after the fetch resolves
    // We use a flag to avoid triggering twice if completions re-fetch
    const timer = setTimeout(() => {
      setHasAutoLaunched(true);
      const tutorial = TUTORIALS.find((t) => t.id === 'getting-started');
      if (tutorial) {
        setActiveTutorial({ tutorial, stepIndex: 0 });
      }
    }, 1500); // slight delay so the portal finishes rendering first

    return () => clearTimeout(timer);
  }, [user, completedIds, hasAutoLaunched, location.search]);

  const startTutorial = useCallback(
    (tutorialId) => {
      const tutorial = TUTORIALS.find((t) => t.id === tutorialId);
      if (!tutorial) return;

      // Navigate to the starting point if specified
      const firstStep = tutorial.steps[0];
      if (firstStep?.navigateTo) {
        navigate(firstStep.navigateTo);
      }

      setActiveTutorial({ tutorial, stepIndex: 0 });
    },
    [navigate]
  );

  // Deep-link launch: a ?tutorial=<id> param (e.g. from a portal Update's
  // "Learn more" link) launches that tutorial once it's valid for the user's
  // audience. startTutorial navigates to the tutorial's first step — whose path
  // carries no tutorial param — which clears the deep-link and re-arms the ref.
  useEffect(() => {
    if (!user) return;
    const requested = new URLSearchParams(location.search).get('tutorial');
    if (!requested) {
      handledDeepLinkRef.current = null;
      return;
    }
    if (handledDeepLinkRef.current === requested) return; // already launched THIS id; allows a→b
    const tutorial = filteredTutorials.find((t) => t.id === requested);
    if (!tutorial) return; // unknown id or wrong audience — ignore
    handledDeepLinkRef.current = requested;
    startTutorial(requested);
  }, [user, location.search, filteredTutorials, startTutorial]);

  const stopTutorial = useCallback(() => {
    setActiveTutorial(null);
  }, []);

  const markComplete = useCallback((tutorialId) => {
    setCompletedIds((prev) => new Set([...prev, tutorialId]));
    markTutorialComplete(tutorialId).catch(() => {}); // fire-and-forget
  }, []);

  const setStepIndex = useCallback((index) => {
    setActiveTutorial((prev) => (prev ? { ...prev, stepIndex: index } : prev));
  }, []);

  const navigateForStep = useCallback(
    (step) => {
      if (step?.navigateTo) {
        navigate(step.navigateTo);
      }
    },
    [navigate]
  );

  // Provide mock data appropriate for the active tutorial (or null)
  const mockData = useMemo(() => getMockDataForTutorial(activeTutorial?.tutorial?.id), [activeTutorial]);

  return (
    <TutorialContext.Provider
      value={{
        tutorials: filteredTutorials,
        completedIds,
        activeTutorial,
        mockData,
        startTutorial,
        stopTutorial,
        markComplete,
        setStepIndex,
        navigateForStep
      }}
    >
      {children}
    </TutorialContext.Provider>
  );
}

export function useTutorialContext() {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error('useTutorialContext must be used within TutorialProvider');
  return ctx;
}
