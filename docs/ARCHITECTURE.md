# System Architecture

> **MAINTENANCE DIRECTIVE**: Update this file when:
> - New service files are added to `server/services/`
> - New route files are added to `server/routes/`
> - Frontend folder structure changes in `src/`
> - Middleware chain is modified
> - Database architecture changes (new table relationships)
> - Deployment architecture changes
> - New scheduled jobs are added

This document describes the overall architecture of the Anchor Client Dashboard application.

---

## High-Level Architecture

```mermaid
graph TB
    subgraph client [Client Layer]
        Browser[Browser/SPA]
    end

    subgraph frontend [Frontend - React/Vite]
        ReactApp[React 19 App]
        Contexts[Auth/Config/Toast Contexts]
        ApiClients[API Client Modules]
    end

    subgraph backend [Backend - Express.js]
        ExpressServer[Express Server]
        Middleware[Auth/Rate Limit/Roles]
        Routes[API Routes]
        Services[Business Services]
    end

    subgraph data [Data Layer]
        PostgreSQL[(PostgreSQL)]
        FileStorage[File Storage]
    end

    subgraph external [External Services]
        CTM[CallTrackingMetrics]
        Mailgun[Mailgun]
        VertexAI[Google Vertex AI]
        GBP[Google Business Profile]
    end

    Browser --> ReactApp
    ReactApp --> Contexts
    ReactApp --> ApiClients
    ApiClients --> ExpressServer
    ExpressServer --> Middleware
    Middleware --> Routes
    Routes --> Services
    Services --> PostgreSQL
    Services --> FileStorage
    Services --> CTM
    Services --> Mailgun
    Services --> VertexAI
    Services --> GBP
```

---

## Folder Structure

### Root Level

```
Anchor-Client-Dashboard/
├── server/          # Express.js backend (Node.js)
├── src/             # React frontend (Vite)
├── uploads/         # User uploads (local dev only)
├── dist/            # Production build output
├── docs/            # Documentation
├── node_modules/    # Dependencies
├── Dockerfile       # Production container definition
├── cloudbuild.yaml  # CI/CD pipeline
├── vite.config.mjs  # Vite configuration
├── package.json     # Dependencies and scripts
├── yarn.lock        # Dependency lockfile
├── .env             # Environment variables (not committed)
├── .env.public      # Public env vars (committed)
└── SKILLS.md        # Capabilities reference
```

### Server Directory (`server/`)

```
server/
├── index.js              # Entry point, middleware setup, cron jobs
├── auth.js               # Authentication endpoints (/api/auth/*)
├── db.js                 # PostgreSQL connection pool
├── loadEnv.js            # Environment loading
│
├── middleware/
│   ├── auth.js           # JWT verification, user attachment
│   ├── rateLimit.js      # Request rate limiting
│   └── roles.js          # Role-based access control
│
├── routes/
│   ├── hub.js            # Main CRM endpoints (/api/hub/*)
│   ├── onboarding.js     # Client onboarding (/api/onboarding/*)
│   ├── tasks.js          # Task management (/api/tasks/*)
│   ├── reviews.js        # Review management (/api/reviews/*)
│   └── webhooks.js       # Webhook handlers (/api/webhooks/*)
│
├── services/
│   ├── ai.js             # Vertex AI content generation
│   ├── ctm.js            # CallTrackingMetrics integration
│   ├── mailgun.js        # Email sending and logging
│   ├── imagen.js         # Vertex Imagen image generation
│   ├── reviews.js        # Google Business Profile reviews
│   ├── notifications.js  # In-app notifications
│   ├── emailTemplate.js  # Email HTML templates
│   ├── onboardingPdf.js  # Onboarding PDF generation
│   ├── onboardingReminders.js # Expiry reminders
│   ├── taskAutomations.js     # Task automation engine
│   ├── taskCleanup.js    # Archived task purging
│   ├── oauthIntegration.js    # OAuth token management
│   └── security/         # Security infrastructure
│       ├── index.js      # Security module exports
│       ├── audit.js      # Security audit logging
│       ├── deviceFingerprint.js # Device tracking
│       ├── mfa.js        # Multi-factor authentication
│       ├── passwordPolicy.js   # Password validation
│       ├── rateLimit.js  # Auth rate limiting
│       ├── sessions.js   # Session management
│       └── tokens.js     # JWT token handling
│
├── sql/
│   ├── init.sql          # Main database schema
│   ├── migrate_security.sql   # Security tables
│   ├── migrate_reviews.sql    # Reviews schema
│   └── migrate_*.sql     # Other migrations
│
└── utils/
    └── roles.js          # Role hierarchy utilities
```

