import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import MainCard from 'ui-component/cards/MainCard';
import ReviewsPanel from './ReviewsPanel';
import TeamManagement from './TeamManagement';
import AnalyticsTab from './ClientPortal/AnalyticsTab';
import OnboardingModal from './ClientPortal/OnboardingModal';
import ProfileTab from './ClientPortal/ProfileTab';
import DocumentsTab from './ClientPortal/DocumentsTab';
import BrandTab from './ClientPortal/BrandTab';
import LeadsTab from './ClientPortal/LeadsTab';
import ContactsTab from './ClientPortal/ContactsTab';
import JourneyTab from './ClientPortal/JourneyTab';
import ConcernDialog from './ClientPortal/ConcernDialog';
import ServiceDialog from './ClientPortal/ServiceDialog';
import UpdatesBanner from './ClientPortal/UpdatesBanner';
import NotificationsTab from './ClientPortal/NotificationsTab';
import TutorialsTab from './ClientPortal/TutorialsTab';
import ActivityLogTab from './ClientPortal/ActivityLogTab';
import useAuth from 'hooks/useAuth';
import useJourneys from 'hooks/useJourneys';
import useStateVersionPoll from 'hooks/useStateVersionPoll';
import useJourneyDrawer from 'hooks/useJourneyDrawer';
import useTutorial from 'hooks/useTutorial';
import { fetchProfile } from 'api/profile';
import { fetchServices } from 'api/services';
import { convertJourney } from 'api/journeys';
import { CLIENT_CONCERN_PRESETS } from 'constants/clientPresets';

