import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
  Button,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FolderIcon from '@mui/icons-material/Folder';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';

import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import FormDialog from 'ui-component/extended/FormDialog';
import useAuth from 'hooks/useAuth';
import { useToast } from 'contexts/ToastContext';
import { useTaskContext } from 'contexts/TaskContext';
import {
  createTaskBoard,
  createTaskWorkspace,
  deleteTaskBoard,
  deleteTaskWorkspace,
  updateTaskBoard
} from 'api/tasks';

function getEffectiveRole(user) {
  return user?.effective_role || user?.role;
}

// ============================
// Local board grouping + ordering
// ============================
const BOARD_ORG_STORAGE_VERSION = 1;
function getBoardOrgStorageKey(userId) {
  return `taskSidebar.boardOrg.v${BOARD_ORG_STORAGE_VERSION}.${userId || 'anon'}`;
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function loadBoardOrg(userId) {
  if (typeof window === 'undefined') return { version: BOARD_ORG_STORAGE_VERSION, workspaces: {} };
  const raw = window.localStorage.getItem(getBoardOrgStorageKey(userId));
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== 'object') return { version: BOARD_ORG_STORAGE_VERSION, workspaces: {} };
  if (parsed.version !== BOARD_ORG_STORAGE_VERSION) return { version: BOARD_ORG_STORAGE_VERSION, workspaces: {} };
  if (!parsed.workspaces || typeof parsed.workspaces !== 'object') return { version: BOARD_ORG_STORAGE_VERSION, workspaces: {} };
  return parsed;
}

function saveBoardOrg(userId, org) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getBoardOrgStorageKey(userId), JSON.stringify(org));
  } catch {
    // ignore quota errors
  }
}

function ensureWorkspaceOrg(org, workspaceId) {
  const next = org && typeof org === 'object' ? org : { version: BOARD_ORG_STORAGE_VERSION, workspaces: {} };
  if (!next.workspaces) next.workspaces = {};
  if (!next.workspaces[workspaceId]) {
    next.workspaces[workspaceId] = {
      groups: {}, // { [groupId]: { id, name, board_ids:[], collapsed?:bool } }
      group_order: [],
      ungrouped_order: []
    };
  } else {
    const ws = next.workspaces[workspaceId];
    if (!ws.groups || typeof ws.groups !== 'object') ws.groups = {};
    if (!Array.isArray(ws.group_order)) ws.group_order = [];
    if (!Array.isArray(ws.ungrouped_order)) ws.ungrouped_order = [];
  }
  return next;
}

