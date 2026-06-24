import express from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

import { query, getClient } from '../db.js';
import { logSecurityEvent, SecurityEventTypes, SecurityEventCategories } from '../services/security/index.js';
import { logTaskActivity, ActivityEventTypes } from '../services/activityLog.js';
import { requireAuth } from '../middleware/auth.js';
import { isStaff } from '../middleware/roles.js';
import { createNotification } from '../services/notifications.js';
import { generateAiResponse } from '../services/ai.js';
import { runDueDateAutomations, runEventAutomationsForAssigneeAdded, runEventAutomationsForItemChange } from '../services/taskAutomations.js';
import { emitTaskEvent, persistTaskEventInTx, fireTaskEventSubscribers, resolveItemContext } from '../services/taskEventBus.js';
import { seedSystemLabels } from '../services/taskLabels.js';
import { parsePagination, activeOnly } from '../services/queryHelpers.js';
import { respondOk, respondCreated } from '../services/responseEnvelope.js';

const EVENT_BUS_ENABLED = process.env.TASK_EVENT_BUS_ENABLED === 'true';

const router = express.Router();

router.use(requireAuth);
router.use(isStaff);

const workspaceCreateSchema = z.object({
  name: z.string().min(1).max(200)
});

const boardCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable()
});

const boardUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  workspace_id: z.string().uuid().optional()
});

const bulkBoardReportSchema = z.object({
  board_ids: z.array(z.string().uuid()).min(1),
  start_date: z.string().optional().nullable(), // YYYY-MM-DD
  end_date: z.string().optional().nullable() // YYYY-MM-DD
});

const groupCreateSchema = z.object({
  name: z.string().min(1).max(200),
  order_index: z.number().int().min(0).optional()
});

const itemCreateSchema = z.object({
  name: z.string().min(1).max(500),
  status: z.string().max(100).optional(), // Now accepts any string - board-specific labels
  due_date: z.string().optional().nullable(), // YYYY-MM-DD
  is_voicemail: z.boolean().optional(),
  needs_attention: z.boolean().optional()
});

const itemUpdateSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  status: z.string().max(100).optional(), // Now accepts any string - board-specific labels
  due_date: z.string().optional().nullable(),
  start_date: z.string().optional().nullable(),
  is_voicemail: z.boolean().optional(),
  needs_attention: z.boolean().optional()
});

const updateCreateSchema = z.object({
  content: z.string().min(1).max(20000),
  parent_update_id: z.string().uuid().optional().nullable()
});

const timeEntryCreateSchema = z.object({
  time_spent_minutes: z.coerce.number().int().min(0),
  billable_minutes: z.coerce.number().int().min(0).optional(),
  description: z.string().max(5000).optional().nullable(),
  work_category: z.string().max(120).optional().nullable(),
  is_billable: z.coerce.boolean().optional()
});

// Expanded enums for v2 rule engine (backward-compatible — old values still accepted)
const triggerTypeEnum = z.enum([
  'status_change', 'assignee_added', 'due_date_relative',
  'item_completed', 'item_created', 'item_archived',
  'update_created', 'assignee_removed', 'field_changed',
  'time_entry_logged', 'file_uploaded',
  'all_subitems_completed', 'all_assignees_completed',
  'label_added', 'label_removed'
]);

const actionTypeEnum = z.enum([
  // Legacy 5
  'notify_admins', 'notify_assignees', 'set_status', 'set_needs_attention', 'add_update',
  // New (TM-015v2c stubs)
  'move_to_group', 'move_to_board', 'duplicate_item', 'archive_item',
  'create_subitem', 'assign_user', 'remove_assignee', 'set_due_date',
  'clear_due_date', 'set_priority', 'set_column_value', 'send_email',
  'send_webhook', 'create_item', 'add_file', 'start_time_tracking',
  'stop_time_tracking', 'add_label', 'remove_label', 'notify_users'
]);

const automationCreateSchema = z.object({
  name: z.string().min(1).max(200),
  trigger_type: triggerTypeEnum,
  trigger_config: z.record(z.any()).optional(),
  trigger_events: z.array(z.string()).optional(),
  action_type: actionTypeEnum,
  action_config: z.record(z.any()).optional(),
  is_active: z.boolean().optional()
});

const automationUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  trigger_type: triggerTypeEnum.optional(),
  trigger_config: z.record(z.any()).optional(),
  trigger_events: z.array(z.string()).optional(),
  action_type: actionTypeEnum.optional(),
  action_config: z.record(z.any()).optional(),
  is_active: z.boolean().optional(),
  error_count: z.number().int().min(0).optional(),
  disabled_reason: z.string().max(500).nullable().optional()
});

const conditionOperatorEnum = z.enum([
  'equals', 'not_equals', 'contains', 'not_contains',
  'gt', 'gte', 'lt', 'lte',
  'in', 'not_in', 'is_empty', 'is_not_empty'
]);

const conditionSchema = z.object({
  field: z.string().min(1).max(200),
  operator: conditionOperatorEnum,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional()
});

const conditionGroupSchema = z.object({
  logic: z.enum(['and', 'or']),
  conditions: z.array(z.union([conditionSchema, z.lazy(() => conditionGroupSchema)])).max(20)
}).optional().nullable();

const stepCreateSchema = z.object({
  step_type: z.enum(['action', 'if', 'else', 'delay']),
  step_order: z.number().int().min(0).optional(),
  action_type: actionTypeEnum.optional(),
  action_config: z.record(z.any()).optional(),
  condition_group: conditionGroupSchema,
  parent_step_id: z.string().uuid().optional().nullable()
}).superRefine((data, ctx) => {
  if (data.step_type === 'action' && !data.action_type) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'action_type is required for action steps', path: ['action_type'] });
  }
  if (data.step_type === 'if') {
    if (!data.condition_group || !data.condition_group.conditions?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'condition_group with at least one condition is required for if steps', path: ['condition_group'] });
    }
  }
});

const stepUpdateSchema = z.object({
  step_type: z.enum(['action', 'if', 'else', 'delay']).optional(),
  action_type: actionTypeEnum.optional(),
  action_config: z.record(z.any()).optional(),
  condition_group: conditionGroupSchema
}).superRefine((data, ctx) => {
  if (data.step_type === 'action' && data.action_type === undefined && data.action_config === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'action_type is required when setting step_type to action', path: ['action_type'] });
  }
  if (data.step_type === 'if' && data.condition_group !== undefined) {
    if (!data.condition_group || !data.condition_group.conditions?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'condition_group with at least one condition is required for if steps', path: ['condition_group'] });
    }
  }
});

const stepReorderSchema = z.object({
  step_order: z.number().int().min(0)
});

// Server-side trigger-action compatibility (mirrors frontend TRIGGER_ACTION_COMPAT)
const TRIGGER_ALLOWED_ACTIONS = {
  status_change: new Set(['notify_users', 'notify_admins', 'notify_assignees', 'set_status', 'set_needs_attention', 'add_update', 'move_to_group', 'move_to_board', 'archive_item', 'assign_user', 'remove_assignee', 'set_due_date', 'clear_due_date', 'create_item', 'create_subitem', 'duplicate_item', 'send_email', 'send_webhook', 'add_label', 'remove_label', 'start_time_tracking', 'stop_time_tracking']),
  item_completed: new Set(['notify_users', 'notify_admins', 'notify_assignees', 'set_status', 'set_needs_attention', 'add_update', 'move_to_group', 'move_to_board', 'archive_item', 'assign_user', 'remove_assignee', 'set_due_date', 'clear_due_date', 'create_item', 'create_subitem', 'duplicate_item', 'send_email', 'send_webhook', 'add_label', 'remove_label', 'start_time_tracking', 'stop_time_tracking']),
  item_created: new Set(['notify_users', 'notify_admins', 'notify_assignees', 'set_status', 'set_needs_attention', 'add_update', 'move_to_group', 'move_to_board', 'archive_item', 'assign_user', 'remove_assignee', 'set_due_date', 'clear_due_date', 'create_item', 'create_subitem', 'duplicate_item', 'send_email', 'send_webhook', 'add_label', 'remove_label', 'start_time_tracking', 'stop_time_tracking']),
  item_archived: new Set(['notify_users', 'notify_admins', 'set_status', 'set_needs_attention', 'add_update', 'move_to_group', 'move_to_board', 'archive_item', 'set_due_date', 'clear_due_date', 'create_item', 'create_subitem', 'duplicate_item', 'send_email', 'send_webhook', 'add_label', 'remove_label', 'start_time_tracking', 'stop_time_tracking']),
  assignee_added: new Set(['notify_users', 'notify_admins', 'notify_assignees', 'set_status', 'set_needs_attention', 'add_update', 'move_to_group', 'move_to_board', 'archive_item', 'assign_user', 'remove_assignee', 'set_due_date', 'clear_due_date', 'create_item', 'create_subitem', 'duplicate_item', 'send_email', 'send_webhook', 'add_label', 'remove_label', 'start_time_tracking', 'stop_time_tracking']),
  assignee_removed: new Set(['notify_users', 'notify_admins', 'notify_assignees', 'set_status', 'set_needs_attention', 'add_update', 'move_to_group', 'move_to_board', 'archive_item', 'set_due_date', 'clear_due_date', 'create_item', 'create_subitem', 'duplicate_item', 'send_email', 'send_webhook', 'add_label', 'remove_label', 'start_time_tracking', 'stop_time_tracking']),
};

const VALID_RECIPIENT_MODES = new Set(['trigger_assignee', 'current_assignees', 'actor', 'item_creator', 'admins', 'specific_user']);

function validateAutomationPayload(payload) {
  const triggerType = String(payload.trigger_type || '');
  const actionType = String(payload.action_type || '');
  const trigger = payload.trigger_config || {};
  const action = payload.action_config || {};

  // Trigger-action compatibility check (warn, don't hard-block for backward compat)
  const allowed = TRIGGER_ALLOWED_ACTIONS[triggerType];
  if (allowed && !allowed.has(actionType)) {
    console.warn(`[automation:compat] action '${actionType}' is not in allowed set for trigger '${triggerType}'`);
  }

  // Validate notify_users recipient_mode
  if (actionType === 'notify_users') {
    const mode = action.recipient_mode;
    if (mode && !VALID_RECIPIENT_MODES.has(mode)) {
      throw new Error(`Invalid recipient_mode: ${mode}`);
    }
    if (mode === 'specific_user' && !action.user_id) {
      throw new Error('action_config.user_id is required when recipient_mode is specific_user');
    }
  }

  if (triggerType === 'status_change') {
    if (trigger.to_status !== undefined && typeof trigger.to_status !== 'string') {
      throw new Error('trigger_config.to_status must be a string');
    }
  }

  if (triggerType === 'due_date_relative') {
    const n = Number(trigger.days_from_due);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error('trigger_config.days_from_due must be an integer');
    }
    if (n < -365 || n > 365) {
      throw new Error('trigger_config.days_from_due must be between -365 and 365');
    }
  }

  if (actionType === 'set_status') {
    if (!String(action.status || '').trim()) {
      throw new Error('action_config.status is required for set_status');
    }
  }

  if (actionType === 'set_needs_attention') {
    if (action.value === undefined) {
      throw new Error('action_config.value is required for set_needs_attention');
    }
  }

  if (actionType === 'add_update') {
    if (!String(action.content || '').trim()) {
      throw new Error('action_config.content is required for add_update');
    }
  }
}

const workspaceMemberAddSchema = z
  .object({
    user_id: z.string().uuid().optional(),
    email: z.string().email().optional(),
    role: z.enum(['admin', 'member']).optional()
  })
  .refine((v) => Boolean(v.user_id || v.email), { message: 'user_id or email is required' });

const workspaceMemberRoleSchema = z.object({
  role: z.enum(['admin', 'member'])
});

const itemAssigneeAddSchema = z
  .object({
    user_id: z.string().uuid().optional(),
    email: z.string().email().optional()
  })
  .refine((v) => Boolean(v.user_id || v.email), { message: 'user_id or email is required' });

const subitemCreateSchema = z.object({
  name: z.string().min(1).max(500),
  status: z.string().max(100).optional(), // Now accepts any string status label
  due_date: z.string().optional().nullable() // YYYY-MM-DD
});

const subitemUpdateSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  status: z.string().max(100).optional(), // Now accepts any string status label
  due_date: z.string().optional().nullable(),
  start_date: z.string().optional().nullable()
});

// Status label management schema
const colorHexSchema = z.string().regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/);

const statusLabelCreateSchema = z.object({
  label: z.string().min(1).max(100),
  color: colorHexSchema.optional(), // supports #RRGGBB and #RRGGBBAA
  order_index: z.number().int().min(0).optional(),
  is_done_state: z.boolean().optional()
});

const statusLabelUpdateSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  color: colorHexSchema.optional(), // supports #RRGGBB and #RRGGBBAA
  order_index: z.number().int().min(0).optional(),
  is_done_state: z.boolean().optional()
});

const globalStatusLabelCreateSchema = statusLabelCreateSchema;

function getEffectiveRole(req) {
  return req.user?.effective_role || req.user?.role;
}

const uploadRoot = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
const taskFilesDir = path.join(uploadRoot, 'tasks');
if (!fs.existsSync(taskFilesDir)) fs.mkdirSync(taskFilesDir, { recursive: true });

function safeFilename(name) {
  return String(name || 'upload').replace(/[^\w.-]+/g, '_');
}

// Allowlist of MIME types accepted for task file attachments. SVG is
// deliberately excluded because it can carry executable script. HTML and
// other markup that browsers render inline are also excluded. The disk-
// storage backend is a Phase 3 follow-up (Cloud Run's filesystem is
// ephemeral; see phase-3-files-delete-preview in the aspect spec).
const ALLOWED_TASK_FILE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
  'video/mp4',
  'video/quicktime',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4'
]);

// MIME type alone is client-controlled, so a file labeled image/jpeg could
// still carry a .html or .svg extension that browsers happily render. Require
// both the declared MIME and the extension to be in the allowlist.
const ALLOWED_TASK_FILE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif',
  '.pdf',
  '.doc', '.docx',
  '.xls', '.xlsx',
  '.ppt', '.pptx',
  '.txt', '.csv',
  '.zip',
  '.mp4', '.mov',
  '.mp3', '.wav', '.m4a'
]);

function taskFileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (
    ALLOWED_TASK_FILE_MIME_TYPES.has(file.mimetype) &&
    ALLOWED_TASK_FILE_EXTENSIONS.has(ext)
  ) {
    cb(null, true);
    return;
  }
  const err = new Error(`File type not allowed: ${file.mimetype} (${ext || 'no extension'})`);
  err.code = 'INVALID_FILE_TYPE';
  cb(err, false);
}

const uploadTaskFile = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, taskFilesDir),
    filename: (_req, file, cb) => {
      const rand = crypto.randomBytes(8).toString('hex');
      cb(null, `${Date.now()}_${rand}_${safeFilename(file.originalname)}`);
    }
  }),
  fileFilter: taskFileFilter,
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

function uploadTaskFileMiddleware(req, res, next) {
  uploadTaskFile.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'INVALID_FILE_TYPE') {
      return res.status(415).json({ message: err.message });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'File exceeds 25MB limit' });
    }
    return res.status(400).json({ message: err.message || 'Upload failed' });
  });
}

async function assertWorkspaceAccess({ effRole, userId, workspaceId }) {
  // Staff are implicit members of all task workspaces/boards.
  if (effRole === 'superadmin' || effRole === 'admin' || effRole === 'team') return true;
  const { rowCount } = await query(
    `SELECT 1
     FROM task_workspace_memberships
     WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId]
  );
  return rowCount > 0;
}

/**
 * Check if a status is a done-state for a given board.
 * Falls back to checking global status labels, then to literal 'Done' as last resort.
 */
async function isDoneStatus(status, boardId) {
  if (!status) return false;
  // Check board-level status labels first
  if (boardId) {
    const { rows } = await query(
      `SELECT is_done_state FROM task_board_status_labels WHERE board_id = $1 AND label = $2`,
      [boardId, status]
    );
    if (rows.length > 0) return rows[0].is_done_state === true;
  }
  // Check global status labels
  const { rows: globalRows } = await query(
    `SELECT is_done_state FROM task_global_status_labels WHERE label = $1`,
    [status]
  );
  if (globalRows.length > 0) return globalRows[0].is_done_state === true;
  // Fallback: literal 'Done'
  return status === 'Done';
}

function extractMentionEmails(text = '') {
  const input = String(text || '');
  // Legacy mentions: @email@example.com (kept so comments authored before the
  // user-picker rollout still notify on edit or re-render).
  const regex = /@([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const emails = new Set();
  let match;
  while ((match = regex.exec(input)) !== null) {
    const email = String(match[1] || '')
      .trim()
      .toLowerCase();
    if (email) emails.add(email);
  }
  return Array.from(emails);
}

// Current mentions use the picker token `@[Display Name](uuid)` so the server
// can resolve to a user_id without depending on the rendered name.
const MENTION_USER_TOKEN_RE = /@\[[^\]]+\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

function extractMentionUserIds(text = '') {
  const input = String(text || '');
  const ids = new Set();
  MENTION_USER_TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = MENTION_USER_TOKEN_RE.exec(input)) !== null) {
    const id = String(match[1] || '').toLowerCase();
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

async function resolveMentionedUserIds({ content, workspaceId, actorUserId }) {
  const userIds = extractMentionUserIds(content);
  const emails = extractMentionEmails(content);
  if (!userIds.length && !emails.length) return [];

  const params = [];
  const clauses = [];
  if (userIds.length) {
    params.push(userIds);
    clauses.push(`id = ANY($${params.length}::uuid[])`);
  }
  if (emails.length) {
    params.push(emails);
    clauses.push(`lower(email) = ANY($${params.length})`);
  }
  const { rows: users } = await query(
    `SELECT id, email, role
     FROM users
     WHERE ${clauses.join(' OR ')}`,
    params
  );
  if (!users.length) return [];

  // Only return users who can access this workspace (avoid leaking references).
  const allowedIds = [];
  for (const u of users) {
    if (!u?.id || u.id === actorUserId) continue;
    const ok = await assertWorkspaceAccess({ effRole: u.role, userId: u.id, workspaceId });
    if (ok) allowedIds.push(u.id);
  }
  return allowedIds;
}

async function fanOutUpdateNotifications({ itemId, workspaceId, actorUserId, content, replyToUserId = null }) {
  const mentioned = await resolveMentionedUserIds({ content, workspaceId, actorUserId });
  const replyTargets = replyToUserId && replyToUserId !== actorUserId
    ? [replyToUserId].filter((id) => !mentioned.includes(id))
    : [];
  if (!mentioned.length && !replyTargets.length) return;

  const { rows: itemRows } = await query('SELECT id, name FROM task_items WHERE id = $1 LIMIT 1', [itemId]);
  const itemName = itemRows[0]?.name || 'Task item';
  const boardId = await getBoardIdForItem(itemId);
  const linkUrl = boardId
    ? `/tasks?pane=boards&board=${encodeURIComponent(boardId)}&item=${encodeURIComponent(itemId)}`
    : '/tasks?pane=boards';

  const sends = [];
  for (const uid of mentioned) {
    sends.push(
      createNotification({
        userId: uid,
        title: 'You were mentioned in a task update',
        body: `${itemName}`,
        linkUrl,
        meta: {
          source: 'task_mention',
          item_id: itemId,
          workspace_id: workspaceId,
          actor_user_id: actorUserId
        }
      })
    );
  }
  for (const uid of replyTargets) {
    // Reply-target lookup ran through assertWorkspaceAccess in the caller.
    sends.push(
      createNotification({
        userId: uid,
        title: 'Someone replied to your comment',
        body: `${itemName}`,
        linkUrl,
        meta: {
          source: 'task_update_reply',
          item_id: itemId,
          workspace_id: workspaceId,
          actor_user_id: actorUserId
        }
      })
    );
  }
  await Promise.all(sends);
}

async function getWorkspaceIdForBoard(boardId) {
  const { rows } = await query('SELECT workspace_id FROM task_boards WHERE id = $1', [boardId]);
  return rows[0]?.workspace_id || null;
}

async function getWorkspaceIdForGroup(groupId) {
  const { rows } = await query(
    `SELECT b.workspace_id
     FROM task_groups g
     JOIN task_boards b ON b.id = g.board_id
     WHERE g.id = $1`,
    [groupId]
  );
  return rows[0]?.workspace_id || null;
}

async function getWorkspaceIdForItem(itemId) {
  const { rows } = await query(
    `SELECT b.workspace_id
     FROM task_items i
     JOIN task_groups g ON g.id = i.group_id
     JOIN task_boards b ON b.id = g.board_id
     WHERE i.id = $1`,
    [itemId]
  );
  return rows[0]?.workspace_id || null;
}

async function getBoardIdForItem(itemId) {
  const { rows } = await query(
    `SELECT g.board_id
     FROM task_items i
     JOIN task_groups g ON g.id = i.group_id
     WHERE i.id = $1`,
    [itemId]
  );
  return rows[0]?.board_id || null;
}

async function getBoardIdForGroup(groupId) {
  const { rows } = await query('SELECT board_id FROM task_groups WHERE id = $1', [groupId]);
  return rows[0]?.board_id || null;
}

async function getWorkspaceIdForSubitem(subitemId) {
  const { rows } = await query(
    `SELECT b.workspace_id
     FROM task_subitems s
     JOIN task_items i ON i.id = s.parent_item_id
     JOIN task_groups g ON g.id = i.group_id
     JOIN task_boards b ON b.id = g.board_id
     WHERE s.id = $1`,
    [subitemId]
  );
  return rows[0]?.workspace_id || null;
}

// Automations are implemented in server/services/taskAutomations.js

router.get('/workspaces', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  try {
    // Staff are implicit members of all task workspaces.
    if (eff === 'superadmin' || eff === 'admin' || eff === 'team') {
      const { rows } = await query('SELECT * FROM task_workspaces ORDER BY created_at DESC');
      return respondOk(res, rows);
    }
    const { rows } = await query(
      `SELECT w.*
       FROM task_workspaces w
       JOIN task_workspace_memberships m ON m.workspace_id = w.id
       WHERE m.user_id = $1
       ORDER BY w.created_at DESC`,
      [userId]
    );
    return respondOk(res, rows);
  } catch (err) {
    console.error('[tasks:workspaces:list]', err);
    return res.status(500).json({ message: 'Unable to load workspaces' });
  }
});

router.post('/workspaces', async (req, res) => {
  const eff = getEffectiveRole(req);
  if (eff !== 'superadmin' && eff !== 'admin') {
    return res.status(403).json({ message: 'Insufficient permissions' });
  }
  try {
    const payload = workspaceCreateSchema.parse(req.body);
    // Atomic: workspace INSERT + admin membership + system-label seed + audit
    // event all commit together. Without this, a failure between the
    // workspace INSERT and the membership INSERT would strand a workspace
    // that nobody (not even the creator) can administer.
    const db = await getClient();
    let createdWorkspace;
    let eventPayload;
    try {
      await db.query('BEGIN');
      const { rows } = await db.query(
        `INSERT INTO task_workspaces (name, created_by)
         VALUES ($1, $2)
         RETURNING *`,
        [payload.name.trim(), req.user.id]
      );
      createdWorkspace = rows[0];
      // creator becomes workspace admin
      await db.query(
        `INSERT INTO task_workspace_memberships (workspace_id, user_id, role)
         VALUES ($1, $2, 'admin')
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'admin'`,
        [createdWorkspace.id, req.user.id]
      );
      // Seed default system labels for new workspace
      await seedSystemLabels(createdWorkspace.id, db);
      eventPayload = {
        event_type: 'workspace.created',
        workspace_id: createdWorkspace.id,
        entity_type: 'workspace',
        entity_id: createdWorkspace.id,
        actor_id: req.user.id,
        new_value: { name: createdWorkspace.name }
      };
      await persistTaskEventInTx(db, eventPayload);
      await db.query('COMMIT');
    } catch (txErr) {
      try { await db.query('ROLLBACK'); } catch { /* noop */ }
      throw txErr;
    } finally {
      db.release();
    }
    fireTaskEventSubscribers(eventPayload);
    return respondCreated(res, createdWorkspace);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    }
    console.error('[tasks:workspaces:create]', err);
    return res.status(500).json({ message: 'Unable to create workspace' });
  }
});

// Delete a workspace (cascades boards/groups/items)
router.delete('/workspaces/:workspaceId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { workspaceId } = req.params;
  if (eff !== 'superadmin' && eff !== 'admin') {
    return res.status(403).json({ message: 'Insufficient permissions' });
  }
  try {
    const { rows: exists } = await query('SELECT id FROM task_workspaces WHERE id = $1 LIMIT 1', [workspaceId]);
    if (!exists.length) return res.status(404).json({ message: 'Workspace not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    await query('DELETE FROM task_workspaces WHERE id = $1', [workspaceId]);
    emitTaskEvent({
      event_type: 'workspace.deleted',
      workspace_id: workspaceId,
      entity_type: 'workspace',
      entity_id: workspaceId,
      actor_id: req.user.id,
      metadata: { cascade: true }
    });
    return respondOk(res, null);
  } catch (err) {
    console.error('[tasks:workspaces:delete]', err);
    return res.status(500).json({ message: 'Unable to delete workspace' });
  }
});

// Workspace members (admin UI)
router.get('/workspaces/:workspaceId/members', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { workspaceId } = req.params;
  try {
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    // Include implicit staff members for every workspace.
    const { rows } = await query(
      `WITH explicit_members AS (
         SELECT
           m.user_id,
           m.role AS membership_role,
           m.created_at,
           u.email,
           u.first_name,
           u.last_name,
           u.role AS user_role,
           u.avatar_url,
           1 AS precedence
         FROM task_workspace_memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = $1
       ),
       implicit_staff AS (
         SELECT
           u.id AS user_id,
           CASE WHEN u.role IN ('superadmin','admin') THEN 'admin' ELSE 'member' END AS membership_role,
           NULL::timestamptz AS created_at,
           u.email,
           u.first_name,
           u.last_name,
           u.role AS user_role,
           u.avatar_url,
           2 AS precedence
         FROM users u
         WHERE u.role IN ('superadmin','admin','team')
       )
       SELECT DISTINCT ON (user_id)
         user_id, membership_role, created_at, email, first_name, last_name, user_role, avatar_url
       FROM (
         SELECT * FROM explicit_members
         UNION ALL
         SELECT * FROM implicit_staff
       ) t
       ORDER BY user_id, precedence`,
      [workspaceId]
    );
    return res.json({ members: rows });
  } catch (err) {
    console.error('[tasks:workspace-members:list]', err);
    return res.status(500).json({ message: 'Unable to load workspace members' });
  }
});

router.get('/workspaces/:workspaceId/members/search', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { workspaceId } = req.params;
  const q = String(req.query.q || '').trim();
  try {
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    if (!q) return res.json({ members: [] });
    const like = `%${q.toLowerCase()}%`;
    const { rows } = await query(
      `WITH explicit_members AS (
         SELECT
           m.user_id,
           m.role AS membership_role,
           u.email,
           u.first_name,
           u.last_name,
           u.role AS user_role,
           1 AS precedence
         FROM task_workspace_memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = $1
       ),
       implicit_staff AS (
         SELECT
           u.id AS user_id,
           CASE WHEN u.role IN ('superadmin','admin') THEN 'admin' ELSE 'member' END AS membership_role,
           u.email,
           u.first_name,
           u.last_name,
           u.role AS user_role,
           2 AS precedence
         FROM users u
         WHERE u.role IN ('superadmin','admin','team')
       ),
       combined AS (
         SELECT DISTINCT ON (user_id)
           user_id, membership_role, email, first_name, last_name, user_role
         FROM (
           SELECT * FROM explicit_members
           UNION ALL
           SELECT * FROM implicit_staff
         ) t
         ORDER BY user_id, precedence
       )
       SELECT *
       FROM combined
       WHERE (
         lower(email) LIKE $2
         OR lower(first_name) LIKE $2
         OR lower(last_name) LIKE $2
         OR lower(first_name || ' ' || last_name) LIKE $2
       )
       ORDER BY email ASC
       LIMIT 10`,
      [workspaceId, like]
    );
    return res.json({ members: rows });
  } catch (err) {
    console.error('[tasks:workspace-members:search]', err);
    return res.status(500).json({ message: 'Unable to search workspace members' });
  }
});

router.post('/workspaces/:workspaceId/members', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { workspaceId } = req.params;
  if (eff !== 'superadmin' && eff !== 'admin') return res.status(403).json({ message: 'Insufficient permissions' });
  try {
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const payload = workspaceMemberAddSchema.parse(req.body);
    let targetUserId = payload.user_id;
    if (!targetUserId && payload.email) {
      const { rows } = await query('SELECT id FROM users WHERE email = $1 LIMIT 1', [payload.email]);
      targetUserId = rows[0]?.id || null;
    }
    if (!targetUserId) return res.status(404).json({ message: 'User not found' });

    const role = payload.role || 'member';
    await query(
      `INSERT INTO task_workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [workspaceId, targetUserId, role]
    );

    const { rows: members } = await query(
      `SELECT
         m.user_id,
         m.role AS membership_role,
         m.created_at,
         u.email,
         u.first_name,
         u.last_name,
         u.role AS user_role
       FROM task_workspace_memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = $1 AND m.user_id = $2
       LIMIT 1`,
      [workspaceId, targetUserId]
    );
    emitTaskEvent({
      event_type: 'workspace.member_added',
      workspace_id: workspaceId,
      entity_type: 'workspace',
      entity_id: workspaceId,
      actor_id: req.user.id,
      new_value: { user_id: targetUserId, role }
    });
    return res.status(201).json({ member: members[0] });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:workspace-members:add]', err);
    return res.status(500).json({ message: 'Unable to add workspace member' });
  }
});