### Frontend Directory (`src/`)

```
src/
├── index.jsx             # React entry point
├── App.jsx               # Root component with providers
├── config.js             # Frontend configuration
│
├── api/                  # API client modules
│   ├── client.js         # Axios instance with interceptors
│   ├── tokenStore.js     # Access token management
│   ├── auth.js           # Auth endpoints
│   ├── calls.js          # Lead/call endpoints
│   ├── journeys.js       # Journey endpoints
│   ├── clients.js        # Client management
│   ├── profile.js        # User profile
│   ├── brand.js          # Brand assets
│   ├── documents.js      # Document management
│   ├── tasks.js          # Task management
│   ├── reviews.js        # Review management
│   ├── emailLogs.js      # Email logs
│   ├── oauth.js          # OAuth connections
│   └── ...
│
├── assets/
│   ├── images/           # Static images, icons
│   └── scss/             # Global styles, theme variables
│
├── constants/
│   └── clientPresets.js  # Client type configurations
│
├── contexts/
│   ├── AuthContext.jsx   # Authentication state
│   ├── ConfigContext.jsx # App configuration
│   └── ToastContext.jsx  # Toast notifications
│
├── hooks/
│   ├── useAuth.js        # Auth context hook
│   ├── useConfig.js      # Config context hook
│   └── ...
│
├── layout/
│   ├── MainLayout/       # Authenticated layout
│   │   ├── index.jsx     # Layout wrapper
│   │   ├── Header/       # Top navigation bar
│   │   ├── Sidebar/      # Left navigation
│   │   ├── MenuList/     # Navigation menu items
│   │   └── LogoSection/  # Logo component
│   ├── MinimalLayout/    # Unauthenticated layout
│   └── NavigationScroll.jsx
│
├── menu-items/           # Navigation menu definitions
│   ├── index.js          # Menu aggregator
│   ├── portal.js         # Client portal menu
│   ├── clientHub.js      # Admin hub menu
│   └── tasks.js          # Tasks menu
│
├── routes/
│   ├── index.jsx         # Route configuration
│   ├── MainRoutes.jsx    # Authenticated routes
│   ├── AuthenticationRoutes.jsx # Auth routes
│   ├── RequireAuth.jsx   # Auth guard
│   ├── ErrorBoundary.jsx # Error handling
│   └── paths.js          # Route path constants
│
├── themes/
│   ├── index.jsx         # MUI theme provider
│   ├── palette.jsx       # Color palette
│   ├── typography.jsx    # Typography settings
│   └── overrides/        # Component overrides
│
├── ui-component/
│   ├── Loader.jsx        # Loading spinner
│   ├── Loadable.jsx      # Lazy loading wrapper
│   ├── Logo.jsx          # Logo component
│   ├── FireworksCanvas.jsx # Celebration animation
│   ├── cards/            # Card components
│   └── extended/         # Extended MUI components
│
├── utils/
│   ├── errors.js         # Error handling utilities
│   ├── colorUtils.js     # Color manipulation
│   └── password-strength.js # Password validation
│
└── views/                # Page components
    ├── admin/            # Admin-only views
    │   ├── AdminHub.jsx  # Client/admin management
    │   ├── ClientView.jsx # Client view mode
    │   ├── ProfileSettings.jsx
    │   ├── ServicesManagement.jsx
    │   ├── ActiveClients.jsx
    │   └── SharedDocuments.jsx
    │
    ├── client/           # Client portal views
    │   ├── ClientPortal.jsx # Main client dashboard
    │   ├── BlogEditor.jsx   # Blog management
    │   └── ReviewsPanel.jsx # Review responses
    │
    ├── tasks/
    │   ├── TaskManager.jsx  # Task board
    │   ├── components/      # Task components
    │   └── panes/           # Task detail panes
    │
    └── pages/
        ├── auth-forms/      # Login/register forms
        ├── authentication/  # Auth pages
        └── onboarding/      # Client onboarding wizard
```

---

## Request Lifecycle

