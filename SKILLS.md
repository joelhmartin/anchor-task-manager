# Anchor Client Dashboard - Application Skills & Capabilities

> ⚠️ **MAINTENANCE REMINDERS**:
> - **Database Changes**: When making database schema changes (adding tables, columns, indexes), **ALWAYS update the Database Schema Map section** at the bottom of this file to keep it synchronized with `server/sql/init.sql`.
> - **Package Installs**: When adding or updating npm packages, **ALWAYS run `yarn install`** to update `yarn.lock`, then commit both `package.json` and `yarn.lock`. Cloud Build uses `--immutable` and will fail if the lockfile is out of sync.

## Overview

The Anchor Client Dashboard is a comprehensive CRM and client management platform designed for service businesses. It integrates call tracking, lead management, client onboarding, task management, and content creation into a unified dashboard.

---

## 📚 Related Documentation

| Document | Description |
|----------|-------------|
| [README.md](README.md) | Project overview and quick start |
| [docs/SETUP.md](docs/SETUP.md) | Development environment setup |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture and design patterns |
| [docs/DATA_FLOWS.md](docs/DATA_FLOWS.md) | Business workflow documentation |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | Complete API endpoint documentation |
| [docs/SECURITY.md](docs/SECURITY.md) | Authentication and security architecture |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Third-party integration guides |

---

## 🎯 Core Capabilities

### 1. Lead Management (CTM + Twilio Integration)

**Call Tracking Providers**

The platform supports two call tracking providers:

1. **CallTrackingMetrics (CTM)** - Pull-based integration
   - Pulls calls from CTM with paginated incremental sync
   - Two-way rating sync (changes in CTM reflect in the app and vice versa)

2. **Twilio** - Push-based integration (webhooks)
   - Real-time call handling via webhooks
   - Tracking number management (purchase, configure, release)
   - Call recording and transcription via Twilio Intelligence
   - Full attribution tracking (GCLID, Facebook Pixel, UTMs)

**Unified Lead Pipeline**

Both call providers and form submissions feed into the same lead pipeline:
- Automatic AI classification using Vertex AI (Gemini)
- Manual classification override capability
- Same categories, star ratings, and pipeline stages for all lead sources

**Lead Categories**

> **Note:** The `converted` category is **manual only** - it is not assigned by AI classification. It is set when a user marks a lead as 5 stars or uses "Agreed to Service".

| Category | Description | Star Rating | AI-Assigned? |
|----------|-------------|-------------|--------------|
| `converted` | Agreed to purchase/book service | ⭐⭐⭐⭐⭐ | ❌ Manual only |
| `warm` | Promising lead interested in services | ⭐⭐⭐ | ✅ |
| `very_good` | Ready to book/buy now | ⭐⭐⭐⭐ | ✅ |
| `needs_attention` | Left voicemail requesting callback | ⭐⭐⭐ | ✅ |
| `voicemail` | Voicemail with no actionable details | — | ✅ |
| `unanswered` | No conversation occurred | — | ✅ |
| `not_a_fit` | Not a fit for services | ⭐⭐ | ✅ |
| `spam` | Telemarketer, robocall, irrelevant | ⭐ | ✅ |
| `neutral` | General inquiry, unclear intent | — | ✅ |
| `applicant` | Job/employment inquiry only | — | ✅ |
| `unreviewed` | Default state, not yet classified | — | ✅ (default) |

**Lead Features**

- Star rating system (1-5 stars, synced with CTM)
- Custom tagging system
- Transcript viewing
- Call history by phone number
- Repeat caller detection ("Repeat Caller" / "Returning Customer" badges)
- Lead notes and communication logs
- Saved filter views
- CSV export
- Pipeline stage management
- **Reclassify Leads**: Admin feature to re-run AI classification on existing leads without re-fetching from CTM (visible in leads list when admin is in client view mode)

---

### 2. Client Journey Management

**Journey Workflow**

- Create journeys from leads with assigned services/concerns
- Multi-journey support (same client can have multiple journeys)
- Step-based progress tracking
- Step-level notes
- Timeline view of journey events
- Status management: `pending`, `in_progress`, `active_client`, `won`, `lost`, `archived`

**Journey Templates**

- Create reusable journey templates
- Apply templates to new journeys
- Customize steps per client

**Active Client Conversion**

- Convert journeys to active clients
- Link calls to existing active clients
- Track services agreed to with dates

---

### 3. Client Onboarding

**Multi-Step Wizard**

- Profile setup (name, email, password, phone, communication preferences)
- Services selection
- Brand assets upload (logo, style guides)
- Website access credentials
- Google Analytics 4 access
- Google Ads access
- Meta/Facebook access
- Website forms configuration

**Onboarding Features**

- Token-based secure onboarding links (30-day expiration)
- "Save and Continue Later" functionality
- Progress persistence across sessions
- Account activation by admin
- Onboarding completion emails with PDF attachment
- Automatic reminders for incomplete onboarding
- Type-specific questionnaires (e.g., Dental Market Research & SEO intake)
- Dynamic onboarding steps based on client type/subtype

---

### 4. Admin Hub

**User Management**

- Create/edit/delete admin users
- Create/edit/delete client accounts
- Role management: `superadmin`, `admin`, `team`, `client`, `editor`
- "Act as Client" mode for admins

**Client Configuration**

- Client type presets (Medical, Home Service, Food Service, Other)
- Subtype-specific configurations:
  - **Medical**: Dental, TMJ & Sleep, Med Spa, Chiropractic
  - **Home Service**: Roofing, Plumbing, HVAC, Landscaping/Hardscaping
  - **Food Service**: General
- Custom AI classification prompts
- CTM credentials configuration
- Monday.com integration settings
- Service package management

**Email Logs**

- View all client-facing emails sent from the system
- Email status tracking (sent, failed)
- Full email content viewing
- 30-day statistics summary

**User Activity Logs**

- Comprehensive audit trail for all user actions (admin-only visibility)
- Tracks: logins/logouts, client views/edits, task operations, document uploads, review responses
- Accessible via "Activity Log" tab in client drawer
- Search and filter by category, date range
- Paginated results (50 per page)
- Automatic 30-day data retention with daily cleanup cron job

---

### 5. Document Management

**Client Documents**

- Upload/download client-specific documents
- Mark documents as viewed
- Admin review and approval workflow

**Shared Documents**

- Admin-uploaded documents shared with all clients
- Drag-and-drop reordering
- Category/title management

---

### 6. Brand Asset Management

- Logo upload and storage
- Style guide uploads (PDFs, images)
- Brand color specifications
- Font preferences
- Persistent storage in PostgreSQL (survives deployments)

---

### 7. Task Management

**Task Features**

- Create tasks with title, description, status
- Task assignment
- Due date tracking
- Status workflow: pending → in_progress → complete
- Task attachments

**Monday.com Integration**

- Sync tasks with Monday.com boards
- Board/group configuration per client
- Column mapping

---

### 8. Blog/Content Management

**Blog Editor**

- Rich text editing
- AI-powered content generation (Vertex AI)
- Draft/publish workflow
- Client-specific blogs

**AI Features**

- Blog post generation from prompts
- Content optimization suggestions
- Image generation (Vertex Imagen)

---

### 9. Forms & Lead Capture

**Form Builder**

- Create forms from global presets or custom configuration
- Form types: `conversion` (standard) and `intake` (PHI-enabled)
- Field customization (labels, required, validation)
- Preview and publish workflow
- Version history

**Global Form Presets**

- System presets: Contact Form, Request Appointment, Free Consultation, Patient Intake
- Admin can create/edit custom presets
- System presets cannot be deleted

**Embeddable Forms**

- Generate embed code for client websites
- Forms rendered in Shadow DOM for style isolation
- Attribution capture (UTMs, GCLID, FBCLID)
- Seamless integration with universal tracking script

**Form Submissions**

- All submissions create unified lead entries (same as calls)
- AI classification of form content
- PHI encryption for intake forms (AES-256-GCM)
- Attribution linking to form submissions
- Email notifications on submission

---

### 10. Analytics & Reporting

**Looker Integration**

- Embedded Looker dashboards
- Client-specific analytics URLs

**Lead Statistics**

- Category breakdown
- Conversion funnel visualization
- Source tracking

---

### 11. Reviews Management (Google Business Profile)

**Review Dashboard**

- Centralized view of all Google reviews
- Filtering by rating, response status, priority, sentiment
- Search functionality across reviews
- Pagination with configurable page size
- Statistics cards showing key metrics

**Review Response System**

- Manual response composition
- AI-assisted response drafting using Google Vertex AI
- Tone selection: Professional, Friendly, Casual, Formal, Empathetic
- Response preview and editing
- One-click send after human review
- Draft history tracking

**Review Management**

- Priority levels: Low, Normal, High, Urgent
- Flagging system for reviews needing attention
- Auto-flag reviews at or below configurable rating threshold
- Internal notes per review
- Sentiment analysis (Positive, Neutral, Negative, Mixed)

**Review Request Workflow**

- Generate review request links
- Multiple delivery methods: Email, SMS, Link copy
- Customer information tracking
- Request status tracking
- Campaign management support

**AI Automation (Future-Ready)**

- Automation rules engine (designed but not auto-enabled)
- Configurable triggers: Rating range, sentiment, keywords
- Action types: Draft, Auto-send, Flag, Notify
- Human approval gates for negative reviews
- Rate limiting (hourly/daily limits)
- Full audit trail of AI actions

**Business Context Integration**

- Pulls business name and description from brand assets
- Reviewer name personalization
- Configurable response signature
- Multi-location support via OAuth resources

---

## 🔧 Technical Capabilities

### Authentication & Security

**Token-Based Session Management**

- Short-lived JWT access tokens (15 minutes)
- Rotating refresh tokens with reuse detection
- Absolute session lifetime (90 days)
- Session revocation on security events (password change, MFA change)
- Device fingerprinting and tracking

**Multi-Factor Authentication (MFA)**

- Conditional MFA based on risk signals
- Email OTP (6-digit, 10-minute expiry)
- Trusted device management (30-day trust window)
- MFA triggers: new device, new IP/country, inactivity

**Password Security**

- Argon2id password hashing (bcrypt fallback for migration)
- Strong password policy (12+ chars, complexity requirements)
- Automatic hash upgrade on login

**OAuth 2.0 Support (Architecture Ready)**

- Google OAuth integration
- Microsoft 365 OAuth integration
- Provider MFA trust (no app-level MFA for OAuth users)

**Rate Limiting & Brute Force Protection**

- IP-based and user-based rate limiting
- Account lockout after repeated failures
- Automatic lockout expiry

**Security Audit Logging**

- Immutable security event log
- Login attempts, MFA challenges, session events
- Compliance-ready (SOC 2, HIPAA aligned)

**Legacy Support**

- Role-based access control (RBAC): superadmin, admin, team, editor, client
- Secure onboarding tokens with expiration
- Content Security Policy (CSP) headers
- CORS configuration

### API Architecture

- RESTful API design
- Express.js backend
- PostgreSQL database
- File upload handling (Multer)
- Rate limiting

### Integrations

| Service                   | Purpose                                                   |
| ------------------------- | --------------------------------------------------------- |
| CallTrackingMetrics (CTM) | Call data and scoring                                     |
| Monday.com                | Task management sync                                      |
| Mailgun                   | Transactional emails                                      |
| Google Vertex AI          | Content generation, call classification, review responses |
| Google Vertex Imagen      | Image generation                                          |
| Google Business Profile   | Review management and responses                           |
| Looker                    | Analytics dashboards                                      |

### Deployment

- Cloud Run optimized
- Automatic database migrations
- Environment-based configuration
- Static asset caching with immutable headers
- Health check endpoint

---

## 📱 User Roles & Permissions

| Role         | Capabilities                               |
| ------------ | ------------------------------------------ |
| `superadmin` | Full system access, all admin features     |
| `admin`      | Client management, settings, act-as-client |
| `team`       | Task management, limited admin             |
| `editor`     | Content editing, client view               |
| `client`     | Own portal access only                     |

---

## 🎨 UI/UX Features

- Material-UI (MUI) component library
- Responsive design
- Dark/light theme support
- Toast notifications
- Drawer-based detail views
- Tabbed interfaces
- Drag-and-drop support
- Keyboard shortcuts
- Error boundaries with auto-reload for chunk failures

---

## 📁 Service Type Presets

### Medical