export default function ClientPortal() {
  const { user, actingClientId, activePortalClientId, clearActingClient, refreshUser } = useAuth();
  const isAdmin = ['superadmin', 'admin'].includes(user?.role || user?.effective_role);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tabParam = searchParams.get('tab') || 'leads';
  const [message, setMessage] = useState({ type: '', text: '' });

  // Shared state: services (used by LeadsTab, JourneyTab, ServiceDialog)
  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);

  // Shared state: profile (needed for concernOptions)
  const [profile, setProfile] = useState(null);

  const triggerMessage = useCallback((type, text) => setMessage({ type, text }), []);

  const SECTION_CONFIG = useMemo(
    () => [
      { value: 'profile', label: 'Profile' },
      { value: 'notifications', label: 'Notifications' },
      { value: 'analytics', label: 'Analytics' },
      { value: 'leads', label: 'Leads' },
      { value: 'contacts', label: 'Contacts' },
      { value: 'reviews', label: 'Reviews' },
      { value: 'journey', label: 'Lead Journey' },
      { value: 'brand', label: 'Brand Assets' },
      { value: 'documents', label: 'Documents' },
      { value: 'team', label: 'Team' },
      { value: 'activity', label: 'Activity Log' },
      { value: 'tutorials', label: 'Tutorials' }
    ],
    []
  );

  // Shared journey state — always available regardless of active tab
  const journeyHook = useJourneys(triggerMessage);
  const loadJourneys = journeyHook.load;
  const createJourneyRecord = journeyHook.create;

  // Cross-client sync: refetch the pipeline board when journeys/contacts change elsewhere.
  // Polled at the portal level so journeys stay fresh regardless of the active tab.
  useStateVersionPoll(loadJourneys);

  // Tutorial mock data — substitute mock journeys while a journey tutorial is running
  const { activeTutorial, mockData: tutorialMockData } = useTutorial();
  const tutorialJourneys = tutorialMockData?.journeys || null;

  const tutorialId = activeTutorial?.tutorial?.id;
  const tutorialStepIndex = activeTutorial?.stepIndex ?? -1;
  // Steps 5–8 of the consolidated lead-journeys tutorial describe the drawer, so
  // auto-open it (with a mock journey) for that range. Keep in sync with
  // src/tutorials/leadJourneys.js.
  const drawerTutorialMode = tutorialId === 'lead-journeys' && tutorialStepIndex >= 5 && tutorialStepIndex <= 8;

  // Dialog state — lifted to portal level so dialogs are always mounted
  const [concernDialog, setConcernDialog] = useState({ open: false, lead: null, journey: null, forceNew: false, activeClientId: null });
  const [serviceDialog, setServiceDialog] = useState({ open: false, lead: null });
  const [journeyStarted, setJourneyStarted] = useState(null); // { name } when dialog is open
  const [journeySubTab, setJourneySubTab] = useState(0); // 0 = Pipeline, 1 = Email Templates

  // Legacy 'archive' deep links fold into Contacts (Status = Archived) — see Phase 5.
  const resolvedTabParam = tabParam === 'archive' ? 'contacts' : tabParam;
  const activeTab = useMemo(
    () => (SECTION_CONFIG.some((section) => section.value === resolvedTabParam) ? resolvedTabParam : 'leads'),
    [SECTION_CONFIG, resolvedTabParam]
  );

  // Seed the Contacts status filter from the URL: ?tab=archive → Archived; otherwise an
  // explicit ?status= (e.g. the /active-clients redirect passes status=active_client).
  const contactsInitialStatus = tabParam === 'archive' ? 'archived' : searchParams.get('status') || '';

  useEffect(() => {
    setMessage({ type: '', text: '' });
  }, [activeTab]);

  const currentSection = useMemo(
    () => SECTION_CONFIG.find((section) => section.value === activeTab) || SECTION_CONFIG[0],
    [SECTION_CONFIG, activeTab]
  );

  const loadServices = useCallback(async () => {
    setServicesLoading(true);
    try {
      const data = await fetchServices();
      setServices(data.filter((s) => s.active !== false));
    } catch (err) {
      triggerMessage('error', err.message || 'Unable to load services');
    } finally {
      setServicesLoading(false);
    }
  }, [triggerMessage]);

  // Reload profile when the viewed portal context changes.
  useEffect(() => {
    setProfile(null);
    fetchProfile()
      .then((data) => setProfile(data))
      .catch(() => {});
  }, [activePortalClientId, user?.id]);

  // Shared portal data should refresh whenever the viewed client context changes.
  useEffect(() => {
    loadJourneys();
  }, [loadJourneys, activePortalClientId, user?.id]);

  useEffect(() => {
    setServices([]);
    loadServices();
  }, [loadServices, activePortalClientId, user?.id]);

  const concernOptions = useMemo(() => {
    if (profile?.client_subtype && CLIENT_CONCERN_PRESETS[profile.client_subtype]) {
      return CLIENT_CONCERN_PRESETS[profile.client_subtype];
    }
    if (profile?.client_type && CLIENT_CONCERN_PRESETS[profile.client_type]) {
      return CLIENT_CONCERN_PRESETS[profile.client_type];
    }
    return CLIENT_CONCERN_PRESETS.other || [];
  }, [profile?.client_subtype, profile?.client_type]);

  // Catalog-backed service options for the Start/Update Journey dialog. Selections write
  // real catalog service ids into payload.services → contact_services on the backend.
  const serviceOptions = useMemo(() => (services || []).map((s) => ({ id: s.id, name: s.name })), [services]);

  // --- Journey create wrapper — auto-tags the lead and shows the started dialog ---

  const handleJourneyCreate = useCallback(
    async (payload) => {
      const result = await createJourneyRecord(payload);
      setJourneyStarted({ name: payload.client_name || 'This contact' });
      return result;
    },
    [createJourneyRecord]
  );

  // --- Dialog openers (stable callbacks passed to tabs) ---

  const handleOpenConcernDialog = useCallback((lead, journey = null, options = {}) => {
    setConcernDialog({
      open: true,
      lead: lead || null,
      journey: journey || null,
      forceNew: options.forceNew || false,
      activeClientId: options.activeClientId || lead?.active_client_id || null
    });
  }, []);

  const handleCloseConcernDialog = useCallback(() => {
    setConcernDialog({ open: false, lead: null, journey: null, forceNew: false, activeClientId: null });
  }, []);

  const handleOpenServiceDialog = useCallback(
    (lead) => {
      if (!services.length && !servicesLoading) {
        loadServices();
      }
      setServiceDialog({ open: true, lead });
    },
    [loadServices, services.length, servicesLoading]
  );

  const handleCloseServiceDialog = useCallback(() => {
    setServiceDialog({ open: false, lead: null });
  }, []);

  // Convert from the journey drawer: map the journey row into the `lead` shape the
  // ServiceDialog expects, then open the same agree-to-service flow LeadsTab uses.
  // We carry the journey_id so the backend links the new client to this journey and
  // so handleServiceAgreed can close the journey as converted on success.
  const handleConvertJourney = useCallback(
    (journey) => {
      if (!journey?.id) return;
      handleOpenServiceDialog({
        // Originating lead call id (CTM string key preferred, UUID fallback) so the
        // backend can resolve/score the lead. Falls back to the journey id if the
        // journey was never linked to a call (manual journey).
        id: journey.lead_call_key || journey.lead_call_id || journey.id,
        journey_id: journey.id,
        caller_name: journey.client_name || null,
        caller_number: journey.client_phone || null,
        caller_email: journey.client_email || null,
        email: journey.client_email || null,
        source: journey.source || 'CTM',
        category: journey.category || null,
        region: journey.region || null,
        call_time: journey.lead_call_time || null,
        contact_id: journey.contact_id || null
      });
    },
    [handleOpenServiceDialog]
  );

  // Ref to the journey drawer's closeDrawer — set after the drawer hook is created
  // below, so handleServiceAgreed can close the drawer without a hook ordering cycle.
  const closeJourneyDrawerRef = useRef(null);

  // After service agreement succeeds: create-the-client already happened in the
  // dialog. Now (a) close any linked journey as converted so it leaves the Pipeline
  // board, (b) reload journeys, and (c) tell LeadsTab to drop the converted lead.
  const handleServiceAgreed = useCallback(
    async (leadId, ctx = {}) => {
      const { journeyId = null, activeClientId = null } = ctx || {};
      if (journeyId) {
        try {
          const { journey } = await convertJourney(journeyId, { active_client_id: activeClientId });
          // Immediate UI: flip the journey to converted in shared state, then close
          // the drawer if it's showing this journey.
          journeyHook.applyJourneyUpdate(journey);
          if (typeof closeJourneyDrawerRef.current === 'function') {
            closeJourneyDrawerRef.current();
          }
        } catch (err) {
          triggerMessage('error', err?.response?.data?.message || 'Client created, but the journey could not be closed.');
        }
      }
      loadJourneys();
      // Dispatch a custom event so LeadsTab can immediately remove the converted lead
      if (leadId) {
        window.dispatchEvent(new CustomEvent('lead-converted', { detail: { leadId } }));
      }
    },
    [loadJourneys, journeyHook, triggerMessage]
  );

  // LeadsTab is always mounted (hidden when not the active tab) so its lead-detail
  // drawer (portal-rendered via MUI Drawer) is reachable from the Journey tab too.
  // LeadsTab assigns its handleOpenLeadDetail into this ref on mount; the journey
  // drawer's Activity tab + JourneyTab activity rows invoke it directly so the
  // drawer opens in place without changing the URL.
  const leadDrawerOpenerRef = useRef(null);
  const handleOpenLeadFromJourney = useCallback(
    (call) => {
      if (!call?.id) return;
      if (typeof leadDrawerOpenerRef.current === 'function') {
        leadDrawerOpenerRef.current(call);
        return;
      }
      // Fallback if the ref hasn't wired up yet (shouldn't happen in normal flow).
      const next = new URLSearchParams(searchParams);
      next.set('tab', 'leads');
      next.set('lead', String(call.id));
      navigate(`/portal?${next.toString()}`);
    },
    [navigate, searchParams]
  );

  // Shared journey drawer — opened from both the Lead Journey tab and the Leads → Lead Journeys sub-tab.
  const journeyDrawer = useJourneyDrawer({
    triggerMessage,
    upsertJourney: journeyHook.upsert,
    onArchiveJourney: journeyHook.archive,
    onConvert: handleConvertJourney,
    onOpenLeadDetail: handleOpenLeadFromJourney,
    // Switch the user to the dedicated Lead Journey tab's "Email Templates" sub-tab.
    onManageTemplates: () => {
      setJourneySubTab(1);
      navigate('/portal?tab=journey');
    },
    tutorialMode: drawerTutorialMode
  });

  // Expose the drawer's closeDrawer to handleServiceAgreed (defined above) without
  // a hook ordering cycle.
  closeJourneyDrawerRef.current = journeyDrawer.closeDrawer;

  // --- Tutorial drawer/sub-tab choreography (lead-journeys) ---
  // openDrawer/closeDrawer are stable useCallbacks; openJourneyId is a value.
  const { openDrawer: tutorialOpenDrawer, closeDrawer: tutorialCloseDrawer, openJourneyId: openJourneyDrawerId } = journeyDrawer;

  // Auto-open the drawer with the first mock journey while the tour is on the
  // drawer steps; close it (only if a mock journey is showing) when it leaves.
  useEffect(() => {
    if (drawerTutorialMode && tutorialJourneys?.length) {
      tutorialOpenDrawer(tutorialJourneys[0]);
    } else if (!drawerTutorialMode && typeof openJourneyDrawerId === 'string' && openJourneyDrawerId.startsWith('mock-journey')) {
      tutorialCloseDrawer();
    }
  }, [drawerTutorialMode, tutorialJourneys, tutorialOpenDrawer, tutorialCloseDrawer, openJourneyDrawerId]);

  // Drive the journey tab's sub-tab: pipeline for the pipeline steps, Email
  // Templates for the templates step.
  useEffect(() => {
    if (tutorialId !== 'lead-journeys') return;
    if (tutorialStepIndex === 9) setJourneySubTab(1);
    else if (tutorialStepIndex === 3 || tutorialStepIndex === 4) setJourneySubTab(0);
  }, [tutorialId, tutorialStepIndex]);

  // Keyboard shortcuts for power users
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }
      // Number keys for tab navigation (1-7)
      const tabMap = { 1: 'profile', 2: 'brand', 3: 'documents', 4: 'leads', 5: 'journey', 6: 'contacts', 7: 'reviews' };
      if (tabMap[e.key]) {
        e.preventDefault();
        navigate(`/portal?tab=${tabMap[e.key]}`);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  return (
    <MainCard title="Client Portal">
      <Stack spacing={2}>
        {actingClientId && (
          <Alert
            severity="info"
            action={
              <Button size="small" color="inherit" onClick={clearActingClient}>
                Exit Client View
              </Button>
            }
          >
            You are currently viewing the portal as a client.
          </Alert>
        )}
        {message.text && <Alert severity={message.type === 'error' ? 'error' : 'success'}>{message.text}</Alert>}

        <UpdatesBanner />

        {activeTab !== 'analytics' && activeTab !== 'leads' && <Typography variant="h4">{currentSection.label}</Typography>}

        {activeTab === 'analytics' && <AnalyticsTab key={activePortalClientId} />}

        {activeTab === 'brand' && <BrandTab key={activePortalClientId} triggerMessage={triggerMessage} />}

        {activeTab === 'documents' && <DocumentsTab key={activePortalClientId} triggerMessage={triggerMessage} />}

        {activeTab === 'team' && <TeamManagement key={activePortalClientId} />}

        {activeTab === 'activity' && <ActivityLogTab key={activePortalClientId} triggerMessage={triggerMessage} />}

        {/* Always-mounted so its lead-detail drawer (portal) is reachable from the
            Journey tab. Hidden, not unmounted, when the user is on a different tab. */}
        <Box sx={{ display: activeTab === 'leads' ? 'block' : 'none' }}>
          <LeadsTab
            key={activePortalClientId}
            isActiveTab={activeTab === 'leads'}
            triggerMessage={triggerMessage}
            services={services}
            loadServices={loadServices}
            journeyByLeadId={journeyHook.journeyByLeadId}
            onOpenConcernDialog={handleOpenConcernDialog}
            onOpenServiceDialog={handleOpenServiceDialog}
            isAdmin={isAdmin}
            actingClientId={actingClientId}
            journeys={tutorialJourneys || journeyHook.journeys}
            journeysLoading={!tutorialJourneys && journeyHook.loading}
            openJourneyDrawer={journeyDrawer.openDrawer}
            applyJourneyUpdate={journeyHook.applyJourneyUpdate}
            leadDrawerOpenerRef={leadDrawerOpenerRef}
          />
        </Box>

        {activeTab === 'contacts' && (
          <ContactsTab key={activePortalClientId} triggerMessage={triggerMessage} isStaff={isAdmin} initialStatus={contactsInitialStatus} />
        )}

        {activeTab === 'reviews' && <ReviewsPanel key={activePortalClientId} triggerMessage={triggerMessage} />}

        {activeTab === 'journey' && (
          <JourneyTab
            key={activePortalClientId}
            journeys={tutorialJourneys || journeyHook.journeys}
            openJourneyDrawer={journeyDrawer.openDrawer}
            applyJourneyUpdate={journeyHook.applyJourneyUpdate}
            tab={journeySubTab}
            onTabChange={setJourneySubTab}
          />
        )}


        {activeTab === 'profile' && <ProfileTab key={activePortalClientId} triggerMessage={triggerMessage} refreshUser={refreshUser} />}

        {activeTab === 'notifications' && <NotificationsTab />}

        {activeTab === 'tutorials' && <TutorialsTab />}
      </Stack>

      {/* Dialogs rendered at portal level — always mounted */}
      <ConcernDialog
        open={concernDialog.open}
        onClose={handleCloseConcernDialog}
        lead={concernDialog.lead}
        journey={concernDialog.journey}
        forceNew={concernDialog.forceNew}
        activeClientId={concernDialog.activeClientId}
        concernOptions={concernOptions}
        serviceOptions={serviceOptions}
        onCreate={handleJourneyCreate}
        onUpdate={journeyHook.update}
        triggerMessage={triggerMessage}
      />

      <Dialog open={!!journeyStarted} onClose={() => setJourneyStarted(null)} maxWidth="xs" fullWidth>
        <DialogContent>
          <Stack spacing={1.5} alignItems="center" sx={{ pt: 2, pb: 1, textAlign: 'center' }}>
            <Typography variant="h5">Journey started!</Typography>
            <Typography variant="body1">
              <strong>{journeyStarted?.name}</strong>'s journey has started.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Manage their journey in the Lead Journey tab.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'center', pb: 2, gap: 1 }}>
          <Button
            variant="contained"
            onClick={() => {
              setJourneyStarted(null);
              navigate('/portal?tab=journey');
            }}
          >
            Go to Lead Journey
          </Button>
          <Button onClick={() => setJourneyStarted(null)}>Got it</Button>
        </DialogActions>
      </Dialog>

      <ServiceDialog
        open={serviceDialog.open}
        onClose={handleCloseServiceDialog}
        lead={serviceDialog.lead}
        services={services}
        servicesLoading={servicesLoading}
        onServiceAgreed={handleServiceAgreed}
        triggerMessage={triggerMessage}
      />

      {/* Shared journey drawer — opened from Leads sub-tab or the dedicated Lead Journey tab */}
      {journeyDrawer.drawerNode}

      <OnboardingModal />
    </MainCard>
  );
}
