import client from './client';
import { unwrapData } from './responseEnvelope';

export function fetchTaskWorkspaces() {
  return client.get('/tasks/workspaces').then((res) => unwrapData(res, { legacyKey: 'workspaces', fallback: [] }));
}

export function createTaskWorkspace(payload) {
  return client.post('/tasks/workspaces', payload).then((res) => unwrapData(res, { legacyKey: 'workspace' }));
}

export function deleteTaskWorkspace(workspaceId) {
  return client.delete(`/tasks/workspaces/${workspaceId}`).then((res) => unwrapData(res, { fallback: res }));
}

export function fetchTaskWorkspaceMembers(workspaceId) {
  return client.get(`/tasks/workspaces/${workspaceId}/members`).then((res) => res.data.members || []);
}

export function addTaskWorkspaceMember(workspaceId, payload) {
  return client.post(`/tasks/workspaces/${workspaceId}/members`, payload).then((res) => res.data.member);
}

export function updateTaskWorkspaceMember(workspaceId, memberUserId, payload) {
  return client.patch(`/tasks/workspaces/${workspaceId}/members/${memberUserId}`, payload).then((res) => res.data.member);
}

export function removeTaskWorkspaceMember(workspaceId, memberUserId) {
  return client.delete(`/tasks/workspaces/${workspaceId}/members/${memberUserId}`).then((res) => res.data);
}

export function searchTaskWorkspaceMembers(workspaceId, q) {
  return client.get(`/tasks/workspaces/${workspaceId}/members/search`, { params: { q } }).then((res) => res.data.members || []);
}

export function fetchTaskBoards(workspaceId) {
  return client.get(`/tasks/workspaces/${workspaceId}/boards`).then((res) => res.data.boards || []);
}

export function createTaskBoard(workspaceId, payload) {
  return client.post(`/tasks/workspaces/${workspaceId}/boards`, payload).then((res) => res.data.board);
}

export function deleteTaskBoard(boardId) {
  return client.delete(`/tasks/boards/${boardId}`).then((res) => res.data);
}

export function fetchTaskBoardView(boardId, { limit, offset } = {}) {
  const params = {};
  if (limit !== undefined) params.limit = limit;
  if (offset !== undefined) params.offset = offset;
  return client.get(`/tasks/boards/${boardId}/view`, { params }).then((res) => res.data);
}

export function updateTaskBoard(boardId, payload) {
  return client.patch(`/tasks/boards/${boardId}`, payload).then((res) => res.data.board);
}

export function fetchTaskBoardsAll() {
  return client.get('/tasks/boards').then((res) => res.data.boards || []);
}

export function runTaskBoardsReport(payload) {
  return client.post('/tasks/reports/boards', payload).then((res) => res.data.rows || []);
}

export function runBillingReport(payload) {
  return client.post('/tasks/reports/billing', payload).then((res) => res.data.items || []);
}

export function createTaskGroup(boardId, payload) {
  return client.post(`/tasks/boards/${boardId}/groups`, payload).then((res) => res.data.group);
}

export function updateTaskGroup(groupId, data) {
  return client.patch(`/tasks/groups/${groupId}`, data).then((res) => res.data.group);
}

export function deleteTaskGroup(groupId) {
  return client.delete(`/tasks/groups/${groupId}`).then((res) => res.data);
}

export function createTaskItem(groupId, payload) {
  return client.post(`/tasks/groups/${groupId}/items`, payload).then((res) => res.data.item);
}

export function updateTaskItem(itemId, payload) {
  return client.patch(`/tasks/items/${itemId}`, payload).then((res) => res.data.item);
}

export function fetchTaskItemUpdates(itemId, { limit, before } = {}) {
  const params = {};
  if (limit !== undefined) params.limit = limit;
  if (before) params.before = before;
  return client.get(`/tasks/items/${itemId}/updates`, { params }).then((res) => res.data);
}

export function createTaskItemUpdate(itemId, payload) {
  return client.post(`/tasks/items/${itemId}/updates`, payload).then((res) => res.data.update);
}

export function fetchTaskItemFiles(itemId, { limit, before } = {}) {
  const params = {};
  if (limit !== undefined) params.limit = limit;
  if (before) params.before = before;
  return client.get(`/tasks/items/${itemId}/files`, { params }).then((res) => res.data);
}

