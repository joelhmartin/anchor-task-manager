export const TRIGGERS = [
  { id: 'status_change', label: 'Status changes', category: 'Item' },
  { id: 'item_completed', label: 'Item completed', category: 'Item' },
  { id: 'item_created', label: 'Item created', category: 'Item' },
  { id: 'item_archived', label: 'Item archived', category: 'Item' },
  { id: 'assignee_added', label: 'Person assigned', category: 'People' },
  { id: 'assignee_removed', label: 'Person removed', category: 'People' },
  { id: 'field_changed', label: 'Column value changes', category: 'Item' },
  { id: 'update_created', label: 'Update posted', category: 'Activity' },
  { id: 'due_date_relative', label: 'Due date approaches', category: 'Dates' },
  { id: 'time_entry_logged', label: 'Time tracked', category: 'Activity' },
  { id: 'file_uploaded', label: 'File uploaded', category: 'Activity' },
  { id: 'all_subitems_completed', label: 'All subitems done', category: 'Subitems' },
  { id: 'all_assignees_completed', label: 'All subitems done (by assignees)', category: 'Subitems' },
  { id: 'label_added', label: 'Label applied', category: 'Item' },
  { id: 'label_removed', label: 'Label removed', category: 'Item' }
];

export const ACTIONS = [
  { id: 'notify_users', label: 'Notify people', category: 'Notifications' },
  { id: 'notify_admins', label: 'Notify admins (legacy)', category: 'Notifications' },
  { id: 'notify_assignees', label: 'Notify assignees (legacy)', category: 'Notifications' },
  { id: 'set_status', label: 'Change status', category: 'Item' },
  { id: 'set_needs_attention', label: 'Set attention flag', category: 'Item' },
  { id: 'add_update', label: 'Post an update', category: 'Activity' },
  { id: 'move_to_group', label: 'Move to group', category: 'Item' },
  { id: 'move_to_board', label: 'Move to board', category: 'Item' },
  { id: 'archive_item', label: 'Archive item', category: 'Item' },
  { id: 'assign_user', label: 'Assign someone', category: 'People' },
  { id: 'remove_assignee', label: 'Remove assignee', category: 'People' },
  { id: 'set_due_date', label: 'Set due date', category: 'Dates' },
  { id: 'set_priority', label: 'Set priority', category: 'Item', soon: true },
  { id: 'send_email', label: 'Send email', category: 'Integrations' },
  { id: 'send_webhook', label: 'Send webhook', category: 'Integrations' },
  { id: 'create_item', label: 'Create item', category: 'Item' },
  { id: 'create_subitem', label: 'Create subitem', category: 'Subitems' },
  { id: 'duplicate_item', label: 'Duplicate item', category: 'Item' },
  { id: 'clear_due_date', label: 'Clear due date', category: 'Dates' },
  { id: 'set_column_value', label: 'Set column value', category: 'Item', soon: true },
  { id: 'add_file', label: 'Add file', category: 'Activity', soon: true },
  { id: 'start_time_tracking', label: 'Start timer', category: 'Activity' },
  { id: 'stop_time_tracking', label: 'Stop timer', category: 'Activity' },
  { id: 'add_label', label: 'Add label', category: 'Item' },
  { id: 'remove_label', label: 'Remove label', category: 'Item' }
];

export const STEP_TYPES = [
  { id: 'action', label: 'Action' },
  { id: 'if', label: 'If / Then' },
  { id: 'else', label: 'Otherwise' },
  { id: 'delay', label: 'Wait', soon: true }
];

export const CONDITION_FIELDS = [
  { id: 'item.status', label: 'Item status' },
  { id: 'item.name', label: 'Item name' },
  { id: 'item.due_date', label: 'Item due date' },
  { id: 'item.needs_attention', label: 'Needs attention' },
  { id: 'event.old_value.status', label: 'Previous status' },
  { id: 'event.new_value.status', label: 'New status' },
  { id: 'actor.email', label: 'Actor email' },
  { id: 'actor.role', label: 'Actor role' },
  { id: 'board.name', label: 'Board name' },
  { id: 'workspace.name', label: 'Workspace name' },
  { id: 'trigger.type', label: 'Trigger type' }
];

