/**
 * ReviewsPanel - Google Reviews Management Component
 * 
 * Features:
 * - View all reviews with filtering and sorting
 * - AI-assisted response drafting
 * - Manual review replies
 * - Review request workflow
 * - Priority and flagging management
 * - Statistics dashboard
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import FormDialog from 'ui-component/extended/FormDialog';
import LoadingButton from 'ui-component/extended/LoadingButton';
import SelectField from 'ui-component/extended/SelectField';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Rating from '@mui/material/Rating';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import EmailIcon from '@mui/icons-material/Email';
import FlagIcon from '@mui/icons-material/Flag';
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined';
import FilterListIcon from '@mui/icons-material/FilterList';
import LinkIcon from '@mui/icons-material/Link';
import PersonIcon from '@mui/icons-material/Person';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReplyIcon from '@mui/icons-material/Reply';
import SearchIcon from '@mui/icons-material/Search';
import SendIcon from '@mui/icons-material/Send';
import SmsIcon from '@mui/icons-material/Sms';
import StarIcon from '@mui/icons-material/Star';
import SyncIcon from '@mui/icons-material/Sync';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

import {
  fetchReviews,
  fetchReviewStats,
  fetchReview,
  syncReviews,
  toggleReviewFlag,
  updateReviewPriority,
  updateReviewNotes,
  generateReviewResponse,
  sendReviewResponse,
  updateDraft,
  discardDraft,
  sendDraft,
  createReviewRequest,
  fetchReviewRequests,
  fetchReviewLocations,
  updateReviewSettings,
  REVIEW_PRIORITIES,
  SENTIMENT_LABELS,
  RESPONSE_TONES,
  DELIVERY_METHODS,
  getRatingColor,
  getPriorityConfig,
  getSentimentConfig
} from 'api/reviews';

// ============================================================================
// Helper Components
// ============================================================================

function StatCard({ title, value, subtitle, icon, color = 'primary', trend = null }) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ py: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {title}
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 700, color: `${color}.main`, my: 0.5 }}>
              {value}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
          <Box sx={{ p: 1, borderRadius: 2, bgcolor: `${color}.lighter` }}>
            {icon}
          </Box>
        </Stack>
        {trend !== null && (
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 1 }}>
            {trend >= 0 ? (
              <TrendingUpIcon sx={{ fontSize: 16, color: 'success.main' }} />
            ) : (
              <TrendingDownIcon sx={{ fontSize: 16, color: 'error.main' }} />
            )}
            <Typography variant="caption" color={trend >= 0 ? 'success.main' : 'error.main'}>
              {trend >= 0 ? '+' : ''}{trend}% vs last period
            </Typography>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function RatingStars({ rating, size = 'medium' }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <Rating value={rating} readOnly size={size} />
      <Typography variant="body2" color="text.secondary">
        ({rating})
      </Typography>
    </Stack>
  );
}

function SentimentBadge({ sentiment }) {
  const config = getSentimentConfig(sentiment);
  if (!sentiment) return null;
  
  return (
    <Chip
      label={config.label}
      size="small"
      sx={{
        bgcolor: `${config.color}20`,
        color: config.color,
        fontWeight: 500,
        fontSize: '0.7rem'
      }}
    />
  );
}

function PriorityBadge({ priority }) {
  const config = getPriorityConfig(priority);
  
  return (
    <Chip
      label={config.label}
      size="small"
      sx={{
        bgcolor: `${config.color}20`,
        color: config.color,
        fontWeight: 500,
        fontSize: '0.7rem'
      }}
    />
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function ReviewsPanel({ triggerMessage }) {
  const defaultSettings = useMemo(
    () => ({
      auto_sync_enabled: true,
      sync_interval_minutes: 60,
      auto_flag_threshold: 3,
      auto_flag_keywords: [],
      notify_new_reviews: true,
      notify_negative_reviews: true,
      negative_review_threshold: 3,
      notification_emails: [],
      default_response_tone: 'professional',
      include_business_name_in_response: true,
      include_reviewer_name_in_response: true,
      response_signature: '',
      ai_drafting_enabled: true,
      ai_auto_draft_positive: false,
      ai_auto_draft_negative: false
    }),
    []
  );

  // State
  const [reviews, setReviews] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [locations, setLocations] = useState([]);
  const [settings, setSettings] = useState(defaultSettings);
  
  // Filters
  const [filters, setFilters] = useState({
    search: '',
    rating: '',
    hasResponse: '',
    isFlagged: '',
    priority: '',
    sentimentLabel: '',
    locationId: '',
    sortBy: 'review_created_at',
    sortOrder: 'DESC'
  });
  const [filtersOpen, setFiltersOpen] = useState(false);

  // View mode
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'cards'
  const [activeSubTab, setActiveSubTab] = useState(0); // 0=Reviews, 1=Requests, 2=Settings

  // Selected review / drawer
  const [selectedReview, setSelectedReview] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState(0);

  // Response generation
  const [generating, setGenerating] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [currentDraft, setCurrentDraft] = useState(null);
  const [responseTone, setResponseTone] = useState('professional');
  const [sending, setSending] = useState(false);

  // Review request dialog
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [requestForm, setRequestForm] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    deliveryMethod: 'email',
    customMessage: '',
    locationId: ''
  });
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requests, setRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(false);

  // Notes editing
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesText, setNotesText] = useState('');

  // ============================================================================
  // Data Loading
  // ============================================================================

  const loadReviews = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = {
        page,
        limit: pagination.limit,
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder
      };

      if (filters.search) params.search = filters.search;
      if (filters.rating) params.rating = parseInt(filters.rating, 10);
      if (filters.hasResponse !== '') params.hasResponse = filters.hasResponse;
      if (filters.isFlagged !== '') params.isFlagged = filters.isFlagged;
      if (filters.priority) params.priority = filters.priority;
      if (filters.sentimentLabel) params.sentimentLabel = filters.sentimentLabel;
      if (filters.locationId) params.locationId = filters.locationId;

      const result = await fetchReviews(params);
      setReviews(result.reviews);
      setPagination(result.pagination);
    } catch (error) {
      triggerMessage?.('error', error.message || 'Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }, [filters, pagination.limit, triggerMessage]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const result = await fetchReviewStats(30);
      setStats(result);
    } catch (error) {
      console.error('Failed to load stats:', error);
      triggerMessage?.('error', 'Failed to load review statistics');
    } finally {
      setStatsLoading(false);
    }
  }, [triggerMessage]);

  const loadLocations = useCallback(async () => {
    try {
      const result = await fetchReviewLocations();
      setLocations(result);
    } catch (error) {
      console.error('Failed to load locations:', error);
      triggerMessage?.('error', 'Failed to load review locations');
    }
  }, [triggerMessage]);

  const loadRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const result = await fetchReviewRequests({ limit: 50 });
      setRequests(result.requests);
    } catch (error) {
      console.error('Failed to load requests:', error);
      triggerMessage?.('error', 'Failed to load review requests');
    } finally {
      setRequestsLoading(false);
    }
  }, [triggerMessage]);

  // Initial load
  useEffect(() => {
    loadReviews();
    loadStats();
    loadLocations();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload when filters change
  useEffect(() => {
    loadReviews(1);
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load requests when switching to requests tab
  useEffect(() => {
    if (activeSubTab === 1 && requests.length === 0) {
      loadRequests();
    }
  }, [activeSubTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================================
  // Actions
  // ============================================================================

  const handleSync = async (forceFullSync = false) => {
    setSyncing(true);
    try {
      const result = await syncReviews(forceFullSync);
      triggerMessage?.('success', `Synced ${result.totalSynced} reviews (${result.newReviews} new)`);
      loadReviews();
      loadStats();
    } catch (error) {
      triggerMessage?.('error', error.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleOpenDetail = async (review) => {
    setSelectedReview(review);
    setDraftText(review.response_text || '');
    setCurrentDraft(null);
    setNotesText(review.internal_notes || '');
    setDrawerTab(0);
    setDrawerOpen(true);

    // Load full details if needed
    if (!review.drafts) {
      setDetailLoading(true);
      try {
        const fullReview = await fetchReview(review.id);
        setSelectedReview(fullReview);
        if (fullReview.drafts?.length > 0) {
          const latestDraft = fullReview.drafts.find(d => d.status === 'draft');
          if (latestDraft) {
            setDraftText(latestDraft.draft_text);
            setCurrentDraft(latestDraft);
          }
        }
      } catch (error) {
        console.error('Failed to load review details:', error);
        triggerMessage?.('error', 'Failed to load review details');
      } finally {
        setDetailLoading(false);
      }
    }
  };

  const handleCloseDrawer = () => {
    setDrawerOpen(false);
    setSelectedReview(null);
    setDraftText('');
    setCurrentDraft(null);
  };

  const handleToggleFlag = async (review, flagged) => {
    try {
      const updated = await toggleReviewFlag(review.id, flagged);
      setReviews(prev => prev.map(r => r.id === review.id ? { ...r, ...updated } : r));
      if (selectedReview?.id === review.id) {
        setSelectedReview(prev => ({ ...prev, ...updated }));
      }
      triggerMessage?.('success', flagged ? 'Review flagged' : 'Flag removed');
    } catch (error) {
      triggerMessage?.('error', 'Failed to update flag');
    }
  };

  const handleUpdatePriority = async (review, priority) => {
    try {
      const updated = await updateReviewPriority(review.id, priority);
      setReviews(prev => prev.map(r => r.id === review.id ? { ...r, ...updated } : r));
      if (selectedReview?.id === review.id) {
        setSelectedReview(prev => ({ ...prev, ...updated }));
      }
    } catch (error) {
      triggerMessage?.('error', 'Failed to update priority');
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedReview) return;
    try {
      const updated = await updateReviewNotes(selectedReview.id, notesText);
      setSelectedReview(prev => ({ ...prev, ...updated }));
      setEditingNotes(false);
      triggerMessage?.('success', 'Notes saved');
    } catch (error) {
      triggerMessage?.('error', 'Failed to save notes');
    }
  };

  const handleGenerateResponse = async () => {
    if (!selectedReview) return;
    setGenerating(true);
    try {
      const result = await generateReviewResponse(selectedReview.id, {
        tone: responseTone,
        includeBusinessName: true,
        includeReviewerName: true
      });
      setDraftText(result.draft.draft_text);
      setCurrentDraft(result.draft);
      triggerMessage?.('success', 'Response generated');
    } catch (error) {
      triggerMessage?.('error', error.message || 'Failed to generate response');
    } finally {
      setGenerating(false);
    }
  };

  const handleSendResponse = async () => {
    if (!selectedReview || !draftText.trim()) return;
    setSending(true);
    try {
      await sendReviewResponse(selectedReview.id, draftText.trim());
      
      // Update local state
      setReviews(prev => prev.map(r => 
        r.id === selectedReview.id 
          ? { ...r, has_response: true, response_text: draftText.trim() } 
          : r
      ));
      setSelectedReview(prev => ({ ...prev, has_response: true, response_text: draftText.trim() }));
      
      triggerMessage?.('success', 'Response sent successfully!');
      handleCloseDrawer();
      loadStats();
    } catch (error) {
      triggerMessage?.('error', error.message || 'Failed to send response');
    } finally {
      setSending(false);
    }
  };

  const handleDiscardDraft = async () => {
    if (!currentDraft) {
      setDraftText('');
      return;
    }
    try {
      await discardDraft(currentDraft.id);
      setDraftText('');
      setCurrentDraft(null);
      triggerMessage?.('success', 'Draft discarded');
    } catch (error) {
      triggerMessage?.('error', 'Failed to discard draft');
    }
  };

  const handleCopyLink = (link) => {
    navigator.clipboard.writeText(link);
    triggerMessage?.('success', 'Link copied to clipboard');
  };

  const handleCreateRequest = async () => {
    setRequestSubmitting(true);
    try {
      const request = await createReviewRequest(requestForm);
      setRequests(prev => [request, ...prev]);
      setRequestDialogOpen(false);
      setRequestForm({
        customerName: '',
        customerEmail: '',
        customerPhone: '',
        deliveryMethod: 'email',
        customMessage: '',
        locationId: ''
      });
      triggerMessage?.('success', 'Review request created');
    } catch (error) {
      triggerMessage?.('error', error.message || 'Failed to create request');
    } finally {
      setRequestSubmitting(false);
    }
  };

  const handleSaveSettings = async (updates) => {
    try {
      const updated = await updateReviewSettings(updates);
      setSettings(updated);
      triggerMessage?.('success', 'Settings saved');
    } catch (error) {
      triggerMessage?.('error', 'Failed to save settings');
    }
  };

  // ============================================================================
  // Render Helpers
  // ============================================================================

  const renderStatsCards = () => {
    if (statsLoading) {
      return (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {[1, 2, 3, 4].map(i => (
            <Grid item xs={6} md={3} key={i}>
              <Skeleton variant="rounded" height={120} />
            </Grid>
          ))}
        </Grid>
      );
    }

    if (!stats) return null;

    return (
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={3}>
          <StatCard
            title="Total Reviews"
            value={stats.total_reviews || 0}
            subtitle={`${stats.period_reviews || 0} in last 30 days`}
            icon={<StarIcon color="primary" />}
            color="primary"
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard
            title="Average Rating"
            value={stats.average_rating ? parseFloat(stats.average_rating).toFixed(1) : '-'}
            subtitle={stats.period_average ? `${parseFloat(stats.period_average).toFixed(1)} this period` : ''}
            icon={<TrendingUpIcon color="success" />}
            color="success"
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard
            title="Pending Responses"
            value={stats.pending_responses || 0}
            subtitle="Need attention"
            icon={<ReplyIcon color="warning" />}
            color="warning"
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard
            title="Flagged Reviews"
            value={stats.flagged_count || 0}
            subtitle="Requires review"
            icon={<FlagIcon color="error" />}
            color="error"
          />
        </Grid>
      </Grid>
    );
  };

  const renderFilters = () => (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Grid container spacing={2} alignItems="center">
        <Grid item xs={12} md={4}>
          <TextField
            fullWidth
            size="small"
            placeholder="Search reviews..."
            value={filters.search}
            onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              )
            }}
          />
        </Grid>
        <Grid item xs={6} md={2}>
          <SelectField label="Rating" value={filters.rating} onChange={(e) => setFilters(prev => ({ ...prev, rating: e.target.value }))} size="small">
            <MenuItem value="">All</MenuItem>
            {[5, 4, 3, 2, 1].map(r => (
              <MenuItem key={r} value={r}>{r} Star{r !== 1 ? 's' : ''}</MenuItem>
            ))}
          </SelectField>
        </Grid>
        <Grid item xs={6} md={2}>
          <SelectField label="Response" value={filters.hasResponse} onChange={(e) => setFilters(prev => ({ ...prev, hasResponse: e.target.value }))} size="small"
            options={[{ value: '', label: 'All' }, { value: 'false', label: 'Unreplied' }, { value: 'true', label: 'Replied' }]}
          />
        </Grid>
        <Grid item xs={6} md={2}>
          <SelectField label="Priority" value={filters.priority} onChange={(e) => setFilters(prev => ({ ...prev, priority: e.target.value }))} size="small">
            <MenuItem value="">All</MenuItem>
            {REVIEW_PRIORITIES.map(p => (
              <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>
            ))}
          </SelectField>
        </Grid>
        <Grid item xs={6} md={2}>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              size="small"
              onClick={() => setFilters({
                search: '',
                rating: '',
                hasResponse: '',
                isFlagged: '',
                priority: '',
                sentimentLabel: '',
                locationId: '',
                sortBy: 'review_created_at',
                sortOrder: 'DESC'
              })}
            >
              Clear
            </Button>
          </Stack>
        </Grid>
      </Grid>
    </Paper>
  );

  const renderReviewsTable = () => (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow sx={{ bgcolor: 'grey.50' }}>
            <TableCell sx={{ fontWeight: 600 }}>Reviewer</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Rating</TableCell>
            <TableCell sx={{ fontWeight: 600, width: '40%' }}>Review</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {loading ? (
            [...Array(5)].map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton width={120} /></TableCell>
                <TableCell><Skeleton width={80} /></TableCell>
                <TableCell><Skeleton /></TableCell>
                <TableCell><Skeleton width={80} /></TableCell>
                <TableCell><Skeleton width={60} /></TableCell>
                <TableCell><Skeleton width={80} /></TableCell>
              </TableRow>
            ))
          ) : reviews.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                <Typography color="text.secondary">
                  No reviews found. {locations.length === 0 ? 'Connect your Google Business Profile to get started.' : 'Try adjusting your filters.'}
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            reviews.map((review) => (
              <TableRow 
                key={review.id} 
                hover 
                sx={{ 
                  cursor: 'pointer',
                  bgcolor: review.is_flagged ? 'error.lighter' : 'inherit',
                  '&:hover': { bgcolor: review.is_flagged ? 'error.light' : 'action.hover' }
                }}
                onClick={() => handleOpenDetail(review)}
              >
                <TableCell>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Avatar 
                      src={review.reviewer_photo_url} 
                      sx={{ width: 32, height: 32 }}
                    >
                      <PersonIcon />
                    </Avatar>
                    <Box>
                      <Typography variant="body2" fontWeight={500}>
                        {review.reviewer_name}
                      </Typography>
                      {review.location_name && (
                        <Typography variant="caption" color="text.secondary">
                          {review.location_name}
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                </TableCell>
                <TableCell>
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <StarIcon sx={{ color: getRatingColor(review.rating), fontSize: 18 }} />
                    <Typography variant="body2" fontWeight={500}>
                      {review.rating}
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell>
                  <Typography 
                    variant="body2" 
                    sx={{ 
                      overflow: 'hidden', 
                      textOverflow: 'ellipsis', 
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical'
                    }}
                  >
                    {review.review_text || <em style={{ color: '#9e9e9e' }}>No text</em>}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="caption">
                    {new Date(review.review_created_at).toLocaleDateString()}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    {review.has_response ? (
                      <Chip label="Replied" size="small" color="success" sx={{ fontSize: '0.7rem' }} />
                    ) : (
                      <Chip label="Pending" size="small" color="warning" sx={{ fontSize: '0.7rem' }} />
                    )}
                    {review.is_flagged && (
                      <Chip 
                        icon={<FlagIcon sx={{ fontSize: 14 }} />} 
                        label="Flagged" 
                        size="small" 
                        color="error" 
                        sx={{ fontSize: '0.7rem' }} 
                      />
                    )}
                    {review.priority === 'urgent' && (
                      <Chip 
                        icon={<PriorityHighIcon sx={{ fontSize: 14 }} />} 
                        label="Urgent" 
                        size="small" 
                        color="error" 
                        variant="outlined"
                        sx={{ fontSize: '0.7rem' }} 
                      />
                    )}
                  </Stack>
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <Tooltip title={review.is_flagged ? 'Remove flag' : 'Flag review'}>
                      <IconButton 
                        size="small" 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleFlag(review, !review.is_flagged);
                        }}
                      >
                        {review.is_flagged ? <FlagIcon color="error" fontSize="small" /> : <FlagOutlinedIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Reply">
                      <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleOpenDetail(review); }}>
                        <ReplyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {pagination.totalPages > 1 && (
        <TablePagination
          component="div"
          count={pagination.total}
          page={pagination.page - 1}
          onPageChange={(_, newPage) => loadReviews(newPage + 1)}
          rowsPerPage={pagination.limit}
          rowsPerPageOptions={[20, 50, 100]}
          onRowsPerPageChange={(e) => {
            setPagination(prev => ({ ...prev, limit: parseInt(e.target.value, 10) }));
            loadReviews(1);
          }}
        />
      )}
    </TableContainer>
  );

  const renderReviewDetail = () => {
    if (!selectedReview) return null;

    return (
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={handleCloseDrawer}
        PaperProps={{ sx: { width: { xs: '100%', md: 600 }, p: 0 } }}
      >
        {/* Header */}
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', bgcolor: 'grey.50' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Avatar src={selectedReview.reviewer_photo_url} sx={{ width: 48, height: 48 }}>
                  <PersonIcon />
                </Avatar>
                <Box>
                  <Typography variant="h6">{selectedReview.reviewer_name}</Typography>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Rating value={selectedReview.rating} readOnly size="small" />
                    <Typography variant="caption" color="text.secondary">
                      {new Date(selectedReview.review_created_at).toLocaleDateString()}
                    </Typography>
                  </Stack>
                </Box>
              </Stack>
            </Box>
            <IconButton onClick={handleCloseDrawer}>
              <CloseIcon />
            </IconButton>
          </Stack>
        </Box>

        {/* Tabs */}
        <Tabs value={drawerTab} onChange={(_, v) => setDrawerTab(v)} sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab label="Review" />
          <Tab label="Reply" />
          <Tab label="Details" />
        </Tabs>

        {/* Tab Content */}
        <Box sx={{ p: 2, overflow: 'auto', flexGrow: 1 }}>
          {detailLoading ? (
            <Stack spacing={2}>
              <Skeleton height={100} />
              <Skeleton height={60} />
              <Skeleton height={40} />
            </Stack>
          ) : (
            <>
              {/* Review Tab */}
              {drawerTab === 0 && (
                <Stack spacing={3}>
                  {/* Review Text */}
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                      {selectedReview.review_text || <em style={{ color: '#9e9e9e' }}>No review text provided</em>}
                    </Typography>
                  </Paper>

                  {/* Quick Stats */}
                  <Grid container spacing={2}>
                    <Grid item xs={4}>
                      <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary">Rating</Typography>
                        <Stack direction="row" justifyContent="center" alignItems="center" spacing={0.5}>
                          <StarIcon sx={{ color: getRatingColor(selectedReview.rating) }} />
                          <Typography variant="h6">{selectedReview.rating}</Typography>
                        </Stack>
                      </Paper>
                    </Grid>
                    <Grid item xs={4}>
                      <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary">Sentiment</Typography>
                        <Box sx={{ mt: 0.5 }}>
                          <SentimentBadge sentiment={selectedReview.sentiment_label} />
                        </Box>
                      </Paper>
                    </Grid>
                    <Grid item xs={4}>
                      <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary">Priority</Typography>
                        <Box sx={{ mt: 0.5 }}>
                          <SelectField value={selectedReview.priority || 'normal'} onChange={(e) => handleUpdatePriority(selectedReview, e.target.value)} size="small" sx={{ fontSize: '0.8rem' }}>
                            {REVIEW_PRIORITIES.map(p => (
                              <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>
                            ))}
                          </SelectField>
                        </Box>
                      </Paper>
                    </Grid>
                  </Grid>

                  {/* Existing Response */}
                  {selectedReview.has_response && (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Your Response
                      </Typography>
                      <Paper variant="outlined" sx={{ p: 2, bgcolor: 'success.lighter' }}>
                        <Typography variant="body2">{selectedReview.response_text}</Typography>
                        {selectedReview.response_created_at && (
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                            Responded on {new Date(selectedReview.response_created_at).toLocaleDateString()}
                          </Typography>
                        )}
                      </Paper>
                    </Box>
                  )}

                  {/* Flag Toggle */}
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Box>
                        <Typography variant="subtitle2">Flag this review</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Flagged reviews are highlighted for attention
                        </Typography>
                      </Box>
                      <Switch
                        checked={selectedReview.is_flagged}
                        onChange={(e) => handleToggleFlag(selectedReview, e.target.checked)}
                        color="error"
                      />
                    </Stack>
                  </Paper>
                </Stack>
              )}

              {/* Reply Tab */}
              {drawerTab === 1 && (
                <Stack spacing={3}>
                  {selectedReview.has_response && (
                    <Alert severity="success">
                      This review already has a response. You can still edit and resend if needed.
                    </Alert>
                  )}

                  {/* AI Generation Controls */}
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      AI-Assisted Response
                    </Typography>
                    <Stack direction="row" spacing={2} alignItems="center">
                      <SelectField label="Tone" value={responseTone} onChange={(e) => setResponseTone(e.target.value)} size="small" fullWidth={false} sx={{ minWidth: 150 }}>
                        {RESPONSE_TONES.map(t => (
                          <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
                        ))}
                      </SelectField>
                      <LoadingButton
                        variant="contained"
                        startIcon={<AutoAwesomeIcon />}
                        onClick={handleGenerateResponse}
                        loading={generating}
                        loadingLabel="Generating..."
                      >
                        Generate Response
                      </LoadingButton>
                    </Stack>
                  </Paper>

                  {/* Response Editor */}
                  <Box>
                    <Typography variant="subtitle2" gutterBottom>
                      Your Response
                    </Typography>
                    <TextField
                      fullWidth
                      multiline
                      rows={6}
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      placeholder="Write your response here..."
                      variant="outlined"
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      {draftText.length} characters
                    </Typography>
                  </Box>

                  {/* Action Buttons */}
                  <Stack direction="row" spacing={2}>
                    <LoadingButton
                      variant="contained"
                      color="primary"
                      startIcon={<SendIcon />}
                      onClick={handleSendResponse}
                      disabled={!draftText.trim()}
                      loading={sending}
                      loadingLabel="Sending..."
                      sx={{ flexGrow: 1 }}
                    >
                      Send Response
                    </LoadingButton>
                    <Button
                      variant="outlined"
                      color="error"
                      startIcon={<DeleteOutlineIcon />}
                      onClick={handleDiscardDraft}
                      disabled={!draftText.trim()}
                    >
                      Discard
                    </Button>
                  </Stack>

                  {selectedReview.rating <= 3 && (
                    <Alert severity="warning" icon={<WarningAmberIcon />}>
                      This is a negative review. Please review your response carefully before sending.
                    </Alert>
                  )}
                </Stack>
              )}

              {/* Details Tab */}
              {drawerTab === 2 && (
                <Stack spacing={3}>
                  {/* Internal Notes */}
                  <Box>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                      <Typography variant="subtitle2">Internal Notes</Typography>
                      {!editingNotes && (
                        <IconButton size="small" onClick={() => setEditingNotes(true)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                    {editingNotes ? (
                      <Stack spacing={1}>
                        <TextField
                          fullWidth
                          multiline
                          rows={3}
                          value={notesText}
                          onChange={(e) => setNotesText(e.target.value)}
                          placeholder="Add internal notes..."
                        />
                        <Stack direction="row" spacing={1}>
                          <Button size="small" variant="contained" onClick={handleSaveNotes}>Save</Button>
                          <Button size="small" onClick={() => { setEditingNotes(false); setNotesText(selectedReview.internal_notes || ''); }}>
                            Cancel
                          </Button>
                        </Stack>
                      </Stack>
                    ) : (
                      <Paper variant="outlined" sx={{ p: 2 }}>
                        <Typography variant="body2" color={selectedReview.internal_notes ? 'text.primary' : 'text.secondary'}>
                          {selectedReview.internal_notes || 'No internal notes'}
                        </Typography>
                      </Paper>
                    )}
                  </Box>

                  {/* Metadata */}
                  <Box>
                    <Typography variant="subtitle2" gutterBottom>Review Information</Typography>
                    <Paper variant="outlined" sx={{ p: 2 }}>
                      <Grid container spacing={2}>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary">Platform</Typography>
                          <Typography variant="body2">{selectedReview.platform || 'Google'}</Typography>
                        </Grid>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary">Location</Typography>
                          <Typography variant="body2">{selectedReview.location_name || 'N/A'}</Typography>
                        </Grid>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary">Review Date</Typography>
                          <Typography variant="body2">
                            {new Date(selectedReview.review_created_at).toLocaleString()}
                          </Typography>
                        </Grid>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary">Last Synced</Typography>
                          <Typography variant="body2">
                            {new Date(selectedReview.last_synced_at).toLocaleString()}
                          </Typography>
                        </Grid>
                        {selectedReview.sentiment_score !== null && (
                          <Grid item xs={6}>
                            <Typography variant="caption" color="text.secondary">Sentiment Score</Typography>
                            <Typography variant="body2">
                              {parseFloat(selectedReview.sentiment_score).toFixed(2)}
                            </Typography>
                          </Grid>
                        )}
                      </Grid>
                    </Paper>
                  </Box>

                  {/* Draft History */}
                  {selectedReview.drafts?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" gutterBottom>Response Drafts</Typography>
                      <Stack spacing={1}>
                        {selectedReview.drafts.map(draft => (
                          <Paper key={draft.id} variant="outlined" sx={{ p: 2 }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                              <Box>
                                <Typography variant="body2" sx={{ 
                                  overflow: 'hidden', 
                                  textOverflow: 'ellipsis',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical'
                                }}>
                                  {draft.draft_text}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  v{draft.draft_version} • {draft.is_ai_generated ? 'AI Generated' : 'Manual'} • {draft.status}
                                </Typography>
                              </Box>
                              <Chip label={draft.status} size="small" />
                            </Stack>
                          </Paper>
                        ))}
                      </Stack>
                    </Box>
                  )}
                </Stack>
              )}
            </>
          )}
        </Box>
      </Drawer>
    );
  };

  const renderRequestsTab = () => (
    <Stack spacing={3}>
      {/* Actions */}
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h6">Review Requests</Typography>
        <Button variant="contained" onClick={() => setRequestDialogOpen(true)}>
          New Request
        </Button>
      </Stack>

      {/* Requests List */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.50' }}>
              <TableCell sx={{ fontWeight: 600 }}>Customer</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Method</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {requestsLoading ? (
              [...Array(3)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton /></TableCell>
                  <TableCell><Skeleton width={60} /></TableCell>
                  <TableCell><Skeleton width={80} /></TableCell>
                  <TableCell><Skeleton width={80} /></TableCell>
                  <TableCell><Skeleton width={40} /></TableCell>
                </TableRow>
              ))
            ) : requests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    No review requests yet. Create one to get started.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              requests.map((request) => (
                <TableRow key={request.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {request.customer_name || 'Customer'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {request.customer_email || request.customer_phone}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip 
                      size="small" 
                      label={DELIVERY_METHODS.find(m => m.value === request.delivery_method)?.label || request.delivery_method}
                      icon={
                        request.delivery_method === 'email' ? <EmailIcon sx={{ fontSize: 14 }} /> :
                        request.delivery_method === 'sms' ? <SmsIcon sx={{ fontSize: 14 }} /> :
                        <LinkIcon sx={{ fontSize: 14 }} />
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Chip 
                      size="small" 
                      label={request.status}
                      color={
                        request.status === 'completed' ? 'success' :
                        request.status === 'failed' ? 'error' :
                        request.status === 'sent' ? 'primary' :
                        'default'
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {new Date(request.created_at).toLocaleDateString()}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Copy Link">
                      <IconButton size="small" onClick={() => handleCopyLink(request.review_link)}>
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );

  const renderSettingsTab = () => {
    return (
      <Stack spacing={3}>
        <Typography variant="h6">Review Settings</Typography>

        {/* Sync Settings */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" gutterBottom>Sync Settings</Typography>
          <Stack spacing={2}>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.auto_sync_enabled}
                  onChange={(e) => handleSaveSettings({ auto_sync_enabled: e.target.checked })}
                />
              }
              label="Auto-sync reviews"
            />
            <TextField
              size="small"
              label="Sync interval (minutes)"
              type="number"
              value={settings.sync_interval_minutes}
              onChange={(e) => handleSaveSettings({ sync_interval_minutes: parseInt(e.target.value, 10) })}
              sx={{ maxWidth: 200 }}
            />
          </Stack>
        </Paper>

        {/* Flagging Settings */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" gutterBottom>Auto-Flag Settings</Typography>
          <Stack spacing={2}>
            <SelectField label="Flag reviews at or below" value={settings.auto_flag_threshold} onChange={(e) => handleSaveSettings({ auto_flag_threshold: e.target.value })} size="small" fullWidth={false} sx={{ maxWidth: 200 }}>
              {[1, 2, 3, 4, 5].map(r => (
                <MenuItem key={r} value={r}>{r} Star{r !== 1 ? 's' : ''}</MenuItem>
              ))}
            </SelectField>
          </Stack>
        </Paper>

        {/* Notification Settings */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" gutterBottom>Notifications</Typography>
          <Stack spacing={2}>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.notify_new_reviews}
                  onChange={(e) => handleSaveSettings({ notify_new_reviews: e.target.checked })}
                />
              }
              label="Notify on new reviews"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={settings.notify_negative_reviews}
                  onChange={(e) => handleSaveSettings({ notify_negative_reviews: e.target.checked })}
                />
              }
              label="Alert for negative reviews"
            />
          </Stack>
        </Paper>

        {/* AI Settings */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" gutterBottom>AI Response Generation</Typography>
          <Stack spacing={2}>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.ai_drafting_enabled}
                  onChange={(e) => handleSaveSettings({ ai_drafting_enabled: e.target.checked })}
                />
              }
              label="Enable AI response drafting"
            />
            <SelectField label="Default Tone" value={settings.default_response_tone} onChange={(e) => handleSaveSettings({ default_response_tone: e.target.value })} size="small" fullWidth={false} sx={{ maxWidth: 200 }}>
              {RESPONSE_TONES.map(t => (
                <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
              ))}
            </SelectField>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.include_business_name_in_response}
                  onChange={(e) => handleSaveSettings({ include_business_name_in_response: e.target.checked })}
                />
              }
              label="Include business name in responses"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={settings.include_reviewer_name_in_response}
                  onChange={(e) => handleSaveSettings({ include_reviewer_name_in_response: e.target.checked })}
                />
              }
              label="Include reviewer name in responses"
            />
          </Stack>
        </Paper>

        {/* Response Signature */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" gutterBottom>Response Signature</Typography>
          <TextField
            fullWidth
            multiline
            rows={2}
            value={settings.response_signature || ''}
            onChange={(e) => handleSaveSettings({ response_signature: e.target.value })}
            placeholder="Optional signature to append to responses"
          />
        </Paper>
      </Stack>
    );
  };

  // ============================================================================
  // Main Render
  // ============================================================================

  return (
    <Box data-tutorial="reviews-list">
      {/* Header Actions */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Tabs value={activeSubTab} onChange={(_, v) => setActiveSubTab(v)}>
          <Tab label="Reviews" />
          <Tab label="Requests" />
          <Tab label="Settings" />
        </Tabs>
        <Stack direction="row" spacing={1}>
          {activeSubTab === 0 && (
            <>
              <LoadingButton
                variant="outlined"
                startIcon={<SyncIcon />}
                onClick={() => handleSync(false)}
                loading={syncing}
                loadingLabel="Syncing..."
              >
                Sync
              </LoadingButton>
              <ToggleButtonGroup
                value={viewMode}
                exclusive
                onChange={(_, v) => v && setViewMode(v)}
                size="small"
              >
                <ToggleButton value="list">List</ToggleButton>
                <ToggleButton value="cards">Cards</ToggleButton>
              </ToggleButtonGroup>
            </>
          )}
        </Stack>
      </Stack>

      {/* Tab Content */}
      {activeSubTab === 0 && (
        <>
          {renderStatsCards()}
          {renderFilters()}
          {renderReviewsTable()}
        </>
      )}

      {activeSubTab === 1 && renderRequestsTab()}

      {activeSubTab === 2 && renderSettingsTab()}

      {/* Review Detail Drawer */}
      {renderReviewDetail()}

      {/* Review Request Dialog */}
      <FormDialog
        open={requestDialogOpen}
        onClose={() => setRequestDialogOpen(false)}
        onSubmit={handleCreateRequest}
        title="Request a Review"
        loading={requestSubmitting}
        loadingLabel="Creating..."
        submitLabel="Create Request"
        submitIcon={<SendIcon />}
        submitDisabled={!requestForm.customerEmail && !requestForm.customerPhone}
      >
        <TextField
          fullWidth
          label="Customer Name"
          value={requestForm.customerName}
          onChange={(e) => setRequestForm(prev => ({ ...prev, customerName: e.target.value }))}
        />
        <TextField
          fullWidth
          label="Customer Email"
          type="email"
          value={requestForm.customerEmail}
          onChange={(e) => setRequestForm(prev => ({ ...prev, customerEmail: e.target.value }))}
        />
        <TextField
          fullWidth
          label="Customer Phone"
          value={requestForm.customerPhone}
          onChange={(e) => setRequestForm(prev => ({ ...prev, customerPhone: e.target.value }))}
        />
        <SelectField label="Delivery Method" value={requestForm.deliveryMethod} onChange={(e) => setRequestForm(prev => ({ ...prev, deliveryMethod: e.target.value }))}
          options={DELIVERY_METHODS}
        />
        {locations.length > 0 && (
          <SelectField label="Location" value={requestForm.locationId} onChange={(e) => setRequestForm(prev => ({ ...prev, locationId: e.target.value }))}>
            <MenuItem value="">Default</MenuItem>
            {locations.map(loc => (
              <MenuItem key={loc.id} value={loc.id}>{loc.resource_name}</MenuItem>
            ))}
          </SelectField>
        )}
        <TextField
          fullWidth
          multiline
          rows={3}
          label="Custom Message (optional)"
          value={requestForm.customMessage}
          onChange={(e) => setRequestForm(prev => ({ ...prev, customMessage: e.target.value }))}
          placeholder="Add a personal message to include with the request"
        />
      </FormDialog>
    </Box>
  );
}