```mermaid
sequenceDiagram
    participant Browser
    participant Vite as Vite Dev Server
    participant Express as Express Server
    participant Middleware
    participant Route as Route Handler
    participant Service
    participant DB as PostgreSQL

    Browser->>Vite: GET /portal (SPA route)
    Vite->>Browser: index.html + JS bundles
    Browser->>Browser: React app renders

    Browser->>Express: POST /api/auth/login
    Express->>Middleware: CORS check
    Middleware->>Middleware: Body parsing
    Middleware->>Route: auth.js handler
    Route->>Service: security/sessions.js
    Service->>DB: Validate credentials
    DB->>Service: User record
    Service->>Route: JWT tokens
    Route->>Browser: { accessToken, user }

    Browser->>Express: GET /api/hub/calls (with Bearer token)
    Express->>Middleware: JWT verification
    Middleware->>Middleware: Rate limiting
    Middleware->>Middleware: Role check
    Middleware->>Route: hub.js handler
    Route->>Service: ctm.js
    Service->>DB: Query call_logs
    DB->>Service: Results
    Service->>Route: Processed data
    Route->>Browser: JSON response
```

---

## Authentication Architecture

```mermaid
flowchart TD
    subgraph client [Browser]
        TokenStore[tokenStore.js - Access Token in Memory]
        Cookies[HTTP-Only Cookie - Refresh Token]
    end

    subgraph auth [Auth Flow]
        Login[POST /api/auth/login]
        Refresh[POST /api/auth/refresh]
        Verify[JWT Middleware]
    end

    subgraph security [Security Layer]
        Sessions[(user_sessions table)]
        MFA[MFA Challenge]
        Audit[(security_audit_log)]
    end

    Login --> MFA
    MFA --> Sessions
    Sessions --> TokenStore
    Sessions --> Cookies

    TokenStore --> Verify
    Verify --> Route[Protected Route]

    Cookies --> Refresh
    Refresh --> Sessions
    Sessions --> TokenStore
```

**Key Points:**
- Access tokens are short-lived (15 min) and stored in memory
- Refresh tokens are HTTP-only cookies (30-day sliding window)
- Sessions have absolute expiry (90 days)
- MFA is triggered for new devices, new IPs, or after inactivity
- All auth events are logged to `security_audit_log`

---

## State Management

### Frontend State

```mermaid
graph TB
    subgraph contexts [React Contexts]
        AuthContext[AuthContext<br/>user, tokens, impersonation]
        ConfigContext[ConfigContext<br/>theme, settings]
        ToastContext[ToastContext<br/>notifications]
    end

    subgraph local [Local State]
        ComponentState[useState/useReducer<br/>per-component]
        SessionStorage[sessionStorage<br/>actingClientId]
    end

    subgraph server [Server State]
        ApiCalls[API Calls<br/>fetch on mount/action]
        SWR[SWR/React Query*<br/>caching, revalidation]
    end

    AuthContext --> ComponentState
    ConfigContext --> ComponentState
    ToastContext --> ComponentState
    SessionStorage --> AuthContext
    ApiCalls --> ComponentState
```

**Pattern:**
- Global state in Contexts (auth, config, toasts)
- Server state fetched via API calls, stored locally in components
- `actingClientId` in sessionStorage for admin "view as client" mode
- No Redux - uses React Context + local state

**CRITICAL - Immediate UI Feedback:**
All state-changing actions (button clicks, form submissions, toggles, activations, deletions, etc.) must immediately update the UI to reflect the change. Do not wait for a full refetch. Use server-returned data to update local state optimistically. This pattern:
- Prevents users from triggering duplicate actions
- Provides clear confirmation that actions succeeded
- Ensures the UI always reflects the current state

Example: When activating a client, use the `client` object returned by the API to update `setClients()` immediately, rather than requiring a page refresh.

### Backend State

- **Stateless API**: No in-memory session state
- **Database**: PostgreSQL is the source of truth
- **Sessions**: Tracked in `user_sessions` table
- **File uploads**: Local filesystem (dev) or ephemeral (Cloud Run)
- **Binary data**: Stored in PostgreSQL (avatars, some assets)

---

## Database Architecture

```mermaid
erDiagram
    users ||--o{ client_profiles : has
    users ||--o{ call_logs : owns
    users ||--o{ client_journeys : owns
    users ||--o{ active_clients : owns
    users ||--o{ documents : uploads
    users ||--o{ brand_assets : has
    users ||--o{ user_sessions : has
    users ||--o{ oauth_connections : has

    client_profiles ||--o{ services : offers

    call_logs }|--o| active_clients : links_to
    call_logs ||--o{ call_log_tags : has
    call_logs ||--o{ lead_notes : has

    client_journeys ||--o{ client_journey_steps : contains
    client_journeys ||--o{ client_journey_notes : has
    client_journeys }|--o| active_clients : converts_to
    client_journeys }|--o| services : for_service

    active_clients ||--o{ client_services : receives

    lead_tags ||--o{ call_log_tags : applied_to

    oauth_connections ||--o{ oauth_resources : has

    task_workspaces ||--o{ task_boards : contains
    task_boards ||--o{ task_groups : contains
    task_groups ||--o{ task_items : contains
    task_items ||--o{ task_updates : has
```

