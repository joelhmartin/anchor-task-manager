import { IconHome, IconChecklist, IconBolt, IconReceipt, IconLayoutDashboard, IconHistory, IconBriefcase, IconUsers } from '@tabler/icons-react';

function getPane(search = '') {
  try {
    const sp = new URLSearchParams(search || '');
    return sp.get('pane') || '';
  } catch {
    return '';
  }
}

export const tasksNavGroup = {
  id: 'tasks-nav-group',
  title: 'Tasks',
  type: 'group',
  children: [
    {
      id: 'tasks-home',
      title: 'Home',
      type: 'item',
      url: '/tasks',
      icon: IconHome,
      isActive: ({ pathname, search }) => {
        if (!String(pathname || '').startsWith('/tasks')) return false;
        const pane = getPane(search);
        return !pane || pane === 'home';
      }
    },
    {
      id: 'tasks-my-work',
      title: 'My Work',
      type: 'item',
      url: '/tasks?pane=my-work',
      icon: IconChecklist,
      isActive: ({ pathname, search }) => String(pathname || '').startsWith('/tasks') && getPane(search) === 'my-work'
    },
    {
      id: 'tasks-dashboards',
      title: 'Dashboards',
      type: 'item',
      url: '/tasks?pane=dashboards',
      icon: IconLayoutDashboard,
      isActive: ({ pathname, search }) => String(pathname || '').startsWith('/tasks') && getPane(search) === 'dashboards'
    },
    {
      id: 'tasks-automations',
      title: 'Automations',
      type: 'item',
      url: '/tasks?pane=automations',
      icon: IconBolt,
      isActive: ({ pathname, search }) => String(pathname || '').startsWith('/tasks') && getPane(search) === 'automations'
    },
    {
      id: 'tasks-billing',
      title: 'Billing',
      type: 'item',
      url: '/tasks?pane=billing',
      icon: IconReceipt,
      isActive: ({ pathname, search }) => String(pathname || '').startsWith('/tasks') && getPane(search) === 'billing'
    },
    {
      id: 'tasks-workload',
      title: 'Workload',
      type: 'item',
      url: '/tasks?pane=workload',
      icon: IconUsers,
      isActive: ({ pathname, search }) => String(pathname || '').startsWith('/tasks') && getPane(search) === 'workload'
    },
    {
      id: 'tasks-portfolio',
      title: 'Portfolio',
      type: 'item',
      url: '/tasks?pane=portfolio',
      icon: IconBriefcase,
      isActive: ({ pathname, search }) => String(pathname || '').startsWith('/tasks') && getPane(search) === 'portfolio'
    },
    {
      id: 'tasks-audit-log',
      title: 'Audit Log',
      type: 'item',
      url: '/tasks?pane=audit-log',
      icon: IconHistory,
      isActive: ({ pathname, search }) => String(pathname || '').startsWith('/tasks') && getPane(search) === 'audit-log'
    }
  ]
};

const tasksMenu = {
  items: [tasksNavGroup]
};

export default tasksMenu;


