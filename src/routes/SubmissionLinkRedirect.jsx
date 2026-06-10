import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import Loader from 'ui-component/Loader';
import useAuth from 'hooks/useAuth';

function buildPortalLeadsPath({ leadId }) {
  const params = new URLSearchParams({ tab: 'leads' });
  if (leadId) params.set('lead', leadId);
  return `/portal?${params.toString()}`;
}

export default function SubmissionLinkRedirect() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, initializing, setActingClient, setClientAccount } = useAuth();
  const handledRef = useRef(false);

  useEffect(() => {
    if (initializing || handledRef.current) return;
    handledRef.current = true;

    const role = user?.effective_role || user?.role;
    const clientId = searchParams.get('clientId');
    const leadId = searchParams.get('lead');
    const destination = buildPortalLeadsPath({ leadId });

    if (role === 'superadmin' || role === 'admin' || role === 'team') {
      if (clientId) {
        setActingClient(clientId, 'Client');
        navigate(destination, { replace: true });
        return;
      }
      navigate('/client-hub', { replace: true });
      return;
    }

    if (role === 'client' && clientId) {
      setClientAccount(clientId);
    }

    navigate(destination, { replace: true });
  }, [initializing, navigate, searchParams, setActingClient, setClientAccount, user]);

  return <Loader />;
}
