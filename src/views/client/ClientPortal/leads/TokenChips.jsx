import PropTypes from 'prop-types';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

import { useToast } from 'contexts/ToastContext';

const TOKENS = [
  // The lead being emailed.
  { label: "Lead's first name", token: '{{first_name}}' },
  { label: "Lead's name", token: '{{client_name}}' },
  { label: "Lead's email", token: '{{client_email}}' },
  { label: "Lead's phone", token: '{{client_phone}}' },
  // Your own business info (so the lead can reach you).
  { label: 'Business name', token: '{{business_name}}' },
  { label: 'Our phone', token: '{{phone}}' },
  { label: 'Our email', token: '{{email}}' }
];

/**
 * Renders the available merge tokens as small copy-to-clipboard chips.
 *
 * Props:
 *  - onCopied?(token): optional callback fired after a token is copied.
 */
export default function TokenChips({ onCopied }) {
  const toast = useToast();

  const copy = async (token) => {
    try {
      await navigator.clipboard.writeText(token);
      toast.success(`Copied ${token}`);
      onCopied?.(token);
    } catch {
      toast.error('Could not copy that token.');
    }
  };

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        Insert tokens:
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {TOKENS.map((t) => (
          <Chip
            key={t.token}
            size="small"
            variant="outlined"
            label={t.label}
            icon={<ContentCopyIcon fontSize="small" />}
            onClick={() => copy(t.token)}
            sx={{ cursor: 'pointer' }}
          />
        ))}
      </Stack>
    </Box>
  );
}

TokenChips.propTypes = {
  onCopied: PropTypes.func
};
