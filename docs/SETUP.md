# Development Environment Setup

> **MAINTENANCE DIRECTIVE**: Update this file when:
> - Required Node.js/Yarn versions change
> - New environment variables are added
> - Database setup process changes
> - New migration files are added to `server/sql/`
> - Dependencies with native build requirements change
> - Development workflow or scripts change

This guide walks through setting up the Anchor Client Dashboard for local development.

---

## Prerequisites

### Required Software

| Software | Version | Installation |
|----------|---------|--------------|
| Node.js | 20.x LTS | [nodejs.org](https://nodejs.org/) or via nvm |
| Yarn | 4.10.3 | Via Corepack (included with Node 20) |
| PostgreSQL | 14+ | [postgresql.org](https://www.postgresql.org/download/) or Homebrew |
| Git | Latest | [git-scm.com](https://git-scm.com/) |

### Optional (for full functionality)

| Software | Purpose |
|----------|---------|
| Google Cloud SDK | Deployment, Vertex AI local testing |
| Docker | Local container testing |
| Mailgun Account | Email sending |
| CTM Account | Call tracking integration |

---

## Installation Steps

### 1. Clone Repository

```bash
git clone <repository-url>
cd Anchor-Client-Dashboard
```

### 2. Enable Yarn via Corepack

```bash
# Corepack is included with Node.js 20+
corepack enable

# Verify Yarn version
yarn --version
# Should output: 4.10.3
```

### 3. Install Dependencies

```bash
yarn install
```

> **Important**: Always use `yarn install`, never `npm install`. The project uses Yarn 4 with `--immutable` in CI/CD.

### 4. Configure Environment Variables

Create `.env` file in project root:

```bash
cp .env.example .env
```

Edit `.env` with your values (see Environment Variables section below).

### 5. Set Up PostgreSQL

**Option A: Local PostgreSQL**

```bash
# macOS with Homebrew
brew install postgresql@14
brew services start postgresql@14

# Create database
createdb anchor_dashboard
```

**Option B: Docker PostgreSQL**

```bash
docker run -d \
  --name anchor-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=anchor_dashboard \
  -p 5432:5432 \
  postgres:14
```

### 6. Initialize Database

```bash
# Run schema initialization
yarn db:init

# This executes server/sql/init.sql
```

### 7. Start Development Servers

You need **two terminal windows/tabs**:

**Terminal 1 - API Server:**
```bash
yarn server
# Starts on http://localhost:4000
```

**Terminal 2 - Frontend Dev Server:**
```bash
yarn start
# Starts on http://localhost:3000
# Opens browser automatically
```

### 8. Verify Setup

- Open http://localhost:3000
- You should see the login page
- Check http://localhost:4000/api/health for `{"ok":true}`

---

## Environment Variables

### Required Variables

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/anchor_dashboard

# JWT Authentication
JWT_SECRET=your-secure-random-string-at-least-32-chars
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=30d

# Application URLs
APP_BASE_URL=http://localhost:3000
CLIENT_APP_URL=http://localhost:3000
VITE_APP_BASE_NAME=/

# Server Configuration
API_SERVER_PORT=4000
NODE_ENV=development
```

### Google Cloud / Vertex AI

```bash
# Path to service account JSON key file
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Google Cloud Project
GCP_PROJECT_ID=your-project-id

# Vertex AI Models
VERTEX_MODEL=gemini-2.0-flash-001
VERTEX_CLASSIFIER_MODEL=gemini-2.0-flash-001
VERTEX_IMAGEN_MODEL=imagen-3.0-generate-001

# Vertex AI Location
VERTEX_LOCATION=us-central1
```

### Mailgun (Email)

```bash
# Mailgun API Credentials
MAILGUN_API_KEY=your-mailgun-api-key
MAILGUN_DOMAIN=mail.yourdomain.com

# Sender Configuration
MAILGUN_FROM_EMAIL=noreply@yourdomain.com
MAILGUN_FROM_NAME=Anchor Dashboard
```

### CallTrackingMetrics (CTM)

```bash
# CTM API Credentials (set per-client in database)
# These are defaults if not set per-client
CTM_API_KEY=your-ctm-api-key
CTM_API_SECRET=your-ctm-api-secret
```

### CORS & Security

```bash
# Allowed origins for CORS (comma-separated)
CORS_ORIGINS=http://localhost:3000,http://localhost:4173

# Content Security Policy - Frame sources (for Looker embeds)
CSP_FRAME_SRC=https://looker.yourdomain.com

# Content Security Policy - Image sources
CSP_IMG_SRC=https://storage.googleapis.com
```

### Optional Variables

```bash
# Run database migrations on server start (production default: true)
RUN_MIGRATIONS_ON_START=false

# Upload directory (defaults to ./uploads)
UPLOAD_DIR=uploads

# Task archive retention (days)
TASK_ARCHIVE_RETENTION_DAYS=30
```

---

## Database Setup Details

### Schema Initialization

The main schema is defined in `server/sql/init.sql`. This file:
- Creates all tables with `IF NOT EXISTS` (idempotent)
- Sets up indexes and constraints
- Can be run multiple times safely

### Migration Files

Additional migrations in `server/sql/`:

| File | Purpose |
|------|---------|
| `init.sql` | Main schema (users, clients, calls, journeys, etc.) |
| `migrate_security.sql` | Session management, MFA, audit logging |
| `migrate_reviews.sql` | Review management schema |
| `migrate_onboarding_token_value.sql` | Onboarding token updates |
| `migrate_wordpress_oauth.sql` | WordPress OAuth provider |

Migrations run automatically on server start when `RUN_MIGRATIONS_ON_START=true`.

### Manual Database Commands

```bash
# Connect to local database
psql postgresql://postgres:postgres@localhost:5432/anchor_dashboard

# Run specific migration
psql "$DATABASE_URL" -f server/sql/migrate_security.sql

# Reset database (WARNING: destroys all data)
dropdb anchor_dashboard && createdb anchor_dashboard && yarn db:init
```

---

## Google Cloud Setup

### Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to **IAM & Admin** > **Service Accounts**
3. Create a service account with these roles:
   - Vertex AI User
   - Storage Object Viewer (if using Cloud Storage)
4. Create and download JSON key
5. Set `GOOGLE_APPLICATION_CREDENTIALS` to the key file path

### Enable APIs

Enable these APIs in your project:

- Vertex AI API
- Cloud Run API (for deployment)
- Artifact Registry API (for deployment)
- Cloud Build API (for deployment)

---

## IDE Configuration

### VS Code / Cursor

Recommended extensions:
- ESLint
- Prettier - Code formatter
- PostgreSQL (for database queries)

Recommended settings (`.vscode/settings.json`):

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "eslint.validate": ["javascript", "javascriptreact"]
}
```

### ESLint & Prettier

The project includes ESLint and Prettier configuration:

```bash
# Check for lint errors
yarn lint

# Auto-fix lint errors
yarn lint:fix

# Format code
yarn prettier
```

---

## Common Issues

### "yarn.lock out of sync" in CI/CD

**Cause**: `package.json` was updated without running `yarn install`

**Solution**:
```bash
yarn install
git add yarn.lock package.json
git commit -m "Update yarn.lock"
```

### "Cannot find module" errors

**Cause**: Dependencies not installed or stale

**Solution**:
```bash
rm -rf node_modules
yarn install
```

### Database connection errors

**Cause**: PostgreSQL not running or wrong credentials

**Solution**:
```bash
# Check if PostgreSQL is running
pg_isready

# Verify DATABASE_URL
echo $DATABASE_URL

# Test connection
psql "$DATABASE_URL" -c "SELECT 1;"
```

### Port already in use

**Cause**: Previous server instance still running

**Solution**:
```bash
# Kill process on port 4000
lsof -ti:4000 | xargs kill -9

# Kill process on port 3000
lsof -ti:3000 | xargs kill -9
```

### Canvas/Argon2 build errors

**Cause**: Missing native dependencies

**Solution (macOS)**:
```bash
brew install pkg-config cairo pango libpng jpeg giflib librsvg
```

**Solution (Ubuntu/Debian)**:
```bash
apt-get install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

---

## Development Workflow

### Typical Development Session

1. Start database (if using Docker):
   ```bash
   docker start anchor-postgres
   ```

2. Start API server:
   ```bash
   yarn server
   ```

3. Start frontend (new terminal):
   ```bash
   yarn start
   ```

4. Make changes - both servers hot-reload

5. Before committing:
   ```bash
   yarn lint:fix
   yarn prettier
   ```

### Testing Changes

- **Frontend**: Changes hot-reload automatically
- **Backend**: Server restarts on file changes (nodemon-like behavior via node --watch)
- **Database**: Run `yarn db:init` after schema changes

### Creating a Test User

After initial setup, create an admin user:

```sql
-- Connect to database
psql "$DATABASE_URL"

-- Create superadmin user (password: TestPassword123!)
INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified_at)
VALUES (
  uuid_generate_v4(),
  'admin@example.com',
  '$argon2id$v=19$m=65536,t=3,p=4$your-hash-here',
  'Admin',
  'User',
  'superadmin',
  NOW()
);
```

Or use the registration flow if enabled.

---

## Next Steps

- Read [ARCHITECTURE.md](ARCHITECTURE.md) to understand the system design
- Review [API_REFERENCE.md](API_REFERENCE.md) for endpoint documentation
- Check [SKILLS.md](../SKILLS.md) for complete feature reference

---

*Last updated: January 2026*