- **Dental**: Exams, whitening, implants, root canals, Invisalign, crowns, emergency, pediatric, cosmetic, periodontal
- **TMJ & Sleep**: TMJ, CPAP, sleep apnea, appliances, pediatric, Nightlase, sleep study, Nuvola, Botox, oral surgery
- **Med Spa**: Botox & fillers, microneedling, laser hair removal, Hydrafacial, chemical peel, CoolSculpting, IPL, body contouring
- **Chiropractic**: Spinal adjustment, posture correction, sports injury, prenatal, massage, corrective exercises, pain relief

### Home Service

- **Roofing**: Inspection, repair, replacement, storm damage, gutters, skylights
- **Plumbing**: Drain cleaning, water heater, tankless install, pipe replacement, leak detection, sewer line
- **HVAC**: AC install/repair, furnace install/repair, heat pump, duct cleaning, tune-up
- **Landscaping**: Landscape design, lawn maintenance, patio & pavers, retaining walls, lighting, irrigation, tree care, sod, hardscape, seasonal cleanup

### Food Service

- General catering and hospitality

---

## 🔄 Scheduled Jobs

| Job                        | Schedule        | Purpose                                  |
| -------------------------- | --------------- | ---------------------------------------- |
| Onboarding reminders       | Daily           | Send reminders for incomplete onboarding |
| Task cleanup               | Daily           | Archive completed tasks after 30 days    |
| Service redaction          | Daily           | Redact old service records after 90 days |
| Form submission processing | Every 2 minutes | Process queued form submissions          |
| Due date automations       | Every 5 minutes | Update task statuses based on due dates  |

---

## 📧 Email Types

- Onboarding invitations
- Onboarding completion confirmations
- Password reset requests
- Account activation notices
- Document review requests
- Blog post notifications
- Rush job requests
- Form submission notifications
- Onboarding reminders

---

## 🗄️ Database Schema Map

> ⚠️ **IMPORTANT**: This section must be kept in sync with `server/sql/init.sql`. When adding/modifying tables or columns, update this documentation.

### Core User Tables

#### `users`

Primary user accounts for all roles.

| Column          | Type        | Description                                       |
| --------------- | ----------- | ------------------------------------------------- |
| `id`            | UUID        | Primary key                                       |
| `first_name`    | VARCHAR(60) | User's first name                                 |
| `last_name`     | VARCHAR(60) | User's last name                                  |
| `email`         | CITEXT      | Unique email (case-insensitive)                   |
| `password_hash` | TEXT        | Bcrypt hashed password                            |
| `avatar_url`    | TEXT        | Optional avatar URL                               |
| `role`          | TEXT        | `superadmin`, `admin`, `team`, `editor`, `client` |
| `created_at`    | TIMESTAMPTZ | Account creation time                             |
| `updated_at`    | TIMESTAMPTZ | Last update time                                  |

#### `user_avatars`

Binary avatar storage (for Cloud Run persistence).

| Column         | Type        | Description                    |
| -------------- | ----------- | ------------------------------ |
| `user_id`      | UUID        | FK → users.id (PK)             |
| `content_type` | TEXT        | MIME type (e.g., `image/jpeg`) |
| `bytes`        | BYTEA       | Raw image data                 |
| `updated_at`   | TIMESTAMPTZ | Last update time               |

---

### Client Profile & Configuration

#### `client_profiles`

Extended client configuration and onboarding state.

| Column                             | Type          | Description                                        |
| ---------------------------------- | ------------- | -------------------------------------------------- |
| `user_id`                          | UUID          | FK → users.id (PK)                                 |
| `client_type`                      | TEXT          | `medical`, `home_service`, `food_service`, `other` |
| `client_subtype`                   | TEXT          | e.g., `dental`, `roofing`, `landscaping`           |
| `client_package`                   | TEXT          | Service package name                               |
| `looker_url`                       | TEXT          | Embedded Looker dashboard URL                      |
| **Contact Info**                   |               |                                                    |
| `call_tracking_main_number`        | TEXT          | Main CTM phone number                              |
| `front_desk_emails`                | TEXT          | Front desk email(s)                                |
| `office_admin_name`                | TEXT          | Office admin contact name                          |
| `office_admin_email`               | TEXT          | Office admin email                                 |
| `office_admin_phone`               | TEXT          | Office admin phone                                 |
| `form_email_recipients`            | TEXT          | Form submission recipients (legacy, comma-separated; set via onboarding) |
| `form_notification_emails`         | TEXT[]        | Practice-level form-notification recipients (added by `migrate_ctm_forms.sql`). Source for CTM autoresponder + journey-email default Reply-To |
| **CTM Integration**                |               |                                                    |
| `ctm_account_number`               | TEXT          | CTM account ID                                     |
| `ctm_api_key`                      | TEXT          | CTM API key                                        |
| `ctm_api_secret`                   | TEXT          | CTM API secret                                     |
| `ctm_sync_cursor`                  | TIMESTAMPTZ   | Last sync timestamp for incremental fetch          |
| `ctm_last_page_token`              | TEXT          | Pagination token for CTM sync                      |
| **Call Provider Configuration**    |               |                                                    |
| `call_provider`                    | TEXT          | `ctm` or `twilio` (default: `ctm`)                 |
| `twilio_config_id`                 | UUID          | FK → twilio_client_configs.id                      |
| **AI Configuration**               |               |                                                    |
| `ai_prompt`                        | TEXT          | Custom AI classification prompt                    |
| `auto_star_enabled`                | BOOLEAN       | Enable auto-star rating                            |
| **Onboarding Status Flags**        |               |                                                    |
| `website_access_status`            | TEXT          | `not_started`, `in_progress`, `complete`           |
| `ga4_access_status`                | TEXT          | GA4 access status                                  |
| `google_ads_access_status`         | TEXT          | Google Ads access status                           |
| `google_ads_account_id`            | TEXT          | Google Ads account ID                              |
| `meta_access_status`               | TEXT          | Meta/Facebook access status                        |
| `website_forms_details_status`     | TEXT          | Forms step status                                  |
| **Step Requirements (Admin)**      |               |                                                    |
| `requires_website_access`          | BOOLEAN       | Enable website access step                         |
| `requires_ga4_access`              | BOOLEAN       | Enable GA4 step                                    |
| `requires_google_ads_access`       | BOOLEAN       | Enable Google Ads step                             |
| `requires_meta_access`             | BOOLEAN       | Enable Meta step                                   |
| `requires_forms_step`              | BOOLEAN       | Enable forms step                                  |
| **Client Confirmations**           |               |                                                    |
| `website_access_provided`          | BOOLEAN       | Client provided website access                     |
| `website_access_understood`        | BOOLEAN       | Client confirmed understanding                     |
| `ga4_access_provided`              | BOOLEAN       | Client provided GA4 access                         |
| `ga4_access_understood`            | BOOLEAN       | Client confirmed GA4 understanding                 |
| `google_ads_access_provided`       | BOOLEAN       | Client provided Google Ads access                  |
| `google_ads_access_understood`     | BOOLEAN       | Client confirmed Google Ads understanding          |
| `meta_access_provided`             | BOOLEAN       | Client provided Meta access                        |
| `meta_access_understood`           | BOOLEAN       | Client confirmed Meta understanding                |
| `website_forms_details_provided`   | BOOLEAN       | Client provided form details                       |
| `website_forms_details_understood` | BOOLEAN       | Client confirmed forms understanding               |
| `website_forms_uses_third_party`   | BOOLEAN       | Uses third-party forms                             |
| `website_forms_uses_hipaa`         | BOOLEAN       | HIPAA-compliant forms                              |
| `website_forms_connected_crm`      | BOOLEAN       | Forms connected to CRM                             |
| `website_forms_custom`             | BOOLEAN       | Custom form implementation                         |
| `website_forms_notes`              | TEXT          | Additional form notes                              |
| **Monday.com Integration**         |               |                                                    |
| `monday_board_id`                  | TEXT          | Monday.com board ID                                |
| `monday_group_id`                  | TEXT          | Monday.com group ID                                |
| `monday_active_group_id`           | TEXT          | Active items group                                 |
| `monday_completed_group_id`        | TEXT          | Completed items group                              |
| `client_identifier_value`          | TEXT          | Client identifier for Monday                       |
| `account_manager_person_id`        | TEXT          | Account manager ID                                 |
| **Internal Task Manager**          |               |                                                    |
| `task_workspace_id`                | UUID          | FK → task_workspaces.id                            |
| `task_board_id`                    | UUID          | FK → task_boards.id                                |
| `board_prefix`                     | TEXT          | Board item prefix                                  |
| **Organization**                   |               |                                                    |
| `client_group_id`                  | UUID          | FK → client_groups.id (for grouping clients in admin view) |
| **Onboarding State**               |               |                                                    |
| `onboarding_completed_at`          | TIMESTAMPTZ   | When onboarding finished                           |
| `activated_at`                     | TIMESTAMPTZ   | When admin activated account                       |
| `onboarding_draft_json`            | JSONB         | Save & continue later state                        |
| `onboarding_draft_saved_at`        | TIMESTAMPTZ   | Last draft save time                               |
| `onboarding_questionnaire`         | JSONB         | Type-specific questionnaire responses (e.g., dental market research) |
| `monthly_revenue_goal`             | DECIMAL(10,2) | Revenue target                                     |
| `created_at`                       | TIMESTAMPTZ   | Profile creation time                              |
| `updated_at`                       | TIMESTAMPTZ   | Last update time                                   |

#### `client_groups`

Organizational groups for categorizing clients in the admin hub (accordion-style collapse/expand).

| Column       | Type        | Description                                     |
| ------------ | ----------- | ----------------------------------------------- |
| `id`         | UUID        | Primary key                                     |
| `name`       | TEXT        | Group name                                      |
| `description`| TEXT        | Optional group description                      |
| `color`      | TEXT        | Hex color for visual indicator                  |
| `icon`       | TEXT        | MUI icon name (e.g., 'Business', 'Store')       |
| `icon_url`   | TEXT        | URL to custom uploaded icon image               |
| `sort_order` | INTEGER     | Display order (default 0)                       |
| `created_at` | TIMESTAMPTZ | Creation timestamp                              |
| `updated_at` | TIMESTAMPTZ | Last update timestamp                           |

#### `brand_assets`

Client branding information and assets.

| Column                 | Type        | Description                                 |
| ---------------------- | ----------- | ------------------------------------------- |
| `id`                   | UUID        | Primary key                                 |
| `user_id`              | UUID        | FK → users.id                               |
| `business_name`        | TEXT        | Business name                               |
| `business_description` | TEXT        | Business description for AI context         |
| `primary_brand_colors` | TEXT        | Brand colors (hex codes)                    |
| `logos`                | JSONB       | Array of logo objects `[{name, url, type}]` |
| `style_guides`         | JSONB       | Array of style guide objects                |
| `brand_notes`          | TEXT        | Additional branding notes                   |
| `website_url`          | TEXT        | Client website URL                          |
| `updated_at`           | TIMESTAMPTZ | Last update time                            |

---

### Lead & Call Management (CTM + Twilio)

#### `call_logs`

Lead records from call tracking providers (CTM, Twilio) and form submissions.

| Column                | Type        | Description                                       |
| --------------------- | ----------- | ------------------------------------------------- |
| `id`                  | UUID        | Primary key                                       |
| `user_id`             | UUID        | FK → users.id (legacy, use owner_user_id)         |
| `owner_user_id`       | UUID        | FK → users.id (client owner)                      |
| `call_id`             | TEXT        | CTM call ID or Twilio Call SID (unique)           |
| `direction`           | TEXT        | `inbound`, `outbound`                             |
| `from_number`         | TEXT        | Caller phone number                               |
| `to_number`           | TEXT        | Called number                                     |
| `started_at`          | TIMESTAMPTZ | Call start time                                   |
| `duration_sec`        | INTEGER     | Call duration in seconds                          |
| `score`               | INTEGER     | Star rating (1-5)                                 |
| `meta`                | JSONB       | Provider data, AI classification, transcript      |
| `caller_type`         | TEXT        | `new`, `repeat`, `returning_customer`             |
| `call_sequence`       | INTEGER     | Nth call from this number                         |
| `active_client_id`    | UUID        | FK → active_clients.id (if linked)                |
| `pipeline_stage_id`   | UUID        | FK → lead_pipeline_stages.id                      |
| `provider`            | TEXT        | `ctm`, `twilio`, `form` (default: `ctm`)          |
| `provider_call_sid`   | TEXT        | Twilio Call SID (for Twilio calls)                |
| `recording_url`       | TEXT        | Direct recording URL                              |
| `tracking_number_id`  | UUID        | FK → twilio_tracking_numbers.id                   |
| `activity_type`       | TEXT        | `call`, `form` (default: `call`)                  |
| `created_at`          | TIMESTAMPTZ | Record creation time                              |

**Key `meta` JSONB fields:**

