/**
 * EmbedPane — Generate and copy embed code for published forms.
 */

import { useState, useEffect } from 'react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  MenuItem,
  Paper,
  Stack,
  Typography
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

import SelectField from 'ui-component/extended/SelectField';
import { useToast } from 'contexts/ToastContext';
import { generateEmbedCode } from 'api/forms';
import { getAppConfig } from 'api/ctmForms';

export default function EmbedPane({ forms, initialFormId }) {
  const { showToast } = useToast();
  const publishedForms = forms.filter((f) => f.status === 'published');
  const [selectedFormId, setSelectedFormId] = useState(initialFormId || '');
  const [appBaseUrl, setAppBaseUrl] = useState('');

  useEffect(() => {
    getAppConfig().then(cfg => setAppBaseUrl(cfg.appBaseUrl)).catch(() => {});
  }, []);

  const selectedForm = publishedForms.find((f) => f.id === selectedFormId);
  const embedCode = selectedForm ? generateEmbedCode(selectedForm, appBaseUrl || undefined) : '';

  const copyToClipboard = () => {
    navigator.clipboard.writeText(embedCode);
    showToast('Embed code copied to clipboard', 'success');
  };

  return (
    <Stack spacing={3}>
      <Typography variant="h5">Embed Code</Typography>
      <Typography variant="body2" color="text.secondary">
        Copy the embed code below and paste it into any webpage to display the form.
      </Typography>

      <SelectField label="Published Form" value={selectedFormId} onChange={(e) => setSelectedFormId(e.target.value)} fullWidth={false} sx={{ maxWidth: 400 }}>
        <MenuItem value="">— Select a form —</MenuItem>
        {publishedForms.map((f) => (
          <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>
        ))}
      </SelectField>

      {publishedForms.length === 0 ? (
        <Alert severity="info">No published forms. Publish a form in the Builder first.</Alert>
      ) : !selectedFormId ? (
        <Alert severity="info">Select a published form to view its embed code.</Alert>
      ) : (
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle2">Embed Snippet</Typography>
              <Button size="small" startIcon={<ContentCopyIcon />} onClick={copyToClipboard}>
                Copy
              </Button>
            </Stack>
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                bgcolor: 'grey.50',
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all'
              }}
            >
              {embedCode}
            </Paper>
            <Alert severity="info" sx={{ mt: 2 }}>
              Paste this code snippet into the HTML of the page where you want the form to appear, ideally just before the closing <code>&lt;/body&gt;</code> tag.
            </Alert>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}
