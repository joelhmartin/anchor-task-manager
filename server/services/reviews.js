/**
 * Reviews Management Service
 * 
 * Handles:
 * - Google Business Profile API integration
 * - Review synchronization
 * - AI-assisted response drafting
 * - Sentiment analysis
 * - Review request management
 * - Automation rule evaluation
 */

import { query } from '../db.js';
import { notRevoked } from './queryHelpers.js';
import { clientLabelSelect, clientLabelJoins } from './clientLabel.js';
import { generateAiResponse } from './ai.js';
import { sendMailgunMessageWithLogging, isMailgunConfigured } from './mailgun.js';
import { wrapEmailHtml } from './emailTemplate.js';
import { createNotification } from './notifications.js';
import axios from 'axios';

// ============================================================================
// Constants
// ============================================================================

const GOOGLE_BUSINESS_API_BASE = 'https://mybusiness.googleapis.com/v4';
const GOOGLE_MYBUSINESS_REVIEWS_SCOPE = 'https://www.googleapis.com/auth/business.manage';

const SENTIMENT_LABELS = {
  POSITIVE: 'positive',
  NEUTRAL: 'neutral',
  NEGATIVE: 'negative',
  MIXED: 'mixed'
};

const RESPONSE_TONES = {
  professional: 'Professional and courteous',
  friendly: 'Warm and friendly',
  casual: 'Casual and conversational',
  formal: 'Formal and respectful',
  empathetic: 'Empathetic and understanding'
};

const DEFAULT_RESPONSE_SYSTEM_PROMPT = `You are a professional customer service representative responding to online reviews. 
Your responses should be:
- Genuine and personalized (not generic templates)
- Professional yet warm
- Grateful for positive feedback
- Empathetic and solution-oriented for negative feedback
- Concise but complete (2-4 sentences for positive, 3-5 for negative)
- Never defensive or argumentative
- Include the reviewer's name when appropriate
- End with an invitation to return or continue the conversation

IMPORTANT: Do not start responses with "Dear [Name]" - use a more natural opening.
Do not include placeholder text like [Business Name] - use the actual business name provided.`;

// ============================================================================
// Google Business Profile API Integration
// ============================================================================

/**
 * Get access token for a client's Google connection
 * Uses the existing OAuth infrastructure (oauth_connections table)
 */
async function getGoogleAccessToken(clientId) {
  const { rows } = await query(`
    SELECT oc.id as connection_id,
           oc.access_token, 
           oc.refresh_token, 
           oc.expires_at,
           oc.provider_account_name,
           oc.scope_granted,
           oc.last_error
    FROM oauth_connections oc
    WHERE oc.client_id = $1
      AND oc.provider = 'google'
      AND oc.is_connected = TRUE
      AND ${notRevoked('oc')}
    ORDER BY oc.updated_at DESC
    LIMIT 1
  `, [clientId]);

  if (!rows.length) {
    throw new Error('No active Google connection found. Please connect your Google Business Profile in Settings.');
  }

  const connection = rows[0];

  // Check if we have an access token
  if (!connection.access_token) {
    throw new Error('Google connection exists but has no access token. Please reconnect your Google account.');
  }
  
  // Check if token is expired (with 5 minute buffer)
  if (connection.expires_at && new Date(connection.expires_at) < new Date(Date.now() + 5 * 60 * 1000)) {
    // Token expired or expiring soon - attempt refresh
    return await refreshGoogleToken(connection.connection_id, connection.refresh_token);
  }

  return connection.access_token;
}

/**
 * Get OAuth connection status for a client
 * Returns details about their Google Business Profile connection
 */
export async function getOAuthConnectionStatus(clientId) {
  const { rows: connections } = await query(`
    SELECT 
      oc.id,
      oc.provider,
      oc.provider_account_id,
      oc.provider_account_name,
      oc.is_connected,
      oc.last_error,
      oc.expires_at,
      oc.scope_granted,
      oc.created_at,
      oc.updated_at,
      (SELECT COUNT(*) FROM oauth_resources WHERE oauth_connection_id = oc.id AND is_enabled = TRUE) as active_locations
    FROM oauth_connections oc
    WHERE oc.client_id = $1
      AND oc.provider = 'google'
      AND ${notRevoked('oc')}
    ORDER BY oc.updated_at DESC
  `, [clientId]);

  const { rows: locations } = await query(`
    SELECT 
      r.id,
      r.resource_id,
      r.resource_name,
      r.resource_url,
      r.is_primary,
      r.is_enabled,
      r.created_at
    FROM oauth_resources r
    JOIN oauth_connections c ON r.oauth_connection_id = c.id
    WHERE r.client_id = $1 
      AND r.provider = 'google' 
      AND r.resource_type = 'google_location'
      AND c.is_connected = TRUE
      AND ${notRevoked('c')}
    ORDER BY r.is_primary DESC, r.resource_name
  `, [clientId]);

  const activeConnection = connections.find(c => c.is_connected);
  
  return {
    isConnected: !!activeConnection,
    connection: activeConnection ? {
      id: activeConnection.id,
      accountName: activeConnection.provider_account_name,
      accountId: activeConnection.provider_account_id,
      hasValidToken: activeConnection.expires_at ? new Date(activeConnection.expires_at) > new Date() : true,
      lastError: activeConnection.last_error,
      scopesGranted: activeConnection.scope_granted || [],
      connectedAt: activeConnection.created_at
    } : null,
    locations,
    totalLocations: locations.length,
    enabledLocations: locations.filter(l => l.is_enabled).length
  };
}

/**
 * Refresh an expired Google access token
 * Uses environment variables for OAuth credentials (same as oauthIntegration service)
 */
async function refreshGoogleToken(connectionId, refreshToken) {
  if (!refreshToken) {
    throw new Error('No refresh token available - reconnection required');
  }

  // Use environment variables for OAuth credentials
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth not configured - check GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET environment variables');
  }

  try {
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });

    const { access_token, expires_in } = response.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Update the connection with new token
    await query(`
      UPDATE oauth_connections 
      SET access_token = $1, expires_at = $2, last_refreshed_at = NOW(), updated_at = NOW()
      WHERE id = $3
    `, [access_token, expiresAt, connectionId]);

    return access_token;
  } catch (error) {
    console.error('[reviews:token-refresh-failed]', error.response?.data || error.message);
    
    // Mark connection as having an error
    await query(`
      UPDATE oauth_connections 
      SET last_error = $1, updated_at = NOW()
      WHERE id = $2
    `, [`Token refresh failed: ${error.message}`, connectionId]);

    throw new Error('Failed to refresh Google token - reconnection may be required');
  }
}