- `category`: AI classification (`converted`, `warm`, `very_good`, `needs_attention`, `voicemail`, `unanswered`, `not_a_fit`, `spam`, `neutral`, `applicant`, `unreviewed`)
- `classification_summary`: AI-generated summary
- `transcript`: Full call transcript text
- `transcript_url`: CTM transcript URL (CTM only)
- `recording_url`: Call recording URL
- `caller_name`: Caller's name from provider
- `form_id`, `form_name`: Form details (when activity_type is `form`)

#### `lead_pipeline_stages`

Custom pipeline stages for lead management.

| Column          | Type        | Description      |
| --------------- | ----------- | ---------------- |
| `id`            | UUID        | Primary key      |
| `owner_user_id` | UUID        | FK → users.id    |
| `name`          | TEXT        | Stage name       |
| `color`         | TEXT        | Hex color code   |
| `position`      | INTEGER     | Sort order       |
| `is_won_stage`  | BOOLEAN     | Marks won deals  |
| `is_lost_stage` | BOOLEAN     | Marks lost deals |
| `created_at`    | TIMESTAMPTZ | Creation time    |
| `updated_at`    | TIMESTAMPTZ | Last update time |

#### `lead_notes`

Communication log entries for leads.

| Column          | Type        | Description                               |
| --------------- | ----------- | ----------------------------------------- |
| `id`            | UUID        | Primary key                               |
| `owner_user_id` | UUID        | FK → users.id                             |
| `call_id`       | TEXT        | CTM call ID (not FK)                      |
| `author_id`     | UUID        | FK → users.id                             |
| `note_type`     | TEXT        | `note`, `call`, `email`, `sms`, `meeting` |
| `body`          | TEXT        | Note content                              |
| `metadata`      | JSONB       | Additional data                           |
| `created_at`    | TIMESTAMPTZ | Creation time                             |

#### `lead_saved_views`

Saved filter configurations.

| Column          | Type        | Description          |
| --------------- | ----------- | -------------------- |
| `id`            | UUID        | Primary key          |
| `owner_user_id` | UUID        | FK → users.id        |
| `name`          | TEXT        | View name            |
| `filters`       | JSONB       | Filter configuration |
| `is_default`    | BOOLEAN     | Default view flag    |
| `created_at`    | TIMESTAMPTZ | Creation time        |
| `updated_at`    | TIMESTAMPTZ | Last update time     |

#### `lead_tags`

Custom tags for organizing leads.

| Column          | Type        | Description                 |
| --------------- | ----------- | --------------------------- |
| `id`            | UUID        | Primary key                 |
| `owner_user_id` | UUID        | FK → users.id               |
| `name`          | TEXT        | Tag name (unique per owner) |
| `color`         | TEXT        | Hex color code              |
| `created_at`    | TIMESTAMPTZ | Creation time               |

#### `call_log_tags`

Junction table linking calls to tags.

| Column       | Type        | Description       |
| ------------ | ----------- | ----------------- |
| `id`         | UUID        | Primary key       |
| `call_id`    | TEXT        | CTM call ID       |
| `tag_id`     | UUID        | FK → lead_tags.id |
| `created_at` | TIMESTAMPTZ | Creation time     |

---

### Twilio Call Tracking

#### `twilio_client_configs`

Per-client Twilio credentials (encrypted at rest).

| Column           | Type        | Description                   |
| ---------------- | ----------- | ----------------------------- |
| `id`             | UUID        | Primary key                   |
| `client_user_id` | UUID        | FK → users.id (unique)        |
| `account_sid`    | TEXT        | Twilio Account SID (encrypted)|
| `auth_token`     | TEXT        | Twilio Auth Token (encrypted) |
| `twiml_app_sid`  | TEXT        | TwiML App SID                 |
| `webhook_secret` | TEXT        | Webhook signing secret        |
| `is_active`      | BOOLEAN     | Configuration active flag     |
| `created_at`     | TIMESTAMPTZ | Creation time                 |
| `updated_at`     | TIMESTAMPTZ | Last update time              |

#### `twilio_tracking_numbers`

Twilio tracking phone numbers.

| Column                  | Type        | Description                                    |
| ----------------------- | ----------- | ---------------------------------------------- |
| `id`                    | UUID        | Primary key                                    |
| `client_user_id`        | UUID        | FK → users.id                                  |
| `twilio_config_id`      | UUID        | FK → twilio_client_configs.id                  |
| `phone_number`          | TEXT        | Phone number (E.164 format, unique)            |
| `phone_number_sid`      | TEXT        | Twilio Phone Number SID                        |
| `friendly_name`         | TEXT        | Display name (e.g., "Google Ads - Main")       |
| `forward_to_number`     | TEXT        | Destination number for forwarding              |
| `source_type`           | TEXT        | `google_ads`, `facebook`, `tv`, `organic`      |
| `campaign_name`         | TEXT        | Campaign identifier                            |
| `recording_enabled`     | BOOLEAN     | Enable call recording (default: true)          |
| `transcription_enabled` | BOOLEAN     | Enable transcription (default: true)           |
| `is_active`             | BOOLEAN     | Number active flag                             |
| `created_at`            | TIMESTAMPTZ | Creation time                                  |

#### `call_attribution`

Attribution data linked to calls.

| Column           | Type        | Description                        |
| ---------------- | ----------- | ---------------------------------- |
| `id`             | UUID        | Primary key                        |
| `call_log_id`    | UUID        | FK → call_logs.id                  |
| `session_id`     | TEXT        | Attribution session ID             |
| `client_user_id` | UUID        | FK → users.id                      |
| `gclid`          | TEXT        | Google Click ID                    |
| `gbraid`         | TEXT        | Google App Campaign (Android)      |
| `wbraid`         | TEXT        | Google App Campaign (iOS)          |
| `fbclid`         | TEXT        | Facebook Click ID                  |
| `fbc`            | TEXT        | Facebook Cookie (click)            |
| `fbp`            | TEXT        | Facebook Cookie (browser)          |
| `utm_source`     | TEXT        | UTM source parameter               |
| `utm_medium`     | TEXT        | UTM medium parameter               |
| `utm_campaign`   | TEXT        | UTM campaign parameter             |
| `utm_content`    | TEXT        | UTM content parameter              |
| `utm_term`       | TEXT        | UTM term parameter                 |
| `landing_page_url`| TEXT       | First page visited                 |
| `referrer_url`   | TEXT        | HTTP referrer                      |
| `user_agent`     | TEXT        | Browser user agent                 |
| `ip_hash`        | TEXT        | Hashed IP address (privacy)        |
| `created_at`     | TIMESTAMPTZ | Creation time                      |

#### `attribution_sessions`

Website visitor sessions for attribution tracking.

| Column              | Type        | Description                              |
| ------------------- | ----------- | ---------------------------------------- |
| `id`                | UUID        | Primary key                              |
| `session_id`        | TEXT        | Unique session identifier                |
| `client_user_id`    | UUID        | FK → users.id                            |
| `tracking_number_id`| UUID        | FK → twilio_tracking_numbers.id          |
| `visitor_data`      | JSONB       | Additional visitor metadata              |
| `gclid`             | TEXT        | Google Click ID                          |
| `fbclid`            | TEXT        | Facebook Click ID                        |
| `utm_source`        | TEXT        | UTM source parameter                     |
| `landing_page`      | TEXT        | Landing page URL                         |
| `referrer`          | TEXT        | HTTP referrer                            |
| `expires_at`        | TIMESTAMPTZ | Session expiration (30 min)              |
| `call_log_id`       | UUID        | FK → call_logs.id (when call linked)     |
| `created_at`        | TIMESTAMPTZ | Creation time                            |

---

### Contacts (Contact Entity — Phase 1 foundation)

First-class person entity: **one row per person, per owner** (`owner_user_id` = the client/practice; a contact = a lead/patient who contacted them). Replaces ad-hoc phone-string matching. Populated at ingest by `resolveContact()` in `server/services/contacts.js` (phone primary, email secondary; phone↔email conflicts enqueue a merge candidate, never auto-merge). Phase 1 only **writes** `contact_id` — nothing reads it yet (reads migrate in a later phase behind the phone-match fallback). Design: `docs/superpowers/specs/2026-05-22-contact-entity-design.md`.

#### `contacts`

| Column             | Type        | Description                                                          |
| ------------------ | ----------- | ------------------------------------------------------------------- |
| `id`               | UUID        | Primary key                                                         |
| `owner_user_id`    | UUID        | FK → users.id (the client). Contacts are scoped per owner           |
| `display_name`     | TEXT        | Best-effort display name                                            |
| `first_name`       | TEXT        | Optional                                                            |
| `last_name`        | TEXT        | Optional                                                            |
| `primary_phone`    | TEXT        | Primary phone (display)                                             |
| `primary_email`    | TEXT        | Primary email (display)                                             |
| `lifecycle_state`  | TEXT        | Cached lifecycle (derived later; unused in Phase 1)                 |
| `sms_consent`      | BOOLEAN     | SMS opt-in (powers future CTM texting consent)                      |
| `sms_opted_out`    | BOOLEAN     | STOP/opt-out suppression                                            |
| `tags`             | JSONB       | Contact tags                                                        |
| `custom`           | JSONB       | Arbitrary contact info ("any and all")                              |
| `first_seen_at`    | TIMESTAMPTZ | First activity                                                      |
| `last_activity_at` | TIMESTAMPTZ | Most recent activity (monotonic)                                    |
| `created_at`       | TIMESTAMPTZ | Creation time                                                       |
| `updated_at`       | TIMESTAMPTZ | Last update                                                         |
| `archived_at`      | TIMESTAMPTZ | Soft delete                                                         |

#### `contact_phones` / `contact_emails`

Multi-value identity match keys (separate rows, not JSONB arrays, so unique indexes give O(1) matching).

- `contact_phones`: `(contact_id, owner_user_id, phone_digits10, phone_e164, is_primary)`. **UNIQUE (owner_user_id, phone_digits10)** — a phone maps to exactly one contact per owner.
- `contact_emails`: `(contact_id, owner_user_id, email CITEXT, is_primary)`. **UNIQUE (owner_user_id, email)**.

#### `contact_merge_candidates`

Captures phone↔email conflicts for human review (no auto-merge). The merge/split admin UI is Phase 4; v1 only inserts rows.

| Column             | Type        | Description                                            |
| ------------------ | ----------- | ------------------------------------------------------ |
| `id`               | UUID        | Primary key                                            |
| `owner_user_id`    | UUID        | FK → users.id                                          |
| `contact_id_keep`  | UUID        | FK → contacts.id (the phone match — winner)            |
| `contact_id_other` | UUID        | FK → contacts.id (the email match — other)             |
| `reason`           | TEXT        | e.g. `phone_email_conflict`                            |
| `detail`           | JSONB       | Triggering phone/email/name                            |
| `status`           | TEXT        | `pending` \| `merged` \| `dismissed`                   |
| `created_at`       | TIMESTAMPTZ | Creation time                                          |
| `resolved_at`      | TIMESTAMPTZ | When resolved                                          |
| `resolved_by`      | UUID        | FK → users.id                                          |

#### `contact_tags` (Phase 6 — segmentation)

Tags first-class **on the contact** (not just on activity), reusing the `lead_tags` catalog. Powers "everyone with tag X" + bulk segmentation. Managed via `/api/hub/contacts/:id/tags` and queried via `/api/hub/contacts/by-tag/:tagId`.

| Column          | Type        | Description                                          |
| --------------- | ----------- | ---------------------------------------------------- |
| `id`            | UUID        | Primary key                                          |
| `contact_id`    | UUID        | FK → contacts.id (composite owner-match FK)          |
| `owner_user_id` | UUID        | FK → users.id                                        |
| `tag_id`        | UUID        | FK → lead_tags.id                                    |
| `source`        | TEXT        | `user` (UI-applied) \| `system` (rolled up from activity) |
| `created_by`    | UUID        | FK → users.id                                        |
| `created_at`    | TIMESTAMPTZ | Creation time                                        |

UNIQUE `(contact_id, tag_id)`; index `(owner_user_id, tag_id)` for segmentation.

> **Note:** `call_logs`, `active_clients`, and `client_journeys` each gained a nullable `contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL` column (Phase 1), stamped at ingest.
>
> **`contacts` also has** (Phase 6) `email_opted_out BOOLEAN` + `email_unsubscribed_at TIMESTAMPTZ` (email-marketing consent, mirroring `sms_consent`/`sms_opted_out`). **Segment-by-service** needs no new table — query `client_journeys.service_id` + `contact_id`, or `client_services` → `active_clients.contact_id`.

