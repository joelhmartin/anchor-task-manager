import { useCallback, useMemo, useState } from 'react';
import {
  Avatar,
  AvatarGroup,
  Box,
  Chip,
  Stack,
  Typography
} from '@mui/material';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DEFAULT_LABEL_COLOR } from 'constants/taskDefaults';
import { useToast } from 'contexts/ToastContext';
import { clientLabel } from 'hooks/useClientLabel';

// ── Draggable Card ─────────────────────────────────────────────────────
function KanbanCard({ item, itemLabels, assignees, statusLabels, onClickItem, isDragOverlay }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: item.id, data: { type: 'card', item } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
    cursor: 'grab'
  };

  const overdue = item.due_date && new Date(item.due_date + 'T23:59:59') < new Date();

  // Split labels into priority (category === 'priority') and other
  const priorityLabel = (itemLabels || []).find((l) => l.category === 'priority');
  const otherLabels = (itemLabels || []).filter((l) => l.category !== 'priority');
  const visibleOther = otherLabels.slice(0, 2);
  const remainingOther = otherLabels.length - 2;

  const visibleAssignees = (assignees || []).slice(0, 3);
  const remainingAssignees = (assignees || []).length - 3;

  const cardContent = (
    <Box
      sx={{
        p: 1.5,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: isDragOverlay ? 'primary.main' : 'divider',
        borderRadius: 1.5,
        boxShadow: isDragOverlay ? 3 : 0,
        '&:hover': { boxShadow: 2, borderColor: 'primary.light' },
        mb: 1
      }}
    >
      {/* Item name */}
      <Typography
        variant="body2"
        sx={{
          fontWeight: 600,
          mb: 0.75,
          cursor: 'pointer',
          wordBreak: 'break-word',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden'
        }}
        title={item.name}
        onClick={(e) => {
          e.stopPropagation();
          onClickItem?.(item);
        }}
      >
        {item.name}
      </Typography>

      {/* Priority label */}
      {priorityLabel && (
        <Chip
          label={priorityLabel.label}
          size="small"
          sx={{
            bgcolor: priorityLabel.color || DEFAULT_LABEL_COLOR,
            color: 'common.white',
            fontWeight: 600,
            fontSize: '0.65rem',
            height: 20,
            mb: 0.75
          }}
        />
      )}

      {/* Other label chips */}
      {visibleOther.length > 0 && (
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', mb: 0.75 }}>
          {visibleOther.map((l) => (
            <Chip
              key={l.id}
              label={l.label}
              size="small"
              sx={{
                bgcolor: l.color || DEFAULT_LABEL_COLOR,
                color: 'common.white',
                fontWeight: 600,
                fontSize: '0.6rem',
                height: 18
              }}
            />
          ))}
          {remainingOther > 0 && (
            <Chip
              label={`+${remainingOther}`}
              size="small"
              sx={{ height: 18, fontSize: '0.6rem' }}
            />
          )}
        </Stack>
      )}

      {/* Bottom row: assignees + due date */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.5 }}>
        {visibleAssignees.length > 0 ? (
          <AvatarGroup
            max={4}
            sx={{
              '& .MuiAvatar-root': { width: 24, height: 24, fontSize: '0.7rem' }
            }}
          >
            {visibleAssignees.map((a) => (
              <Avatar
                key={a.user_id}
                src={a.avatar_url}
                alt={clientLabel(a)}
                sx={{ width: 24, height: 24, fontSize: '0.7rem' }}
              >
                {(clientLabel(a) || '?')[0].toUpperCase()}
              </Avatar>
            ))}
            {remainingAssignees > 0 && (
              <Avatar sx={{ width: 24, height: 24, fontSize: '0.7rem' }}>
                +{remainingAssignees}
              </Avatar>
            )}
          </AvatarGroup>
        ) : (
          <Box />
        )}

        {item.due_date && (
          <Typography
            variant="caption"
            sx={{
              color: overdue ? 'error.main' : 'text.secondary',
              fontWeight: overdue ? 700 : 400,
              whiteSpace: 'nowrap'
            }}
          >
            {new Date(item.due_date + 'T00:00:00').toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric'
            })}
          </Typography>
        )}
      </Stack>
    </Box>
  );

  if (isDragOverlay) return cardContent;

  return (
    <Box ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {cardContent}
    </Box>
  );
}

