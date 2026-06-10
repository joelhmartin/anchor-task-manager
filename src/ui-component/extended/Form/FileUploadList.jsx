import { useEffect, useMemo, useRef } from 'react';
import {
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Typography
} from '@mui/material';
import { IconUpload, IconX, IconFileText, IconFile } from '@tabler/icons-react';
import { useToast } from 'contexts/ToastContext';

function isImageAsset(asset) {
  const mime = String(asset?.mime || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  const url = String(asset?.url || '').toLowerCase();
  return /\.(png|jpe?g|webp|gif|svg)$/.test(url);
}

export default function FileUploadList({
  title,
  description,
  accept,
  multiple = true,
  disabled = false,
  busy = false,
  errorText = '',
  items = [],
  onAddFiles,
  onRemove,
  kindLabel
}) {
  const safeItems = useMemo(() => (Array.isArray(items) ? items : []), [items]);
  const inputId = useMemo(() => `upload-${Math.random().toString(36).slice(2)}`, []);
  const toast = useToast();
  const lastToastRef = useRef('');

  useEffect(() => {
    const msg = String(errorText || '').trim();
    if (!msg) return;
    // Avoid duplicate toasts when the parent re-renders with the same errorText.
    if (lastToastRef.current === msg) return;
    lastToastRef.current = msg;
    toast.error(msg);
  }, [errorText, toast]);

  return (
    <Stack spacing={1}>
      {title && <Typography variant="subtitle2">{title}</Typography>}
      {description && (
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      )}
      {errorText ? (
        <Typography variant="caption" color="error" sx={{ lineHeight: 1.2 }}>
          {errorText}
        </Typography>
      ) : null}

      {safeItems.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {safeItems.map((asset) => {
            const img = isImageAsset(asset);
            const label = asset?.name || 'Uploaded file';
            const url = asset?.url || '#';

            return (
              <Chip
                key={asset?.id || url || label}
                variant="outlined"
                sx={{
                  height: 44,
                  '& .MuiChip-label': { display: 'flex', alignItems: 'center', gap: 1 }
                }}
                label={
                  <>
                    {img ? (
                      <Avatar
                        variant="rounded"
                        src={url}
                        alt={label}
                        sx={{ width: 28, height: 28 }}
                        imgProps={{ referrerPolicy: 'no-referrer' }}
                      />
                    ) : (
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        {String(asset?.mime || '').includes('pdf') ? <IconFileText size={18} /> : <IconFile size={18} />}
                      </Box>
                    )}
                    <Typography
                      component="a"
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      sx={{ color: 'inherit', textDecoration: 'none', maxWidth: 220 }}
                      noWrap
                    >
                      {label}
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={() => onRemove?.(asset)}
                      disabled={disabled}
                      sx={{ ml: 0.5 }}
                      aria-label="Remove file"
                    >
                      <IconX size={16} />
                    </IconButton>
                  </>
                }
              />
            );
          })}
        </Stack>
      )}

      <Box
        sx={{
          border: '2px dashed',
          borderColor: 'divider',
          borderRadius: 2,
          p: 2,
          bgcolor: 'grey.50'
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
          <Stack direction="row" spacing={1} alignItems="center">
            {kindLabel ? <Chip size="small" label={kindLabel} /> : null}
            <Typography variant="body2" color="text.secondary">
              {multiple ? 'Upload one or more files' : 'Upload a file'}
            </Typography>
          </Stack>
          <label htmlFor={inputId}>
            <input
              id={inputId}
              type="file"
              accept={accept}
              multiple={multiple}
              disabled={disabled || busy}
              style={{ display: 'none' }}
              onChange={(e) => {
                const files = e.target.files;
                if (!files || !files.length) return;
                onAddFiles?.(files);
                // allow re-uploading the same filename
                e.target.value = '';
              }}
            />
            <Button
              variant="outlined"
              component="span"
              startIcon={busy ? <CircularProgress size={16} /> : <IconUpload size={16} />}
              disabled={disabled || busy}
              size="small"
            >
              {busy ? 'Uploading…' : `Choose file${multiple ? 's' : ''}`}
            </Button>
          </label>
        </Stack>
      </Box>
    </Stack>
  );
}