### Client Journey & Active Clients

#### `active_clients`

Converted leads / current customers.

| Column            | Type        | Description                                              |
| ----------------- | ----------- | -------------------------------------------------------- |
| `id`              | UUID        | Primary key                                              |
| `owner_user_id`   | UUID        | FK → users.id                                            |
| `client_name`     | TEXT        | Client's name                                            |
| `client_phone`    | TEXT        | Client's phone                                           |
| `client_email`    | TEXT        | Client's email                                           |
| `source`          | TEXT        | Lead source                                              |
| `funnel_data`     | JSONB       | Conversion funnel data                                   |
| `status`          | TEXT        | `active`, `inactive`, `archived`                         |
| `converted_by`    | UUID        | FK → users.id — staff member who converted the journey   |
| `created_at`      | TIMESTAMPTZ | Creation time                                            |
| `updated_at`      | TIMESTAMPTZ | Last update time                                         |
| `archived_at`     | TIMESTAMPTZ | Archive timestamp                                        |

#### `client_journeys`

Client journey tracking records.

| Column              | Type        | Description                                                                                              |
| ------------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `id`                | UUID        | Primary key                                                                                              |
| `owner_user_id`     | UUID        | FK → users.id                                                                                            |
| `lead_call_id`      | UUID        | FK → call_logs.id                                                                                        |
| `lead_call_key`     | TEXT        | FK → call_logs.call_id                                                                                   |
| `active_client_id`  | UUID        | FK → active_clients.id                                                                                   |
| `service_id`        | UUID        | FK → services.id                                                                                         |
| `parent_journey_id` | UUID        | FK → client_journeys.id (for multi-journey)                                                              |
| `client_name`       | TEXT        | Client's name                                                                                            |
| `client_phone`      | TEXT        | Client's phone                                                                                           |
| `client_email`      | TEXT        | Client's email                                                                                           |
| `symptoms`          | JSONB       | Array of concerns/services                                                                               |
| `symptoms_redacted` | BOOLEAN     | Privacy redaction flag                                                                                   |
| `status`            | TEXT        | `active` (in pipeline), `converted` (became a client), `archived` (closed/lost)                          |
| `stage`             | TEXT        | Active pipeline stage: `first_touch`, `second_touch`, `third_touch`, `fourth_touch`, `awaiting_decision`; NULL when terminal (converted/archived) |
| `paused`            | BOOLEAN     | Journey paused flag                                                                                      |
| `next_action_at`    | TIMESTAMPTZ | Next scheduled action (NULL in redesign; retained for backward compat)                                   |
| `notes_summary`     | TEXT        | Summary of notes                                                                                         |
| `created_by`        | UUID        | FK → users.id — staff member who created the journey                                                     |
| `created_at`        | TIMESTAMPTZ | Creation time                                                                                            |
| `updated_at`        | TIMESTAMPTZ | Last update time                                                                                         |
| `archived_at`       | TIMESTAMPTZ | Archive timestamp                                                                                        |

#### `client_journey_activities`

Per-touch timeline for a journey (email, call, text, note, stage change). Introduced by the journey redesign; supersedes `client_journey_steps` and `client_journey_notes`.

| Column          | Type        | Description                                                                       |
| --------------- | ----------- | --------------------------------------------------------------------------------- |
| `id`            | UUID        | Primary key                                                                       |
| `journey_id`    | UUID        | FK → client_journeys.id                                                           |
| `owner_user_id` | UUID        | FK → users.id (journey owner)                                                     |
| `type`          | TEXT        | `email`, `call`, `text`, `note`, `stage_change`                                   |
| `stage_at`      | TEXT        | Journey stage at time of activity                                                 |
| `to_stage`      | TEXT        | Target stage (populated for `stage_change` type)                                 |
| `subject`       | TEXT        | Email subject (email activities)                                                  |
| `body`          | TEXT        | Message body / note content                                                       |
| `body_format`   | TEXT        | `html` or `text`                                                                  |
| `template_id`   | UUID        | FK → journey_email_templates.id (if templated)                                   |
| `scheduled_for` | TIMESTAMPTZ | Scheduled send time (NULL = sent immediately)                                     |
| `email_status`  | TEXT        | `scheduled`, `sent`, `failed`, `canceled`, `skipped`                              |
| `email_error`   | TEXT        | Error message on failure                                                          |
| `send_attempts` | INTEGER     | Number of send attempts                                                           |
| `created_by`    | UUID        | FK → users.id — staff member who created the activity                             |
| `created_at`    | TIMESTAMPTZ | Creation time                                                                     |
| `metadata`      | JSONB       | Additional context (e.g. call duration, delivery receipt)                         |

#### `journey_email_templates`

Reusable email templates per owner/client, used when sending journey email touches.

| Column               | Type        | Description                                                                            |
| -------------------- | ----------- | -------------------------------------------------------------------------------------- |
| `id`                 | UUID        | Primary key                                                                            |
| `owner_user_id`      | UUID        | FK → users.id                                                                          |
| `name`               | TEXT        | Template display name                                                                  |
| `subject`            | TEXT        | Default email subject                                                                  |
| `preheader`          | TEXT        | Preview text shown in email client inbox summary (before the message is opened)        |
| `body`               | TEXT        | Template body content                                                                  |
| `body_format`        | TEXT        | `html` or `text`                                                                       |
| `reply_to`           | TEXT[]      | Default Reply-To for sends using this template. Empty → falls back to the practice's `client_profiles.form_notification_emails` at send time. Overridable per send. |
| `attachments`        | JSONB       | Array of `{ file_id: UUID, name: string }` — files attached by default with template  |
| `sms_use_email_body` | BOOLEAN     | When true (default), SMS touch reuses email body instead of `sms_body`                 |
| `sms_body`           | TEXT        | Custom SMS message body (used when `sms_use_email_body` is false)                      |
| `sms_opt_out`        | TEXT        | Opt-out footer appended to outbound SMS messages                                       |
| `created_by`         | UUID        | FK → users.id — staff who created it                                                   |
| `created_at`         | TIMESTAMPTZ | Creation time                                                                          |
| `updated_at`         | TIMESTAMPTZ | Last update time                                                                       |
| `archived_at`        | TIMESTAMPTZ | Soft-delete timestamp                                                                  |

#### `client_journey_steps` _(vestigial — retained read-only)_

Individual steps within a journey. **Retired by the journey redesign.** No new rows are written; the step-based workflow is replaced by `client_journey_activities`. The `journey_template:*` app_settings keys are likewise vestigial.

| Column         | Type        | Description             |
| -------------- | ----------- | ----------------------- |
| `id`           | UUID        | Primary key             |
| `journey_id`   | UUID        | FK → client_journeys.id |
| `position`     | INTEGER     | Step order              |
| `label`        | TEXT        | Step name               |
| `channel`      | TEXT        | Communication channel   |
| `message`      | TEXT        | Message template        |
| `offset_weeks` | INTEGER     | Weeks offset from start |
| `due_at`       | TIMESTAMPTZ | Due date                |
| `completed_at` | TIMESTAMPTZ | Completion timestamp    |
| `notes`        | TEXT        | Step-level notes        |
| `created_at`   | TIMESTAMPTZ | Creation time           |

#### `client_journey_notes` _(superseded — retained read-only)_

Notes attached to journeys. Superseded by `client_journey_activities` (`type = 'note'`); retained for historical rows.

| Column       | Type        | Description             |
| ------------ | ----------- | ----------------------- |
| `id`         | UUID        | Primary key             |
| `journey_id` | UUID        | FK → client_journeys.id |
| `author_id`  | UUID        | FK → users.id           |
| `body`       | TEXT        | Note content            |
| `created_at` | TIMESTAMPTZ | Creation time           |

---

### Services & Client Services

#### `services`

Available services that can be offered to clients.

| Column        | Type          | Description           |
| ------------- | ------------- | --------------------- |
| `id`          | UUID          | Primary key           |
| `user_id`     | UUID          | FK → users.id (owner) |
| `name`        | TEXT          | Service name          |
| `description` | TEXT          | Service description   |
| `base_price`  | DECIMAL(10,2) | Base price            |
| `active`      | BOOLEAN       | Is service active     |
| `created_at`  | TIMESTAMPTZ   | Creation time         |
| `updated_at`  | TIMESTAMPTZ   | Last update time      |

#### `client_services`

Junction table for services agreed by active clients.

| Column             | Type          | Description                 |
| ------------------ | ------------- | --------------------------- |
| `id`               | UUID          | Primary key                 |
| `active_client_id` | UUID          | FK → active_clients.id      |
| `service_id`       | UUID          | FK → services.id            |
| `agreed_price`     | DECIMAL(10,2) | Negotiated price            |
| `agreed_date`      | TIMESTAMPTZ   | When client agreed          |
| `redacted_at`      | TIMESTAMPTZ   | Privacy redaction timestamp |
| `created_at`       | TIMESTAMPTZ   | Creation time               |

---

### OAuth Integration

#### `oauth_providers`

App-level OAuth credentials (admin-configured).

| Column          | Type        | Description                                 |
| --------------- | ----------- | ------------------------------------------- |
| `id`            | UUID        | Primary key                                 |
| `provider`      | TEXT        | `google`, `facebook`, `instagram`, `tiktok` |
| `client_id`     | TEXT        | OAuth client ID                             |
| `client_secret` | TEXT        | OAuth client secret                         |
| `redirect_uri`  | TEXT        | OAuth redirect URI                          |
| `auth_url`      | TEXT        | Authorization URL                           |
| `token_url`     | TEXT        | Token exchange URL                          |
| `scopes`        | JSONB       | Required scopes array                       |
| `is_active`     | BOOLEAN     | Provider enabled                            |
| `notes`         | TEXT        | Admin notes                                 |
| `created_at`    | TIMESTAMPTZ | Creation time                               |
| `updated_at`    | TIMESTAMPTZ | Last update time                            |

#### `oauth_connections`

Per-client OAuth connections.

| Column                    | Type        | Description                                 |
| ------------------------- | ----------- | ------------------------------------------- |
| `id`                      | UUID        | Primary key                                 |
| `client_id`               | UUID        | FK → users.id                               |
| `provider`                | TEXT        | `google`, `facebook`, `instagram`, `tiktok` |
| `provider_account_id`     | TEXT        | Account ID from provider                    |
| `provider_account_name`   | TEXT        | Display name                                |
| `access_token`            | TEXT        | OAuth access token                          |
| `refresh_token`           | TEXT        | OAuth refresh token                         |
| `token_type`              | TEXT        | Token type (usually `Bearer`)               |
| `scope_granted`           | JSONB       | Granted scopes array                        |
| `expires_at`              | TIMESTAMPTZ | Token expiration                            |
| `is_connected`            | BOOLEAN     | Connection active                           |
| `revoked_at`              | TIMESTAMPTZ | When revoked                                |
| `last_refreshed_at`       | TIMESTAMPTZ | Last token refresh                          |
| `last_error`              | TEXT        | Last error message                          |
| `external_metadata`       | JSONB       | Provider-specific data                      |
| **Security Fields**       |             |                                             |
| `encrypted_access_token`  | TEXT        | Encrypted access token                      |
| `encrypted_refresh_token` | TEXT        | Encrypted refresh token                     |
| `token_hash`              | TEXT        | Token hash for validation                   |
| `kms_key_id`              | TEXT        | KMS key identifier                          |
| `last_rotated_at`         | TIMESTAMPTZ | Last key rotation                           |
| `created_at`              | TIMESTAMPTZ | Creation time                               |
| `updated_at`              | TIMESTAMPTZ | Last update time                            |

#### `oauth_resources`

Resources (pages/locations) under OAuth connections.

| Column                | Type        | Description                                                               |
| --------------------- | ----------- | ------------------------------------------------------------------------- |
| `id`                  | UUID        | Primary key                                                               |
| `client_id`           | UUID        | FK → users.id                                                             |
| `oauth_connection_id` | UUID        | FK → oauth_connections.id                                                 |
| `provider`            | TEXT        | `google`, `facebook`, `instagram`, `tiktok`                               |
| `resource_type`       | TEXT        | `google_location`, `facebook_page`, `instagram_account`, `tiktok_account` |
| `resource_id`         | TEXT        | Platform's resource ID                                                    |
| `resource_name`       | TEXT        | Display name                                                              |
| `resource_username`   | TEXT        | Username/handle                                                           |
| `resource_url`        | TEXT        | Resource URL                                                              |
| `is_primary`          | BOOLEAN     | Primary resource flag                                                     |
| `is_enabled`          | BOOLEAN     | Resource enabled                                                          |
| `created_at`          | TIMESTAMPTZ | Creation time                                                             |
| `updated_at`          | TIMESTAMPTZ | Last update time                                                          |

