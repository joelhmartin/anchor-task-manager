import { lazy } from 'react';

// project imports
import Loadable from 'ui-component/Loadable';
import MinimalLayout from 'layout/MinimalLayout';
import ErrorBoundary from './ErrorBoundary';

// maintenance routing
const LoginPage = Loadable(lazy(() => import('views/pages/authentication/Login')));
const ForgotPasswordPage = Loadable(lazy(() => import('views/pages/authentication/ForgotPassword')));
const AcceptClientInvitePage = Loadable(lazy(() => import('views/pages/authentication/AcceptClientInvite')));
const PendingActivationPage = Loadable(lazy(() => import('views/pages/authentication/PendingActivation')));
const ClientOnboardingPage = Loadable(lazy(() => import('views/pages/onboarding/ClientOnboarding')));
const OnboardingPreviewPage = Loadable(lazy(() => import('views/pages/onboarding/OnboardingPreview')));
const OnboardingThankYouPage = Loadable(lazy(() => import('views/pages/onboarding/OnboardingThankYou')));
const PrivacyPolicyPage = Loadable(lazy(() => import('views/pages/legal/PrivacyPolicy')));

// ==============================|| AUTHENTICATION ROUTING ||============================== //

const AuthenticationRoutes = {
  path: '/',
  element: <MinimalLayout />,
  errorElement: <ErrorBoundary />,
  children: [
    {
      path: '/pages/login',
      element: <LoginPage />
    },
    {
      path: '/pages/forgot-password',
      element: <ForgotPasswordPage />
    },
    {
      path: '/accept-invite/:token',
      element: <AcceptClientInvitePage />
    },
    {
      path: '/onboarding/preview',
      element: <OnboardingPreviewPage />
    },
    {
      path: '/onboarding/:token',
      element: <ClientOnboardingPage />
    },
    {
      path: '/onboarding/thank-you',
      element: <OnboardingThankYouPage />
    },
    {
      path: '/privacy-policy',
      element: <PrivacyPolicyPage />
    },
    {
      path: '/pending-activation',
      element: <PendingActivationPage />
    }
  ]
};

export default AuthenticationRoutes;
