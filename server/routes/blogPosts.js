/**
 * Blog Posts API Routes
 *
 * Extracted from server/routes/hub.js. Mounted at /api/hub by server/index.js
 * so all paths here are relative to that prefix (e.g. /blog-posts → /api/hub/blog-posts).
 */

import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { generateAiResponse } from '../services/ai.js';
import { generateImagenImage } from '../services/imagen.js';
import { createNotification } from '../services/notifications.js';
import { sendMailgunMessageWithLogging, isMailgunConfigured } from '../services/mailgun.js';
import { logEvent, resolveBaseUrl } from '../services/hubUtils.js';

const router = express.Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function resolveAccountManagerContact(userId) {
  if (!userId) return null;
  const { rows } = await query(
    `SELECT u.id,
            u.email,
            u.first_name,
            u.last_name,
            cp.account_manager_user_id
     FROM users u
     LEFT JOIN client_profiles cp ON cp.user_id = u.id
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );
  const client = rows[0];
  if (!client) return null;
  const clientName =
    [client.first_name, client.last_name].filter(Boolean).join(' ').trim() || client.email || 'Client';

  let managerEmail = null;
  let managerName = null;
  let notificationUserId = null;

  if (client.account_manager_user_id) {
    const { rows: managerRows } = await query(
      'SELECT id, email, first_name, last_name FROM users WHERE id = $1 LIMIT 1',
      [client.account_manager_user_id]
    );
    if (managerRows.length) {
      const m = managerRows[0];
      managerEmail = m.email || null;
      managerName = [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || null;
      notificationUserId = m.id;
    }
  }

  if (!managerEmail || !notificationUserId) {
    const { rows: adminRows } = await query(
      "SELECT id, email, first_name, last_name FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1"
    );
    if (adminRows.length) {
      if (!managerEmail) managerEmail = adminRows[0].email;
      if (!notificationUserId) notificationUserId = adminRows[0].id;
      if (!managerName) {
        managerName = [adminRows[0].first_name, adminRows[0].last_name].filter(Boolean).join(' ').trim() || 'Admin Team';
      }
    }
  }

  if (!managerEmail && !notificationUserId) return { client, clientName };

  return { client, clientName, managerEmail, managerName, notificationUserId };
}

async function notifyAccountManagerOfBlogPost(userId, blogPost, baseUrl) {
  if (!userId || !blogPost) return;
  const contact = await resolveAccountManagerContact(userId);
  if (!contact) return;
  const { clientName, managerEmail, managerName, notificationUserId, client } = contact;
  if (!managerEmail && !notificationUserId) return;

  const blogTitle = blogPost.title || 'Untitled Blog Post';
  const statusLabel = blogPost.status || 'draft';
  const emailText = `Hi ${managerName || 'there'},

${clientName} just created a new blog post titled "${blogTitle}" (status: ${statusLabel}).

You can review it inside the Anchor admin hub.

- Anchor Dashboard`;
  const resolvedBaseUrl = baseUrl || 'http://localhost:3000';
  const emailHtml = `<p>Hi ${managerName || 'there'},</p>
<p><strong>${clientName}</strong> just created a new blog post titled <strong>${blogTitle}</strong> (status: ${statusLabel}).</p>
<p><a href="${resolvedBaseUrl}/admin" target="_blank" rel="noopener">Open the admin hub</a> to review it.</p>
<p>- Anchor Dashboard</p>`;

  if (notificationUserId) {
    await createNotification({
      userId: notificationUserId,
      title: 'New client blog post',
      body: `${clientName} created "${blogTitle}" (${statusLabel}).`,
      linkUrl: '/admin',
      meta: { blog_post_id: blogPost.id, client_id: client.id, status: statusLabel }
    });
  }

  if (managerEmail && isMailgunConfigured()) {
    await sendMailgunMessageWithLogging(
      {
        to: managerEmail,
        subject: `${clientName} just created a new blog post`,
        text: emailText,
        html: emailHtml
      },
      {
        emailType: 'blog_notification',
        clientId: client.id,
        metadata: { blog_post_id: blogPost.id, status: statusLabel }
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// List user's blog posts
router.get('/blog-posts', async (req, res) => {
  const userId = req.portalUserId || req.user.id;
  try {
    const { rows } = await query('SELECT * FROM blog_posts WHERE user_id = $1 ORDER BY updated_at DESC', [userId]);
    res.json({ blog_posts: rows });
  } catch (err) {
    logEvent('blog:list', 'Error fetching blog posts', { error: err.message, userId });
    res.status(500).json({ message: 'Unable to fetch blog posts' });
  }
});

// Get a single blog post
router.get('/blog-posts/:id', async (req, res) => {
  const userId = req.portalUserId || req.user.id;
  const { id } = req.params;
  try {
    const { rows } = await query('SELECT * FROM blog_posts WHERE id = $1 AND user_id = $2', [id, userId]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Blog post not found' });
    }
    res.json({ blog_post: rows[0] });
  } catch (err) {
    logEvent('blog:get', 'Error fetching blog post', { error: err.message, userId, id });
    res.status(500).json({ message: 'Unable to fetch blog post' });
  }
});

// Create a new blog post
router.post('/blog-posts', async (req, res) => {
  const userId = req.portalUserId || req.user.id;
  const { title, content, status = 'draft' } = req.body;

  if (!title || !content) {
    return res.status(400).json({ message: 'Title and content are required' });
  }

  try {
    const published_at = status === 'published' ? new Date() : null;
    const { rows } = await query(
      `INSERT INTO blog_posts (user_id, title, content, status, published_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, title, content, status, published_at]
    );
    const newPost = rows[0];
    try {
      await notifyAccountManagerOfBlogPost(userId, newPost, resolveBaseUrl(req));
    } catch (notifyErr) {
      console.error('[blog:notify]', notifyErr.message || notifyErr);
    }
    logEvent('blog:create', 'Blog post created', { userId, id: newPost.id });
    res.json({ blog_post: newPost });
  } catch (err) {
    logEvent('blog:create', 'Error creating blog post', { error: err.message, userId });
    res.status(500).json({ message: 'Unable to create blog post' });
  }
});

