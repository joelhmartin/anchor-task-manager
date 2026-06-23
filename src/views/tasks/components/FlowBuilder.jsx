import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import {
  Box,
  Button,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Skeleton,
  Typography,
  useTheme
} from '@mui/material';
import { green, orange, grey } from '@mui/material/colors';
import { IconBolt, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import { getActionLabel, getTriggerLabel } from 'constants/automationTypes';
import { AUTOMATION_NODE_COLORS } from 'constants/taskDefaults';

// ── Dagre auto-layout ─────────────────────────────────────────────────────────

const NODE_WIDTH = 260;
const NODE_HEIGHT = 72;
const CONDITION_HEIGHT = 56;

function layoutGraph(nodes, edges) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 30, ranksep: 36, marginx: 16, marginy: 16 });

  nodes.forEach((node) => {
    const h = node.type === 'conditionNode' ? CONDITION_HEIGHT : NODE_HEIGHT;
    g.setNode(node.id, { width: NODE_WIDTH, height: h });
  });
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const h = node.type === 'conditionNode' ? CONDITION_HEIGHT : NODE_HEIGHT;
    return { ...node, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - h / 2 } };
  });
}

// ── Custom Nodes ──────────────────────────────────────────────────────────────

function TriggerNode({ data }) {
  return (
    <Box
      sx={{
        px: 2, py: 1.25,
        border: `2px solid ${AUTOMATION_NODE_COLORS.trigger}`,
        borderRadius: 2,
        bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(46, 125, 50, 0.2)' : green[50]),
        minWidth: NODE_WIDTH,
        maxWidth: NODE_WIDTH
      }}
    >
      <Handle type="source" position={Position.Bottom} style={{ background: AUTOMATION_NODE_COLORS.trigger }} />
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <IconBolt size={16} color={AUTOMATION_NODE_COLORS.trigger} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600, color: AUTOMATION_NODE_COLORS.trigger }}>Trigger</Typography>
          </Stack>
          {(() => {
            const triggerSummary = `${getTriggerLabel(data.triggerType)}${data.triggerConfig?.to_status ? ` \u2192 ${data.triggerConfig.to_status}` : ''}`;
            return (
              <Typography variant="body2" noWrap sx={{ mt: 0.25 }} title={triggerSummary}>
                {triggerSummary}
              </Typography>
            );
          })()}
        </Box>
        <IconButton
          size="small"
          aria-label="Edit trigger"
          sx={{ position: 'relative', zIndex: 10 }}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            data.onEditTrigger?.();
          }}
        >
          <IconPencil size={13} color={AUTOMATION_NODE_COLORS.trigger} />
        </IconButton>
      </Stack>
    </Box>
  );
}

function ActionNode({ data }) {
  return (
    <Box
      sx={{
        px: 2, py: 1.25,
        border: '1px solid',
        borderColor: 'divider',
        borderLeft: `4px solid ${AUTOMATION_NODE_COLORS.action}`,
        borderRadius: 2,
        bgcolor: 'background.paper',
        minWidth: NODE_WIDTH,
        maxWidth: NODE_WIDTH,
        '&:hover .flow-actions': { opacity: 1 }
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: AUTOMATION_NODE_COLORS.action }} />
      <Handle type="source" position={Position.Bottom} style={{ background: AUTOMATION_NODE_COLORS.action }} />
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Chip
              label="Action"
              size="small"
              sx={{ height: 18, fontSize: '0.6rem', bgcolor: AUTOMATION_NODE_COLORS.action, color: 'common.white', fontWeight: 600 }}
            />
            <Chip label={getActionLabel(data.actionType)} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.6rem' }} />
          </Stack>
          {data.actionConfig?.title && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.25 }} title={data.actionConfig.title}>
              {data.actionConfig.title}
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={0} className="flow-actions" sx={{ opacity: 0, transition: 'opacity 0.15s' }}>
          <IconButton size="small" aria-label="Edit action step" onClick={(e) => { e.stopPropagation(); data.onEdit?.(data.step); }}>
            <IconPencil size={13} />
          </IconButton>
          <IconButton size="small" color="error" aria-label="Delete action step" onClick={(e) => { e.stopPropagation(); data.onDelete?.(data.step.id); }}>
            <IconTrash size={13} />
          </IconButton>
        </Stack>
      </Stack>
    </Box>
  );
}

