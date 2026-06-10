import { useEffect, useState } from 'react';

import ConfirmDialog from 'ui-component/extended/ConfirmDialog';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Paper from '@mui/material/Paper';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import AddIcon from '@mui/icons-material/Add';
import CancelIcon from '@mui/icons-material/Cancel';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import ImageIcon from '@mui/icons-material/Image';
import FolderIcon from '@mui/icons-material/Folder';
import BusinessIcon from '@mui/icons-material/Business';
import StoreIcon from '@mui/icons-material/Store';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import HomeIcon from '@mui/icons-material/Home';
import BuildIcon from '@mui/icons-material/Build';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import SchoolIcon from '@mui/icons-material/School';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import SpaIcon from '@mui/icons-material/Spa';
import PetsIcon from '@mui/icons-material/Pets';
import LocalFloristIcon from '@mui/icons-material/LocalFlorist';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import GavelIcon from '@mui/icons-material/Gavel';

import { createClientGroup, updateClientGroup, deleteClientGroup, uploadGroupIcon, deleteGroupIcon } from 'api/clientGroups';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import ClientGroupAccessPanel from './ClientGroupAccessPanel';

// Available icons for client groups
export const GROUP_ICON_OPTIONS = [
  { value: 'Folder', label: 'Folder', Icon: FolderIcon },
  { value: 'Business', label: 'Business', Icon: BusinessIcon },
  { value: 'Store', label: 'Store', Icon: StoreIcon },
  { value: 'LocalHospital', label: 'Medical', Icon: LocalHospitalIcon },
  { value: 'Restaurant', label: 'Restaurant', Icon: RestaurantIcon },
  { value: 'Home', label: 'Home Services', Icon: HomeIcon },
  { value: 'Build', label: 'Construction', Icon: BuildIcon },
  { value: 'DirectionsCar', label: 'Automotive', Icon: DirectionsCarIcon },
  { value: 'School', label: 'Education', Icon: SchoolIcon },
  { value: 'FitnessCenter', label: 'Fitness', Icon: FitnessCenterIcon },
  { value: 'Spa', label: 'Spa/Wellness', Icon: SpaIcon },
  { value: 'Pets', label: 'Pets', Icon: PetsIcon },
  { value: 'LocalFlorist', label: 'Florist', Icon: LocalFloristIcon },
  { value: 'AccountBalance', label: 'Finance', Icon: AccountBalanceIcon },
  { value: 'Gavel', label: 'Legal', Icon: GavelIcon }
];

// Helper to get icon component by name
export const getGroupIcon = (iconName) => {
  const found = GROUP_ICON_OPTIONS.find((opt) => opt.value === iconName);
  return found?.Icon || null;
};

/**
 * ClientGroupsManager — Dialog for creating, editing, and deleting client groups.
 *
 * Props:
 *  - open (bool)             — whether the dialog is visible
 *  - onClose ()              — close callback (parent resets groupDialogOpen)
 *  - clientGroups (array)    — current list of groups (for the list view inside the dialog)
 *  - onGroupsChange (savedGroup, action) — called after a group is saved or deleted
 *      action: 'created' | 'updated' | 'deleted'
 *      savedGroup: the group object returned from the API (or { id } for delete)
 *  - bulkGroupClientIds (array|null) — if set, we're creating a group for bulk assignment
 *  - onBulkGroupComplete (savedGroup, clientIds) — called after creating a group for bulk assignment
 */
