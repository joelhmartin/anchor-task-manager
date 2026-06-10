/**
 * Reviews API Routes
 * 
 * Endpoints for Google Reviews management including:
 * - Review listing and filtering
 * - AI-assisted response drafting
 * - Response management
 * - Review request campaigns
 * - Settings and automation
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isAdminOrEditor } from '../middleware/roles.js';
import {
  syncReviewsForClient,
  getClientReviews,
  getReviewById,
  toggleReviewFlag,
  updateReviewPriority,
  updateReviewNotes,
  generateReviewResponse,
  sendReviewResponse,
  approveDraft,
  discardDraft,
  updateDraftText,
  analyzeReviewSentiment,
  createReviewRequest,
  getClientReviewRequests,
  getReviewStatistics,
  getReviewSettings,
  updateReviewSettings,
  getAutomationLogs,
  fetchGoogleLocations,
  getOAuthConnectionStatus
} from '../services/reviews.js';
import { query } from '../db.js';
import { notRevoked } from '../services/queryHelpers.js';
import { logReviewActivity, ActivityEventTypes } from '../services/activityLog.js';

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// ============================================================================
// Review Sync
// ============================================================================

/**
 * POST /reviews/sync
 * Sync reviews from Google Business Profile
 */
router.post('/sync', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    const { forceFullSync = false } = req.body;

    const results = await syncReviewsForClient(clientId, forceFullSync);

    res.json({
      success: true,
      ...results
    });
  } catch (error) {
    console.error('[reviews:sync]', error);
    res.status(500).json({ 
      message: error.message || 'Failed to sync reviews',
      requiresReconnect: error.message?.includes('token') || error.message?.includes('reconnect')
    });
  }
});

// ============================================================================
// Reviews CRUD
// ============================================================================

/**
 * GET /reviews
 * List reviews with filtering and pagination
 */
router.get('/', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    
    const options = {
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(parseInt(req.query.limit, 10) || 20, 100),
      sortBy: req.query.sortBy || 'review_created_at',
      sortOrder: req.query.sortOrder || 'DESC',
      rating: req.query.rating ? parseInt(req.query.rating, 10) : null,
      hasResponse: req.query.hasResponse !== undefined ? req.query.hasResponse === 'true' : null,
      isFlagged: req.query.isFlagged !== undefined ? req.query.isFlagged === 'true' : null,
      priority: req.query.priority || null,
      sentimentLabel: req.query.sentimentLabel || null,
      searchText: req.query.search || null,
      locationId: req.query.locationId || null,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null
    };

    const result = await getClientReviews(clientId, options);

    res.json(result);
  } catch (error) {
    console.error('[reviews:list]', error);
    res.status(500).json({ message: 'Failed to fetch reviews' });
  }
});

/**
 * GET /reviews/stats
 * Get review statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    const periodDays = parseInt(req.query.days, 10) || 30;

    const stats = await getReviewStatistics(clientId, periodDays);

    res.json(stats);
  } catch (error) {
    console.error('[reviews:stats]', error);
    res.status(500).json({ message: 'Failed to fetch review statistics' });
  }
});

/**
 * GET /reviews/:id
 * Get single review with details
 */
router.get('/:id', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    
    const review = await getReviewById(req.params.id, clientId);

    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    res.json({ review });
  } catch (error) {
    console.error('[reviews:get]', error);
    res.status(500).json({ message: 'Failed to fetch review' });
  }
});

/**
 * PUT /reviews/:id/flag
 * Toggle flag status on a review
 */
router.put('/:id/flag', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    const { flagged, reason } = req.body;

    const review = await toggleReviewFlag(
      req.params.id,
      clientId,
      flagged,
      reason,
      req.user.id
    );

    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    res.json({ review });
  } catch (error) {
    console.error('[reviews:flag]', error);
    res.status(500).json({ message: 'Failed to update flag status' });
  }
});