// ── Column (droppable) ─────────────────────────────────────────────────
function KanbanColumn({ statusLabel, items, itemLabelsMap, assigneesByItem, onClickItem }) {
  const itemIds = useMemo(() => items.map((it) => it.id), [items]);

  return (
    <Box
      sx={{
        width: 280,
        minWidth: 280,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '100%'
      }}
    >
      {/* Column header */}
      <Box
        sx={{
          borderTop: `3px solid ${statusLabel.color}`,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderTopColor: statusLabel.color,
          borderTopWidth: 3,
          borderRadius: '8px 8px 0 0',
          p: 1.25,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              bgcolor: statusLabel.color
            }}
          />
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {statusLabel.label}
          </Typography>
        </Stack>
        <Chip
          label={items.length}
          size="small"
          sx={{ height: 20, fontSize: '0.7rem', minWidth: 24, fontWeight: 700 }}
        />
      </Box>

      {/* Droppable card area */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          p: 1,
          bgcolor: 'grey.50',
          border: '1px solid',
          borderColor: 'divider',
          borderTop: 0,
          borderRadius: '0 0 8px 8px',
          minHeight: 120,
          ...(items.length === 0 && {
            border: '2px dashed',
            borderColor: 'divider',
            borderTop: 0
          })
        }}
      >
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <KanbanCard
              key={item.id}
              item={item}
              itemLabels={itemLabelsMap[item.id] || []}
              assignees={assigneesByItem[item.id] || []}
              onClickItem={onClickItem}
            />
          ))}
        </SortableContext>

        {items.length === 0 && (
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ display: 'block', textAlign: 'center', mt: 3 }}
          >
            No items
          </Typography>
        )}
      </Box>
    </Box>
  );
}

// ── Main KanbanBoard ───────────────────────────────────────────────────
export default function KanbanBoard({
  items = [],
  statusLabels = [],
  itemLabelsMap = {},
  assigneesByItem = {},
  onUpdateItem,
  onClickItem
}) {
  const toast = useToast();
  const [activeCard, setActiveCard] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Group items by status into columns (one per status label)
  const columnData = useMemo(() => {
    const statusMap = {};
    for (const sl of statusLabels) {
      statusMap[sl.label] = [];
    }
    for (const item of items) {
      const status = item.status || statusLabels[0]?.label || 'To Do';
      if (statusMap[status]) {
        statusMap[status].push(item);
      } else {
        // Item has a status not in the labels — put it in first column
        const first = statusLabels[0]?.label;
        if (first && statusMap[first]) {
          statusMap[first].push(item);
        }
      }
    }
    return statusMap;
  }, [items, statusLabels]);

  // Build an item-id-to-status lookup for quick droppable resolution
  const itemStatusMap = useMemo(() => {
    const map = {};
    for (const [status, columnItems] of Object.entries(columnData)) {
      for (const it of columnItems) {
        map[it.id] = status;
      }
    }
    return map;
  }, [columnData]);

  const findColumnForItem = useCallback(
    (id) => {
      // Is it a status label name (column droppable)?
      if (columnData[id]) return id;
      // Otherwise it's an item id
      return itemStatusMap[id] || null;
    },
    [columnData, itemStatusMap]
  );

  const handleDragStart = useCallback(
    (event) => {
      const { active } = event;
      const item = items.find((it) => it.id === active.id);
      if (item) setActiveCard(item);
    },
    [items]
  );

  const handleDragEnd = useCallback(
    (event) => {
      const { active, over } = event;
      setActiveCard(null);

      if (!over || !active) return;

      const activeItemId = active.id;
      const overTarget = over.id;

      // Determine the target column (status)
      let targetStatus = null;

      // If dropped on a column id (status label name)
      if (columnData[overTarget] !== undefined) {
        targetStatus = overTarget;
      } else {
        // Dropped on another card — find that card's column
        targetStatus = itemStatusMap[overTarget] || null;
      }

      if (!targetStatus) return;

      const currentStatus = itemStatusMap[activeItemId];
      if (currentStatus === targetStatus) return;

      // Optimistic update + API call
      onUpdateItem?.(activeItemId, { status: targetStatus });
      toast.success(`Moved to "${targetStatus}"`);
    },
    [columnData, itemStatusMap, onUpdateItem, toast]
  );

  // Collect all item IDs across all columns for the DndContext
  const allItemIds = useMemo(() => items.map((it) => it.id), [items]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <Box
        sx={{
          display: 'flex',
          gap: 1.5,
          overflowX: 'auto',
          pb: 2,
          minHeight: 400,
          alignItems: 'flex-start'
        }}
      >
        {statusLabels.map((sl) => (
          <KanbanColumn
            key={sl.id}
            statusLabel={sl}
            items={columnData[sl.label] || []}
            itemLabelsMap={itemLabelsMap}
            assigneesByItem={assigneesByItem}
            onClickItem={onClickItem}
          />
        ))}
      </Box>

      <DragOverlay>
        {activeCard ? (
          <KanbanCard
            item={activeCard}
            itemLabels={itemLabelsMap[activeCard.id] || []}
            assignees={assigneesByItem[activeCard.id] || []}
            onClickItem={() => {}}
            isDragOverlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
