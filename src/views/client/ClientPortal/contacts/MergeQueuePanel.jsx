import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import SubCard from 'ui-component/cards/SubCard';
import LoadingButton from 'ui-component/extended/LoadingButton';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import EmptyState from 'ui-component/extended/EmptyState';
import { useToast } from 'contexts/ToastContext';
import { fetchMergeCandidates, mergeContacts, dismissMergeCandidate } from 'api/contacts';

const sideLabel = (name, phone, email) => name || phone || email || 'Unknown contact';

export default function MergeQueuePanel({ onResolved }) {
  const toast = useToast();
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [confirm, setConfirm] = useState({ open: false, candidate: null });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchMergeCandidates('pending');
      setCandidates(Array.isArray(list) ? list : []);
    } catch (err) {
      toast.error(err?.message || 'Unable to load merge candidates');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleMerge = useCallback(async () => {
    const c = confirm.candidate;
    if (!c) return;
    setBusyId(c.id);
    try {
      await mergeContacts(c.contact_id_keep, c.contact_id_other, c.id);
      setCandidates((prev) => prev.filter((x) => x.id !== c.id));
      setConfirm({ open: false, candidate: null });
      toast.success('Contacts merged');
      onResolved?.();
    } catch (err) {
      toast.error(err?.message || 'Merge failed');
    } finally {
      setBusyId(null);
    }
  }, [confirm.candidate, toast, onResolved]);

  const handleDismiss = useCallback(
    async (c) => {
      setBusyId(c.id);
      try {
        await dismissMergeCandidate(c.id);
        setCandidates((prev) => prev.filter((x) => x.id !== c.id));
        toast.success('Suggestion dismissed');
        onResolved?.();
      } catch (err) {
        toast.error(err?.message || 'Unable to dismiss');
      } finally {
        setBusyId(null);
      }
    },
    [toast, onResolved]
  );

  return (
    <Box sx={{ p: 2.5, width: { xs: '100%', sm: 520 } }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <MergeTypeIcon color="action" />
        <Typography variant="h4">Review possible duplicates</Typography>
      </Stack>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {!loading && !candidates.length ? (
        <EmptyState
          icon={<MergeTypeIcon />}
          title="No pending merges"
          message="When two contacts look like the same person, they'll show up here for review."
        />
      ) : (
        <Stack spacing={2}>
          {candidates.map((c) => (
            <SubCard key={c.id} contentSX={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={2} divider={<Divider orientation="vertical" flexItem />}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary">
                      Keep
                    </Typography>
                    <Typography variant="subtitle2" noWrap>
                      {sideLabel(c.keep_name, c.keep_phone, c.keep_email)}
                    </Typography>
                    {c.keep_phone && <Typography variant="body2" color="text.secondary" noWrap>{c.keep_phone}</Typography>}
                    {c.keep_email && <Typography variant="body2" color="text.secondary" noWrap>{c.keep_email}</Typography>}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary">
                      Merge in
                    </Typography>
                    <Typography variant="subtitle2" noWrap>
                      {sideLabel(c.other_name, c.other_phone, c.other_email)}
                    </Typography>
                    {c.other_phone && <Typography variant="body2" color="text.secondary" noWrap>{c.other_phone}</Typography>}
                    {c.other_email && <Typography variant="body2" color="text.secondary" noWrap>{c.other_email}</Typography>}
                  </Box>
                </Stack>
                {c.reason && (
                  <Typography variant="caption" color="text.secondary">
                    Matched on: {String(c.reason).replace(/_/g, ' ')}
                  </Typography>
                )}
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <LoadingButton
                    size="small"
                    variant="outlined"
                    color="inherit"
                    loading={busyId === c.id}
                    onClick={() => handleDismiss(c)}
                  >
                    Dismiss
                  </LoadingButton>
                  <LoadingButton
                    size="small"
                    variant="contained"
                    startIcon={<MergeTypeIcon />}
                    loading={busyId === c.id}
                    onClick={() => setConfirm({ open: true, candidate: c })}
                  >
                    Merge
                  </LoadingButton>
                </Stack>
              </Stack>
            </SubCard>
          ))}
        </Stack>
      )}

      <ConfirmDialog
        open={confirm.open}
        onClose={() => setConfirm({ open: false, candidate: null })}
        onConfirm={handleMerge}
        title="Merge these contacts?"
        message="Activity, journeys, tags, and identifiers from the second contact move into the first. This can't be auto-undone (use Split to separate later)."
        confirmLabel="Merge"
        cancelLabel="Cancel"
        loading={!!busyId}
        loadingLabel="Merging…"
      />
    </Box>
  );
}