/**
 * PUT /reviews/:id/priority
 * Update review priority
 */
router.put('/:id/priority', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    const { priority } = req.body;

    const review = await updateReviewPriority(req.params.id, clientId, priority);

    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    res.json({ review });
  } catch (error) {
    console.error('[reviews:priority]', error);
    res.status(500).json({ message: error.message || 'Failed to update priority' });
  }
});

/**
 * PUT /reviews/:id/notes
 * Update internal notes on a review
 */
router.put('/:id/notes', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    const { notes } = req.body;

    const review = await updateReviewNotes(req.params.id, clientId, notes);

    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    res.json({ review });
  } catch (error) {
    console.error('[reviews:notes]', error);
    res.status(500).json({ message: 'Failed to update notes' });
  }
});

// ============================================================================
// AI Response Generation
// ============================================================================

/**
 * POST /reviews/:id/generate-response
 * Generate an AI-assisted response draft
 */
router.post('/:id/generate-response', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    const { tone, includeBusinessName, includeReviewerName, customInstructions, maxLength } = req.body;

    const result = await generateReviewResponse(req.params.id, {
      tone,
      includeBusinessName,
      includeReviewerName,
      customInstructions,
      maxLength
    }, clientId);

    res.json(result);
  } catch (error) {
    console.error('[reviews:generate-response]', error);
    res.status(500).json({ message: error.message || 'Failed to generate response' });
  }
});

/**
 * POST /reviews/:id/analyze-sentiment
 * Analyze sentiment of a review
 */
router.post('/:id/analyze-sentiment', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    
    // Get review to verify ownership and get text
    const review = await getReviewById(req.params.id, clientId);
    
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    if (!review.review_text) {
      return res.status(400).json({ message: 'Review has no text to analyze' });
    }

    const sentiment = await analyzeReviewSentiment(req.params.id, review.review_text);

    res.json({ sentiment });
  } catch (error) {
    console.error('[reviews:analyze-sentiment]', error);
    res.status(500).json({ message: error.message || 'Failed to analyze sentiment' });
  }
});

// ============================================================================
// Response Management
// ============================================================================

/**
 * POST /reviews/:id/send-response
 * Send a response to a review
 */
router.post('/:id/send-response', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    const { responseText } = req.body;

    if (!responseText?.trim()) {
      return res.status(400).json({ message: 'Response text is required' });
    }

    const result = await sendReviewResponse(req.params.id, responseText.trim(), req.user.id, clientId);

    // Log review response activity
    await logReviewActivity({
      userId: req.user.id,
      actionType: ActivityEventTypes.RESPOND_REVIEW,
      reviewId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.json(result);
  } catch (error) {
    console.error('[reviews:send-response]', error);
    res.status(500).json({ message: error.message || 'Failed to send response' });
  }
});

/**
 * PUT /reviews/drafts/:draftId
 * Update a draft's text
 */
router.put('/drafts/:draftId', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    const { text } = req.body;

    if (!text?.trim()) {
      return res.status(400).json({ message: 'Draft text is required' });
    }

    const draft = await updateDraftText(req.params.draftId, text.trim(), req.user.id, clientId);

    if (!draft) {
      return res.status(404).json({ message: 'Draft not found' });
    }

    res.json({ draft });
  } catch (error) {
    console.error('[reviews:update-draft]', error);
    res.status(500).json({ message: 'Failed to update draft' });
  }
});

/**
 * POST /reviews/drafts/:draftId/approve
 * Approve a draft
 */
router.post('/drafts/:draftId/approve', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    const draft = await approveDraft(req.params.draftId, req.user.id, clientId);

    if (!draft) {
      return res.status(404).json({ message: 'Draft not found' });
    }

    res.json({ draft });
  } catch (error) {
    console.error('[reviews:approve-draft]', error);
    res.status(500).json({ message: 'Failed to approve draft' });
  }
});