**Core Tables:**
- `users` - All user accounts (clients, admins, team)
- `client_profiles` - Extended client configuration
- `call_logs` - Lead/call records from CTM
- `client_journeys` - Journey tracking for leads
- `active_clients` - Converted customers
- `user_sessions` - Active login sessions

See [SKILLS.md](../SKILLS.md) for complete schema documentation.

---

## Deployment Architecture

```mermaid
flowchart LR
    subgraph dev [Development]
        LocalNode[Node.js]
        LocalPG[(Local PostgreSQL)]
        LocalFiles[Local Filesystem]
    end

    subgraph ci [CI/CD]
        GitHub[GitHub Push]
        CloudBuild[Cloud Build]
        ArtifactRegistry[Artifact Registry]
    end

    subgraph prod [Production - GCP]
        CloudRun[Cloud Run<br/>Container Instances]
        CloudSQL[(Cloud SQL<br/>PostgreSQL)]
        SecretManager[Secret Manager]
    end

    GitHub --> CloudBuild
    CloudBuild --> ArtifactRegistry
    ArtifactRegistry --> CloudRun
    CloudRun --> CloudSQL
    CloudRun --> SecretManager
```

**Production Characteristics:**
- **Stateless containers**: No persistent local storage
- **Horizontal scaling**: 1-3 instances (configurable)
- **Database**: Cloud SQL with connection pooling
- **Secrets**: Loaded from Secret Manager via environment
- **No persistent uploads**: Must use database or Cloud Storage

---

## API Architecture

### Route Organization

| Router | Mount Path | Purpose |
|--------|------------|---------|
| `auth.js` | `/api/auth` | Authentication (login, logout, MFA) |
| `hub.js` | `/api/hub` | Main CRM operations (clients, calls, journeys) |
| `onboarding.js` | `/api/onboarding` | Client onboarding wizard |
| `tasks.js` | `/api/tasks` | Task management system |
| `reviews.js` | `/api/reviews` | Review management |
| `webhooks.js` | `/api/webhooks` | External webhooks (Mailgun) |

### Middleware Chain

```
Request
  ↓
CORS (cors)
  ↓
Body Parser (express.json)
  ↓
Cookie Parser
  ↓
Helmet (Security Headers)
  ↓
JWT Verification (if /api/*)
  ↓
Rate Limiting
  ↓
Role Check
  ↓
Route Handler
  ↓
Response
```

### Error Handling

```javascript
// Errors bubble up to global handler in server/index.js
app.use((err, req, res, _next) => {
  console.error('[server-error]', err);
  const message = NODE_ENV === 'production' 
    ? 'Unexpected server error' 
    : err.message;
  res.status(500).json({ message });
});
```

---

## Scheduled Jobs

```mermaid
graph TD
    subgraph cron [node-cron Scheduler]
        OnboardingReminders[Every 30 min<br/>Onboarding Reminders]
        TaskPurge[Daily 2:20 AM<br/>Purge Archived Tasks]
        ServiceRedact[Daily 2:00 AM<br/>Redact Old Services]
        DueDateAuto[Hourly<br/>Due Date Automations]
        FormJobs[Every 30 sec<br/>Form Submission Jobs]
    end

    OnboardingReminders --> Mailgun
    TaskPurge --> DB[(PostgreSQL)]
    ServiceRedact --> DB
    DueDateAuto --> DB
    FormJobs --> CTM
    FormJobs --> Mailgun
    FormJobs --> DB
```

Jobs are defined in `server/index.js` using `node-cron`.

---

## Security Layers

1. **Transport**: HTTPS (enforced in Cloud Run)
2. **Headers**: Helmet sets security headers, CSP
3. **CORS**: Strict origin checking
4. **Authentication**: JWT with refresh token rotation
5. **Authorization**: Role-based access control
6. **Rate Limiting**: IP and user-based limits
7. **Input Validation**: Zod schemas on backend
8. **Audit Logging**: Immutable security event log

See [SECURITY.md](SECURITY.md) for detailed security documentation.

---

## Frontend Build

