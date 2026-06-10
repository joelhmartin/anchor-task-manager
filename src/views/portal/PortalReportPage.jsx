import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import client from 'api/client';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import WebReportRenderer from 'views/admin/AdminHub/reports/ai/WebReportRenderer';

export default function PortalReportPage() {
  const { itemId } = useParams();
  const [item, setItem] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    client
      .get(`/reports/portal/items/${itemId}`)
      .then((r) => { if (!cancelled) setItem(r.data.item); })
      .catch((e) => { if (!cancelled) setError(e.response?.data?.error || e.message); });
    return () => { cancelled = true; };
  }, [itemId]);

  if (error) return <Alert severity="error" sx={{ m: 4 }}>{error}</Alert>;
  if (!item) return <Box sx={{ p: 4 }}><CircularProgress /></Box>;
  return <WebReportRenderer payload={item.rendered_payload} />;
}