export default function ClientGroupsManager({ open, onClose, clientGroups, onGroupsChange, bulkGroupClientIds, onBulkGroupComplete }) {
  const toast = useToast();

  // Dialog-local state
  const [editingGroup, setEditingGroup] = useState(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const [iconUploadFile, setIconUploadFile] = useState(null);
  const [iconUploadPreview, setIconUploadPreview] = useState(null);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState({ open: false, groupId: null, groupName: '' });

  // When opened for bulk assignment, auto-start with a blank edit form
  useEffect(() => {
    if (open && bulkGroupClientIds?.length && !editingGroup) {
      setEditingGroup({ name: '', description: '', color: '' });
    }
  }, [open, bulkGroupClientIds]);

  const handleClose = () => {
    setEditingGroup(null);
    setIconUploadFile(null);
    setIconUploadPreview(null);
    onClose();
  };

  const handleSaveGroup = async () => {
    if (!editingGroup?.name?.trim()) {
      toast.error('Group name is required');
      return;
    }
    setSavingGroup(true);
    try {
      let savedGroup;
      if (editingGroup.id) {
        const { group } = await updateClientGroup(editingGroup.id, {
          name: editingGroup.name.trim(),
          description: editingGroup.description || '',
          color: editingGroup.color || null,
          icon: editingGroup.icon || null
        });
        savedGroup = group;
      } else {
        const { group } = await createClientGroup({
          name: editingGroup.name.trim(),
          description: editingGroup.description || '',
          color: editingGroup.color || null,
          icon: editingGroup.icon || null
        });
        savedGroup = group;
      }

      // Upload custom icon if one was selected
      if (iconUploadFile && savedGroup.id) {
        try {
          const { group: updatedGroup } = await uploadGroupIcon(savedGroup.id, iconUploadFile);
          savedGroup = updatedGroup;
        } catch {
          toast.error('Group saved but icon upload failed');
        }
      }

      if (editingGroup.id) {
        onGroupsChange(savedGroup, 'updated');
        toast.success('Group updated');
      } else {
        onGroupsChange(savedGroup, 'created');

        // If we have clients to assign to this new group (from bulk action)
        if (bulkGroupClientIds?.length) {
          onBulkGroupComplete(savedGroup, bulkGroupClientIds);
        } else {
          toast.success('Group created');
        }
      }

      // Clear icon upload state
      setIconUploadFile(null);
      setIconUploadPreview(null);
      setEditingGroup(null);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save group');
    } finally {
      setSavingGroup(false);
    }
  };

  const handleDeleteGroupClick = (group) => {
    setDeleteGroupConfirm({ open: true, groupId: group.id, groupName: group.name });
  };

  const handleDeleteGroupConfirm = async () => {
    const { groupId } = deleteGroupConfirm;
    if (!groupId) return;
    try {
      await deleteClientGroup(groupId);
      onGroupsChange({ id: groupId }, 'deleted');
      setDeleteGroupConfirm({ open: false, groupId: null, groupName: '' });
      toast.success('Group deleted');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete group');
    }
  };

  return (
    <>
      {/* Client Group Management Dialog */}
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>
          {bulkGroupClientIds?.length
            ? `Create Group for ${bulkGroupClientIds.length} Selected Client(s)`
            : editingGroup?.id
              ? 'Edit Group'
              : editingGroup
                ? 'Create New Group'
                : 'Manage Client Groups'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {editingGroup ? (
              <Stack spacing={2}>
                {bulkGroupClientIds?.length > 0 && (
                  <Alert severity="info" sx={{ mb: 1 }}>
                    {bulkGroupClientIds.length} client(s) will be moved to this group after creation.
                  </Alert>
                )}
                <TextField
                  label="Group Name"
                  value={editingGroup.name || ''}
                  onChange={(e) => setEditingGroup((prev) => ({ ...prev, name: e.target.value }))}
                  fullWidth
                  autoFocus
                />
                <TextField
                  label="Description (optional)"
                  value={editingGroup.description || ''}
                  onChange={(e) => setEditingGroup((prev) => ({ ...prev, description: e.target.value }))}
                  fullWidth
                  multiline
                  rows={2}
                />
                <TextField
                  label="Color"
                  value={editingGroup.color || ''}
                  onChange={(e) => setEditingGroup((prev) => ({ ...prev, color: e.target.value }))}
                  fullWidth
                  placeholder="#3b82f6"
                  helperText="Hex color code (used if no icon selected)"
                  InputProps={{
                    startAdornment: editingGroup.color && (
                      <InputAdornment position="start">
                        <Box sx={{ width: 20, height: 20, borderRadius: '50%', bgcolor: editingGroup.color, border: '1px solid', borderColor: 'divider' }} />
                      </InputAdornment>
                    )
                  }}
                />
                <Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Icon (optional)
                  </Typography>

                  {/* Custom Image Upload Section */}
                  <Box sx={{ mb: 2, p: 1.5, border: '1px dashed', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.default' }}>
                    <Stack direction="row" spacing={2} alignItems="center">
                      {/* Preview area */}
                      <Box
                        sx={{
                          width: 48,
                          height: 48,
                          borderRadius: 1,
                          border: '1px solid',
                          borderColor: 'divider',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          overflow: 'hidden',
                          bgcolor: 'background.paper',
                          flexShrink: 0
                        }}
                      >
                        {iconUploadPreview ? (
                          <img src={iconUploadPreview} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : editingGroup.icon_url ? (
                          <img src={editingGroup.icon_url} alt="Current icon" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <ImageIcon sx={{ color: 'action.disabled' }} />
                        )}
                      </Box>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" fontWeight={500} gutterBottom>
                          Custom Image
                        </Typography>
                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                          Upload your own icon (PNG, JPG, SVG)
                        </Typography>
                        <Stack direction="row" spacing={1}>
                          <Button
                            component="label"
                            size="small"
                            variant="outlined"
                            startIcon={<CloudUploadIcon />}
                            disabled={uploadingIcon}
                          >
                            {uploadingIcon ? 'Uploading\u2026' : 'Upload'}
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                              hidden
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  if (file.size > 2 * 1024 * 1024) {
                                    toast.error('Image must be less than 2MB');
                                    e.target.value = '';
                                    return;
                                  }
                                  setIconUploadFile(file);
                                  const reader = new FileReader();
                                  reader.onload = () => setIconUploadPreview(reader.result);
                                  reader.readAsDataURL(file);
                                  setEditingGroup((prev) => ({ ...prev, icon: '' }));
                                }
                                e.target.value = '';
                              }}
                            />
                          </Button>
                          {(iconUploadPreview || editingGroup.icon_url) && (
                            <Button
                              size="small"
                              color="error"
                              onClick={async () => {
                                if (iconUploadPreview) {
                                  setIconUploadFile(null);
                                  setIconUploadPreview(null);
                                } else if (editingGroup.icon_url && editingGroup.id) {
                                  setUploadingIcon(true);
                                  try {
                                    const { group } = await deleteGroupIcon(editingGroup.id);
                                    setEditingGroup(group);
                                    onGroupsChange(group, 'updated');
                                    toast.success('Custom icon removed');
                                  } catch (err) {
                                    toast.error(getErrorMessage(err));
                                  } finally {
                                    setUploadingIcon(false);
                                  }
                                }
                              }}
                            >
                              Remove
                            </Button>
                          )}
                        </Stack>
                      </Box>
                    </Stack>
                  </Box>

                  {/* Preset Icons */}
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                    Or choose a preset icon:
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    <Tooltip title="No icon (use color)">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setEditingGroup((prev) => ({ ...prev, icon: '' }));
                          setIconUploadFile(null);
                          setIconUploadPreview(null);
                        }}
                        sx={{
                          border: '2px solid',
                          borderColor: !editingGroup.icon && !iconUploadPreview && !editingGroup.icon_url ? 'primary.main' : 'divider',
                          bgcolor: !editingGroup.icon && !iconUploadPreview && !editingGroup.icon_url ? 'primary.50' : 'transparent'
                        }}
                      >
                        <CancelIcon fontSize="small" color={!editingGroup.icon && !iconUploadPreview && !editingGroup.icon_url ? 'primary' : 'disabled'} />
                      </IconButton>
                    </Tooltip>
                    {GROUP_ICON_OPTIONS.map((opt) => {
                      const IconComp = opt.Icon;
                      const isSelected = editingGroup.icon === opt.value && !iconUploadPreview && !editingGroup.icon_url;
                      return (
                        <Tooltip key={opt.value} title={opt.label}>
                          <IconButton
                            size="small"
                            onClick={() => {
                              setEditingGroup((prev) => ({ ...prev, icon: opt.value, icon_url: null }));
                              setIconUploadFile(null);
                              setIconUploadPreview(null);
                            }}
                            sx={{
                              border: '2px solid',
                              borderColor: isSelected ? 'primary.main' : 'divider',
                              bgcolor: isSelected ? 'primary.50' : 'transparent'
                            }}
                          >
                            <IconComp fontSize="small" color={isSelected ? 'primary' : 'action'} />
                          </IconButton>
                        </Tooltip>
                      );
                    })}
                  </Box>
                </Box>
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Button onClick={() => setEditingGroup(null)}>Cancel</Button>
                  <Button variant="contained" onClick={handleSaveGroup} disabled={savingGroup}>
                    {savingGroup ? 'Saving\u2026' : editingGroup.id ? 'Update' : 'Create'}
                  </Button>
                </Stack>
                {editingGroup.id && (
                  <>
                    <Divider />
                    <ClientGroupAccessPanel groupId={editingGroup.id} />
                  </>
                )}
              </Stack>
            ) : (
              <>
                <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={() => setEditingGroup({ name: '', description: '', color: '' })}
                  fullWidth
                >
                  New Group
                </Button>
                {clientGroups.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                    No groups created yet.
                  </Typography>
                ) : (
                  <Stack spacing={1}>
                    {clientGroups.map((g) => {
                      const GroupIcon = g.icon ? getGroupIcon(g.icon) : null;
                      return (
                        <Paper key={g.id} variant="outlined" sx={{ p: 1.5 }}>
                          <Stack direction="row" alignItems="center" spacing={1.5}>
                            {g.icon_url ? (
                              <Box component="img" src={g.icon_url} alt="" sx={{ width: 20, height: 20, borderRadius: 0.5, objectFit: 'cover', flexShrink: 0 }} />
                            ) : GroupIcon ? (
                              <GroupIcon fontSize="small" sx={{ color: g.color || 'action.active' }} />
                            ) : g.color ? (
                              <Box sx={{ width: 16, height: 16, borderRadius: '50%', bgcolor: g.color, flexShrink: 0 }} />
                            ) : (
                              <FolderIcon fontSize="small" sx={{ color: 'action.disabled' }} />
                            )}
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="subtitle2" noWrap>{g.name}</Typography>
                              {g.description && (
                                <Typography variant="caption" color="text.secondary" noWrap>
                                  {g.description}
                                </Typography>
                              )}
                            </Box>
                            <Stack direction="row" spacing={0.5}>
                              <IconButton size="small" onClick={() => { setEditingGroup(g); setIconUploadFile(null); setIconUploadPreview(null); }}>
                                <EditIcon fontSize="small" />
                              </IconButton>
                              <IconButton size="small" color="error" onClick={() => handleDeleteGroupClick(g)}>
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            </Stack>
                          </Stack>
                        </Paper>
                      );
                    })}
                  </Stack>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Client Group Confirmation */}
      <ConfirmDialog
        open={deleteGroupConfirm.open}
        onClose={() => setDeleteGroupConfirm({ open: false, groupId: null, groupName: '' })}
        onConfirm={handleDeleteGroupConfirm}
        title="Delete Group"
        message={<Typography>Delete <strong>{deleteGroupConfirm.groupName}</strong>?</Typography>}
        secondaryText="Clients in this group will become ungrouped."
        confirmLabel="Delete"
        confirmColor="error"
      />
    </>
  );
}
