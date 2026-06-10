import { useTutorialContext } from 'contexts/TutorialContext';

/**
 * Convenience hook for interacting with the tutorial system.
 *
 * Usage:
 *   const { startTutorial, stopTutorial, isActive, completedIds } = useTutorial();
 */
export default function useTutorial() {
  const { tutorials, completedIds, activeTutorial, mockData, startTutorial, stopTutorial, markComplete } = useTutorialContext();

  return {
    tutorials,
    completedIds,
    activeTutorial,
    mockData,
    isActive: activeTutorial !== null,
    startTutorial,
    stopTutorial,
    markComplete
  };
}
