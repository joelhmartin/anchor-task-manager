import { useState } from 'react';
import { Box, Button, Chip, IconButton, Menu, MenuItem, Skeleton, Stack, Typography } from '@mui/material';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import { DndContext, closestCenter, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconGripVertical, IconPencil, IconTrash, IconPlus } from '@tabler/icons-react';
import { getActionLabel } from 'constants/automationTypes';
import { AUTOMATION_NODE_COLORS } from 'constants/taskDefaults';

const STEP_COLORS = {
  action: AUTOMATION_NODE_COLORS.action,
  if: AUTOMATION_NODE_COLORS.if,
  else: AUTOMATION_NODE_COLORS.else,
  delay: AUTOMATION_NODE_COLORS.delay
};

function StepSummary({ step }) {
  if (step.step_type === 'action') {
    return (
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
        <Chip label={getActionLabel(step.action_type)} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
        {step.action_config?.title && (
          <Typography variant="caption" color="text.secondary" noWrap title={step.action_config.title}>
            {step.action_config.title}
          </Typography>
        )}
      </Stack>
    );
  }
  if (step.step_type === 'if') {
    const group = step.condition_group;
    if (!group?.conditions?.length) return <Typography variant="caption" color="text.secondary">No conditions set</Typography>;
    const count = group.conditions.length;
    const logic = group.logic === 'or' ? 'ANY' : 'ALL';
    return (
      <Typography variant="caption" color="text.secondary">
        {logic} of {count} condition{count !== 1 ? 's' : ''} match
      </Typography>
    );
  }
  if (step.step_type === 'else') {
    return <Typography variant="caption" color="text.secondary">Otherwise</Typography>;
  }
  if (step.step_type === 'delay') {
    return <Typography variant="caption" color="text.secondary">Wait (coming soon)</Typography>;
  }
  return null;
}

function SortableStepCard({ step, index, onEdit, onDelete, isChild }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
    disabled: isChild // Prevent child rows from being draggable
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1
  };

  const color = STEP_COLORS[step.step_type] || AUTOMATION_NODE_COLORS.else;

  return (
    <Box ref={setNodeRef} style={style} {...attributes}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          p: 1.25,
          border: '1px solid',
          borderColor: 'divider',
          borderLeft: `3px solid ${color}`,
          borderRadius: 1.5,
          bgcolor: 'background.paper',
          ml: isChild ? 4 : 0,
          '&:hover': { borderColor: 'primary.light' }
        }}
      >
        <Box
          {...(isChild ? {} : listeners)}
          sx={{ cursor: isChild ? 'default' : 'grab', display: 'flex', alignItems: 'center', color: isChild ? 'action.disabled' : 'text.disabled' }}
        >
          <IconGripVertical size={16} />
        </Box>

        <Chip
          label={index + 1}
          size="small"
          sx={{ minWidth: 24, height: 22, fontSize: '0.7rem', fontWeight: 600, bgcolor: color, color: 'common.white' }}
        />

        <Chip
          label={step.step_type}
          size="small"
          variant="outlined"
          sx={{ height: 20, fontSize: '0.65rem', textTransform: 'uppercase' }}
        />

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <StepSummary step={step} />
        </Box>

        <Stack direction="row" spacing={0.25}>
          <IconButton size="small" onClick={() => onEdit(step)} aria-label="Edit step">
            <IconPencil size={14} />
          </IconButton>
          <IconButton size="small" onClick={() => onDelete(step.id)} color="error" aria-label="Delete step">
            <IconTrash size={14} />
          </IconButton>
        </Stack>
      </Box>
    </Box>
  );
}

function StepCard({ step, index }) {
  const color = STEP_COLORS[step.step_type] || AUTOMATION_NODE_COLORS.else;
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        p: 1.25,
        border: '1px solid',
        borderColor: 'divider',
        borderLeft: `3px solid ${color}`,
        borderRadius: 1.5,
        bgcolor: 'background.paper',
        boxShadow: 2,
        opacity: 0.9
      }}
    >
      <IconGripVertical size={16} />
      <Chip label={index + 1} size="small" sx={{ minWidth: 24, height: 22, fontSize: '0.7rem', fontWeight: 600, bgcolor: color, color: 'common.white' }} />
      <Chip label={step.step_type} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem', textTransform: 'uppercase' }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <StepSummary step={step} />
      </Box>
    </Box>
  );
}

