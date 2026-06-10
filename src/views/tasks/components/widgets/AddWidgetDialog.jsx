import { useState } from 'react';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';

import FormDialog from 'ui-component/extended/FormDialog';
import SelectField from 'ui-component/extended/SelectField';
import { useTaskContext } from 'contexts/TaskContext';

const WIDGET_TYPES = [
  { value: 'status_breakdown', label: 'Status Breakdown (Donut Chart)' },
  { value: 'priority_distribution', label: 'Priority Distribution (Bar Chart)' },
  { value: 'workload', label: 'Workload by Person (Stacked Bar)' },
  { value: 'overdue', label: 'Overdue Items (Table)' },
  { value: 'kpi_number', label: 'KPI Number (Big Metric)' },
  { value: 'recent_activity', label: 'Recent Activity (List)' },
  { value: 'label_distribution', label: 'Label Distribution (Bar Chart)' },
  { value: 'battery', label: 'Completion Progress (Battery)' },
  { value: 'timeline', label: 'Timeline (Mini Gantt)' },
  { value: 'items_table', label: 'Items Table (Filterable List)' }
];

const KPI_METRICS = [
  { value: 'open_items', label: 'Open Items' },
  { value: 'completed_items', label: 'Completed Items' },
  { value: 'overdue_items', label: 'Overdue Items' }
];

export default function AddWidgetDialog({ open, onClose, onAdd, loading }) {
  const { allBoards } = useTaskContext();
  const [widgetType, setWidgetType] = useState('');
  const [boardId, setBoardId] = useState('');
  const [kpiMetric, setKpiMetric] = useState('open_items');

  const handleSubmit = () => {
    if (!widgetType) return;
    const config = {};
    if (boardId) config.board_id = boardId;
    if (widgetType === 'kpi_number') config.metric = kpiMetric;
    onAdd(widgetType, config);
  };

  const handleClose = () => {
    setWidgetType('');
    setBoardId('');
    setKpiMetric('open_items');
    onClose();
  };

  return (
    <FormDialog
      open={open}
      onClose={handleClose}
      onSubmit={handleSubmit}
      title="Add Widget"
      submitLabel="Add Widget"
      loading={loading}
      loadingLabel="Adding..."
      submitDisabled={!widgetType}
    >
      <SelectField
        label="Widget Type"
        value={widgetType}
        onChange={(e) => setWidgetType(e.target.value)}
        options={WIDGET_TYPES}
        required
      />

      <SelectField
        label="Board Filter"
        value={boardId}
        onChange={(e) => setBoardId(e.target.value)}
        size="small"
      >
        <MenuItem value="">
          <em>All Boards</em>
        </MenuItem>
        {(allBoards || []).map((b) => (
          <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
        ))}
      </SelectField>
      <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
        Leave blank to include data from all boards in the workspace.
      </Typography>

      {widgetType === 'kpi_number' && (
        <SelectField
          label="KPI Metric"
          value={kpiMetric}
          onChange={(e) => setKpiMetric(e.target.value)}
          options={KPI_METRICS}
          required
        />
      )}
    </FormDialog>
  );
}