export const CONDITION_OPERATORS = [
  { id: 'equals', label: 'equals' },
  { id: 'not_equals', label: 'does not equal' },
  { id: 'contains', label: 'contains' },
  { id: 'not_contains', label: 'does not contain' },
  { id: 'gt', label: 'greater than' },
  { id: 'gte', label: 'greater than or equal' },
  { id: 'lt', label: 'less than' },
  { id: 'lte', label: 'less than or equal' },
  { id: 'in', label: 'is one of' },
  { id: 'not_in', label: 'is not one of' },
  { id: 'is_empty', label: 'is empty' },
  { id: 'is_not_empty', label: 'is not empty' }
];

export function getTriggerLabel(id) {
  return TRIGGERS.find((t) => t.id === id)?.label || id;
}

export function getActionLabel(id) {
  return ACTIONS.find((a) => a.id === id)?.label || id;
}

export function groupedTriggers() {
  const cats = {};
  TRIGGERS.forEach((t) => {
    if (!cats[t.category]) cats[t.category] = [];
    cats[t.category].push(t);
  });
  return cats;
}

export function groupedActions() {
  const cats = {};
  ACTIONS.forEach((a) => {
    if (!cats[a.category]) cats[a.category] = [];
    cats[a.category].push(a);
  });
  return cats;
}

// ── Trigger → Action Compatibility Registry ──────────────────────────────────
// Defines which actions are valid (and suggested) for each trigger type.
// Actions not listed for a trigger are hidden in the UI but not hard-blocked
// on the server (backward compat for existing rules).

const UNIVERSAL_ACTIONS = [
  'notify_users', 'set_status', 'set_needs_attention', 'add_update', 'move_to_group', 'move_to_board',
  'archive_item', 'set_due_date', 'clear_due_date', 'create_item', 'create_subitem',
  'duplicate_item', 'send_email', 'send_webhook', 'add_label', 'remove_label',
  'start_time_tracking', 'stop_time_tracking'
];

export const TRIGGER_ACTION_COMPAT = {
  status_change: {
    suggested: ['notify_assignees', 'set_needs_attention', 'move_to_group', 'add_update', 'send_webhook'],
    allowed: [...UNIVERSAL_ACTIONS, 'notify_admins', 'notify_assignees', 'assign_user', 'remove_assignee']
  },
  item_completed: {
    suggested: ['notify_assignees', 'archive_item', 'create_item', 'send_webhook'],
    allowed: [...UNIVERSAL_ACTIONS, 'notify_admins', 'notify_assignees', 'assign_user', 'remove_assignee']
  },
  item_created: {
    suggested: ['assign_user', 'set_status', 'set_due_date', 'notify_admins', 'add_label'],
    allowed: [...UNIVERSAL_ACTIONS, 'notify_admins', 'notify_assignees', 'assign_user', 'remove_assignee']
  },
  item_archived: {
    suggested: ['send_webhook', 'add_update', 'stop_time_tracking'],
    allowed: [...UNIVERSAL_ACTIONS, 'notify_admins', 'send_email']
    // Note: notify_assignees not suggested — item is archived, assignees may not care
  },
  assignee_added: {
    suggested: ['notify_assignees', 'set_due_date', 'add_update', 'add_label'],
    allowed: [...UNIVERSAL_ACTIONS, 'notify_admins', 'notify_assignees', 'assign_user', 'remove_assignee']
  },
  assignee_removed: {
    suggested: ['add_update', 'send_webhook'],
    allowed: [...UNIVERSAL_ACTIONS, 'notify_admins', 'notify_assignees']
  },
  field_changed: {
    suggested: ['notify_assignees', 'set_needs_attention', 'add_update'],
    allowed: [...UNIVERSAL_ACTIONS, 'notify_admins', 'notify_assignees', 'assign_user', 'remove_assignee']
  },
  update_created: {
    suggested: ['notify_assignees', 'send_webhook'],
    allowed: [...UNIVERSAL_ACTIONS, 'notify_admins', 'notify_assignees']
  },
  due_date_relative: {
    suggested: ['notify_assignees', 'set_needs_attention', 'notify_admins', 'send_email'],
    allowed: [...UNIVERSAL_ACTIONS, 'notify_admins', 'notify_assignees', 'assign_user']
  },
  time_entry_logged: {
    suggested: ['notify_admins', 'add_update'],
    allowed: [...UNIVERSAL_ACTIONS, 'notify_admins', 'notify_assignees']
  },
  file_uploaded: {
    suggested: ['notify_assignees', 'add_update'],
    allowed: [...UNIVERSAL_ACTIONS, 'notify_admins', 'notify_assignees']
  },
  all_subitems_completed: {
    suggested: ['set_status', 'notify_assignees', 'archive_item', 'add_update'],
    allowed: [...UNIVERSAL_ACTIONS, 'notify_admins', 'notify_assignees', 'assign_user']
  },
  all_assignees_completed: {
    suggested: ['set_status', 'notify_admins', 'archive_item'],
    allowed: [...UNIVERSAL_ACTIONS, 'notify_admins', 'notify_assignees']
  },
  label_added: {
    suggested: ['notify_assignees', 'set_needs_attention', 'send_webhook', 'add_update'],
    allowed: [...UNIVERSAL_ACTIONS, 'notify_admins', 'notify_assignees', 'assign_user']
  },
  label_removed: {
    suggested: ['add_update', 'send_webhook'],
    allowed: [...UNIVERSAL_ACTIONS, 'notify_admins', 'notify_assignees']
  }
};

