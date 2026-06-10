import { useCallback, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import StatusChip from 'ui-component/extended/StatusChip';
import EmptyState from 'ui-component/extended/EmptyState';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActionArea from '@mui/material/CardActionArea';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AssessmentIcon from '@mui/icons-material/Assessment';
import { deleteDocument, fetchDocuments, fetchSharedDocuments, markDocumentViewed, uploadDocuments } from 'api/documents';

function groupReports(docs) {
  const reports = (docs || []).filter((d) => d.type === 'report');
  const byKey = new Map();
  for (const d of reports) {
    const key = d.report_template_id || d.label || d.name || d.id;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(d);
  }
  for (const arr of byKey.values()) {
    arr.sort((a, b) => new Date(b.report_published_at || b.created_at) - new Date(a.report_published_at || a.created_at));
  }
  return [...byKey.entries()].map(([key, items]) => ({
    key, latest: items[0], archive: items.slice(1)
  }));
}

function ReportCard({ group }) {
  const { latest, archive } = group;
  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardActionArea component={RouterLink} to={latest.url}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <AssessmentIcon color="primary" />
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6">{latest.report_template_name || latest.label || latest.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                Generated {new Date(latest.report_published_at || latest.created_at).toLocaleDateString()}
              </Typography>
              {latest.name && latest.name !== latest.label && (
                <Typography variant="body2" color="text.secondary">{latest.name}</Typography>
              )}
            </Box>
            <Chip label="Latest" color="primary" size="small" />
          </Stack>
        </CardContent>
      </CardActionArea>
      {archive.length > 0 && (
        <Accordion disableGutters elevation={0} sx={{ borderTop: 1, borderColor: 'divider' }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="body2" color="text.secondary">
              {archive.length} earlier {archive.length === 1 ? 'run' : 'runs'}
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <Table size="small">
              <TableBody>
                {archive.map((d) => (
                  <TableRow key={d.id} hover>
                    <TableCell>{new Date(d.report_published_at || d.created_at).toLocaleDateString()}</TableCell>
                    <TableCell align="right">
                      <Button component={RouterLink} to={d.url} size="small">View</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionDetails>
        </Accordion>
      )}
    </Card>
  );
}

export default function DocumentsTab({ triggerMessage }) {
  const [documents, setDocuments] = useState(null);
  const [sharedDocuments, setSharedDocuments] = useState(null);
  const [docUploads, setDocUploads] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);

  const loadDocuments = useCallback(async () => {
    setDocsLoading(true);
    try {
      const [docs, shared] = await Promise.all([fetchDocuments(), fetchSharedDocuments()]);
      setDocuments(docs);
      setSharedDocuments(shared);
    } catch (err) {
      triggerMessage('error', err.message || 'Unable to load documents');
    } finally {
      setDocsLoading(false);
    }
  }, [triggerMessage]);

  // Load on first render
  if (!documents && !docsLoading) loadDocuments();

  const reportGroups = useMemo(() => groupReports(documents), [documents]);
  const nonReportDocs = useMemo(() => (documents || []).filter((d) => d.type !== 'report'), [documents]);

  const handleDocUpload = async () => {
    if (!docUploads.length) return;
    try {
      const docs = await uploadDocuments(docUploads);
      setDocuments(docs);
      setDocUploads([]);
      triggerMessage('success', 'Document(s) uploaded');
    } catch (err) {
      triggerMessage('error', err.message || 'Unable to upload documents');
    }
  };

  const handleDocDelete = async (docId) => {
    try {
      await deleteDocument(docId);
      loadDocuments();
    } catch (err) {
      triggerMessage('error', err.message || 'Unable to delete document');
    }
  };

  const handleMarkViewed = async (docId) => {
    try {
      await markDocumentViewed(docId);
      loadDocuments();
    } catch (err) {
      triggerMessage('error', err.message || 'Unable to update document');
    }
  };

  return (
    <Stack spacing={3}>
      {/* Helpful Documents (shared by admin with all clients) */}
      {sharedDocuments && sharedDocuments.length > 0 && (
        <>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            Helpful Documents
          </Typography>
          <Stack spacing={1}>
            {sharedDocuments.map((doc) => (
              <Card key={doc.id} variant="outlined" sx={{ bgcolor: 'primary.lighter' }}>
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="subtitle1" fontWeight={500}>
                        {doc.label || doc.name}
                      </Typography>
                      {doc.description && (
                        <Typography variant="body2" color="text.secondary">
                          {doc.description}
                        </Typography>
                      )}
                    </Box>
                    <Button variant="contained" href={doc.url} target="_blank" rel="noreferrer" size="small">
                      View
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
          <Divider />
        </>
      )}

      {/* AI Reports section — grouped by template, latest featured + archive accordion */}
      {reportGroups.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h5" gutterBottom sx={{ fontWeight: 600 }}>
            Reports
          </Typography>
          {reportGroups.map((g) => <ReportCard key={g.key} group={g} />)}
          <Divider sx={{ mt: 2 }} />
        </Box>
      )}

      {/* Your Documents section */}
      <Typography variant="h5" sx={{ fontWeight: 600 }}>
        Your Documents
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
        <Button variant="outlined" component="label" startIcon={<UploadFileIcon />}>
          Select Files to Upload
          <input type="file" hidden multiple onChange={(e) => setDocUploads(Array.from(e.target.files || []))} />
        </Button>
        {docUploads.length > 0 && <Chip label={`${docUploads.length} file(s) selected`} onDelete={() => setDocUploads([])} />}
        <Button variant="contained" onClick={handleDocUpload} disabled={!docUploads.length}>
          Upload
        </Button>
      </Stack>

      {docsLoading && <LinearProgress />}
      <Stack spacing={1}>
        {nonReportDocs?.map((doc) => (
          <Card key={doc.id} variant="outlined">
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
                <Box sx={{ flex: 1 }}>
                  <Typography variant="subtitle1">{doc.label || doc.name}</Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                    <StatusChip status={doc.review_status || 'none'} />
                    {doc.origin === 'admin' && <Chip label="From Admin" size="small" variant="outlined" color="info" />}
                  </Stack>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Button variant="outlined" href={doc.url} target="_blank" rel="noreferrer" size="small">
                    View
                  </Button>
                  {doc.origin === 'client' && (
                    <IconButton color="error" onClick={() => handleDocDelete(doc.id)} size="small">
                      <DeleteOutlineIcon />
                    </IconButton>
                  )}
                  {doc.review_status !== 'viewed' && (
                    <Button variant="text" onClick={() => handleMarkViewed(doc.id)} size="small">
                      Mark Viewed
                    </Button>
                  )}
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        ))}
        {!nonReportDocs?.length && !docsLoading && (
          <EmptyState title="No documents uploaded yet." />
        )}
      </Stack>
    </Stack>
  );
}
