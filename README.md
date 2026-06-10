# Anchor Client Dashboard

> **⚠️ SECURITY NOTICE**: This application handles **Protected Health Information (PHI)** and is subject to HIPAA compliance requirements. Security is of utmost importance. All contributors must:
> - Never log or expose PHI in error messages, console output, or API responses
> - Use parameterized queries exclusively (no string concatenation for SQL)
> - Validate and sanitize all user input
> - Ensure encryption at rest and in transit for sensitive data
> - Follow the principle of least privilege for all access controls
> - Report any potential security vulnerabilities immediately

> **MAINTENANCE DIRECTIVE**: Update this file when:
> - Project structure changes (new folders, reorganization)
> - Tech stack versions are upgraded (React, Vite, MUI, etc.)
> - New major features are added
> - Available scripts in `package.json` change
> - Deployment process changes

A comprehensive CRM and client management platform designed for service businesses. Integrates call tracking, lead management, client onboarding, task management, content creation, and review management into a unified dashboard.

---

## Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| **Frontend** | React | 19.2.0 |
| **Build Tool** | Vite | 7.1.9 |
| **UI Framework** | Material-UI (MUI) | 7.3.4 |
| **Backend** | Express.js | 4.19.2 |
| **Database** | PostgreSQL | 8.13.1 (pg driver) |
| **Authentication** | JWT + Argon2id | Custom implementation |
| **AI/ML** | Google Vertex AI | Gemini + Imagen |
| **Email** | Mailgun | 12.1.1 |
| **Deployment** | Google Cloud Run | Containerized |

---

## Quick Start

### Prerequisites

- **Node.js** 20.x (LTS recommended)
- **Yarn** 4.10.3 (managed via Corepack)
- **PostgreSQL** 14+ (local or Cloud SQL)
- **Google Cloud** credentials (for Vertex AI, Cloud Run)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd Anchor-Client-Dashboard

# Enable Yarn via Corepack
corepack enable

# Install dependencies
yarn install

# Copy environment template and configure
cp .env.example .env
# Edit .env with your credentials

# Initialize database
yarn db:init

