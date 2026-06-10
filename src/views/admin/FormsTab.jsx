/**
 * Forms Tab — Admin Hub client drawer
 *
 * Lists CTM forms for the client with links to the form builder.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import BuildIcon from '@mui/icons-material/Construction';
import VisibilityIcon from '@mui/icons-material/Visibility';
import BarChartIcon from '@mui/icons-material/BarChart';
import CodeIcon from '@mui/icons-material/Code';

import DataTable from 'ui-component/extended/DataTable';
import StatusChip from 'ui-component/extended/StatusChip';
import EmptyState from 'ui-component/extended/EmptyState';
import { listCtmForms } from 'api/ctmForms';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';

export default function FormsTab({ clientId }) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState([]);

  const loadForms = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listCtmForms(clientId);
      setForms(data);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [clientId, showToast]);

  useEffect(() => { loadForms(); }, [loadForms]);

  const goTo = (pane, formId) => {
    const params = new URLSearchParams({ pane, clientId });
    if (formId) params.set('formId', formId);
    navigate(`/ctm-forms?${params.toString()}`);
  };

  const columns = useMemo(() => [
    {
      id: 'name', label: 'Form', sortable: true,
      render: (row) => (
        <Typography variant="body2" fontWeight={500}>{row.name}</Typography>
      )
    },
    { id: 'status', label: 'Status', sortable: true, render: (row) => <StatusChip status={row.status} /> },
    {
      id: 'submission_count', label: 'Submissions', sortable: true, align: 'center',
      sortValue: (row) => Number(row.submission_count) || 0,
      render: (row) => <Typography variant="body2">{row.submission_count || 0}</Typography>
    },
    {
      id: 'actions', label: '', align: 'right',
      render: (row) => (
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
          <Tooltip title="Form Builder">
            <IconButton size="small" onClick={() => goTo('builder', row.id)}><BuildIcon fontSize="small" /></IconButton>
          </Tooltip>
          <Tooltip title="Submissions">
            <IconButton size="small" onClick={() => goTo('submissions', row.id)}><VisibilityIcon fontSize="small" /></IconButton>
          </Tooltip>
          <Tooltip title="Analytics">
            <IconButton size="small" onClick={() => goTo('analytics', row.id)}><BarChartIcon fontSize="small" /></IconButton>
          </Tooltip>
          {row.status === 'published' && (
            <Tooltip title="Embed Code">
              <IconButton size="small" onClick={() => goTo('embed', row.id)}><CodeIcon fontSize="small" /></IconButton>
            </Tooltip>
          )}
        </Stack>
      )
    }
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (forms.length === 0) {
    return <EmptyState title="No forms yet" message="Create forms for this client from the CTM Forms page." />;
  }

  return (
    <DataTable
      columns={columns}
      rows={forms}
      size="small"
      outlined
      searchable
      searchFields={['name']}
      emptyTitle="No forms match your search."
    />
  );
}

FormsTab.propTypes = {
  clientId: PropTypes.string.isRequired
};
