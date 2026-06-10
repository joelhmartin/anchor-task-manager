import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { fetchActiveUpdates, dismissUpdate } from 'api/portalUpdates';
import { useToast } from 'contexts/ToastContext';

// A link that points back into this same app (e.g. a tutorial deep-link like
// /portal?tab=leads&tutorial=lead-journeys) should navigate in-app in the same
// tab so the destination — including a ?tutorial= launch — works without a
// jarring new tab. Returns the in-app path (pathname+search+hash) when the URL
// is same-origin, or null when it's external (keep the new-tab behavior).
function sameOriginPath(linkUrl) {
  try {
    const url = new URL(linkUrl, window.location.origin);
    if (url.origin === window.location.origin) return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    /* malformed URL — treat as external */
  }
  return null;
}

// Colored chip per update type. Values match the server's VALID_TYPES.
const TYPE_CHIP = {
  feature: { label: 'New Feature', color: 'primary' },
  improvement: { label: 'Improvement', color: 'success' },
  notice: { label: 'Notice', color: 'info' },
  maintenance: { label: 'Maintenance', color: 'warning' }
};

/**
 * Dismissible banner of agency announcements, shown at the top of the client
 * portal. Self-fetches published updates the current user hasn't dismissed.
 * Dismiss is per user and permanent.
 */
export default function UpdatesBanner() {
  const [updates, setUpdates] = useState([]);
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    fetchActiveUpdates()
      .then((rows) => {
        if (active) setUpdates(rows);
      })
      .catch(() => {
        /* non-blocking: a failed updates fetch must never break the portal */
      });
    return () => {
      active = false;
    };
  }, []);

  const handleDismiss = async (id) => {
    const dismissed = updates.find((u) => u.id === id);
    setUpdates((current) => current.filter((u) => u.id !== id)); // optimistic
    try {
      await dismissUpdate(id);
      toast.success('Update dismissed');
    } catch {
      // Re-insert only the failed item via a functional update — restoring a
      // whole snapshot would clobber other dismissals that resolved meanwhile.
      // Keep the newest-first order.
      if (dismissed) {
        setUpdates((current) =>
          current.some((u) => u.id === id)
            ? current
            : [...current, dismissed].sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0))
        );
      }
      toast.error("Couldn't dismiss that update — please try again.");
    }
  };

  if (!updates.length) return null;

  return (
    <Stack spacing={1}>
      {updates.map((update) => {
        const chip = TYPE_CHIP[update.type] || TYPE_CHIP.notice;
        return (
          <Alert
            key={update.id}
            severity="info"
            icon={false}
            onClose={() => handleDismiss(update.id)}
            sx={{
              // Top-align everything so the dismiss (×) sits in the top-right
              // instead of vertically centered against tall, multi-line updates.
              alignItems: 'flex-start',
              '& .MuiAlert-message': { width: '100%' },
              '& .MuiAlert-action': { alignItems: 'flex-start', pt: 0.25, mr: 0 }
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: update.body || update.link_url ? 0.75 : 0 }}>
              <Chip
                size="small"
                color={chip.color}
                label={chip.label}
                // Solid colored fill + white text so the type (e.g. "New Feature" → primary)
                // stands out against the light Alert background.
                sx={{
                  bgcolor: `${chip.color}.main`,
                  color: 'common.white',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  height: 24
                }}
              />
              <Typography variant="subtitle1" sx={{ fontWeight: 700, fontSize: '1.15rem' }}>
                {update.title}
              </Typography>
            </Stack>
            {update.body && (
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {update.body}
              </Typography>
            )}
            {update.link_url &&
              (() => {
                const inApp = sameOriginPath(update.link_url);
                const isTour = inApp && /[?&]tutorial=/.test(inApp);
                return (
                  <Link
                    href={update.link_url}
                    {...(inApp
                      ? {
                          onClick: (e) => {
                            // Plain left-click → in-app navigation. Let modified
                            // clicks (cmd/ctrl/middle) fall through to open a tab.
                            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
                            e.preventDefault();
                            navigate(inApp);
                          }
                        }
                      : { target: '_blank', rel: 'noopener noreferrer' })}
                    variant="body2"
                    sx={{ mt: 0.5, display: 'inline-block', fontWeight: 600 }}
                  >
                    {isTour ? 'Start the tour →' : 'Learn more →'}
                  </Link>
                );
              })()}
          </Alert>
        );
      })}
    </Stack>
  );
}
