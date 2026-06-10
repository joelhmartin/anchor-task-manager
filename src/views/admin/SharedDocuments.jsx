import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import FormDialog from 'ui-component/extended/FormDialog';
import { useToast } from 'contexts/ToastContext';
import {
Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Stack,
  TextField,
  Tooltip,
  Typography,
  Button,
} from '@mui/material';
import EmptyState from 'ui-component/extended/EmptyState';
import LoadingButton from 'ui-component/extended/LoadingButton';
import {
  IconUpload,
  IconTrash,
  IconPencil,
  IconGripVertical,
  IconExternalLink,
  IconPlus
} from '@tabler/icons-react';
import MainCard from 'ui-component/cards/MainCard';
import {
  fetchSharedDocumentsAdmin,
  uploadSharedDocuments,
  updateSharedDocument,
  deleteSharedDocument,
  reorderSharedDocuments
} from 'api/documents';

export default function SharedDocuments() {
  const { showToast } = useToast();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Upload dialog state
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadLabels, setUploadLabels] = useState([]);
  const [uploadDescriptions, setUploadDescriptions] = useState([]);
  const [uploading, setUploading] = useState(false);

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editDoc, setEditDoc] = useState(null);
  const [editForm, setEditForm] = useState({ label: '', description: '' });
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [docToDelete, setDocToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const docs = await fetchSharedDocumentsAdmin();
      setDocuments(docs);
    } catch (err) {
      setError(err.message || 'Failed to load shared documents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Upload handlers
  const handleOpenUpload = () => {
    setUploadFiles([]);
    setUploadLabels([]);
    setUploadDescriptions([]);
    setUploadDialogOpen(true);
  };

  const handleFilesChange = (e) => {
    const files = Array.from(e.target.files || []);
    setUploadFiles(files);
    setUploadLabels(files.map((f) => f.name.replace(/\.[^/.]+$/, '')));
    setUploadDescriptions(files.map(() => ''));
  };

  const handleUpload = async () => {
    if (!uploadFiles.length) return;
    setUploading(true);
    try {
      const newDocs = await uploadSharedDocuments(uploadFiles, uploadLabels, uploadDescriptions);
      setDocuments((prev) => [...newDocs, ...prev]);
      setUploadDialogOpen(false);
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // Edit handlers
  const handleOpenEdit = (doc) => {
    setEditDoc(doc);
    setEditForm({ label: doc.label || '', description: doc.description || '' });
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editDoc) return;
    setSaving(true);
    try {
      const updated = await updateSharedDocument(editDoc.id, editForm);
      setDocuments((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));
      setEditDialogOpen(false);
    } catch (err) {
      setError(err.message || 'Failed to update document');
    } finally {
      setSaving(false);
    }
  };

  // Delete handlers
  const handleOpenDelete = (doc) => {
    setDocToDelete(doc);
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!docToDelete) return;
    setDeleting(true);
    try {
      await deleteSharedDocument(docToDelete.id);
      setDocuments((prev) => prev.filter((d) => d.id !== docToDelete.id));
      setDeleteConfirmOpen(false);
      setDocToDelete(null);
    } catch (err) {
      setError(err.message || 'Failed to delete document');
    } finally {
      setDeleting(false);
    }
  };

  // Drag & drop reorder (simple swap implementation)
  const [dragIndex, setDragIndex] = useState(null);

  const handleDragStart = (index) => {
    setDragIndex(index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    const reordered = [...documents];
    const [removed] = reordered.splice(dragIndex, 1);
    reordered.splice(index, 0, removed);
    setDocuments(reordered);
    setDragIndex(index);
  };

  const handleDragEnd = async () => {
    setDragIndex(null);
    // Persist the new order
    const order = documents.map((doc, i) => ({ id: doc.id, sort_order: i }));
    try {
      await reorderSharedDocuments(order);
    } catch (err) {
      console.error('Reorder failed:', err);
      showToast('Failed to save new order', 'error');
      // Reload to get actual order
      loadDocuments();
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <MainCard title="Shared Documents">
      <Stack spacing={3}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="body2" color="text.secondary">
            Upload documents here to share them with <strong>all</strong> client accounts. Clients will see these under
            &quot;Helpful Documents&quot; in their Documents tab.
          </Typography>
          <Button variant="contained" startIcon={<IconPlus size={18} />} onClick={handleOpenUpload}>
            Upload Document
          </Button>
        </Stack>

        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {loading && <LinearProgress />}

        {!loading && documents.length === 0 && (
          <EmptyState title="No shared documents yet." message="Click &quot;Upload Document&quot; to add one." />
        )}

        <Stack spacing={1}>
          {documents.map((doc, index) => (
            <Card
              key={doc.id}
              variant="outlined"
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              sx={{
                cursor: 'grab',
                opacity: dragIndex === index ? 0.5 : 1,
                '&:hover': { bgcolor: 'action.hover' }
              }}
            >
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Tooltip title="Drag to reorder">
                    <Box sx={{ color: 'text.secondary', cursor: 'grab' }}>
                      <IconGripVertical size={20} />
                    </Box>
                  </Tooltip>

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle1" noWrap>
                      {doc.label || doc.name}
                    </Typography>
                    {doc.description && (
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {doc.description}
                      </Typography>
                    )}
                    <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                      <Chip label={doc.name} size="small" variant="outlined" />
                      <Chip label={`Added ${formatDate(doc.created_at)}`} size="small" variant="outlined" />
                      {doc.creator_first_name && (
                        <Chip
                          label={`By ${doc.creator_first_name} ${doc.creator_last_name || ''}`.trim()}
                          size="small"
                          variant="outlined"
                        />
                      )}
                    </Stack>
                  </Box>

                  <Stack direction="row" spacing={1}>
                    <Tooltip title="View document">
                      <IconButton href={doc.url} target="_blank" rel="noopener noreferrer" color="primary">
                        <IconExternalLink size={18} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit details">
                      <IconButton onClick={() => handleOpenEdit(doc)} color="info">
                        <IconPencil size={18} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton onClick={() => handleOpenDelete(doc)} color="error">
                        <IconTrash size={18} />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      </Stack>

      {/* Upload Dialog */}
      <Dialog open={uploadDialogOpen} onClose={() => setUploadDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Upload Shared Document</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Button variant="outlined" component="label" startIcon={<IconUpload size={18} />}>
              Select Files
              <input type="file" hidden multiple onChange={handleFilesChange} />
            </Button>

            {uploadFiles.map((file, i) => (
              <Card key={i} variant="outlined">
                <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                  <Stack spacing={1}>
                    <Typography variant="body2" color="text.secondary">
                      {file.name}
                    </Typography>
                    <TextField
                      label="Display Label"
                      size="small"
                      fullWidth
                      value={uploadLabels[i] || ''}
                      onChange={(e) => {
                        const newLabels = [...uploadLabels];
                        newLabels[i] = e.target.value;
                        setUploadLabels(newLabels);
                      }}
                    />
                    <TextField
                      label="Description (optional)"
                      size="small"
                      fullWidth
                      multiline
                      minRows={2}
                      value={uploadDescriptions[i] || ''}
                      onChange={(e) => {
                        const newDescs = [...uploadDescriptions];
                        newDescs[i] = e.target.value;
                        setUploadDescriptions(newDescs);
                      }}
                    />
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUploadDialogOpen(false)}>Cancel</Button>
          <LoadingButton variant="contained" onClick={handleUpload} loading={uploading} disabled={!uploadFiles.length} loadingLabel="Uploading...">
            Upload
          </LoadingButton>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <FormDialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        onSubmit={handleSaveEdit}
        title="Edit Document"
        loading={saving}
        loadingLabel="Saving..."
      >
        <TextField
          label="Display Label"
          fullWidth
          value={editForm.label}
          onChange={(e) => setEditForm((prev) => ({ ...prev, label: e.target.value }))}
        />
        <TextField
          label="Description (optional)"
          fullWidth
          multiline
          minRows={3}
          value={editForm.description}
          onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
        />
      </FormDialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleConfirmDelete}
        title="Delete Document?"
        message={`Are you sure you want to delete "${docToDelete?.label || docToDelete?.name}"? This will remove it from all client accounts.`}
        confirmLabel="Delete"
        confirmColor="error"
        loading={deleting}
        loadingLabel="Deleting..."
      />
    </MainCard>
  );
}

