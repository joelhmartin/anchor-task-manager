import { IconLayoutList } from '@tabler/icons-react';

export const ctmFormsNavGroup = {
  id: 'ctm-forms-nav-group',
  title: 'CTM Forms',
  type: 'group',
  children: [
    {
      id: 'ctm-forms-list',
      title: 'Forms',
      type: 'item',
      url: '/ctm-forms',
      icon: IconLayoutList,
      isActive: ({ pathname }) => String(pathname || '').startsWith('/ctm-forms')
    }
  ]
};

const ctmFormsMenu = {
  items: [ctmFormsNavGroup]
};

export default ctmFormsMenu;
