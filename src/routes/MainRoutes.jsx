import { lazy } from 'react';
import { Navigate } from 'react-router-dom';

// project imports
import MainLayout from 'layout/MainLayout';
import Loadable from 'ui-component/Loadable';
import RequireAuth from './RequireAuth';
import SuspendedRoute from 'ui-component/SuspendedRoute';
import useAuth from 'hooks/useAuth';
import Loader from 'ui-component/Loader';
import ErrorBoundary from './ErrorBoundary';

const AdminHub = Loadable(lazy(() => import('views/admin/AdminHub')));
const ClientView = Loadable(lazy(() => import('views/admin/ClientView')));
const ProfileSettings = Loadable(lazy(() => import('views/admin/ProfileSettings')));
const ServicesManagement = Loadable(lazy(() => import('views/admin/ServicesManagement')));
const SharedDocuments = Loadable(lazy(() => import('views/admin/SharedDocuments')));
const PortalUpdatesManager = Loadable(lazy(() => import('views/admin/PortalUpdatesManager')));
const ClientPortal = Loadable(lazy(() => import('views/client/ClientPortal')));
const SelectAccount = Loadable(lazy(() => import('views/client/SelectAccount')));
const BlogEditor = Loadable(lazy(() => import('views/client/BlogEditor')));
const TaskManager = Loadable(lazy(() => import('views/tasks/TaskManager')));
const TwilioManager = Loadable(lazy(() => import('views/twilio/TwilioManager')));
const CTMFormsManager = Loadable(lazy(() => import('views/ctm-forms/CTMFormsManager')));
const AnalyticsDashboard = Loadable(lazy(() => import('views/admin/AnalyticsDashboard')));
const Operations = Loadable(lazy(() => import('views/admin/Operations')));
const ReportsList = Loadable(lazy(() => import('views/admin/AdminHub/reports/ReportsList')));
const AiTemplateList = Loadable(lazy(() => import('views/admin/AdminHub/reports/ai/AiTemplateList')));
const AiTemplateEditor = Loadable(lazy(() => import('views/admin/AdminHub/reports/ai/AiTemplateEditor')));
const ClientOnboarding = Loadable(lazy(() => import('views/pages/onboarding/ClientOnboarding')));
const SubmissionLinkRedirect = Loadable(lazy(() => import('./SubmissionLinkRedirect')));
const PortalReportPage = Loadable(lazy(() => import('views/portal/PortalReportPage')));

function AdminRoute({ children }) {
  const { user, initializing } = useAuth();
  if (initializing) return <Loader />;
  const role = user?.effective_role || user?.role;
  return <SuspendedRoute allow={role === 'superadmin' || role === 'admin' || role === 'team'}>{children}</SuspendedRoute>;
}

// Admin/superadmin only (excludes team). Use for admin pages whose backing API
// is gated by requireAdmin, so a team user can't land on a page that only errors.
function AdminOnlyRoute({ children }) {
  const { user, initializing } = useAuth();
  if (initializing) return <Loader />;
  const role = user?.effective_role || user?.role;
  return <SuspendedRoute allow={role === 'superadmin' || role === 'admin'}>{children}</SuspendedRoute>;
}

// Operations needs tighter gating than the general admin surface — SSH access,
// AI tool execution, and ad-platform credentials all live there. Team users
// would hit the page and see a permission-denied message; redirect instead.
function OperationsRoute({ children }) {
  return <AdminOnlyRoute>{children}</AdminOnlyRoute>;
}

function PortalRoute({ children }) {
  const { user, initializing, actingClientId, selectedClientAccountId } = useAuth();
  if (initializing) return <Loader />;
  const role = user?.effective_role || user?.role;
  const isAdmin = role === 'superadmin' || role === 'admin' || role === 'team';
  if (isAdmin && !actingClientId) {
    return <Navigate to="/client-hub" replace />;
  }
  // If a client hasn't completed onboarding, always direct them back into it.
  if (role === 'client' && !user?.onboarding_completed_at) {
    return <Navigate to="/onboarding" replace />;
  }
  // If a client completed onboarding but isn't activated yet, show pending screen
  if (role === 'client' && user?.onboarding_completed_at && !user?.activated_at) {
    return <Navigate to="/pending-activation" replace />;
  }
  // Multi-account clients (including group members) need to pick an account first.
  const accounts = user?.availableClientAccounts || [];
  if (role === 'client' && accounts.length > 1 && !selectedClientAccountId && !actingClientId) {
    return <Navigate to="/select-account" replace />;
  }
  return children;
}