/**
 * Get actions allowed for a given trigger, split into suggested and other.
 * Returns { suggested: Action[], other: Action[] }
 */
export function getActionsForTrigger(triggerType) {
  const compat = TRIGGER_ACTION_COMPAT[triggerType];
  if (!compat) {
    // Unknown trigger — return all non-soon actions
    return { suggested: [], other: ACTIONS.filter((a) => !a.soon) };
  }
  const suggestedSet = new Set(compat.suggested);
  const allowedSet = new Set(compat.allowed);
  const suggested = ACTIONS.filter((a) => !a.soon && suggestedSet.has(a.id));
  const other = ACTIONS.filter((a) => !a.soon && allowedSet.has(a.id) && !suggestedSet.has(a.id));
  return { suggested, other };
}

export function getActionConfigFields(actionType) {
  switch (actionType) {
    case 'notify_users':
      return [
        { key: 'recipient_mode', label: 'Notify who?', type: 'recipient_mode' },
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'body', label: 'Body', type: 'text', multiline: true }
      ];
    case 'notify_admins':
    case 'notify_assignees':
      return [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'body', label: 'Body', type: 'text', multiline: true }
      ];
    case 'set_status':
      return [{ key: 'status', label: 'Status', type: 'status_select' }];
    case 'set_needs_attention':
      return [{ key: 'value', label: 'Value', type: 'boolean' }];
    case 'add_update':
      return [{ key: 'content', label: 'Update content', type: 'text', multiline: true }];
    case 'set_due_date':
      return [{ key: 'due_date', label: 'Due date', type: 'date' }];
    case 'clear_due_date':
    case 'archive_item':
      return [];
    case 'move_to_group':
      return [{ key: 'group_id', label: 'Target group', type: 'group_select' }];
    case 'move_to_board':
      return [{ key: 'board_id', label: 'Target board', type: 'board_select' }];
    case 'assign_user':
    case 'remove_assignee':
      return [{ key: 'user_id', label: 'Person', type: 'member_select' }];
    case 'create_item':
      return [
        { key: 'name', label: 'Item name', type: 'text' },
        { key: 'group_id', label: 'Target group (optional)', type: 'group_select' },
        { key: 'status', label: 'Status (optional)', type: 'text' }
      ];
    case 'create_subitem':
      return [
        { key: 'name', label: 'Subitem name', type: 'text' },
        { key: 'status', label: 'Status (optional)', type: 'text' }
      ];
    case 'duplicate_item':
      return [{ key: 'group_id', label: 'Target group (optional)', type: 'group_select' }];
    case 'send_email':
      return [
        { key: 'to', label: 'Recipient email', type: 'text' },
        { key: 'subject', label: 'Subject', type: 'text' },
        { key: 'body', label: 'Body', type: 'text', multiline: true }
      ];
    case 'send_webhook':
      return [{ key: 'url', label: 'Webhook URL', type: 'text' }];
    case 'start_time_tracking':
      return [
        { key: 'work_category', label: 'Category (optional)', type: 'text' },
        { key: 'description', label: 'Description (optional)', type: 'text' }
      ];
    case 'stop_time_tracking':
      return [];
    case 'add_label':
      return [{ key: 'label_id', label: 'Label', type: 'label_select' }];
    case 'remove_label':
      return [
        { key: 'label_id', label: 'Label (optional)', type: 'label_select' },
        { key: 'category', label: 'Or remove all in category', type: 'text' }
      ];
    default:
      return [];
  }
}
