import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';

import EmptyState from 'ui-component/extended/EmptyState';
import { JOURNEY_STAGES, stageLabel, STAGE_COLORS } from './journeyHelpers';

// A journey is "live" on the board unless it has reached a terminal state. We
// match on the terminal set rather than requiring status === 'active' because
// the backend writes two interchangeable non-terminal values for the same
// state: the new-journey INSERT path stores 'active' while the upsert/UPDATE
// path stores the canonical 'in_progress' (hub.js). Filtering on `=== 'active'`
// silently dropped any journey that went through the upsert path. This mirrors
// the contact "in_journey" derivation (hub.js) and normalizeJourneyStatus.
const TERMINAL_JOURNEY_STATUSES = new Set(['active_client', 'won', 'lost', 'archived']);

export default function PipelineBoard({ journeys, onOpen, searching = false }) {
  const active = (Array.isArray(journeys) ? journeys : []).filter((j) => !TERMINAL_JOURNEY_STATUSES.has(j.status));
  const byStage = (stage) => active.filter((j) => j.stage === stage);

  if (active.length === 0) {
    return searching ? (
      <EmptyState title="No journeys match your search" message="Try a different name, phone number, or email." />
    ) : (
      <EmptyState title="No active journeys yet" message="Start a journey from the New Leads tab when a lead is ready for follow-up." />
    );
  }

  return (
    <Box data-tutorial="journey-pipeline" sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 1 }}>
      {JOURNEY_STAGES.map((stage) => (
        <Paper key={stage} variant="outlined" sx={{ minWidth: 260, flex: '0 0 260px', p: 1, bgcolor: 'grey.50' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" sx={{ color: STAGE_COLORS[stage] }}>
              {stageLabel(stage)}
            </Typography>
            <Chip size="small" label={byStage(stage).length} />
          </Stack>
          <Stack spacing={1}>
            {byStage(stage).map((j) => (
              <Paper
                key={j.id}
                sx={{ p: 1, cursor: 'pointer' }}
                role="button"
                tabIndex={0}
                onClick={() => onOpen?.(j)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen?.(j);
                  }
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {j.client_name || 'Unknown'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {j.client_phone || j.client_email || ''}
                  </Typography>
                </Box>
                {j.pending_send && <Chip size="small" sx={{ mt: 0.5 }} label="📅 scheduled" color="warning" variant="outlined" />}
              </Paper>
            ))}
          </Stack>
        </Paper>
      ))}
    </Box>
  );
}