---

### Documents

#### `documents`

Client and admin uploaded documents.

| Column                | Type        | Description                   |
| --------------------- | ----------- | ----------------------------- |
| `id`                  | UUID        | Primary key                   |
| `user_id`             | UUID        | FK → users.id                 |
| `label`               | TEXT        | Document label                |
| `name`                | TEXT        | Original filename             |
| `url`                 | TEXT        | Storage URL                   |
| `origin`              | TEXT        | `client`, `admin`             |
| `type`                | TEXT        | Document type                 |
| `review_status`       | TEXT        | `none`, `pending`, `approved` |
| `review_requested_at` | TIMESTAMPTZ | Review request time           |
| `viewed_at`           | TIMESTAMPTZ | Last viewed time              |
| `created_at`          | TIMESTAMPTZ | Upload time                   |
| `created_by`          | UUID        | FK → users.id                 |

#### `shared_documents`

Admin-uploaded documents for all clients.

| Column        | Type        | Description          |
| ------------- | ----------- | -------------------- |
| `id`          | UUID        | Primary key          |
| `label`       | TEXT        | Document label       |
| `name`        | TEXT        | Original filename    |
| `url`         | TEXT        | Storage URL          |
| `description` | TEXT        | Document description |
| `sort_order`  | INTEGER     | Display order        |
| `created_by`  | UUID        | FK → users.id        |
| `created_at`  | TIMESTAMPTZ | Upload time          |
| `updated_at`  | TIMESTAMPTZ | Last update time     |

---

### Blog & Content

#### `blog_posts`

Client blog posts.

| Column         | Type        | Description                  |
| -------------- | ----------- | ---------------------------- |
| `id`           | UUID        | Primary key                  |
| `user_id`      | UUID        | FK → users.id                |
| `title`        | TEXT        | Post title                   |
| `content`      | TEXT        | Post content (HTML/Markdown) |
| `status`       | TEXT        | `draft`, `published`         |
| `created_at`   | TIMESTAMPTZ | Creation time                |
| `updated_at`   | TIMESTAMPTZ | Last update time             |
| `published_at` | TIMESTAMPTZ | Publish timestamp            |

---

### Authentication & Tokens

#### `client_onboarding_tokens`

Secure onboarding invitation tokens.

| Column             | Type        | Description            |
| ------------------ | ----------- | ---------------------- |
| `id`               | UUID        | Primary key            |
| `user_id`          | UUID        | FK → users.id          |
| `token_hash`       | TEXT        | Hashed token value     |
| `expires_at`       | TIMESTAMPTZ | Token expiration       |
| `consumed_at`      | TIMESTAMPTZ | When token was used    |
| `revoked_at`       | TIMESTAMPTZ | When token was revoked |
| `reminder_sent_at` | TIMESTAMPTZ | Reminder email sent    |
| `metadata`         | JSONB       | Additional data        |
| `created_at`       | TIMESTAMPTZ | Creation time          |

#### `password_reset_tokens`

Password reset tokens.

| Column       | Type        | Description         |
| ------------ | ----------- | ------------------- |
| `id`         | UUID        | Primary key         |
| `user_id`    | UUID        | FK → users.id       |
| `token_hash` | TEXT        | Hashed token value  |
| `expires_at` | TIMESTAMPTZ | Token expiration    |
| `used_at`    | TIMESTAMPTZ | When token was used |
| `created_at` | TIMESTAMPTZ | Creation time       |

---

### Email Logging

#### `email_logs`

Track all emails sent from the application.

| Column            | Type        | Description                                                    |
| ----------------- | ----------- | -------------------------------------------------------------- |
| `id`              | UUID        | Primary key                                                    |
| `email_type`      | TEXT        | `onboarding_invite`, `password_reset`, `form_submission`, etc. |
| `recipient_email` | TEXT        | To address                                                     |
| `recipient_name`  | TEXT        | Recipient's name                                               |
| `cc_emails`       | TEXT[]      | CC addresses                                                   |
| `bcc_emails`      | TEXT[]      | BCC addresses                                                  |
| `subject`         | TEXT        | Email subject                                                  |
| `text_body`       | TEXT        | Plain text body                                                |
| `html_body`       | TEXT        | HTML body                                                      |
| `status`          | TEXT        | `pending`, `sent`, `failed`                                    |
| `mailgun_id`      | TEXT        | Mailgun message ID                                             |
| `mailgun_message` | TEXT        | Mailgun response                                               |
| `error_message`   | TEXT        | Error details                                                  |
| `triggered_by_id` | UUID        | FK → users.id (who triggered)                                  |
| `client_id`       | UUID        | FK → users.id (related client)                                 |
| `metadata`        | JSONB       | Additional data                                                |
| `created_at`      | TIMESTAMPTZ | Creation time                                                  |
| `sent_at`         | TIMESTAMPTZ | Send timestamp                                                 |

---

### Notifications

#### `notifications`

User notifications.

| Column       | Type        | Description        |
| ------------ | ----------- | ------------------ |
| `id`         | UUID        | Primary key        |
| `user_id`    | UUID        | FK → users.id      |
| `title`      | TEXT        | Notification title |
| `body`       | TEXT        | Notification body  |
| `link_url`   | TEXT        | Action URL         |
| `status`     | TEXT        | `unread`, `read`   |
| `meta`       | JSONB       | Additional data    |
| `read_at`    | TIMESTAMPTZ | When read          |
| `created_at` | TIMESTAMPTZ | Creation time      |

#### `portal_updates`

Agency-authored announcements broadcast to all client users (the dismissible Updates banner at the top of the client portal).

| Column         | Type        | Description                                          |
| -------------- | ----------- | ---------------------------------------------------- |
| `id`           | UUID        | Primary key                                          |
| `type`         | TEXT        | `feature`, `improvement`, `notice`, `maintenance`    |
| `title`        | TEXT        | Banner title                                         |
| `body`         | TEXT        | Banner body (plain text)                             |
| `link_url`     | TEXT        | Optional "Learn more" URL (http/https)               |
| `status`       | TEXT        | `draft`, `published`, `archived`                     |
| `created_by`   | UUID        | FK → users.id (author)                               |
| `published_at` | TIMESTAMPTZ | Set when first published                             |
| `created_at`   | TIMESTAMPTZ | Creation time                                        |
| `updated_at`   | TIMESTAMPTZ | Last update                                          |

#### `user_update_dismissals`

Per-user dismissal state for portal updates (a row = dismissed; permanent).

| Column         | Type        | Description                          |
| -------------- | ----------- | ------------------------------------ |
| `id`           | UUID        | Primary key                          |
| `user_id`      | UUID        | FK → users.id (CASCADE)              |
| `update_id`    | UUID        | FK → portal_updates.id (CASCADE)     |
| `dismissed_at` | TIMESTAMPTZ | When dismissed                       |
| —              | —           | `UNIQUE(user_id, update_id)`         |

---

### Task Management System

#### `task_workspaces`

Top-level task workspace containers.

| Column       | Type        | Description    |
| ------------ | ----------- | -------------- |
| `id`         | UUID        | Primary key    |
| `name`       | TEXT        | Workspace name |
| `created_by` | UUID        | FK → users.id  |
| `created_at` | TIMESTAMPTZ | Creation time  |

#### `task_workspace_memberships`

User membership in workspaces.

| Column         | Type        | Description                  |
| -------------- | ----------- | ---------------------------- |
| `workspace_id` | UUID        | FK → task_workspaces.id (PK) |
| `user_id`      | UUID        | FK → users.id (PK)           |
| `role`         | TEXT        | `member`, `admin`            |
| `created_at`   | TIMESTAMPTZ | Creation time                |

#### `task_boards`

Boards within a workspace.

| Column         | Type        | Description                 |
| -------------- | ----------- | --------------------------- |
| `id`           | UUID        | Primary key                 |
| `workspace_id` | UUID        | FK → task_workspaces.id     |
| `name`         | TEXT        | Board name                  |
| `description`  | TEXT        | Board description           |
| `board_prefix` | TEXT        | Item prefix (e.g., "TASK-") |
| `created_by`   | UUID        | FK → users.id               |
| `created_at`   | TIMESTAMPTZ | Creation time               |

#### `task_groups`

Groups/columns within a board.

| Column        | Type    | Description         |
| ------------- | ------- | ------------------- |
| `id`          | UUID    | Primary key         |
| `board_id`    | UUID    | FK → task_boards.id |
| `name`        | TEXT    | Group name          |
| `order_index` | INTEGER | Display order       |

#### `task_items`

Individual task items.

| Column            | Type        | Description           |
| ----------------- | ----------- | --------------------- |
| `id`              | UUID        | Primary key           |
| `group_id`        | UUID        | FK → task_groups.id   |
| `name`            | TEXT        | Task name             |
| `status`          | TEXT        | Current status label  |
| `due_date`        | DATE        | Due date              |
| `is_voicemail`    | BOOLEAN     | Voicemail task flag   |
| `needs_attention` | BOOLEAN     | Attention needed flag |
| `created_by`      | UUID        | FK → users.id         |
| `archived_at`     | TIMESTAMPTZ | Archive timestamp     |
| `archived_by`     | UUID        | FK → users.id         |
| `created_at`      | TIMESTAMPTZ | Creation time         |
| `updated_at`      | TIMESTAMPTZ | Last update time      |

#### `task_subitems`

Subtasks under a task item.

| Column           | Type        | Description          |
| ---------------- | ----------- | -------------------- |
| `id`             | UUID        | Primary key          |
| `parent_item_id` | UUID        | FK → task_items.id   |
| `name`           | TEXT        | Subtask name         |
| `status`         | TEXT        | Current status label |
| `due_date`       | DATE        | Due date             |
| `archived_at`    | TIMESTAMPTZ | Archive timestamp    |
| `archived_by`    | UUID        | FK → users.id        |
| `created_at`     | TIMESTAMPTZ | Creation time        |

#### `task_item_assignees`

Task assignment junction.

| Column       | Type        | Description             |
| ------------ | ----------- | ----------------------- |
| `item_id`    | UUID        | FK → task_items.id (PK) |
| `user_id`    | UUID        | FK → users.id (PK)      |
| `created_at` | TIMESTAMPTZ | Assignment time         |

#### `task_updates`

Comments/updates on tasks.

| Column       | Type        | Description        |
| ------------ | ----------- | ------------------ |
| `id`         | UUID        | Primary key        |
| `item_id`    | UUID        | FK → task_items.id |
| `user_id`    | UUID        | FK → users.id      |
| `content`    | TEXT        | Update content     |
| `created_at` | TIMESTAMPTZ | Creation time      |

#### `task_files`

File attachments on tasks/updates.

| Column        | Type        | Description          |
| ------------- | ----------- | -------------------- |
| `id`          | UUID        | Primary key          |
| `item_id`     | UUID        | FK → task_items.id   |
| `update_id`   | UUID        | FK → task_updates.id |
| `uploaded_by` | UUID        | FK → users.id        |
| `file_url`    | TEXT        | Storage URL          |
| `file_name`   | TEXT        | Original filename    |
| `created_at`  | TIMESTAMPTZ | Upload time          |

#### `task_time_entries`

Time tracking entries.

| Column               | Type        | Description        |
| -------------------- | ----------- | ------------------ |
| `id`                 | UUID        | Primary key        |
| `item_id`            | UUID        | FK → task_items.id |
| `user_id`            | UUID        | FK → users.id      |
| `time_spent_minutes` | INTEGER     | Total time spent   |
| `billable_minutes`   | INTEGER     | Billable portion   |
| `description`        | TEXT        | Work description   |
| `work_category`      | TEXT        | Category of work   |
| `is_billable`        | BOOLEAN     | Billable flag      |
| `created_at`         | TIMESTAMPTZ | Entry time         |

#### `task_update_views`

Track who viewed updates.

| Column      | Type        | Description          |
| ----------- | ----------- | -------------------- |
| `id`        | UUID        | Primary key          |
| `update_id` | UUID        | FK → task_updates.id |
| `user_id`   | UUID        | FK → users.id        |
| `viewed_at` | TIMESTAMPTZ | View timestamp       |

---

### Task Automation

#### `task_board_automations`

Board-scoped automation rules.

| Column           | Type        | Description           |
| ---------------- | ----------- | --------------------- |
| `id`             | UUID        | Primary key           |
| `board_id`       | UUID        | FK → task_boards.id   |
| `name`           | TEXT        | Automation name       |
| `trigger_type`   | TEXT        | Trigger type          |
| `trigger_config` | JSONB       | Trigger configuration |
| `action_type`    | TEXT        | Action type           |
| `action_config`  | JSONB       | Action configuration  |
| `is_active`      | BOOLEAN     | Automation enabled    |
| `created_by`     | UUID        | FK → users.id         |
| `created_at`     | TIMESTAMPTZ | Creation time         |