function ConditionNode({ data }) {
  const color = data.stepType === 'if' ? AUTOMATION_NODE_COLORS.if : AUTOMATION_NODE_COLORS.else;
  const label = data.stepType === 'if' ? 'If / Then' : 'Otherwise';

  let summary = '';
  if (data.stepType === 'if') {
    const group = data.conditionGroup;
    if (group?.conditions?.length) {
      const logic = group.logic === 'or' ? 'ANY' : 'ALL';
      summary = `${logic} of ${group.conditions.length} condition${group.conditions.length !== 1 ? 's' : ''}`;
    } else {
      summary = 'No conditions set';
    }
  }

  return (
    <Box
      sx={{
        px: 2, py: 1,
        border: '1px solid',
        borderColor: 'divider',
        borderLeft: `4px solid ${color}`,
        borderRadius: 2,
        bgcolor: (t) =>
          t.palette.mode === 'dark'
            ? data.stepType === 'if'
              ? 'rgba(237, 108, 2, 0.18)'
              : 'rgba(255, 255, 255, 0.05)'
            : data.stepType === 'if'
              ? orange[50]
              : grey[100],
        minWidth: NODE_WIDTH,
        maxWidth: NODE_WIDTH,
        '&:hover .flow-actions': { opacity: 1 }
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: color }} />
      <Handle type="source" position={Position.Bottom} style={{ background: color }} id="default" />
      {data.stepType === 'if' && (
        <Handle type="source" position={Position.Right} style={{ background: AUTOMATION_NODE_COLORS.else }} id="else" />
      )}
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Chip
              label={label}
              size="small"
              sx={{ height: 18, fontSize: '0.6rem', bgcolor: color, color: 'common.white', fontWeight: 600 }}
            />
            {summary && (
              <Typography variant="caption" color="text.secondary" noWrap title={summary}>{summary}</Typography>
            )}
          </Stack>
        </Box>
        <Stack direction="row" spacing={0} className="flow-actions" sx={{ opacity: 0, transition: 'opacity 0.15s' }}>
          <IconButton size="small" aria-label="Edit condition step" onClick={(e) => { e.stopPropagation(); data.onEdit?.(data.step); }}>
            <IconPencil size={13} />
          </IconButton>
          <IconButton size="small" color="error" aria-label="Delete condition step" onClick={(e) => { e.stopPropagation(); data.onDelete?.(data.step.id); }}>
            <IconTrash size={13} />
          </IconButton>
        </Stack>
      </Stack>
    </Box>
  );
}

function AddNode({ data }) {
  const [anchorEl, setAnchorEl] = useState(null);

  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        <Handle type="target" position={Position.Top} style={{ background: AUTOMATION_NODE_COLORS.add }} />
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          startIcon={<IconPlus size={14} />}
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={{
            borderStyle: 'dashed',
            borderColor: 'divider',
            textTransform: 'none',
            fontSize: '0.75rem',
            color: 'text.secondary',
            minWidth: 140,
            '&:hover': { borderColor: 'primary.main', color: 'primary.main' }
          }}
        >
          Add step
        </Button>
      </Box>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem onClick={() => { setAnchorEl(null); data.onAdd?.('action', data.parentStepId); }}>Action</MenuItem>
        <MenuItem onClick={() => { setAnchorEl(null); data.onAdd?.('if', data.parentStepId); }}>If / Then (condition)</MenuItem>
        <MenuItem onClick={() => { setAnchorEl(null); data.onAdd?.('else', data.parentStepId); }}>Otherwise (else)</MenuItem>
        <MenuItem disabled>Delay (coming soon)</MenuItem>
      </Menu>
    </>
  );
}

const nodeTypes = {
  triggerNode: TriggerNode,
  actionNode: ActionNode,
  conditionNode: ConditionNode,
  addNode: AddNode
};

// ── Steps → Nodes/Edges conversion ───────────────────────────────────────────

