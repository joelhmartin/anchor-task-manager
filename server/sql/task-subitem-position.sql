-- Subitem ordering: explicit position column so users can drag-to-reorder
-- subitems within their parent item.

ALTER TABLE task_subitems ADD COLUMN IF NOT EXISTS position INTEGER;

-- Backfill positions for existing rows using newest-first order within each
-- parent so position 0 == the row that was already at the top of the drawer.
-- The pre-existing list endpoint ordered by `created_at DESC`; the new list
-- endpoint orders by `position ASC`, so reversing the rank direction here
-- preserves the current visual order across the migration.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY parent_item_id ORDER BY created_at DESC, id DESC) - 1 AS rn
    FROM task_subitems
   WHERE position IS NULL
)
UPDATE task_subitems s
   SET position = r.rn
  FROM ranked r
 WHERE s.id = r.id;

CREATE INDEX IF NOT EXISTS idx_task_subitems_parent_position
  ON task_subitems(parent_item_id, position);