export function uploadTaskItemFile(itemId, file) {
  const formData = new FormData();
  formData.append('file', file);
  return client
    .post(`/tasks/items/${itemId}/files`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
    .then((res) => res.data.file);
}

// Authenticated download — the access token rides on the axios Authorization
// header, so `<img src="…">` / `<iframe src="…">` can't fetch the bytes
// directly. Callers turn the returned Blob into an object URL.
export function fetchTaskFileContent(fileId) {
  return client.get(`/tasks/files/${fileId}/content`, { responseType: 'blob' }).then((res) => res.data);
}

export function fetchTaskItemTimeEntries(itemId, { limit, before } = {}) {
  const params = {};
  if (limit !== undefined) params.limit = limit;
  if (before) params.before = before;
  return client.get(`/tasks/items/${itemId}/time-entries`, { params }).then((res) => res.data);
}

export function createTaskItemTimeEntry(itemId, payload) {
  return client.post(`/tasks/items/${itemId}/time-entries`, payload).then((res) => res.data.time_entry);
}

export function fetchTaskItemAssignees(itemId) {
  return client.get(`/tasks/items/${itemId}/assignees`).then((res) => res.data.assignees || []);
}

export function addTaskItemAssignee(itemId, payload) {
  return client.post(`/tasks/items/${itemId}/assignees`, payload).then((res) => res.data.assignee);
}

export function removeTaskItemAssignee(itemId, assigneeUserId) {
  return client.delete(`/tasks/items/${itemId}/assignees/${assigneeUserId}`).then((res) => res.data);
}

export function fetchTaskItemSubitems(itemId) {
  return client.get(`/tasks/items/${itemId}/subitems`).then((res) => res.data.subitems || []);
}

export function createTaskSubitem(itemId, payload) {
  return client.post(`/tasks/items/${itemId}/subitems`, payload).then((res) => res.data.subitem);
}

export function updateTaskSubitem(subitemId, payload) {
  return client.patch(`/tasks/subitems/${subitemId}`, payload).then((res) => res.data.subitem);
}

export function deleteTaskSubitem(subitemId) {
  return client.delete(`/tasks/subitems/${subitemId}`).then((res) => res.data);
}

export function fetchTaskBoardAutomations(boardId) {
  return client.get(`/tasks/boards/${boardId}/automations`).then((res) => res.data.automations || []);
}

export function createTaskBoardAutomation(boardId, payload) {
  return client.post(`/tasks/boards/${boardId}/automations`, payload).then((res) => res.data.automation);
}

export function setTaskAutomationActive(automationId, is_active) {
  return client.patch(`/tasks/automations/${automationId}`, { is_active }).then((res) => res.data.automation);
}

export function updateTaskAutomation(automationId, payload) {
  return client.patch(`/tasks/automations/${automationId}`, payload).then((res) => res.data.automation);
}

export function fetchGlobalTaskAutomations() {
  return client.get('/tasks/automations/global').then((res) => res.data.automations || []);
}

export function createGlobalTaskAutomation(payload) {
  return client.post('/tasks/automations/global', payload).then((res) => res.data.automation);
}

export function fetchAutomationRuns(params = {}) {
  return client.get('/tasks/automations/runs', { params }).then((res) => res.data.runs || []);
}

export function deleteTaskAutomation(automationId) {
  return client.delete(`/tasks/automations/${automationId}`).then((res) => res.data);
}

export function fetchTaskBoardReport(boardId) {
  return client.get(`/tasks/boards/${boardId}/report`).then((res) => res.data.report);
}

export function downloadTaskBoardCsv(boardId) {
  return client.get(`/tasks/boards/${boardId}/export.csv`, { responseType: 'blob' }).then((res) => res.data);
}

export function fetchTaskItemAiSummary(itemId) {
  return client.get(`/tasks/items/${itemId}/ai-summary`).then((res) => res.data);
}

export function refreshTaskItemAiSummary(itemId) {
  return client.post(`/tasks/items/${itemId}/ai-summary/refresh`).then((res) => res.data.summary);
}

export function fetchMyWork() {
  return client.get('/tasks/my-work').then((res) => ({
    boards: res.data.boards || [],
    subitems: res.data.subitems || []
  }));
}

// Update view tracking
export function markUpdatesViewed(updateIds) {
  return client.post('/tasks/updates/mark-viewed', { update_ids: updateIds }).then((res) => res.data);
}

export function fetchUpdateViews(updateIds) {
  return client.post('/tasks/updates/views', { update_ids: updateIds }).then((res) => res.data.views || {});
}

// AI Daily Overview
export function fetchAiDailyOverview(refresh = false) {
  return client.get('/tasks/ai/daily-overview', { params: refresh ? { refresh: '1' } : {} }).then((res) => res.data);
}

// Status Labels
export function fetchBoardStatusLabels(boardId) {
  return client.get(`/tasks/boards/${boardId}/status-labels`).then((res) => res.data.status_labels || []);
}

export function createBoardStatusLabel(boardId, payload) {
  return client.post(`/tasks/boards/${boardId}/status-labels`, payload).then((res) => res.data.status_label);
}

export function updateStatusLabel(labelId, payload) {
  return client.patch(`/tasks/status-labels/${labelId}`, payload).then((res) => res.data.status_label);
}

export function deleteStatusLabel(labelId) {
  return client.delete(`/tasks/status-labels/${labelId}`).then((res) => unwrapData(res, { fallback: res }));
}

export function initBoardStatusLabels(boardId) {
  return client.post(`/tasks/boards/${boardId}/status-labels/init`).then((res) => res.data.status_labels || []);
}

export function createGlobalStatusLabel(payload) {
  return client.post('/tasks/status-labels/global', payload).then((res) => res.data.status_label);
}

export function archiveTaskItem(itemId) {
  return client.delete(`/tasks/items/${itemId}`).then((res) => res.data);
}

export function restoreTaskItem(itemId) {
  return client.post(`/tasks/items/${itemId}/restore`).then((res) => res.data.item);
}

export function archiveTaskSubitem(subitemId) {
  return client.delete(`/tasks/subitems/${subitemId}`).then((res) => res.data);
}

export function restoreTaskSubitem(subitemId) {
  return client.post(`/tasks/subitems/${subitemId}/restore`).then((res) => res.data.subitem);
}

// Missing CRUD (TM-012)
export function deleteTaskFile(fileId) {
  return client.delete(`/tasks/files/${fileId}`).then((res) => res.data);
}

export function updateTaskTimeEntry(entryId, data) {
  return client.patch(`/tasks/time-entries/${entryId}`, data).then((res) => res.data.time_entry);
}

export function deleteTaskTimeEntry(entryId) {
  return client.delete(`/tasks/time-entries/${entryId}`).then((res) => res.data);
}

export function updateTaskItemUpdate(updateId, data) {
  return client.patch(`/tasks/updates/${updateId}`, data).then((res) => res.data.update);
}

export function deleteTaskItemUpdate(updateId) {
  return client.delete(`/tasks/updates/${updateId}`).then((res) => res.data);
}

// Automation v2: Steps
export function fetchAutomationSteps(automationId) {
  return client.get(`/tasks/automations/${automationId}/steps`).then((res) => res.data);
}

export function createAutomationStep(automationId, payload) {
  return client.post(`/tasks/automations/${automationId}/steps`, payload).then((res) => res.data.step);
}

export function updateAutomationStep(stepId, payload) {
  return client.patch(`/tasks/automations/steps/${stepId}`, payload).then((res) => res.data.step);
}

export function deleteAutomationStep(stepId) {
  return client.delete(`/tasks/automations/steps/${stepId}`).then((res) => res.data);
}

export function reorderAutomationStep(stepId, stepOrder) {
  return client.post(`/tasks/automations/steps/${stepId}/reorder`, { step_order: stepOrder }).then((res) => res.data.step);
}

// Automation v2: Quota
export function fetchAutomationQuota() {
  return client.get('/tasks/automations/quota').then((res) => res.data.quota);
}

// Automation v2: Workflow Runs
export function fetchAutomationWorkflowRuns(automationId, params = {}) {
  return client.get(`/tasks/automations/${automationId}/runs`, { params }).then((res) => res.data.runs || []);
}

// Automation v2: Step runs (per-step execution details)
export function fetchWorkflowStepRuns(runId) {
  return client.get(`/tasks/automations/runs/${runId}/steps`).then((res) => res.data.step_runs || []);
}

// Automation v2: Dry-run test
export function testAutomation(automationId, payload = {}) {
  return client.post(`/tasks/automations/${automationId}/test`, payload).then((res) => res.data);
}

// Labels
export function fetchLabels(workspaceId) {
  return client.get('/tasks/labels', { params: { workspace_id: workspaceId } }).then((res) => res.data.labels || []);
}
export function createLabel(payload) {
  return client.post('/tasks/labels', payload).then((res) => res.data.label);
}
export function updateLabel(labelId, payload) {
  return client.patch(`/tasks/labels/${labelId}`, payload).then((res) => res.data.label);
}
export function deleteLabel(labelId) {
  return client.delete(`/tasks/labels/${labelId}`).then((res) => res.data);
}
export function fetchItemLabels(itemId) {
  return client.get(`/tasks/items/${itemId}/labels`).then((res) => res.data.labels || []);
}
export function applyItemLabel(itemId, labelId) {
  return client.post(`/tasks/items/${itemId}/labels`, { label_id: labelId }).then((res) => res.data);
}
export function removeItemLabel(itemId, labelId) {
  return client.delete(`/tasks/items/${itemId}/labels/${labelId}`).then((res) => res.data);
}

// Dependencies
export function fetchItemDependencies(itemId) {
  return client.get(`/tasks/items/${itemId}/dependencies`).then((res) => res.data);
}
export function addItemDependency(itemId, predecessorId) {
  return client.post(`/tasks/items/${itemId}/dependencies`, { predecessor_id: predecessorId }).then((res) => res.data);
}
export function removeItemDependency(itemId, depId) {
  return client.delete(`/tasks/items/${itemId}/dependencies/${depId}`).then((res) => res.data);
}

// Content Governance
export function transferContent(fromUserId, toUserId, workspaceId) {
  return client.post('/tasks/governance/transfer', { from_user_id: fromUserId, to_user_id: toUserId, workspace_id: workspaceId }).then((res) => res.data);
}

// Webhooks
export function fetchWebhooks(workspaceId) {
  return client.get('/tasks/webhooks', { params: { workspace_id: workspaceId } }).then((res) => res.data.webhooks || []);
}
export function createWebhook(payload) {
  return client.post('/tasks/webhooks', payload).then((res) => res.data.webhook);
}
export function updateWebhook(id, payload) {
  return client.patch(`/tasks/webhooks/${id}`, payload).then((res) => res.data.webhook);
}
export function deleteWebhook(id) {
  return client.delete(`/tasks/webhooks/${id}`).then((res) => res.data);
}
export function fetchWebhookDeliveries(webhookId) {
  return client.get(`/tasks/webhooks/${webhookId}/deliveries`).then((res) => res.data.deliveries || []);
}
export function testWebhook(webhookId) {
  return client.post(`/tasks/webhooks/${webhookId}/test`).then((res) => res.data);
}

// Rate Cards & Time Approval
export function fetchRateCards(workspaceId) {
  return client.get('/tasks/rate-cards', { params: { workspace_id: workspaceId } }).then((res) => res.data.rate_cards || []);
}
export function createRateCard(payload) {
  return client.post('/tasks/rate-cards', payload).then((res) => res.data.rate_card);
}
export function deleteRateCard(id) {
  return client.delete(`/tasks/rate-cards/${id}`).then((res) => res.data);
}
export function approveTimeEntry(entryId, approvalStatus) {
  return client.patch(`/tasks/time-entries/${entryId}/approve`, { approval_status: approvalStatus }).then((res) => res.data.time_entry);
}
export function fetchCostReport(workspaceId, params = {}) {
  return client.get('/tasks/billing/cost-report', { params: { workspace_id: workspaceId, ...params } }).then((res) => res.data.report || []);
}

// Cross-board Workload
export function fetchWorkload(workspaceId) {
  return client.get('/tasks/workload', { params: { workspace_id: workspaceId } }).then((res) => res.data.workload || []);
}

// Baselines & Critical Path
export function fetchBaselines(boardId) {
  return client.get(`/tasks/boards/${boardId}/baselines`).then((res) => res.data.baselines || []);
}
export function createBaseline(boardId, name) {
  return client.post(`/tasks/boards/${boardId}/baselines`, { name }).then((res) => res.data.baseline);
}
export function fetchBaseline(baselineId) {
  return client.get(`/tasks/baselines/${baselineId}`).then((res) => res.data.baseline);
}
export function deleteBaseline(baselineId) {
  return client.delete(`/tasks/baselines/${baselineId}`).then((res) => res.data);
}
export function fetchCriticalPath(boardId) {
  return client.get(`/tasks/boards/${boardId}/critical-path`).then((res) => res.data);
}

// Audit Log
export function fetchAuditLog(params) {
  return client.get('/tasks/audit-log', { params }).then((res) => res.data);
}
export function fetchAuditEventTypes(workspaceId) {
  return client.get('/tasks/audit-log/event-types', { params: { workspace_id: workspaceId } }).then((res) => res.data.event_types || []);
}

// Mirror Columns
export function fetchMirrorColumns(boardId) {
  return client.get(`/tasks/boards/${boardId}/mirror-columns`).then((res) => res.data.mirror_columns || []);
}
export function createMirrorColumn(boardId, payload) {
  return client.post(`/tasks/boards/${boardId}/mirror-columns`, payload).then((res) => res.data.mirror_column);
}
export function deleteMirrorColumn(mirrorColumnId) {
  return client.delete(`/tasks/mirror-columns/${mirrorColumnId}`).then((res) => res.data);
}
export function fetchMirrorData(boardId) {
  return client.get(`/tasks/boards/${boardId}/mirror-data`).then((res) => res.data);
}

// Item Links
export function fetchItemLinks(itemId) {
  return client.get(`/tasks/items/${itemId}/links`).then((res) => res.data.links || []);
}
export function createItemLink(itemId, targetItemId, linkType = 'related') {
  return client.post(`/tasks/items/${itemId}/links`, { target_item_id: targetItemId, link_type: linkType }).then((res) => res.data.link);
}
export function deleteItemLink(linkId) {
  return client.delete(`/tasks/item-links/${linkId}`).then((res) => res.data);
}
export function searchItems(q, excludeItemId) {
  return client.get('/tasks/items/search', { params: { q, exclude_item_id: excludeItemId } }).then((res) => res.data.items || []);
}

// Recurrence
export function fetchItemRecurrence(itemId) {
  return client.get(`/tasks/items/${itemId}/recurrence`).then((res) => res.data.recurrence);
}
export function setItemRecurrence(itemId, payload) {
  return client.post(`/tasks/items/${itemId}/recurrence`, payload).then((res) => res.data.recurrence);
}
export function removeItemRecurrence(itemId) {
  return client.delete(`/tasks/items/${itemId}/recurrence`).then((res) => res.data);
}

// Dashboards
export function fetchDashboards(workspaceId) {
  return client.get('/tasks/dashboards', { params: { workspace_id: workspaceId } }).then((res) => res.data.dashboards || []);
}
export function createDashboard(payload) {
  return client.post('/tasks/dashboards', payload).then((res) => res.data.dashboard);
}
export function updateDashboard(dashboardId, payload) {
  return client.patch(`/tasks/dashboards/${dashboardId}`, payload).then((res) => res.data.dashboard);
}
export function deleteDashboard(dashboardId) {
  return client.delete(`/tasks/dashboards/${dashboardId}`).then((res) => res.data);
}
export function fetchDashboardWidgets(dashboardId) {
  return client.get(`/tasks/dashboards/${dashboardId}/widgets`).then((res) => res.data.widgets || []);
}
export function createWidget(dashboardId, payload) {
  return client.post(`/tasks/dashboards/${dashboardId}/widgets`, payload).then((res) => res.data.widget);
}
export function updateWidget(widgetId, payload) {
  return client.patch(`/tasks/widgets/${widgetId}`, payload).then((res) => res.data.widget);
}
export function deleteWidget(widgetId) {
  return client.delete(`/tasks/widgets/${widgetId}`).then((res) => res.data);
}
export function fetchWidgetData(widgetType, config) {
  return client.post('/tasks/dashboards/widget-data', { widget_type: widgetType, config }).then((res) => res.data.data);
}

// Subitem assignees
export function fetchSubitemAssignees(subitemId) {
  return client.get(`/tasks/subitems/${subitemId}/assignees`).then((res) => res.data.assignees || []);
}
export function addSubitemAssignee(subitemId, userId) {
  return client.post(`/tasks/subitems/${subitemId}/assignees`, { user_id: userId }).then((res) => res.data.assignee);
}
export function removeSubitemAssignee(subitemId, userId) {
  return client.delete(`/tasks/subitems/${subitemId}/assignees/${userId}`).then((res) => res.data);
}

// Subitem dependencies
export function fetchSubitemDependencies(subitemId) {
  return client.get(`/tasks/subitems/${subitemId}/dependencies`).then((res) => res.data);
}
export function addSubitemDependency(subitemId, predecessorId) {
  return client.post(`/tasks/subitems/${subitemId}/dependencies`, { predecessor_id: predecessorId }).then((res) => res.data);
}
export function removeSubitemDependency(subitemId, depId) {
  return client.delete(`/tasks/subitems/${subitemId}/dependencies/${depId}`).then((res) => res.data);
}

// Subitem blocked status
export function fetchSubitemBlockedStatus(subitemId) {
  return client.get(`/tasks/subitems/${subitemId}/blocked-status`).then((res) => res.data);
}

