import { useState, useCallback } from 'react';
import {
  initBoardStatusLabels, createBoardStatusLabel, createGlobalStatusLabel,
  updateStatusLabel, deleteStatusLabel
} from 'api/tasks';
import { useToast } from 'contexts/ToastContext';
import { DEFAULT_LABEL_COLOR } from 'constants/taskDefaults';

export default function useStatusLabels(activeBoardId, updateStatusLabelsInView) {
  const toast = useToast();
  const [statusLabelsDialogOpen, setStatusLabelsDialogOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState(null);
  const [newLabelText, setNewLabelText] = useState('');
  const [newLabelColor, setNewLabelColor] = useState(DEFAULT_LABEL_COLOR);
  const [savingLabel, setSavingLabel] = useState(false);
  const [deleteLabelConfirmOpen, setDeleteLabelConfirmOpen] = useState(false);
  const [labelToDelete, setLabelToDelete] = useState(null);

  const handleInitializeLabels = useCallback(async () => {
    if (!activeBoardId) return;
    setSavingLabel(true);
    try {
      const labels = await initBoardStatusLabels(activeBoardId);
      updateStatusLabelsInView(() => labels);
      toast.success('Status labels initialized');
    } catch (err) {
      toast.error(err.message || 'Unable to initialize status labels');
    }
    setSavingLabel(false);
  }, [activeBoardId, updateStatusLabelsInView, toast]);

  const handleAddLabel = useCallback(async () => {
    if (!activeBoardId || !newLabelText.trim()) return;
    setSavingLabel(true);
    try {
      const label = await createBoardStatusLabel(activeBoardId, {
        label: newLabelText.trim(),
        color: newLabelColor
      });
      updateStatusLabelsInView((prev) => [...(prev || []), label]);
      setNewLabelText('');
      setNewLabelColor(DEFAULT_LABEL_COLOR);
      toast.success('Status label added');
    } catch (err) {
      toast.error(err.message || 'Unable to add status label');
    }
    setSavingLabel(false);
  }, [activeBoardId, newLabelText, newLabelColor, updateStatusLabelsInView, toast]);

  const handleCreateLabelFromBoardTable = useCallback(async ({ label, color, makeGlobal }) => {
    if (!activeBoardId || !label?.trim()) return null;
    try {
      const created = makeGlobal
        ? await createGlobalStatusLabel({ label: label.trim(), color })
        : await createBoardStatusLabel(activeBoardId, { label: label.trim(), color });
      updateStatusLabelsInView((prev) => [...(prev || []), created]);
      toast.success(makeGlobal ? 'Global status label created' : 'Status label created');
      return created;
    } catch (err) {
      toast.error(err.message || 'Unable to create status label');
      return null;
    }
  }, [activeBoardId, updateStatusLabelsInView, toast]);

  const handleUpdateLabel = useCallback(async (labelId, updates) => {
    setSavingLabel(true);
    try {
      const updated = await updateStatusLabel(labelId, updates);
      updateStatusLabelsInView((prev) => (prev || []).map((l) => (l.id === labelId ? updated : l)));
      setEditingLabel(null);
      toast.success('Status label updated');
    } catch (err) {
      toast.error(err.message || 'Unable to update status label');
    }
    setSavingLabel(false);
  }, [updateStatusLabelsInView, toast]);

  const handleDeleteLabelClick = useCallback((label) => {
    setLabelToDelete(label);
    setDeleteLabelConfirmOpen(true);
  }, []);

  const handleDeleteLabelConfirm = useCallback(async () => {
    if (!labelToDelete) return;
    setSavingLabel(true);
    try {
      await deleteStatusLabel(labelToDelete.id);
      updateStatusLabelsInView((prev) => (prev || []).filter((l) => l.id !== labelToDelete.id));
      setDeleteLabelConfirmOpen(false);
      setLabelToDelete(null);
      toast.success('Status label deleted');
    } catch (err) {
      toast.error(err.message || 'Unable to delete status label');
    }
    setSavingLabel(false);
  }, [labelToDelete, updateStatusLabelsInView, toast]);

  return {
    statusLabelsDialogOpen, setStatusLabelsDialogOpen,
    editingLabel, setEditingLabel, newLabelText, setNewLabelText, newLabelColor, setNewLabelColor, savingLabel,
    deleteLabelConfirmOpen, setDeleteLabelConfirmOpen, labelToDelete, setLabelToDelete,
    handleInitializeLabels, handleAddLabel, handleCreateLabelFromBoardTable,
    handleUpdateLabel, handleDeleteLabelClick, handleDeleteLabelConfirm
  };
}