// Update a blog post
router.put('/blog-posts/:id', async (req, res) => {
  const userId = req.portalUserId || req.user.id;
  const { id } = req.params;
  const { title, content, status } = req.body;

  try {
    // Check if the blog post belongs to the user
    const check = await query('SELECT id FROM blog_posts WHERE id = $1 AND user_id = $2', [id, userId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Blog post not found' });
    }

    const updates = [];
    const params = [id, userId];
    let paramIndex = 3;

    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      params.push(title);
    }
    if (content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      params.push(content);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      params.push(status);

      if (status === 'published') {
        updates.push(`published_at = COALESCE(published_at, NOW())`);
      }
    }

    updates.push('updated_at = NOW()');

    const { rows } = await query(`UPDATE blog_posts SET ${updates.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING *`, params);

    logEvent('blog:update', 'Blog post updated', { userId, id });
    res.json({ blog_post: rows[0] });
  } catch (err) {
    logEvent('blog:update', 'Error updating blog post', { error: err.message, userId, id });
    res.status(500).json({ message: 'Unable to update blog post' });
  }
});

// Delete a blog post
router.delete('/blog-posts/:id', async (req, res) => {
  const userId = req.portalUserId || req.user.id;
  const { id } = req.params;

  try {
    const { rowCount } = await query('DELETE FROM blog_posts WHERE id = $1 AND user_id = $2', [id, userId]);

    if (rowCount === 0) {
      return res.status(404).json({ message: 'Blog post not found' });
    }

    logEvent('blog:delete', 'Blog post deleted', { userId, id });
    res.json({ success: true });
  } catch (err) {
    logEvent('blog:delete', 'Error deleting blog post', { error: err.message, userId, id });
    res.status(500).json({ message: 'Unable to delete blog post' });
  }
});

// AI: Generate blog post ideas
router.post('/blog-posts/ai/ideas', async (req, res) => {
  const userId = req.portalUserId || req.user.id;

  try {
    // Get user's business info and services
    const brandResult = await query(
      'SELECT business_name, business_description, website_url FROM brand_assets WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    const servicesResult = await query(
      "SELECT COALESCE(name, '') AS name, COALESCE(description, '') AS description FROM services WHERE user_id = $1 AND active = true",
      [userId]
    );

    const businessName = brandResult.rows[0]?.business_name?.trim() || 'Your Business';
    const businessDescription = brandResult.rows[0]?.business_description?.trim() || 'A growing service provider.';
    const websiteUrl = brandResult.rows[0]?.website_url?.trim() || 'https://example.com';
    const servicesList = servicesResult.rows
      .map((s) => (s.name ? `${s.name}${s.description ? ` - ${s.description}` : ''}` : ''))
      .filter(Boolean);
    const servicesText = servicesList.length
      ? servicesList.map((line, idx) => `${idx + 1}. ${line}`).join('\n')
      : 'No services have been configured yet.';

    const prompt = `You are an experienced marketing copywriter.
Business Name: ${businessName}
Business Description: ${businessDescription}
Website: ${websiteUrl}
Service List:
${servicesText}

Generate 10 SEO-friendly blog post title ideas that would be valuable for this exact business and its services.
Return the titles only, one per line, without numbering or bullet characters.`;

    logEvent('blog:ai:ideas', 'Prompt built', { userId, prompt });
    const responseText = await generateAiResponse({
      prompt,
      systemPrompt: 'You are an experienced marketing copywriter who produces catchy, SEO-friendly blog titles.',
      temperature: 0.65,
      maxTokens: 400
    });

    const ideas = responseText
      .split('\n')
      .map((line) => line.replace(/^\d+[\).\s-]+/, '').trim())
      .filter(Boolean);

    logEvent('blog:ai:ideas', 'Generated blog ideas', { userId, count: ideas.length });
    res.json({ ideas });
  } catch (err) {
    logEvent('blog:ai:ideas', 'Error generating ideas', { error: err.message, userId });
    res.status(500).json({ message: 'Unable to generate blog ideas' });
  }
});