```mermaid
flowchart LR
    subgraph src [Source]
        JSX[React JSX]
        SCSS[SCSS Styles]
        Assets[Static Assets]
    end

    subgraph vite [Vite Build]
        ESBuild[esbuild - Transform]
        Rollup[Rollup - Bundle]
        Hash[Content Hashing]
    end

    subgraph dist [Output]
        HTML[index.html]
        JSChunks[JS Chunks<br/>with hashes]
        CSS[CSS Bundle]
        StaticAssets[Copied Assets]
    end

    JSX --> ESBuild
    SCSS --> Rollup
    Assets --> StaticAssets
    ESBuild --> Rollup
    Rollup --> Hash
    Hash --> JSChunks
    Hash --> CSS
    HTML --> dist
```

**Build Command:**
```bash
yarn build  # Outputs to ./dist
```

**Cache Strategy:**
- `index.html`: `no-store` (always fresh)
- `/assets/*`: `max-age=31536000, immutable` (hashed filenames)

---

## Related Documentation

- [SETUP.md](SETUP.md) - Development environment setup
- [DATA_FLOWS.md](DATA_FLOWS.md) - Business workflow documentation
- [API_REFERENCE.md](API_REFERENCE.md) - Complete API documentation
- [SECURITY.md](SECURITY.md) - Security architecture
- [INTEGRATIONS.md](INTEGRATIONS.md) - Third-party integrations
- [SKILLS.md](../SKILLS.md) - Capabilities and database schema

---

*Last updated: January 2026*

---

## Table component policy

All tabular views in `src/views` should use `ui-component/extended/DataTable` unless they require a layout DataTable cannot express (drag-and-drop boards, deeply nested expandable rows, embeddable sub-widgets, etc.). Each genuine exception is annotated inline with a `{/* custom table — */}` comment explaining why.

### Audit result (2026-05-07)

- **Files already using DataTable: 33** (imports verified via grep across `src/views`)
- **Custom table files justified by their layout (annotated inline): 11**
  - `src/views/admin/AdminHub.jsx` — drag-and-drop client grouping with collapsible group rows
  - `src/views/tasks/panes/BillingPane.jsx` — nested expandable rows with per-item time-entry sub-rows
  - `src/views/tasks/panes/MyWorkPane.jsx` — subitems nested under grouped parent BoardTable rows
  - `src/views/client/ClientPortal/LeadsTab.jsx` — multi-mode lead table with inline star/category editors, tutorial data-attrs, nested call-detail drawers, and per-row action menus
  - `src/views/admin/AdminHub/reports/widgets/googleAdsCampaigns/GoogleAdsCampaigns.jsx` — embeddable report widget with stickyHeader inside a flex chart/table toggle container
  - `src/views/admin/AdminHub/reports/widgets/ga4TrafficSummary/Ga4TrafficSummary.jsx` — same pattern
  - `src/views/admin/AdminHub/reports/widgets/metaCampaigns/MetaCampaigns.jsx` — same pattern
  - `src/views/admin/AdminHub/reports/widgets/leadsByDayTable/LeadsByDayTable.jsx` — embeddable report widget inside resizable grid card
  - `src/views/admin/AdminHub/reports/widgets/leadActivityTable/LeadActivityTable.jsx` — same pattern
  - `src/views/admin/AdminHub/reports/widgets/leadSourceBreakdown/LeadSourceBreakdownTable.jsx` — same pattern
  - `src/views/admin/AdminHub/reports/widgets/utmSourcesTable/UtmSourcesTable.jsx` — same pattern
- **Files identified as candidates for migration to DataTable (follow-up work): 8**
  - `src/views/admin/ActiveClients.jsx` — 3 raw table instances (group client list, overview stats); straightforward candidate
  - `src/views/admin/AdminHub/ActivityLogsTab.jsx` — simple log list with sort/search needs
  - `src/views/admin/AdminHub/AiClassificationLogsTab.jsx` — simple log list
  - `src/views/admin/AdminHub/EmailLogsSection.jsx` — simple email log list
  - `src/views/admin/AdminHub/tracking/ConversionEventsStep.jsx` — mapping table (has editable Select per row; needs custom cell renderer)
  - `src/views/client/ReviewsPanel.jsx` — 2 table instances for reviews list + automation rules
  - `src/views/ctm-forms/FormsListPane.jsx` — client-grouped forms list (uses DataTable for inner pane but still has a raw outer client Table)
  - `src/views/forms/FormsPane.jsx` — legacy decommissioned forms UI; low priority

Migration to DataTable should be done as one focused commit per file, with manual visual verification.
  Note: `src/views/admin/AdminHub.jsx` lines ~1834 and ~2161 also have two smaller inline tables (audit log snippet, OAuth token list) that are candidates but are deeply embedded in a 7400-line file — migrate with extra caution.

