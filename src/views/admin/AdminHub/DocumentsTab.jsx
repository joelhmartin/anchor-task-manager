import React, { useCallback, useEffect, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import client from 'api/client';
import LoadingButton from 'ui-component/extended/LoadingButton';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';

export default function DocumentsTab({ clientId }) {
  const toast = useToast();
  const fileInputRef = useRef(null);

  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docUpload, setDocUpload] = useState({ label: '', forReview: false, files: [] });
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [regeneratingPdf, setRegeneratingPdf] = useState(false);

  const reportError = useCallback(
    (err, fallback) => {
      const msg = getErrorMessage(err, fallback);
      toast.error(msg);
    },
    [toast]
  );

  const refreshDocs = useCallback(
    async (userId) => {
      if (!userId) return;
      setDocsLoading(true);
      try {
        const docsResp = await client.get(`/hub/docs/admin/${userId}`).then((res) => res.data.docs || []);
        setDocs(docsResp);
      } catch (err) {
        reportError(err, 'Unable to load documents');
      } finally {
        setDocsLoading(false);
      }
    },
    [reportError]
  );

  useEffect(() => {
    if (!clientId) return;
    refreshDocs(clientId);
    setDocUpload({ label: '', forReview: false, files: [] });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [clientId, refreshDocs]);

  const handleRegenerateOnboardingPdf = async () => {
    if (!clientId) return;
    setRegeneratingPdf(true);
    try {
      await client.post(`/hub/clients/${clientId}/regenerate-onboarding-pdf`);
      await refreshDocs(clientId);
      toast.success('Onboarding document regenerated');
    } catch (err) {
      reportError(err, 'Unable to regenerate onboarding document');
    } finally {
      setRegeneratingPdf(false);
    }
  };

  const handleDocUpload = async () => {
    if (!clientId || !docUpload.files.length) return;
    setUploadingDocs(true);
    try {
      const formData = new FormData();
      formData.append('user_id', clientId);
      if (docUpload.label) formData.append('doc_label', docUpload.label);
      formData.append('for_review', docUpload.forReview ? 'true' : 'false');
      docUpload.files.forEach((file) => formData.append('client_doc', file));
      await client.post('/hub/docs/admin/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      await refreshDocs(clientId);
      setDocUpload({ label: '', forReview: false, files: [] });
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast.success('Document uploaded');
    } catch (err) {
      toast.error(err.message || 'Unable to upload document');
    } finally {
      setUploadingDocs(false);
    }
  };

  const handleDocDelete = async (docId) => {
    if (!clientId) return;
    try {
      await client.delete(`/hub/docs/admin/${docId}`, { data: { user_id: clientId } });
      await refreshDocs(clientId);
      toast.success('Document deleted');
    } catch (err) {
      toast.error(err.message || 'Unable to delete document');
    }
  };

  const updateReview = async (docId, action) => {
    if (!clientId) return;
    try {
      await client.post('/hub/docs/admin/review', { user_id: clientId, doc_id: docId, review_action: action });
      await refreshDocs(clientId);
    } catch (err) {
      reportError(err, 'Unable to update review status');
    }
  };

  return (
    <Stack spacing={2} sx={{ mt: 2 }}>
      <Typography variant="subtitle1">Upload Documents</Typography>
      <Stack spacing={2}>
        <TextField
          label="Document Label"
          value={docUpload.label}
          onChange={(e) => setDocUpload((p) => ({ ...p, label: e.target.value }))}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="center">
          <Button variant="outlined" component="label">
            Select Files
            <input
              ref={fileInputRef}
              type="file"
              accept="*/*"
              multiple
              hidden
              onChange={(e) => setDocUpload((p) => ({ ...p, files: Array.from(e.target.files || []) }))}
            />
          </Button>
          {docUpload.files.length ? (
            <Stack spacing={0.5} sx={{ width: '100%' }}>
              {docUpload.files.map((file) => (
                <Typography variant="body2" key={file.name}>
                  {file.name}
                </Typography>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No files selected
            </Typography>
          )}
        </Stack>
        <FormControlLabel
          control={
            <Checkbox checked={docUpload.forReview} onChange={(e) => setDocUpload((p) => ({ ...p, forReview: e.target.checked }))} />
          }
          label='Mark as "For Review" and notify client'
        />
        <Button variant="contained" disableElevation onClick={handleDocUpload} disabled={!docUpload.files.length || uploadingDocs}>
          {uploadingDocs ? 'Uploading…' : 'Upload Document'}
        </Button>
      </Stack>
      <Divider />
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
        <Typography variant="subtitle1">Documents</Typography>
        <LoadingButton
          size="small"
          variant="outlined"
          loading={regeneratingPdf}
          loadingLabel="Generating…"
          onClick={handleRegenerateOnboardingPdf}
        >
          {docs.some((d) => d.type === 'onboarding') ? 'Regenerate' : 'Generate'} Onboarding Document
        </LoadingButton>
      </Stack>
      {docsLoading && <CircularProgress size={20} />}{' '}
      {docs.length ? (
        <Stack spacing={1}>
          {docs.map((doc) => (
            <Box
              key={doc.id}
              sx={{
                p: 1,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <Box sx={{ flex: 1, pr: 2 }}>
                <Typography>{doc.label || doc.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {doc.origin === 'admin' ? 'Admin upload' : 'Client upload'}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="flex-end">
                <Button size="small" href={doc.url} target="_blank" rel="noreferrer">
                  View
                </Button>
                {doc.review_status === 'pending' ? (
                  <Button size="small" variant="outlined" onClick={() => updateReview(doc.id, 'clear')}>
                    Clear Review
                  </Button>
                ) : (
                  <Button size="small" variant="contained" onClick={() => updateReview(doc.id, 'pending')}>
                    Mark For Review
                  </Button>
                )}
                {doc.type !== 'default' && (
                  <Button size="small" color="error" onClick={() => handleDocDelete(doc.id)}>
                    Delete
                  </Button>
                )}
              </Stack>
            </Box>
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No documents yet.
        </Typography>
      )}
    </Stack>
  );
}