/**
 * POST /reviews/drafts/:draftId/discard
 * Discard a draft
 */
router.post('/drafts/:draftId/discard', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    const { notes } = req.body;

    const draft = await discardDraft(req.params.draftId, req.user.id, notes, clientId);

    if (!draft) {
      return res.status(404).json({ message: 'Draft not found' });
    }

    res.json({ draft });
  } catch (error) {
    console.error('[reviews:discard-draft]', error);
    res.status(500).json({ message: 'Failed to discard draft' });
  }
});

/**
 * POST /reviews/drafts/:draftId/send
 * Send an approved draft as a response
 */
router.post('/drafts/:draftId/send', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    // Get draft, scoped to client_id so a user can't send drafts owned by another account.
    const { rows } = await query(
      'SELECT * FROM review_response_drafts WHERE id = $1 AND client_id = $2',
      [req.params.draftId, clientId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Draft not found' });
    }

    const draft = rows[0];

    // Send the response (also scoped to clientId inside sendReviewResponse)
    const result = await sendReviewResponse(draft.review_id, draft.draft_text, req.user.id, clientId);

    res.json(result);
  } catch (error) {
    console.error('[reviews:send-draft]', error);
    res.status(500).json({ message: error.message || 'Failed to send draft' });
  }
});

// ============================================================================
// Review Requests
// ============================================================================

/**
 * GET /reviews/requests
 * List review requests
 */
router.get('/requests', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    
    const options = {
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(parseInt(req.query.limit, 10) || 20, 100),
      status: req.query.status || null
    };

    const result = await getClientReviewRequests(clientId, options);

    res.json(result);
  } catch (error) {
    console.error('[reviews:requests-list]', error);
    res.status(500).json({ message: 'Failed to fetch review requests' });
  }
});

/**
 * POST /reviews/requests
 * Create a review request
 */
router.post('/requests', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    const {
      customerName,
      customerEmail,
      customerPhone,
      deliveryMethod,
      customMessage,
      locationId
    } = req.body;

    if (!deliveryMethod) {
      return res.status(400).json({ message: 'Delivery method is required' });
    }

    if (deliveryMethod === 'email' && !customerEmail) {
      return res.status(400).json({ message: 'Customer email is required for email delivery' });
    }

    if (deliveryMethod === 'sms' && !customerPhone) {
      return res.status(400).json({ message: 'Customer phone is required for SMS delivery' });
    }

    const request = await createReviewRequest({
      clientId,
      customerName,
      customerEmail,
      customerPhone,
      deliveryMethod,
      customMessage,
      oauthResourceId: locationId,
      createdBy: req.user.id
    });

    res.json({ request });
  } catch (error) {
    console.error('[reviews:create-request]', error);
    res.status(500).json({ message: error.message || 'Failed to create review request' });
  }
});

/**
 * GET /reviews/requests/:id
 * Get a single review request
 */
router.get('/requests/:id', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    
    const { rows } = await query(`
      SELECT rr.*, res.resource_name as location_name
      FROM review_requests rr
      LEFT JOIN oauth_resources res ON rr.oauth_resource_id = res.id
      WHERE rr.id = $1 AND rr.client_id = $2
    `, [req.params.id, clientId]);

    if (!rows.length) {
      return res.status(404).json({ message: 'Review request not found' });
    }

    res.json({ request: rows[0] });
  } catch (error) {
    console.error('[reviews:get-request]', error);
    res.status(500).json({ message: 'Failed to fetch review request' });
  }
});

// ============================================================================
// OAuth Connection Status
// ============================================================================

/**
 * GET /reviews/connection-status
 * Get the client's Google Business Profile connection status
 * This helps the UI show whether they need to connect their account
 */
router.get('/connection-status', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    const status = await getOAuthConnectionStatus(clientId);
    res.json(status);
  } catch (error) {
    console.error('[reviews:connection-status]', error);
    res.status(500).json({ message: 'Failed to fetch connection status' });
  }
});