function stepsToFlow(steps, automation, { onEdit, onDelete, onAdd, onEditTrigger }) {
  const nodes = [];
  const edges = [];

  // Trigger node (always first)
  nodes.push({
    id: 'trigger',
    type: 'triggerNode',
    data: {
      triggerType: automation.trigger_type,
      triggerConfig: automation.trigger_config,
      onEditTrigger
    },
    position: { x: 0, y: 0 }
  });

  // Separate top-level steps from children
  const topLevel = steps.filter((s) => !s.parent_step_id).sort((a, b) => a.step_order - b.step_order);
  const childrenByParent = {};
  steps.forEach((s) => {
    if (s.parent_step_id) {
      if (!childrenByParent[s.parent_step_id]) childrenByParent[s.parent_step_id] = [];
      childrenByParent[s.parent_step_id].push(s);
    }
  });
  Object.values(childrenByParent).forEach((arr) => arr.sort((a, b) => a.step_order - b.step_order));

  // Helper: add a chain of child action nodes under a parent
  function addBranch(parentId, parentStepId, children, sourceHandle) {
    let prev = parentId;
    children.forEach((child) => {
      nodes.push({
        id: child.id,
        type: 'actionNode',
        data: { step: child, actionType: child.action_type, actionConfig: child.action_config, onEdit, onDelete },
        position: { x: 0, y: 0 }
      });
      edges.push({
        id: `${prev}->${child.id}`,
        source: prev,
        target: child.id,
        sourceHandle: prev === parentId ? sourceHandle : undefined,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 }
      });
      prev = child.id;
    });
    // Add "add step" at end of branch
    const addId = `add-child-${parentStepId}`;
    nodes.push({ id: addId, type: 'addNode', data: { onAdd, parentStepId }, position: { x: 0, y: 0 } });
    edges.push({
      id: `${prev}->${addId}`,
      source: prev, target: addId,
      type: 'smoothstep',
      style: { strokeDasharray: '5 5', stroke: AUTOMATION_NODE_COLORS.add }
    });
  }

  let prevId = 'trigger';
  let i = 0;

  while (i < topLevel.length) {
    const step = topLevel[i];
    const nodeId = step.id;

    if (step.step_type === 'if') {
      // Condition node
      nodes.push({
        id: nodeId,
        type: 'conditionNode',
        data: { step, stepType: 'if', conditionGroup: step.condition_group, onEdit, onDelete },
        position: { x: 0, y: 0 }
      });
      edges.push({
        id: `${prevId}->${nodeId}`,
        source: prevId, target: nodeId, sourceHandle: 'default',
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 }
      });

      // "Then" branch — children of the if step (left/down via default handle)
      const thenChildren = childrenByParent[step.id] || [];
      if (thenChildren.length) {
        addBranch(nodeId, step.id, thenChildren, 'default');
      } else {
        const addThenId = `add-child-${step.id}`;
        nodes.push({ id: addThenId, type: 'addNode', data: { onAdd, parentStepId: step.id }, position: { x: 0, y: 0 } });
        edges.push({
          id: `${nodeId}->${addThenId}`,
          source: nodeId, target: addThenId, sourceHandle: 'default',
          type: 'smoothstep', style: { strokeDasharray: '5 5', stroke: AUTOMATION_NODE_COLORS.add }
        });
      }

      // Check if next step is an "else" — fork to the right
      const nextStep = topLevel[i + 1];
      if (nextStep?.step_type === 'else') {
        i++; // consume the else
        nodes.push({
          id: nextStep.id,
          type: 'conditionNode',
          data: { step: nextStep, stepType: 'else', conditionGroup: null, onEdit, onDelete },
          position: { x: 0, y: 0 }
        });
        // Edge from if → else via the "else" handle (right side)
        edges.push({
          id: `${nodeId}->${nextStep.id}`,
          source: nodeId, target: nextStep.id, sourceHandle: 'else',
          type: 'smoothstep',
          label: 'else',
          labelStyle: { fontSize: 10, fill: AUTOMATION_NODE_COLORS.else },
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
          style: { stroke: AUTOMATION_NODE_COLORS.else }
        });
        // Else branch children
        const elseChildren = childrenByParent[nextStep.id] || [];
        if (elseChildren.length) {
          addBranch(nextStep.id, nextStep.id, elseChildren, 'default');
        } else {
          const addElseId = `add-child-${nextStep.id}`;
          nodes.push({ id: addElseId, type: 'addNode', data: { onAdd, parentStepId: nextStep.id }, position: { x: 0, y: 0 } });
          edges.push({
            id: `${nextStep.id}->${addElseId}`,
            source: nextStep.id, target: addElseId, sourceHandle: 'default',
            type: 'smoothstep', style: { strokeDasharray: '5 5', stroke: AUTOMATION_NODE_COLORS.add }
          });
        }
      }

      prevId = nodeId;
    } else if (step.step_type === 'else') {
      // Orphan else (shouldn't happen with validation, but handle gracefully)
      nodes.push({
        id: nodeId,
        type: 'conditionNode',
        data: { step, stepType: 'else', conditionGroup: null, onEdit, onDelete },
        position: { x: 0, y: 0 }
      });
      edges.push({
        id: `${prevId}->${nodeId}`,
        source: prevId, target: nodeId, sourceHandle: 'default',
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 }
      });
      const elseChildren = childrenByParent[step.id] || [];
      if (elseChildren.length) addBranch(nodeId, step.id, elseChildren, 'default');
      prevId = nodeId;
    } else {
      // Regular action step
      nodes.push({
        id: nodeId,
        type: 'actionNode',
        data: { step, actionType: step.action_type, actionConfig: step.action_config, onEdit, onDelete },
        position: { x: 0, y: 0 }
      });
      edges.push({
        id: `${prevId}->${nodeId}`,
        source: prevId, target: nodeId, sourceHandle: 'default',
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 }
      });
      prevId = nodeId;
    }

    i++;
  }

  // Add "add step" button at the end of the main flow
  const addEndId = 'add-end';
  nodes.push({ id: addEndId, type: 'addNode', data: { onAdd, parentStepId: null }, position: { x: 0, y: 0 } });
  edges.push({
    id: `${prevId}->${addEndId}`,
    source: prevId, target: addEndId,
    type: 'smoothstep',
    style: { strokeDasharray: '5 5', stroke: AUTOMATION_NODE_COLORS.add }
  });

  // Apply dagre auto-layout
  const laidOut = layoutGraph(nodes, edges);
  return { nodes: laidOut, edges };
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function FlowBuilder({ automation, steps = [], loading, onEditStep, onDeleteStep, onAddStep, onEditTrigger }) {
  const theme = useTheme();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, stepId: null });

  const requestDeleteStep = useCallback((stepId) => {
    if (!stepId) return;
    setDeleteConfirm({ open: true, stepId });
  }, []);

  const callbacks = useMemo(() => ({
    onEdit: onEditStep,
    onDelete: requestDeleteStep,
    onAdd: onAddStep,
    onEditTrigger
  }), [onEditStep, requestDeleteStep, onAddStep, onEditTrigger]);

  useEffect(() => {
    if (!automation || loading) return;
    const { nodes: n, edges: e } = stepsToFlow(steps, automation, callbacks);
    setNodes(n);
    setEdges(e);
  }, [steps, automation, loading, callbacks, setNodes, setEdges]);

  const handleNodeClick = useCallback((_event, node) => {
    if (node.type === 'triggerNode') {
      onEditTrigger?.();
    }
  }, [onEditTrigger]);

  if (loading) {
    return (
      <Stack spacing={1}>
        {[1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={48} />)}
      </Stack>
    );
  }

  const edgeStyle = {
    stroke: theme.palette.divider,
    strokeWidth: 1.5
  };

  return (
    <Box sx={{ height: 500, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={{ style: edgeStyle }}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} color={theme.palette.divider} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeStrokeWidth={2}
          nodeColor={(n) => {
            if (n.type === 'triggerNode') return AUTOMATION_NODE_COLORS.trigger;
            if (n.type === 'actionNode') return AUTOMATION_NODE_COLORS.action;
            if (n.type === 'conditionNode') return AUTOMATION_NODE_COLORS.if;
            return AUTOMATION_NODE_COLORS.add;
          }}
          style={{ height: 80, width: 120 }}
        />
      </ReactFlow>

      <ConfirmDialog
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, stepId: null })}
        onConfirm={() => {
          const id = deleteConfirm.stepId;
          setDeleteConfirm({ open: false, stepId: null });
          if (id) onDeleteStep?.(id);
        }}
        title="Delete Step"
        message="Are you sure you want to delete this step? This action cannot be undone."
        secondaryText="Any child steps nested below it will be deleted too."
        confirmLabel="Delete"
        confirmColor="error"
      />
    </Box>
  );
}
