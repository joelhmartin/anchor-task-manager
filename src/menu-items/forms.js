import { IconLayoutList, IconEdit, IconInbox, IconCode } from '@tabler/icons-react';

function getPane(search = '') {
  try {
    const sp = new URLSearchParams(search || '');
    return sp.get('pane') || '';
  } catch {
    return '';
  }
}

export const formsNavGroup = {
  id: 'forms-nav-group',
  title: 'Forms',
  type: 'group',
  children: [
    {
      id: 'forms-list',
      title: 'Forms',
      type: 'item',
      url: '/forms',
      icon: IconLayoutList,
      isActive: ({ pathname, search }) => {
        if (!String(pathname || '').startsWith('/forms')) return false;
        const pane = getPane(search);
        return !pane || pane === 'forms';
      }
    },
    {
      id: 'forms-builder',
      title: 'Builder',
      type: 'item',
      url: '/forms?pane=builder',
      icon: IconEdit,
      isActive: ({ pathname, search }) => String(pathname || '').startsWith('/forms') && getPane(search) === 'builder'
    },
    {
      id: 'forms-submissions',
      title: 'Submissions',
      type: 'item',
      url: '/forms?pane=submissions',
      icon: IconInbox,
      isActive: ({ pathname, search }) => String(pathname || '').startsWith('/forms') && getPane(search) === 'submissions'
    },
    {
      id: 'forms-embed',
      title: 'Embed',
      type: 'item',
      url: '/forms?pane=embed',
      icon: IconCode,
      isActive: ({ pathname, search }) => String(pathname || '').startsWith('/forms') && getPane(search) === 'embed'
    }
  ]
};

const formsMenu = {
  items: [formsNavGroup]
};

export default formsMenu;