# Start development servers (two terminals)
yarn server    # Terminal 1: API server on port 4000
yarn start     # Terminal 2: Vite dev server on port 3000
```

### Development URLs

- **Frontend**: http://localhost:3000
- **API Server**: http://localhost:4000
- **Health Check**: http://localhost:4000/api/health

---

## Project Structure

```
Anchor-Client-Dashboard/
├── server/                    # Express.js backend
│   ├── auth.js               # Authentication endpoints
│   ├── db.js                 # PostgreSQL connection
│   ├── index.js              # Server entry point
│   ├── middleware/           # Auth, rate limiting, roles
│   ├── routes/               # API route handlers
│   │   ├── hub.js            # Main CRM endpoints
│   │   ├── onboarding.js     # Client onboarding
│   │   ├── tasks.js          # Task management
│   │   ├── forms.js          # Form builder
│   │   ├── reviews.js        # Review management
│   │   └── webhooks.js       # Mailgun webhooks
│   ├── services/             # Business logic
│   │   ├── ai.js             # Vertex AI integration
│   │   ├── ctm.js            # CallTrackingMetrics
│   │   ├── mailgun.js        # Email service
│   │   ├── security/         # Auth infrastructure
│   │   └── ...
│   └── sql/                  # Database migrations
│       └── init.sql          # Main schema
│
├── src/                       # React frontend
│   ├── api/                  # API client modules
│   ├── assets/               # Images, SCSS
│   ├── contexts/             # React contexts (Auth, Config, Toast)
│   ├── hooks/                # Custom React hooks
│   ├── layout/               # MainLayout, navigation
│   ├── routes/               # React Router configuration
│   ├── themes/               # MUI theme customization
│   ├── ui-component/         # Reusable UI components
│   └── views/                # Page components
│       ├── admin/            # Admin Hub, Services, Clients
│       ├── client/           # Client Portal, Blog, Reviews
│       ├── forms/            # Forms Manager
│       ├── pages/            # Auth, Onboarding
│       └── tasks/            # Task Manager
│
├── uploads/                   # User uploads (local dev only)
├── docs/                      # Additional documentation
├── Dockerfile                 # Production container
├── cloudbuild.yaml           # Cloud Build pipeline
├── vite.config.mjs           # Vite configuration
├── package.json              # Dependencies
├── yarn.lock                 # Lockfile (MUST be committed)
└── SKILLS.md                 # Detailed capabilities reference
```

---

## Key Features

### For Admins
- **Client Hub**: Manage client accounts, configurations, and onboarding
- **Lead Management**: View, classify, and manage inbound calls from CTM
- **Task Management**: Internal task boards with automation
- **Forms Builder**: Create embeddable forms with AI processing
- **Email Logs**: Track all outbound client communications
- **Service Management**: Define and manage service offerings

### For Clients
- **Client Portal**: Unified dashboard for leads, journeys, and documents
- **Brand Assets**: Upload logos, style guides, brand colors
- **Blog Editor**: AI-assisted content creation
- **Review Management**: Respond to Google Business Profile reviews
- **Document Library**: Access shared documents from admin

### Integrations
- **CallTrackingMetrics (CTM)**: Call data sync with two-way rating
- **Google Vertex AI**: Content generation and call classification
- **Mailgun**: Transactional emails with tracking
- **Monday.com**: Task synchronization
- **Google Business Profile**: Review management
- **Looker**: Embedded analytics dashboards

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `yarn start` | Start Vite dev server (port 3000) |
| `yarn server` | Start Express API server (port 4000) |
| `yarn build` | Build production frontend |
| `yarn preview` | Preview production build |
| `yarn db:init` | Run database initialization |
| `yarn lint` | Run ESLint |
| `yarn lint:fix` | Fix ESLint errors |
| `yarn prettier` | Format code with Prettier |

---

## Deployment

The application is deployed to **Google Cloud Run** via Cloud Build.

```bash
# Trigger deployment (from main branch)
git push origin main

# Cloud Build automatically:
# 1. Builds Docker image
# 2. Pushes to Artifact Registry
# 3. Deploys to Cloud Run
```

See [cloudbuild.yaml](cloudbuild.yaml) for pipeline configuration.

---

## Documentation

| Document | Description |
|----------|-------------|
| [SKILLS.md](SKILLS.md) | Complete capabilities and database schema reference |
| [docs/SETUP.md](docs/SETUP.md) | Detailed development environment setup |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture and design patterns |
| [docs/DATA_FLOWS.md](docs/DATA_FLOWS.md) | Business workflow documentation |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | Complete API endpoint documentation |
| [docs/SECURITY.md](docs/SECURITY.md) | Authentication and security architecture |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Third-party integration guides |

---

## User Roles

| Role | Description | Access Level |
|------|-------------|--------------|
| `superadmin` | System administrator | Full access to all features |
| `admin` | Agency/company admin | Client management, act-as-client |
| `team` | Internal team member | Tasks, forms, limited admin |
| `editor` | Content editor | Blog, content editing |
| `client` | End client user | Own portal only |

---

## Environment Variables

See [docs/SETUP.md](docs/SETUP.md) for a complete list of required environment variables.

Key variables:
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Token signing secret
- `GOOGLE_APPLICATION_CREDENTIALS` - Path to GCP service account key
- `MAILGUN_API_KEY` - Mailgun API key
- `CTM_API_KEY` / `CTM_API_SECRET` - CallTrackingMetrics credentials

---

## Maintenance Notes

> **IMPORTANT**: When adding npm packages, always run `yarn install` to update `yarn.lock`, then commit both files. Cloud Build uses `--immutable` and will fail if the lockfile is out of sync.

> **Database Changes**: When modifying the database schema, update both `server/sql/init.sql` and the Database Schema Map section in [SKILLS.md](SKILLS.md).

---

## License

Proprietary - Anchor Corps

---

*Last updated: January 2026*

