import { IconUser, IconFlagCheck } from '@tabler/icons-react';

// Minimal menu for clients who haven't finished onboarding yet.
const onboardingGroup = {
  id: 'portal-onboarding-group',
  title: 'Onboarding',
  type: 'group',
  children: [
    {
      id: 'portal-onboarding-profile',
      title: 'Profile Settings',
      type: 'item',
      url: '/portal?tab=profile',
      icon: IconUser
    },
    {
      id: 'portal-continue-onboarding',
      title: 'Continue Onboarding',
      type: 'item',
      url: '/onboarding',
      icon: IconFlagCheck
    }
  ]
};

const portalOnboardingMenu = {
  items: [onboardingGroup]
};

export default portalOnboardingMenu;


