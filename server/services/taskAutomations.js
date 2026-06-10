import { query } from '../db.js';
import { activeOnly } from './queryHelpers.js';
import { createNotification } from './notifications.js';
import { sendMailgunMessageWithLogging, isMailgunConfigured } from './mailgun.js';
import { isDemoMode } from './demoMode.js';

const MAX_DUE_DAY_SPAN = 365;

function safeJson(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return {};
    }
  }
  return {};
}

function buildItemLink({ boardId, itemId }) {
  if (boardId && itemId) {
    return `/tasks?pane=boards&board=${encodeURIComponent(boardId)}&item=${encodeURIComponent(itemId)}`;
  }
  if (boardId) return `/tasks?pane=boards&board=${encodeURIComponent(boardId)}`;
  return '/tasks?pane=boards';
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

async function getActiveBoardAutomations(boardId) {
  const { rows } = await query(
    `SELECT *
     FROM task_board_automations
     WHERE board_id = $1 AND is_active = TRUE AND ${activeOnly()}
     ORDER BY created_at ASC`,
    [boardId]
  );
  return rows || [];
}

async function getActiveGlobalAutomations() {
  const { rows } = await query(
    `SELECT *
     FROM task_global_automations
     WHERE is_active = TRUE AND ${activeOnly()}
     ORDER BY created_at ASC`
  );
  return rows || [];
}

async function logAutomationRun({
  scope,
  automationId,
  boardId,
  itemId,
  triggerType,
  triggerFingerprint,
  status,
  error,
  meta
}) {
  try {
    await query(
      `INSERT INTO task_automation_runs (scope, automation_id, board_id, item_id, trigger_type, trigger_fingerprint, status, error, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (scope, automation_id, item_id, trigger_fingerprint)
       WHERE $6 IS NOT NULL
       DO NOTHING`,
      [
        scope,
        automationId,
        boardId || null,
        itemId || null,
        triggerType,
        triggerFingerprint || null,
        status || 'success',
        error || null,
        JSON.stringify(meta || {})
      ]
    );
    return true;
  } catch {
    return false;
  }
}

async function wasScheduledRunAlreadyLogged({ scope, automationId, itemId, triggerFingerprint }) {
  if (!triggerFingerprint) return false;
  const { rowCount } = await query(
    `SELECT 1
     FROM task_automation_runs
     WHERE scope = $1 AND automation_id = $2 AND item_id = $3 AND trigger_fingerprint = $4
     LIMIT 1`,
    [scope, automationId, itemId, triggerFingerprint]
  );
  return rowCount > 0;
}

export async function executeAction({ scope, rule, boardId, item, actorUserId, event }) {
  const actionType = String(rule.action_type || '');
  const action = safeJson(rule.action_config);
  const itemId = item?.id;
  const linkUrl = action.link_url || buildItemLink({ boardId, itemId });
  const title = action.title || 'Task automation';
  const body = action.body || item?.name || '';

  const meta = {
    source: 'tasks_automation',
    scope,
    board_id: boardId || null,
    item_id: itemId || null,
    automation_id: rule.id,
    actor_user_id: actorUserId || null,
    event: event || null
  };

  if (actionType === 'notify_admins') {
    const { rows: admins } = await query("SELECT id FROM users WHERE role IN ('superadmin','admin')");
    await Promise.all(admins.map((u) => createNotification({ userId: u.id, title, body, linkUrl, meta })));
    return { ok: true };
  }

  if (actionType === 'notify_assignees') {
    // Special-case: for assignee_added trigger, notify ONLY the newly added assignee by default.
    if (String(rule.trigger_type) === 'assignee_added' && event?.assignee_user_id) {
      if (event.assignee_user_id !== actorUserId) {
        await createNotification({ userId: event.assignee_user_id, title, body, linkUrl, meta });
      }
      return { ok: true };
    }

    const { rows: assignees } = await query(`SELECT user_id FROM task_item_assignees WHERE item_id = $1`, [itemId]);
    await Promise.all(
      assignees
        .map((a) => a.user_id)
        .filter(Boolean)
        .filter((uid) => uid !== actorUserId)
        .map((uid) => createNotification({ userId: uid, title, body, linkUrl, meta }))
    );
    return { ok: true };
  }

  if (actionType === 'notify_users') {
    const mode = action.recipient_mode || 'current_assignees';
    let userIds = [];

    switch (mode) {
      case 'trigger_assignee':
        // The person who was just assigned (for assignee_added triggers)
        if (event?.assignee_user_id) userIds = [event.assignee_user_id];
        break;
      case 'current_assignees': {
        const { rows } = await query('SELECT user_id FROM task_item_assignees WHERE item_id = $1', [itemId]);
        userIds = rows.map((r) => r.user_id);
        break;
      }
      case 'actor':
        if (actorUserId) userIds = [actorUserId];
        break;
      case 'item_creator': {
        const { rows } = await query('SELECT created_by FROM task_items WHERE id = $1', [itemId]);
        if (rows[0]?.created_by) userIds = [rows[0].created_by];
        break;
      }
      case 'admins': {
        const { rows } = await query("SELECT id FROM users WHERE role IN ('superadmin','admin')");
        userIds = rows.map((r) => r.id);
        break;
      }
      case 'specific_user':
        if (action.user_id) userIds = [action.user_id];
        break;
      default:
        return { ok: false, error: `Unknown recipient_mode: ${mode}` };
    }

    await Promise.all(
      userIds
        .filter(Boolean)
        .filter((uid) => uid !== actorUserId) // Don't notify the actor
        .map((uid) => createNotification({ userId: uid, title, body, linkUrl, meta }))
    );
    return { ok: true };
  }

  if (actionType === 'set_status') {
    const nextStatus = String(action.status || '').trim();
    if (!nextStatus) return { ok: false, error: 'Missing status' };
    await query(`UPDATE task_items SET status = $1, updated_at = NOW() WHERE id = $2`, [nextStatus, itemId]);
    return { ok: true };
  }

  if (actionType === 'set_needs_attention') {
    const next = Boolean(action.value);
    await query(`UPDATE task_items SET needs_attention = $1, updated_at = NOW() WHERE id = $2`, [next, itemId]);
    return { ok: true };
  }

  if (actionType === 'add_update') {
    const content = String(action.content || '').trim();
    if (!content) return { ok: false, error: 'Missing content' };
    await query(`INSERT INTO task_updates (item_id, user_id, content) VALUES ($1, NULL, $2)`, [itemId, content]);
    return { ok: true };
  }

  // ── Tier 1: Simple field updates ────────────────────────────────────────────

  if (actionType === 'set_due_date') {
    if (!action.due_date) return { ok: false, error: 'Missing due_date' };
    await query(`UPDATE task_items SET due_date = $1, updated_at = NOW() WHERE id = $2`, [action.due_date, itemId]);
    return { ok: true };
  }

  if (actionType === 'clear_due_date') {
    await query(`UPDATE task_items SET due_date = NULL, updated_at = NOW() WHERE id = $1`, [itemId]);
    return { ok: true };
  }

  if (actionType === 'archive_item') {
    await query(`UPDATE task_items SET archived_at = COALESCE(archived_at, NOW()), updated_at = NOW() WHERE id = $1`, [itemId]);
    return { ok: true };
  }

  // ── Tier 2a: Assignees ──────────────────────────────────────────────────────

  if (actionType === 'assign_user') {
    if (!action.user_id) return { ok: false, error: 'Missing user_id' };
    await query(
      `INSERT INTO task_item_assignees (item_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [itemId, action.user_id]
    );
    return { ok: true };
  }

  if (actionType === 'remove_assignee') {
    if (!action.user_id) return { ok: false, error: 'Missing user_id' };
    await query(
      `DELETE FROM task_item_assignees WHERE item_id = $1 AND user_id = $2`,
      [itemId, action.user_id]
    );
    return { ok: true };
  }

  // ── Tier 2b: Moves ─────────────────────────────────────────────────────────

  if (actionType === 'move_to_group') {
    if (!action.group_id) return { ok: false, error: 'Missing group_id' };
    await query(`UPDATE task_items SET group_id = $1, updated_at = NOW() WHERE id = $2`, [action.group_id, itemId]);
    return { ok: true };
  }

  if (actionType === 'move_to_board') {
    if (!action.board_id) return { ok: false, error: 'Missing board_id' };
    // Find the first group on the target board
    let { rows: groups } = await query(
      `SELECT id FROM task_groups WHERE board_id = $1 ORDER BY order_index ASC LIMIT 1`,
      [action.board_id]
    );
    let targetGroupId;
    if (groups.length > 0) {
      targetGroupId = groups[0].id;
    } else {
      // No groups exist on target board — create a default one
      const { rows: created } = await query(
        `INSERT INTO task_groups (board_id, name, order_index) VALUES ($1, 'General', 0) RETURNING id`,
        [action.board_id]
      );
      targetGroupId = created[0].id;
    }
    await query(`UPDATE task_items SET group_id = $1, updated_at = NOW() WHERE id = $2`, [targetGroupId, itemId]);
    return { ok: true };
  }

  // ── Tier 2c: Create / Duplicate ─────────────────────────────────────────────

  if (actionType === 'create_item') {
    const name = String(action.name || '').trim();
    if (!name) return { ok: false, error: 'Missing name' };
    const groupId = action.group_id || item?.group_id;
    if (!groupId) return { ok: false, error: 'Missing group_id and no source item group' };
    const status = action.status || 'To Do';
    await query(
      `INSERT INTO task_items (group_id, name, status) VALUES ($1, $2, $3)`,
      [groupId, name, status]
    );
    return { ok: true };
  }

  if (actionType === 'duplicate_item') {
    if (!itemId) return { ok: false, error: 'Missing item to duplicate' };
    const { rows: origRows } = await query(`SELECT * FROM task_items WHERE id = $1 LIMIT 1`, [itemId]);
    if (origRows.length === 0) return { ok: false, error: 'Original item not found' };
    const orig = origRows[0];
    const groupId = action.group_id || orig.group_id;
    const { rows: newRows } = await query(
      `INSERT INTO task_items (group_id, name, status, due_date, is_voicemail, needs_attention, created_by)
       VALUES ($1, $2, 'To Do', $3, $4, $5, $6) RETURNING id`,
      [groupId, orig.name + ' (copy)', orig.due_date, orig.is_voicemail, orig.needs_attention, orig.created_by]
    );
    const newId = newRows[0].id;
    // Copy assignees
    await query(
      `INSERT INTO task_item_assignees (item_id, user_id)
       SELECT $1, user_id FROM task_item_assignees WHERE item_id = $2`,
      [newId, itemId]
    );
    return { ok: true };
  }

  if (actionType === 'create_subitem') {
    const name = String(action.name || '').trim();
    if (!name) return { ok: false, error: 'Missing name' };
    if (!itemId) return { ok: false, error: 'Missing parent item' };
    const status = action.status || 'To Do';
    await query(
      `INSERT INTO task_subitems (parent_item_id, name, status) VALUES ($1, $2, $3)`,
      [itemId, name, status]
    );
    return { ok: true };
  }

  // ── Tier 3: Integrations ────────────────────────────────────────────────────

  if (actionType === 'send_email') {
    if (!action.to) return { ok: false, error: 'Missing to address' };
    if (!isMailgunConfigured()) return { ok: false, error: 'Mailgun is not configured' };
    try {
      await sendMailgunMessageWithLogging(
        {
          to: action.to,
          subject: action.subject || 'Task Automation Notification',
          text: action.body || '',
          html: action.html || undefined
        },
        { emailType: 'task_automation', metadata: { automation_id: rule.id, item_id: itemId } }
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `send_email failed: ${err?.message || String(err)}` };
    }
  }

  if (actionType === 'send_webhook') {
    if (isDemoMode()) {
      console.warn('[demo] send_webhook action suppressed (DEMO_MODE).');
      return { ok: true, skipped: 'demo_mode' };
    }
    if (!action.url) return { ok: false, error: 'Missing webhook url' };
    try {
      const payload = {
        event: 'task_automation',
        automation_id: rule.id,
        item_id: itemId,
        board_id: boardId,
        action_type: actionType,
        timestamp: new Date().toISOString(),
        data: action.data || {}
      };
      const resp = await fetch(action.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
      });
      if (!resp.ok) {
        return { ok: false, error: `Webhook returned HTTP ${resp.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `send_webhook failed: ${err?.message || String(err)}` };
    }
  }

  // ── Tier 4: Time tracking ───────────────────────────────────────────────────

  if (actionType === 'start_time_tracking') {
    if (!itemId) return { ok: false, error: 'Missing item for time tracking' };
    await query(
      `INSERT INTO task_time_entries (item_id, user_id, time_spent_minutes, billable_minutes, is_billable, work_category, description)
       VALUES ($1, $2, 0, 0, false, $3, $4)`,
      [itemId, actorUserId || null, action.work_category || 'Automation', action.description || 'Started by automation']
    );
    return { ok: true };
  }

  if (actionType === 'stop_time_tracking') {
    if (!itemId) return { ok: false, error: 'Missing item for time tracking' };
    // Find the most recent entry with time_spent_minutes = 0 (active timer)
    const { rows: active } = await query(
      `SELECT id, created_at FROM task_time_entries
       WHERE item_id = $1 AND time_spent_minutes = 0
       ORDER BY created_at DESC LIMIT 1`,
      [itemId]
    );
    if (active.length === 0) return { ok: false, error: 'No active time tracking entry found' };
    const entry = active[0];
    const elapsedMs = Date.now() - new Date(entry.created_at).getTime();
    const elapsedMinutes = Math.max(1, Math.round(elapsedMs / 60000));
    await query(
      `UPDATE task_time_entries SET time_spent_minutes = $1 WHERE id = $2`,
      [elapsedMinutes, entry.id]
    );
    return { ok: true };
  }

  // ── Tier 5: Labels ──────────────────────────────────────────────────────────

  if (actionType === 'add_label') {
    const labelId = action.label_id;
    if (!labelId) return { ok: false, error: 'Missing label_id' };
    // Get label definition for exclusivity check
    const { rows: labelDef } = await query('SELECT * FROM task_label_definitions WHERE id = $1', [labelId]);
    if (labelDef.length === 0) return { ok: false, error: 'Label not found' };
    const lbl = labelDef[0];
    // Handle exclusivity
    if (lbl.is_exclusive) {
      await query(
        `DELETE FROM task_item_labels WHERE item_id = $1 AND label_id IN (
           SELECT id FROM task_label_definitions WHERE workspace_id = $2 AND category = $3
         )`,
        [itemId, lbl.workspace_id, lbl.category]
      );
    }
    await query(
      `INSERT INTO task_item_labels (item_id, label_id, applied_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [itemId, labelId, actorUserId || null]
    );
    return { ok: true };
  }

  if (actionType === 'remove_label') {
    const labelId = action.label_id;
    const category = action.category;
    if (labelId) {
      await query('DELETE FROM task_item_labels WHERE item_id = $1 AND label_id = $2', [itemId, labelId]);
    } else if (category) {
      // Remove all labels in category
      await query(
        `DELETE FROM task_item_labels WHERE item_id = $1 AND label_id IN (
           SELECT id FROM task_label_definitions WHERE category = $2
         )`,
        [itemId, category]
      );
    } else {
      return { ok: false, error: 'Missing label_id or category' };
    }
    return { ok: true };
  }

  return { ok: false, error: `Unsupported action_type: ${actionType}` };
}

function matchesStatusChange({ rule, itemBefore, itemAfter }) {
  if (!itemBefore || !itemAfter) return false;
  if (itemBefore.status === itemAfter.status) return false;
  const trigger = safeJson(rule.trigger_config);
  const toStatus = trigger?.to_status;
  if (!toStatus) return true;
  return itemAfter.status === toStatus;
}

export async function runEventAutomationsForItemChange({ itemBefore, itemAfter, actorUserId }) {
  if (!itemBefore || !itemAfter) return;
  const boardId = await getBoardIdForItem(itemAfter.id);
  if (!boardId) return;

  const [boardRules, globalRules] = await Promise.all([getActiveBoardAutomations(boardId), getActiveGlobalAutomations()]);
  const all = [
    ...boardRules.map((r) => ({ scope: 'board', boardId, rule: r })),
    ...globalRules.map((r) => ({ scope: 'global', boardId, rule: r }))
  ];

  for (const entry of all) {
    const { scope, rule } = entry;
    if (String(rule.trigger_type) !== 'status_change') continue;
    if (!matchesStatusChange({ rule, itemBefore, itemAfter })) continue;

    try {
      const result = await executeAction({
        scope,
        rule,
        boardId,
        item: itemAfter,
        actorUserId,
        event: { type: 'status_change', from_status: itemBefore.status, to_status: itemAfter.status }
      });
      await logAutomationRun({
        scope,
        automationId: rule.id,
        boardId: scope === 'board' ? boardId : null,
        itemId: itemAfter.id,
        triggerType: 'status_change',
        triggerFingerprint: null,
        status: result.ok ? 'success' : 'error',
        error: result.ok ? null : result.error,
        meta: { from_status: itemBefore.status, to_status: itemAfter.status }
      });
    } catch (err) {
      await logAutomationRun({
        scope,
        automationId: rule.id,
        boardId: scope === 'board' ? boardId : null,
        itemId: itemAfter.id,
        triggerType: 'status_change',
        triggerFingerprint: null,
        status: 'error',
        error: err?.message || String(err),
        meta: { from_status: itemBefore.status, to_status: itemAfter.status }
      });
    }
  }
}

export async function runEventAutomationsForAssigneeAdded({ itemId, assigneeUserId, actorUserId }) {
  if (!itemId || !assigneeUserId) return;
  const boardId = await getBoardIdForItem(itemId);
  if (!boardId) return;

  const { rows: itemRows } = await query(`SELECT * FROM task_items WHERE id = $1 LIMIT 1`, [itemId]);
  const item = itemRows[0];
  if (!item) return;

  const [boardRules, globalRules] = await Promise.all([getActiveBoardAutomations(boardId), getActiveGlobalAutomations()]);
  const all = [
    ...boardRules.map((r) => ({ scope: 'board', boardId, rule: r })),
    ...globalRules.map((r) => ({ scope: 'global', boardId, rule: r }))
  ];

  for (const entry of all) {
    const { scope, rule } = entry;
    if (String(rule.trigger_type) !== 'assignee_added') continue;
    try {
      const result = await executeAction({
        scope,
        rule,
        boardId,
        item,
        actorUserId,
        event: { type: 'assignee_added', assignee_user_id: assigneeUserId }
      });
      await logAutomationRun({
        scope,
        automationId: rule.id,
        boardId: scope === 'board' ? boardId : null,
        itemId,
        triggerType: 'assignee_added',
        triggerFingerprint: null,
        status: result.ok ? 'success' : 'error',
        error: result.ok ? null : result.error,
        meta: { assignee_user_id: assigneeUserId }
      });
    } catch (err) {
      await logAutomationRun({
        scope,
        automationId: rule.id,
        boardId: scope === 'board' ? boardId : null,
        itemId,
        triggerType: 'assignee_added',
        triggerFingerprint: null,
        status: 'error',
        error: err?.message || String(err),
        meta: { assignee_user_id: assigneeUserId }
      });
    }
  }
}

export async function runDueDateAutomations({ now = new Date() } = {}) {
  const today = new Date(now);
  // Use UTC date to avoid server timezone drift on comparisons (DB uses DATE).
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(today.getUTCDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  // Gather all active rules with due_date_relative trigger.
  const [boardRulesResult, globalRulesResult] = await Promise.all([
    query(
      `SELECT a.*, b.workspace_id
       FROM task_board_automations a
       JOIN task_boards b ON b.id = a.board_id
       WHERE a.is_active = TRUE AND ${activeOnly('a')} AND a.trigger_type = 'due_date_relative'`
    ),
    query(`SELECT * FROM task_global_automations WHERE is_active = TRUE AND ${activeOnly()} AND trigger_type = 'due_date_relative'`)
  ]);
  const boardRules = boardRulesResult.rows || [];
  const globalRules = globalRulesResult.rows || [];

  // Helper to compute due_date target: due_date = today - days_from_due
  async function processRule({ scope, rule, boardId }) {
    const trigger = safeJson(rule.trigger_config);
    const daysFromDueRaw = Number(trigger?.days_from_due);
    if (!Number.isFinite(daysFromDueRaw)) return { processed: 0 };
    const daysFromDue = Math.max(-MAX_DUE_DAY_SPAN, Math.min(MAX_DUE_DAY_SPAN, Math.trunc(daysFromDueRaw)));

    // due_date = today - days_from_due
    // (for -10 => 10 days before due; for 0 => on due; for +1 => 1 day after due)
    const { rows: items } = await query(
      `SELECT i.*
       FROM task_items i
       JOIN task_groups g ON g.id = i.group_id
       JOIN task_boards b ON b.id = g.board_id
       WHERE i.due_date = ($1::date - ($2::int * INTERVAL '1 day'))::date
         AND ${activeOnly('i')}
         ${boardId ? 'AND b.id = $3' : ''}`,
      boardId ? [todayStr, daysFromDue, boardId] : [todayStr, daysFromDue]
    );

    let processed = 0;
    for (const item of items) {
      const itemId = item.id;
      const resolvedBoardId = boardId || (await getBoardIdForItem(itemId));
      const triggerFingerprint = `due_date_relative:${daysFromDue}:${item.due_date}`;
      const dedupeScope = scope;
      const dedupeId = rule.id;

      // Dedupe (scheduled rules) so we only fire once per item due_date per rule.
      const already = await wasScheduledRunAlreadyLogged({
        scope: dedupeScope,
        automationId: dedupeId,
        itemId,
        triggerFingerprint
      });
      if (already) continue;

      try {
        const result = await executeAction({
          scope,
          rule,
          boardId: resolvedBoardId,
          item,
          actorUserId: null,
          event: { type: 'due_date_relative', days_from_due: daysFromDue, due_date: item.due_date }
        });
        await logAutomationRun({
          scope,
          automationId: rule.id,
          boardId: scope === 'board' ? resolvedBoardId : null,
          itemId,
          triggerType: 'due_date_relative',
          triggerFingerprint,
          status: result.ok ? 'success' : 'error',
          error: result.ok ? null : result.error,
          meta: { days_from_due: daysFromDue, due_date: item.due_date }
        });
      } catch (err) {
        await logAutomationRun({
          scope,
          automationId: rule.id,
          boardId: scope === 'board' ? resolvedBoardId : null,
          itemId,
          triggerType: 'due_date_relative',
          triggerFingerprint,
          status: 'error',
          error: err?.message || String(err),
          meta: { days_from_due: daysFromDue, due_date: item.due_date }
        });
      }
      processed += 1;
    }
    return { processed };
  }

  let total = 0;
  for (const r of boardRules) {
    const out = await processRule({ scope: 'board', rule: r, boardId: r.board_id });
    total += out.processed;
  }
  for (const r of globalRules) {
    const out = await processRule({ scope: 'global', rule: r, boardId: null });
    total += out.processed;
  }

  return { processed: total };
}