#### `task_global_automations`

Global automation rules (all boards).

| Column           | Type        | Description           |
| ---------------- | ----------- | --------------------- |
| `id`             | UUID        | Primary key           |
| `name`           | TEXT        | Automation name       |
| `trigger_type`   | TEXT        | Trigger type          |
| `trigger_config` | JSONB       | Trigger configuration |
| `action_type`    | TEXT        | Action type           |
| `action_config`  | JSONB       | Action configuration  |
| `is_active`      | BOOLEAN     | Automation enabled    |
| `created_by`     | UUID        | FK → users.id         |
| `created_at`     | TIMESTAMPTZ | Creation time         |

#### `task_automation_runs`

Automation execution log.

| Column                | Type        | Description                   |
| --------------------- | ----------- | ----------------------------- |
| `id`                  | UUID        | Primary key                   |
| `scope`               | TEXT        | `board`, `global`             |
| `automation_id`       | UUID        | Reference to automation       |
| `board_id`            | UUID        | FK → task_boards.id           |
| `item_id`             | UUID        | FK → task_items.id            |
| `trigger_type`        | TEXT        | What triggered it             |
| `trigger_fingerprint` | TEXT        | Deduplication key             |
| `status`              | TEXT        | `success`, `error`, `skipped` |
| `error`               | TEXT        | Error message                 |
| `meta`                | JSONB       | Additional data               |
| `ran_at`              | TIMESTAMPTZ | Execution time                |

---

### Task Status Labels

#### `task_board_status_labels`

Custom status labels per board.

| Column          | Type        | Description         |
| --------------- | ----------- | ------------------- |
| `id`            | UUID        | Primary key         |
| `board_id`      | UUID        | FK → task_boards.id |
| `label`         | TEXT        | Status label text   |
| `color`         | TEXT        | Hex color code      |
| `order_index`   | INTEGER     | Display order       |
| `is_done_state` | BOOLEAN     | Marks completion    |
| `created_at`    | TIMESTAMPTZ | Creation time       |

#### `task_global_status_labels`

Global status labels (all boards).

| Column          | Type        | Description       |
| --------------- | ----------- | ----------------- |
| `id`            | UUID        | Primary key       |
| `label`         | TEXT        | Status label text |
| `color`         | TEXT        | Hex color code    |
| `order_index`   | INTEGER     | Display order     |
| `is_done_state` | BOOLEAN     | Marks completion  |
| `created_by`    | UUID        | FK → users.id     |
| `created_at`    | TIMESTAMPTZ | Creation time     |

---

### AI Features

#### `task_item_ai_summaries`

Cached AI summaries for tasks.

| Column         | Type        | Description             |
| -------------- | ----------- | ----------------------- |
| `item_id`      | UUID        | FK → task_items.id (PK) |
| `summary`      | TEXT        | AI-generated summary    |
| `provider`     | TEXT        | AI provider (`vertex`)  |
| `model`        | TEXT        | Model used              |
| `generated_by` | UUID        | FK → users.id           |
| `generated_at` | TIMESTAMPTZ | Generation time         |
| `source_meta`  | JSONB       | Source data reference   |

#### `task_ai_daily_overviews`

Daily AI overview cache.

| Column                | Type        | Description          |
| --------------------- | ----------- | -------------------- |
| `id`                  | UUID        | Primary key          |
| `user_id`             | UUID        | FK → users.id        |
| `overview_date`       | DATE        | Date of overview     |
| `summary`             | TEXT        | Daily summary        |
| `todo_items`          | JSONB       | To-do list items     |
| `pending_mentions`    | JSONB       | Pending @mentions    |
| `unanswered_mentions` | JSONB       | Unanswered @mentions |
| `provider`            | TEXT        | AI provider          |
| `model`               | TEXT        | Model used           |
| `generated_at`        | TIMESTAMPTZ | Generation time      |

---

### Security & Session Management

#### `user_sessions`

Active user sessions with refresh token tracking.

| Column                 | Type        | Description                                                 |
| ---------------------- | ----------- | ----------------------------------------------------------- |
| `id`                   | UUID        | Primary key                                                 |
| `user_id`              | UUID        | FK → users.id                                               |
| `refresh_token_hash`   | TEXT        | Hashed refresh token (unique)                               |
| `refresh_token_family` | UUID        | Token family for reuse detection                            |
| `device_id`            | UUID        | Stable device identifier                                    |
| `device_fingerprint`   | TEXT        | Browser fingerprint hash                                    |
| `device_name`          | TEXT        | Human-readable device name                                  |
| `is_trusted`           | BOOLEAN     | Device is trusted (skip MFA)                                |
| `trusted_until`        | TIMESTAMPTZ | Trust expiration                                            |
| `ip_address`           | INET        | Client IP address                                           |
| `user_agent`           | TEXT        | Browser user agent                                          |
| `country_code`         | CHAR(2)     | Country from IP geolocation                                 |
| `city`                 | TEXT        | City from IP geolocation                                    |
| `created_at`           | TIMESTAMPTZ | Session creation time                                       |
| `last_activity_at`     | TIMESTAMPTZ | Last activity timestamp                                     |
| `absolute_expiry_at`   | TIMESTAMPTZ | Hard session limit (90 days)                                |
| `refresh_expiry_at`    | TIMESTAMPTZ | Refresh token expiry (30 days sliding)                      |
| `revoked_at`           | TIMESTAMPTZ | When session was revoked                                    |
| `revoked_reason`       | TEXT        | `logout`, `password_change`, `mfa_change`, `reuse_detected` |

#### `user_trusted_devices`

Trusted devices for skipping MFA.

| Column               | Type        | Description                |
| -------------------- | ----------- | -------------------------- |
| `id`                 | UUID        | Primary key                |
| `user_id`            | UUID        | FK → users.id              |
| `device_id`          | UUID        | Device identifier          |
| `device_fingerprint` | TEXT        | Browser fingerprint hash   |
| `device_name`        | TEXT        | Human-readable device name |
| `trusted_at`         | TIMESTAMPTZ | When device was trusted    |
| `expires_at`         | TIMESTAMPTZ | Trust expiration (30 days) |
| `last_used_at`       | TIMESTAMPTZ | Last use timestamp         |
| `revoked_at`         | TIMESTAMPTZ | When trust was revoked     |

#### `user_mfa_settings`

Per-user MFA configuration.

| Column                        | Type        | Description                    |
| ----------------------------- | ----------- | ------------------------------ |
| `user_id`                     | UUID        | FK → users.id (PK)             |
| `email_otp_enabled`           | BOOLEAN     | Email OTP enabled              |
| `totp_enabled`                | BOOLEAN     | TOTP authenticator enabled     |
| `totp_secret_encrypted`       | TEXT        | KMS-encrypted TOTP secret      |
| `totp_backup_codes_encrypted` | TEXT        | Encrypted backup codes         |
| `webauthn_enabled`            | BOOLEAN     | WebAuthn security keys enabled |
| `preferred_method`            | TEXT        | `email`, `totp`, `webauthn`    |
| `require_mfa_always`          | BOOLEAN     | Admin-enforced MFA             |
| `created_at`                  | TIMESTAMPTZ | Creation time                  |
| `updated_at`                  | TIMESTAMPTZ | Last update time               |

#### `mfa_challenges`

Pending MFA verification challenges.

| Column           | Type        | Description                                |
| ---------------- | ----------- | ------------------------------------------ |
| `id`             | UUID        | Primary key                                |
| `user_id`        | UUID        | FK → users.id                              |
| `session_id`     | UUID        | FK → user_sessions.id                      |
| `challenge_type` | TEXT        | `email_otp`, `totp`, `webauthn`            |
| `otp_hash`       | TEXT        | Hashed OTP code                            |
| `created_at`     | TIMESTAMPTZ | Challenge creation time                    |
| `expires_at`     | TIMESTAMPTZ | Challenge expiration (10 min)              |
| `verified_at`    | TIMESTAMPTZ | When challenge was verified                |
| `attempts`       | INTEGER     | Verification attempts                      |
| `max_attempts`   | INTEGER     | Maximum allowed attempts (5)               |
| `trigger_reason` | TEXT        | `new_device`, `new_ip`, `inactivity`, etc. |
| `ip_address`     | INET        | Client IP address                          |
| `user_agent`     | TEXT        | Browser user agent                         |

#### `user_oauth_identities`

OAuth login identities (Google, Microsoft).

| Column                    | Type        | Description                |
| ------------------------- | ----------- | -------------------------- |
| `id`                      | UUID        | Primary key                |
| `user_id`                 | UUID        | FK → users.id              |
| `provider`                | TEXT        | `google`, `microsoft`      |
| `provider_user_id`        | TEXT        | Provider's user ID         |
| `provider_email`          | TEXT        | Email from provider        |
| `provider_email_verified` | BOOLEAN     | Email verified by provider |
| `provider_name`           | TEXT        | Display name from provider |
| `provider_picture`        | TEXT        | Profile picture URL        |
| `created_at`              | TIMESTAMPTZ | Creation time              |
| `last_login_at`           | TIMESTAMPTZ | Last OAuth login           |

#### `security_audit_log`

Immutable security event audit trail.

| Column           | Type        | Description                              |
| ---------------- | ----------- | ---------------------------------------- |
| `id`             | UUID        | Primary key                              |
| `user_id`        | UUID        | FK → users.id                            |
| `session_id`     | UUID        | Session ID if applicable                 |
| `event_type`     | TEXT        | `login_success`, `mfa_challenge`, etc.   |
| `event_category` | TEXT        | `authentication`, `session`, `mfa`, etc. |
| `ip_address`     | INET        | Client IP address                        |
| `user_agent`     | TEXT        | Browser user agent                       |
| `country_code`   | CHAR(2)     | Country from IP                          |
| `device_id`      | UUID        | Device identifier                        |
| `details`        | JSONB       | Event details (no sensitive data)        |
| `success`        | BOOLEAN     | Event outcome                            |
| `failure_reason` | TEXT        | Reason for failure                       |
| `created_at`     | TIMESTAMPTZ | Event timestamp                          |

#### `user_activity_logs`

Comprehensive user activity audit log with 30-day retention. Tracks all user actions for admin visibility.

| Column               | Type        | Description                                                |
| -------------------- | ----------- | ---------------------------------------------------------- |
| `id`                 | UUID        | Primary key                                                |
| `user_id`            | UUID        | FK → users.id (who performed the action)                   |
| `target_user_id`     | UUID        | FK → users.id (target user for client operations)          |
| `target_entity_type` | TEXT        | Entity type: `task`, `form`, `document`, `review`          |
| `target_entity_id`   | UUID        | ID of the target entity                                    |
| `action_type`        | TEXT        | Action: `login`, `view_client`, `create_task`, etc.        |
| `action_category`    | TEXT        | Category: `authentication`, `client`, `task`, `document`   |
| `ip_address`         | INET        | Client IP address                                          |
| `user_agent`         | TEXT        | Browser user agent                                         |
| `details`            | JSONB       | Additional metadata (no PHI or secrets)                    |
| `created_at`         | TIMESTAMPTZ | Activity timestamp                                         |

**Action categories and types:**

- `authentication`: `login`, `logout`
- `client`: `view_client`, `edit_client`, `create_client`, `delete_client`, `activate_client`
- `task`: `view_task`, `create_task`, `update_task`, `complete_task`, `delete_task`
- `document`: `upload_document`, `view_document`, `delete_document`
- `form`: `view_form`, `submit_form`, `create_form`, `edit_form`, `delete_form`
- `review`: `view_review`, `respond_review`
- `admin`: `impersonate_start`, `impersonate_end`, `export_data`

**Cron job:** Daily cleanup at 3:30 AM purges logs older than 30 days (configurable via `ACTIVITY_LOG_RETENTION_DAYS`).

#### `auth_rate_limits`

Rate limiting tracking for authentication endpoints.

| Column             | Type        | Description                    |
| ------------------ | ----------- | ------------------------------ |
| `id`               | UUID        | Primary key                    |
| `limit_key`        | TEXT        | Hashed identifier (IP/user)    |
| `limit_type`       | TEXT        | `login_ip`, `login_user`, etc. |
| `attempts`         | INTEGER     | Number of attempts             |
| `first_attempt_at` | TIMESTAMPTZ | First attempt timestamp        |
| `last_attempt_at`  | TIMESTAMPTZ | Last attempt timestamp         |
| `locked_until`     | TIMESTAMPTZ | Lockout expiration             |