function uniq(list) {
  const out = [];
  const seen = new Set();
  for (const x of list || []) {
    if (!x) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function removeFromArray(arr, value) {
  const list = Array.isArray(arr) ? arr : [];
  return list.filter((x) => x !== value);
}

function insertBefore(arr, value, beforeValue) {
  const list = removeFromArray(arr, value);
  const idx = list.indexOf(beforeValue);
  if (idx < 0) return [...list, value];
  return [...list.slice(0, idx), value, ...list.slice(idx)];
}

function makeId(prefix = 'grp') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

export default function TaskPanel() {
  const { user } = useAuth();
  const toast = useToast();
  const effRole = useMemo(() => getEffectiveRole(user), [user]);
  const canCreateBoard = effRole === 'superadmin' || effRole === 'admin';
  const canDelete = canCreateBoard;

  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceIdFromUrl = searchParams.get('workspace') || '';
  const boardIdFromUrl = searchParams.get('board') || '';

  const {
    workspaces, workspacesLoading: loadingWorkspaces,
    boardsByWorkspace, setBoardsByWorkspace,
    setWorkspaces,
    addBoard: ctxAddBoard, removeBoard: ctxRemoveBoard,
    addWorkspace: ctxAddWorkspace, removeWorkspace: ctxRemoveWorkspace,
    loadWorkspaces: ctxLoadWorkspaces, loadBoardsForWorkspace: ctxLoadBoardsForWorkspace
  } = useTaskContext();

  const [expanded, setExpanded] = useState(workspaceIdFromUrl || '');

  // Drag-hover auto-expand for accordions
  const dragOpenTimerRef = useRef(null);
  const dragHoverWorkspaceRef = useRef('');

  // Local board org state
  const [boardOrg, setBoardOrg] = useState(() => loadBoardOrg(user?.id));
  useEffect(() => setBoardOrg(loadBoardOrg(user?.id)), [user?.id]);
  useEffect(() => saveBoardOrg(user?.id, boardOrg), [user?.id, boardOrg]);

  // Meta/cmd multi-select grouping
  const [isMetaDown, setIsMetaDown] = useState(false);
  const [selectedForGroup, setSelectedForGroup] = useState(() => new Set());
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupDialogName, setGroupDialogName] = useState('');

  // Drag highlight state
  const [dropHighlight, setDropHighlight] = useState({ type: '', id: '' });
  const [movingBoardId, setMovingBoardId] = useState('');

  const [creatingBoardFor, setCreatingBoardFor] = useState('');
  const [creatingBoardGroupId, setCreatingBoardGroupId] = useState('');
  const [newBoardName, setNewBoardName] = useState('');
  const [creatingBoard, setCreatingBoard] = useState(false);

  const [creatingWorkspaceOpen, setCreatingWorkspaceOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);

  const [deleteWorkspaceId, setDeleteWorkspaceId] = useState('');
  const [deleteBoardInfo, setDeleteBoardInfo] = useState({ workspaceId: '', boardId: '' });
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setExpanded(workspaceIdFromUrl || '');
  }, [workspaceIdFromUrl]);

  useEffect(() => {
    const load = async () => {
      const ws = await ctxLoadWorkspaces();
      if (!workspaceIdFromUrl && ws.length) {
        const next = new URLSearchParams(searchParams);
        next.set('workspace', ws[0].id);
        setSearchParams(next, { replace: true });
      }
      // Preload boards for all workspaces
      await Promise.all(ws.map((w) => ctxLoadBoardsForWorkspace(w.id)));
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Cleanup timers if a drag ends outside of our elements
    const clear = () => {
      if (dragOpenTimerRef.current) clearTimeout(dragOpenTimerRef.current);
      dragOpenTimerRef.current = null;
      dragHoverWorkspaceRef.current = '';
    };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, []);

  const isBoardDragEvent = (e) => {
    try {
      const types = Array.from(e?.dataTransfer?.types || []);
      return types.includes('application/json');
    } catch {
      return false;
    }
  };

  const scheduleExpandWorkspaceOnHover = (workspaceId) => {
    if (!workspaceId) return;
    // already expanded or already scheduled for this workspace
    if (expanded === workspaceId) return;
    if (dragHoverWorkspaceRef.current === workspaceId && dragOpenTimerRef.current) return;
    if (dragOpenTimerRef.current) clearTimeout(dragOpenTimerRef.current);
    dragHoverWorkspaceRef.current = workspaceId;
    dragOpenTimerRef.current = setTimeout(() => {
      setExpanded(workspaceId);
      selectWorkspace(workspaceId);
      dragOpenTimerRef.current = null;
    }, 500);
  };

  const cancelScheduledExpand = (workspaceId) => {
    if (workspaceId && dragHoverWorkspaceRef.current !== workspaceId) return;
    if (dragOpenTimerRef.current) clearTimeout(dragOpenTimerRef.current);
    dragOpenTimerRef.current = null;
    dragHoverWorkspaceRef.current = '';
  };

  // Track meta key (cmd on mac) to drive grouping UX
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Meta') setIsMetaDown(true);
    };
    const onKeyUp = (e) => {
      if (e.key !== 'Meta') return;
      setIsMetaDown(false);
      setSelectedForGroup((prev) => {
        if (!prev || prev.size < 2) return prev;
        setGroupDialogName('');
        setGroupDialogOpen(true);
        return prev;
      });
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const toggleSelectForGroup = (boardId) => {
    setSelectedForGroup((prev) => {
      const next = new Set(prev || []);
      if (next.has(boardId)) next.delete(boardId);
      else next.add(boardId);
      return next;
    });
  };

  const clearSelectForGroup = () => setSelectedForGroup(new Set());

  const getBoardWorkspaceId = (boardId) => {
    for (const wsId of Object.keys(boardsByWorkspace || {})) {
      const b = (boardsByWorkspace?.[wsId] || []).find((x) => x.id === boardId);
      if (b) return b.workspace_id || wsId;
    }
    return '';
  };

  const normalizeWorkspaceOrgForBoards = (workspaceId, boards) => {
    const boardIds = (boards || []).map((b) => b.id).filter(Boolean);
    setBoardOrg((prev) => {
      let next = ensureWorkspaceOrg({ ...(prev || { version: BOARD_ORG_STORAGE_VERSION, workspaces: {} }) }, workspaceId);
      const ws = next.workspaces[workspaceId];
      const boardIdSet = new Set(boardIds);

      ws.ungrouped_order = (ws.ungrouped_order || []).filter((id) => boardIdSet.has(id));
      for (const gid of Object.keys(ws.groups || {})) {
        const g = ws.groups[gid];
        if (!g) continue;
        g.board_ids = (g.board_ids || []).filter((id) => boardIdSet.has(id));
        if (!g.board_ids.length) {
          delete ws.groups[gid];
          ws.group_order = (ws.group_order || []).filter((x) => x !== gid);
        }
      }

      const used = new Set(ws.ungrouped_order);
      for (const gid of ws.group_order || []) {
        const g = ws.groups?.[gid];
        for (const bid of g?.board_ids || []) used.add(bid);
      }
      for (const bid of boardIds) {
        if (!used.has(bid)) ws.ungrouped_order.push(bid);
      }
      ws.ungrouped_order = uniq(ws.ungrouped_order);
      ws.group_order = uniq(ws.group_order).filter((gid) => Boolean(ws.groups?.[gid]));
      return { ...next };
    });
  };

  useEffect(() => {
    for (const w of workspaces || []) {
      normalizeWorkspaceOrgForBoards(w.id, boardsByWorkspace[w.id] || []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces.length, Object.keys(boardsByWorkspace).length]);

  const toggleGroupCollapsed = (workspaceId, groupId) => {
    setBoardOrg((prev) => {
      const next = ensureWorkspaceOrg({ ...(prev || { version: BOARD_ORG_STORAGE_VERSION, workspaces: {} }) }, workspaceId);
      const g = next.workspaces[workspaceId]?.groups?.[groupId];
      if (!g) return prev;
      g.collapsed = !g.collapsed;
      return { ...next };
    });
  };

  const createBoardGroupFromSelection = (workspaceId, name, boardIds) => {
    if (!workspaceId || !name?.trim() || !boardIds?.length) return;
    const groupId = makeId('group');
    setBoardOrg((prev) => {
      const next = ensureWorkspaceOrg({ ...(prev || { version: BOARD_ORG_STORAGE_VERSION, workspaces: {} }) }, workspaceId);
      const ws = next.workspaces[workspaceId];
      ws.groups[groupId] = { id: groupId, name: name.trim(), board_ids: [...boardIds], collapsed: false };
      ws.group_order = uniq([groupId, ...(ws.group_order || [])]);
      ws.ungrouped_order = (ws.ungrouped_order || []).filter((id) => !boardIds.includes(id));
      for (const gid of Object.keys(ws.groups || {})) {
        if (gid === groupId) continue;
        ws.groups[gid].board_ids = (ws.groups[gid].board_ids || []).filter((id) => !boardIds.includes(id));
      }
      return { ...next };
    });
  };

  const moveBoardInOrg = ({ boardId, fromWorkspaceId, fromGroupId, toWorkspaceId, toGroupId, beforeBoardId } = {}) => {
    if (!boardId || !toWorkspaceId) return;
    setBoardOrg((prev) => {
      let next = { ...(prev || { version: BOARD_ORG_STORAGE_VERSION, workspaces: {} }) };
      next = ensureWorkspaceOrg(next, toWorkspaceId);
      if (fromWorkspaceId) next = ensureWorkspaceOrg(next, fromWorkspaceId);

      if (fromWorkspaceId) {
        const fromWs = next.workspaces[fromWorkspaceId];
        if (fromGroupId && fromWs.groups?.[fromGroupId]) {
          fromWs.groups[fromGroupId].board_ids = removeFromArray(fromWs.groups[fromGroupId].board_ids, boardId);
        } else {
          fromWs.ungrouped_order = removeFromArray(fromWs.ungrouped_order, boardId);
        }
        for (const gid of Object.keys(fromWs.groups || {})) {
          fromWs.groups[gid].board_ids = removeFromArray(fromWs.groups[gid].board_ids, boardId);
        }
      }

      const toWs = next.workspaces[toWorkspaceId];
      toWs.ungrouped_order = removeFromArray(toWs.ungrouped_order, boardId);
      for (const gid of Object.keys(toWs.groups || {})) {
        toWs.groups[gid].board_ids = removeFromArray(toWs.groups[gid].board_ids, boardId);
      }

      if (toGroupId && toWs.groups?.[toGroupId]) {
        const list = toWs.groups[toGroupId].board_ids || [];
        toWs.groups[toGroupId].board_ids = beforeBoardId ? insertBefore(list, boardId, beforeBoardId) : [...list, boardId];
      } else {
        const list = toWs.ungrouped_order || [];
        toWs.ungrouped_order = beforeBoardId ? insertBefore(list, boardId, beforeBoardId) : [...list, boardId];
      }

      return { ...next };
    });
  };

  const onDragStartBoard = (e, payload) => {
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/json', JSON.stringify({ kind: 'board', ...payload }));
    } catch {
      // ignore
    }
  };

  const readDragPayload = (e) => {
    try {
      const raw = e.dataTransfer.getData('application/json');
      const parsed = safeJsonParse(raw);
      if (parsed?.kind === 'board' && parsed.boardId) return parsed;
      return null;
    } catch {
      return null;
    }
  };

  const refreshWorkspaceBoards = async (workspaceIds) => {
    const ids = Array.from(new Set((workspaceIds || []).filter(Boolean)));
    if (!ids.length) return;
    await Promise.all(ids.map((id) => ctxLoadBoardsForWorkspace(id)));
  };

  const selectWorkspace = (workspaceId) => {
    const next = new URLSearchParams(searchParams);
    if (workspaceId) next.set('workspace', workspaceId);
    else next.delete('workspace');
    next.delete('board');
    next.delete('item');
    next.set('pane', 'boards');
    setSearchParams(next, { replace: true });
  };

  const selectBoard = (workspaceId, boardId) => {
    const next = new URLSearchParams(searchParams);
    if (workspaceId) next.set('workspace', workspaceId);
    if (boardId) next.set('board', boardId);
    next.delete('item');
    next.set('pane', 'boards');
    setSearchParams(next, { replace: true });
  };

  const openCreateBoard = (workspaceId, groupId = '') => {
    setCreatingBoardFor(workspaceId);
    setCreatingBoardGroupId(groupId || '');
    setNewBoardName('');
  };

  const openCreateWorkspace = () => {
    setCreatingWorkspaceOpen(true);
    setNewWorkspaceName('');
  };

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    setCreatingWorkspace(true);
    try {
      const workspace = await createTaskWorkspace({ name: newWorkspaceName.trim() });
      ctxAddWorkspace(workspace);
      setBoardsByWorkspace((prev) => ({ ...prev, [workspace.id]: [] }));
      setCreatingWorkspaceOpen(false);
      selectWorkspace(workspace.id);
    } catch (_err) {
      // ignore
    } finally {
      setCreatingWorkspace(false);
    }
  };

  const handleCreateBoard = async () => {
    if (!creatingBoardFor || !newBoardName.trim()) return;
    setCreatingBoard(true);
    try {
      const board = await createTaskBoard(creatingBoardFor, { name: newBoardName.trim() });
      ctxAddBoard(board);
      if (creatingBoardGroupId) {
        // Place the new board into the target local group (purely organizational)
        setBoardOrg((prev) => {
          const next = ensureWorkspaceOrg({ ...(prev || { version: BOARD_ORG_STORAGE_VERSION, workspaces: {} }) }, creatingBoardFor);
          const ws = next.workspaces[creatingBoardFor];
          const g = ws.groups?.[creatingBoardGroupId];
          if (g) {
            g.board_ids = uniq([board.id, ...(g.board_ids || [])]);
            ws.ungrouped_order = (ws.ungrouped_order || []).filter((id) => id !== board.id);
            // ensure not duplicated across groups
            for (const gid of Object.keys(ws.groups || {})) {
              if (gid === creatingBoardGroupId) continue;
              ws.groups[gid].board_ids = removeFromArray(ws.groups[gid].board_ids, board.id);
            }
          }
          return { ...next };
        });
      }
      setNewBoardName('');
      setCreatingBoardFor('');
      setCreatingBoardGroupId('');
      selectBoard(board.workspace_id, board.id);
    } catch (_err) {
      // ignore
    } finally {
      setCreatingBoard(false);
    }
  };

  const handleDeleteWorkspace = async () => {
    if (!deleteWorkspaceId) return;
    setDeleting(true);
    try {
      await deleteTaskWorkspace(deleteWorkspaceId);
      ctxRemoveWorkspace(deleteWorkspaceId);

      if (workspaceIdFromUrl === deleteWorkspaceId) {
        const remaining = (workspaces || []).filter((w) => w.id !== deleteWorkspaceId);
        const nextWs = remaining[0]?.id || '';
        const next = new URLSearchParams(searchParams);
        if (nextWs) next.set('workspace', nextWs);
        else next.delete('workspace');
        next.delete('board');
        next.delete('item');
        next.set('pane', 'boards');
        setSearchParams(next, { replace: true });
      }
      setDeleteWorkspaceId('');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteBoard = async () => {
    if (!deleteBoardInfo?.boardId) return;
    setDeleting(true);
    try {
      await deleteTaskBoard(deleteBoardInfo.boardId);
      ctxRemoveBoard(deleteBoardInfo.boardId);

      if (boardIdFromUrl === deleteBoardInfo.boardId) {
        const next = new URLSearchParams(searchParams);
        next.delete('board');
        next.delete('item');
        next.set('pane', 'boards');
        setSearchParams(next, { replace: true });
      }
      setDeleteBoardInfo({ workspaceId: '', boardId: '' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box
      sx={{
        mt: 1,
        // Ensure all buttons in the panel keep labels on one line
        '& .MuiButton-root': { whiteSpace: 'nowrap' }
      }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle1">Workspaces</Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            {canCreateBoard && (
              <IconButton size="small" onClick={openCreateWorkspace} aria-label="create workspace">
                <AddIcon fontSize="small" />
              </IconButton>
            )}
            {loadingWorkspaces && <CircularProgress size={16} />}
          </Stack>
        </Stack>

        {workspaces.length === 0 && !loadingWorkspaces && (
          <Typography variant="body2" color="text.secondary">
            No workspaces found.
          </Typography>
        )}

        <Stack spacing={0.75}>
          {workspaces.map((w) => {
            const boards = boardsByWorkspace[w.id] || [];
            const isExpanded = expanded === w.id;
            const wsOrg = boardOrg?.workspaces?.[w.id] || { groups: {}, group_order: [], ungrouped_order: [] };
            const groups = (wsOrg.group_order || []).map((gid) => wsOrg.groups?.[gid]).filter(Boolean);
            const ungrouped = wsOrg.ungrouped_order || [];
            const boardById = {};
            for (const b of boards) {
              if (b?.id) boardById[b.id] = b;
            }

            // When ⌘ is held, show folder-select icons on all boards (even before selection starts).
            const selectionModeActive = isMetaDown;
            return (
              <Accordion
                key={w.id}
                expanded={isExpanded}
                onChange={(_e, exp) => {
                  setExpanded(exp ? w.id : '');
                  if (exp) selectWorkspace(w.id);
                }}
                sx={{
                  '&.Mui-expanded': {
                    margin: 0
                  }
                }}
              >
                <AccordionSummary
                  component="div"
                  expandIcon={<ExpandMoreIcon />}
                  onDragEnter={(e) => {
                    if (!isBoardDragEvent(e)) return;
                    scheduleExpandWorkspaceOnHover(w.id);
                  }}
                  onDragOver={(e) => {
                    if (!isBoardDragEvent(e)) return;
                    // required so drag events keep firing + allow timer to work smoothly
                    e.preventDefault();
                    scheduleExpandWorkspaceOnHover(w.id);
                  }}
                  onDragLeave={() => cancelScheduledExpand(w.id)}
                  sx={{
                    px: 0,
                    py: 0,
                    mb: 0,
                    mt: 1,
                    minHeight: 'auto',
                    '&.MuiButtonBase-root': { px: 0, py: 0, minHeight: 'auto' },
                    '& .MuiAccordionSummary-content': { my: 0 },
                    '& .MuiAccordionSummary-contentGutters': { margin: 0 },
                    '& .MuiAccordionSummary-expandIconWrapper': { mr: 0 },
                    '&.Mui-expanded': {
                      minHeight: 'auto',
                      my: 0
                    }
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ width: '100%', minWidth: 0 }}>
                    <Tooltip title={w.name} placement="top" enterDelay={400}>
                      <Button
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectWorkspace(w.id);
                        }}
                        sx={{
                          textTransform: 'none',
                          justifyContent: 'flex-start',
                          py: 0,
                          pb: 0,
                          pt: 0,
                          minHeight: 0,
                          height: 'auto',
                          lineHeight: 1.2,
                          minWidth: 0,
                          flex: 1,
                          overflow: 'hidden',
                          '&.MuiButton-root': { minHeight: 0, paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 }
                        }}
                      >
                        <Box
                          component="span"
                          sx={{ display: 'block', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}
                        >
                          {w.name}
                        </Box>
                      </Button>
                    </Tooltip>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      {canCreateBoard && (
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            openCreateBoard(w.id);
                          }}
                          aria-label="create board"
                        >
                          <AddIcon fontSize="small" />
                        </IconButton>
                      )}
                      {canDelete && (
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteWorkspaceId(w.id);
                          }}
                          aria-label="delete workspace"
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </Stack>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 0, py: 0, my: 0, '&.Mui-expanded': { py: 0, my: 0 } }}>
                  <Stack
                    spacing={0.5}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDropHighlight({ type: 'workspace', id: w.id });
                    }}
                    onDragLeave={() => setDropHighlight((prev) => (prev.type === 'workspace' && prev.id === w.id ? { type: '', id: '' } : prev))}
                    onDrop={async (e) => {
                      e.preventDefault();
                      const p = readDragPayload(e);
                      setDropHighlight({ type: '', id: '' });
                      if (!p) return;
                      // If dropped to workspace root: ungrouped
                      if (p.fromWorkspaceId && p.fromWorkspaceId !== w.id) {
                        setMovingBoardId(p.boardId);
                        try {
                          await updateTaskBoard(p.boardId, { workspace_id: w.id });
                          await refreshWorkspaceBoards([p.fromWorkspaceId, w.id]);
                          moveBoardInOrg({
                            boardId: p.boardId,
                            fromWorkspaceId: p.fromWorkspaceId,
                            fromGroupId: p.fromGroupId || '',
                            toWorkspaceId: w.id,
                            toGroupId: ''
                          });
                          selectBoard(w.id, p.boardId);
                        } catch (_err) {
                          // ignore
                        } finally {
                          setMovingBoardId('');
                        }
                      } else {
                        moveBoardInOrg({
                          boardId: p.boardId,
                          fromWorkspaceId: p.fromWorkspaceId,
                          fromGroupId: p.fromGroupId || '',
                          toWorkspaceId: w.id,
                          toGroupId: ''
                        });
                      }
                    }}
                    sx={{
                      borderLeft: dropHighlight.type === 'workspace' && dropHighlight.id === w.id ? '2px solid' : '2px solid',
                      borderLeftColor: dropHighlight.type === 'workspace' && dropHighlight.id === w.id ? 'primary.main' : 'transparent',
                      pl: 0.5,
                      py: boards.length === 0 ? 0.75 : 0
                    }}
                  >
                    {boards.length === 0 && (
                      <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
                        No boards yet. Drag a board here to move it into this workspace.
                      </Typography>
                    )}
                      {/* Groups */}
                      {groups.map((g) => {
                        const collapsed = Boolean(g.collapsed);
                        const ids = g.board_ids || [];
                        return (
                          <Box
                            key={g.id}
                            onDragOver={(e) => {
                              e.preventDefault();
                              setDropHighlight({ type: 'group', id: g.id });
                            }}
                            onDragLeave={() => setDropHighlight((prev) => (prev.type === 'group' && prev.id === g.id ? { type: '', id: '' } : prev))}
                            onDrop={async (e) => {
                              e.preventDefault();
                              const p = readDragPayload(e);
                              setDropHighlight({ type: '', id: '' });
                              if (!p) return;
                              if (p.fromWorkspaceId && p.fromWorkspaceId !== w.id) {
                                setMovingBoardId(p.boardId);
                                try {
                                  await updateTaskBoard(p.boardId, { workspace_id: w.id });
                                  await refreshWorkspaceBoards([p.fromWorkspaceId, w.id]);
                                  moveBoardInOrg({
                                    boardId: p.boardId,
                                    fromWorkspaceId: p.fromWorkspaceId,
                                    fromGroupId: p.fromGroupId || '',
                                    toWorkspaceId: w.id,
                                    toGroupId: g.id
                                  });
                                  selectBoard(w.id, p.boardId);
                                } catch (_err) {
                                  // ignore
                                } finally {
                                  setMovingBoardId('');
                                }
                              } else {
                                moveBoardInOrg({
                                  boardId: p.boardId,
                                  fromWorkspaceId: p.fromWorkspaceId,
                                  fromGroupId: p.fromGroupId || '',
                                  toWorkspaceId: w.id,
                                  toGroupId: g.id
                                });
                              }
                            }}
                            sx={{
                              border: '1px solid',
                              borderColor: 'divider',
                              borderRadius: 1,
                              overflow: 'hidden'
                            }}
                          >
                            <Box
                              onClick={() => toggleGroupCollapsed(w.id, g.id)}
                              sx={{
                                px: 1,
                                py: 0.6,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.75,
                                cursor: 'pointer',
                                bgcolor: dropHighlight.type === 'group' && dropHighlight.id === g.id ? 'action.selected' : 'action.hover'
                              }}
                            >
                              {collapsed ? <ChevronRightIcon fontSize="small" /> : <ExpandMoreRoundedIcon fontSize="small" />}
                              <FolderIcon fontSize="small" />
                              <Tooltip title={g.name || 'Group'} placement="top" enterDelay={400}>
                                <Typography variant="body2" sx={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {g.name || 'Group'}
                                </Typography>
                              </Tooltip>
                              <Typography variant="caption" color="text.secondary">
                                {ids.length}
                    </Typography>
                            {canCreateBoard && (
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openCreateBoard(w.id, g.id);
                                }}
                                aria-label="create board in group"
                                title="Add board to group"
                              >
                                <AddIcon fontSize="small" />
                              </IconButton>
                            )}
                            </Box>

                            {!collapsed && (
                              <Stack spacing={0.25} sx={{ py: 0.25 }}>
                                {ids.map((bid) => {
                                  const b = boardById[bid];
                                  if (!b) return null;
                                  const isActive = b.id === boardIdFromUrl;
                                  const selected = selectedForGroup.has(b.id);
                                  const showFolderMode = selectionModeActive;
                                  const showHandle = showFolderMode || false;
                                  return (
                                    <Box
                                      key={b.id}
                                      sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 0.5,
                                        px: 0.5,
                                        '&:hover .dragHandle': showFolderMode
                                          ? {}
                                          : {
                                              opacity: 1,
                                              width: 26
                                            }
                                      }}
                                      onDragOver={(e) => {
                                        e.preventDefault();
                                        setDropHighlight({ type: 'board', id: b.id });
                                      }}
                                      onDragLeave={() =>
                                        setDropHighlight((prev) => (prev.type === 'board' && prev.id === b.id ? { type: '', id: '' } : prev))
                                      }
                                      onDrop={async (e) => {
                                        e.preventDefault();
                                        const p = readDragPayload(e);
                                        setDropHighlight({ type: '', id: '' });
                                        if (!p) return;
                                        if (p.fromWorkspaceId && p.fromWorkspaceId !== w.id) {
                                          setMovingBoardId(p.boardId);
                                          try {
                                            await updateTaskBoard(p.boardId, { workspace_id: w.id });
                                            await refreshWorkspaceBoards([p.fromWorkspaceId, w.id]);
                                            moveBoardInOrg({
                                              boardId: p.boardId,
                                              fromWorkspaceId: p.fromWorkspaceId,
                                              fromGroupId: p.fromGroupId || '',
                                              toWorkspaceId: w.id,
                                              toGroupId: g.id,
                                              beforeBoardId: b.id
                                            });
                                          } catch (_err) {
                                            // ignore
                                          } finally {
                                            setMovingBoardId('');
                                          }
                                        } else {
                                          moveBoardInOrg({
                                            boardId: p.boardId,
                                            fromWorkspaceId: p.fromWorkspaceId,
                                            fromGroupId: p.fromGroupId || '',
                                            toWorkspaceId: w.id,
                                            toGroupId: g.id,
                                            beforeBoardId: b.id
                                          });
                                        }
                                      }}
                                    >
                                      <Box
                                        className="dragHandle"
                                        draggable={!showFolderMode}
                                        onDragStart={(e) =>
                                          onDragStartBoard(e, { boardId: b.id, fromWorkspaceId: w.id, fromGroupId: g.id || '' })
                                        }
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (e.metaKey) toggleSelectForGroup(b.id);
                                        }}
                                        sx={{
                                          width: showFolderMode ? 26 : 0,
                                          height: 26,
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          borderRadius: 1,
                                          opacity: showFolderMode ? 1 : 0,
                                          color: selected ? 'primary.main' : 'text.secondary'
                                          ,
                                          overflow: 'hidden',
                                          transition: 'width 160ms ease, opacity 160ms ease'
                                        }}
                                        title={showFolderMode ? 'Select for group' : 'Drag to move'}
                                      >
                                        {showFolderMode ? (selected ? <FolderIcon fontSize="small" /> : <FolderOutlinedIcon fontSize="small" />) : <DragIndicatorIcon fontSize="small" />}
                                      </Box>

                                      <Tooltip title={b.name} placement="top" enterDelay={400}>
                                        <Button
                                          onClick={() => selectBoard(w.id, b.id)}
                                          variant={isActive ? 'contained' : 'text'}
                                          color={isActive ? 'primary' : 'inherit'}
                                          disabled={movingBoardId === b.id}
                                          sx={{
                                            justifyContent: 'flex-start',
                                            textTransform: 'none',
                                            px: 1.5,
                                            flex: 1,
                                            minWidth: 0,
                                            overflow: 'hidden'
                                          }}
                                        >
                                          <Box
                                            component="span"
                                            sx={{ display: 'block', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}
                                          >
                                            {b.name}
                                          </Box>
                                        </Button>
                                      </Tooltip>
                                      {canDelete && (
                                        <IconButton
                                          size="small"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setDeleteBoardInfo({ workspaceId: w.id, boardId: b.id });
                                          }}
                                          aria-label="delete board"
                                        >
                                          <DeleteOutlineIcon fontSize="small" />
                                        </IconButton>
                                      )}
                                    </Box>
                                  );
                                })}
                              </Stack>
                            )}
                          </Box>
                        );
                      })}

                      {/* Ungrouped */}
                      <Stack spacing={0.25}>
                        {ungrouped.map((bid) => {
                          const b = boardById[bid];
                          if (!b) return null;
                          const isActive = b.id === boardIdFromUrl;
                          const selected = selectedForGroup.has(b.id);
                          const showFolderMode = selectionModeActive;
                          return (
                            <Box
                              key={b.id}
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                                '&:hover .dragHandle': showFolderMode
                                  ? {}
                                  : {
                                      opacity: 1,
                                      width: 26
                                    }
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                setDropHighlight({ type: 'board', id: b.id });
                              }}
                              onDragLeave={() =>
                                setDropHighlight((prev) => (prev.type === 'board' && prev.id === b.id ? { type: '', id: '' } : prev))
                              }
                              onDrop={async (e) => {
                                e.preventDefault();
                                const p = readDragPayload(e);
                                setDropHighlight({ type: '', id: '' });
                                if (!p) return;
                                if (p.fromWorkspaceId && p.fromWorkspaceId !== w.id) {
                                  setMovingBoardId(p.boardId);
                                  try {
                                    await updateTaskBoard(p.boardId, { workspace_id: w.id });
                                    await refreshWorkspaceBoards([p.fromWorkspaceId, w.id]);
                                    moveBoardInOrg({
                                      boardId: p.boardId,
                                      fromWorkspaceId: p.fromWorkspaceId,
                                      fromGroupId: p.fromGroupId || '',
                                      toWorkspaceId: w.id,
                                      toGroupId: '',
                                      beforeBoardId: b.id
                                    });
                                  } catch (_err) {
                                    // ignore
                                  } finally {
                                    setMovingBoardId('');
                                  }
                                } else {
                                  moveBoardInOrg({
                                    boardId: p.boardId,
                                    fromWorkspaceId: p.fromWorkspaceId,
                                    fromGroupId: p.fromGroupId || '',
                                    toWorkspaceId: w.id,
                                    toGroupId: '',
                                    beforeBoardId: b.id
                                  });
                                }
                              }}
                            >
                              <Box
                                className="dragHandle"
                                draggable={!showFolderMode}
                                onDragStart={(e) => onDragStartBoard(e, { boardId: b.id, fromWorkspaceId: w.id, fromGroupId: '' })}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (e.metaKey) toggleSelectForGroup(b.id);
                                }}
                                sx={{
                                  width: showFolderMode ? 26 : 0,
                                  height: 26,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  borderRadius: 1,
                                  opacity: showFolderMode ? 1 : 0,
                                  color: selected ? 'primary.main' : 'text.secondary'
                                  ,
                                  overflow: 'hidden',
                                  transition: 'width 160ms ease, opacity 160ms ease'
                                }}
                                title={showFolderMode ? 'Select for group' : 'Drag to move'}
                              >
                                {showFolderMode ? (selected ? <FolderIcon fontSize="small" /> : <FolderOutlinedIcon fontSize="small" />) : <DragIndicatorIcon fontSize="small" />}
                              </Box>

                          <Tooltip title={b.name} placement="top" enterDelay={400}>
                            <Button
                              onClick={() => selectBoard(w.id, b.id)}
                              variant={isActive ? 'contained' : 'text'}
                              color={isActive ? 'primary' : 'inherit'}
                              disabled={movingBoardId === b.id}
                              sx={{ justifyContent: 'flex-start', textTransform: 'none', px: 2, flex: 1, minWidth: 0, overflow: 'hidden' }}
                            >
                              <Box
                                component="span"
                                sx={{ display: 'block', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}
                              >
                                {b.name}
                              </Box>
                            </Button>
                          </Tooltip>
                          {canDelete && (
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteBoardInfo({ workspaceId: w.id, boardId: b.id });
                              }}
                              aria-label="delete board"
                            >
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          )}
                            </Box>
                          );
                        })}
                        </Stack>
                    </Stack>
                </AccordionDetails>
              </Accordion>
            );
          })}
        </Stack>
      </Stack>

      <FormDialog
        open={groupDialogOpen}
        onClose={() => {
          setGroupDialogOpen(false);
          clearSelectForGroup();
        }}
        onSubmit={() => {
          const ids = Array.from(selectedForGroup);
          const wsIds = Array.from(new Set(ids.map((bid) => getBoardWorkspaceId(bid)).filter(Boolean)));
          if (wsIds.length !== 1) {
            toast.error('Select boards from a single workspace to create a group.');
            setGroupDialogOpen(false);
            clearSelectForGroup();
            return;
          }
          const wsId = wsIds[0];
          const ws = boardOrg?.workspaces?.[wsId];
          const order = [];
          for (const gid of ws?.group_order || []) {
            for (const bid of ws?.groups?.[gid]?.board_ids || []) order.push(bid);
          }
          for (const bid of ws?.ungrouped_order || []) order.push(bid);
          const orderedIds = ids.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
          createBoardGroupFromSelection(wsId, groupDialogName, orderedIds);
          setGroupDialogOpen(false);
          clearSelectForGroup();
        }}
        title="Create board group"
        submitLabel="Create"
        submitDisabled={!groupDialogName.trim() || selectedForGroup.size < 2}
      >
        <TextField
          autoFocus
          margin="dense"
          label="Group name"
          fullWidth
          value={groupDialogName}
          onChange={(e) => setGroupDialogName(e.target.value)}
        />
      </FormDialog>

      <FormDialog
        open={Boolean(creatingBoardFor)}
        onClose={() => {
          setCreatingBoardFor('');
          setCreatingBoardGroupId('');
        }}
        onSubmit={handleCreateBoard}
        title="Create board"
        submitLabel="Create"
        loading={creatingBoard}
        submitDisabled={!newBoardName.trim()}
      >
        <TextField
          autoFocus
          margin="dense"
          label="Board name"
          fullWidth
          value={newBoardName}
          onChange={(e) => setNewBoardName(e.target.value)}
        />
      </FormDialog>

      <FormDialog
        open={creatingWorkspaceOpen}
        onClose={() => setCreatingWorkspaceOpen(false)}
        onSubmit={handleCreateWorkspace}
        title="Create workspace"
        submitLabel="Create"
        loading={creatingWorkspace}
        submitDisabled={!newWorkspaceName.trim()}
      >
        <TextField
          autoFocus
          margin="dense"
          label="Workspace name"
          fullWidth
          value={newWorkspaceName}
          onChange={(e) => setNewWorkspaceName(e.target.value)}
        />
      </FormDialog>

      <ConfirmDialog
        open={Boolean(deleteWorkspaceId)}
        onClose={() => setDeleteWorkspaceId('')}
        onConfirm={handleDeleteWorkspace}
        title="Delete workspace?"
        message="This will permanently delete the workspace and all boards/groups/items inside it."
        confirmLabel="Delete"
        confirmColor="error"
        loading={deleting}
      />

      <ConfirmDialog
        open={Boolean(deleteBoardInfo?.boardId)}
        onClose={() => setDeleteBoardInfo({ workspaceId: '', boardId: '' })}
        onConfirm={handleDeleteBoard}
        title="Delete board?"
        message="This will permanently delete the board and all groups/items inside it."
        confirmLabel="Delete"
        confirmColor="error"
        loading={deleting}
      />
    </Box>
  );
}
