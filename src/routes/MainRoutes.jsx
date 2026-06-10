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

const TaskManager = Loadable(lazy(() => import('views/tasks/TaskManager')));

// Task Manager is a staff tool. Login/role assignment happen in the main app;
// here we only gate on the staff roles the shared JWT carries.
function TaskRoute({ children }) {
  const { user, initializing } = useAuth();
  if (initializing) return <Loader />;
  const role = user?.effective_role || user?.role;
  return <SuspendedRoute allow={role === 'superadmin' || role === 'admin' || role === 'team'}>{children}</SuspendedRoute>;
}

function DefaultLanding() {
  const { initializing } = useAuth();
  if (initializing) return <Loader />;
  return <Navigate to="/tasks" replace />;
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
      path: 'tasks',
      element: (
        <TaskRoute>
          <TaskManager />
        </TaskRoute>
      )
    }
  ]
};

export default MainRoutes;