#### `email_verification_tokens`

Email verification tokens for new accounts.

| Column        | Type        | Description             |
| ------------- | ----------- | ----------------------- |
| `id`          | UUID        | Primary key             |
| `user_id`     | UUID        | FK → users.id           |
| `token_hash`  | TEXT        | Hashed token            |
| `email`       | TEXT        | Email being verified    |
| `expires_at`  | TIMESTAMPTZ | Token expiration        |
| `verified_at` | TIMESTAMPTZ | When email was verified |
| `created_at`  | TIMESTAMPTZ | Token creation time     |

**Additional columns on `users` table:**

| Column                | Type        | Description                    |
| --------------------- | ----------- | ------------------------------ |
| `email_verified_at`   | TIMESTAMPTZ | When email was verified        |
| `password_changed_at` | TIMESTAMPTZ | Last password change           |
| `last_login_at`       | TIMESTAMPTZ | Last successful login          |
| `login_count`         | INTEGER     | Total successful logins        |
| `failed_login_count`  | INTEGER     | Failed login attempts          |
| `locked_until`        | TIMESTAMPTZ | Account lockout expiration     |
| `auth_provider`       | TEXT        | `local`, `google`, `microsoft` |

---

### Forms & Form Submissions

#### `forms`

Client forms for lead capture.

| Column          | Type        | Description                                     |
| --------------- | ----------- | ----------------------------------------------- |
| `id`            | UUID        | Primary key                                     |
| `owner_user_id` | UUID        | FK → users.id (client owner)                    |
| `preset_id`     | UUID        | FK → form_presets.id (if created from preset)   |
| `name`          | TEXT        | Form name                                       |
| `description`   | TEXT        | Form description                                |
| `form_type`     | TEXT        | `conversion`, `intake` (intake has PHI)         |
| `status`        | TEXT        | `draft`, `published`, `archived`                |
| `embed_token`   | TEXT        | Public embed token (unique)                     |
| `settings_json` | JSONB       | Form settings (notifications, redirects, etc.)  |
| `created_at`    | TIMESTAMPTZ | Creation time                                   |
| `updated_at`    | TIMESTAMPTZ | Last update time                                |
| `archived_at`   | TIMESTAMPTZ | Archive timestamp                               |

#### `form_versions`

Published versions of forms.

| Column        | Type        | Description                      |
| ------------- | ----------- | -------------------------------- |
| `id`          | UUID        | Primary key                      |
| `form_id`     | UUID        | FK → forms.id                    |
| `version`     | INTEGER     | Version number                   |
| `react_code`  | TEXT        | Rendered React component code    |
| `schema_json` | JSONB       | Field definitions schema         |
| `css_code`    | TEXT        | Custom CSS styles                |
| `published_at`| TIMESTAMPTZ | When this version was published  |
| `published_by`| UUID        | FK → users.id                    |

#### `form_submissions`

Form submission records (PHI encrypted for intake forms).

| Column              | Type        | Description                           |
| ------------------- | ----------- | ------------------------------------- |
| `id`                | UUID        | Primary key                           |
| `form_id`           | UUID        | FK → forms.id                         |
| `form_version_id`   | UUID        | FK → form_versions.id                 |
| `payload_json`      | JSONB       | Submission data (non-PHI)             |
| `encrypted_payload` | TEXT        | AES-256-GCM encrypted PHI fields      |
| `encryption_key_id` | TEXT        | KMS key identifier for decryption     |
| `submitter_ip_hash` | TEXT        | Hashed IP address (privacy)           |
| `user_agent`        | TEXT        | Browser user agent                    |
| `attribution_json`  | JSONB       | Captured attribution (UTMs, gclid)    |
| `call_log_id`       | UUID        | FK → call_logs.id (unified lead)      |
| `created_at`        | TIMESTAMPTZ | Submission time                       |

#### `form_presets`

Global form templates (system and custom).

| Column       | Type        | Description                              |
| ------------ | ----------- | ---------------------------------------- |
| `id`         | UUID        | Primary key                              |
| `name`       | TEXT        | Preset name                              |
| `description`| TEXT        | Preset description                       |
| `category`   | TEXT        | `contact`, `intake`, `appointment`, `consultation` |
| `form_type`  | TEXT        | `conversion`, `intake`                   |
| `schema_json`| JSONB       | Field definitions schema                 |
| `react_code` | TEXT        | Pre-built React component code           |
| `css_code`   | TEXT        | Default CSS styles                       |
| `is_system`  | BOOLEAN     | System presets can't be deleted          |
| `created_by` | UUID        | FK → users.id (null for system presets)  |
| `created_at` | TIMESTAMPTZ | Creation time                            |
| `updated_at` | TIMESTAMPTZ | Last update time                         |

**Default system presets:**
- Contact Form (conversion)
- Request Appointment (conversion)
- Free Consultation (conversion)
- Patient Intake (intake - PHI encrypted)

#### `ctm_form_submissions` — reliability columns (`migrate_ctm_form_outcome.sql`)

The active CTM Forms system. Reliability/triage columns added on top of the base table:

| Column            | Type        | Description                                                              |
| ----------------- | ----------- | ----------------------------------------------------------------------- |
| `status`          | TEXT        | Triage: `received` · `review` (flagged) · `held` (spam-held) · `released` |
| `block_reason`    | TEXT        | Granular cause: `recaptcha_missing_token`, `recaptcha_low_score`, `recaptcha_invalid_token`, `recaptcha_action_mismatch`, `recaptcha_service_unavailable`, `recaptcha_failed`, `ai_spam`, `heuristic_spam` |
| `released_at`     | TIMESTAMPTZ | When staff released a held submission                                    |
| `released_by`     | UUID        | FK → users.id (who released it)                                          |
| `ctm_retry_count` | INT         | Times the retry worker attempted CTM forwarding                         |

#### `ctm_form_funnel_events` (`migrate_ctm_form_outcome.sql`)

Non-PII client-side conversion funnel telemetry (30-day retention).

| Column       | Type        | Description                                                            |
| ------------ | ----------- | --------------------------------------------------------------------- |
| `id`         | UUID        | Primary key                                                            |
| `form_id`    | UUID        | FK → ctm_forms.id (ON DELETE CASCADE)                                  |
| `event`      | TEXT        | `rendered`, `submit_click`, `validation_failed`, `recaptcha_missing`, `post_start`, `post_failed`, `post_success`, `duplicate_shown`, `blocked_shown`, `received`, `held` |
| `meta`       | JSONB       | Non-PII counts/flags only (e.g. `{ reason, httpStatus }`)              |
| `created_at` | TIMESTAMPTZ | Event time                                                            |

#### `ctm_form_submission_jobs` (`migrate_ctm_form_outcome.sql`)

CTM forwarding retry queue (cron `*/2 * * * *`, exponential backoff, 30-day retention of done jobs).

| Column          | Type        | Description                                          |
| --------------- | ----------- | ---------------------------------------------------- |
| `id`            | UUID        | Primary key                                          |
| `submission_id` | UUID        | FK → ctm_form_submissions.id (ON DELETE CASCADE)     |
| `status`        | TEXT        | `pending` · `processing` · `completed` · `failed`    |
| `attempts`      | INT         | Attempts so far                                      |
| `max_attempts`  | INT         | Default 5                                            |
| `last_error`    | TEXT        | Most recent failure message                          |
| `scheduled_at`  | TIMESTAMPTZ | Next eligible run time                               |
| `started_at` / `completed_at` / `created_at` | TIMESTAMPTZ | Lifecycle timestamps          |

Partial unique index `idx_ctm_jobs_one_open` enforces one open (pending/processing) job per submission.

---

### Miscellaneous

#### `requests`

Legacy task/request system (Monday.com sync).

| Column            | Type        | Description              |
| ----------------- | ----------- | ------------------------ |
| `id`              | UUID        | Primary key              |
| `user_id`         | UUID        | FK → users.id            |
| `title`           | TEXT        | Request title            |
| `description`     | TEXT        | Request description      |
| `due_date`        | DATE        | Due date                 |
| `rush`            | BOOLEAN     | Rush priority flag       |
| `person_override` | TEXT        | Assigned person override |
| `monday_item_id`  | TEXT        | Monday.com item ID       |
| `monday_board_id` | TEXT        | Monday.com board ID      |
| `status`          | TEXT        | Request status           |
| `created_at`      | TIMESTAMPTZ | Creation time            |

#### `app_settings`

Global application settings (key-value).

| Column       | Type        | Description      |
| ------------ | ----------- | ---------------- |
| `key`        | TEXT        | Setting key (PK) |
| `value`      | JSONB       | Setting value    |
| `updated_at` | TIMESTAMPTZ | Last update time |

#### `system_health_checks`

Monitoring telemetry for the daily production health sweep (`/api/health`). One row per check per run. Append-only (NOT audit data); 30-day retention pruned by the daily job. Contains **no PHI** — probes use synthetic data and store only liveness booleans/ids/counts.

| Column        | Type        | Description                                  |
| ------------- | ----------- | -------------------------------------------- |
| `id`          | UUID        | Primary key                                  |
| `run_id`      | UUID        | Groups all checks from a single run          |
| `check_id`    | TEXT        | Stable check identifier (e.g. `integ.ctm`)   |
| `label`       | TEXT        | Human-readable check name                    |
| `category`    | TEXT        | `agent`, `integration`, or `job`             |
| `status`      | TEXT        | `ok`, `warn`, or `fail`                      |
| `detail`      | TEXT        | Human-readable result summary                |
| `error`       | TEXT        | Error message when failing                   |
| `metrics`     | JSONB       | Liveness metrics (counts/ids), no PHI        |
| `duration_ms` | INTEGER     | Probe duration in milliseconds               |
| `trigger`     | TEXT        | `cron` or `manual` (default `cron`)          |
| `created_at`  | TIMESTAMPTZ | Creation time                                |

**Indexes**: `(run_id)`, `(check_id, created_at DESC)`

---

### Client Team Management

Multi-user client account support. Allows clients to invite additional users to manage their account.

#### `client_account_members`

Junction table linking users to client accounts.

| Column            | Type        | Description                            |
| ----------------- | ----------- | -------------------------------------- |
| `id`              | UUID        | Primary key                            |
| `client_owner_id` | UUID        | FK → users.id (account owner)          |
| `member_user_id`  | UUID        | FK → users.id (member)                 |
| `role`            | TEXT        | `owner`, `admin`, `member`             |
| `invited_by`      | UUID        | FK → users.id                          |
| `invited_at`      | TIMESTAMPTZ | When invited                           |
| `accepted_at`     | TIMESTAMPTZ | When accepted                          |
| `status`          | TEXT        | `pending`, `active`, `removed`         |
| `created_at`      | TIMESTAMPTZ | Creation time                          |
| `updated_at`      | TIMESTAMPTZ | Last update time                       |

**Unique constraint**: `(client_owner_id, member_user_id)`

**Permission levels**:
- `owner`: Full control, cannot be removed, can manage all members
- `admin`: Can invite users, can remove members (not admins/owner)
- `member`: View/edit account data, cannot manage team

#### `client_user_invite_tokens`

Invitation tokens for client team invites.

| Column              | Type        | Description                           |
| ------------------- | ----------- | ------------------------------------- |
| `id`                | UUID        | Primary key                           |
| `client_owner_id`   | UUID        | FK → users.id (account owner)         |
| `token_hash`        | TEXT        | SHA-256 hashed token                  |
| `token_value`       | TEXT        | Raw token (for copy-link feature)     |
| `invite_email`      | CITEXT      | Email to invite                       |
| `invite_first_name` | TEXT        | Invitee's first name (optional)       |
| `invite_role`       | TEXT        | Assigned role (`member`, `admin`)     |
| `invited_by`        | UUID        | FK → users.id                         |
| `expires_at`        | TIMESTAMPTZ | Token expiration (72h default)        |
| `consumed_at`       | TIMESTAMPTZ | When used                             |
| `revoked_at`        | TIMESTAMPTZ | When revoked                          |
| `resulting_user_id` | UUID        | FK → users.id (created/linked user)   |
| `metadata`          | JSONB       | Additional data                       |
| `created_at`        | TIMESTAMPTZ | Creation time                         |

### Tracking Provisioning

#### `tracking_campaign_claims`

Per-client Meta/Google Ads campaign ownership. `UNIQUE(platform, ad_account_id, campaign_id)` enforces one-client-per-campaign. Read by the analytics pipeline to scope per-client Meta data; cleared on ad-account change.

