import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import PhoneIcon from '@mui/icons-material/Phone';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import SmsIcon from '@mui/icons-material/Sms';
import EmailIcon from '@mui/icons-material/Email';

import { splitQualifiedReturning } from './leadCategory';

const VISIBLE_CATEGORY_MAP = {
  warm: 'lead',
  very_good: 'lead',
  very_hot: 'lead',
  'very-hot': 'lead',
  hot: 'lead',
  neutral: 'lead',
  needs_attention: 'needs_attention',
  unanswered: 'unanswered',
  voicemail: 'unanswered',
  not_a_fit: 'not_a_fit',
  applicant: 'not_a_fit',
  spam: 'spam',
  converted: 'lead',
  active_client: 'lead',
  returning_customer: 'lead',
  unreviewed: 'lead'
};

const VISIBLE_CATEGORY_LABELS = {
  qualified: 'Qualified',
  returning: 'Returning/Other',
  needs_attention: 'Priority',
  unanswered: 'Unanswered',
  not_a_fit: 'Not a Fit',
  spam: 'Spam',
  pending_review: 'Pending Review'
};

const VISIBLE_CATEGORY_COLORS = {
  qualified: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  returning: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
  needs_attention: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  unanswered: { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc' },
  not_a_fit: { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
  spam: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  pending_review: { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' }
};

const getVisibleCategory = (call) => {
  if (call?.classification_pending) {
    return { key: 'pending_review', label: VISIBLE_CATEGORY_LABELS.pending_review, color: VISIBLE_CATEGORY_COLORS.pending_review };
  }
  const raw = String(call?.category || 'unreviewed').toLowerCase();
  const base = VISIBLE_CATEGORY_MAP[raw] || 'lead';
  const key = splitQualifiedReturning(base, call);
  return { key, label: VISIBLE_CATEGORY_LABELS[key], color: VISIBLE_CATEGORY_COLORS[key] };
};

const ActivityTypeIcon = ({ type }) => {
  const sx = { fontSize: 16, color: 'text.secondary' };
  switch (type) {
    case 'form':
      return <LocalOfferIcon sx={sx} />;
    case 'sms':
      return <SmsIcon sx={sx} />;
    case 'email':
      return <EmailIcon sx={sx} />;
    case 'call':
    default:
      return <PhoneIcon sx={sx} />;
  }
};

export default function LeadActivityRow({ call, onOpenLeadDetail }) {
  const category = getVisibleCategory(call);
  const summary = call?.classification_summary || '';
  const timeLabel = call?.time_ago || call?.call_time || '';
  const callerName = (call?.contact_name_source === 'user' && call?.contact_display_name)
    ? call.contact_display_name
    : (call?.caller_name || 'Unknown Caller');
  const interactive = Boolean(onOpenLeadDetail);

  const interactiveProps = interactive
    ? {
        role: 'button',
        tabIndex: 0,
        onClick: () => onOpenLeadDetail(call),
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpenLeadDetail(call);
          }
        }
      }
    : {};

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1,
        cursor: interactive ? 'pointer' : 'default',
        '&:hover': interactive ? { boxShadow: 1, bgcolor: 'grey.50' } : undefined,
        '&:focus-visible': interactive ? { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } : undefined,
        transition: 'box-shadow 0.15s'
      }}
      {...interactiveProps}
    >
      <Stack direction="row" spacing={1.5} alignItems="center">
        <ActivityTypeIcon type={call?.activity_type || 'call'} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="body2" fontWeight={600} noWrap>
              {callerName}
            </Typography>
            {call?.activity_type === 'form' && call?.form_name && (
              <Chip label={call.form_name} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
            )}
          </Stack>
          {summary && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {summary}
            </Typography>
          )}
        </Box>
        <Chip
          label={category.label}
          size="small"
          sx={{
            bgcolor: category.color.bg,
            color: category.color.text,
            border: `1px solid ${category.color.border}`,
            fontWeight: 600,
            height: 22
          }}
        />
        <Typography variant="caption" color="text.disabled" sx={{ minWidth: 60, textAlign: 'right' }}>
          {timeLabel}
        </Typography>
      </Stack>
    </Paper>
  );
}
