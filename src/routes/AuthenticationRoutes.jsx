import { lazy } from 'react';

// project imports
import Loadable from 'ui-component/Loadable';
import MinimalLayout from 'layout/MinimalLayout';
import ErrorBoundary from './ErrorBoundary';

const LoginPage = Loadable(lazy(() => import('views/auth/Login')));

// ==============================|| AUTHENTICATION ROUTING ||============================== //
// Login/MFA/password live in the main app (SSO). This route only hosts the
// local login entry point (dev shim + "continue in main app" handoff).

const AuthenticationRoutes = {
  path: '/',
  element: <MinimalLayout />,
  errorElement: <ErrorBoundary />,
  children: [
    {
      path: '/pages/login',
      element: <LoginPage />
    }
  ]
};

export default AuthenticationRoutes;