// ============================================================================
// Locations
// ============================================================================

/**
 * GET /reviews/locations
 * Get Google Business locations for the client
 * Uses oauth_resources table from the existing OAuth infrastructure
 */
router.get('/locations', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;

    // Get locations from oauth_resources (the existing OAuth infrastructure)
    const { rows: cachedLocations } = await query(`
      SELECT r.id, r.resource_id, r.resource_name, r.resource_url, r.is_primary, r.is_enabled,
             c.provider_account_name as connection_name,
             c.is_connected as connection_active
      FROM oauth_resources r
      JOIN oauth_connections c ON r.oauth_connection_id = c.id
      WHERE r.client_id = $1 
        AND r.provider = 'google' 
        AND r.resource_type = 'google_location'
        AND c.is_connected = TRUE
        AND ${notRevoked('c')}
      ORDER BY r.is_primary DESC, r.resource_name
    `, [clientId]);

    res.json({ locations: cachedLocations });
  } catch (error) {
    console.error('[reviews:locations]', error);
    res.status(500).json({ message: 'Failed to fetch locations' });
  }
});

/**
 * POST /reviews/locations/refresh
 * Refresh locations from Google API
 */
router.post('/locations/refresh', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;

    const locations = await fetchGoogleLocations(clientId);

    res.json({ 
      locations,
      message: `Found ${locations.length} locations`
    });
  } catch (error) {
    console.error('[reviews:locations-refresh]', error);
    res.status(500).json({ 
      message: error.message || 'Failed to refresh locations',
      requiresReconnect: error.message?.includes('token') || error.message?.includes('reconnect')
    });
  }
});

// ============================================================================
// Settings
// ============================================================================

/**
 * GET /reviews/settings
 * Get review settings for the client
 */
router.get('/settings', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;

    const settings = await getReviewSettings(clientId);

    res.json({ settings });
  } catch (error) {
    console.error('[reviews:get-settings]', error);
    res.status(500).json({ message: 'Failed to fetch settings' });
  }
});

/**
 * PUT /reviews/settings
 * Update review settings
 */
router.put('/settings', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;

    const settings = await updateReviewSettings(clientId, req.body);

    res.json({ settings });
  } catch (error) {
    console.error('[reviews:update-settings]', error);
    res.status(500).json({ message: 'Failed to update settings' });
  }
});

// ============================================================================
// Automation Rules (Admin Only)
// ============================================================================

/**
 * GET /reviews/automation-rules
 * List automation rules
 */
router.get('/automation-rules', isAdminOrEditor, async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;

    const { rows } = await query(`
      SELECT * FROM review_automation_rules 
      WHERE client_id = $1 
      ORDER BY priority DESC, created_at DESC
    `, [clientId]);

    res.json({ rules: rows });
  } catch (error) {
    console.error('[reviews:list-rules]', error);
    res.status(500).json({ message: 'Failed to fetch automation rules' });
  }
});

/**
 * POST /reviews/automation-rules
 * Create an automation rule
 */