export default function StepBuilder({ steps = [], onReorder, onAddStep, onAddChildStep, onEditStep, onDeleteStep, loading }) {
  const [activeId, setActiveId] = useState(null);
  const [addMenuAnchor, setAddMenuAnchor] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, stepId: null });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Separate top-level steps from child steps
  const topLevelSteps = steps.filter((s) => !s.parent_step_id);
  const childStepsByParent = {};
  steps.forEach((s) => {
    if (s.parent_step_id) {
      if (!childStepsByParent[s.parent_step_id]) childStepsByParent[s.parent_step_id] = [];
      childStepsByParent[s.parent_step_id].push(s);
    }
  });

  const activeStep = activeId ? steps.find((s) => s.id === activeId) : null;

  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = (event) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = topLevelSteps.findIndex((s) => s.id === active.id);
    const newIndex = topLevelSteps.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // new step_order is the order of the item at the target position
    const newOrder = newIndex;
    onReorder(active.id, newOrder);
  };

  const handleAddClick = (event) => {
    setAddMenuAnchor(event.currentTarget);
  };

  const handleAddSelect = (type) => {
    setAddMenuAnchor(null);
    onAddStep(type);
  };

  if (loading) {
    return (
      <Stack spacing={1}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rounded" height={48} />
        ))}
      </Stack>
    );
  }

  return (
    <Stack spacing={0}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <SortableContext items={topLevelSteps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {topLevelSteps.map((step, i) => (
            <Box key={step.id}>
              {/* Connector line between steps */}
              {i > 0 && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 0.25 }}>
                  <Box sx={{ width: 2, height: 16, bgcolor: 'divider' }} />
                </Box>
              )}
              <SortableStepCard
                step={step}
                index={i}
                onEdit={onEditStep}
                onDelete={(id) => setDeleteConfirm({ open: true, stepId: id })}
              />
              {/* Child steps (if/else children) */}
              {childStepsByParent[step.id]?.map((child, ci) => (
                <Box key={child.id}>
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 0.25, ml: 4 }}>
                    <Box sx={{ width: 2, height: 12, bgcolor: 'divider' }} />
                  </Box>
                  <SortableStepCard
                    step={child}
                    index={ci}
                    onEdit={onEditStep}
                    onDelete={(id) => setDeleteConfirm({ open: true, stepId: id })}
                    isChild
                  />
                </Box>
              ))}
              {/* Add child step button for if/else steps */}
              {(step.step_type === 'if' || step.step_type === 'else') && onAddChildStep && (
                <Box sx={{ ml: 4, mt: 0.5 }}>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<IconPlus size={12} />}
                    onClick={() => onAddChildStep('action', step.id)}
                    sx={{ fontSize: '0.75rem', textTransform: 'none' }}
                  >
                    Add child step
                  </Button>
                </Box>
              )}
            </Box>
          ))}
        </SortableContext>

        <DragOverlay>
          {activeStep ? (
            <StepCard
              step={activeStep}
              index={topLevelSteps.findIndex((s) => s.id === activeStep.id)}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Add step button */}
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1.5 }}>
        {topLevelSteps.length > 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', pb: 0.5 }}>
            <Box sx={{ width: 2, height: 16, bgcolor: 'divider' }} />
          </Box>
        )}
      </Box>
      <Button variant="outlined" startIcon={<IconPlus size={16} />} onClick={handleAddClick} size="small" fullWidth>
        Add step
      </Button>

      <Menu anchorEl={addMenuAnchor} open={Boolean(addMenuAnchor)} onClose={() => setAddMenuAnchor(null)}>
        <MenuItem onClick={() => handleAddSelect('action')}>Action</MenuItem>
        <MenuItem onClick={() => handleAddSelect('if')}>If / Then (condition)</MenuItem>
        <MenuItem
          onClick={() => handleAddSelect('else')}
          disabled={!topLevelSteps.length || topLevelSteps[topLevelSteps.length - 1]?.step_type !== 'if'}
        >
          Otherwise (else)
        </MenuItem>
        <MenuItem disabled>Delay (coming soon)</MenuItem>
      </Menu>

      <ConfirmDialog
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, stepId: null })}
        onConfirm={() => {
          if (deleteConfirm.stepId) onDeleteStep(deleteConfirm.stepId);
          setDeleteConfirm({ open: false, stepId: null });
        }}
        title="Delete Step"
        message="Are you sure you want to delete this step? This action cannot be undone."
        confirmLabel="Delete"
        confirmColor="error"
      />
    </Stack>
  );
}