router.patch('/workspaces/:workspaceId/members/:memberUserId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { workspaceId, memberUserId } = req.params;
  if (eff !== 'superadmin' && eff !== 'admin') return res.status(403).json({ message: 'Insufficient permissions' });
  try {
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const payload = workspaceMemberRoleSchema.parse(req.body);
    const { rowCount } = await query(
      `UPDATE task_workspace_memberships
       SET role = $1
       WHERE workspace_id = $2 AND user_id = $3`,
      [payload.role, workspaceId, memberUserId]
    );
    if (!rowCount) return res.status(404).json({ message: 'Member not found' });

    const { rows } = await query(
      `SELECT
         m.user_id,
         m.role AS membership_role,
         m.created_at,
         u.email,
         u.first_name,
         u.last_name,
         u.role AS user_role
       FROM task_workspace_memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = $1 AND m.user_id = $2
       LIMIT 1`,
      [workspaceId, memberUserId]
    );
    emitTaskEvent({
      event_type: 'workspace.member_role_changed',
      workspace_id: workspaceId,
      entity_type: 'workspace',
      entity_id: workspaceId,
      actor_id: req.user.id,
      new_value: { user_id: memberUserId, role: payload.role }
    });
    return res.json({ member: rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:workspace-members:update]', err);
    return res.status(500).json({ message: 'Unable to update workspace member' });
  }
});

router.delete('/workspaces/:workspaceId/members/:memberUserId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { workspaceId, memberUserId } = req.params;
  if (eff !== 'superadmin' && eff !== 'admin') return res.status(403).json({ message: 'Insufficient permissions' });
  try {
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    const { rowCount } = await query(`DELETE FROM task_workspace_memberships WHERE workspace_id = $1 AND user_id = $2`, [
      workspaceId,
      memberUserId
    ]);
    if (!rowCount) return res.status(404).json({ message: 'Member not found' });
    emitTaskEvent({
      event_type: 'workspace.member_removed',
      workspace_id: workspaceId,
      entity_type: 'workspace',
      entity_id: workspaceId,
      actor_id: req.user.id,
      old_value: { user_id: memberUserId }
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[tasks:workspace-members:remove]', err);
    return res.status(500).json({ message: 'Unable to remove workspace member' });
  }
});

// Boards
router.get('/workspaces/:workspaceId/boards', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { workspaceId } = req.params;
  try {
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    const { rows } = await query(
      `SELECT *
       FROM task_boards
       WHERE workspace_id = $1
       ORDER BY created_at DESC`,
      [workspaceId]
    );
    return res.json({ boards: rows });
  } catch (err) {
    console.error('[tasks:boards:list]', err);
    return res.status(500).json({ message: 'Unable to load boards' });
  }
});

router.get('/boards', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  try {
    // Staff can see all boards. Non-staff never hit this router because router.use(isStaff).
    const { rows } = await query(
      `SELECT b.*, w.name AS workspace_name
       FROM task_boards b
       JOIN task_workspaces w ON w.id = b.workspace_id
       ORDER BY w.created_at DESC, b.created_at DESC`
    );
    return res.json({ boards: rows });
  } catch (err) {
    console.error('[tasks:boards:list-all]', err);
    return res.status(500).json({ message: 'Unable to load boards' });
  }
});

