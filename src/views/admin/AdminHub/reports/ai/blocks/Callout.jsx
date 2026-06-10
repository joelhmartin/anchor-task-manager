import { Alert } from '@mui/material';

export default function Callout({ tone = 'info', title, body }) {
  return (
    <Alert severity={tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : 'info'} sx={{ mt: 2 }}>
      {title && <strong>{title}: </strong>}{body}
    </Alert>
  );
}