function TaskRoute({ children }) {
  const { user, initializing } = useAuth();
  if (initializing) return <Loader />;
  const role = user?.effective_role || user?.role;
  return <SuspendedRoute allow={role === 'superadmin' || role === 'admin' || role === 'team'}>{children}</SuspendedRoute>;
}

function DefaultLanding() {
  const { user, initializing, actingClientId, selectedClientAccountId } = useAuth();
  if (initializing) return <Loader />;
  if (actingClientId) {
    return <Navigate to="/portal" replace />;
  }
  const role = user?.effective_role || user?.role;
  if (role === 'superadmin' || role === 'admin' || role === 'team') {
    return <Navigate to="/client-hub" replace />;
  }
  if (role === 'client' && !user?.onboarding_completed_at) {
    return <Navigate to="/onboarding" replace />;
  }
  // If a client completed onboarding but isn't activated yet, show pending screen
  if (role === 'client' && user?.onboarding_completed_at && !user?.activated_at) {
    return <Navigate to="/pending-activation" replace />;
  }
  // Multi-account clients (including group members) choose which account to open.
  const accounts = user?.availableClientAccounts || [];
  if (role === 'client' && accounts.length > 1 && !selectedClientAccountId) {
    return <Navigate to="/select-account" replace />;
  }
  return <Navigate to="/portal" replace />;
}

// ==============================|| MAIN ROUTING ||============================== //

const MainRoutes = {
  path: '/',
  element: (
    <RequireAuth>
      <MainLayout />
    </RequireAuth>
  ),
  errorElement: <ErrorBoundary />,
  children: [
    {
      path: '/',
      element: <DefaultLanding />
    },
    {
      path: 'client-hub',
      element: (
        <AdminRoute>
          <AdminHub />
        </AdminRoute>
      )
    },
    {
      path: 'client-view',
      element: (
        <AdminRoute>
          <ClientView />
        </AdminRoute>
      )
    },
    {
      path: 'profile',
      element: (
        <AdminRoute>
          <ProfileSettings />
        </AdminRoute>
      )
    },
    {
      path: 'portal-updates',
      element: (
        <AdminOnlyRoute>
          <PortalUpdatesManager />
        </AdminOnlyRoute>
      )
    },
    {
      path: 'shared-documents',
      element: (
        <AdminRoute>
          <SharedDocuments />
        </AdminRoute>
      )
    },
    {
      path: 'services',
      element: <ServicesManagement />
    },
    {
      // Standalone Client List retired — folded into the Contacts master list. Redirect any
      // bookmarks/deep links to Contacts filtered to Active Client. (Contacts rollout, Phase 5.)
      path: 'active-clients',
      element: <Navigate to="/portal?tab=contacts&status=active_client" replace />
    },
    {
      path: 'portal',
      element: (
        <PortalRoute>
          <ClientPortal />
        </PortalRoute>
      )
    },
    {
      path: 'portal/reports/:itemId',
      element: (
        <PortalRoute>
          <PortalReportPage />
        </PortalRoute>
      )
    },
    {
      path: 'open-submission',
      element: <SubmissionLinkRedirect />
    },
    {
      path: 'select-account',
      element: <SelectAccount />
    },
    {
      path: 'onboarding',
      element: <ClientOnboarding />
    },
    {
      path: 'blogs',
      element: <BlogEditor />
    },
    {
      path: 'tasks',
      element: (
        <TaskRoute>
          <TaskManager />
        </TaskRoute>
      )
    },
    {
      path: 'twilio',
      element: (
        <AdminRoute>
          <TwilioManager />
        </AdminRoute>
      )
    },
    // {
    //   path: 'forms',
    //   element: (
    //     <AdminRoute>
    //       <FormsManager />
    //     </AdminRoute>
    //   )
    // },
    {
      path: 'ctm-forms',
      element: (
        <AdminRoute>
          <CTMFormsManager />
        </AdminRoute>
      )
    },
    {
      path: 'analytics',
      element: (
        <AdminRoute>
          <AnalyticsDashboard />
        </AdminRoute>
      )
    },
    {
      path: 'operations',
      element: (
        <OperationsRoute>
          <Operations />
        </OperationsRoute>
      )
    },
    {
      path: 'admin/reports',
      element: (
        <AdminRoute>
          <ReportsList />
        </AdminRoute>
      )
    },
    {
      path: 'admin/reports/ai',
      element: (
        <AdminRoute>
          <AiTemplateList />
        </AdminRoute>
      )
    },
    {
      path: 'admin/reports/ai/:id',
      element: (
        <AdminRoute>
          <AiTemplateEditor />
        </AdminRoute>
      )
    }
  ]
};

export default MainRoutes;