router.post('/automation-rules', isAdminOrEditor, async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    const {
      name,
      description,
      isActive = false,
      minRating,
      maxRating,
      sentimentFilter,
      keywordTriggers,
      keywordExclusions,
      locationIds,
      actionType,
      responseTemplate,
      useAiPersonalization = true,
      aiTone,
      requiresApproval = true,
      approvalThresholdRating = 3,
      notifyOnTrigger = false,
      notificationEmails,
      dailyLimit,
      hourlyLimit,
      priority = 0
    } = req.body;

    if (!name || !actionType) {
      return res.status(400).json({ message: 'Name and action type are required' });
    }

    const { rows } = await query(`
      INSERT INTO review_automation_rules (
        client_id, name, description, is_active,
        min_rating, max_rating, sentiment_filter, keyword_triggers, keyword_exclusions, location_ids,
        action_type, response_template, use_ai_personalization, ai_tone,
        requires_approval, approval_threshold_rating,
        notify_on_trigger, notification_emails,
        daily_limit, hourly_limit, priority,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      RETURNING *
    `, [
      clientId, name, description, isActive,
      minRating, maxRating, 
      sentimentFilter ? JSON.stringify(sentimentFilter) : '{}',
      keywordTriggers ? JSON.stringify(keywordTriggers) : '{}',
      keywordExclusions ? JSON.stringify(keywordExclusions) : '{}',
      locationIds ? JSON.stringify(locationIds) : '{}',
      actionType, responseTemplate, useAiPersonalization, aiTone,
      requiresApproval, approvalThresholdRating,
      notifyOnTrigger, 
      notificationEmails ? JSON.stringify(notificationEmails) : '{}',
      dailyLimit, hourlyLimit, priority,
      req.user.id
    ]);

    res.json({ rule: rows[0] });
  } catch (error) {
    console.error('[reviews:create-rule]', error);
    res.status(500).json({ message: 'Failed to create automation rule' });
  }
});

/**
 * PUT /reviews/automation-rules/:id
 * Update an automation rule
 */
router.put('/automation-rules/:id', isAdminOrEditor, async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    
    // Build dynamic update query
    const allowedFields = [
      'name', 'description', 'is_active',
      'min_rating', 'max_rating', 'sentiment_filter', 'keyword_triggers', 
      'keyword_exclusions', 'location_ids', 'action_type', 'response_template',
      'use_ai_personalization', 'ai_tone', 'requires_approval', 
      'approval_threshold_rating', 'notify_on_trigger', 'notification_emails',
      'daily_limit', 'hourly_limit', 'priority'
    ];

    const setClauses = [];
    const params = [req.params.id, clientId];
    let paramIndex = 3;

    for (const [key, value] of Object.entries(req.body)) {
      // Convert camelCase to snake_case
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      
      if (allowedFields.includes(snakeKey)) {
        setClauses.push(`${snakeKey} = $${paramIndex++}`);
        
        // Handle arrays
        if (Array.isArray(value)) {
          params.push(JSON.stringify(value));
        } else {
          params.push(value);
        }
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    const { rows } = await query(`
      UPDATE review_automation_rules 
      SET ${setClauses.join(', ')}, updated_at = NOW()
      WHERE id = $1 AND client_id = $2
      RETURNING *
    `, params);

    if (!rows.length) {
      return res.status(404).json({ message: 'Rule not found' });
    }

    res.json({ rule: rows[0] });
  } catch (error) {
    console.error('[reviews:update-rule]', error);
    res.status(500).json({ message: 'Failed to update automation rule' });
  }
});

/**
 * DELETE /reviews/automation-rules/:id
 * Delete an automation rule
 */
router.delete('/automation-rules/:id', isAdminOrEditor, async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;

    const { rowCount } = await query(
      'DELETE FROM review_automation_rules WHERE id = $1 AND client_id = $2',
      [req.params.id, clientId]
    );

    if (!rowCount) {
      return res.status(404).json({ message: 'Rule not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[reviews:delete-rule]', error);
    res.status(500).json({ message: 'Failed to delete automation rule' });
  }
});

// ============================================================================
// Automation Logs
// ============================================================================

/**
 * GET /reviews/automation-logs
 * Get automation logs
 */
router.get('/automation-logs', async (req, res) => {
  try {
    const clientId = req.portalUserId || req.user.id;
    
    const options = {
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(parseInt(req.query.limit, 10) || 50, 100),
      reviewId: req.query.reviewId || null,
      actionType: req.query.actionType || null
    };

    const result = await getAutomationLogs(clientId, options);

    res.json(result);
  } catch (error) {
    console.error('[reviews:automation-logs]', error);
    res.status(500).json({ message: 'Failed to fetch automation logs' });
  }
});

export default router;