| Column          | Type        | Description                                      |
| --------------- | ----------- | ------------------------------------------------ |
| `id`            | UUID        | Primary key                                      |
| `user_id`       | UUID        | FK → users.id (CASCADE)                          |
| `platform`      | TEXT        | `meta` or `google_ads`                           |
| `ad_account_id` | TEXT        | Ad account ID (e.g. `act_2851894194985503`)      |
| `campaign_id`   | TEXT        | Platform campaign ID                             |
| `campaign_name` | TEXT        | Campaign display name (snapshot at claim time)   |
| `claimed_at`    | TIMESTAMPTZ | When the claim was created                       |
| `claimed_by`    | UUID        | FK → users.id (admin who created the claim)      |

#### `tracking_templates`

Reusable GTM tag/trigger/variable definitions.

| Column          | Type        | Description                              |
| --------------- | ----------- | ---------------------------------------- |
| `id`            | UUID        | Primary key                              |
| `name`          | TEXT        | Template name                            |
| `template_type` | TEXT        | Template category                        |
| `tags`          | JSONB       | GTM tag definitions                      |
| `triggers`      | JSONB       | GTM trigger definitions                  |
| `variables`     | JSONB       | GTM variable definitions                 |
| `version`       | INTEGER     | Template version                         |
| `is_active`     | BOOLEAN     | Whether template is active               |
| `created_at`    | TIMESTAMPTZ | Creation time                            |
| `updated_at`    | TIMESTAMPTZ | Last update time                         |

#### `tracking_configs`

Per-client tracking setup. Encrypted fields: `ga4_api_secret`, `meta_capi_token`.

| Column                | Type        | Description                                      |
| --------------------- | ----------- | ------------------------------------------------ |
| `id`                  | UUID        | Primary key                                      |
| `user_id`             | UUID        | FK → users.id (client)                           |
| `client_type`         | TEXT        | `medical` or `non_medical`                       |
| `gtm_container_id`    | TEXT        | GTM container ID                                 |
| `gtm_account_id`      | TEXT        | GTM account ID                                   |
| `ga4_measurement_id`  | TEXT        | GA4 measurement ID                               |
| `ga4_api_secret`      | TEXT        | GA4 API secret (encrypted)                       |
| `google_ads_id`       | TEXT        | Google Ads conversion ID                         |
| `meta_pixel_id`       | TEXT        | Meta pixel ID                                    |
| `meta_capi_token`     | TEXT        | Meta CAPI access token (encrypted)               |
| `allowed_events`      | JSONB       | Events allowed for relay                         |
| `relay_enabled`       | BOOLEAN     | Whether event relay is active                    |
| `provisioning_status` | TEXT        | Status of GTM provisioning                       |
| `install_snippet`     | TEXT        | Generated install snippet                        |
| `created_at`          | TIMESTAMPTZ | Creation time                                    |
| `updated_at`          | TIMESTAMPTZ | Last update time                                 |

#### `tracking_provisioning_jobs`

Provisioning run audit trail.

| Column              | Type        | Description                              |
| ------------------- | ----------- | ---------------------------------------- |
| `id`                | UUID        | Primary key                              |
| `tracking_config_id`| UUID        | FK → tracking_configs.id                 |
| `triggered_by`      | UUID        | FK → users.id                            |
| `status`            | TEXT        | Job status                               |
| `steps`             | JSONB       | Per-step progress details                |
| `created_at`        | TIMESTAMPTZ | Creation time                            |
| `updated_at`        | TIMESTAMPTZ | Last update time                         |

#### `tracking_event_log`

Event relay audit trail. 30-day retention via cron.

| Column              | Type        | Description                              |
| ------------------- | ----------- | ---------------------------------------- |
| `id`                | UUID        | Primary key                              |
| `tracking_config_id`| UUID        | FK → tracking_configs.id                 |
| `event_name`        | TEXT        | Event name                               |
| `destination`       | TEXT        | Target (ga4, meta)                       |
| `payload_sent`      | JSONB       | Post-scrubbing payload                   |
| `success`           | BOOLEAN     | Whether relay succeeded                  |
| `retry_count`       | INTEGER     | Number of retries                        |
| `created_at`        | TIMESTAMPTZ | Creation time                            |

### Reports

#### `report_templates`

Reusable report templates. The `layout` JSONB field describes a page × widget tree that drives both the on-screen report builder and the PDF render pipeline. `filters_default` holds the template-level filter set; per-generation filters take precedence at render time. Soft-deleted via `is_archived`; queries must filter on `is_archived = false` unless explicitly fetching archived templates. Every save that touches `layout` or `filters_default` snapshots the prior state into `report_template_versions` and bumps `version`.

| Column             | Type        | Description                                               |
| ------------------ | ----------- | --------------------------------------------------------- |
| `id`               | UUID        | Primary key                                               |
| `name`             | TEXT        | Human-readable template name                             |
| `description`      | TEXT        | Optional description                                      |
| `layout`           | JSONB       | Pages × widgets definition (report structure)             |
| `filters_default`  | JSONB       | Default filter set (date range, client scope, etc.)       |
| `default_client_id`| UUID        | FK → users.id — optional default client scope             |
| `schedule`         | JSONB       | Optional cron schedule for automated delivery             |
| `is_archived`      | BOOLEAN     | Soft-delete flag (default `false`)                        |
| `version`          | INTEGER     | Monotonically increasing version counter                  |
| `created_by`       | UUID        | FK → users.id (staff member who created the template)     |
| `created_at`       | TIMESTAMPTZ | Creation time                                             |
| `updated_at`       | TIMESTAMPTZ | Last update time                                          |

#### `report_template_versions`

Append-only snapshot table. A row is written before every structural save (`layout` or `filters_default` change) so the full edit history is preserved. `UNIQUE(template_id, version)` ensures version numbers are gapless per template.

| Column            | Type        | Description                                               |
| ----------------- | ----------- | --------------------------------------------------------- |
| `id`              | UUID        | Primary key                                               |
| `template_id`     | UUID        | FK → report_templates.id (CASCADE DELETE)                 |
| `version`         | INTEGER     | Snapshot version number (matches `report_templates.version` at the time of save) |
| `layout`          | JSONB       | Layout at this version                                    |
| `filters_default` | JSONB       | Filter defaults at this version                           |
| `created_by`      | UUID        | FK → users.id (staff member who triggered the save)       |
| `created_at`      | TIMESTAMPTZ | Snapshot time                                             |

**Unique constraint**: `(template_id, version)`

#### `report_generations`

Per-run record for every report generation request, whether triggered manually or by the cron scheduler. `hydrated_payload` stores the fully resolved widget data (may contain PHI) for the duration of the render and is never exposed by the `GET /api/reports/generations/:id` endpoint. After the PDF is written to `file_uploads`, `pdf_file_id` is set and `status` advances to `complete`.

| Column               | Type        | Description                                                                 |
| -------------------- | ----------- | --------------------------------------------------------------------------- |
| `id`                 | UUID        | Primary key                                                                 |
| `template_id`        | UUID        | FK → report_templates.id                                                    |
| `client_ids`         | UUID[]      | Array of client UUIDs scoped to this run                                    |
| `filters`            | JSONB       | Resolved filter set (generation-level overrides merged with template defaults) |
| `status`             | TEXT        | `pending`, `running`, `complete`, or `failed`                               |
| `hydrated_payload`   | JSONB       | Widget data used to render the PDF — contains PHI; **never returned by API** |
| `pdf_file_id`        | UUID        | FK → file_uploads.id — set on successful render                             |
| `generation_source`  | TEXT        | `manual` or `scheduled`                                                     |
| `generated_by`       | UUID        | FK → users.id (staff member who queued the generation, or scheduler user)   |
| `generated_at`       | TIMESTAMPTZ | When the generation was queued                                               |
| `completed_at`       | TIMESTAMPTZ | When status advanced to `complete` or `failed`                              |
| `created_at`         | TIMESTAMPTZ | Row creation time                                                            |
| `updated_at`         | TIMESTAMPTZ | Last status update time                                                      |

### Kinsta Operations Tables

#### `kinsta_sites`
One row per Kinsta site. Imported via `POST /api/operations/sites/sync` (manual, user-triggered).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Anchor internal id |
| `kinsta_site_id` | TEXT UNIQUE | Kinsta site UUID |
| `site_name` / `display_name` | TEXT | Display name overrideable by admin |
| `archived_at` | TIMESTAMPTZ | Soft delete |
| `metadata` | JSONB | Free-form |

#### `kinsta_environments`
Live + staging envs under a site. SSH passwords encrypted with Anchor's `services/security/encryption.js`. **Never returned to frontend** — `serializeEnvironment()` strips ciphertext and exposes `ssh_password_present` only.

Includes `metadata.read_only` toggle: when true, `execCommand` refuses any non-read WP-CLI verb (belt + suspenders enforcement, agent is also told via system prompt).

#### `kinsta_site_workspaces`
Per-site CLAUDE.md and last scan_json. Cloud Run filesystem is ephemeral — this is canonical AI context. Auto-scan sections marked with `<!-- AUTO-SCAN -->` are replaced on re-scan; manual sections (`Issue Log`, `Agent Notes`) survive via `claudeMdMerge.js`.

#### `kinsta_site_clients`
Many-to-many between Kinsta sites and Anchor client users. UNIQUE on `(site_id, client_user_id, relationship)` — one client can hold multiple relationships ('primary' / 'staging' / 'microsite') to the same site.

#### `kinsta_ssh_command_log`
Append-only audit trail. Every `execCommand`, `wpcli`, `withSftp`, agent tool call, bulk action, drift scan, and shell session writes a row. Channels: `shell|exec|sftp|bulk|agent`. `triggered_by` examples: `manual`, `agent:divi`, `bulk:plugin_update`, `scanner`, `drift`.

#### `kinsta_bulk_operations`
One row per portfolio-wide job. Status: `queued → running → completed|cancelled|failed`. `result_json.targets[envId]` holds per-target `{status, result, duration_ms}`. Concurrency 10. User-triggered only — never on a cron.

#### `kinsta_findings`
Drift-detection results from `runDriftCheck()`. Severities: `critical|warning|info`. Categories: `wp_version_drift`, `plugin_added`, `plugin_removed`, `plugin_updates_available`, `siteurl_changed`, `debug_enabled`, `theme_changed`, `tracking_missing`. Indexed on `(site_id) WHERE resolved_at IS NULL` for fast open-counts.

---

### Social Publishing

**Social Publishing** — Internal FB/IG posting workflow
- `meta_page_links` — Per-client mapping to one Facebook Page (and linked Instagram Business account, if any). Stores the encrypted page-specific access token and the per-client `scheduling_enabled` flag.
- `social_posts` — Full post lifecycle: draft / scheduled / publishing / published / partially_published / failed / cancelled. Carries platforms (`fb`, `ig`, or both), content, media JSONB, scheduled_for, retry_count, fb_post_id, ig_media_id, idempotency_key.
- `social_media_tokens` — HMAC token records for the public `/api/social/media/:token` endpoint. Stored for revocation tracking; verification is stateless.

---

## Quick Links

- **Get Started**: [README.md](README.md) | [docs/SETUP.md](docs/SETUP.md)
- **Architecture**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **APIs**: [docs/API_REFERENCE.md](docs/API_REFERENCE.md)
- **Security**: [docs/SECURITY.md](docs/SECURITY.md)
- **Integrations**: [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)
- **Workflows**: [docs/DATA_FLOWS.md](docs/DATA_FLOWS.md)

---

_Last updated: April 2026_

**Recent updates:**
- Report Builder Phase 1: `report_templates`, `report_template_versions`, `report_generations` tables; 12 REST endpoints under `/api/reports`; PDF render pipeline via Puppeteer (lazy-loaded); scheduled delivery cron; full audit logging
- Tracking provisioning system: GTM container provisioning, GA4 Measurement Protocol relay, Meta CAPI relay with HIPAA-safe scrubbing
- Twilio call tracking integration: Alternative to CTM with push-based webhooks, tracking numbers, attribution tracking
- Forms system: Global presets, form builder, embeddable forms with PHI encryption for intake forms
- Unified lead pipeline: Calls (CTM/Twilio) and form submissions feed into same lead management system
- Attribution tracking: Google GCLID, Facebook Pixel, UTM parameters captured for all lead sources
- Client team management: Multi-user client accounts with invitation system
- Documentation suite added (README, SETUP, ARCHITECTURE, DATA_FLOWS, API_REFERENCE, SECURITY, INTEGRATIONS)
- Lead categories: `converted` is now manual-only (not AI-assigned)
- Reclassify Leads feature added for admins
- Security infrastructure: sessions, MFA, audit logging