router.post('/workspaces/:workspaceId/boards', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { workspaceId } = req.params;
  try {
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    const payload = boardCreateSchema.parse(req.body);
    const { rows } = await query(
      `INSERT INTO task_boards (workspace_id, name, description, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [workspaceId, payload.name.trim(), payload.description ?? null, req.user.id]
    );
    emitTaskEvent({
      event_type: 'board.created',
      workspace_id: workspaceId,
      board_id: rows[0].id,
      entity_type: 'board',
      entity_id: rows[0].id,
      actor_id: req.user.id,
      new_value: { name: rows[0].name, description: rows[0].description }
    });
    return res.status(201).json({ board: rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:boards:create]', err);
    return res.status(500).json({ message: 'Unable to create board' });
  }
});

// Delete a board (cascades groups/items)
router.delete('/boards/:boardId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { boardId } = req.params;
  if (eff !== 'superadmin' && eff !== 'admin') {
    return res.status(403).json({ message: 'Insufficient permissions' });
  }
  try {
    const workspaceId = await getWorkspaceIdForBoard(boardId);
    if (!workspaceId) return res.status(404).json({ message: 'Board not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    await query('DELETE FROM task_boards WHERE id = $1', [boardId]);
    emitTaskEvent({
      event_type: 'board.deleted',
      workspace_id: workspaceId,
      board_id: boardId,
      entity_type: 'board',
      entity_id: boardId,
      actor_id: req.user.id
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[tasks:boards:delete]', err);
    return res.status(500).json({ message: 'Unable to delete board' });
  }
});

router.patch('/boards/:boardId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { boardId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForBoard(boardId);
    if (!workspaceId) return res.status(404).json({ message: 'Board not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const payload = boardUpdateSchema.parse(req.body);
    const fields = [];
    const values = [];
    let i = 1;
    if (payload.name !== undefined) {
      fields.push(`name = $${i++}`);
      values.push(payload.name.trim());
    }
    if (payload.description !== undefined) {
      fields.push(`description = $${i++}`);
      values.push(payload.description ?? null);
    }
    if (payload.workspace_id !== undefined && payload.workspace_id !== workspaceId) {
      // Ensure user has access to destination workspace too.
      const okDest = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId: payload.workspace_id });
      if (!okDest) return res.status(403).json({ message: 'Insufficient permissions for destination workspace' });
      fields.push(`workspace_id = $${i++}`);
      values.push(payload.workspace_id);
    }
    if (!fields.length) return res.status(400).json({ message: 'No changes provided' });
    values.push(boardId);
    const { rows } = await query(
      `UPDATE task_boards
       SET ${fields.join(', ')}
       WHERE id = $${i}
       RETURNING *`,
      values
    );
    emitTaskEvent({
      event_type: 'board.updated',
      workspace_id: rows[0].workspace_id,
      board_id: boardId,
      entity_type: 'board',
      entity_id: boardId,
      actor_id: req.user.id,
      new_value: { name: rows[0].name, description: rows[0].description }
    });
    return res.json({ board: rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:boards:update]', err);
    return res.status(500).json({ message: 'Unable to update board' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STATUS LABELS (per board)
// ─────────────────────────────────────────────────────────────────────────────

// Get status labels for a board
router.get('/boards/:boardId/status-labels', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { boardId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForBoard(boardId);
    if (!workspaceId) return res.status(404).json({ message: 'Board not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const [{ rows: boardRows }, { rows: globalRows }] = await Promise.all([
      query(
      `SELECT * FROM task_board_status_labels
       WHERE board_id = $1
       ORDER BY order_index ASC, label ASC`,
        [boardId]
      ),
      query(
        `SELECT * FROM task_global_status_labels
         ORDER BY order_index ASC, label ASC`,
        []
      )
    ]);

    // Merge global + board labels. Board labels override global ones with the same label text.
    const merged = [];
    const seen = new Map(); // key=labelLower -> index
    for (const r of globalRows) {
      const key = String(r.label || '').trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.set(key, merged.length);
      merged.push({ ...r, is_global: true });
    }
    for (const r of boardRows) {
      const key = String(r.label || '').trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) {
        merged[seen.get(key)] = { ...r, is_global: false };
      } else {
        seen.set(key, merged.length);
        merged.push({ ...r, is_global: false });
      }
    }

    // Return defaults if none exist
    const defaultLabels = [
      { id: 'default-todo', label: 'To Do', color: '#808080', order_index: 0, is_done_state: false },
      { id: 'default-working', label: 'Working on it', color: '#fdab3d', order_index: 1, is_done_state: false },
      { id: 'default-stuck', label: 'Stuck', color: '#e2445c', order_index: 2, is_done_state: false },
      { id: 'default-done', label: 'Done', color: '#00c875', order_index: 3, is_done_state: true },
      { id: 'default-needs-attention', label: 'Needs Attention', color: '#ff642e', order_index: 4, is_done_state: false }
    ];

    return res.json({ status_labels: merged.length ? merged : defaultLabels });
  } catch (err) {
    console.error('[tasks:status-labels:list]', err);
    return res.status(500).json({ message: 'Unable to load status labels' });
  }
});

// List global status labels
router.get('/status-labels/global', async (req, res) => {
  const eff = getEffectiveRole(req);
  if (!['superadmin', 'admin'].includes(eff)) {
    return res.status(403).json({ message: 'Only admins can manage status labels' });
  }
  try {
    const { rows } = await query(
      `SELECT * FROM task_global_status_labels ORDER BY order_index ASC, label ASC`,
      []
    );
    return res.json({ status_labels: rows });
  } catch (err) {
    console.error('[tasks:status-labels:global:list]', err);
    return res.status(500).json({ message: 'Unable to load global status labels' });
  }
});

// Create a global status label
router.post('/status-labels/global', async (req, res) => {
  const eff = getEffectiveRole(req);
  if (!['superadmin', 'admin'].includes(eff)) {
    return res.status(403).json({ message: 'Only admins can manage status labels' });
  }
  try {
    const payload = globalStatusLabelCreateSchema.parse(req.body);
    const { rows: maxRows } = await query(
      `SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM task_global_status_labels`,
      []
    );
    const orderIndex = payload.order_index ?? maxRows[0].next_order;
    const { rows } = await query(
      `INSERT INTO task_global_status_labels (label, color, order_index, is_done_state, created_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [payload.label.trim(), payload.color || '#808080', orderIndex, payload.is_done_state ?? false, req.user.id]
    );
    emitTaskEvent({
      event_type: 'status_label.created',
      entity_type: 'status_label',
      entity_id: rows[0].id,
      actor_id: req.user.id,
      new_value: { label: rows[0].label, color: rows[0].color, is_done_state: rows[0].is_done_state },
      metadata: { scope: 'global' }
    });
    return res.status(201).json({ status_label: rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:status-labels:global:create]', err);
    return res.status(500).json({ message: 'Unable to create global status label' });
  }
});

// Create a status label for a board
router.post('/boards/:boardId/status-labels', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { boardId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForBoard(boardId);
    if (!workspaceId) return res.status(404).json({ message: 'Board not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    // Only admins can create status labels
    if (!['superadmin', 'admin'].includes(eff)) {
      return res.status(403).json({ message: 'Only admins can manage status labels' });
    }

    const payload = statusLabelCreateSchema.parse(req.body);

    // Get max order_index
    const { rows: maxRows } = await query(
      `SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM task_board_status_labels WHERE board_id = $1`,
      [boardId]
    );
    const orderIndex = payload.order_index ?? maxRows[0].next_order;

    const { rows } = await query(
      `INSERT INTO task_board_status_labels (board_id, label, color, order_index, is_done_state)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [boardId, payload.label.trim(), payload.color || '#808080', orderIndex, payload.is_done_state ?? false]
    );

    emitTaskEvent({
      event_type: 'status_label.created',
      workspace_id: workspaceId,
      board_id: boardId,
      entity_type: 'status_label',
      entity_id: rows[0].id,
      actor_id: req.user.id,
      new_value: { label: rows[0].label, color: rows[0].color, is_done_state: rows[0].is_done_state },
      metadata: { scope: 'board' }
    });
    return res.status(201).json({ status_label: rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:status-labels:create]', err);
    return res.status(500).json({ message: 'Unable to create status label' });
  }
});

// Update a status label
router.patch('/status-labels/:labelId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { labelId } = req.params;
  try {
    // Get the label to find its board
    const { rows: labelRows } = await query('SELECT * FROM task_board_status_labels WHERE id = $1', [labelId]);
    if (!labelRows.length) return res.status(404).json({ message: 'Status label not found' });
    const label = labelRows[0];

    const workspaceId = await getWorkspaceIdForBoard(label.board_id);
    if (!workspaceId) return res.status(404).json({ message: 'Board not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    // Only admins can update status labels
    if (!['superadmin', 'admin'].includes(eff)) {
      return res.status(403).json({ message: 'Only admins can manage status labels' });
    }

    const payload = statusLabelUpdateSchema.parse(req.body);
    const fields = [];
    const values = [];
    let i = 1;
    if (payload.label !== undefined) {
      fields.push(`label = $${i++}`);
      values.push(payload.label.trim());
    }
    if (payload.color !== undefined) {
      fields.push(`color = $${i++}`);
      values.push(payload.color);
    }
    if (payload.order_index !== undefined) {
      fields.push(`order_index = $${i++}`);
      values.push(payload.order_index);
    }
    if (payload.is_done_state !== undefined) {
      fields.push(`is_done_state = $${i++}`);
      values.push(payload.is_done_state);
    }
    if (!fields.length) return res.status(400).json({ message: 'No changes provided' });
    values.push(labelId);
    const { rows } = await query(
      `UPDATE task_board_status_labels SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    emitTaskEvent({
      event_type: 'status_label.updated',
      workspace_id: workspaceId,
      board_id: label.board_id,
      entity_type: 'status_label',
      entity_id: labelId,
      actor_id: req.user.id,
      old_value: { label: label.label, color: label.color, is_done_state: label.is_done_state },
      new_value: { label: rows[0].label, color: rows[0].color, is_done_state: rows[0].is_done_state }
    });
    return res.json({ status_label: rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:status-labels:update]', err);
    return res.status(500).json({ message: 'Unable to update status label' });
  }
});

// Delete a status label
router.delete('/status-labels/:labelId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { labelId } = req.params;
  try {
    // Get the label to find its board
    const { rows: labelRows } = await query('SELECT * FROM task_board_status_labels WHERE id = $1', [labelId]);
    if (!labelRows.length) return res.status(404).json({ message: 'Status label not found' });
    const label = labelRows[0];

    const workspaceId = await getWorkspaceIdForBoard(label.board_id);
    if (!workspaceId) return res.status(404).json({ message: 'Board not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    // Only admins can delete status labels
    if (!['superadmin', 'admin'].includes(eff)) {
      return res.status(403).json({ message: 'Only admins can manage status labels' });
    }

    await query('DELETE FROM task_board_status_labels WHERE id = $1', [labelId]);
    emitTaskEvent({
      event_type: 'status_label.deleted',
      workspace_id: workspaceId,
      board_id: label.board_id,
      entity_type: 'status_label',
      entity_id: labelId,
      actor_id: req.user.id,
      old_value: { label: label.label, color: label.color, is_done_state: label.is_done_state }
    });
    return respondOk(res, null);
  } catch (err) {
    console.error('[tasks:status-labels:delete]', err);
    return res.status(500).json({ message: 'Unable to delete status label' });
  }
});

// Initialize default labels for a board (copies defaults to DB so they can be customized)
router.post('/boards/:boardId/status-labels/init', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { boardId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForBoard(boardId);
    if (!workspaceId) return res.status(404).json({ message: 'Board not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    // Only admins can initialize status labels
    if (!['superadmin', 'admin'].includes(eff)) {
      return res.status(403).json({ message: 'Only admins can manage status labels' });
    }

    // Insert default labels
    const defaults = [
      { label: 'To Do', color: '#808080', order_index: 0, is_done_state: false },
      { label: 'Working on it', color: '#fdab3d', order_index: 1, is_done_state: false },
      { label: 'Stuck', color: '#e2445c', order_index: 2, is_done_state: false },
      { label: 'Done', color: '#00c875', order_index: 3, is_done_state: true },
      { label: 'Needs Attention', color: '#ff642e', order_index: 4, is_done_state: false }
    ];

    // Atomic: existence check + 5x INSERT + audit event all commit together so
    // a mid-loop failure can't leave a board partially initialized (e.g. 3 of
    // 5 labels seeded), which would block a retry on the "already initialized"
    // guard. The existence check moves inside the transaction to also close
    // the TOCTOU race between two concurrent init requests.
    const db = await getClient();
    let insertedLabels;
    let eventPayload;
    try {
      await db.query('BEGIN');
      // Serialize concurrent init per board: lock the board row so a second
      // request blocks here until the first commits, closing the TOCTOU race
      // (task_board_status_labels has no unique (board_id, label) constraint,
      // so without this lock two requests could both seed duplicate defaults).
      await db.query('SELECT 1 FROM task_boards WHERE id = $1 FOR UPDATE', [boardId]);
      const { rows: existing } = await db.query(
        'SELECT COUNT(*) FROM task_board_status_labels WHERE board_id = $1',
        [boardId]
      );
      if (Number(existing[0].count) > 0) {
        await db.query('ROLLBACK');
        return res.status(400).json({ message: 'Status labels already initialized for this board' });
      }
      insertedLabels = [];
      for (const d of defaults) {
        const { rows } = await db.query(
          `INSERT INTO task_board_status_labels (board_id, label, color, order_index, is_done_state)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [boardId, d.label, d.color, d.order_index, d.is_done_state]
        );
        insertedLabels.push(rows[0]);
      }
      eventPayload = {
        event_type: 'status_label.batch_initialized',
        workspace_id: workspaceId,
        board_id: boardId,
        entity_type: 'status_label',
        entity_id: boardId,
        actor_id: req.user.id,
        new_value: { labels: insertedLabels.map(l => ({ id: l.id, label: l.label })) },
        metadata: { count: insertedLabels.length }
      };
      await persistTaskEventInTx(db, eventPayload);
      await db.query('COMMIT');
    } catch (txErr) {
      try { await db.query('ROLLBACK'); } catch { /* noop */ }
      throw txErr;
    } finally {
      db.release();
    }
    fireTaskEventSubscribers(eventPayload);
    return res.status(201).json({ status_labels: insertedLabels });
  } catch (err) {
    console.error('[tasks:status-labels:init]', err);
    return res.status(500).json({ message: 'Unable to initialize status labels' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL LABELS (workspace-scoped, cross-board)
// ─────────────────────────────────────────────────────────────────────────────

// Get all label definitions for a workspace
router.get('/labels', async (req, res) => {
  try {
    const workspaceId = req.query.workspace_id;
    if (!workspaceId) return res.status(400).json({ error: 'workspace_id required' });
    const ok = await assertWorkspaceAccess({ effRole: getEffectiveRole(req), userId: req.user.id, workspaceId });
    if (!ok) return res.status(403).json({ error: 'Insufficient permissions' });
    const { limit, offset } = parsePagination(req.query);
    const [{ rows }, { rows: countRows }] = await Promise.all([
      query(
        `SELECT * FROM task_label_definitions
         WHERE workspace_id = $1
         ORDER BY category, order_index
         LIMIT $2 OFFSET $3`,
        [workspaceId, limit, offset]
      ),
      query(
        'SELECT COUNT(*)::int AS total FROM task_label_definitions WHERE workspace_id = $1',
        [workspaceId]
      )
    ]);
    res.json({ labels: rows, meta: { limit, offset, total: countRows[0]?.total ?? rows.length } });
  } catch (err) {
    console.error('[tasks] GET /labels error:', err.message);
    res.status(500).json({ error: 'Failed to fetch labels' });
  }
});

// Create a new label definition
router.post('/labels', async (req, res) => {
  try {
    const { workspace_id, category, label, color, icon, is_exclusive } = req.body;
    if (!workspace_id || !category || !label || !color) {
      return res.status(400).json({ error: 'workspace_id, category, label, and color are required' });
    }
    const ok = await assertWorkspaceAccess({ effRole: getEffectiveRole(req), userId: req.user.id, workspaceId: workspace_id });
    if (!ok) return res.status(403).json({ error: 'Insufficient permissions' });
    const { rows } = await query(
      `INSERT INTO task_label_definitions (workspace_id, category, label, color, icon, is_exclusive, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [workspace_id, category, label, color, icon || null, is_exclusive || false, req.user.id]
    );
    res.status(201).json({ label: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Label already exists in this category' });
    console.error('[tasks] POST /labels error:', err.message);
    res.status(500).json({ error: 'Failed to create label' });
  }
});

// Update a label definition
router.patch('/labels/:labelId', async (req, res) => {
  try {
    const { labelId } = req.params;
    const { label, color, icon, order_index } = req.body;
    // Workspace access check via label's workspace
    const { rows: labelCheck } = await query('SELECT workspace_id FROM task_label_definitions WHERE id = $1', [labelId]);
    if (!labelCheck.length) return res.status(404).json({ error: 'Label not found' });
    const ok = await assertWorkspaceAccess({ effRole: getEffectiveRole(req), userId: req.user.id, workspaceId: labelCheck[0].workspace_id });
    if (!ok) return res.status(403).json({ error: 'Insufficient permissions' });
    const fields = [];
    const values = [];
    let i = 1;
    if (label !== undefined) { fields.push(`label = $${i++}`); values.push(label); }
    if (color !== undefined) { fields.push(`color = $${i++}`); values.push(color); }
    if (icon !== undefined) { fields.push(`icon = $${i++}`); values.push(icon); }
    if (order_index !== undefined) { fields.push(`order_index = $${i++}`); values.push(order_index); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    values.push(labelId);
    const { rows } = await query(
      `UPDATE task_label_definitions SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Label not found' });
    res.json({ label: rows[0] });
  } catch (err) {
    console.error('[tasks] PATCH /labels error:', err.message);
    res.status(500).json({ error: 'Failed to update label' });
  }
});

// Delete a label definition (blocked if is_system)
router.delete('/labels/:labelId', async (req, res) => {
  try {
    const { labelId } = req.params;
    // Check if system label + workspace access
    const { rows: check } = await query('SELECT is_system, workspace_id FROM task_label_definitions WHERE id = $1', [labelId]);
    if (check.length === 0) return res.status(404).json({ error: 'Label not found' });
    const delOk = await assertWorkspaceAccess({ effRole: getEffectiveRole(req), userId: req.user.id, workspaceId: check[0].workspace_id });
    if (!delOk) return res.status(403).json({ error: 'Insufficient permissions' });
    if (check[0].is_system) return res.status(403).json({ error: 'Cannot delete system labels' });
    // Remove all item associations first
    await query('DELETE FROM task_item_labels WHERE label_id = $1', [labelId]);
    await query('DELETE FROM task_label_definitions WHERE id = $1', [labelId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks] DELETE /labels error:', err.message);
    res.status(500).json({ error: 'Failed to delete label' });
  }
});

// Get labels applied to an item
router.get('/items/:itemId/labels', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { rows } = await query(
      `SELECT ld.*, il.applied_by, il.applied_at
       FROM task_item_labels il
       JOIN task_label_definitions ld ON ld.id = il.label_id
       WHERE il.item_id = $1
       ORDER BY ld.category, ld.order_index`,
      [itemId]
    );
    res.json({ labels: rows });
  } catch (err) {
    console.error('[tasks] GET /items/:id/labels error:', err.message);
    res.status(500).json({ error: 'Failed to fetch item labels' });
  }
});

// Apply a label to an item (handles exclusivity)
router.post('/items/:itemId/labels', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { label_id } = req.body;
    if (!label_id) return res.status(400).json({ error: 'label_id required' });

    // Get label definition
    const { rows: labelDef } = await query('SELECT * FROM task_label_definitions WHERE id = $1', [label_id]);
    if (labelDef.length === 0) return res.status(404).json({ error: 'Label not found' });
    const lbl = labelDef[0];

    // If exclusive category, remove existing labels in same category for this item
    if (lbl.is_exclusive) {
      await query(
        `DELETE FROM task_item_labels
         WHERE item_id = $1 AND label_id IN (
           SELECT id FROM task_label_definitions
           WHERE workspace_id = $2 AND category = $3
         )`,
        [itemId, lbl.workspace_id, lbl.category]
      );
    }

    // Apply label
    const { rows } = await query(
      `INSERT INTO task_item_labels (item_id, label_id, applied_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (item_id, label_id) DO NOTHING
       RETURNING *`,
      [itemId, label_id, req.user.id]
    );

    // Emit event for automation triggers
    if (EVENT_BUS_ENABLED) {
      try {
        const ctx = await resolveItemContext(itemId);
        emitTaskEvent({
          event_type: 'label.added',
          entity_type: 'item_label',
          entity_id: itemId,
          actor_id: req.user.id,
          workspace_id: ctx.workspace_id,
          board_id: ctx.board_id,
          item_id: itemId,
          old_value: null,
          new_value: { label_id: lbl.id, category: lbl.category, label: lbl.label },
          metadata: { label_definition: lbl }
        });
      } catch (e) { /* event bus best-effort */ }
    }

    res.status(201).json({ ok: true, applied: rows[0] || null });
  } catch (err) {
    console.error('[tasks] POST /items/:id/labels error:', err.message);
    res.status(500).json({ error: 'Failed to apply label' });
  }
});

// Remove a label from an item
router.delete('/items/:itemId/labels/:labelId', async (req, res) => {
  try {
    const { itemId, labelId } = req.params;

    // Get label info for event
    const { rows: labelDef } = await query('SELECT * FROM task_label_definitions WHERE id = $1', [labelId]);
    const lbl = labelDef[0] || {};

    await query('DELETE FROM task_item_labels WHERE item_id = $1 AND label_id = $2', [itemId, labelId]);

    // Emit event
    if (EVENT_BUS_ENABLED) {
      try {
        const ctx = await resolveItemContext(itemId);
        emitTaskEvent({
          event_type: 'label.removed',
          entity_type: 'item_label',
          entity_id: itemId,
          actor_id: req.user.id,
          workspace_id: ctx.workspace_id,
          board_id: ctx.board_id,
          item_id: itemId,
          old_value: { label_id: lbl.id, category: lbl.category, label: lbl.label },
          new_value: null,
          metadata: { label_definition: lbl }
        });
      } catch (e) { /* event bus best-effort */ }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks] DELETE /items/:id/labels/:labelId error:', err.message);
    res.status(500).json({ error: 'Failed to remove label' });
  }
});

router.post('/reports/boards', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  try {
    const payload = bulkBoardReportSchema.parse(req.body);
    const boardIds = payload.board_ids;
    const startDate = payload.start_date ? `${payload.start_date}T00:00:00.000Z` : null;
    const endDate = payload.end_date ? `${payload.end_date}T23:59:59.999Z` : null;

    // Ensure requester can access each board's workspace (team/staff are implicit).
    const { rows: boardRows } = await query(
      `SELECT b.id, b.name, b.workspace_id, w.name AS workspace_name
       FROM task_boards b
       JOIN task_workspaces w ON w.id = b.workspace_id
       WHERE b.id = ANY($1)`,
      [boardIds]
    );
    if (!boardRows.length) return res.json({ rows: [] });
    for (const b of boardRows) {
      const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId: b.workspace_id });
      if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    }

    const { rows: itemAgg } = await query(
      `SELECT
         b.id AS board_id,
         COUNT(i.*)::int AS total_items,
         SUM(CASE WHEN COALESCE(sl.is_done_state, FALSE) = TRUE THEN 1 ELSE 0 END)::int AS done,
         SUM(CASE WHEN COALESCE(sl.is_done_state, FALSE) = FALSE THEN 1 ELSE 0 END)::int AS open,
         SUM(CASE WHEN i.needs_attention = TRUE THEN 1 ELSE 0 END)::int AS needs_attention_flag,
         SUM(CASE WHEN i.is_voicemail = TRUE THEN 1 ELSE 0 END)::int AS voicemail,
         SUM(CASE WHEN $2::timestamptz IS NOT NULL AND $3::timestamptz IS NOT NULL AND i.updated_at BETWEEN $2 AND $3 THEN 1 ELSE 0 END)::int AS items_updated_in_range,
         SUM(CASE WHEN $2::timestamptz IS NOT NULL AND $3::timestamptz IS NOT NULL AND i.created_at BETWEEN $2 AND $3 THEN 1 ELSE 0 END)::int AS items_created_in_range
       FROM task_boards b
       JOIN task_groups g ON g.board_id = b.id
       JOIN task_items i ON i.group_id = g.id
       LEFT JOIN task_board_status_labels sl ON sl.board_id = b.id AND sl.label = i.status
       WHERE b.id = ANY($1)
         AND ${activeOnly('i')}
       GROUP BY b.id`,
      [boardIds, startDate, endDate]
    );

    const { rows: updatesAgg } = await query(
      `SELECT
         b.id AS board_id,
         COUNT(u.*)::int AS updates_in_range
       FROM task_boards b
       JOIN task_groups g ON g.board_id = b.id
       JOIN task_items i ON i.group_id = g.id
       JOIN task_updates u ON u.item_id = i.id
       WHERE b.id = ANY($1)
         AND ${activeOnly('i')}
         AND ($2::timestamptz IS NULL OR u.created_at >= $2)
         AND ($3::timestamptz IS NULL OR u.created_at <= $3)
       GROUP BY b.id`,
      [boardIds, startDate, endDate]
    );

    const { rows: timeAgg } = await query(
      `SELECT
         b.id AS board_id,
         COALESCE(SUM(t.time_spent_minutes), 0)::int AS time_minutes_in_range
       FROM task_boards b
       JOIN task_groups g ON g.board_id = b.id
       JOIN task_items i ON i.group_id = g.id
       JOIN task_time_entries t ON t.item_id = i.id
       WHERE b.id = ANY($1)
         AND ${activeOnly('i')}
         AND ($2::timestamptz IS NULL OR t.created_at >= $2)
         AND ($3::timestamptz IS NULL OR t.created_at <= $3)
       GROUP BY b.id`,
      [boardIds, startDate, endDate]
    );

    const updatesMap = Object.fromEntries(updatesAgg.map((r) => [r.board_id, r]));
    const timeMap = Object.fromEntries(timeAgg.map((r) => [r.board_id, r]));
    const itemMap = Object.fromEntries(itemAgg.map((r) => [r.board_id, r]));

    const rowsOut = boardRows.map((b) => {
      const items = itemMap[b.id] || {};
      const updates = updatesMap[b.id] || {};
      const time = timeMap[b.id] || {};
      return {
        board_id: b.id,
        board_name: b.name,
        workspace_name: b.workspace_name,
        ...items,
        updates_in_range: Number(updates.updates_in_range || 0),
        time_minutes_in_range: Number(time.time_minutes_in_range || 0)
      };
    });

    return res.json({ rows: rowsOut });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:reports:boards]', err);
    return res.status(500).json({ message: 'Unable to run report' });
  }
});

// Billing report - item-level time entries for selected boards within date range
router.post('/reports/billing', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  try {
    const payload = bulkBoardReportSchema.parse(req.body);
    const boardIds = payload.board_ids;
    const startDate = payload.start_date ? `${payload.start_date}T00:00:00.000Z` : null;
    const endDate = payload.end_date ? `${payload.end_date}T23:59:59.999Z` : null;

    // Ensure requester can access each board's workspace
    const { rows: boardRows } = await query(
      `SELECT b.id, b.name, b.workspace_id, w.name AS workspace_name
       FROM task_boards b
       JOIN task_workspaces w ON w.id = b.workspace_id
       WHERE b.id = ANY($1)`,
      [boardIds]
    );
    if (!boardRows.length) return res.json({ items: [] });
    for (const b of boardRows) {
      const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId: b.workspace_id });
      if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    }

    // Get all items from selected boards
    const { rows: items } = await query(
      `SELECT
         i.id AS item_id,
         i.name AS item_name,
         i.status,
         to_char(i.due_date, 'YYYY-MM-DD') AS due_date,
         g.name AS group_name,
         b.id AS board_id,
         b.name AS board_name,
         w.name AS workspace_name
       FROM task_items i
       JOIN task_groups g ON g.id = i.group_id
       JOIN task_boards b ON b.id = g.board_id
       JOIN task_workspaces w ON w.id = b.workspace_id
       WHERE b.id = ANY($1)
         AND ${activeOnly('i')}
       ORDER BY w.name, b.name, g.name, i.name`,
      [boardIds]
    );

    // Get time entries for these items within date range
    const itemIds = items.map((i) => i.item_id);
    let timeEntries = [];
    if (itemIds.length) {
      let timeQuery = `
        SELECT
          t.id AS entry_id,
          t.item_id,
          t.time_spent_minutes,
          t.billable_minutes,
          t.is_billable,
          t.work_category,
          t.description,
          t.created_at,
          COALESCE(u.first_name || ' ' || u.last_name, u.email, 'Unknown') AS user_name
        FROM task_time_entries t
        LEFT JOIN users u ON u.id = t.user_id
        WHERE t.item_id = ANY($1)
      `;
      const params = [itemIds];
      if (startDate) {
        timeQuery += ` AND t.created_at >= $${params.length + 1}`;
        params.push(startDate);
      }
      if (endDate) {
        timeQuery += ` AND t.created_at <= $${params.length + 1}`;
        params.push(endDate);
      }
      timeQuery += ' ORDER BY t.created_at DESC';
      const { rows } = await query(timeQuery, params);
      timeEntries = rows;
    }

    // Group time entries by item
    const timeByItem = {};
    for (const t of timeEntries) {
      if (!timeByItem[t.item_id]) timeByItem[t.item_id] = [];
      timeByItem[t.item_id].push(t);
    }

    // Build final rows: one row per item with aggregated time info
    const output = items.map((item) => {
      const entries = timeByItem[item.item_id] || [];
      const totalMinutes = entries.reduce((sum, e) => sum + (e.time_spent_minutes || 0), 0);
      const billableMinutes = entries.reduce((sum, e) => sum + (e.billable_minutes || 0), 0);
      return {
        ...item,
        time_entries: entries,
        total_minutes: totalMinutes,
        billable_minutes: billableMinutes,
        entry_count: entries.length
      };
    });

    // Filter to only items with time entries in range (for billing relevance)
    const filtered = output.filter((r) => r.entry_count > 0);

    return res.json({ items: filtered });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:reports:billing]', err);
    return res.status(500).json({ message: 'Unable to run billing report' });
  }
});

// Board view (board + groups + items)
router.get('/boards/:boardId/view', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { boardId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForBoard(boardId);
    if (!workspaceId) return res.status(404).json({ message: 'Board not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const boardRes = await query('SELECT * FROM task_boards WHERE id = $1', [boardId]);
    const groupsRes = await query(
      `SELECT *
       FROM task_groups
       WHERE board_id = $1
       ORDER BY order_index ASC, name ASC`,
      [boardId]
    );
    // Pagination params (backward-compatible defaults)
    const limit = Math.max(1, Math.min(2000, parseInt(req.query.limit, 10) || 500));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    // includeArchived: admin/superadmin opt-in to surface soft-deleted items
    // (e.g. for the "Archived items" review/restore view). Default is to filter
    // archived_at IS NULL so regular users never see soft-deleted rows.
    const includeArchived = req.query.includeArchived === 'true';
    if (includeArchived && eff !== 'superadmin' && eff !== 'admin') {
      return res.status(403).json({ message: 'Admin role required to view archived items' });
    }
    const [itemsRes, countRes] = await Promise.all([
      query(
        `SELECT i.*
         FROM task_items i
         JOIN task_groups g ON g.id = i.group_id
         WHERE g.board_id = $1
           AND ($4::boolean OR i.archived_at IS NULL)
         ORDER BY i.updated_at DESC, i.created_at DESC
         LIMIT $2 OFFSET $3`,
        [boardId, limit, offset, includeArchived]
      ),
      query(
        `SELECT COUNT(*)::int AS total
         FROM task_items i
         JOIN task_groups g ON g.id = i.group_id
         WHERE g.board_id = $1
           AND ($2::boolean OR i.archived_at IS NULL)`,
        [boardId, includeArchived]
      )
    ]);
    const totalItems = countRes.rows[0]?.total || 0;
    const itemIds = itemsRes.rows.map((r) => r.id);

    let assigneesByItem = {};
    let timeTotalsByItem = {};
    let updateCountsByItem = {};

    if (itemIds.length) {
      const { rows: assigneeRows } = await query(
        `SELECT a.item_id, u.id AS user_id, u.email, u.first_name, u.last_name, u.avatar_url
         FROM task_item_assignees a
         JOIN users u ON u.id = a.user_id
         WHERE a.item_id = ANY($1)
         ORDER BY u.email ASC`,
        [itemIds]
      );
      for (const r of assigneeRows) {
        if (!assigneesByItem[r.item_id]) assigneesByItem[r.item_id] = [];
        assigneesByItem[r.item_id].push({
          user_id: r.user_id,
          email: r.email,
          first_name: r.first_name,
          last_name: r.last_name,
          avatar_url: r.avatar_url
        });
      }

      const { rows: timeRows } = await query(
        `SELECT item_id, SUM(time_spent_minutes)::int AS total_minutes
         FROM task_time_entries
         WHERE item_id = ANY($1)
         GROUP BY item_id`,
        [itemIds]
      );
      for (const r of timeRows) {
        timeTotalsByItem[r.item_id] = Number(r.total_minutes || 0);
      }

      const { rows: updateRows } = await query(
        `SELECT item_id, COUNT(*)::int AS update_count
         FROM task_updates
         WHERE item_id = ANY($1)
         GROUP BY item_id`,
        [itemIds]
      );
      for (const r of updateRows) {
        updateCountsByItem[r.item_id] = Number(r.update_count || 0);
      }
    }

    // Fetch status labels for this board
    const [{ rows: statusLabels }, { rows: globalLabels }] = await Promise.all([
      query(
        `SELECT * FROM task_board_status_labels
         WHERE board_id = $1
         ORDER BY order_index ASC, label ASC`,
        [boardId]
      ),
      query(
        `SELECT * FROM task_global_status_labels
         ORDER BY order_index ASC, label ASC`,
        []
      )
    ]);

    const mergedLabels = [];
    const seen = new Map();
    for (const r of globalLabels) {
      const key = String(r.label || '').trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.set(key, mergedLabels.length);
      mergedLabels.push({ ...r, is_global: true });
    }
    for (const r of statusLabels) {
      const key = String(r.label || '').trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) {
        mergedLabels[seen.get(key)] = { ...r, is_global: false };
      } else {
        seen.set(key, mergedLabels.length);
        mergedLabels.push({ ...r, is_global: false });
      }
    }

    // If no custom labels, return default labels
    const defaultLabels = [
      { id: 'default-todo', label: 'To Do', color: '#808080', order_index: 0, is_done_state: false },
      { id: 'default-working', label: 'Working on it', color: '#fdab3d', order_index: 1, is_done_state: false },
      { id: 'default-stuck', label: 'Stuck', color: '#e2445c', order_index: 2, is_done_state: false },
      { id: 'default-done', label: 'Done', color: '#00c875', order_index: 3, is_done_state: true },
      { id: 'default-needs-attention', label: 'Needs Attention', color: '#ff642e', order_index: 4, is_done_state: false }
    ];

    return res.json({
      board: boardRes.rows[0],
      groups: groupsRes.rows,
      items: itemsRes.rows,
      assignees_by_item: assigneesByItem,
      time_totals_by_item: timeTotalsByItem,
      update_counts_by_item: updateCountsByItem,
      status_labels: mergedLabels.length ? mergedLabels : defaultLabels,
      pagination: { total: totalItems, limit, offset, has_more: offset + limit < totalItems }
    });
  } catch (err) {
    console.error('[tasks:boards:view]', err);
    return res.status(500).json({ message: 'Unable to load board' });
  }
});

// Groups
router.post('/boards/:boardId/groups', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { boardId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForBoard(boardId);
    if (!workspaceId) return res.status(404).json({ message: 'Board not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const payload = groupCreateSchema.parse(req.body);
    const { rows } = await query(
      `INSERT INTO task_groups (board_id, name, order_index)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [boardId, payload.name.trim(), payload.order_index ?? 0]
    );
    emitTaskEvent({
      event_type: 'group.created',
      workspace_id: workspaceId,
      board_id: boardId,
      entity_type: 'group',
      entity_id: rows[0].id,
      actor_id: req.user.id,
      new_value: { name: rows[0].name }
    });
    return res.status(201).json({ group: rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:groups:create]', err);
    return res.status(500).json({ message: 'Unable to create group' });
  }
});

// Delete a group (cascades items)
router.patch('/groups/:groupId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { groupId } = req.params;
  const { name, order_index } = req.body;
  if (!name && order_index === undefined) {
    return res.status(400).json({ message: 'name or order_index required' });
  }
  try {
    const workspaceId = await getWorkspaceIdForGroup(groupId);
    if (!workspaceId) return res.status(404).json({ message: 'Group not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const sets = [];
    const vals = [];
    let idx = 1;
    if (name) { sets.push(`name = $${idx++}`); vals.push(String(name).trim()); }
    if (order_index !== undefined) { sets.push(`order_index = $${idx++}`); vals.push(Number(order_index)); }
    vals.push(groupId);

    const { rows: [updated] } = await query(
      `UPDATE task_groups SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    return res.json({ group: updated });
  } catch (err) {
    console.error('[tasks:groups:update]', err);
    return res.status(500).json({ message: 'Unable to update group' });
  }
});

router.delete('/groups/:groupId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { groupId } = req.params;
  if (eff !== 'superadmin' && eff !== 'admin') {
    return res.status(403).json({ message: 'Insufficient permissions' });
  }
  try {
    const workspaceId = await getWorkspaceIdForGroup(groupId);
    if (!workspaceId) return res.status(404).json({ message: 'Group not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    const boardId = await getBoardIdForGroup(groupId);
    await query('DELETE FROM task_groups WHERE id = $1', [groupId]);
    emitTaskEvent({
      event_type: 'group.deleted',
      workspace_id: workspaceId,
      board_id: boardId,
      entity_type: 'group',
      entity_id: groupId,
      actor_id: req.user.id
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[tasks:groups:delete]', err);
    return res.status(500).json({ message: 'Unable to delete group' });
  }
});

// Items
router.post('/groups/:groupId/items', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { groupId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForGroup(groupId);
    if (!workspaceId) return res.status(404).json({ message: 'Group not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const payload = itemCreateSchema.parse(req.body);

    const applyBoardPrefix = (prefix, rawName) => {
      const p = String(prefix || '').trim();
      const n = String(rawName || '').trim();
      if (!p) return n;
      const lowerP = p.toLowerCase();
      const lowerN = n.toLowerCase();
      if (lowerN === lowerP) return n;
      if (lowerN.startsWith(lowerP)) {
        // already prefixed (allow common separators)
        const nextChar = lowerN.slice(lowerP.length, lowerP.length + 2);
        if (!nextChar || nextChar.startsWith(' ') || nextChar.startsWith('-') || nextChar.startsWith(':')) return n;
      }
      return `${p} ${n}`.trim();
    };

    // If the board has a prefix configured, prepend it to the item name.
    let finalName = payload.name.trim();
    try {
      const { rows: bpRows } = await query(
        `SELECT b.board_prefix
         FROM task_boards b
         JOIN task_groups g ON g.board_id = b.id
         WHERE g.id = $1
         LIMIT 1`,
        [groupId]
      );
      finalName = applyBoardPrefix(bpRows[0]?.board_prefix, finalName);
    } catch (_err) {
      // non-fatal: fallback to raw name
    }

    // Run the item INSERT + task_events INSERT in one transaction so the
    // audit trail can't drift from the row that was created. Bus subscribers
    // fire after COMMIT so they don't run on a rolled-back insert.
    const db = await getClient();
    let createdItem;
    let boardId;
    let eventPayload;
    try {
      await db.query('BEGIN');
      const { rows } = await db.query(
        `INSERT INTO task_items (group_id, name, status, due_date, is_voicemail, needs_attention, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          groupId,
          finalName,
          payload.status ?? 'To Do',
          payload.due_date ?? null,
          payload.is_voicemail ?? false,
          payload.needs_attention ?? false,
          req.user.id
        ]
      );
      createdItem = rows[0];

      const { rows: boardRows } = await db.query(
        `SELECT board_id FROM task_groups WHERE id = $1`,
        [groupId]
      );
      boardId = boardRows[0]?.board_id || null;

      eventPayload = {
        event_type: 'item.created',
        workspace_id: workspaceId,
        board_id: boardId,
        item_id: createdItem.id,
        entity_type: 'item',
        entity_id: createdItem.id,
        actor_id: req.user.id,
        new_value: { name: createdItem.name, status: createdItem.status, due_date: createdItem.due_date }
      };
      await persistTaskEventInTx(db, eventPayload);

      await db.query('COMMIT');
    } catch (txErr) {
      try { await db.query('ROLLBACK'); } catch { /* noop */ }
      throw txErr;
    } finally {
      db.release();
    }

    // Post-commit: fire in-process subscribers and best-effort activity log.
    // Both are intentionally non-blocking — the audit row is already durable
    // and downstream subscribers shouldn't reach back into the response path.
    fireTaskEventSubscribers(eventPayload);
    if (!EVENT_BUS_ENABLED) {
      logTaskActivity({
        userId: req.user.id,
        actionType: ActivityEventTypes.CREATE_TASK,
        taskId: createdItem.id,
        taskName: finalName,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }).catch((logErr) => console.error('[tasks:items:create:activity]', logErr?.message));
    }

    return res.status(201).json({ item: createdItem });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:items:create]', err);
    return res.status(500).json({ message: 'Unable to create item' });
  }
});

router.patch('/items/:itemId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { itemId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForItem(itemId);
    if (!workspaceId) return res.status(404).json({ message: 'Item not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const beforeRes = await query('SELECT * FROM task_items WHERE id = $1', [itemId]);
    const itemBefore = beforeRes.rows[0] || null;
    if (itemBefore?.archived_at) {
      return res.status(400).json({ message: 'Item is archived' });
    }

    const payload = itemUpdateSchema.parse(req.body);
    const fields = [];
    const values = [];
    let i = 1;
    if (payload.name !== undefined) {
      fields.push(`name = $${i++}`);
      values.push(payload.name.trim());
    }
    if (payload.status !== undefined) {
      fields.push(`status = $${i++}`);
      values.push(payload.status);
    }
    if (payload.due_date !== undefined) {
      fields.push(`due_date = $${i++}`);
      values.push(payload.due_date);
    }
    if (payload.start_date !== undefined) {
      fields.push(`start_date = $${i++}`);
      values.push(payload.start_date);
    }
    if (payload.is_voicemail !== undefined) {
      fields.push(`is_voicemail = $${i++}`);
      values.push(payload.is_voicemail);
    }
    if (payload.needs_attention !== undefined) {
      fields.push(`needs_attention = $${i++}`);
      values.push(payload.needs_attention);
    }
    if (!fields.length) return res.status(400).json({ message: 'No changes provided' });

    fields.push(`updated_at = NOW()`);
    values.push(itemId);
    const { rows } = await query(
      `UPDATE task_items
       SET ${fields.join(', ')}
       WHERE id = $${i}
       RETURNING *`,
      values
    );
    const itemAfter = rows[0];
    // Run automations asynchronously; don't block client response
    if (!EVENT_BUS_ENABLED) {
      runEventAutomationsForItemChange({ itemBefore, itemAfter, actorUserId: req.user.id }).catch((err) =>
        console.error('[tasks:automations:run:item-change]', err)
      );
    }

    // Log task update activity (check if status changed to completed)
    if (!EVENT_BUS_ENABLED) {
      const isNewDone = await isDoneStatus(itemAfter.status, itemBefore?.board_id);
      const wasOldDone = await isDoneStatus(itemBefore?.status, itemBefore?.board_id);
      const actionType = isNewDone && !wasOldDone
        ? ActivityEventTypes.COMPLETE_TASK
        : ActivityEventTypes.UPDATE_TASK;
      await logTaskActivity({
        userId: req.user.id,
        actionType,
        taskId: itemId,
        taskName: itemAfter.name,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { statusChanged: itemBefore?.status !== itemAfter.status, newStatus: itemAfter.status }
      });
    }

    // Emit fine-grained events based on what changed
    const { workspace_id: evtWorkspaceId, board_id: evtBoardId } = await resolveItemContext(itemId);
    const statusChanged = itemBefore.status !== itemAfter.status;
    const dueDateChanged = String(itemBefore.due_date || '') !== String(itemAfter.due_date || '');

    if (statusChanged) {
      emitTaskEvent({
        event_type: 'item.status_changed',
        workspace_id: evtWorkspaceId,
        board_id: evtBoardId,
        item_id: itemId,
        entity_type: 'item',
        entity_id: itemId,
        actor_id: req.user.id,
        old_value: { status: itemBefore.status, name: itemBefore.name },
        new_value: { status: itemAfter.status, name: itemAfter.name }
      });
      // If new status is a done state, also emit item.completed
      const itemIsDone = await isDoneStatus(itemAfter.status, evtBoardId);
      if (itemIsDone) {
        emitTaskEvent({
          event_type: 'item.completed',
          workspace_id: evtWorkspaceId,
          board_id: evtBoardId,
          item_id: itemId,
          entity_type: 'item',
          entity_id: itemId,
          actor_id: req.user.id,
          old_value: { status: itemBefore.status, name: itemBefore.name },
          new_value: { status: itemAfter.status, name: itemAfter.name },
          metadata: { is_done_state: true }
        });
      }
    }
    if (dueDateChanged) {
      emitTaskEvent({
        event_type: 'item.due_date_changed',
        workspace_id: evtWorkspaceId,
        board_id: evtBoardId,
        item_id: itemId,
        entity_type: 'item',
        entity_id: itemId,
        actor_id: req.user.id,
        old_value: { due_date: itemBefore.due_date },
        new_value: { due_date: itemAfter.due_date }
      });
    }
    if (!statusChanged && !dueDateChanged) {
      emitTaskEvent({
        event_type: 'item.updated',
        workspace_id: evtWorkspaceId,
        board_id: evtBoardId,
        item_id: itemId,
        entity_type: 'item',
        entity_id: itemId,
        actor_id: req.user.id,
        old_value: { name: itemBefore.name, needs_attention: itemBefore.needs_attention, is_voicemail: itemBefore.is_voicemail },
        new_value: { name: itemAfter.name, needs_attention: itemAfter.needs_attention, is_voicemail: itemAfter.is_voicemail }
      });
    }

    return res.json({ item: itemAfter });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:items:update]', err);
    return res.status(500).json({ message: 'Unable to update item' });
  }
});

// Archive (soft delete) an item (retained for 30 days, then purged by cron)
router.delete('/items/:itemId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { itemId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForItem(itemId);
    if (!workspaceId) return res.status(404).json({ message: 'Item not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    // Get task name before archiving for logging
    const { rows: taskInfo } = await query('SELECT name FROM task_items WHERE id = $1', [itemId]);

    const { rows } = await query(
      `UPDATE task_items
       SET archived_at = COALESCE(archived_at, NOW()),
           archived_by = COALESCE(archived_by, $2),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, archived_at`,
      [itemId, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Item not found' });

    // Log task delete activity
    if (!EVENT_BUS_ENABLED) {
      await logTaskActivity({
        userId: req.user.id,
        actionType: ActivityEventTypes.DELETE_TASK,
        taskId: itemId,
        taskName: taskInfo[0]?.name,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
    }

    const { workspace_id: archWsId, board_id: archBoardId } = await resolveItemContext(itemId);
    emitTaskEvent({
      event_type: 'item.archived',
      workspace_id: archWsId,
      board_id: archBoardId,
      item_id: itemId,
      entity_type: 'item',
      entity_id: itemId,
      actor_id: req.user.id,
      old_value: { name: taskInfo[0]?.name }
    });
    return res.json({ ok: true, archived_at: rows[0].archived_at });
  } catch (err) {
    console.error('[tasks:items:archive]', err);
    return res.status(500).json({ message: 'Unable to archive item' });
  }
});

// Restore an archived item (within retention window)
router.post('/items/:itemId/restore', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { itemId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForItem(itemId);
    if (!workspaceId) return res.status(404).json({ message: 'Item not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const { rows } = await query(
      `UPDATE task_items
       SET archived_at = NULL,
           archived_by = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [itemId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Item not found' });
    const { workspace_id: restWsId, board_id: restBoardId } = await resolveItemContext(itemId);
    emitTaskEvent({
      event_type: 'item.restored',
      workspace_id: restWsId,
      board_id: restBoardId,
      item_id: itemId,
      entity_type: 'item',
      entity_id: itemId,
      actor_id: req.user.id,
      new_value: { name: rows[0].name, status: rows[0].status }
    });
    return res.json({ item: rows[0] });
  } catch (err) {
    console.error('[tasks:items:restore]', err);
    return res.status(500).json({ message: 'Unable to restore item' });
  }
});

// Automations (board-scoped)
router.get('/boards/:boardId/automations', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { boardId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForBoard(boardId);
    if (!workspaceId) return res.status(404).json({ message: 'Board not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    const includeArchived = req.query.includeArchived === 'true';
    if (includeArchived && eff !== 'superadmin' && eff !== 'admin') {
      return res.status(403).json({ message: 'Admin role required to view archived automations' });
    }
    const { rows } = await query(
      `SELECT *
       FROM task_board_automations
       WHERE board_id = $1
         AND ($2::boolean OR archived_at IS NULL)
       ORDER BY created_at DESC`,
      [boardId, includeArchived]
    );
    return res.json({ automations: rows });
  } catch (err) {
    console.error('[tasks:automations:list]', err);
    return res.status(500).json({ message: 'Unable to load automations' });
  }
});

router.post('/boards/:boardId/automations', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { boardId } = req.params;
  if (eff !== 'superadmin' && eff !== 'admin') return res.status(403).json({ message: 'Insufficient permissions' });
  try {
    const workspaceId = await getWorkspaceIdForBoard(boardId);
    if (!workspaceId) return res.status(404).json({ message: 'Board not found' });

    const payload = automationCreateSchema.parse(req.body);
    validateAutomationPayload(payload);

    // Atomic: automation INSERT + task_events INSERT in one transaction so
    // every persisted automation row has a matching audit event.
    const db = await getClient();
    let createdAutomation;
    let eventPayload;
    try {
      await db.query('BEGIN');
      const { rows } = await db.query(
        `INSERT INTO task_board_automations (board_id, name, trigger_type, trigger_config, action_type, action_config, is_active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          boardId,
          payload.name.trim(),
          payload.trigger_type,
          JSON.stringify(payload.trigger_config || {}),
          payload.action_type,
          JSON.stringify(payload.action_config || {}),
          payload.is_active !== undefined ? payload.is_active : true,
          req.user.id
        ]
      );
      createdAutomation = rows[0];
      eventPayload = {
        event_type: 'automation.created',
        workspace_id: workspaceId,
        board_id: boardId,
        entity_type: 'automation',
        entity_id: createdAutomation.id,
        actor_id: req.user.id,
        new_value: { name: createdAutomation.name, trigger_type: createdAutomation.trigger_type, action_type: createdAutomation.action_type },
        metadata: { scope: 'board' }
      };
      await persistTaskEventInTx(db, eventPayload);
      await db.query('COMMIT');
    } catch (txErr) {
      try { await db.query('ROLLBACK'); } catch { /* noop */ }
      throw txErr;
    } finally {
      db.release();
    }

    // Post-commit fan-out. logSecurityEvent has its own internal try/catch and
    // never throws — kept best-effort so audit log hiccups don't 500 the user.
    fireTaskEventSubscribers(eventPayload);
    logSecurityEvent({
      userId: req.user.id,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCESS,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: { action: 'automation_created', scope: 'board', automationId: createdAutomation.id, boardId, triggerType: createdAutomation.trigger_type, actionType: createdAutomation.action_type }
    }).catch((logErr) => console.error('[tasks:automations:create:security]', logErr?.message));

    return res.status(201).json({ automation: createdAutomation });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    if (String(err?.message || '').includes('trigger_config') || String(err?.message || '').includes('action_config')) {
      return res.status(400).json({ message: err.message });
    }
    console.error('[tasks:automations:create]', err);
    return res.status(500).json({ message: 'Unable to create automation' });
  }
});

router.patch('/automations/:automationId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { automationId } = req.params;
  if (eff !== 'superadmin' && eff !== 'admin') return res.status(403).json({ message: 'Insufficient permissions' });
  try {
    // Look up in board automations first, then global.
    const { rows: boardRows } = await query('SELECT * FROM task_board_automations WHERE id = $1', [automationId]);
    const boardRow = boardRows[0] || null;

    const { rows: globalRows } = boardRow ? { rows: [] } : await query('SELECT * FROM task_global_automations WHERE id = $1', [automationId]);
    const globalRow = globalRows[0] || null;

    const scope = boardRow ? 'board' : globalRow ? 'global' : null;
    const existing = boardRow || globalRow;
    if (!scope || !existing) return res.status(404).json({ message: 'Automation not found' });

    if (scope === 'board') {
      const workspaceId = await getWorkspaceIdForBoard(existing.board_id);
      if (!workspaceId) return res.status(404).json({ message: 'Board not found' });
      const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
      if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    }

    const payload = automationUpdateSchema.parse(req.body);
    const merged = {
      ...existing,
      ...payload,
      trigger_config: payload.trigger_config !== undefined ? payload.trigger_config : existing.trigger_config,
      action_config: payload.action_config !== undefined ? payload.action_config : existing.action_config
    };
    validateAutomationPayload(merged);

    const fields = [];
    const values = [];
    let i = 1;
    if (payload.name !== undefined) {
      fields.push(`name = $${i++}`);
      values.push(payload.name.trim());
    }
    if (payload.trigger_type !== undefined) {
      fields.push(`trigger_type = $${i++}`);
      values.push(payload.trigger_type);
    }
    if (payload.trigger_config !== undefined) {
      fields.push(`trigger_config = $${i++}`);
      values.push(JSON.stringify(payload.trigger_config || {}));
    }
    if (payload.action_type !== undefined) {
      fields.push(`action_type = $${i++}`);
      values.push(payload.action_type);
    }
    if (payload.action_config !== undefined) {
      fields.push(`action_config = $${i++}`);
      values.push(JSON.stringify(payload.action_config || {}));
    }
    if (payload.is_active !== undefined) {
      fields.push(`is_active = $${i++}`);
      values.push(payload.is_active);
    }
    if (payload.error_count !== undefined) {
      fields.push(`error_count = $${i++}`);
      values.push(payload.error_count);
    }
    if (payload.disabled_reason !== undefined) {
      fields.push(`disabled_reason = $${i++}`);
      values.push(payload.disabled_reason);
    }
    if (!fields.length) return res.status(400).json({ message: 'No changes provided' });

    values.push(automationId);
    const table = scope === 'board' ? 'task_board_automations' : 'task_global_automations';
    const { rows } = await query(
      `UPDATE ${table}
       SET ${fields.join(', ')}
       WHERE id = $${i}
       RETURNING *`,
      values
    );
    emitTaskEvent({
      event_type: 'automation.updated',
      workspace_id: scope === 'board' ? await getWorkspaceIdForBoard(existing.board_id) : undefined,
      board_id: existing.board_id || undefined,
      entity_type: 'automation',
      entity_id: automationId,
      actor_id: req.user.id,
      old_value: { name: existing.name, is_active: existing.is_active },
      new_value: { name: rows[0].name, is_active: rows[0].is_active },
      metadata: { scope }
    });
    await logSecurityEvent({
      userId: req.user.id,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCESS,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: { action: 'automation_updated', scope, automationId, changedFields: Object.keys(payload) }
    });
    return res.json({ automation: rows[0], scope });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    if (String(err?.message || '').includes('trigger_config') || String(err?.message || '').includes('action_config')) {
      return res.status(400).json({ message: err.message });
    }
    console.error('[tasks:automations:update]', err);
    return res.status(500).json({ message: 'Unable to update automation' });
  }
});

router.delete('/automations/:automationId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { automationId } = req.params;
  if (eff !== 'superadmin' && eff !== 'admin') return res.status(403).json({ message: 'Insufficient permissions' });
  try {
    const { rows: boardRows } = await query('SELECT * FROM task_board_automations WHERE id = $1', [automationId]);
    const boardRow = boardRows[0] || null;

    const { rows: globalRows } = boardRow ? { rows: [] } : await query('SELECT * FROM task_global_automations WHERE id = $1', [automationId]);
    const globalRow = globalRows[0] || null;

    const scope = boardRow ? 'board' : globalRow ? 'global' : null;
    const existing = boardRow || globalRow;
    if (!scope || !existing) return res.status(404).json({ message: 'Automation not found' });

    if (scope === 'board') {
      const workspaceId = await getWorkspaceIdForBoard(existing.board_id);
      if (!workspaceId) return res.status(404).json({ message: 'Board not found' });
      const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
      if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    }

    const table = scope === 'board' ? 'task_board_automations' : 'task_global_automations';
    // Soft delete: archive instead of hard delete (preserves audit trail)
    await query(`UPDATE ${table} SET archived_at = NOW(), is_active = FALSE WHERE id = $1`, [automationId]);
    emitTaskEvent({
      event_type: 'automation.deleted',
      workspace_id: scope === 'board' ? await getWorkspaceIdForBoard(existing.board_id) : undefined,
      board_id: existing.board_id || undefined,
      entity_type: 'automation',
      entity_id: automationId,
      actor_id: req.user.id,
      old_value: { name: existing.name },
      metadata: { scope }
    });
    await logSecurityEvent({
      userId: req.user.id,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCESS,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: { action: 'automation_archived', scope, automationId }
    });
    return res.json({ ok: true, scope });
  } catch (err) {
    console.error('[tasks:automations:delete]', err);
    return res.status(500).json({ message: 'Unable to delete automation' });
  }
});

// Global automations
router.get('/automations/global', async (req, res) => {
  const eff = getEffectiveRole(req);
  if (eff !== 'superadmin' && eff !== 'admin') return res.status(403).json({ message: 'Insufficient permissions' });
  try {
    const includeArchived = req.query.includeArchived === 'true';
    const { limit, offset } = parsePagination(req.query);
    const [{ rows }, { rows: countRows }] = await Promise.all([
      query(
        `SELECT *
         FROM task_global_automations
         WHERE ($1::boolean OR archived_at IS NULL)
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [includeArchived, limit, offset]
      ),
      query(
        `SELECT COUNT(*)::int AS total
         FROM task_global_automations
         WHERE ($1::boolean OR archived_at IS NULL)`,
        [includeArchived]
      )
    ]);
    return res.json({ automations: rows, meta: { limit, offset, total: countRows[0]?.total ?? rows.length } });
  } catch (err) {
    console.error('[tasks:automations:global:list]', err);
    return res.status(500).json({ message: 'Unable to load automations' });
  }
});

router.post('/automations/global', async (req, res) => {
  const eff = getEffectiveRole(req);
  if (eff !== 'superadmin' && eff !== 'admin') return res.status(403).json({ message: 'Insufficient permissions' });
  try {
    const payload = automationCreateSchema.parse(req.body);
    validateAutomationPayload(payload);

    // Atomic: automation INSERT + task_events INSERT in one transaction.
    const db = await getClient();
    let createdAutomation;
    let eventPayload;
    try {
      await db.query('BEGIN');
      const { rows } = await db.query(
        `INSERT INTO task_global_automations (name, trigger_type, trigger_config, action_type, action_config, is_active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          payload.name.trim(),
          payload.trigger_type,
          JSON.stringify(payload.trigger_config || {}),
          payload.action_type,
          JSON.stringify(payload.action_config || {}),
          payload.is_active !== undefined ? payload.is_active : true,
          req.user.id
        ]
      );
      createdAutomation = rows[0];
      eventPayload = {
        event_type: 'automation.created',
        entity_type: 'automation',
        entity_id: createdAutomation.id,
        actor_id: req.user.id,
        new_value: { name: createdAutomation.name, trigger_type: createdAutomation.trigger_type, action_type: createdAutomation.action_type },
        metadata: { scope: 'global' }
      };
      await persistTaskEventInTx(db, eventPayload);
      await db.query('COMMIT');
    } catch (txErr) {
      try { await db.query('ROLLBACK'); } catch { /* noop */ }
      throw txErr;
    } finally {
      db.release();
    }

    fireTaskEventSubscribers(eventPayload);
    logSecurityEvent({
      userId: req.user.id,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCESS,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: { action: 'automation_created', scope: 'global', automationId: createdAutomation.id, triggerType: createdAutomation.trigger_type, actionType: createdAutomation.action_type }
    }).catch((logErr) => console.error('[tasks:automations:global:create:security]', logErr?.message));

    return res.status(201).json({ automation: createdAutomation, scope: 'global' });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    if (String(err?.message || '').includes('trigger_config') || String(err?.message || '').includes('action_config')) {
      return res.status(400).json({ message: err.message });
    }
    console.error('[tasks:automations:global:create]', err);
    return res.status(500).json({ message: 'Unable to create automation' });
  }
});

// Execution log (recent)
router.get('/automations/runs', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { limit, offset } = parsePagination(req.query, { defaultLimit: 50 });
  const scope = String(req.query?.scope || '').trim(); // 'board'|'global'|''
  const boardId = String(req.query?.board_id || '').trim();
  try {
    if (scope === 'board' && boardId) {
      const workspaceId = await getWorkspaceIdForBoard(boardId);
      if (!workspaceId) return res.status(404).json({ message: 'Board not found' });
      const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
      if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    }
    // Global runs: staff-only route already; no extra check needed.
    const clauses = [];
    const filterParams = [];
    let i = 1;
    if (scope === 'board' || scope === 'global') {
      clauses.push(`scope = $${i++}`);
      filterParams.push(scope);
    }
    if (boardId) {
      clauses.push(`board_id = $${i++}`);
      filterParams.push(boardId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const listParams = [...filterParams, limit, offset];
    const [{ rows }, { rows: countRows }] = await Promise.all([
      query(
        `SELECT *
         FROM task_automation_runs
         ${where}
         ORDER BY ran_at DESC
         LIMIT $${i} OFFSET $${i + 1}`,
        listParams
      ),
      query(
        `SELECT COUNT(*)::int AS total FROM task_automation_runs ${where}`,
        filterParams
      )
    ]);
    return res.json({ runs: rows, meta: { limit, offset, total: countRows[0]?.total ?? rows.length } });
  } catch (err) {
    console.error('[tasks:automations:runs]', err);
    return res.status(500).json({ message: 'Unable to load automation runs' });
  }
});

// Reporting + export
router.get('/boards/:boardId/report', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { boardId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForBoard(boardId);
    if (!workspaceId) return res.status(404).json({ message: 'Board not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const { rows } = await query(
      `SELECT
         COUNT(*)::int AS total,
         SUM(CASE WHEN COALESCE(sl.is_done_state, FALSE) = TRUE THEN 1 ELSE 0 END)::int AS done,
         SUM(CASE WHEN COALESCE(sl.is_done_state, FALSE) = FALSE THEN 1 ELSE 0 END)::int AS open,
         SUM(CASE WHEN i.needs_attention = TRUE THEN 1 ELSE 0 END)::int AS needs_attention_flag,
         SUM(CASE WHEN i.is_voicemail = TRUE THEN 1 ELSE 0 END)::int AS voicemail,
         MAX(i.updated_at) AS last_updated_at
       FROM task_items i
       JOIN task_groups g ON g.id = i.group_id
       LEFT JOIN task_board_status_labels sl ON sl.board_id = g.board_id AND sl.label = i.status
       WHERE g.board_id = $1
         AND ${activeOnly('i')}`,
      [boardId]
    );

    return res.json({ report: rows[0] || null });
  } catch (err) {
    console.error('[tasks:report]', err);
    return res.status(500).json({ message: 'Unable to load report' });
  }
});

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

router.get('/boards/:boardId/export.csv', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { boardId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForBoard(boardId);
    if (!workspaceId) return res.status(404).json({ message: 'Board not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const { rows } = await query(
      `SELECT
         i.id,
         i.name,
         i.status,
         i.due_date,
         i.needs_attention,
         i.is_voicemail,
         i.created_at,
         i.updated_at,
         g.name AS group_name
       FROM task_items i
       JOIN task_groups g ON g.id = i.group_id
       WHERE g.board_id = $1
         AND ${activeOnly('i')}
       ORDER BY g.order_index ASC, i.updated_at DESC`,
      [boardId]
    );

    const header = ['id', 'name', 'status', 'due_date', 'needs_attention', 'is_voicemail', 'group_name', 'created_at', 'updated_at'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [
          csvEscape(r.id),
          csvEscape(r.name),
          csvEscape(r.status),
          csvEscape(r.due_date),
          csvEscape(r.needs_attention),
          csvEscape(r.is_voicemail),
          csvEscape(r.group_name),
          csvEscape(r.created_at),
          csvEscape(r.updated_at)
        ].join(',')
      );
    }

    // Audit log data export (HIPAA/SOC2 requirement)
    await logSecurityEvent({
      userId: req.user.id,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCESS,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: {
        action: 'data_export',
        exportType: 'task_board_csv',
        boardId,
        workspaceId,
        recordCount: rows.length
      }
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="board-${boardId}.csv"`);
    return res.send(lines.join('\n'));
  } catch (err) {
    console.error('[tasks:export]', err);
    return res.status(500).json({ message: 'Unable to export CSV' });
  }
});

// My Work - items assigned to current user, grouped by board
router.get('/my-work', async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows } = await query(
      `
        WITH my_items AS (
          SELECT
            i.id,
            i.name,
            i.status,
            i.due_date,
            i.needs_attention,
            i.is_voicemail,
            i.updated_at,
            g.board_id,
            b.name AS board_name,
            w.id AS workspace_id,
            w.name AS workspace_name
          FROM task_item_assignees a
          JOIN task_items i ON i.id = a.item_id
          JOIN task_groups g ON g.id = i.group_id
          JOIN task_boards b ON b.id = g.board_id
          JOIN task_workspaces w ON w.id = b.workspace_id
          WHERE a.user_id = $1
            AND ${activeOnly('i')}
        ),
        item_assignees AS (
          SELECT
            a.item_id,
            json_agg(
              json_build_object(
                'user_id', u.id,
                'email', u.email,
                'first_name', u.first_name,
                'last_name', u.last_name,
                'avatar_url', u.avatar_url
              )
            ) AS assignees
          FROM task_item_assignees a
          JOIN users u ON u.id = a.user_id
          WHERE a.item_id IN (SELECT id FROM my_items)
          GROUP BY a.item_id
        )
        SELECT
          m.board_id,
          m.board_name,
          m.workspace_id,
          m.workspace_name,
          json_agg(
            json_build_object(
              'id', m.id,
              'name', m.name,
              'status', m.status,
              'due_date', to_char(m.due_date, 'YYYY-MM-DD'),
              'needs_attention', m.needs_attention,
              'is_voicemail', m.is_voicemail,
              'assignees', COALESCE(ia.assignees, '[]'::json),
              'update_count', COALESCE(uc.update_count, 0),
              'time_total_minutes', COALESCE(tt.time_total_minutes, 0)
            )
            ORDER BY m.updated_at DESC
          ) AS items
        FROM my_items m
        LEFT JOIN item_assignees ia ON ia.item_id = m.id
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS update_count FROM task_updates u WHERE u.item_id = m.id
        ) uc ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(time_spent_minutes), 0) AS time_total_minutes FROM task_time_entries t WHERE t.item_id = m.id
        ) tt ON TRUE
        GROUP BY m.board_id, m.board_name, m.workspace_id, m.workspace_name
        ORDER BY m.workspace_name, m.board_name
      `,
      [userId]
    );
    // Also fetch subitems assigned to this user
    const { rows: mySubitems } = await query(
      `SELECT s.*,
              i.name AS parent_name, i.id AS parent_item_id,
              g.board_id, b.name AS board_name,
              -- Check if blocked: are there predecessors not yet done?
              (SELECT COUNT(*) FROM task_subitem_dependencies sd
               JOIN task_subitems pred ON pred.id = sd.predecessor_id
               WHERE sd.successor_id = s.id
                 AND pred.status NOT IN (
                   SELECT sl.label FROM task_board_status_labels sl
                   WHERE sl.board_id = g.board_id AND sl.is_done_state = true
                 )
                 AND pred.status != 'Done'
              )::int AS blocker_count
       FROM task_subitem_assignees sa
       JOIN task_subitems s ON s.id = sa.subitem_id
       JOIN task_items i ON i.id = s.parent_item_id
       JOIN task_groups g ON g.id = i.group_id
       JOIN task_boards b ON b.id = g.board_id
       WHERE sa.user_id = $1 AND ${activeOnly('s')} AND ${activeOnly('i')}
       ORDER BY s.due_date ASC NULLS LAST`,
      [userId]
    );

    return res.json({ boards: rows || [], subitems: mySubitems || [] });
  } catch (err) {
    console.error('[tasks:my-work]', err);
    return res.status(500).json({ message: 'Unable to load my work' });
  }
});

function localSummarizeUpdates({ itemName, updates }) {
  const lines = [];
  lines.push(`Task: ${itemName}`);
  if (!updates.length) {
    lines.push('No updates yet.');
    return lines.join('\n');
  }
  lines.push('');
  lines.push('Recent updates:');
  for (const u of updates.slice(0, 6)) {
    const author = u.author_name || 'Unknown';
    const content = String(u.content || '')
      .trim()
      .replace(/\s+/g, ' ');
    lines.push(`- ${author}: ${content.slice(0, 180)}${content.length > 180 ? '…' : ''}`);
  }
  lines.push('');
  lines.push('Next steps:');
  lines.push('- (AI not configured) Refresh summary when Vertex is available.');
  return lines.join('\n');
}

async function buildItemUpdateContext(itemId) {
  const itemRes = await query('SELECT id, name, status, due_date, updated_at FROM task_items WHERE id = $1', [itemId]);
  const item = itemRes.rows[0] || null;
  const updatesRes = await query(
    `SELECT u.*, COALESCE(us.first_name || ' ' || us.last_name, 'Unknown') AS author_name
     FROM task_updates u
     LEFT JOIN users us ON us.id = u.user_id
     WHERE u.item_id = $1
     ORDER BY u.created_at DESC
     LIMIT 50`,
    [itemId]
  );
  const updates = updatesRes.rows || [];
  const latestUpdateAt = updates[0]?.created_at || null;
  return { item, updates, latestUpdateAt };
}

router.get('/items/:itemId/ai-summary', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { itemId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForItem(itemId);
    if (!workspaceId) return res.status(404).json({ message: 'Item not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const [{ rows: summaryRows }, ctx] = await Promise.all([
      query('SELECT * FROM task_item_ai_summaries WHERE item_id = $1 LIMIT 1', [itemId]),
      buildItemUpdateContext(itemId)
    ]);
    const summary = summaryRows[0] || null;
    const latestUpdateAt = ctx.latestUpdateAt;
    const usedUpdateAt = summary?.source_meta?.latest_update_at || null;
    const isStale = Boolean(latestUpdateAt && usedUpdateAt && String(latestUpdateAt) !== String(usedUpdateAt));
    return res.json({ summary, is_stale: isStale, latest_update_at: latestUpdateAt });
  } catch (err) {
    console.error('[tasks:ai-summary:get]', err);
    return res.status(500).json({ message: 'Unable to load AI summary' });
  }
});

router.post('/items/:itemId/ai-summary/refresh', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { itemId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForItem(itemId);
    if (!workspaceId) return res.status(404).json({ message: 'Item not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const { item, updates, latestUpdateAt } = await buildItemUpdateContext(itemId);
    if (!item) return res.status(404).json({ message: 'Item not found' });

    let provider = 'vertex';
    let model = process.env.VERTEX_MODEL || 'gemini-2.5-flash';
    let summaryText = '';

    const updateTranscript = updates
      .slice()
      .reverse()
      .map((u) => {
        const ts = u.created_at ? new Date(u.created_at).toISOString() : '';
        const author = u.author_name || 'Unknown';
        return `[${ts}] ${author}: ${u.content || ''}`;
      })
      .join('\n');

    const prompt = `Summarize the task updates below for internal team tracking.\n\nTask: ${item.name}\nStatus: ${item.status}\nDue date: ${
      item.due_date || 'none'
    }\n\nUpdates (oldest to newest):\n${updateTranscript}\n\nOutput format:\n- Summary (2-5 sentences)\n- Current status\n- Blockers (if any)\n- Next steps (3 bullets max)\n\nBe concise and action-oriented.`;

    try {
      summaryText = await generateAiResponse({
        prompt,
        systemPrompt: 'You summarize internal task updates for a project management system. Keep it concise, factual, and useful.',
        temperature: 0.2,
        maxTokens: 350
      });
    } catch (aiErr) {
      provider = 'fallback';
      model = null;
      summaryText = localSummarizeUpdates({ itemName: item.name, updates });
      console.warn('[tasks:ai-summary:fallback]', aiErr?.message || aiErr);
    }

    const sourceMeta = {
      latest_update_at: latestUpdateAt,
      update_count: updates.length,
      item_updated_at: item.updated_at
    };

    const { rows } = await query(
      `INSERT INTO task_item_ai_summaries (item_id, summary, provider, model, generated_by, generated_at, source_meta)
       VALUES ($1,$2,$3,$4,$5,NOW(),$6)
       ON CONFLICT (item_id) DO UPDATE
         SET summary = EXCLUDED.summary,
             provider = EXCLUDED.provider,
             model = EXCLUDED.model,
             generated_by = EXCLUDED.generated_by,
             generated_at = NOW(),
             source_meta = EXCLUDED.source_meta
       RETURNING *`,
      [itemId, summaryText, provider, model, req.user.id, JSON.stringify(sourceMeta)]
    );

    return res.status(201).json({ summary: rows[0] });
  } catch (err) {
    console.error('[tasks:ai-summary:refresh]', err);
    return res.status(500).json({ message: 'Unable to refresh AI summary' });
  }
});

// Updates
router.get('/items/:itemId/updates', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { itemId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForItem(itemId);
    if (!workspaceId) return res.status(404).json({ message: 'Item not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
    const before = req.query.before || null;

    // Paginate top-level updates only; replies travel with their parent.
    let cursorClause = '';
    const params = [itemId];
    if (before) {
      cursorClause = `AND (u.created_at, u.id) < (SELECT u2.created_at, u2.id FROM task_updates u2 WHERE u2.id = $2)`;
      params.push(before);
    }
    params.push(limit + 1);

    const { rows: parents } = await query(
      `SELECT u.*, COALESCE(us.first_name || ' ' || us.last_name, 'Unknown') AS author_name
       FROM task_updates u
       LEFT JOIN users us ON us.id = u.user_id
       WHERE u.item_id = $1 AND u.parent_update_id IS NULL ${cursorClause}
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT $${params.length}`,
      params
    );
    const hasMore = parents.length > limit;
    const pageParents = hasMore ? parents.slice(0, limit) : parents;

    let replies = [];
    if (pageParents.length) {
      const parentIds = pageParents.map((p) => p.id);
      const { rows } = await query(
        `SELECT u.*, COALESCE(us.first_name || ' ' || us.last_name, 'Unknown') AS author_name
         FROM task_updates u
         LEFT JOIN users us ON us.id = u.user_id
         WHERE u.parent_update_id = ANY($1::uuid[])
         ORDER BY u.created_at ASC, u.id ASC`,
        [parentIds]
      );
      replies = rows;
    }

    // Flat array (top-level + replies). Frontend groups via parent_update_id.
    const updates = [...pageParents, ...replies];
    return res.json({
      updates,
      pagination: { has_more: hasMore, next_cursor: hasMore ? pageParents[pageParents.length - 1]?.id : null }
    });
  } catch (err) {
    console.error('[tasks:updates:list]', err);
    return res.status(500).json({ message: 'Unable to load updates' });
  }
});

router.post('/items/:itemId/updates', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { itemId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForItem(itemId);
    if (!workspaceId) return res.status(404).json({ message: 'Item not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const payload = updateCreateSchema.parse(req.body);
    let parentAuthorId = null;
    if (payload.parent_update_id) {
      const { rows: parentRows } = await query(
        'SELECT id, item_id, parent_update_id, user_id FROM task_updates WHERE id = $1',
        [payload.parent_update_id]
      );
      const parent = parentRows[0];
      if (!parent || parent.item_id !== itemId) {
        return res.status(400).json({ message: 'Parent comment not found on this item' });
      }
      // Single-level threading: replies attach to top-level comments only.
      if (parent.parent_update_id) {
        return res.status(400).json({ message: 'Replies cannot themselves be replied to' });
      }
      parentAuthorId = parent.user_id || null;
    }

    const { rows } = await query(
      `INSERT INTO task_updates (item_id, user_id, content, parent_update_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [itemId, req.user.id, payload.content, payload.parent_update_id || null]
    );
    // Fire-and-forget mention + reply notifications.
    fanOutUpdateNotifications({
      itemId,
      workspaceId,
      actorUserId: req.user.id,
      content: payload.content,
      replyToUserId: parentAuthorId
    }).catch((err) => console.error('[tasks:mentions]', err));
    const updBoardId = await getBoardIdForItem(itemId);
    emitTaskEvent({
      event_type: payload.parent_update_id ? 'update.reply_created' : 'update.created',
      workspace_id: workspaceId,
      board_id: updBoardId,
      item_id: itemId,
      entity_type: 'update',
      entity_id: rows[0].id,
      actor_id: req.user.id,
      new_value: { content: rows[0].content, parent_update_id: rows[0].parent_update_id }
    });
    return res.status(201).json({ update: rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:updates:create]', err);
    return res.status(500).json({ message: 'Unable to create update' });
  }
});

router.patch('/updates/:updateId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { updateId } = req.params;
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ message: 'content is required' });
  try {
    const { rows: [update] } = await query(
      `SELECT u.*, b.workspace_id
       FROM task_updates u
       JOIN task_items i ON i.id = u.item_id
       JOIN task_groups g ON g.id = i.group_id
       JOIN task_boards b ON b.id = g.board_id
       WHERE u.id = $1`,
      [updateId]
    );
    if (!update) return res.status(404).json({ message: 'Update not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId: update.workspace_id });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    if (update.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Only the author can edit this comment' });
    }

    const { rows: [updated] } = await query(
      'UPDATE task_updates SET content = $1 WHERE id = $2 RETURNING *',
      [content.trim(), updateId]
    );
    return res.json({ update: updated });
  } catch (err) {
    console.error('[tasks:updates:update]', err);
    return res.status(500).json({ message: 'Unable to update comment' });
  }
});

router.delete('/updates/:updateId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { updateId } = req.params;
  try {
    const { rows: [update] } = await query(
      `SELECT u.*, b.workspace_id
       FROM task_updates u
       JOIN task_items i ON i.id = u.item_id
       JOIN task_groups g ON g.id = i.group_id
       JOIN task_boards b ON b.id = g.board_id
       WHERE u.id = $1`,
      [updateId]
    );
    if (!update) return res.status(404).json({ message: 'Update not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId: update.workspace_id });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    if (update.user_id !== req.user.id && !['superadmin', 'admin'].includes(eff)) {
      return res.status(403).json({ message: 'Only the author or an admin can delete this comment' });
    }

    await query('DELETE FROM task_update_views WHERE update_id = $1', [updateId]);
    await query('DELETE FROM task_updates WHERE id = $1', [updateId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[tasks:updates:delete]', err);
    return res.status(500).json({ message: 'Unable to delete comment' });
  }
});

// Files (attachments)
router.get('/items/:itemId/files', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { itemId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForItem(itemId);
    if (!workspaceId) return res.status(404).json({ message: 'Item not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
    const before = req.query.before || null;

    let cursorClause = '';
    const params = [itemId];
    if (before) {
      cursorClause = `AND (f.created_at, f.id) < (SELECT f2.created_at, f2.id FROM task_files f2 WHERE f2.id = $2)`;
      params.push(before);
    }
    params.push(limit + 1);

    const { rows } = await query(
      `SELECT f.*, COALESCE(us.first_name || ' ' || us.last_name, 'Unknown') AS uploaded_by_name
       FROM task_files f
       LEFT JOIN users us ON us.id = f.uploaded_by
       WHERE f.item_id = $1 ${cursorClause}
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT $${params.length}`,
      params
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return res.json({
      files: page,
      pagination: { has_more: hasMore, next_cursor: hasMore ? page[page.length - 1]?.id : null }
    });
  } catch (err) {
    console.error('[tasks:files:list]', err);
    return res.status(500).json({ message: 'Unable to load files' });
  }
});

router.post('/items/:itemId/files', uploadTaskFileMiddleware, async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { itemId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForItem(itemId);
    if (!workspaceId) return res.status(404).json({ message: 'Item not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    if (!req.file) return res.status(400).json({ message: 'File is required' });

    const url = `/uploads/tasks/${req.file.filename}`.replace(/\\/g, '/');
    const fileName = req.file.originalname || req.file.filename;
    const { rows } = await query(
      `INSERT INTO task_files (item_id, uploaded_by, file_url, file_name)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [itemId, req.user.id, url, fileName]
    );
    const fileBoardId = await getBoardIdForItem(itemId);
    emitTaskEvent({
      event_type: 'file.uploaded',
      workspace_id: workspaceId,
      board_id: fileBoardId,
      item_id: itemId,
      entity_type: 'file',
      entity_id: rows[0].id,
      actor_id: req.user.id,
      new_value: { file_name: fileName }
    });
    return res.status(201).json({ file: rows[0] });
  } catch (err) {
    console.error('[tasks:files:upload]', err);
    return res.status(500).json({ message: 'Unable to upload file' });
  }
});

router.delete('/files/:fileId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { fileId } = req.params;
  try {
    const { rows: [file] } = await query(
      `SELECT f.*, g.board_id, b.workspace_id
       FROM task_files f
       JOIN task_items i ON i.id = f.item_id
       JOIN task_groups g ON g.id = i.group_id
       JOIN task_boards b ON b.id = g.board_id
       WHERE f.id = $1`,
      [fileId]
    );
    if (!file) return res.status(404).json({ message: 'File not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId: file.workspace_id });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    await query('DELETE FROM task_files WHERE id = $1', [fileId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[tasks:files:delete]', err);
    return res.status(500).json({ message: 'Unable to delete file' });
  }
});

// Subitems
router.get('/items/:itemId/subitems', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { itemId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForItem(itemId);
    if (!workspaceId) return res.status(404).json({ message: 'Item not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    const includeArchived = req.query.includeArchived === 'true';
    if (includeArchived && eff !== 'superadmin' && eff !== 'admin') {
      return res.status(403).json({ message: 'Admin role required to view archived subitems' });
    }
    const { rows } = await query(
      `SELECT *
       FROM task_subitems
       WHERE parent_item_id = $1
         AND ($2::boolean OR archived_at IS NULL)
       ORDER BY created_at DESC`,
      [itemId, includeArchived]
    );
    return res.json({ subitems: rows });
  } catch (err) {
    console.error('[tasks:subitems:list]', err);
    return res.status(500).json({ message: 'Unable to load subitems' });
  }
});

router.post('/items/:itemId/subitems', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { itemId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForItem(itemId);
    if (!workspaceId) return res.status(404).json({ message: 'Item not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const payload = subitemCreateSchema.parse(req.body);
    const { rows } = await query(
      `INSERT INTO task_subitems (parent_item_id, name, status, due_date)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [itemId, payload.name.trim(), payload.status ?? 'To Do', payload.due_date ?? null]
    );
    const subBoardId = await getBoardIdForItem(itemId);
    emitTaskEvent({
      event_type: 'subitem.created',
      workspace_id: workspaceId,
      board_id: subBoardId,
      item_id: itemId,
      entity_type: 'subitem',
      entity_id: rows[0].id,
      actor_id: req.user.id,
      new_value: { name: rows[0].name, status: rows[0].status }
    });
    return res.status(201).json({ subitem: rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:subitems:create]', err);
    return res.status(500).json({ message: 'Unable to create subitem' });
  }
});

router.patch('/subitems/:subitemId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { subitemId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForSubitem(subitemId);
    if (!workspaceId) return res.status(404).json({ message: 'Subitem not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const payload = subitemUpdateSchema.parse(req.body);
    const fields = [];
    const values = [];
    let i = 1;
    if (payload.name !== undefined) {
      fields.push(`name = $${i++}`);
      values.push(payload.name.trim());
    }
    if (payload.status !== undefined) {
      fields.push(`status = $${i++}`);
      values.push(payload.status);
    }
    if (payload.due_date !== undefined) {
      fields.push(`due_date = $${i++}`);
      values.push(payload.due_date);
    }
    if (payload.start_date !== undefined) {
      fields.push(`start_date = $${i++}`);
      values.push(payload.start_date);
    }
    if (!fields.length) return res.status(400).json({ message: 'No changes provided' });
    values.push(subitemId);
    const { rows } = await query(
      `UPDATE task_subitems
       SET ${fields.join(', ')}
       WHERE id = $${i}
       RETURNING *`,
      values
    );
    // Resolve parent item context for event
    const { rows: subParent } = await query('SELECT parent_item_id FROM task_subitems WHERE id = $1', [subitemId]);
    const subParentItemId = subParent[0]?.parent_item_id;
    const { workspace_id: subUpdWsId, board_id: subUpdBoardId } = subParentItemId ? await resolveItemContext(subParentItemId) : {};
    emitTaskEvent({
      event_type: 'subitem.updated',
      workspace_id: subUpdWsId || workspaceId,
      board_id: subUpdBoardId,
      item_id: subParentItemId,
      entity_type: 'subitem',
      entity_id: subitemId,
      actor_id: req.user.id,
      new_value: { name: rows[0].name, status: rows[0].status, due_date: rows[0].due_date, start_date: rows[0].start_date }
    });
    return res.json({ subitem: rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:subitems:update]', err);
    return res.status(500).json({ message: 'Unable to update subitem' });
  }
});

router.delete('/subitems/:subitemId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { subitemId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForSubitem(subitemId);
    if (!workspaceId) return res.status(404).json({ message: 'Subitem not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    const { rows } = await query(
      `UPDATE task_subitems
       SET archived_at = COALESCE(archived_at, NOW()),
           archived_by = COALESCE(archived_by, $2)
       WHERE id = $1
       RETURNING id, archived_at`,
      [subitemId, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Subitem not found' });
    // Resolve parent item for context — query before delete would have been better but
    // the subitem is only soft-deleted so it's still available
    const { rows: subArchParent } = await query('SELECT parent_item_id FROM task_subitems WHERE id = $1', [subitemId]);
    const subArchParentItemId = subArchParent[0]?.parent_item_id;
    const { workspace_id: subArchWsId, board_id: subArchBoardId } = subArchParentItemId ? await resolveItemContext(subArchParentItemId) : {};
    emitTaskEvent({
      event_type: 'subitem.archived',
      workspace_id: subArchWsId || workspaceId,
      board_id: subArchBoardId,
      item_id: subArchParentItemId,
      entity_type: 'subitem',
      entity_id: subitemId,
      actor_id: req.user.id
    });
    return res.json({ ok: true, archived_at: rows[0].archived_at });
  } catch (err) {
    console.error('[tasks:subitems:delete]', err);
    return res.status(500).json({ message: 'Unable to delete subitem' });
  }
});

router.post('/subitems/:subitemId/restore', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { subitemId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForSubitem(subitemId);
    if (!workspaceId) return res.status(404).json({ message: 'Subitem not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    const { rows } = await query(
      `UPDATE task_subitems
       SET archived_at = NULL, archived_by = NULL
       WHERE id = $1
       RETURNING *`,
      [subitemId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Subitem not found' });
    const subRestParentItemId = rows[0].parent_item_id;
    const { workspace_id: subRestWsId, board_id: subRestBoardId } = subRestParentItemId ? await resolveItemContext(subRestParentItemId) : {};
    emitTaskEvent({
      event_type: 'subitem.restored',
      workspace_id: subRestWsId || workspaceId,
      board_id: subRestBoardId,
      item_id: subRestParentItemId,
      entity_type: 'subitem',
      entity_id: subitemId,
      actor_id: req.user.id,
      new_value: { name: rows[0].name, status: rows[0].status }
    });
    return res.json({ subitem: rows[0] });
  } catch (err) {
    console.error('[tasks:subitems:restore]', err);
    return res.status(500).json({ message: 'Unable to restore subitem' });
  }
});

// Assignees
router.get('/items/:itemId/assignees', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { itemId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForItem(itemId);
    if (!workspaceId) return res.status(404).json({ message: 'Item not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const { rows } = await query(
      `SELECT
         a.user_id,
         u.email,
         u.first_name,
         u.last_name,
         u.role AS user_role,
         u.avatar_url
       FROM task_item_assignees a
       JOIN users u ON u.id = a.user_id
       WHERE a.item_id = $1
       ORDER BY u.email ASC`,
      [itemId]
    );
    return res.json({ assignees: rows });
  } catch (err) {
    console.error('[tasks:assignees:list]', err);
    return res.status(500).json({ message: 'Unable to load assignees' });
  }
});

router.post('/items/:itemId/assignees', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { itemId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForItem(itemId);
    if (!workspaceId) return res.status(404).json({ message: 'Item not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const payload = itemAssigneeAddSchema.parse(req.body);
    let targetUserId = payload.user_id;
    if (!targetUserId && payload.email) {
      const { rows } = await query('SELECT id FROM users WHERE email = $1 LIMIT 1', [payload.email]);
      targetUserId = rows[0]?.id || null;
    }
    if (!targetUserId) return res.status(404).json({ message: 'User not found' });

    // only allow assigning users who have workspace access (avoid leaking user IDs)
    const { rows: userRows } = await query('SELECT id, role FROM users WHERE id = $1 LIMIT 1', [targetUserId]);
    const targetRole = userRows[0]?.role;
    const targetOk = await assertWorkspaceAccess({ effRole: targetRole, userId: targetUserId, workspaceId });
    if (!targetOk) return res.status(403).json({ message: 'User does not have workspace access' });

    const insertedRes = await query(
      `INSERT INTO task_item_assignees (item_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (item_id, user_id) DO NOTHING
       RETURNING user_id`,
      [itemId, targetUserId]
    );

    // Notify the assignee (in-app + email) when newly assigned, but never notify the actor.
    if (insertedRes.rowCount && targetUserId !== req.user.id) {
      const { rows: itemRows } = await query('SELECT id, name FROM task_items WHERE id = $1 LIMIT 1', [itemId]);
      const itemName = itemRows[0]?.name || 'Task item';
      const boardId = await getBoardIdForItem(itemId);
      const linkUrl = boardId
        ? `/tasks?pane=boards&board=${encodeURIComponent(boardId)}&item=${encodeURIComponent(itemId)}`
        : '/tasks?pane=boards';
      await createNotification({
        userId: targetUserId,
        title: 'You were assigned to a task',
        body: itemName,
        linkUrl,
        meta: {
          source: 'task_assignment',
          item_id: itemId,
          workspace_id: workspaceId,
          actor_user_id: req.user.id
        }
      });
    }

    // Fire automations for assignee_added asynchronously (global + board).
    if (insertedRes.rowCount) {
      if (!EVENT_BUS_ENABLED) {
        runEventAutomationsForAssigneeAdded({ itemId, assigneeUserId: targetUserId, actorUserId: req.user.id }).catch((err) =>
          console.error('[tasks:automations:run:assignee-added]', err)
        );
      }
      const assignBoardId = await getBoardIdForItem(itemId);
      emitTaskEvent({
        event_type: 'assignee.added',
        workspace_id: workspaceId,
        board_id: assignBoardId,
        item_id: itemId,
        entity_type: 'assignee',
        entity_id: targetUserId,
        actor_id: req.user.id,
        new_value: { user_id: targetUserId }
      });
    }

    const { rows } = await query(
      `SELECT
         a.user_id,
         u.email,
         u.first_name,
         u.last_name,
         u.role AS user_role,
         u.avatar_url
       FROM task_item_assignees a
       JOIN users u ON u.id = a.user_id
       WHERE a.item_id = $1 AND a.user_id = $2
       LIMIT 1`,
      [itemId, targetUserId]
    );
    return res.status(201).json({ assignee: rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:assignees:add]', err);
    return res.status(500).json({ message: 'Unable to add assignee' });
  }
});

router.delete('/items/:itemId/assignees/:assigneeUserId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { itemId, assigneeUserId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForItem(itemId);
    if (!workspaceId) return res.status(404).json({ message: 'Item not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const { rowCount } = await query('DELETE FROM task_item_assignees WHERE item_id = $1 AND user_id = $2', [itemId, assigneeUserId]);
    if (!rowCount) return res.status(404).json({ message: 'Assignee not found' });
    const rmAssignBoardId = await getBoardIdForItem(itemId);
    emitTaskEvent({
      event_type: 'assignee.removed',
      workspace_id: workspaceId,
      board_id: rmAssignBoardId,
      item_id: itemId,
      entity_type: 'assignee',
      entity_id: assigneeUserId,
      actor_id: req.user.id,
      old_value: { user_id: assigneeUserId }
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[tasks:assignees:remove]', err);
    return res.status(500).json({ message: 'Unable to remove assignee' });
  }
});

// Time tracking
router.get('/items/:itemId/time-entries', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { itemId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForItem(itemId);
    if (!workspaceId) return res.status(404).json({ message: 'Item not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
    const before = req.query.before || null;

    let cursorClause = '';
    const params = [itemId];
    if (before) {
      cursorClause = `AND (t.created_at, t.id) < (SELECT t2.created_at, t2.id FROM task_time_entries t2 WHERE t2.id = $2)`;
      params.push(before);
    }
    params.push(limit + 1);

    const { rows } = await query(
      `SELECT t.*, COALESCE(us.first_name || ' ' || us.last_name, 'Unknown') AS user_name
       FROM task_time_entries t
       LEFT JOIN users us ON us.id = t.user_id
       WHERE t.item_id = $1 ${cursorClause}
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT $${params.length}`,
      params
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return res.json({
      time_entries: page,
      pagination: { has_more: hasMore, next_cursor: hasMore ? page[page.length - 1]?.id : null }
    });
  } catch (err) {
    console.error('[tasks:time:list]', err);
    return res.status(500).json({ message: 'Unable to load time entries' });
  }
});

router.post('/items/:itemId/time-entries', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { itemId } = req.params;
  try {
    const workspaceId = await getWorkspaceIdForItem(itemId);
    if (!workspaceId) return res.status(404).json({ message: 'Item not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    const payload = timeEntryCreateSchema.parse(req.body);
    const isBillable = payload.is_billable !== undefined ? payload.is_billable : true;
    const spent = payload.time_spent_minutes;
    const billable = payload.billable_minutes !== undefined ? payload.billable_minutes : isBillable ? spent : 0;

    const { rows } = await query(
      `INSERT INTO task_time_entries (item_id, user_id, time_spent_minutes, billable_minutes, description, work_category, is_billable)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [itemId, req.user.id, spent, billable, payload.description ?? null, payload.work_category ?? null, isBillable]
    );
    const teBoardId = await getBoardIdForItem(itemId);
    emitTaskEvent({
      event_type: 'time_entry.created',
      workspace_id: workspaceId,
      board_id: teBoardId,
      item_id: itemId,
      entity_type: 'time_entry',
      entity_id: rows[0].id,
      actor_id: req.user.id,
      new_value: { time_spent_minutes: rows[0].time_spent_minutes, is_billable: rows[0].is_billable }
    });
    return res.status(201).json({ time_entry: rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:time:create]', err);
    return res.status(500).json({ message: 'Unable to create time entry' });
  }
});

router.patch('/time-entries/:entryId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { entryId } = req.params;
  const { time_spent_minutes, billable_minutes, description, work_category, is_billable } = req.body;
  try {
    const { rows: [entry] } = await query(
      `SELECT t.*, b.workspace_id
       FROM task_time_entries t
       JOIN task_items i ON i.id = t.item_id
       JOIN task_groups g ON g.id = i.group_id
       JOIN task_boards b ON b.id = g.board_id
       WHERE t.id = $1`,
      [entryId]
    );
    if (!entry) return res.status(404).json({ message: 'Time entry not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId: entry.workspace_id });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    if (entry.user_id !== req.user.id && !['superadmin', 'admin'].includes(eff)) {
      return res.status(403).json({ message: 'Only the creator or an admin can edit this entry' });
    }

    const sets = [];
    const vals = [];
    let idx = 1;
    if (time_spent_minutes !== undefined) { sets.push(`time_spent_minutes = $${idx++}`); vals.push(time_spent_minutes); }
    if (billable_minutes !== undefined) { sets.push(`billable_minutes = $${idx++}`); vals.push(billable_minutes); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); vals.push(description); }
    if (work_category !== undefined) { sets.push(`work_category = $${idx++}`); vals.push(work_category); }
    if (is_billable !== undefined) { sets.push(`is_billable = $${idx++}`); vals.push(is_billable); }

    if (!sets.length) return res.status(400).json({ message: 'No fields to update' });
    vals.push(entryId);

    const { rows: [updated] } = await query(
      `UPDATE task_time_entries SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    return res.json({ time_entry: updated });
  } catch (err) {
    console.error('[tasks:time:update]', err);
    return res.status(500).json({ message: 'Unable to update time entry' });
  }
});

router.delete('/time-entries/:entryId', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const { entryId } = req.params;
  try {
    const { rows: [entry] } = await query(
      `SELECT t.*, b.workspace_id
       FROM task_time_entries t
       JOIN task_items i ON i.id = t.item_id
       JOIN task_groups g ON g.id = i.group_id
       JOIN task_boards b ON b.id = g.board_id
       WHERE t.id = $1`,
      [entryId]
    );
    if (!entry) return res.status(404).json({ message: 'Time entry not found' });
    const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId: entry.workspace_id });
    if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });

    if (entry.user_id !== req.user.id && !['superadmin', 'admin'].includes(eff)) {
      return res.status(403).json({ message: 'Only the creator or an admin can delete this entry' });
    }

    await query('DELETE FROM task_time_entries WHERE id = $1', [entryId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[tasks:time:delete]', err);
    return res.status(500).json({ message: 'Unable to delete time entry' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE VIEW TRACKING
// ─────────────────────────────────────────────────────────────────────────────

// Mark updates as viewed by the current user (batch)
router.post('/updates/mark-viewed', async (req, res) => {
  const userId = req.user.id;
  try {
    const { update_ids } = req.body;
    if (!Array.isArray(update_ids) || !update_ids.length) {
      return res.status(400).json({ message: 'update_ids required' });
    }
    // Insert views, ignoring duplicates
    for (const updateId of update_ids) {
      await query(
        `INSERT INTO task_update_views (update_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (update_id, user_id) DO NOTHING`,
        [updateId, userId]
      );
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('[tasks:updates:mark-viewed]', err);
    return res.status(500).json({ message: 'Unable to mark updates as viewed' });
  }
});

// Get view info for updates (who viewed each)
router.post('/updates/views', async (req, res) => {
  try {
    const { update_ids } = req.body;
    if (!Array.isArray(update_ids) || !update_ids.length) {
      return res.status(400).json({ message: 'update_ids required' });
    }
    const { rows } = await query(
      `SELECT v.update_id, v.user_id, v.viewed_at,
              COALESCE(u.first_name || ' ' || u.last_name, u.email, 'Unknown') AS user_name,
              u.avatar_url
       FROM task_update_views v
       JOIN users u ON u.id = v.user_id
       WHERE v.update_id = ANY($1)
       ORDER BY v.viewed_at ASC`,
      [update_ids]
    );
    // Group by update_id
    const viewsByUpdate = {};
    for (const row of rows) {
      if (!viewsByUpdate[row.update_id]) viewsByUpdate[row.update_id] = [];
      viewsByUpdate[row.update_id].push({
        user_id: row.user_id,
        user_name: row.user_name,
        avatar_url: row.avatar_url,
        viewed_at: row.viewed_at
      });
    }
    return res.json({ views: viewsByUpdate });
  } catch (err) {
    console.error('[tasks:updates:views]', err);
    return res.status(500).json({ message: 'Unable to load update views' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AI DAILY OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────

router.get('/ai/daily-overview', async (req, res) => {
  const userId = req.user.id;
  const today = new Date().toISOString().slice(0, 10);

  try {
    // Check for cached overview from today
    const { rows: cached } = await query(
      `SELECT * FROM task_ai_daily_overviews
       WHERE user_id = $1 AND overview_date = $2`,
      [userId, today]
    );
    if (cached.length && !req.query.refresh) {
      return res.json({ overview: cached[0], cached: true });
    }

    // Get user info
    const { rows: userRows } = await query(
      `SELECT first_name, last_name, email FROM users WHERE id = $1`,
      [userId]
    );
    const userName = userRows[0]?.first_name || userRows[0]?.email || 'User';

    // 1. Get items assigned to this user that are not done
    const { rows: assignedItems } = await query(
      `SELECT i.id, i.name, i.status, i.due_date, i.created_at,
              g.name AS group_name,
              b.name AS board_name,
              w.name AS workspace_name
       FROM task_items i
       JOIN task_item_assignees a ON a.item_id = i.id AND a.user_id = $1
       JOIN task_groups g ON g.id = i.group_id
       JOIN task_boards b ON b.id = g.board_id
       JOIN task_workspaces w ON w.id = b.workspace_id
       WHERE i.status != 'done'
         AND ${activeOnly('i')}
       ORDER BY i.due_date ASC NULLS LAST, i.created_at DESC`,
      [userId]
    );

    // 2. Get all updates from last 60 days for these items
    const itemIds = assignedItems.map((i) => i.id);
    let allUpdates = [];
    if (itemIds.length) {
      const { rows: updates } = await query(
        `SELECT u.id, u.item_id, u.content, u.created_at, u.user_id,
                COALESCE(us.first_name || ' ' || us.last_name, us.email, 'Unknown') AS author_name,
                i.name AS item_name
         FROM task_updates u
         JOIN users us ON us.id = u.user_id
         JOIN task_items i ON i.id = u.item_id
         WHERE u.item_id = ANY($1)
           AND u.created_at >= NOW() - INTERVAL '60 days'
         ORDER BY u.created_at DESC`,
        [itemIds]
      );
      allUpdates = updates;
    }

    // 3. Find mentions of this user (@mentions in content)
    const { rows: userInfo } = await query(
      `SELECT email, first_name, last_name FROM users WHERE id = $1`,
      [userId]
    );
    const userEmail = userInfo[0]?.email || '';
    const userFirstName = userInfo[0]?.first_name || '';
    const mentionPatterns = [userEmail, userFirstName].filter(Boolean).map((s) => s.toLowerCase());

    // Mentions received (updates by others that mention this user)
    const mentionsReceived = allUpdates.filter((u) => {
      if (u.user_id === userId) return false;
      const contentLower = (u.content || '').toLowerCase();
      return mentionPatterns.some((p) => contentLower.includes(`@${p}`) || contentLower.includes(p));
    });

    // Mentions made by user
    const mentionsMade = allUpdates.filter((u) => u.user_id === userId && u.content.includes('@'));

    // Check if user responded to mentions
    const pendingMentions = [];
    for (const mention of mentionsReceived) {
      // Check if user replied after this mention
      const replied = allUpdates.some(
        (u) => u.user_id === userId && u.item_id === mention.item_id && new Date(u.created_at) > new Date(mention.created_at)
      );
      if (!replied) {
        pendingMentions.push({
          update_id: mention.id,
          item_id: mention.item_id,
          item_name: mention.item_name,
          author_name: mention.author_name,
          content: mention.content.slice(0, 200),
          created_at: mention.created_at
        });
      }
    }

    // Check if mentions user made got replies
    const unansweredMentions = [];
    for (const mention of mentionsMade) {
      // Check if anyone else replied after this mention
      const replied = allUpdates.some(
        (u) => u.user_id !== userId && u.item_id === mention.item_id && new Date(u.created_at) > new Date(mention.created_at)
      );
      if (!replied) {
        unansweredMentions.push({
          update_id: mention.id,
          item_id: mention.item_id,
          item_name: mention.item_name,
          content: mention.content.slice(0, 200),
          created_at: mention.created_at
        });
      }
    }

    // 4. Build AI prompt using structured agent prompt
    const todayDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // Prepare items with activity info
    const itemsForPrompt = assignedItems.map((i) => {
      const itemUpdates = allUpdates.filter((u) => u.item_id === i.id);
      const lastActivity = itemUpdates.length ? itemUpdates[0].created_at : i.created_at;
      const daysSinceActivity = Math.floor((Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24));
      return {
        name: i.name,
        status: i.status,
        due_date: i.due_date ? new Date(i.due_date).toLocaleDateString() : null,
        board: i.board_name,
        group: i.group_name,
        created_at: new Date(i.created_at).toLocaleDateString(),
        last_activity: new Date(lastActivity).toLocaleDateString(),
        days_since_activity: daysSinceActivity,
        update_count: itemUpdates.length
      };
    });

    const prompt = `## Role

You are a proactive personal work assistant. Your job is to generate a concise, actionable daily overview for ${userName} based on their assigned work items, activity feeds, and mentions.

## Context Provided

Today's date: ${todayDate}

### Assigned Work Items (${assignedItems.length} total, excluding done):
${JSON.stringify(itemsForPrompt, null, 2)}

### Mentions Where ${userName} Was Mentioned But Has Not Responded (${pendingMentions.length}):
${pendingMentions.slice(0, 15).map((m) => `- "${m.content}" from ${m.author_name} on item "${m.item_name}" (${new Date(m.created_at).toLocaleDateString()})`).join('\n') || 'None'}

### Mentions ${userName} Made That Have Not Received Replies (${unansweredMentions.length}):
${unansweredMentions.slice(0, 15).map((m) => `- "${m.content}" on item "${m.item_name}" (${new Date(m.created_at).toLocaleDateString()})`).join('\n') || 'None'}

## Primary Objectives

### Daily Overview Summary
- Summarize what ${userName} should focus on today in plain language.
- Highlight time-sensitive work, unresolved conversations, and priority risks.
- Keep the tone clear, supportive, and efficient.

### Mention Awareness
- Identify mentions where ${userName} was mentioned and has not yet responded.
- Identify mentions where ${userName} mentioned others and has not received a reply.
- Group these separately and describe what follow-up is needed.

### To-Do List Generation
Generate a prioritized to-do list by analyzing:
- Items due today or overdue (highest priority)
- Items coming up soon
- Titles that imply large or complex projects (e.g. words like "launch", "migration", "integration", "review", "phase", "rollout", "redesign", "implementation")
- Promote large or high-impact items earlier in the list, even if not due today.
- Items currently in "working" or "blocked" status need attention.
- Exclude low-urgency items unless there is capacity.

### Status Intelligence
- Identify any items that appear stalled (no recent activity, days_since_activity > 7).
- Flag items that may need attention based on inactivity, unclear ownership, or repeated mentions.

## Constraints
- Be concise and practical.
- Do not repeat raw data back to the user.
- Do not speculate beyond the provided information.
- Do not assign new tasks, only summarize and prioritize existing ones.

## Output Format

Return a JSON object with these sections:

{
  "greeting": "A brief, friendly greeting appropriate for the time of day",
  "today_at_a_glance": "3-5 sentences summarizing the day's focus, time-sensitive work, and key priorities",
  "top_priorities": [
    { "priority": 1, "task": "Clear task description", "item_name": "Original item name", "reason": "Brief rationale for priority" }
  ],
  "mentions_needing_response": [
    { "from": "Person name", "item": "Item name", "summary": "Brief description of what needs response" }
  ],
  "mentions_awaiting_replies": [
    { "item": "Item name", "summary": "Brief description of what you're waiting on" }
  ],
  "upcoming_and_at_risk": [
    { "item_name": "Item name", "risk": "Brief explanation (due soon, stalled, blocked, etc.)" }
  ],
  "suggestions": ["Optional light suggestions for sequencing work or quick wins"]
}`;

    let aiResponse;
    try {
      aiResponse = await generateAiResponse(prompt, { maxTokens: 2000 });
    } catch (aiErr) {
      console.error('[tasks:ai:daily-overview:ai-call]', aiErr);
      // Return a fallback response using new structure
      const fallbackOverview = {
        greeting: `Good ${new Date().getHours() < 12 ? 'morning' : 'afternoon'}, ${userName}!`,
        today_at_a_glance: `You have ${assignedItems.length} active items assigned to you. ${pendingMentions.length > 0 ? `There are ${pendingMentions.length} mentions waiting for your response.` : ''} ${unansweredMentions.length > 0 ? `You have ${unansweredMentions.length} mentions awaiting replies from others.` : ''}`.trim(),
        top_priorities: assignedItems.slice(0, 5).map((i, idx) => ({
          priority: idx + 1,
          task: i.name,
          item_name: i.name,
          reason: i.due_date ? `Due: ${new Date(i.due_date).toLocaleDateString()}` : 'Active task'
        })),
        mentions_needing_response: pendingMentions.slice(0, 5).map((m) => ({
          from: m.author_name,
          item: m.item_name,
          summary: m.content.slice(0, 100)
        })),
        mentions_awaiting_replies: unansweredMentions.slice(0, 5).map((m) => ({
          item: m.item_name,
          summary: m.content.slice(0, 100)
        })),
        upcoming_and_at_risk: [],
        suggestions: ['Focus on one task at a time', 'Address pending mentions early in the day']
      };
      return res.json({
        overview: {
          user_id: userId,
          overview_date: today,
          summary: JSON.stringify(fallbackOverview),
          todo_items: fallbackOverview.top_priorities,
          pending_mentions: pendingMentions.slice(0, 20),
          unanswered_mentions: unansweredMentions.slice(0, 20),
          generated_at: new Date().toISOString()
        },
        cached: false,
        ai_error: true
      });
    }

    // Parse AI response
    let parsed;
    try {
      // Extract JSON from response (may have markdown code blocks)
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(aiResponse);
    } catch (parseErr) {
      console.error('[tasks:ai:daily-overview:parse]', parseErr);
      parsed = {
        greeting: `Good ${new Date().getHours() < 12 ? 'morning' : 'afternoon'}, ${userName}!`,
        today_at_a_glance: aiResponse.slice(0, 500),
        top_priorities: [],
        mentions_needing_response: [],
        mentions_awaiting_replies: [],
        upcoming_and_at_risk: [],
        suggestions: []
      };
    }

    // Save to cache
    await query(
      `INSERT INTO task_ai_daily_overviews (user_id, overview_date, summary, todo_items, pending_mentions, unanswered_mentions, provider, model)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, overview_date) DO UPDATE SET
         summary = EXCLUDED.summary,
         todo_items = EXCLUDED.todo_items,
         pending_mentions = EXCLUDED.pending_mentions,
         unanswered_mentions = EXCLUDED.unanswered_mentions,
         generated_at = NOW()`,
      [
        userId,
        today,
        JSON.stringify(parsed),
        JSON.stringify(parsed.top_priorities || []),
        JSON.stringify(pendingMentions.slice(0, 20)),
        JSON.stringify(unansweredMentions.slice(0, 20)),
        'vertex',
        null
      ]
    );

    return res.json({
      overview: {
        user_id: userId,
        overview_date: today,
        summary: JSON.stringify(parsed),
        todo_items: parsed.top_priorities || [],
        pending_mentions: pendingMentions.slice(0, 20),
        unanswered_mentions: unansweredMentions.slice(0, 20),
        generated_at: new Date().toISOString()
      },
      cached: false
    });
  } catch (err) {
    console.error('[tasks:ai:daily-overview]', err);
    return res.status(500).json({ message: 'Unable to generate daily overview' });
  }
});

// ─── Automation v2: Steps, Quota, Workflow Runs, Dry-Run ────────────────────

/**
 * Helper: find an automation by ID and determine its scope.
 * Queries board table first, falls back to global.
 */
async function findAutomationAndScope(automationId) {
  const { rows: boardRows } = await query(`SELECT * FROM task_board_automations WHERE id = $1 AND ${activeOnly()}`, [automationId]);
  if (boardRows[0]) return { automation: boardRows[0], scope: 'board' };
  const { rows: globalRows } = await query(`SELECT * FROM task_global_automations WHERE id = $1 AND ${activeOnly()}`, [automationId]);
  if (globalRows[0]) return { automation: globalRows[0], scope: 'global' };
  return { automation: null, scope: null };
}

// GET /automations/:automationId/steps — list steps for an automation
router.get('/automations/:automationId/steps', async (req, res) => {
  const eff = getEffectiveRole(req);
  if (eff !== 'superadmin' && eff !== 'admin') return res.status(403).json({ message: 'Insufficient permissions' });
  try {
    const { automationId } = req.params;
    const { automation, scope } = await findAutomationAndScope(automationId);
    if (!automation) return res.status(404).json({ message: 'Automation not found' });

    const { rows } = await query(
      `SELECT * FROM task_automation_steps
       WHERE automation_id = $1 AND automation_scope = $2
       ORDER BY step_order ASC`,
      [automationId, scope]
    );
    return res.json({ steps: rows, scope });
  } catch (err) {
    console.error('[tasks:automations:steps:list]', err);
    return res.status(500).json({ message: 'Unable to load automation steps' });
  }
});

// POST /automations/:automationId/steps — add a step (max 20)
router.post('/automations/:automationId/steps', async (req, res) => {
  const eff = getEffectiveRole(req);
  if (eff !== 'superadmin' && eff !== 'admin') return res.status(403).json({ message: 'Insufficient permissions' });
  try {
    const { automationId } = req.params;
    const { automation, scope } = await findAutomationAndScope(automationId);
    if (!automation) return res.status(404).json({ message: 'Automation not found' });

    const payload = stepCreateSchema.parse(req.body);

    // Enforce max 20 steps per automation
    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS cnt FROM task_automation_steps
       WHERE automation_id = $1 AND automation_scope = $2`,
      [automationId, scope]
    );
    if ((countRows[0]?.cnt || 0) >= 20) {
      return res.status(400).json({ message: 'Maximum 20 steps per automation' });
    }

    // Validate else steps: must have a preceding 'if' at the same parent level
    if (payload.step_type === 'else') {
      const parentFilter = payload.parent_step_id
        ? `AND parent_step_id = '${payload.parent_step_id}'`
        : 'AND parent_step_id IS NULL';
      const { rows: siblings } = await query(
        `SELECT step_type, step_order FROM task_automation_steps
         WHERE automation_id = $1 AND automation_scope = $2 ${parentFilter}
         ORDER BY step_order DESC LIMIT 1`,
        [automationId, scope]
      );
      const lastSibling = siblings[0];
      if (!lastSibling || lastSibling.step_type !== 'if') {
        return res.status(400).json({ message: 'An "else" step must immediately follow an "if" step at the same level' });
      }
    }

    // Auto-assign step_order if not provided
    let stepOrder = payload.step_order;
    if (stepOrder === undefined || stepOrder === null) {
      const { rows: maxRows } = await query(
        `SELECT COALESCE(MAX(step_order), -1) + 1 AS next_order
         FROM task_automation_steps
         WHERE automation_id = $1 AND automation_scope = $2`,
        [automationId, scope]
      );
      stepOrder = maxRows[0]?.next_order || 0;
    }

    const { rows } = await query(
      `INSERT INTO task_automation_steps
         (automation_id, automation_scope, step_order, step_type, action_type, action_config, condition_group, parent_step_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        automationId, scope, stepOrder,
        payload.step_type,
        payload.action_type || null,
        JSON.stringify(payload.action_config || {}),
        payload.condition_group ? JSON.stringify(payload.condition_group) : null,
        payload.parent_step_id || null
      ]
    );
    await logSecurityEvent({
      userId: req.user.id,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCESS,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: { action: 'automation_step_created', automationId, scope, stepId: rows[0].id, stepType: payload.step_type, actionType: payload.action_type }
    });
    return res.status(201).json({ step: rows[0], scope });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:automations:steps:create]', err);
    return res.status(500).json({ message: 'Unable to create step' });
  }
});

// PATCH /automations/steps/:stepId — update a step
router.patch('/automations/steps/:stepId', async (req, res) => {
  const eff = getEffectiveRole(req);
  if (eff !== 'superadmin' && eff !== 'admin') return res.status(403).json({ message: 'Insufficient permissions' });
  try {
    const { stepId } = req.params;
    const payload = stepUpdateSchema.parse(req.body);

    const setClauses = [];
    const params = [stepId];
    let i = 2;

    if (payload.step_type !== undefined) { setClauses.push(`step_type = $${i++}`); params.push(payload.step_type); }
    if (payload.action_type !== undefined) { setClauses.push(`action_type = $${i++}`); params.push(payload.action_type); }
    if (payload.action_config !== undefined) { setClauses.push(`action_config = $${i++}`); params.push(JSON.stringify(payload.action_config)); }
    if (payload.condition_group !== undefined) {
      setClauses.push(`condition_group = $${i++}`);
      params.push(payload.condition_group ? JSON.stringify(payload.condition_group) : null);
    }

    if (setClauses.length === 0) return res.status(400).json({ message: 'No fields to update' });

    const { rows } = await query(
      `UPDATE task_automation_steps SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      params
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Step not found' });
    await logSecurityEvent({
      userId: req.user.id,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCESS,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: { action: 'automation_step_updated', stepId, changedFields: Object.keys(payload) }
    });
    return res.json({ step: rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:automations:steps:update]', err);
    return res.status(500).json({ message: 'Unable to update step' });
  }
});

// DELETE /automations/steps/:stepId — delete a step (FK cascades children)
router.delete('/automations/steps/:stepId', async (req, res) => {
  const eff = getEffectiveRole(req);
  if (eff !== 'superadmin' && eff !== 'admin') return res.status(403).json({ message: 'Insufficient permissions' });
  try {
    const { stepId } = req.params;
    const { rowCount } = await query('DELETE FROM task_automation_steps WHERE id = $1', [stepId]);
    if (rowCount === 0) return res.status(404).json({ message: 'Step not found' });
    await logSecurityEvent({
      userId: req.user.id,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCESS,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: { action: 'automation_step_deleted', stepId }
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[tasks:automations:steps:delete]', err);
    return res.status(500).json({ message: 'Unable to delete step' });
  }
});

// POST /automations/steps/:stepId/reorder — change step_order (reindexes all siblings)
router.post('/automations/steps/:stepId/reorder', async (req, res) => {
  const eff = getEffectiveRole(req);
  if (eff !== 'superadmin' && eff !== 'admin') return res.status(403).json({ message: 'Insufficient permissions' });
  const client = await getClient();
  try {
    const { stepId } = req.params;
    const payload = stepReorderSchema.parse(req.body);

    await client.query('BEGIN');

    // Look up the target step to find its automation + parent
    const { rows: targetRows } = await client.query('SELECT * FROM task_automation_steps WHERE id = $1', [stepId]);
    if (!targetRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Step not found' }); }
    const target = targetRows[0];

    // Fetch all siblings (same automation, scope, parent) ordered by step_order, locked for update
    const parentClause = target.parent_step_id
      ? 'AND parent_step_id = $3'
      : 'AND parent_step_id IS NULL';
    const siblingParams = [target.automation_id, target.automation_scope];
    if (target.parent_step_id) siblingParams.push(target.parent_step_id);
    const { rows: siblings } = await client.query(
      `SELECT id FROM task_automation_steps
       WHERE automation_id = $1 AND automation_scope = $2 ${parentClause}
       ORDER BY step_order ASC
       FOR UPDATE`,
      siblingParams
    );

    // Remove moved step and insert at new position
    const ids = siblings.map(s => s.id).filter(id => id !== stepId);
    const newPos = Math.max(0, Math.min(payload.step_order, ids.length));
    ids.splice(newPos, 0, stepId);

    // Update all siblings with contiguous step_order values
    for (let idx = 0; idx < ids.length; idx++) {
      await client.query('UPDATE task_automation_steps SET step_order = $2 WHERE id = $1', [ids[idx], idx]);
    }

    const { rows } = await client.query('SELECT * FROM task_automation_steps WHERE id = $1', [stepId]);
    await client.query('COMMIT');

    await logSecurityEvent({
      userId: req.user.id,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCESS,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: { action: 'automation_step_reordered', stepId, newOrder: payload.step_order }
    });
    return res.json({ step: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.issues[0]?.message || 'Invalid payload' });
    console.error('[tasks:automations:steps:reorder]', err);
    return res.status(500).json({ message: 'Unable to reorder step' });
  } finally {
    client.release();
  }
});

// GET /automations/quota — current month quota usage
router.get('/automations/quota', async (req, res) => {
  const eff = getEffectiveRole(req);
  if (eff !== 'superadmin' && eff !== 'admin') return res.status(403).json({ message: 'Insufficient permissions' });
  try {
    const periodStart = new Date().toISOString().slice(0, 7) + '-01';
    const { rows } = await query(
      `SELECT * FROM task_automation_quota WHERE period_start = $1`,
      [periodStart]
    );
    const quota = rows[0] || { period_start: periodStart, actions_consumed: 0, actions_limit: 10000 };
    return res.json({ quota });
  } catch (err) {
    console.error('[tasks:automations:quota]', err);
    return res.status(500).json({ message: 'Unable to load quota' });
  }
});

// GET /automations/:automationId/runs — workflow runs for one automation
router.get('/automations/:automationId/runs', async (req, res) => {
  const eff = getEffectiveRole(req);
  if (eff !== 'superadmin' && eff !== 'admin') return res.status(403).json({ message: 'Insufficient permissions' });
  try {
    const { automationId } = req.params;
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 50)));
    const { rows } = await query(
      `SELECT * FROM task_workflow_runs
       WHERE automation_id = $1
       ORDER BY started_at DESC
       LIMIT $2`,
      [automationId, limit]
    );
    return res.json({ runs: rows });
  } catch (err) {
    console.error('[tasks:automations:workflow-runs]', err);
    return res.status(500).json({ message: 'Unable to load workflow runs' });
  }
});

// GET /automations/runs/:runId/steps — per-step execution details for a workflow run
router.get('/automations/runs/:runId/steps', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  if (eff !== 'superadmin' && eff !== 'admin') return res.status(403).json({ message: 'Insufficient permissions' });
  try {
    const { runId } = req.params;
    // Verify ownership of parent run
    const { rows: runRows } = await query('SELECT * FROM task_workflow_runs WHERE id = $1', [runId]);
    if (!runRows.length) return res.status(404).json({ message: 'Workflow run not found' });
    const run = runRows[0];
    if (run.automation_scope === 'board' && run.board_id) {
      const workspaceId = await getWorkspaceIdForBoard(run.board_id);
      if (workspaceId) {
        const ok = await assertWorkspaceAccess({ effRole: eff, userId, workspaceId });
        if (!ok) return res.status(403).json({ message: 'Insufficient permissions' });
      }
    }
    const { rows } = await query(
      `SELECT * FROM task_workflow_step_runs
       WHERE workflow_run_id = $1
       ORDER BY started_at ASC`,
      [runId]
    );
    return res.json({ step_runs: rows });
  } catch (err) {
    console.error('[tasks:automations:step-runs]', err);
    return res.status(500).json({ message: 'Unable to load step runs' });
  }
});

// POST /automations/:automationId/test — dry-run (evaluate conditions without executing actions)
router.post('/automations/:automationId/test', async (req, res) => {
  const eff = getEffectiveRole(req);
  if (eff !== 'superadmin' && eff !== 'admin') return res.status(403).json({ message: 'Insufficient permissions' });
  try {
    const { automationId } = req.params;
    const { automation, scope } = await findAutomationAndScope(automationId);
    if (!automation) return res.status(404).json({ message: 'Automation not found' });

    // Load steps
    const { rows: steps } = await query(
      `SELECT * FROM task_automation_steps
       WHERE automation_id = $1 AND automation_scope = $2
       ORDER BY step_order ASC`,
      [automationId, scope]
    );

    // Build a mock context from request body or defaults
    const mockEvent = req.body.event || {};
    const mockContext = req.body.context || {
      item: { id: 'test', name: 'Test Item', status: 'Working' },
      event: mockEvent,
      actor: { id: req.user.id, email: req.user.email },
      board: {},
      workspace: {},
      assignees: [],
      trigger: { type: automation.trigger_type },
      date: { now: new Date().toISOString(), today: new Date().toISOString().slice(0, 10) }
    };

    // Evaluate each step's conditions without executing actions
    const { evaluateConditionGroup: evalCond } = await import('../services/conditionEvaluator.js');
    const results = steps.map(step => {
      const condResult = step.condition_group ? evalCond(step.condition_group, mockContext) : null;
      return {
        id: step.id,
        step_type: step.step_type,
        step_order: step.step_order,
        action_type: step.action_type,
        condition_result: condResult,
        parent_step_id: step.parent_step_id
      };
    });

    await logSecurityEvent({
      userId: req.user.id,
      eventType: SecurityEventTypes.SENSITIVE_ACTION,
      eventCategory: SecurityEventCategories.ACCESS,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: { action: 'automation_tested', automationId, scope, stepsCount: steps.length }
    });
    return res.json({
      automation: { id: automation.id, name: automation.name, scope },
      steps_count: steps.length,
      step_results: results,
      dry_run: true
    });
  } catch (err) {
    console.error('[tasks:automations:test]', err);
    return res.status(500).json({ message: 'Unable to test automation' });
  }
});

// ─── Dependencies ────────────────────────────────────────────────────

// GET /items/:itemId/dependencies — predecessors + successors
router.get('/items/:itemId/dependencies', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { rows: predecessors } = await query(
      `SELECT d.*, i.name AS item_name, i.status AS item_status
       FROM task_item_dependencies d
       JOIN task_items i ON i.id = d.predecessor_id
       WHERE d.successor_id = $1`,
      [itemId]
    );
    const { rows: successors } = await query(
      `SELECT d.*, i.name AS item_name, i.status AS item_status
       FROM task_item_dependencies d
       JOIN task_items i ON i.id = d.successor_id
       WHERE d.predecessor_id = $1`,
      [itemId]
    );
    res.json({ predecessors, successors });
  } catch (err) {
    console.error('[tasks] GET /items/:id/dependencies error:', err.message);
    res.status(500).json({ error: 'Failed to fetch dependencies' });
  }
});

// POST /items/:itemId/dependencies — add a dependency with cycle detection
router.post('/items/:itemId/dependencies', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { predecessor_id } = req.body;
    if (!predecessor_id) return res.status(400).json({ error: 'predecessor_id required' });
    if (predecessor_id === itemId) return res.status(400).json({ error: 'Cannot depend on self' });

    // Cycle detection: DFS from predecessor_id's predecessors to check if itemId is reachable
    const visited = new Set();
    const stack = [predecessor_id];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === itemId) {
        return res.status(400).json({ error: 'Circular dependency detected' });
      }
      if (visited.has(current)) continue;
      visited.add(current);
      const { rows: preds } = await query(
        'SELECT predecessor_id FROM task_item_dependencies WHERE successor_id = $1',
        [current]
      );
      for (const p of preds) stack.push(p.predecessor_id);
    }

    const { rows } = await query(
      `INSERT INTO task_item_dependencies (predecessor_id, successor_id, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (predecessor_id, successor_id) DO NOTHING
       RETURNING *`,
      [predecessor_id, itemId, req.user.id]
    );

    // Emit event
    try {
      const ctx = await resolveItemContext(itemId);
      emitTaskEvent({
        event_type: 'dependency.added',
        entity_type: 'dependency',
        entity_id: rows[0]?.id || itemId,
        actor_id: req.user.id,
        workspace_id: ctx.workspace_id,
        board_id: ctx.board_id,
        item_id: itemId,
        new_value: { predecessor_id }
      });
    } catch { /* best-effort */ }

    res.status(201).json({ dependency: rows[0] || null });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Dependency already exists' });
    console.error('[tasks] POST /items/:id/dependencies error:', err.message);
    res.status(500).json({ error: 'Failed to add dependency' });
  }
});

// DELETE /items/:itemId/dependencies/:depId — remove a dependency
router.delete('/items/:itemId/dependencies/:depId', async (req, res) => {
  try {
    const { depId } = req.params;
    await query('DELETE FROM task_item_dependencies WHERE id = $1', [depId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks] DELETE dependency error:', err.message);
    res.status(500).json({ error: 'Failed to remove dependency' });
  }
});

// ─── Content Governance ─────────────────────────────────────────────

// POST /governance/transfer — bulk transfer owned entities from one user to another
router.post('/governance/transfer', async (req, res) => {
  try {
    const { from_user_id, to_user_id, workspace_id } = req.body;
    if (!from_user_id || !to_user_id || !workspace_id) {
      return res.status(400).json({ error: 'from_user_id, to_user_id, workspace_id required' });
    }
    if (from_user_id === to_user_id) {
      return res.status(400).json({ error: 'Cannot transfer to same user' });
    }

    // Only superadmin/admin can transfer
    if (!['superadmin', 'admin'].includes(req.user.effective_role)) {
      return res.status(403).json({ error: 'Only admins can transfer content' });
    }

    const transferred = { boards: 0, automations: 0, dashboards: 0, items_created: 0 };

    // Atomic: every ownership-reassign write commits together. A mid-sequence
    // failure (e.g. assignee conflict, network blip) would otherwise leave
    // the workspace half-transferred — boards owned by the new user, items
    // still owned by the old one — with no resume path. Under HIPAA the
    // audit trail must reflect the actual end-state, so the event row is
    // written inside the same transaction.
    const db = await getClient();
    let eventPayload;
    try {
      await db.query('BEGIN');

      // Transfer board ownership (created_by)
      const { rowCount: boardCount } = await db.query(
        `UPDATE task_boards SET created_by = $1
         WHERE created_by = $2 AND workspace_id = $3`,
        [to_user_id, from_user_id, workspace_id]
      );
      transferred.boards = boardCount;

      // Transfer automation ownership
      const { rowCount: autoCount } = await db.query(
        `UPDATE task_board_automations SET created_by = $1
         WHERE created_by = $2 AND board_id IN (
           SELECT id FROM task_boards WHERE workspace_id = $3
         )`,
        [to_user_id, from_user_id, workspace_id]
      );
      const { rowCount: globalAutoCount } = await db.query(
        `UPDATE task_global_automations SET created_by = $1
         WHERE created_by = $2 AND workspace_id = $3`,
        [to_user_id, from_user_id, workspace_id]
      );
      transferred.automations = autoCount + globalAutoCount;

      // Transfer dashboard ownership
      const { rowCount: dashCount } = await db.query(
        `UPDATE task_dashboards SET created_by = $1
         WHERE created_by = $2 AND workspace_id = $3`,
        [to_user_id, from_user_id, workspace_id]
      );
      transferred.dashboards = dashCount;

      // Re-assign items created by this user
      const { rowCount: itemCount } = await db.query(
        `UPDATE task_items SET created_by = $1
         WHERE created_by = $2 AND group_id IN (
           SELECT g.id FROM task_groups g
           JOIN task_boards b ON b.id = g.board_id
           WHERE b.workspace_id = $3
         )`,
        [to_user_id, from_user_id, workspace_id]
      );
      transferred.items_created = itemCount;

      // Re-assign task item assignees: delete the source user's rows and
      // re-insert them under the target user. ON CONFLICT skips items the
      // target already owns, so this is conflict-safe and atomic in one query.
      // (UPDATE ... ON CONFLICT is invalid Postgres — ON CONFLICT is INSERT-only.)
      await db.query(
        `WITH moved AS (
           DELETE FROM task_item_assignees
           WHERE user_id = $2 AND item_id IN (
             SELECT i.id FROM task_items i
             JOIN task_groups g ON g.id = i.group_id
             JOIN task_boards b ON b.id = g.board_id
             WHERE b.workspace_id = $3
           )
           RETURNING item_id
         )
         INSERT INTO task_item_assignees (item_id, user_id)
         SELECT item_id, $1
         FROM moved
         ON CONFLICT (item_id, user_id) DO NOTHING`,
        [to_user_id, from_user_id, workspace_id]
      );

      eventPayload = {
        event_type: 'governance.content_transferred',
        workspace_id: workspace_id,
        entity_type: 'user',
        entity_id: from_user_id,
        actor_id: req.user.id,
        metadata: { from_user_id, to_user_id, transferred }
      };
      await persistTaskEventInTx(db, eventPayload);
      await db.query('COMMIT');
    } catch (txErr) {
      try { await db.query('ROLLBACK'); } catch { /* noop */ }
      throw txErr;
    } finally {
      db.release();
    }

    fireTaskEventSubscribers(eventPayload);
    res.json({ ok: true, transferred });
  } catch (err) {
    console.error('[tasks] POST governance/transfer error:', err.message);
    res.status(500).json({ error: 'Failed to transfer content' });
  }
});

// ─── Webhooks ───────────────────────────────────────────────────────

// GET /webhooks — list webhooks for workspace
router.get('/webhooks', async (req, res) => {
  try {
    const { workspace_id } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
    const { rows } = await query(
      `SELECT * FROM task_webhooks WHERE workspace_id = $1 ORDER BY created_at DESC`,
      [workspace_id]
    );
    res.json({ webhooks: rows });
  } catch (err) {
    console.error('[tasks] GET webhooks error:', err.message);
    res.status(500).json({ error: 'Failed to fetch webhooks' });
  }
});

// POST /webhooks — create a webhook
router.post('/webhooks', async (req, res) => {
  try {
    const { workspace_id, name, url, secret, event_types = [] } = req.body;
    if (!workspace_id || !name || !url) return res.status(400).json({ error: 'workspace_id, name, url required' });
    const { rows } = await query(
      `INSERT INTO task_webhooks (workspace_id, name, url, secret, event_types, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [workspace_id, name, url, secret || null, event_types, req.user.id]
    );
    res.status(201).json({ webhook: rows[0] });
  } catch (err) {
    console.error('[tasks] POST webhook error:', err.message);
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

// PATCH /webhooks/:id — update a webhook
router.patch('/webhooks/:id', async (req, res) => {
  try {
    const { name, url, secret, event_types, is_active } = req.body;
    const sets = [];
    const values = [];
    let idx = 1;
    if (name !== undefined) { sets.push(`name = $${idx}`); values.push(name); idx++; }
    if (url !== undefined) { sets.push(`url = $${idx}`); values.push(url); idx++; }
    if (secret !== undefined) { sets.push(`secret = $${idx}`); values.push(secret); idx++; }
    if (event_types !== undefined) { sets.push(`event_types = $${idx}`); values.push(event_types); idx++; }
    if (is_active !== undefined) { sets.push(`is_active = $${idx}`); values.push(is_active); idx++; }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    sets.push(`updated_at = NOW()`);
    values.push(req.params.id);
    const { rows } = await query(
      `UPDATE task_webhooks SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ webhook: rows[0] });
  } catch (err) {
    console.error('[tasks] PATCH webhook error:', err.message);
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

// DELETE /webhooks/:id — delete a webhook
router.delete('/webhooks/:id', async (req, res) => {
  try {
    await query('DELETE FROM task_webhooks WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks] DELETE webhook error:', err.message);
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

// GET /webhooks/:id/deliveries — delivery log for a webhook
router.get('/webhooks/:id/deliveries', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM task_webhook_deliveries WHERE webhook_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.params.id]
    );
    res.json({ deliveries: rows });
  } catch (err) {
    console.error('[tasks] GET webhook deliveries error:', err.message);
    res.status(500).json({ error: 'Failed to fetch deliveries' });
  }
});

// POST /webhooks/:id/test — send a test event
router.post('/webhooks/:id/test', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM task_webhooks WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Webhook not found' });
    const webhook = rows[0];

    const payload = {
      event: 'test',
      webhook_id: webhook.id,
      timestamp: new Date().toISOString(),
      data: { message: 'This is a test webhook delivery' }
    };

    try {
      const resp = await fetch(webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
      });

      await query(
        `INSERT INTO task_webhook_deliveries (webhook_id, event_type, payload, response_status, status, delivered_at)
         VALUES ($1, 'test', $2, $3, $4, NOW())`,
        [webhook.id, JSON.stringify(payload), resp.status, resp.ok ? 'success' : 'failed']
      );

      res.json({ ok: resp.ok, status: resp.status });
    } catch (err) {
      await query(
        `INSERT INTO task_webhook_deliveries (webhook_id, event_type, payload, status, error)
         VALUES ($1, 'test', $2, 'failed', $3)`,
        [webhook.id, JSON.stringify(payload), err.message]
      );
      res.json({ ok: false, error: err.message });
    }
  } catch (err) {
    console.error('[tasks] POST webhook test error:', err.message);
    res.status(500).json({ error: 'Failed to test webhook' });
  }
});

// ─── Rate Cards ─────────────────────────────────────────────────────

// GET /rate-cards — list rate cards for workspace
router.get('/rate-cards', async (req, res) => {
  try {
    const { workspace_id } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
    const { rows } = await query(
      `SELECT r.*, u.first_name, u.last_name, b.name AS board_name
       FROM task_rate_cards r
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN task_boards b ON b.id = r.board_id
       WHERE r.workspace_id = $1
       ORDER BY r.created_at DESC`,
      [workspace_id]
    );
    res.json({ rate_cards: rows });
  } catch (err) {
    console.error('[tasks] GET rate-cards error:', err.message);
    res.status(500).json({ error: 'Failed to fetch rate cards' });
  }
});

// POST /rate-cards — create a rate card
router.post('/rate-cards', async (req, res) => {
  try {
    const { workspace_id, user_id, board_id, hourly_rate, currency = 'USD', effective_from } = req.body;
    if (!workspace_id || hourly_rate == null) return res.status(400).json({ error: 'workspace_id and hourly_rate required' });
    const { rows } = await query(
      `INSERT INTO task_rate_cards (workspace_id, user_id, board_id, hourly_rate, currency, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [workspace_id, user_id || null, board_id || null, hourly_rate, currency, effective_from || new Date(), req.user.id]
    );
    res.status(201).json({ rate_card: rows[0] });
  } catch (err) {
    console.error('[tasks] POST rate-card error:', err.message);
    res.status(500).json({ error: 'Failed to create rate card' });
  }
});

// DELETE /rate-cards/:id — delete a rate card
router.delete('/rate-cards/:id', async (req, res) => {
  try {
    await query('DELETE FROM task_rate_cards WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks] DELETE rate-card error:', err.message);
    res.status(500).json({ error: 'Failed to delete rate card' });
  }
});

// PATCH /time-entries/:id/approve — approve or reject a time entry
router.patch('/time-entries/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { approval_status } = req.body;  // 'approved' | 'rejected'
    if (!['approved', 'rejected'].includes(approval_status)) {
      return res.status(400).json({ error: 'approval_status must be approved or rejected' });
    }
    const { rows } = await query(
      `UPDATE task_time_entries SET approval_status = $1, approved_by = $2, approved_at = NOW()
       WHERE id = $3 RETURNING *`,
      [approval_status, req.user.id, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Time entry not found' });
    res.json({ time_entry: rows[0] });
  } catch (err) {
    console.error('[tasks] PATCH time-entry approve error:', err.message);
    res.status(500).json({ error: 'Failed to update approval status' });
  }
});

// GET /billing/cost-report — compute cost from time entries + rate cards
router.get('/billing/cost-report', async (req, res) => {
  try {
    const { workspace_id, from, to } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    let dateFilter = '';
    const values = [workspace_id];
    if (from) { dateFilter += ` AND te.created_at >= $${values.length + 1}`; values.push(from); }
    if (to) { dateFilter += ` AND te.created_at <= $${values.length + 1}`; values.push(to); }

    const { rows } = await query(
      `SELECT te.user_id, u.first_name, u.last_name,
              b.id AS board_id, b.name AS board_name,
              SUM(te.time_spent_minutes)::int AS total_minutes,
              SUM(te.billable_minutes)::int AS billable_minutes,
              COUNT(*)::int AS entry_count,
              COUNT(*) FILTER (WHERE te.approval_status = 'approved')::int AS approved_count
       FROM task_time_entries te
       JOIN task_items i ON i.id = te.item_id
       JOIN task_groups g ON g.id = i.group_id
       JOIN task_boards b ON b.id = g.board_id
       JOIN users u ON u.id = te.user_id
       WHERE b.workspace_id = $1 ${dateFilter}
       GROUP BY te.user_id, u.first_name, u.last_name, b.id, b.name
       ORDER BY u.first_name, b.name`,
      values
    );

    // Resolve rates
    const { rows: rates } = await query(
      `SELECT * FROM task_rate_cards WHERE workspace_id = $1 AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
       ORDER BY user_id NULLS LAST, board_id NULLS LAST`,
      [workspace_id]
    );

    const report = rows.map((r) => {
      // Find best matching rate: user+board > user > board > default
      const rate = rates.find((rc) => rc.user_id === r.user_id && rc.board_id === r.board_id)
        || rates.find((rc) => rc.user_id === r.user_id && !rc.board_id)
        || rates.find((rc) => !rc.user_id && rc.board_id === r.board_id)
        || rates.find((rc) => !rc.user_id && !rc.board_id)
        || { hourly_rate: 0, currency: 'USD' };

      const billableHours = (r.billable_minutes || 0) / 60;
      return {
        ...r,
        hourly_rate: parseFloat(rate.hourly_rate),
        currency: rate.currency,
        total_cost: Math.round(billableHours * parseFloat(rate.hourly_rate) * 100) / 100
      };
    });

    res.json({ report });
  } catch (err) {
    console.error('[tasks] GET cost-report error:', err.message);
    res.status(500).json({ error: 'Failed to generate cost report' });
  }
});

// ─── Cross-board Workload ────────────────────────────────────────────

// GET /workload — cross-board workload data per person
router.get('/workload', async (req, res) => {
  try {
    const { workspace_id } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    // Items per person per status across all boards in workspace
    const { rows: itemRows } = await query(
      `SELECT a.user_id, u.first_name, u.last_name, u.email, u.avatar_url,
              i.status, b.name AS board_name, b.id AS board_id,
              COUNT(*)::int AS count
       FROM task_item_assignees a
       JOIN task_items i ON i.id = a.item_id
       JOIN task_groups g ON g.id = i.group_id
       JOIN task_boards b ON b.id = g.board_id
       JOIN users u ON u.id = a.user_id
       WHERE b.workspace_id = $1 AND ${activeOnly('i')}
       GROUP BY a.user_id, u.first_name, u.last_name, u.email, u.avatar_url,
                i.status, b.name, b.id
       ORDER BY u.first_name, u.last_name`,
      [workspace_id]
    );

    // Time logged this week per person
    const { rows: timeRows } = await query(
      `SELECT te.user_id, SUM(te.time_spent_minutes)::int AS minutes_this_week
       FROM task_time_entries te
       JOIN task_items i ON i.id = te.item_id
       JOIN task_groups g ON g.id = i.group_id
       JOIN task_boards b ON b.id = g.board_id
       WHERE b.workspace_id = $1
         AND te.created_at >= date_trunc('week', NOW())
       GROUP BY te.user_id`,
      [workspace_id]
    );

    const timeByUser = {};
    timeRows.forEach((r) => { timeByUser[r.user_id] = r.minutes_this_week; });

    // Overdue items per person
    const { rows: overdueRows } = await query(
      `SELECT a.user_id, COUNT(*)::int AS overdue_count
       FROM task_item_assignees a
       JOIN task_items i ON i.id = a.item_id
       JOIN task_groups g ON g.id = i.group_id
       JOIN task_boards b ON b.id = g.board_id
       WHERE b.workspace_id = $1 AND ${activeOnly('i')}
         AND i.due_date < NOW()
       GROUP BY a.user_id`,
      [workspace_id]
    );

    const overdueByUser = {};
    overdueRows.forEach((r) => { overdueByUser[r.user_id] = r.overdue_count; });

    // Aggregate per person
    const people = {};
    itemRows.forEach((r) => {
      if (!people[r.user_id]) {
        people[r.user_id] = {
          user_id: r.user_id,
          first_name: r.first_name,
          last_name: r.last_name,
          email: r.email,
          avatar_url: r.avatar_url,
          total_items: 0,
          status_counts: {},
          board_counts: {},
          minutes_this_week: timeByUser[r.user_id] || 0,
          overdue: overdueByUser[r.user_id] || 0
        };
      }
      const p = people[r.user_id];
      p.total_items += r.count;
      p.status_counts[r.status] = (p.status_counts[r.status] || 0) + r.count;
      p.board_counts[r.board_name] = (p.board_counts[r.board_name] || 0) + r.count;
    });

    res.json({ workload: Object.values(people) });
  } catch (err) {
    console.error('[tasks] GET /workload error:', err.message);
    res.status(500).json({ error: 'Failed to fetch workload data' });
  }
});

// ─── Baselines & Critical Path ───────────────────────────────────────

// POST /boards/:boardId/baselines — save a baseline snapshot
router.post('/boards/:boardId/baselines', async (req, res) => {
  try {
    const { boardId } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    // Snapshot current items with dates
    const { rows: items } = await query(
      `SELECT i.id AS item_id, i.name, i.start_date, i.due_date, i.status
       FROM task_items i
       JOIN task_groups g ON g.id = i.group_id
       WHERE g.board_id = $1 AND ${activeOnly('i')}
       ORDER BY i.due_date NULLS LAST`,
      [boardId]
    );

    const { rows } = await query(
      `INSERT INTO task_baselines (board_id, name, snapshot, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [boardId, name, JSON.stringify(items), req.user.id]
    );

    res.status(201).json({ baseline: rows[0] });
  } catch (err) {
    console.error('[tasks] POST baselines error:', err.message);
    res.status(500).json({ error: 'Failed to save baseline' });
  }
});

// GET /boards/:boardId/baselines — list baselines for a board
router.get('/boards/:boardId/baselines', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, name, created_at, created_by FROM task_baselines
       WHERE board_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [req.params.boardId]
    );
    res.json({ baselines: rows });
  } catch (err) {
    console.error('[tasks] GET baselines error:', err.message);
    res.status(500).json({ error: 'Failed to fetch baselines' });
  }
});

// GET /baselines/:baselineId — get a specific baseline with snapshot data
router.get('/baselines/:baselineId', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM task_baselines WHERE id = $1', [req.params.baselineId]);
    if (!rows.length) return res.status(404).json({ error: 'Baseline not found' });
    res.json({ baseline: rows[0] });
  } catch (err) {
    console.error('[tasks] GET baseline error:', err.message);
    res.status(500).json({ error: 'Failed to fetch baseline' });
  }
});

// DELETE /baselines/:baselineId — delete a baseline
router.delete('/baselines/:baselineId', async (req, res) => {
  try {
    await query('DELETE FROM task_baselines WHERE id = $1', [req.params.baselineId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks] DELETE baseline error:', err.message);
    res.status(500).json({ error: 'Failed to delete baseline' });
  }
});

// GET /boards/:boardId/critical-path — compute critical path via longest dependency chain
router.get('/boards/:boardId/critical-path', async (req, res) => {
  try {
    const { boardId } = req.params;

    // Get all items and dependencies on this board
    const { rows: items } = await query(
      `SELECT i.id, i.name, i.status, i.start_date, i.due_date
       FROM task_items i
       JOIN task_groups g ON g.id = i.group_id
       WHERE g.board_id = $1 AND ${activeOnly('i')}`,
      [boardId]
    );

    const itemIds = new Set(items.map((i) => i.id));

    const { rows: deps } = await query(
      `SELECT d.predecessor_id, d.successor_id, d.dependency_type
       FROM task_item_dependencies d
       WHERE d.predecessor_id = ANY($1) OR d.successor_id = ANY($1)`,
      [Array.from(itemIds)]
    );

    // Filter deps to only those where both sides are on this board
    const boardDeps = deps.filter((d) => itemIds.has(d.predecessor_id) && itemIds.has(d.successor_id));

    if (!boardDeps.length) {
      return res.json({ critical_path: [], total_days: 0 });
    }

    // Build adjacency list
    const adj = {};
    const inDegree = {};
    for (const id of itemIds) {
      adj[id] = [];
      inDegree[id] = 0;
    }
    for (const dep of boardDeps) {
      adj[dep.predecessor_id].push(dep.successor_id);
      inDegree[dep.successor_id] = (inDegree[dep.successor_id] || 0) + 1;
    }

    // Find longest path using topological sort + dynamic programming
    const dist = {};
    const prev = {};
    for (const id of itemIds) { dist[id] = 0; prev[id] = null; }

    // Topological sort (Kahn's algorithm)
    const queue = [];
    for (const id of itemIds) {
      if (inDegree[id] === 0) queue.push(id);
    }
    const order = [];
    while (queue.length) {
      const node = queue.shift();
      order.push(node);
      for (const neighbor of (adj[node] || [])) {
        inDegree[neighbor]--;
        if (inDegree[neighbor] === 0) queue.push(neighbor);
      }
    }

    // Longest path
    for (const node of order) {
      for (const neighbor of (adj[node] || [])) {
        if (dist[node] + 1 > dist[neighbor]) {
          dist[neighbor] = dist[node] + 1;
          prev[neighbor] = node;
        }
      }
    }

    // Find the end of the longest path
    let endNode = null;
    let maxDist = 0;
    for (const [id, d] of Object.entries(dist)) {
      if (d > maxDist) { maxDist = d; endNode = id; }
    }

    // Trace back the critical path
    const path = [];
    let current = endNode;
    while (current) {
      path.unshift(current);
      current = prev[current];
    }

    const itemMap = {};
    items.forEach((i) => { itemMap[i.id] = i; });

    const criticalPath = path.map((id) => itemMap[id]).filter(Boolean);

    // Compute total days from first start to last due
    let totalDays = 0;
    if (criticalPath.length >= 2) {
      const starts = criticalPath.map((i) => i.start_date || i.due_date).filter(Boolean).map((d) => new Date(d));
      const ends = criticalPath.map((i) => i.due_date).filter(Boolean).map((d) => new Date(d));
      if (starts.length && ends.length) {
        const earliest = new Date(Math.min(...starts));
        const latest = new Date(Math.max(...ends));
        totalDays = Math.round((latest - earliest) / (1000 * 60 * 60 * 24));
      }
    }

    res.json({ critical_path: criticalPath, total_days: totalDays });
  } catch (err) {
    console.error('[tasks] GET critical-path error:', err.message);
    res.status(500).json({ error: 'Failed to compute critical path' });
  }
});

// ─── Audit Log ──────────────────────────────────────────────────────

// GET /audit-log — query task events with filters
router.get('/audit-log', async (req, res) => {
  try {
    const { workspace_id, board_id, event_type, actor_id, entity_type, limit = 100, offset = 0, from, to } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    const conditions = ['e.workspace_id = $1'];
    const values = [workspace_id];
    let idx = 2;

    if (board_id) { conditions.push(`e.board_id = $${idx}`); values.push(board_id); idx++; }
    if (event_type) { conditions.push(`e.event_type = $${idx}`); values.push(event_type); idx++; }
    if (actor_id) { conditions.push(`e.actor_id = $${idx}`); values.push(actor_id); idx++; }
    if (entity_type) { conditions.push(`e.entity_type = $${idx}`); values.push(entity_type); idx++; }
    if (from) { conditions.push(`e.created_at >= $${idx}`); values.push(from); idx++; }
    if (to) { conditions.push(`e.created_at <= $${idx}`); values.push(to); idx++; }

    const where = conditions.join(' AND ');

    const { rows: events } = await query(
      `SELECT e.*, u.first_name, u.last_name, u.email AS actor_email,
              i.name AS item_name, b.name AS board_name
       FROM task_events e
       LEFT JOIN users u ON u.id = e.actor_id
       LEFT JOIN task_items i ON i.id = e.item_id
       LEFT JOIN task_boards b ON b.id = e.board_id
       WHERE ${where}
       ORDER BY e.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, Math.min(parseInt(limit) || 100, 500), parseInt(offset) || 0]
    );

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total FROM task_events e WHERE ${where}`,
      values
    );

    res.json({ events, total: countRows[0]?.total || 0 });
  } catch (err) {
    console.error('[tasks] GET /audit-log error:', err.message);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// GET /audit-log/event-types — distinct event types for filter dropdown
router.get('/audit-log/event-types', async (req, res) => {
  try {
    const { workspace_id } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
    const { rows } = await query(
      `SELECT DISTINCT event_type FROM task_events WHERE workspace_id = $1 ORDER BY event_type`,
      [workspace_id]
    );
    res.json({ event_types: rows.map((r) => r.event_type) });
  } catch (err) {
    console.error('[tasks] GET /audit-log/event-types error:', err.message);
    res.status(500).json({ error: 'Failed to fetch event types' });
  }
});

// ─── Mirror Columns ─────────────────────────────────────────────────

// GET /boards/:boardId/mirror-columns — list mirror columns for a board
router.get('/boards/:boardId/mirror-columns', async (req, res) => {
  try {
    const { boardId } = req.params;
    const { rows } = await query(
      `SELECT * FROM task_mirror_columns WHERE board_id = $1 ORDER BY order_index`,
      [boardId]
    );
    res.json({ mirror_columns: rows });
  } catch (err) {
    console.error('[tasks] GET mirror-columns error:', err.message);
    res.status(500).json({ error: 'Failed to fetch mirror columns' });
  }
});

// POST /boards/:boardId/mirror-columns — create a mirror column
router.post('/boards/:boardId/mirror-columns', async (req, res) => {
  try {
    const { boardId } = req.params;
    const { name, source_field, link_type = 'related', aggregation = 'first' } = req.body;
    if (!name || !source_field) return res.status(400).json({ error: 'name and source_field required' });

    const { rows } = await query(
      `INSERT INTO task_mirror_columns (board_id, name, source_field, link_type, aggregation, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [boardId, name, source_field, link_type, aggregation, req.user.id]
    );
    res.status(201).json({ mirror_column: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A mirror column with that name already exists on this board' });
    console.error('[tasks] POST mirror-column error:', err.message);
    res.status(500).json({ error: 'Failed to create mirror column' });
  }
});

// DELETE /mirror-columns/:id — delete a mirror column
router.delete('/mirror-columns/:id', async (req, res) => {
  try {
    await query('DELETE FROM task_mirror_columns WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks] DELETE mirror-column error:', err.message);
    res.status(500).json({ error: 'Failed to delete mirror column' });
  }
});

// GET /boards/:boardId/mirror-data — resolve mirror values for all items on a board
router.get('/boards/:boardId/mirror-data', async (req, res) => {
  try {
    const { boardId } = req.params;

    // Get mirror column definitions
    const { rows: mirrorCols } = await query(
      `SELECT * FROM task_mirror_columns WHERE board_id = $1 ORDER BY order_index`,
      [boardId]
    );
    if (!mirrorCols.length) return res.json({ mirror_columns: [], mirror_data: {} });

    // Get all items on this board
    const { rows: boardItems } = await query(
      `SELECT i.id FROM task_items i
       JOIN task_groups g ON g.id = i.group_id
       WHERE g.board_id = $1 AND ${activeOnly('i')}`,
      [boardId]
    );
    const itemIds = boardItems.map((i) => i.id);
    if (!itemIds.length) return res.json({ mirror_columns: mirrorCols, mirror_data: {} });

    // Get all outgoing links for these items
    const { rows: links } = await query(
      `SELECT l.source_item_id, l.target_item_id, l.link_type,
              i.id AS ti_id, i.name AS ti_name, i.status AS ti_status, i.due_date AS ti_due_date
       FROM task_item_links l
       JOIN task_items i ON i.id = l.target_item_id
       WHERE l.source_item_id = ANY($1)`,
      [itemIds]
    );

    // Also get incoming links
    const { rows: incomingLinks } = await query(
      `SELECT l.target_item_id AS source_item_id, l.source_item_id AS target_item_id, l.link_type,
              i.id AS ti_id, i.name AS ti_name, i.status AS ti_status, i.due_date AS ti_due_date
       FROM task_item_links l
       JOIN task_items i ON i.id = l.source_item_id
       WHERE l.target_item_id = ANY($1)`,
      [itemIds]
    );

    const allLinks = [...links, ...incomingLinks];

    // Resolve mirror values per item per column
    const mirrorData = {};
    for (const itemId of itemIds) {
      mirrorData[itemId] = {};
      for (const col of mirrorCols) {
        const relevantLinks = allLinks.filter(
          (l) => l.source_item_id === itemId && l.link_type === col.link_type
        );

        if (!relevantLinks.length) {
          mirrorData[itemId][col.id] = null;
          continue;
        }

        const values = relevantLinks.map((l) => {
          const fieldMap = {
            name: l.ti_name,
            status: l.ti_status,
            due_date: l.ti_due_date
          };
          return fieldMap[col.source_field] ?? null;
        }).filter((v) => v != null);

        switch (col.aggregation) {
          case 'first':
            mirrorData[itemId][col.id] = values[0] ?? null;
            break;
          case 'list':
            mirrorData[itemId][col.id] = values;
            break;
          case 'count':
            mirrorData[itemId][col.id] = values.length;
            break;
          case 'latest_date':
            mirrorData[itemId][col.id] = values.sort().reverse()[0] ?? null;
            break;
          case 'earliest_date':
            mirrorData[itemId][col.id] = values.sort()[0] ?? null;
            break;
          default:
            mirrorData[itemId][col.id] = values[0] ?? null;
        }
      }
    }

    res.json({ mirror_columns: mirrorCols, mirror_data: mirrorData });
  } catch (err) {
    console.error('[tasks] GET mirror-data error:', err.message);
    res.status(500).json({ error: 'Failed to resolve mirror data' });
  }
});

// ─── Item Links ──────────────────────────────────────────────────────

// GET /items/:itemId/links — list all links for an item
router.get('/items/:itemId/links', async (req, res) => {
  try {
    const { itemId } = req.params;
    // Get outgoing links (this item is source)
    const { rows: outgoing } = await query(
      `SELECT l.id, l.link_type, l.created_at,
              i.id AS linked_item_id, i.name AS linked_item_name, i.status AS linked_item_status,
              b.id AS linked_board_id, b.name AS linked_board_name,
              u.first_name || ' ' || u.last_name AS created_by_name
       FROM task_item_links l
       JOIN task_items i ON i.id = l.target_item_id
       JOIN task_groups g ON g.id = i.group_id
       JOIN task_boards b ON b.id = g.board_id
       LEFT JOIN users u ON u.id = l.created_by
       WHERE l.source_item_id = $1`,
      [itemId]
    );
    // Get incoming links (this item is target)
    const { rows: incoming } = await query(
      `SELECT l.id, l.link_type, l.created_at,
              i.id AS linked_item_id, i.name AS linked_item_name, i.status AS linked_item_status,
              b.id AS linked_board_id, b.name AS linked_board_name,
              u.first_name || ' ' || u.last_name AS created_by_name
       FROM task_item_links l
       JOIN task_items i ON i.id = l.source_item_id
       JOIN task_groups g ON g.id = i.group_id
       JOIN task_boards b ON b.id = g.board_id
       LEFT JOIN users u ON u.id = l.created_by
       WHERE l.target_item_id = $1`,
      [itemId]
    );

    const links = [
      ...outgoing.map((r) => ({
        id: r.id, link_type: r.link_type, direction: 'outgoing', created_at: r.created_at,
        created_by_name: r.created_by_name,
        linked_item: { id: r.linked_item_id, name: r.linked_item_name, status: r.linked_item_status, board_id: r.linked_board_id, board_name: r.linked_board_name }
      })),
      ...incoming.map((r) => ({
        id: r.id, link_type: r.link_type, direction: 'incoming', created_at: r.created_at,
        created_by_name: r.created_by_name,
        linked_item: { id: r.linked_item_id, name: r.linked_item_name, status: r.linked_item_status, board_id: r.linked_board_id, board_name: r.linked_board_name }
      }))
    ];

    res.json({ links });
  } catch (err) {
    console.error('[tasks] GET /items/:id/links error:', err.message);
    res.status(500).json({ error: 'Failed to fetch links' });
  }
});

// POST /items/:itemId/links — create a link to another item
router.post('/items/:itemId/links', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { target_item_id, link_type = 'related' } = req.body;
    if (!target_item_id) return res.status(400).json({ error: 'target_item_id is required' });
    if (target_item_id === itemId) return res.status(400).json({ error: 'Cannot link item to itself' });

    const validTypes = ['related', 'blocks', 'blocked_by', 'duplicate'];
    if (!validTypes.includes(link_type)) return res.status(400).json({ error: `Invalid link_type: ${link_type}` });

    const { rows } = await query(
      `INSERT INTO task_item_links (source_item_id, target_item_id, link_type, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source_item_id, target_item_id, link_type) DO NOTHING
       RETURNING *`,
      [itemId, target_item_id, link_type, req.user.id]
    );

    // Create inverse link for blocks/blocked_by
    if (link_type === 'blocks') {
      await query(
        `INSERT INTO task_item_links (source_item_id, target_item_id, link_type, created_by)
         VALUES ($1, $2, 'blocked_by', $3)
         ON CONFLICT (source_item_id, target_item_id, link_type) DO NOTHING`,
        [target_item_id, itemId, req.user.id]
      );
    } else if (link_type === 'blocked_by') {
      await query(
        `INSERT INTO task_item_links (source_item_id, target_item_id, link_type, created_by)
         VALUES ($1, $2, 'blocks', $3)
         ON CONFLICT (source_item_id, target_item_id, link_type) DO NOTHING`,
        [target_item_id, itemId, req.user.id]
      );
    }

    res.status(201).json({ link: rows[0] || null });
  } catch (err) {
    console.error('[tasks] POST /items/:id/links error:', err.message);
    res.status(500).json({ error: 'Failed to create link' });
  }
});

// DELETE /item-links/:linkId — remove a link (and inverse for blocks/blocked_by)
router.delete('/item-links/:linkId', async (req, res) => {
  try {
    const { linkId } = req.params;
    // Get the link first to handle inverse deletion
    const { rows } = await query('SELECT * FROM task_item_links WHERE id = $1', [linkId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Link not found' });

    const link = rows[0];
    await query('DELETE FROM task_item_links WHERE id = $1', [linkId]);

    // Remove inverse link for blocks/blocked_by
    if (link.link_type === 'blocks') {
      await query(
        `DELETE FROM task_item_links WHERE source_item_id = $1 AND target_item_id = $2 AND link_type = 'blocked_by'`,
        [link.target_item_id, link.source_item_id]
      );
    } else if (link.link_type === 'blocked_by') {
      await query(
        `DELETE FROM task_item_links WHERE source_item_id = $1 AND target_item_id = $2 AND link_type = 'blocks'`,
        [link.target_item_id, link.source_item_id]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks] DELETE item-link error:', err.message);
    res.status(500).json({ error: 'Failed to remove link' });
  }
});

// GET /items/search — search items across boards for linking.
// Optional workspaceId/boardId scope the search. For non-staff callers
// (defense-in-depth — the router is currently isStaff-only, but a future
// role expansion shouldn't silently widen this query) results are hard-
// scoped to the caller's workspace memberships.
router.get('/items/search', async (req, res) => {
  const eff = getEffectiveRole(req);
  const userId = req.user.id;
  const isStaffRole = eff === 'superadmin' || eff === 'admin' || eff === 'team';
  try {
    const { q, exclude_item_id, workspaceId, boardId } = req.query;
    if (!q || q.trim().length < 2) return res.json({ items: [] });

    const params = [`%${q.trim()}%`];
    const where = [activeOnly('i'), 'i.name ILIKE $1'];

    if (exclude_item_id) {
      params.push(exclude_item_id);
      where.push(`i.id != $${params.length}`);
    }
    if (boardId) {
      params.push(boardId);
      where.push(`b.id = $${params.length}`);
    }
    if (workspaceId) {
      params.push(workspaceId);
      where.push(`b.workspace_id = $${params.length}`);
    }
    if (!isStaffRole) {
      params.push(userId);
      where.push(`b.workspace_id IN (SELECT workspace_id FROM task_workspace_memberships WHERE user_id = $${params.length})`);
    }

    const { rows } = await query(
      `SELECT i.id, i.name, i.status, b.id AS board_id, b.name AS board_name
       FROM task_items i
       JOIN task_groups g ON g.id = i.group_id
       JOIN task_boards b ON b.id = g.board_id
       WHERE ${where.join(' AND ')}
       ORDER BY i.updated_at DESC
       LIMIT 20`,
      params
    );

    res.json({ items: rows });
  } catch (err) {
    console.error('[tasks] GET /items/search error:', err.message);
    res.status(500).json({ error: 'Failed to search items' });
  }
});

// ─── Recurrence ──────────────────────────────────────────────────────

// GET /items/:itemId/recurrence — get active recurrence rule
router.get('/items/:itemId/recurrence', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM task_recurrence_rules WHERE item_id = $1 AND is_active = true LIMIT 1',
      [req.params.itemId]
    );
    res.json({ recurrence: rows[0] || null });
  } catch (err) {
    console.error('[tasks] GET recurrence error:', err.message);
    res.status(500).json({ error: 'Failed to fetch recurrence' });
  }
});

// POST /items/:itemId/recurrence — create/update recurrence
router.post('/items/:itemId/recurrence', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { pattern, rrule } = req.body;
    if (!pattern) return res.status(400).json({ error: 'pattern required' });

    // Calculate next occurrence
    const nextOccurrence = calculateNextOccurrence(pattern);

    // Upsert: deactivate old rule, create new
    await query('UPDATE task_recurrence_rules SET is_active = false WHERE item_id = $1', [itemId]);
    const { rows } = await query(
      `INSERT INTO task_recurrence_rules (item_id, pattern, rrule, next_occurrence, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [itemId, pattern, rrule || null, nextOccurrence, req.user.id]
    );
    res.status(201).json({ recurrence: rows[0] });
  } catch (err) {
    console.error('[tasks] POST recurrence error:', err.message);
    res.status(500).json({ error: 'Failed to create recurrence' });
  }
});

// DELETE /items/:itemId/recurrence — deactivate recurrence
router.delete('/items/:itemId/recurrence', async (req, res) => {
  try {
    await query('UPDATE task_recurrence_rules SET is_active = false WHERE item_id = $1', [req.params.itemId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks] DELETE recurrence error:', err.message);
    res.status(500).json({ error: 'Failed to deactivate recurrence' });
  }
});

function calculateNextOccurrence(pattern) {
  const now = new Date();
  switch (pattern) {
    case 'daily': return new Date(now.getTime() + 86400000);
    case 'weekly': return new Date(now.getTime() + 7 * 86400000);
    case 'biweekly': return new Date(now.getTime() + 14 * 86400000);
    case 'monthly': {
      const next = new Date(now);
      next.setMonth(next.getMonth() + 1);
      return next;
    }
    default: return new Date(now.getTime() + 7 * 86400000);
  }
}

// ── Dashboards & Widgets (Phase 5) ────────────────────────────────

// Widget data aggregation — must be before :dashboardId routes
router.post('/dashboards/widget-data', async (req, res) => {
  try {
    const { widget_type, config } = req.body;
    const boardIds = config?.board_ids || [];
    const workspaceId = config?.workspace_id;

    // Build board filter
    let boardFilter = '';
    let filterValues = [];
    if (boardIds.length > 0) {
      boardFilter = `AND g.board_id = ANY($1)`;
      filterValues = [boardIds];
    } else if (workspaceId) {
      boardFilter = `AND b.workspace_id = $1`;
      filterValues = [workspaceId];
    }

    let data = null;

    switch (widget_type) {
      case 'status_breakdown': {
        const { rows } = await query(
          `SELECT i.status, COUNT(*)::int AS count
           FROM task_items i
           JOIN task_groups g ON g.id = i.group_id
           JOIN task_boards b ON b.id = g.board_id
           WHERE ${activeOnly('i')} ${boardFilter}
           GROUP BY i.status ORDER BY count DESC`,
          filterValues
        );
        data = rows;
        break;
      }
      case 'priority_distribution': {
        const { rows } = await query(
          `SELECT ld.label, ld.color, COUNT(*)::int AS count
           FROM task_item_labels il
           JOIN task_label_definitions ld ON ld.id = il.label_id
           JOIN task_items i ON i.id = il.item_id
           JOIN task_groups g ON g.id = i.group_id
           JOIN task_boards b ON b.id = g.board_id
           WHERE ld.category = 'priority' AND ${activeOnly('i')} ${boardFilter}
           GROUP BY ld.label, ld.color ORDER BY ld.order_index`,
          filterValues
        );
        data = rows;
        break;
      }
      case 'workload': {
        const { rows } = await query(
          `SELECT u.id, u.first_name, u.last_name, i.status, COUNT(*)::int AS count
           FROM task_item_assignees a
           JOIN users u ON u.id = a.user_id
           JOIN task_items i ON i.id = a.item_id
           JOIN task_groups g ON g.id = i.group_id
           JOIN task_boards b ON b.id = g.board_id
           WHERE ${activeOnly('i')} ${boardFilter}
           GROUP BY u.id, u.first_name, u.last_name, i.status
           ORDER BY u.first_name`,
          filterValues
        );
        data = rows;
        break;
      }
      case 'overdue': {
        const { rows } = await query(
          `SELECT i.id, i.name, i.status, i.due_date, g.board_id
           FROM task_items i
           JOIN task_groups g ON g.id = i.group_id
           JOIN task_boards b ON b.id = g.board_id
           WHERE ${activeOnly('i')} AND i.due_date < NOW() ${boardFilter}
           ORDER BY i.due_date ASC LIMIT 50`,
          filterValues
        );
        data = rows;
        break;
      }
      case 'kpi_number': {
        const metric = config?.metric || 'open_items';
        let result;
        if (metric === 'open_items') {
          result = await query(
            `SELECT COUNT(*)::int AS value FROM task_items i
             JOIN task_groups g ON g.id = i.group_id
             JOIN task_boards b ON b.id = g.board_id
             WHERE ${activeOnly('i')} ${boardFilter}`,
            filterValues
          );
        } else if (metric === 'completed_items') {
          result = await query(
            `SELECT COUNT(*)::int AS value FROM task_items i
             JOIN task_groups g ON g.id = i.group_id
             JOIN task_boards b ON b.id = g.board_id
             JOIN task_board_status_labels sl ON sl.board_id = g.board_id AND sl.label = i.status AND sl.is_done_state = true
             WHERE ${activeOnly('i')} ${boardFilter}`,
            filterValues
          );
        } else if (metric === 'overdue_items') {
          result = await query(
            `SELECT COUNT(*)::int AS value FROM task_items i
             JOIN task_groups g ON g.id = i.group_id
             JOIN task_boards b ON b.id = g.board_id
             WHERE ${activeOnly('i')} AND i.due_date < NOW() ${boardFilter}`,
            filterValues
          );
        } else {
          result = { rows: [{ value: 0 }] };
        }
        data = { metric, value: result.rows[0]?.value || 0 };
        break;
      }
      case 'recent_activity': {
        const { rows } = await query(
          `SELECT * FROM task_events
           WHERE workspace_id = $1
           ORDER BY created_at DESC LIMIT 20`,
          [workspaceId || filterValues[0]]
        );
        data = rows;
        break;
      }
      case 'label_distribution': {
        const { rows } = await query(
          `SELECT ld.label, ld.color, ld.category, COUNT(*)::int AS count
           FROM task_item_labels il
           JOIN task_label_definitions ld ON ld.id = il.label_id
           JOIN task_items i ON i.id = il.item_id
           JOIN task_groups g ON g.id = i.group_id
           JOIN task_boards b ON b.id = g.board_id
           WHERE ${activeOnly('i')} ${boardFilter}
           GROUP BY ld.label, ld.color, ld.category, ld.order_index ORDER BY ld.category, ld.order_index`,
          filterValues
        );
        data = rows;
        break;
      }
      case 'battery': {
        // Status breakdown as done vs total for progress visualization
        const { rows } = await query(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE sl.is_done_state = true)::int AS done
           FROM task_items i
           JOIN task_groups g ON g.id = i.group_id
           JOIN task_boards b ON b.id = g.board_id
           LEFT JOIN task_board_status_labels sl ON sl.board_id = b.id AND sl.label = i.status
           WHERE ${activeOnly('i')} ${boardFilter}`,
          filterValues
        );
        const row = rows[0] || { total: 0, done: 0 };
        data = { total: row.total, done: row.done, percent: row.total > 0 ? Math.round((row.done / row.total) * 100) : 0 };
        break;
      }
      case 'timeline': {
        // Items with due dates for mini gantt
        const { rows } = await query(
          `SELECT i.id, i.name, i.status, i.start_date, i.due_date,
                  b.name AS board_name
           FROM task_items i
           JOIN task_groups g ON g.id = i.group_id
           JOIN task_boards b ON b.id = g.board_id
           WHERE ${activeOnly('i')} AND i.due_date IS NOT NULL ${boardFilter}
           ORDER BY i.due_date ASC
           LIMIT 30`,
          filterValues
        );
        data = rows;
        break;
      }
      case 'items_table': {
        // Filterable items list from selected boards
        const statusFilter = config.status_filter ? `AND i.status = ANY($${filterValues.length + 1})` : '';
        const vals = [...filterValues];
        if (config.status_filter) vals.push(config.status_filter);
        const { rows } = await query(
          `SELECT i.id, i.name, i.status, i.due_date, i.needs_attention, i.created_at,
                  b.name AS board_name, g.name AS group_name
           FROM task_items i
           JOIN task_groups g ON g.id = i.group_id
           JOIN task_boards b ON b.id = g.board_id
           WHERE ${activeOnly('i')} ${boardFilter} ${statusFilter}
           ORDER BY i.updated_at DESC
           LIMIT 50`,
          vals
        );
        data = rows;
        break;
      }
      default:
        data = [];
    }

    res.json({ data });
  } catch (err) {
    console.error('[tasks] POST /dashboards/widget-data error:', err.message);
    res.status(500).json({ error: 'Failed to compute widget data' });
  }
});

// List dashboards for a workspace
router.get('/dashboards', async (req, res) => {
  try {
    const workspaceId = req.query.workspace_id;
    if (!workspaceId) return res.status(400).json({ error: 'workspace_id required' });
    const { limit, offset } = parsePagination(req.query);
    const [{ rows }, { rows: countRows }] = await Promise.all([
      query(
        `SELECT * FROM task_dashboards
         WHERE workspace_id = $1
         ORDER BY created_at ASC
         LIMIT $2 OFFSET $3`,
        [workspaceId, limit, offset]
      ),
      query(
        'SELECT COUNT(*)::int AS total FROM task_dashboards WHERE workspace_id = $1',
        [workspaceId]
      )
    ]);
    res.json({ dashboards: rows, meta: { limit, offset, total: countRows[0]?.total ?? rows.length } });
  } catch (err) {
    console.error('[tasks] GET /dashboards error:', err.message);
    res.status(500).json({ error: 'Failed to fetch dashboards' });
  }
});

// Create dashboard
router.post('/dashboards', async (req, res) => {
  try {
    const { workspace_id, name } = req.body;
    if (!workspace_id || !name) return res.status(400).json({ error: 'workspace_id and name required' });
    const { rows } = await query(
      'INSERT INTO task_dashboards (workspace_id, name, created_by) VALUES ($1, $2, $3) RETURNING *',
      [workspace_id, name, req.user.id]
    );
    res.status(201).json({ dashboard: rows[0] });
  } catch (err) {
    console.error('[tasks] POST /dashboards error:', err.message);
    res.status(500).json({ error: 'Failed to create dashboard' });
  }
});

// Update dashboard (name, layout)
router.patch('/dashboards/:dashboardId', async (req, res) => {
  try {
    const { dashboardId } = req.params;
    const { name, layout } = req.body;
    const fields = []; const values = []; let i = 1;
    if (name !== undefined) { fields.push(`name = $${i++}`); values.push(name); }
    if (layout !== undefined) { fields.push(`layout = $${i++}`); values.push(JSON.stringify(layout)); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    values.push(dashboardId);
    const { rows } = await query(
      `UPDATE task_dashboards SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Dashboard not found' });
    res.json({ dashboard: rows[0] });
  } catch (err) {
    console.error('[tasks] PATCH /dashboards error:', err.message);
    res.status(500).json({ error: 'Failed to update dashboard' });
  }
});

// Delete dashboard (cascades widgets)
router.delete('/dashboards/:dashboardId', async (req, res) => {
  try {
    await query('DELETE FROM task_dashboards WHERE id = $1', [req.params.dashboardId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks] DELETE /dashboards error:', err.message);
    res.status(500).json({ error: 'Failed to delete dashboard' });
  }
});

// Get all widgets for a dashboard
router.get('/dashboards/:dashboardId/widgets', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM task_dashboard_widgets WHERE dashboard_id = $1', [req.params.dashboardId]
    );
    res.json({ widgets: rows });
  } catch (err) {
    console.error('[tasks] GET widgets error:', err.message);
    res.status(500).json({ error: 'Failed to fetch widgets' });
  }
});

// Add widget to dashboard
router.post('/dashboards/:dashboardId/widgets', async (req, res) => {
  try {
    const { widget_type, config, position } = req.body;
    if (!widget_type) return res.status(400).json({ error: 'widget_type required' });
    const { rows } = await query(
      `INSERT INTO task_dashboard_widgets (dashboard_id, widget_type, config, position)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.dashboardId, widget_type, JSON.stringify(config || {}), JSON.stringify(position || { x: 0, y: 0, w: 6, h: 4 })]
    );
    res.status(201).json({ widget: rows[0] });
  } catch (err) {
    console.error('[tasks] POST widget error:', err.message);
    res.status(500).json({ error: 'Failed to create widget' });
  }
});

// Update widget (config, position)
router.patch('/widgets/:widgetId', async (req, res) => {
  try {
    const { widgetId } = req.params;
    const { config, position, widget_type } = req.body;
    const fields = []; const values = []; let i = 1;
    if (config !== undefined) { fields.push(`config = $${i++}`); values.push(JSON.stringify(config)); }
    if (position !== undefined) { fields.push(`position = $${i++}`); values.push(JSON.stringify(position)); }
    if (widget_type !== undefined) { fields.push(`widget_type = $${i++}`); values.push(widget_type); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields' });
    values.push(widgetId);
    const { rows } = await query(
      `UPDATE task_dashboard_widgets SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values
    );
    res.json({ widget: rows[0] });
  } catch (err) {
    console.error('[tasks] PATCH widget error:', err.message);
    res.status(500).json({ error: 'Failed to update widget' });
  }
});

// Delete widget
router.delete('/widgets/:widgetId', async (req, res) => {
  try {
    await query('DELETE FROM task_dashboard_widgets WHERE id = $1', [req.params.widgetId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks] DELETE widget error:', err.message);
    res.status(500).json({ error: 'Failed to delete widget' });
  }
});

// ── Subitem Assignees ──────────────────────────────────────────────────

router.get('/subitems/:subitemId/assignees', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.avatar_url, sa.created_at AS assigned_at
       FROM task_subitem_assignees sa
       JOIN users u ON u.id = sa.user_id
       WHERE sa.subitem_id = $1`,
      [req.params.subitemId]
    );
    res.json({ assignees: rows });
  } catch (err) {
    console.error('[tasks] GET subitem assignees error:', err.message);
    res.status(500).json({ error: 'Failed to fetch assignees' });
  }
});

router.post('/subitems/:subitemId/assignees', requireAuth, async (req, res) => {
  try {
    const { subitemId } = req.params;
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    await query(
      'INSERT INTO task_subitem_assignees (subitem_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [subitemId, user_id]
    );
    const { rows } = await query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.avatar_url
       FROM users u WHERE u.id = $1`,
      [user_id]
    );
    res.status(201).json({ assignee: rows[0] });
  } catch (err) {
    console.error('[tasks] POST subitem assignee error:', err.message);
    res.status(500).json({ error: 'Failed to add assignee' });
  }
});

router.delete('/subitems/:subitemId/assignees/:userId', requireAuth, async (req, res) => {
  try {
    await query(
      'DELETE FROM task_subitem_assignees WHERE subitem_id = $1 AND user_id = $2',
      [req.params.subitemId, req.params.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks] DELETE subitem assignee error:', err.message);
    res.status(500).json({ error: 'Failed to remove assignee' });
  }
});

// ── Subitem Dependencies ───────────────────────────────────────────────

router.get('/subitems/:subitemId/dependencies', requireAuth, async (req, res) => {
  try {
    const { subitemId } = req.params;
    const { rows: predecessors } = await query(
      `SELECT d.*, s.name AS subitem_name, s.status AS subitem_status
       FROM task_subitem_dependencies d
       JOIN task_subitems s ON s.id = d.predecessor_id
       WHERE d.successor_id = $1`,
      [subitemId]
    );
    const { rows: successors } = await query(
      `SELECT d.*, s.name AS subitem_name, s.status AS subitem_status
       FROM task_subitem_dependencies d
       JOIN task_subitems s ON s.id = d.successor_id
       WHERE d.predecessor_id = $1`,
      [subitemId]
    );
    res.json({ predecessors, successors });
  } catch (err) {
    console.error('[tasks] GET subitem deps error:', err.message);
    res.status(500).json({ error: 'Failed to fetch dependencies' });
  }
});

router.post('/subitems/:subitemId/dependencies', requireAuth, async (req, res) => {
  try {
    const { subitemId } = req.params;
    const { predecessor_id } = req.body;
    if (!predecessor_id) return res.status(400).json({ error: 'predecessor_id required' });
    if (predecessor_id === subitemId) return res.status(400).json({ error: 'Cannot depend on self' });

    // Cycle detection via DFS
    const visited = new Set();
    const stack = [predecessor_id];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === subitemId) return res.status(400).json({ error: 'Circular dependency detected' });
      if (visited.has(current)) continue;
      visited.add(current);
      const { rows } = await query(
        'SELECT predecessor_id FROM task_subitem_dependencies WHERE successor_id = $1',
        [current]
      );
      for (const r of rows) stack.push(r.predecessor_id);
    }

    const { rows } = await query(
      `INSERT INTO task_subitem_dependencies (predecessor_id, successor_id, created_by)
       VALUES ($1, $2, $3) ON CONFLICT (predecessor_id, successor_id) DO NOTHING RETURNING *`,
      [predecessor_id, subitemId, req.user.id]
    );
    res.status(201).json({ dependency: rows[0] || null });
  } catch (err) {
    console.error('[tasks] POST subitem dep error:', err.message);
    res.status(500).json({ error: 'Failed to add dependency' });
  }
});

router.delete('/subitems/:subitemId/dependencies/:depId', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM task_subitem_dependencies WHERE id = $1', [req.params.depId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks] DELETE subitem dep error:', err.message);
    res.status(500).json({ error: 'Failed to remove dependency' });
  }
});

// ── Subitem Blocked Status ─────────────────────────────────────────────

router.get('/subitems/:subitemId/blocked-status', requireAuth, async (req, res) => {
  try {
    const { subitemId } = req.params;
    // Find all predecessors and check if any are NOT in a done status
    const { rows } = await query(
      `SELECT d.predecessor_id, s.name, s.status,
              COALESCE(sl.is_done_state, s.status = 'Done') AS is_done
       FROM task_subitem_dependencies d
       JOIN task_subitems s ON s.id = d.predecessor_id
       LEFT JOIN task_subitems child ON child.id = $1
       LEFT JOIN task_items parent ON parent.id = child.parent_item_id
       LEFT JOIN task_groups g ON g.id = parent.group_id
       LEFT JOIN task_board_status_labels sl ON sl.board_id = g.board_id AND sl.label = s.status
       WHERE d.successor_id = $1`,
      [subitemId]
    );
    const blockers = rows.filter(r => !r.is_done);
    res.json({
      is_blocked: blockers.length > 0,
      blockers: blockers.map(b => ({ id: b.predecessor_id, name: b.name, status: b.status })),
      total_predecessors: rows.length,
      completed_predecessors: rows.length - blockers.length
    });
  } catch (err) {
    console.error('[tasks] GET blocked-status error:', err.message);
    res.status(500).json({ error: 'Failed to check blocked status' });
  }
});

export default router;
