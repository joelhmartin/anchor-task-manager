/**
 * Forms Manager — Orchestrator shell.
 *
 * Handles pane routing, data loading, and state.
 * Delegates rendering to extracted pane components.
 */

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';

import MainCard from 'ui-component/cards/MainCard';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import { fetchClients } from 'api/clients';
import { listForms } from 'api/forms';

import FormsPane from './FormsPane';
import BuilderPane from './BuilderPane';
import SubmissionsPane from './SubmissionsPane';
import EmbedPane from './EmbedPane';

const VALID_PANES = ['forms', 'builder', 'submissions', 'embed'];

export default function FormsManager() {
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPane = searchParams.get('pane') || 'forms';
  const pane = VALID_PANES.includes(rawPane) ? rawPane : 'forms';
  const formIdParam = searchParams.get('formId') || '';

  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState([]);
  const [clients, setClients] = useState([]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [formsData, clientsData] = await Promise.all([
        listForms().catch(() => []),
        fetchClients().catch(() => [])
      ]);
      setForms(Array.isArray(formsData) ? formsData : []);
      setClients(Array.isArray(clientsData) ? clientsData : clientsData?.clients || []);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const navigateToPane = (targetPane, formId) => {
    const params = { pane: targetPane };
    if (formId) params.formId = formId;
    setSearchParams(params);
  };

  if (loading) {
    return (
      <MainCard title="Forms Manager">
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      </MainCard>
    );
  }

  const renderContent = () => {
    switch (pane) {
      case 'builder':
        return <BuilderPane forms={forms} setForms={setForms} onRefresh={loadData} initialFormId={formIdParam} />;
      case 'submissions':
        return <SubmissionsPane forms={forms} initialFormId={formIdParam} />;
      case 'embed':
        return <EmbedPane forms={forms} initialFormId={formIdParam} />;
      default:
        return <FormsPane forms={forms} setForms={setForms} clients={clients} onRefresh={loadData} onNavigate={navigateToPane} />;
    }
  };

  return (
    <MainCard title="Forms Manager">
      {renderContent()}
    </MainCard>
  );
}
