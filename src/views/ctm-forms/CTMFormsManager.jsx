/**
 * CTM Forms Manager — Main orchestrator
 *
 * Top-level page with pane-based navigation:
 * - list: Clients organized by group — click a client to manage their forms
 * - client: Per-client form management (create, builder, submissions, analytics, embed)
 * - builder: Visual form builder
 * - submissions: View submissions
 * - embed: Get embed code
 * - analytics: Form analytics
 */

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Chip, CircularProgress } from '@mui/material';
import MainCard from 'ui-component/cards/MainCard';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import { fetchClients } from 'api/clients';
import { getClientGroups } from 'api/clientGroups';
import { listCtmForms } from 'api/ctmForms';
import { clientLabel } from 'hooks/useClientLabel';

import FormsListPane from './FormsListPane';
import ClientFormsPane from './ClientFormsPane';
import BuilderPane from './BuilderPane';
import SubmissionsPane from './SubmissionsPane';
import EmbedPane from './EmbedPane';
import AnalyticsPane from './AnalyticsPane';

const VALID_PANES = ['list', 'client', 'builder', 'submissions', 'embed', 'analytics'];

export default function CTMFormsManager() {
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPane = searchParams.get('pane') || 'list';
  const pane = VALID_PANES.includes(rawPane) ? rawPane : 'list';
  const formIdParam = searchParams.get('formId') || '';
  const clientIdParam = searchParams.get('clientId') || '';

  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState([]);
  const [clients, setClients] = useState([]);
  const [clientGroups, setClientGroups] = useState([]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [formsData, clientsData, groupsData] = await Promise.all([
        listCtmForms().catch(() => []),
        fetchClients().catch(() => []),
        getClientGroups().catch(() => [])
      ]);
      setForms(Array.isArray(formsData) ? formsData : []);
      const allClients = Array.isArray(clientsData) ? clientsData : clientsData?.clients || [];
      setClients(allClients.filter(c => c.role === 'client'));
      setClientGroups(Array.isArray(groupsData) ? groupsData : groupsData?.groups || []);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const navigateToPane = (targetPane, params = {}) => {
    const search = { pane: targetPane };
    if (params.formId) search.formId = params.formId;
    if (params.clientId) search.clientId = params.clientId;
    setSearchParams(search);
  };

  if (loading) {
    return (
      <MainCard title="CTM Forms">
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      </MainCard>
    );
  }

  // Get forms for a specific client
  const clientForms = clientIdParam ? forms.filter(f => f.org_id === clientIdParam) : forms;
  const selectedClient = clientIdParam ? clients.find(c => c.id === clientIdParam) : null;

  const renderContent = () => {
    switch (pane) {
      case 'client':
        return (
          <ClientFormsPane
            client={selectedClient}
            forms={clientForms}
            setForms={setForms}
            onRefresh={loadData}
            onNavigate={navigateToPane}
            onBack={() => navigateToPane('list')}
          />
        );
      case 'builder':
        return <BuilderPane forms={clientIdParam ? clientForms : forms} setForms={setForms} clients={clients} onRefresh={loadData} initialFormId={formIdParam} onNavigate={(p, fId) => navigateToPane(p, { formId: fId, clientId: clientIdParam })} />;
      case 'submissions':
        return <SubmissionsPane forms={clientIdParam ? clientForms : forms} initialFormId={formIdParam} onBack={() => navigateToPane('client', { clientId: clientIdParam })} />;
      case 'embed':
        return <EmbedPane forms={clientIdParam ? clientForms : forms} initialFormId={formIdParam} />;
      case 'analytics':
        return <AnalyticsPane forms={clientIdParam ? clientForms : forms} initialFormId={formIdParam} />;
      default:
        return <FormsListPane clients={clients} clientGroups={clientGroups} forms={forms} onNavigate={navigateToPane} />;
    }
  };

  const clientName = selectedClient
    ? (selectedClient.display_name || clientLabel(selectedClient))
    : null;

  return (
    <MainCard
      title="CTM Forms"
      secondary={clientName && pane !== 'list' && pane !== 'client' ? <Chip label={clientName} size="small" variant="outlined" color="primary" /> : undefined}
    >
      {renderContent()}
    </MainCard>
  );
}
