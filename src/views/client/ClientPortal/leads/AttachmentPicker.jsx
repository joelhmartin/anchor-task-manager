import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import UploadFileIcon from '@mui/icons-material/UploadFile';

import { useToast } from 'contexts/ToastContext';
import { fetchDocuments, uploadDocuments } from 'api/documents';

const isPdfDoc = (doc) =>
  doc?.content_type === 'application/pdf' ||
  String(doc?.name || doc?.label || '')
    .toLowerCase()
    .endsWith('.pdf');

// Pull a usable file_id off a doc row (the docs API exposes file_id directly).
const docFileId = (doc) => doc?.file_id || null;
const docName = (doc) => doc?.label || doc?.name || 'Document';

/**
 * Picker for attaching client PDF documents to an email or template.
 *
 * Props:
 *  - value: array of { file_id, name }
 *  - onChange(next): replace the attachment list
 */
export default function AttachmentPicker({ value = [], onChange }) {
  const toast = useToast();
  const fileInputRef = useRef(null);
  const [docs, setDocs] = useState([]);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchDocuments()
      .then((rows) => {
        if (!cancelled) setDocs(Array.isArray(rows) ? rows.filter(isPdfDoc) : []);
      })
      .catch(() => {
        if (!cancelled) setDocs([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const attachedIds = new Set(value.map((a) => a.file_id));
  const availableDocs = docs.filter((d) => docFileId(d) && !attachedIds.has(docFileId(d)));

  const addAttachment = (next) => {
    if (!next?.file_id) return;
    if (attachedIds.has(next.file_id)) return;
    onChange?.([...value, next]);
  };

  const removeAttachment = (fileId) => {
    onChange?.(value.filter((a) => a.file_id !== fileId));
  };

  const handlePickExisting = (doc) => {
    setMenuAnchor(null);
    addAttachment({ file_id: docFileId(doc), name: docName(doc) });
  };

  const handleUploadClick = () => {
    setMenuAnchor(null);
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setUploading(true);
    try {
      const created = await uploadDocuments([file]);
      const doc = Array.isArray(created) ? created[0] : created;
      const fileId = docFileId(doc);
      if (!fileId) {
        toast.error('Upload succeeded but no file reference came back.');
        return;
      }
      setDocs((prev) => [doc, ...prev]);
      addAttachment({ file_id: fileId, name: docName(doc) });
      toast.success('Added and saved to documents.');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not upload that PDF.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: value.length ? 1 : 0 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AttachFileIcon fontSize="small" />}
          onClick={(e) => setMenuAnchor(e.currentTarget)}
          disabled={uploading}
        >
          {uploading ? 'Uploading…' : 'Attach PDF'}
        </Button>
      </Stack>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={handleUploadClick}>
          <UploadFileIcon fontSize="small" sx={{ mr: 1 }} />
          Upload new PDF
        </MenuItem>
        {availableDocs.length > 0 && [
          <Typography key="__heading" variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, pt: 1, pb: 0.5 }}>
            From documents
          </Typography>,
          ...availableDocs.map((doc) => (
            <MenuItem key={docFileId(doc)} onClick={() => handlePickExisting(doc)}>
              <PictureAsPdfIcon fontSize="small" sx={{ mr: 1 }} />
              {docName(doc)}
            </MenuItem>
          ))
        ]}
        {availableDocs.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 1 }}>
            No other PDFs in documents yet.
          </Typography>
        )}
      </Menu>

      <input ref={fileInputRef} type="file" accept="application/pdf" hidden onChange={handleFileSelected} />

      {value.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {value.map((a) => (
            <Chip
              key={a.file_id}
              size="small"
              icon={<PictureAsPdfIcon />}
              label={a.name || 'PDF'}
              onDelete={() => removeAttachment(a.file_id)}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}

AttachmentPicker.propTypes = {
  value: PropTypes.arrayOf(
    PropTypes.shape({
      file_id: PropTypes.string,
      name: PropTypes.string
    })
  ),
  onChange: PropTypes.func
};
