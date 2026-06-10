import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { IconRefresh, IconTrash } from '@tabler/icons-react';

import MainCard from 'ui-component/cards/MainCard';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import { fetchWidgetData, deleteWidget } from 'api/tasks';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';

import StatusBreakdownWidget from './StatusBreakdownWidget';
import PriorityDistributionWidget from './PriorityDistributionWidget';
import WorkloadWidget from './WorkloadWidget';
import OverdueWidget from './OverdueWidget';
import KpiNumberWidget from './KpiNumberWidget';
import RecentActivityWidget from './RecentActivityWidget';
import LabelDistributionWidget from './LabelDistributionWidget';
import BatteryWidget from './BatteryWidget';
import TimelineWidget from './TimelineWidget';
import ItemsTableWidget from './ItemsTableWidget';

const WIDGET_TYPE_LABELS = {
  status_breakdown: 'Status Breakdown',
  priority_distribution: 'Priority Distribution',
  workload: 'Workload',
  overdue: 'Overdue Items',
  kpi_number: 'KPI',
  recent_activity: 'Recent Activity',
  label_distribution: 'Label Distribution',
  battery: 'Completion Progress',
  timeline: 'Timeline',
  items_table: 'Items Table'
};

const WIDGET_RENDERERS = {
  status_breakdown: StatusBreakdownWidget,
  priority_distribution: PriorityDistributionWidget,
  workload: WorkloadWidget,
  overdue: OverdueWidget,
  kpi_number: KpiNumberWidget,
  recent_activity: RecentActivityWidget,
  label_distribution: LabelDistributionWidget,
  battery: BatteryWidget,
  timeline: TimelineWidget,
  items_table: ItemsTableWidget
};

export default function WidgetCard({ widget, onDeleted }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchWidgetData(widget.widget_type, widget.config || {});
      setData(result);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load widget data'));
    } finally {
      setLoading(false);
    }
  }, [widget.widget_type, widget.config]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteWidget(widget.id);
      toast.success('Widget removed.');
      setDeleteOpen(false);
      if (onDeleted) onDeleted(widget.id);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete widget'));
    } finally {
      setDeleting(false);
    }
  };

  const Renderer = WIDGET_RENDERERS[widget.widget_type];
  const title = WIDGET_TYPE_LABELS[widget.widget_type] || widget.widget_type;

  const headerAction = (
    <Stack direction="row" spacing={0.5}>
      <Tooltip title="Refresh">
        <IconButton size="small" onClick={loadData} disabled={loading} aria-label={`Refresh ${title} widget`}>
          <IconRefresh size={16} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Remove widget">
        <IconButton size="small" onClick={() => setDeleteOpen(true)} aria-label={`Remove ${title} widget`}>
          <IconTrash size={16} />
        </IconButton>
      </Tooltip>
    </Stack>
  );

  return (
    <>
      <MainCard title={title} secondary={headerAction} border sx={{ height: '100%' }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
            <CircularProgress size={32} />
          </Box>
        )}
        {!loading && error && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
            <Typography variant="body2" color="error">{error}</Typography>
          </Box>
        )}
        {!loading && !error && Renderer && <Renderer data={data} />}
        {!loading && !error && !Renderer && (
          <Typography variant="body2" color="text.secondary">
            Unknown widget type: {widget.widget_type}
          </Typography>
        )}
      </MainCard>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Remove Widget"
        message="Remove this widget from the dashboard?"
        secondaryText="You can always add it back later."
        confirmLabel="Remove"
        confirmColor="error"
        loading={deleting}
        loadingLabel="Removing..."
      />
    </>
  );
}
