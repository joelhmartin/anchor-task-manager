import {
  IconUser,
  IconChartInfographic,
  IconPhoneCalling,
  IconBrush,
  IconFolder,
  IconFlagCheck,
  IconBriefcase,
  IconAddressBook,
  IconUsersGroup,
  IconArticle,
  IconSchool,
  IconBell,
  IconHistory
} from '@tabler/icons-react';

const portalGroup = {
  id: 'portal-nav-group',
  title: 'Client Portal',
  type: 'group',
  children: [
    {
      id: 'portal-profile',
      title: 'Profile',
      type: 'item',
      url: '/portal?tab=profile',
      icon: IconUser,
      dataTutorial: 'nav-profile'
    },
    {
      id: 'portal-analytics',
      title: 'Analytics',
      type: 'item',
      url: '/portal?tab=analytics',
      icon: IconChartInfographic
    },
    {
      id: 'portal-brand',
      title: 'Brand Assets',
      type: 'item',
      url: '/portal?tab=brand',
      icon: IconBrush
    },
    {
      id: 'portal-services',
      title: 'Services',
      type: 'item',
      url: '/services',
      icon: IconBriefcase
    },
    {
      id: 'portal-documents',
      title: 'Documents',
      type: 'item',
      url: '/portal?tab=documents',
      icon: IconFolder
    },
    {
      id: 'portal-notifications',
      title: 'Notifications',
      type: 'item',
      url: '/portal?tab=notifications',
      icon: IconBell
    },
    {
      id: 'portal-team',
      title: 'Team',
      type: 'item',
      url: '/portal?tab=team',
      icon: IconUsersGroup
    },
    {
      id: 'portal-activity',
      title: 'Activity Log',
      type: 'item',
      url: '/portal?tab=activity',
      icon: IconHistory
    },
    {
      id: 'portal-tutorials',
      title: 'Tutorials',
      type: 'item',
      url: '/portal?tab=tutorials',
      icon: IconSchool
    }
    // {
    //   id: 'portal-reviews',
    //   title: 'Reviews',
    //   type: 'item',
    //   url: '/portal?tab=reviews',
    //   icon: IconStar
    // }
  ]
};

const clientManagementGroup = {
  id: 'client-management-group',
  title: 'My Clients',
  type: 'group',
  children: [
    {
      id: 'portal-leads',
      title: 'Leads',
      type: 'item',
      url: '/portal?tab=leads',
      icon: IconPhoneCalling,
      dataTutorial: 'nav-leads'
    },
    {
      id: 'portal-journey',
      title: 'Lead Journeys',
      type: 'item',
      url: '/portal?tab=journey',
      icon: IconFlagCheck,
      dataTutorial: 'nav-journey'
    },
    {
      id: 'portal-contacts',
      title: 'Contacts',
      type: 'item',
      url: '/portal?tab=contacts',
      icon: IconAddressBook,
      dataTutorial: 'nav-contacts'
    }
    // 'Client List' (/active-clients) and 'Archive' folded into the Contacts master list
    // (Status = Active Client / Archived). Deep links redirect there; see ClientPortal.jsx
    // + MainRoutes.jsx. (Contacts Master List rollout, Phase 5.)
  ]
};

const contentGroup = {
  id: 'content-group',
  title: 'My Content',
  type: 'group',
  children: [
    {
      id: 'blogs',
      title: 'Blog Posts',
      type: 'item',
      url: '/blogs',
      icon: IconArticle
    }
  ]
};

const portalMenu = {
  items: [portalGroup, clientManagementGroup, contentGroup]
};

export default portalMenu;
