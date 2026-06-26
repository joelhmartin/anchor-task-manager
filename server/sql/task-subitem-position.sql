-- Subitem ordering: explicit position column so users can drag-to-reorder
-- subitems within their parent item.

ALTER TABLE task_subitems ADD COLUMN IF NOT EXISTS position INTEGER;

-- Backfill positions for existing rows using created_at order within each
-- parent. Existing rows had no order beyond insert time, so this keeps the
-- current visual order while letting future reorders mutate `position`.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY parent_item_id ORDER BY created_at ASC, id ASC) - 1 AS rn
    FROM task_subitems
   WHERE position IS NULL
)
UPDATE task_subitems s
   SET position = r.rn
  FROM ranked r
 WHERE s.id = r.id;

CREATE INDEX IF NOT EXISTS idx_task_subitems_parent_position
  ON task_subitems(parent_item_id, position);
