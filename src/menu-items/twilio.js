import { IconHome, IconPhone, IconUsers, IconCode, IconSettings } from '@tabler/icons-react';

function getPane(search = '') {
  try {
    const sp = new URLSearchParams(search || '');
    return sp.get('pane') || '';
  } catch {
    return '';
  }
}

export const twilioNavGroup = {
  id: 'twilio-nav-group',
  title: 'Twilio',
  type: 'group',
  children: [
    {
      id: 'twilio-overview',
      title: 'Overview',
      type: 'item',
      url: '/twilio',
      icon: IconHome,
      isActive: ({ pathname, search }) => {
        if (!String(pathname || '').startsWith('/twilio')) return false;
        const pane = getPane(search);
        return !pane || pane === 'overview';
      }
    },
    {
      id: 'twilio-numbers',
      title: 'Numbers',
      type: 'item',
      url: '/twilio?pane=numbers',
      icon: IconPhone,
      isActive: ({ pathname, search }) => String(pathname || '').startsWith('/twilio') && getPane(search) === 'numbers'
    },
    {
      id: 'twilio-clients',
      title: 'Clients',
      type: 'item',
      url: '/twilio?pane=clients',
      icon: IconUsers,
      isActive: ({ pathname, search }) => String(pathname || '').startsWith('/twilio') && getPane(search) === 'clients'
    },
    {
      id: 'twilio-scripts',
      title: 'Scripts',
      type: 'item',
      url: '/twilio?pane=scripts',
      icon: IconCode,
      isActive: ({ pathname, search }) => String(pathname || '').startsWith('/twilio') && getPane(search) === 'scripts'
    },
    {
      id: 'twilio-settings',
      title: 'Settings',
      type: 'item',
      url: '/twilio?pane=settings',
      icon: IconSettings,
      isActive: ({ pathname, search }) => String(pathname || '').startsWith('/twilio') && getPane(search) === 'settings'
    }
  ]
};

const twilioMenu = {
  items: [twilioNavGroup]
};

export default twilioMenu;
