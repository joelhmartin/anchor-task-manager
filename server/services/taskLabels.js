import { query } from '../db.js';

const SYSTEM_LABELS = [
  // Priority (exclusive — only one per item)
  { category: 'priority', label: 'High', color: '#e2445c', is_exclusive: true, order_index: 0 },
  { category: 'priority', label: 'Medium', color: '#fdab3d', is_exclusive: true, order_index: 1 },
  { category: 'priority', label: 'Low', color: '#579bfc', is_exclusive: true, order_index: 2 },
  { category: 'priority', label: 'None', color: '#c4c4c4', is_exclusive: true, order_index: 3 },
  // Workflow (not exclusive — item can have multiple)
  { category: 'workflow', label: 'Stuck', color: '#e2445c', is_exclusive: false, order_index: 0 },
  { category: 'workflow', label: 'Waiting on Client', color: '#fdab3d', is_exclusive: false, order_index: 1 },
  { category: 'workflow', label: 'Under Client Review', color: '#a25ddc', is_exclusive: false, order_index: 2 },
  { category: 'workflow', label: 'Under Team Review', color: '#579bfc', is_exclusive: false, order_index: 3 },
  { category: 'workflow', label: 'Approved', color: '#00c875', is_exclusive: false, order_index: 4 },
  { category: 'workflow', label: 'Ready for QC', color: '#66ccff', is_exclusive: false, order_index: 5 },
];

export async function seedSystemLabels(workspaceId) {
  // Check if labels already exist for this workspace
  const { rowCount } = await query(
    'SELECT 1 FROM task_label_definitions WHERE workspace_id = $1 LIMIT 1',
    [workspaceId]
  );
  if (rowCount > 0) return; // already seeded

  for (const lbl of SYSTEM_LABELS) {
    await query(
      `INSERT INTO task_label_definitions (workspace_id, category, label, color, is_exclusive, is_system, order_index)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       ON CONFLICT (workspace_id, category, label) DO NOTHING`,
      [workspaceId, lbl.category, lbl.label, lbl.color, lbl.is_exclusive, lbl.order_index]
    );
  }
}

export async function seedAllWorkspaces() {
  const { rows } = await query('SELECT id FROM task_workspaces');
  for (const ws of rows) {
    await seedSystemLabels(ws.id);
  }
}