/**
 * Fetch Google Business locations for a client
 */
export async function fetchGoogleLocations(clientId) {
  const accessToken = await getGoogleAccessToken(clientId);

  try {
    // First, get accounts
    const accountsResponse = await axios.get(`${GOOGLE_BUSINESS_API_BASE}/accounts`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const accounts = accountsResponse.data.accounts || [];
    const locations = [];

    // For each account, get locations
    for (const account of accounts) {
      try {
        const locationsResponse = await axios.get(
          `${GOOGLE_BUSINESS_API_BASE}/${account.name}/locations`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        const accountLocations = (locationsResponse.data.locations || []).map(loc => ({
          ...loc,
          accountName: account.accountName,
          accountId: account.name
        }));

        locations.push(...accountLocations);
      } catch (locError) {
        console.warn(`[reviews:location-fetch-warn] ${account.name}:`, locError.message);
      }
    }

    return locations;
  } catch (error) {
    console.error('[reviews:fetch-locations]', error.response?.data || error.message);
    throw new Error(`Failed to fetch Google locations: ${error.message}`);
  }
}

/**
 * Fetch reviews from Google Business Profile for a specific location
 */
export async function fetchGoogleReviews(clientId, locationName, pageToken = null) {
  const accessToken = await getGoogleAccessToken(clientId);

  try {
    const params = { pageSize: 50 };
    if (pageToken) params.pageToken = pageToken;

    const response = await axios.get(
      `${GOOGLE_BUSINESS_API_BASE}/${locationName}/reviews`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params
      }
    );

    return {
      reviews: response.data.reviews || [],
      averageRating: response.data.averageRating,
      totalReviewCount: response.data.totalReviewCount,
      nextPageToken: response.data.nextPageToken
    };
  } catch (error) {
    console.error('[reviews:fetch-google-reviews]', error.response?.data || error.message);
    throw new Error(`Failed to fetch Google reviews: ${error.message}`);
  }
}

/**
 * Reply to a Google review
 */
export async function replyToGoogleReview(clientId, reviewName, replyText) {
  const accessToken = await getGoogleAccessToken(clientId);

  try {
    const response = await axios.put(
      `${GOOGLE_BUSINESS_API_BASE}/${reviewName}/reply`,
      { comment: replyText },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return response.data;
  } catch (error) {
    console.error('[reviews:reply-google-review]', error.response?.data || error.message);
    throw new Error(`Failed to reply to review: ${error.message}`);
  }
}

/**
 * Delete a reply from a Google review
 */
export async function deleteGoogleReviewReply(clientId, reviewName) {
  const accessToken = await getGoogleAccessToken(clientId);

  try {
    await axios.delete(
      `${GOOGLE_BUSINESS_API_BASE}/${reviewName}/reply`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return { success: true };
  } catch (error) {
    console.error('[reviews:delete-google-reply]', error.response?.data || error.message);
    throw new Error(`Failed to delete reply: ${error.message}`);
  }
}

// ============================================================================
// Review Synchronization
// ============================================================================

/**
 * Sync reviews from Google for a client's locations
 */
export async function syncReviewsForClient(clientId, forceFullSync = false) {
  const syncStartTime = Date.now();
  const syncResults = {
    totalSynced: 0,
    newReviews: 0,
    updatedReviews: 0,
    errors: []
  };

  try {
    // Get all Google locations for this client
    const { rows: resources } = await query(`
      SELECT r.id, r.resource_id, r.resource_name, r.oauth_connection_id
      FROM oauth_resources r
      JOIN oauth_connections c ON r.oauth_connection_id = c.id
      WHERE r.client_id = $1 
        AND r.provider = 'google' 
        AND r.resource_type = 'google_location'
        AND r.is_enabled = TRUE
        AND c.is_connected = TRUE
    `, [clientId]);

    if (!resources.length) {
      return { ...syncResults, message: 'No Google locations configured' };
    }

    // Get client settings for auto-flagging
    const { rows: settingsRows } = await query(
      'SELECT * FROM review_settings WHERE client_id = $1',
      [clientId]
    );
    const settings = settingsRows[0] || {};

    for (const resource of resources) {
      try {
        let pageToken = null;
        let hasMore = true;

        while (hasMore) {
          const { reviews, nextPageToken } = await fetchGoogleReviews(
            clientId,
            resource.resource_id,
            pageToken
          );

          for (const review of reviews) {
            const result = await upsertReview(clientId, resource.id, review, settings);
            syncResults.totalSynced++;
            if (result.isNew) syncResults.newReviews++;
            if (result.isUpdated) syncResults.updatedReviews++;
          }

          pageToken = nextPageToken;
          hasMore = !!nextPageToken;

          // Don't paginate through all history unless forcing full sync
          if (!forceFullSync && syncResults.totalSynced >= 100) {
            hasMore = false;
          }
        }
      } catch (locationError) {
        syncResults.errors.push({
          location: resource.resource_name,
          error: locationError.message
        });
      }
    }

    // Update client profile with sync timestamp and stats
    await updateClientReviewStats(clientId);

    // Update sync timestamp in settings
    await query(`
      INSERT INTO review_settings (client_id, last_sync_at)
      VALUES ($1, NOW())
      ON CONFLICT (client_id) 
      DO UPDATE SET last_sync_at = NOW(), sync_error = NULL, updated_at = NOW()
    `, [clientId]);

    const syncDuration = Date.now() - syncStartTime;
    console.log(`[reviews:sync] Client ${clientId}: ${syncResults.totalSynced} reviews synced in ${syncDuration}ms`);

    return syncResults;
  } catch (error) {
    console.error('[reviews:sync-error]', error);
    
    // Log sync error
    await query(`
      INSERT INTO review_settings (client_id, sync_error)
      VALUES ($1, $2)
      ON CONFLICT (client_id) 
      DO UPDATE SET sync_error = $2, updated_at = NOW()
    `, [clientId, error.message]);

    throw error;
  }
}

/**
 * Upsert a single review from Google
 */
async function upsertReview(clientId, oauthResourceId, googleReview, settings = {}) {
  // Parse Google review data
  const platformReviewId = googleReview.name || googleReview.reviewId;
  const rating = googleReview.starRating ? parseStarRating(googleReview.starRating) : 0;
  const reviewText = googleReview.comment || '';
  const reviewerName = googleReview.reviewer?.displayName || 'Anonymous';
  const reviewerPhotoUrl = googleReview.reviewer?.profilePhotoUrl;
  const reviewCreatedAt = googleReview.createTime ? new Date(googleReview.createTime) : new Date();
  const reviewUpdatedAt = googleReview.updateTime ? new Date(googleReview.updateTime) : null;

  // Check if response exists
  const hasResponse = !!googleReview.reviewReply?.comment;
  const responseText = googleReview.reviewReply?.comment || null;
  const responseCreatedAt = googleReview.reviewReply?.updateTime 
    ? new Date(googleReview.reviewReply.updateTime) 
    : null;

  // Determine if should auto-flag
  const autoFlagThreshold = settings.auto_flag_threshold || 3;
  const autoFlagKeywords = settings.auto_flag_keywords || [];
  let shouldFlag = rating > 0 && rating <= autoFlagThreshold;
  
  // Check for keyword triggers
  if (!shouldFlag && autoFlagKeywords.length > 0 && reviewText) {
    const lowerText = reviewText.toLowerCase();
    shouldFlag = autoFlagKeywords.some(kw => lowerText.includes(kw.toLowerCase()));
  }

  // Determine priority based on rating
  let priority = 'normal';
  if (rating <= 2) priority = 'urgent';
  else if (rating === 3) priority = 'high';
  else if (rating === 5 && !hasResponse) priority = 'low';

  // Check if review exists
  const { rows: existing } = await query(`
    SELECT id, has_response, response_text, updated_at
    FROM reviews 
    WHERE client_id = $1 AND platform = 'google' AND platform_review_id = $2
  `, [clientId, platformReviewId]);

  if (existing.length > 0) {
    // Update existing review
    const existingReview = existing[0];
    const hasChanges = existingReview.has_response !== hasResponse ||
                       existingReview.response_text !== responseText;

    if (hasChanges) {
      await query(`
        UPDATE reviews SET
          rating = $1,
          review_text = $2,
          review_updated_at = $3,
          has_response = $4,
          response_text = $5,
          response_created_at = $6,
          last_synced_at = NOW(),
          updated_at = NOW(),
          raw_data = $7
        WHERE id = $8
      `, [
        rating,
        reviewText,
        reviewUpdatedAt,
        hasResponse,
        responseText,
        responseCreatedAt,
        JSON.stringify(googleReview),
        existingReview.id
      ]);
      
      return { isNew: false, isUpdated: true, reviewId: existingReview.id };
    }
    
    // Just update sync timestamp
    await query('UPDATE reviews SET last_synced_at = NOW() WHERE id = $1', [existingReview.id]);
    return { isNew: false, isUpdated: false, reviewId: existingReview.id };
  }

  // Insert new review
  const { rows: inserted } = await query(`
    INSERT INTO reviews (
      client_id, oauth_resource_id, platform, platform_review_id,
      reviewer_name, reviewer_photo_url, rating, review_text,
      review_created_at, review_updated_at,
      has_response, response_text, response_created_at,
      is_flagged, flagged_at, priority, raw_data
    ) VALUES ($1, $2, 'google', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING id
  `, [
    clientId,
    oauthResourceId,
    platformReviewId,
    reviewerName,
    reviewerPhotoUrl,
    rating,
    reviewText,
    reviewCreatedAt,
    reviewUpdatedAt,
    hasResponse,
    responseText,
    responseCreatedAt,
    shouldFlag,
    shouldFlag ? new Date() : null,
    priority,
    JSON.stringify(googleReview)
  ]);

  const newReviewId = inserted[0].id;

  // Run sentiment analysis asynchronously (don't block sync)
  analyzeSentimentAsync(newReviewId, reviewText).catch(err => {
    console.warn('[reviews:sentiment-async-error]', err.message);
  });

  // Check automation rules for new reviews
  evaluateAutomationRulesAsync(clientId, newReviewId).catch(err => {
    console.warn('[reviews:automation-async-error]', err.message);
  });

  return { isNew: true, isUpdated: false, reviewId: newReviewId };
}

/**
 * Parse Google star rating enum to number
 */
function parseStarRating(starRating) {
  const ratingMap = {
    'ONE': 1,
    'TWO': 2,
    'THREE': 3,
    'FOUR': 4,
    'FIVE': 5,
    'STAR_RATING_UNSPECIFIED': 0
  };
  return ratingMap[starRating] || 0;
}

/**
 * Update client profile with aggregate review stats
 */
async function updateClientReviewStats(clientId) {
  const { rows } = await query(`
    SELECT 
      COUNT(*) as total_count,
      AVG(rating) as avg_rating,
      COUNT(*) FILTER (WHERE NOT has_response) as pending_count
    FROM reviews 
    WHERE client_id = $1
  `, [clientId]);

  const stats = rows[0];

  await query(`
    UPDATE client_profiles SET
      reviews_enabled = TRUE,
      reviews_last_sync_at = NOW(),
      reviews_total_count = $2,
      reviews_average_rating = $3,
      reviews_pending_response_count = $4,
      updated_at = NOW()
    WHERE user_id = $1
  `, [
    clientId,
    stats.total_count || 0,
    stats.avg_rating ? parseFloat(stats.avg_rating).toFixed(2) : null,
    stats.pending_count || 0
  ]);
}

// ============================================================================
// AI Response Generation
// ============================================================================

/**
 * Generate an AI-assisted review response. Scoped to clientId so users cannot
 * generate drafts for reviews that belong to another client account.
 */
export async function generateReviewResponse(reviewId, options = {}, clientId) {
  if (!clientId) throw new Error('clientId is required');
  const {
    tone = 'professional',
    includeBusinessName = true,
    includeReviewerName = true,
    customInstructions = '',
    maxLength = 500
  } = options;

  // Get review and business context, scoped to client_id.
  const { rows } = await query(`
    SELECT r.*,
           ba.business_name, ba.business_description,
           u.first_name as owner_first_name, u.last_name as owner_last_name,
           ${clientLabelSelect()}
    FROM reviews r
    JOIN users u ON r.client_id = u.id
    ${clientLabelJoins('r.client_id')}
    WHERE r.id = $1 AND r.client_id = $2
  `, [reviewId, clientId]);

  if (!rows.length) {
    throw new Error('Review not found');
  }

  const review = rows[0];
  const businessName = review.business_name || 'our business';
  const reviewerName = review.reviewer_name || 'Customer';
  const toneDescription = RESPONSE_TONES[tone] || RESPONSE_TONES.professional;

  // Build the prompt
  let prompt = `Generate a response to the following online review.

BUSINESS CONTEXT:
- Business Name: ${businessName}
${review.business_description ? `- Business Description: ${review.business_description}` : ''}

REVIEW DETAILS:
- Reviewer Name: ${reviewerName}
- Rating: ${review.rating}/5 stars
- Review Text: "${review.review_text || '(No text provided)'}"

RESPONSE REQUIREMENTS:
- Tone: ${toneDescription}
- Maximum length: ${maxLength} characters
${includeReviewerName ? `- Address the reviewer by name (${reviewerName})` : '- Do not use the reviewer\'s name'}
${includeBusinessName ? `- Reference the business name (${businessName}) naturally` : '- Do not mention the business name'}
${customInstructions ? `- Additional instructions: ${customInstructions}` : ''}

${review.rating <= 3 ? `
SPECIAL INSTRUCTIONS FOR LOW RATING:
- Acknowledge their concerns sincerely
- Apologize for their negative experience
- Offer to make things right (invite them to contact you directly)
- Do not make excuses or be defensive
` : `
SPECIAL INSTRUCTIONS FOR POSITIVE RATING:
- Express genuine gratitude
- Highlight something specific from their review if possible
- Invite them to return
`}

Generate ONLY the response text, nothing else.`;

  try {
    const generationStart = Date.now();
    
    const responseText = await generateAiResponse({
      prompt,
      systemPrompt: DEFAULT_RESPONSE_SYSTEM_PROMPT,
      temperature: 0.7,
      maxTokens: Math.ceil(maxLength / 3) // Rough token estimate
    });

    const generationTime = Date.now() - generationStart;

    // Save as draft
    const { rows: draftRows } = await query(`
      INSERT INTO review_response_drafts (
        review_id, client_id, draft_text, is_ai_generated, ai_model, ai_prompt_used,
        ai_generation_params, status
      ) VALUES ($1, $2, $3, TRUE, $4, $5, $6, 'draft')
      RETURNING *
    `, [
      reviewId,
      review.client_id,
      responseText,
      'vertex-gemini',
      prompt,
      JSON.stringify({ tone, includeBusinessName, includeReviewerName, maxLength, generationTime })
    ]);

    // Log the AI action
    await logAutomationAction({
      clientId: review.client_id,
      reviewId,
      draftId: draftRows[0].id,
      actionType: 'ai_draft_generated',
      actionStatus: 'executed',
      aiModel: 'vertex-gemini',
      aiInput: { prompt, options },
      aiOutput: { responseText, length: responseText.length },
      aiLatencyMs: generationTime
    });

    return {
      draft: draftRows[0],
      generationTime
    };
  } catch (error) {
    console.error('[reviews:generate-response]', error);
    
    // Log the failure
    await logAutomationAction({
      clientId: review.client_id,
      reviewId,
      actionType: 'ai_draft_generated',
      actionStatus: 'failed',
      aiModel: 'vertex-gemini',
      aiInput: { prompt, options },
      errorMessage: error.message
    });

    throw error;
  }
}

/**
 * Regenerate a response with different parameters
 */
export async function regenerateReviewResponse(draftId, options = {}) {
  const { rows } = await query('SELECT review_id FROM review_response_drafts WHERE id = $1', [draftId]);
  
  if (!rows.length) {
    throw new Error('Draft not found');
  }

  return generateReviewResponse(rows[0].review_id, options);
}

// ============================================================================
// Sentiment Analysis
// ============================================================================

/**
 * Analyze sentiment of a review (async helper)
 */
async function analyzeSentimentAsync(reviewId, reviewText) {
  if (!reviewText || reviewText.length < 10) {
    return null;
  }

  try {
    const result = await analyzeReviewSentiment(reviewId, reviewText);
    return result;
  } catch (error) {
    console.warn('[reviews:sentiment-analysis-failed]', reviewId, error.message);
    return null;
  }
}

/**
 * Analyze sentiment using AI
 */
export async function analyzeReviewSentiment(reviewId, reviewText) {
  const prompt = `Analyze the sentiment of this customer review and respond with ONLY a JSON object.

REVIEW TEXT:
"${reviewText}"

Respond with exactly this JSON format:
{
  "score": <number between -1 and 1, where -1 is very negative, 0 is neutral, 1 is very positive>,
  "label": "<one of: positive, neutral, negative, mixed>",
  "reasoning": "<brief explanation>"
}`;

  const response = await generateAiResponse({
    prompt,
    systemPrompt: 'You are a sentiment analysis system. Respond only with valid JSON.',
    temperature: 0.3,
    maxTokens: 200
  });

  try {
    // Clean up response and parse JSON
    const cleanResponse = response.replace(/```json\n?|\n?```/g, '').trim();
    const sentiment = JSON.parse(cleanResponse);

    // Validate
    const score = Math.max(-1, Math.min(1, parseFloat(sentiment.score) || 0));
    const label = ['positive', 'neutral', 'negative', 'mixed'].includes(sentiment.label) 
      ? sentiment.label 
      : 'neutral';

    // Update review
    await query(`
      UPDATE reviews SET
        sentiment_score = $1,
        sentiment_label = $2,
        sentiment_analyzed_at = NOW(),
        updated_at = NOW()
      WHERE id = $3
    `, [score, label, reviewId]);

    return { score, label, reasoning: sentiment.reasoning };
  } catch (parseError) {
    console.warn('[reviews:sentiment-parse-error]', parseError.message, response);
    throw new Error('Failed to parse sentiment analysis response');
  }
}

// ============================================================================
// Review Management
// ============================================================================

/**
 * Get reviews for a client with filtering and pagination
 */
export async function getClientReviews(clientId, options = {}) {
  const {
    page = 1,
    limit = 20,
    sortBy = 'review_created_at',
    sortOrder = 'DESC',
    rating = null,
    hasResponse = null,
    isFlagged = null,
    priority = null,
    sentimentLabel = null,
    searchText = null,
    locationId = null,
    dateFrom = null,
    dateTo = null
  } = options;

  const offset = (page - 1) * limit;
  const params = [clientId];
  let paramIndex = 2;

  let whereClause = 'WHERE r.client_id = $1';

  if (rating !== null) {
    whereClause += ` AND r.rating = $${paramIndex++}`;
    params.push(rating);
  }

  if (hasResponse !== null) {
    whereClause += ` AND r.has_response = $${paramIndex++}`;
    params.push(hasResponse);
  }

  if (isFlagged !== null) {
    whereClause += ` AND r.is_flagged = $${paramIndex++}`;
    params.push(isFlagged);
  }

  if (priority) {
    whereClause += ` AND r.priority = $${paramIndex++}`;
    params.push(priority);
  }

  if (sentimentLabel) {
    whereClause += ` AND r.sentiment_label = $${paramIndex++}`;
    params.push(sentimentLabel);
  }

  if (searchText) {
    whereClause += ` AND (r.review_text ILIKE $${paramIndex} OR r.reviewer_name ILIKE $${paramIndex})`;
    params.push(`%${searchText}%`);
    paramIndex++;
  }

  if (locationId) {
    whereClause += ` AND r.oauth_resource_id = $${paramIndex++}`;
    params.push(locationId);
  }

  if (dateFrom) {
    whereClause += ` AND r.review_created_at >= $${paramIndex++}`;
    params.push(dateFrom);
  }

  if (dateTo) {
    whereClause += ` AND r.review_created_at <= $${paramIndex++}`;
    params.push(dateTo);
  }

  // Validate sort column
  const validSortColumns = ['review_created_at', 'rating', 'reviewer_name', 'priority', 'updated_at'];
  const safeSortBy = validSortColumns.includes(sortBy) ? sortBy : 'review_created_at';
  const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  // Get total count
  const countResult = await query(
    `SELECT COUNT(*) as total FROM reviews r ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].total, 10);

  // Get reviews with location info
  const { rows } = await query(`
    SELECT r.*, 
           res.resource_name as location_name,
           (SELECT COUNT(*) FROM review_response_drafts d WHERE d.review_id = r.id AND d.status = 'draft') as pending_drafts
    FROM reviews r
    LEFT JOIN oauth_resources res ON r.oauth_resource_id = res.id
    ${whereClause}
    ORDER BY r.${safeSortBy} ${safeSortOrder}
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
  `, [...params, limit, offset]);

  return {
    reviews: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/**
 * Get a single review with full details
 */
export async function getReviewById(reviewId, clientId) {
  const { rows } = await query(`
    SELECT r.*, 
           res.resource_name as location_name,
           ba.business_name
    FROM reviews r
    LEFT JOIN oauth_resources res ON r.oauth_resource_id = res.id
    LEFT JOIN brand_assets ba ON r.client_id = ba.user_id
    WHERE r.id = $1 AND r.client_id = $2
  `, [reviewId, clientId]);

  if (!rows.length) {
    return null;
  }

  // Get drafts
  const { rows: drafts } = await query(`
    SELECT * FROM review_response_drafts 
    WHERE review_id = $1 
    ORDER BY created_at DESC
  `, [reviewId]);

  return {
    ...rows[0],
    drafts
  };
}

/**
 * Flag/unflag a review
 */
export async function toggleReviewFlag(reviewId, clientId, flagged, reason = null, userId = null) {
  const { rows } = await query(`
    UPDATE reviews SET
      is_flagged = $1,
      flag_reason = $2,
      flagged_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
      flagged_by = $3,
      updated_at = NOW()
    WHERE id = $4 AND client_id = $5
    RETURNING *
  `, [flagged, reason, userId, reviewId, clientId]);

  return rows[0];
}

/**
 * Update review priority
 */
export async function updateReviewPriority(reviewId, clientId, priority) {
  const validPriorities = ['low', 'normal', 'high', 'urgent'];
  if (!validPriorities.includes(priority)) {
    throw new Error('Invalid priority value');
  }

  const { rows } = await query(`
    UPDATE reviews SET priority = $1, updated_at = NOW()
    WHERE id = $2 AND client_id = $3
    RETURNING *
  `, [priority, reviewId, clientId]);

  return rows[0];
}

/**
 * Add internal notes to a review
 */
export async function updateReviewNotes(reviewId, clientId, notes) {
  const { rows } = await query(`
    UPDATE reviews SET internal_notes = $1, updated_at = NOW()
    WHERE id = $2 AND client_id = $3
    RETURNING *
  `, [notes, reviewId, clientId]);

  return rows[0];
}

// ============================================================================
// Response Management
// ============================================================================

/**
 * Send a response to a review
 */
export async function sendReviewResponse(reviewId, responseText, userId, clientId) {
  if (!clientId) {
    throw new Error('clientId is required');
  }
  // Get review details, scoped to client_id so users can't send responses for
  // reviews that don't belong to their account.
  const { rows } = await query(`
    SELECT r.*, res.resource_id as location_name
    FROM reviews r
    LEFT JOIN oauth_resources res ON r.oauth_resource_id = res.id
    WHERE r.id = $1 AND r.client_id = $2
  `, [reviewId, clientId]);

  if (!rows.length) {
    throw new Error('Review not found');
  }

  const review = rows[0];

  // For Google reviews, send via API
  if (review.platform === 'google') {
    try {
      await replyToGoogleReview(
        review.client_id,
        review.platform_review_id,
        responseText
      );
    } catch (error) {
      console.error('[reviews:send-response-failed]', error);
      throw new Error(`Failed to send response: ${error.message}`);
    }
  }

  // Update review record
  await query(`
    UPDATE reviews SET
      has_response = TRUE,
      response_text = $1,
      response_created_at = NOW(),
      updated_at = NOW()
    WHERE id = $2
  `, [responseText, reviewId]);

  // Mark any pending drafts as sent
  await query(`
    UPDATE review_response_drafts SET
      status = 'sent',
      sent_at = NOW(),
      updated_at = NOW()
    WHERE review_id = $1 AND status IN ('draft', 'approved')
  `, [reviewId]);

  // Log the action
  await logAutomationAction({
    clientId: review.client_id,
    reviewId,
    actionType: 'response_sent',
    actionStatus: 'executed',
    humanActionBy: userId,
    metadata: { responseText, responseLength: responseText.length }
  });

  return { success: true };
}

/**
 * Approve a draft for sending. Scoped to clientId so a user cannot approve
 * drafts that belong to another client account.
 */
export async function approveDraft(draftId, userId, clientId) {
  if (!clientId) throw new Error('clientId is required');
  const { rows } = await query(`
    UPDATE review_response_drafts SET
      status = 'approved',
      reviewed_by = $1,
      reviewed_at = NOW(),
      updated_at = NOW()
    WHERE id = $2 AND client_id = $3
    RETURNING *
  `, [userId, draftId, clientId]);

  return rows[0];
}

/**
 * Discard a draft. Scoped to clientId.
 */
export async function discardDraft(draftId, userId, notes = null, clientId) {
  if (!clientId) throw new Error('clientId is required');
  const { rows } = await query(`
    UPDATE review_response_drafts SET
      status = 'discarded',
      reviewed_by = $1,
      reviewed_at = NOW(),
      review_notes = $2,
      updated_at = NOW()
    WHERE id = $3 AND client_id = $4
    RETURNING *
  `, [userId, notes, draftId, clientId]);

  return rows[0];
}

/**
 * Update a draft's text. Scoped to clientId.
 */
export async function updateDraftText(draftId, newText, userId, clientId) {
  if (!clientId) throw new Error('clientId is required');
  const { rows } = await query(`
    UPDATE review_response_drafts SET
      draft_text = $1,
      draft_version = draft_version + 1,
      updated_at = NOW()
    WHERE id = $2 AND client_id = $3
    RETURNING *
  `, [newText, draftId, clientId]);

  return rows[0];
}

// ============================================================================
// Review Requests
// ============================================================================

function formatReviewRequestEmail({
  businessName,
  customerName,
  reviewLink,
  locationName,
  customMessage
}) {
  const safeBusiness = businessName || 'our business';
  const greetingName = customerName || 'there';
  const subject = `We’d love your feedback on ${safeBusiness}`;
  const textLines = [
    `Hi ${greetingName},`,
    '',
    `Thanks for choosing ${safeBusiness}. If you have a moment, we’d be grateful if you left a quick review.`,
    customMessage ? '' : null,
    customMessage ? customMessage : null,
    '',
    `Leave a review: ${reviewLink}`,
    locationName ? `Location: ${locationName}` : null,
    '',
    `Thanks again,`,
    `${safeBusiness}`
  ].filter(Boolean);

  const bodyHtml = `
    <p>Hi ${greetingName},</p>
    <p>Thanks for choosing ${safeBusiness}. If you have a moment, we’d be grateful if you left a quick review.</p>
    ${customMessage ? `<p>${customMessage}</p>` : ''}
    <p style="margin: 18px 0;">
      <a href="${reviewLink}" target="_blank" rel="noopener" style="background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;display:inline-block;">
        Leave a Review
      </a>
    </p>
    ${locationName ? `<p style="color:#6b7280;font-size:13px;">Location: ${locationName}</p>` : ''}
    <p>Thanks again,<br/>${safeBusiness}</p>
  `;

  return {
    subject,
    text: textLines.join('\n'),
    html: wrapEmailHtml({ subject, preheader: subject, bodyHtml })
  };
}

/**
 * Create a review request
 */
export async function createReviewRequest({
  clientId,
  customerName,
  customerEmail,
  customerPhone,
  deliveryMethod,
  customMessage,
  oauthResourceId,
  createdBy
}) {
  // Get the review link for the location
  const reviewLink = await getReviewLinkForLocation(clientId, oauthResourceId);

  const { rows } = await query(`
    INSERT INTO review_requests (
      client_id, oauth_resource_id, customer_name, customer_email, customer_phone,
      delivery_method, review_link, custom_message, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [
    clientId,
    oauthResourceId,
    customerName,
    customerEmail,
    customerPhone,
    deliveryMethod,
    reviewLink,
    customMessage,
    createdBy
  ]);

  const request = rows[0];

  // If not link_only, trigger send
  if (deliveryMethod !== 'link_only') {
    await sendReviewRequest(request.id);
  }

  return request;
}

/**
 * Get review link for a Google location
 */
async function getReviewLinkForLocation(clientId, oauthResourceId) {
  if (!oauthResourceId) {
    // Return generic Google review search link
    const { rows } = await query(
      'SELECT business_name FROM brand_assets WHERE user_id = $1',
      [clientId]
    );
    const businessName = rows[0]?.business_name || 'business';
    return `https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID`;
  }

  // Get the place ID from the resource
  const { rows } = await query(
    'SELECT resource_id, resource_url FROM oauth_resources WHERE id = $1',
    [oauthResourceId]
  );

  if (!rows.length) {
    throw new Error('Location not found');
  }

  // Extract place ID from the resource_id (format: accounts/X/locations/Y)
  // The review link format varies by how Google provides it
  // For now, construct a generic link - this should be customized based on actual API response
  return rows[0].resource_url || `https://search.google.com/local/writereview?placeid=${rows[0].resource_id}`;
}

/**
 * Send a review request (email/SMS)
 */
async function sendReviewRequest(requestId) {
  const { rows } = await query(
    `SELECT rr.*, 
            ba.business_name,
            res.resource_name as location_name,
            u.first_name as client_first_name,
            u.last_name as client_last_name
     FROM review_requests rr
     LEFT JOIN brand_assets ba ON rr.client_id = ba.user_id
     LEFT JOIN oauth_resources res ON rr.oauth_resource_id = res.id
     LEFT JOIN users u ON rr.client_id = u.id
     WHERE rr.id = $1`,
    [requestId]
  );
  
  if (!rows.length) {
    throw new Error('Review request not found');
  }

  const request = rows[0];

  if (request.delivery_method === 'email') {
    if (!request.customer_email) {
      throw new Error('Customer email is required for email delivery');
    }

    if (!isMailgunConfigured()) {
      await query(
        `UPDATE review_requests SET
           status = 'failed',
           error_message = 'Mailgun is not configured',
           updated_at = NOW()
         WHERE id = $1`,
        [requestId]
      );
      await createNotification({
        userId: request.client_id,
        title: 'Review request failed',
        body: 'Mailgun is not configured. Please contact support.',
        linkUrl: '/client?tab=reviews'
      });
      throw new Error('Mailgun is not configured');
    }

    const businessName =
      request.business_name ||
      [request.client_first_name, request.client_last_name].filter(Boolean).join(' ') ||
      'our business';

    const { subject, text, html } = formatReviewRequestEmail({
      businessName,
      customerName: request.customer_name,
      reviewLink: request.review_link,
      locationName: request.location_name,
      customMessage: request.custom_message
    });

    try {
      const mailgunResponse = await sendMailgunMessageWithLogging(
        {
          to: request.customer_email,
          subject,
          text,
          html
        },
        {
          emailType: 'review_request',
          recipientName: request.customer_name || null,
          triggeredById: request.created_by,
          clientId: request.client_id,
          metadata: {
            review_request_id: request.id,
            delivery_method: request.delivery_method
          }
        }
      );

      await query(
        `UPDATE review_requests SET
           status = 'sent',
           sent_at = NOW(),
           updated_at = NOW(),
           metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{mailgun_log_id}', to_jsonb($2::text), true)
         WHERE id = $1`,
        [requestId, mailgunResponse?.logId || null]
      );
    } catch (err) {
      await query(
        `UPDATE review_requests SET
           status = 'failed',
           error_message = $2,
           updated_at = NOW()
         WHERE id = $1`,
        [requestId, err.message]
      );
      await createNotification({
        userId: request.client_id,
        title: 'Review request failed',
        body: `We couldn’t send the email to ${request.customer_email}. ${err.message}`,
        linkUrl: '/client?tab=reviews'
      });
      throw err;
    }
  } else if (request.delivery_method === 'sms') {
    await query(
      `UPDATE review_requests SET
         status = 'failed',
         error_message = 'SMS delivery is not configured',
         updated_at = NOW()
       WHERE id = $1`,
      [requestId]
    );
    await createNotification({
      userId: request.client_id,
      title: 'Review request failed',
      body: 'SMS delivery is not configured yet. Please use email or link-only.',
      linkUrl: '/client?tab=reviews'
    });
    throw new Error('SMS delivery is not configured');
  } else {
    await query(
      `UPDATE review_requests SET
         status = 'sent',
         sent_at = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      [requestId]
    );
  }

  return { success: true };
}

/**
 * Get review requests for a client
 */
export async function getClientReviewRequests(clientId, options = {}) {
  const { page = 1, limit = 20, status = null } = options;
  const offset = (page - 1) * limit;

  let whereClause = 'WHERE client_id = $1';
  const params = [clientId];

  if (status) {
    whereClause += ' AND status = $2';
    params.push(status);
  }

  const { rows: countRows } = await query(
    `SELECT COUNT(*) as total FROM review_requests ${whereClause}`,
    params
  );
  const total = parseInt(countRows[0].total, 10);

  const { rows } = await query(`
    SELECT rr.*, res.resource_name as location_name
    FROM review_requests rr
    LEFT JOIN oauth_resources res ON rr.oauth_resource_id = res.id
    ${whereClause}
    ORDER BY rr.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, limit, offset]);

  return {
    requests: rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  };
}

// ============================================================================
// Automation Rules
// ============================================================================

/**
 * Evaluate automation rules for a new review (async)
 */
async function evaluateAutomationRulesAsync(clientId, reviewId) {
  try {
    // Get active rules for this client, ordered by priority
    const { rows: rules } = await query(`
      SELECT * FROM review_automation_rules 
      WHERE client_id = $1 AND is_active = TRUE
      ORDER BY priority DESC
    `, [clientId]);

    if (!rules.length) return;

    // Get the review
    const { rows: reviews } = await query('SELECT * FROM reviews WHERE id = $1', [reviewId]);
    if (!reviews.length) return;

    const review = reviews[0];

    for (const rule of rules) {
      const matches = checkRuleConditions(rule, review);
      
      if (matches) {
        await executeAutomationRule(rule, review);
        break; // Only execute first matching rule
      }
    }
  } catch (error) {
    console.error('[reviews:automation-rules-error]', error);
  }
}

/**
 * Check if a review matches rule conditions
 */
function checkRuleConditions(rule, review) {
  // Rating check
  if (rule.min_rating && review.rating < rule.min_rating) return false;
  if (rule.max_rating && review.rating > rule.max_rating) return false;

  // Sentiment check
  if (rule.sentiment_filter?.length && review.sentiment_label) {
    if (!rule.sentiment_filter.includes(review.sentiment_label)) return false;
  }

  // Keyword triggers (any match = true)
  if (rule.keyword_triggers?.length && review.review_text) {
    const lowerText = review.review_text.toLowerCase();
    const hasKeyword = rule.keyword_triggers.some(kw => lowerText.includes(kw.toLowerCase()));
    if (!hasKeyword) return false;
  }

  // Keyword exclusions (any match = false)
  if (rule.keyword_exclusions?.length && review.review_text) {
    const lowerText = review.review_text.toLowerCase();
    const hasExclusion = rule.keyword_exclusions.some(kw => lowerText.includes(kw.toLowerCase()));
    if (hasExclusion) return false;
  }

  // Location check
  if (rule.location_ids?.length && review.oauth_resource_id) {
    if (!rule.location_ids.includes(review.oauth_resource_id)) return false;
  }

  return true;
}

/**
 * Execute an automation rule action
 */
async function executeAutomationRule(rule, review) {
  // Check rate limits
  const now = new Date();
  const lastReset = new Date(rule.last_reset_at);
  const hoursSinceReset = (now - lastReset) / (1000 * 60 * 60);

  if (hoursSinceReset >= 1) {
    // Reset hourly counter
    await query(`
      UPDATE review_automation_rules SET 
        executions_this_hour = 0, 
        last_reset_at = NOW() 
      WHERE id = $1
    `, [rule.id]);
    rule.executions_this_hour = 0;
  }

  if (rule.hourly_limit && rule.executions_this_hour >= rule.hourly_limit) {
    console.log('[reviews:automation] Hourly limit reached for rule', rule.id);
    return;
  }

  if (rule.daily_limit && rule.executions_today >= rule.daily_limit) {
    console.log('[reviews:automation] Daily limit reached for rule', rule.id);
    return;
  }

  // Execute based on action type
  switch (rule.action_type) {
    case 'draft':
      await generateReviewResponse(review.id, { tone: rule.ai_tone || 'professional' });
      break;

    case 'flag':
      await toggleReviewFlag(review.id, review.client_id, true, `Auto-flagged by rule: ${rule.name}`);
      break;

    case 'notify':
      // TODO: Send notification
      break;

    case 'auto_send':
      // Generate and potentially send (with approval check)
      if (rule.requires_approval || review.rating <= (rule.approval_threshold_rating || 3)) {
        await generateReviewResponse(review.id, { tone: rule.ai_tone });
      } else {
        const { draft } = await generateReviewResponse(review.id, { tone: rule.ai_tone });
        await sendReviewResponse(review.id, draft.draft_text, null);
      }
      break;
  }

  // Update execution counts
  await query(`
    UPDATE review_automation_rules SET 
      executions_this_hour = executions_this_hour + 1,
      executions_today = executions_today + 1
    WHERE id = $1
  `, [rule.id]);

  // Log the execution
  await logAutomationAction({
    clientId: review.client_id,
    reviewId: review.id,
    ruleId: rule.id,
    actionType: `rule_${rule.action_type}`,
    actionStatus: 'executed',
    metadata: { ruleName: rule.name }
  });
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get review statistics for a client
 */
export async function getReviewStatistics(clientId, periodDays = 30) {
  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - periodDays);

  const { rows } = await query(`
    SELECT 
      COUNT(*) as total_reviews,
      COUNT(*) FILTER (WHERE review_created_at >= $2) as period_reviews,
      COUNT(*) FILTER (WHERE NOT has_response) as pending_responses,
      COUNT(*) FILTER (WHERE is_flagged) as flagged_count,
      AVG(rating)::DECIMAL(3,2) as average_rating,
      AVG(rating) FILTER (WHERE review_created_at >= $2)::DECIMAL(3,2) as period_average,
      COUNT(*) FILTER (WHERE rating = 5) as rating_5,
      COUNT(*) FILTER (WHERE rating = 4) as rating_4,
      COUNT(*) FILTER (WHERE rating = 3) as rating_3,
      COUNT(*) FILTER (WHERE rating = 2) as rating_2,
      COUNT(*) FILTER (WHERE rating = 1) as rating_1,
      COUNT(*) FILTER (WHERE sentiment_label = 'positive') as positive_sentiment,
      COUNT(*) FILTER (WHERE sentiment_label = 'neutral') as neutral_sentiment,
      COUNT(*) FILTER (WHERE sentiment_label = 'negative') as negative_sentiment,
      COUNT(*) FILTER (WHERE sentiment_label = 'mixed') as mixed_sentiment
    FROM reviews
    WHERE client_id = $1
  `, [clientId, periodStart]);

  const stats = rows[0];

  // Get response time average (for reviews with responses)
  const { rows: responseTimeRows } = await query(`
    SELECT AVG(
      EXTRACT(EPOCH FROM (response_created_at - review_created_at)) / 3600
    )::DECIMAL(10,2) as avg_response_hours
    FROM reviews
    WHERE client_id = $1 AND has_response = TRUE AND response_created_at IS NOT NULL
  `, [clientId]);

  // Get review requests stats
  const { rows: requestStats } = await query(`
    SELECT 
      COUNT(*) as total_requests,
      COUNT(*) FILTER (WHERE status = 'sent') as sent_requests,
      COUNT(*) FILTER (WHERE status = 'completed') as completed_requests
    FROM review_requests
    WHERE client_id = $1 AND created_at >= $2
  `, [clientId, periodStart]);

  return {
    ...stats,
    avgResponseHours: responseTimeRows[0]?.avg_response_hours || null,
    periodDays,
    requests: requestStats[0]
  };
}

// ============================================================================
// Settings Management
// ============================================================================

/**
 * Get review settings for a client
 */
export async function getReviewSettings(clientId) {
  const { rows } = await query(
    'SELECT * FROM review_settings WHERE client_id = $1',
    [clientId]
  );

  if (!rows.length) {
    // Return defaults
    return {
      client_id: clientId,
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
      ai_drafting_enabled: true,
      ai_auto_draft_positive: false,
      ai_auto_draft_negative: false
    };
  }

  return rows[0];
}

/**
 * Update review settings for a client
 */
export async function updateReviewSettings(clientId, updates) {
  const allowedFields = [
    'auto_sync_enabled', 'sync_interval_minutes', 'auto_flag_threshold',
    'auto_flag_keywords', 'notify_new_reviews', 'notify_negative_reviews',
    'negative_review_threshold', 'notification_emails', 'default_response_tone',
    'include_business_name_in_response', 'include_reviewer_name_in_response',
    'response_signature', 'ai_drafting_enabled', 'ai_auto_draft_positive',
    'ai_auto_draft_negative', 'default_review_request_template', 'review_link_base_url'
  ];

  const setClause = [];
  const params = [clientId];
  let paramIndex = 2;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClause.push(`${key} = $${paramIndex++}`);
      params.push(Array.isArray(value) ? JSON.stringify(value) : value);
    }
  }

  if (setClause.length === 0) {
    return getReviewSettings(clientId);
  }

  const { rows } = await query(`
    INSERT INTO review_settings (client_id, ${Object.keys(updates).filter(k => allowedFields.includes(k)).join(', ')})
    VALUES ($1, ${params.slice(1).map((_, i) => `$${i + 2}`).join(', ')})
    ON CONFLICT (client_id) DO UPDATE SET
      ${setClause.join(', ')},
      updated_at = NOW()
    RETURNING *
  `, params);

  return rows[0];
}

// ============================================================================
// Automation Logging
// ============================================================================

/**
 * Log an automation action
 */
async function logAutomationAction({
  clientId,
  reviewId = null,
  ruleId = null,
  draftId = null,
  actionType,
  actionStatus,
  aiModel = null,
  aiInput = {},
  aiOutput = {},
  aiTokensUsed = null,
  aiLatencyMs = null,
  humanActionBy = null,
  humanNotes = null,
  errorMessage = null,
  metadata = {}
}) {
  await query(`
    INSERT INTO review_automation_logs (
      client_id, review_id, rule_id, draft_id, action_type, action_status,
      ai_model, ai_input, ai_output, ai_tokens_used, ai_latency_ms,
      human_action_by, human_notes, error_message, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  `, [
    clientId, reviewId, ruleId, draftId, actionType, actionStatus,
    aiModel, JSON.stringify(aiInput), JSON.stringify(aiOutput),
    aiTokensUsed, aiLatencyMs, humanActionBy, humanNotes, errorMessage,
    JSON.stringify(metadata)
  ]);
}

/**
 * Get automation logs for a client
 */
export async function getAutomationLogs(clientId, options = {}) {
  const { page = 1, limit = 50, reviewId = null, actionType = null } = options;
  const offset = (page - 1) * limit;

  let whereClause = 'WHERE client_id = $1';
  const params = [clientId];

  if (reviewId) {
    whereClause += ` AND review_id = $${params.length + 1}`;
    params.push(reviewId);
  }

  if (actionType) {
    whereClause += ` AND action_type = $${params.length + 1}`;
    params.push(actionType);
  }

  const { rows: countRows } = await query(
    `SELECT COUNT(*) as total FROM review_automation_logs ${whereClause}`,
    params
  );
  const total = parseInt(countRows[0].total, 10);

  const { rows } = await query(`
    SELECT * FROM review_automation_logs
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, limit, offset]);

  return {
    logs: rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  };
}

// ============================================================================
// Exports
// ============================================================================

export default {
  // Google API
  fetchGoogleLocations,
  fetchGoogleReviews,
  replyToGoogleReview,
  deleteGoogleReviewReply,
  
  // Sync
  syncReviewsForClient,
  
  // Reviews CRUD
  getClientReviews,
  getReviewById,
  toggleReviewFlag,
  updateReviewPriority,
  updateReviewNotes,
  
  // Response Management
  generateReviewResponse,
  regenerateReviewResponse,
  sendReviewResponse,
  approveDraft,
  discardDraft,
  updateDraftText,
  
  // Sentiment
  analyzeReviewSentiment,
  
  // Review Requests
  createReviewRequest,
  getClientReviewRequests,
  
  // Statistics
  getReviewStatistics,
  
  // Settings
  getReviewSettings,
  updateReviewSettings,
  
  // Automation
  getAutomationLogs,
  
  // OAuth Connection Status
  getOAuthConnectionStatus
};

