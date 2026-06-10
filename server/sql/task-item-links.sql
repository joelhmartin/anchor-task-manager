-- Item-to-item links (cross-board capable)
CREATE TABLE IF NOT EXISTS task_item_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_item_id UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
  target_item_id UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL DEFAULT 'related',  -- 'related' | 'blocks' | 'blocked_by' | 'duplicate'
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_item_id, target_item_id, link_type),
  CHECK (source_item_id != target_item_id)
);

CREATE INDEX IF NOT EXISTS idx_task_item_links_source
  ON task_item_links (source_item_id);
CREATE INDEX IF NOT EXISTS idx_task_item_links_target
  ON task_item_links (target_item_id);
