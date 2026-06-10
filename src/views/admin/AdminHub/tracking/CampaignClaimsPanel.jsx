import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Checkbox, FormControlLabel, IconButton, Stack, Switch, Tooltip, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

import SubCard from 'ui-component/cards/SubCard';
import DataTable from 'ui-component/extended/DataTable';
import StatusChip from 'ui-component/extended/StatusChip';
import EmptyState from 'ui-component/extended/EmptyState';
import { useToast } from 'contexts/ToastContext';
import { listMetaCampaigns, claimMetaCampaign, unclaimMetaCampaign } from 'api/tracking';

const STATUS_MAP = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  ARCHIVED: 'archived',
  DELETED: 'archived',
  IN_PROCESS: 'pending',
  WITH_ISSUES: 'failed'
};

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function formatCurrency(n) {
  if (!n) return '$0.00';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CampaignClaimsPanel({ userId, adAccountId }) {
  const toast = useToast();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [mutating, setMutating] = useState(new Set()); // campaign_ids mid-request

  const statusParam = showArchived ? 'active,paused,archived' : 'active,paused';

  const fetchCampaigns = useCallback(async () => {
    if (!userId || !adAccountId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listMetaCampaigns(userId, { status: statusParam });
      setCampaigns(data.campaigns || []);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, [userId, adAccountId, statusParam]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const handleToggle = useCallback(
    async (campaign) => {
      const alreadyMine = campaign.claimed_by?.is_current_client;
      const claimedElsewhere = campaign.claimed_by && !alreadyMine;
      if (claimedElsewhere) return; // disabled row, should not fire

      // Optimistic update
      setMutating((s) => new Set(s).add(campaign.id));
      setCampaigns((rows) =>
        rows.map((r) =>
          r.id === campaign.id
            ? {
                ...r,
                claimed_by: alreadyMine ? null : { user_id: userId, name: 'this client', is_current_client: true }
              }
            : r
        )
      );

      try {
        if (alreadyMine) {
          await unclaimMetaCampaign(userId, campaign.id);
          toast.success(`Removed "${campaign.name}"`);
        } else {
          await claimMetaCampaign(userId, { campaignId: campaign.id, campaignName: campaign.name });
          toast.success(`Claimed "${campaign.name}"`);
        }
        // No refetch needed — optimistic state is authoritative for the current
        // user's own rows. "Claimed by X" caption only renders for foreign claims.
      } catch (e) {
        const data = e.response?.data;
        if (data?.error === 'campaign_already_claimed') {
          // The campaign is claimed by someone else — reflect that authoritatively
          setCampaigns((rows) =>
            rows.map((r) =>
              r.id === campaign.id
                ? {
                    ...r,
                    claimed_by: data.claimed_by
                      ? { ...data.claimed_by, is_current_client: false }
                      : null
                  }
                : r
            )
          );
          toast.error(`Already claimed by ${data.claimed_by?.name || 'another client'}`);
        } else {
          // Revert the one row to its prior state
          setCampaigns((rows) =>
            rows.map((r) =>
              r.id === campaign.id
                ? {
                    ...r,
                    claimed_by: alreadyMine
                      ? { user_id: userId, name: 'this client', is_current_client: true }
                      : null
                  }
                : r
            )
          );
          toast.error(data?.message || e.message || 'Action failed');
        }
      } finally {
        setMutating((s) => {
          const next = new Set(s);
          next.delete(campaign.id);
          return next;
        });
      }
    },
    [userId, toast]
  );

  const columns = useMemo(
    () => [
      {
        id: 'check',
        label: '',
        width: 48,
        render: (row) => {
          const mine = row.claimed_by?.is_current_client;
          const elsewhere = row.claimed_by && !mine;
          return (
            <Checkbox
              checked={!!mine}
              disabled={elsewhere || mutating.has(row.id)}
              onChange={() => handleToggle(row)}
              inputProps={{ 'aria-label': `Claim ${row.name}` }}
            />
          );
        }
      },
      {
        id: 'name',
        label: 'Campaign',
        sortable: true,
        sortValue: (row) => row.name,
        render: (row) => {
          const elsewhere = row.claimed_by && !row.claimed_by.is_current_client;
          return (
            <Box>
              <Typography variant="body2" sx={{ color: elsewhere ? 'text.disabled' : 'text.primary' }}>
                {row.name}
              </Typography>
              {elsewhere && (
                <Typography variant="caption" color="text.secondary">
                  Claimed by {row.claimed_by.name}
                </Typography>
              )}
            </Box>
          );
        }
      },
      {
        id: 'status',
        label: 'Status',
        sortable: true,
        sortValue: (row) => row.status,
        render: (row) => <StatusChip status={STATUS_MAP[row.status] || 'inactive'} label={row.status} size="small" />
      },
      {
        id: 'start_time',
        label: 'Start',
        sortable: true,
        sortValue: (row) => row.start_time || '',
        render: (row) => formatDate(row.start_time)
      },
      {
        id: 'spend',
        label: '30d spend',
        align: 'right',
        sortable: true,
        sortValue: (row) => row.spend_last_30d || 0,
        render: (row) => formatCurrency(row.spend_last_30d)
      }
    ],
    [mutating, handleToggle]
  );

  const claimedCount = campaigns.filter((c) => c.claimed_by?.is_current_client).length;

  if (error) {
    return (
      <SubCard title="Campaigns for this client">
        <EmptyState
          title="Couldn't load campaigns"
          message={error}
          action={
            <IconButton onClick={fetchCampaigns} size="small">
              <RefreshIcon />
            </IconButton>
          }
        />
      </SubCard>
    );
  }

  return (
    <SubCard title="Campaigns for this client">
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          Check the campaigns that belong to this practice. Unchecked campaigns won&apos;t appear in this client&apos;s
          analytics or in any group reports that include them.
        </Typography>

        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <FormControlLabel
            control={<Switch checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} size="small" />}
            label="Show archived"
          />
          <Tooltip title="Refresh from Meta">
            <IconButton onClick={fetchCampaigns} size="small" disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Stack>

        <DataTable
          columns={columns}
          rows={campaigns}
          rowKey="id"
          searchable
          searchFields={['name']}
          paginated
          pageSize={10}
          loading={loading}
          emptyTitle="No campaigns found"
          emptyMessage={
            showArchived
              ? 'This ad account has no campaigns.'
              : "No active or paused campaigns. Toggle 'Show archived' to see older campaigns."
          }
          size="small"
        />

        <Typography variant="caption" color="text.secondary">
          {claimedCount} of {campaigns.length} campaigns claimed for this client
        </Typography>
      </Stack>
    </SubCard>
  );
}