// AI: Write a draft blog post
router.post('/blog-posts/ai/draft', async (req, res) => {
  const userId = req.portalUserId || req.user.id;
  const { title } = req.body;

  if (!title) {
    return res.status(400).json({ message: 'Title is required' });
  }

  try {
    // Get user's business info
    const brandResult = await query(
      'SELECT business_name, business_description, website_url FROM brand_assets WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    const servicesResult = await query(
      "SELECT COALESCE(name, '') AS name, COALESCE(description, '') AS description FROM services WHERE user_id = $1 AND active = true",
      [userId]
    );

    const businessName = brandResult.rows[0]?.business_name?.trim() || 'Your Business';
    const businessDescription = brandResult.rows[0]?.business_description?.trim() || 'A growing service provider.';
    const websiteUrl = brandResult.rows[0]?.website_url?.trim() || 'https://example.com';
    const servicesList = servicesResult.rows
      .map((s) => (s.name ? `${s.name}${s.description ? ` - ${s.description}` : ''}` : ''))
      .filter(Boolean);
    const servicesText = servicesList.length
      ? servicesList.map((line, idx) => `${idx + 1}. ${line}`).join('\n')
      : 'No services have been configured yet.';

    const prompt = `Write a comprehensive, SEO-optimized blog post with the following specifications:

Title: ${title}

Business Context:
- Business Name: ${businessName}
- Business Description: ${businessDescription}
- Website: ${websiteUrl}
- Services:
${servicesText}

Requirements:
1. Write in HTML format suitable for a blog
2. Include proper heading tags (h2, h3) for structure
3. Write 800-1200 words
4. Optimize for SEO with natural keyword placement
5. Include a compelling introduction and conclusion
6. Use paragraphs (<p> tags) for readability
7. Do NOT include internal links (no placeholder URLs, no assumed sitemap). If you add links, they must be outbound and only if you are confident they are real, evergreen URLs; otherwise omit links entirely.
8. Do NOT include image placeholders (no "Image:", "Illustration:", "Insert image here", etc.). If you want to suggest imagery, add an HTML comment at the end like: <!-- Image suggestion: ... -->.
9. Make it engaging and valuable to readers

Write the complete blog post content in HTML:`;

    const maxTokens = Number.parseInt(process.env.BLOG_DRAFT_MAX_TOKENS || '4096', 10);
    logEvent('blog:ai:draft', 'Prompt built', { userId, promptLength: prompt.length, maxTokens });
    const content = await generateAiResponse({
      prompt,
      systemPrompt: 'You are an expert marketing copywriter who produces long-form, SEO optimized HTML blog posts.',
      temperature: 0.55,
      // 1500 was too small and could truncate mid-sentence; keep this configurable via env.
      maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 4096
    });

    logEvent('blog:ai:draft', 'Generated blog draft', { userId, title });
    res.json({ content });
  } catch (err) {
    logEvent('blog:ai:draft', 'Error generating draft', { error: err.message, userId });
    res.status(500).json({ message: 'Unable to generate blog draft' });
  }
});

// AI: Generate a hero image for a blog post (Imagen)
router.post('/blog-posts/ai/image', async (req, res) => {
  const userId = req.portalUserId || req.user.id;
  const { title, style = 'clean, modern, professional', aspectRatio = '16:9' } = req.body || {};

  if (!title) return res.status(400).json({ message: 'Title is required' });

  try {
    const brandResult = await query(
      'SELECT business_name, business_description, website_url FROM brand_assets WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    const businessName = brandResult.rows[0]?.business_name?.trim() || 'Your Business';
    const businessDescription = brandResult.rows[0]?.business_description?.trim() || '';

    const prompt = `Create a high-quality blog hero image.

Topic: ${title}
Brand/Business: ${businessName}
Context: ${businessDescription}

Style: ${style}

Constraints:
- No text in the image.
- No logos or brand marks.
- Photorealistic or tasteful illustration is fine.
- Suitable as a website hero/banner image.`;

    const { mimeType, bytesBase64Encoded } = await generateImagenImage({
      prompt,
      aspectRatio: String(aspectRatio || '16:9'),
      sampleCount: 1
    });

    const dataUrl = `data:${mimeType};base64,${bytesBase64Encoded}`;
    res.json({ dataUrl, mimeType });
  } catch (err) {
    console.error('[blog:ai:image]', err);
    res.status(500).json({ message: err.message || 'Unable to generate image' });
  }
});

export default router;
