# Multi-Agent Development Architecture

> **PURPOSE**: This document defines the multi-agent architecture for parallel development work on the Anchor Client Dashboard.

---

## Overview

This architecture enables efficient parallel development by splitting work across specialized agents coordinated by a master agent. Each agent has deep expertise in specific areas of the codebase.

---

## Agent Hierarchy

```
                    ┌─────────────────────┐
                    │   MASTER AGENT      │
                    │   (Coordinator)     │
                    └─────────┬───────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  BACKEND      │   │  FRONTEND     │   │  INFRASTRUCTURE│
│  AGENTS       │   │  AGENTS       │   │  AGENTS       │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                   │
   ┌────┴────┐         ┌────┴────┐         ┌────┴────┐
   │         │         │         │         │         │
   ▼         ▼         ▼         ▼         ▼         ▼
┌─────┐  ┌─────┐   ┌─────┐  ┌─────┐   ┌─────┐  ┌─────┐
│API  │  │Svc  │   │Views│  │API  │   │DB   │  │Docs │
│Agent│  │Agent│   │Agent│  │Client│   │Agent│  │Agent│
└─────┘  └─────┘   └─────┘  └─────┘   └─────┘  └─────┘
```

---

## Master Agent

### Role
- **Coordinator**: Receives feature requests, breaks them into tasks, assigns to specialized agents
- **Context Keeper**: Maintains understanding of cross-cutting concerns
- **Quality Gate**: Reviews agent outputs for consistency and integration
- **Decision Maker**: Resolves conflicts between agents, decides architectural approaches

### Responsibilities
1. Parse feature requests into atomic tasks
2. Identify which agents are needed for each task
3. Determine task dependencies and parallelization opportunities
4. Monitor agent progress and handle blockers
5. Integrate outputs from multiple agents
6. Ensure documentation is updated
7. Run final validation before completion

### Knowledge Requirements
- Full understanding of README.md and SKILLS.md
- Familiarity with all documentation in docs/
- Understanding of project structure and conventions
- Knowledge of database schema and API contracts

---

## Backend Agents

### 1. API Routes Agent

**Scope**: `server/routes/`, `server/auth.js`

**Expertise**:
- Express.js routing patterns
- Request/response handling
- Middleware chain (auth, rate limiting, roles)
- Input validation with Zod
- Error handling

**Files Owned**:
```
server/routes/hub.js        # Main CRM endpoints
server/routes/tasks.js      # Task management
server/routes/reviews.js    # Review management
server/routes/onboarding.js # Client onboarding
server/routes/webhooks.js   # External webhooks
server/auth.js              # Authentication endpoints
```

**When to Invoke**:
- Adding new API endpoints
- Modifying request/response schemas
- Adding route middleware
- Fixing API bugs

**Update Triggers**: Must update `docs/API_REFERENCE.md`

---

### 2. Services Agent

**Scope**: `server/services/`

**Expertise**:
- Business logic implementation
- External API integrations
- Data transformation
- Async job processing
- Email handling

**Files Owned**:
```
server/services/ai.js              # Vertex AI
server/services/ctm.js             # CallTrackingMetrics
server/services/mailgun.js         # Email sending
server/services/reviews.js         # GBP reviews
server/services/oauthIntegration.js# OAuth flows
server/services/formAI.js          # Form AI generation
server/services/formSubmissionJobs.js # Async processing
server/services/notifications.js   # In-app notifications
server/services/taskAutomations.js # Task automation engine
```

**When to Invoke**:
- Adding/modifying business logic
- Integrating new external services
- Modifying AI prompts or classification
- Updating email templates

**Update Triggers**: Must update `docs/INTEGRATIONS.md` for external services

---

### 3. Security Agent

**Scope**: `server/services/security/`, `server/middleware/`

**Expertise**:
- JWT token management
- Session handling
- MFA implementation
- Password policies
- Rate limiting
- Audit logging
- RBAC implementation

**Files Owned**:
```
server/services/security/tokens.js
server/services/security/sessions.js
server/services/security/mfa.js
server/services/security/passwordPolicy.js
server/services/security/rateLimit.js
server/services/security/audit.js
server/services/security/deviceFingerprint.js
server/middleware/auth.js
server/middleware/roles.js
server/middleware/rateLimit.js
```

**When to Invoke**:
- Modifying authentication flows
- Adding new roles/permissions
- Updating security policies
- Implementing audit features

**Update Triggers**: Must update `docs/SECURITY.md`

---

## Frontend Agents

### 4. Views Agent

**Scope**: `src/views/`, `src/layout/`

**Expertise**:
- React component patterns
- Material-UI (MUI) components
- Page layouts and navigation
- Form handling
- State management within views

**Files Owned**:
```
src/views/admin/           # Admin hub views
src/views/client/          # Client portal views
src/views/tasks/           # Task manager views
src/views/pages/           # Auth & onboarding pages
src/layout/MainLayout/     # Main app layout
src/layout/MinimalLayout/  # Auth layout
```

**When to Invoke**:
- Creating new pages/views
- Modifying UI components
- Updating layouts
- Adding new user-facing features

**Update Triggers**: Must update `docs/ARCHITECTURE.md` for structural changes

---

### 5. API Client Agent

**Scope**: `src/api/`

**Expertise**:
- Axios client patterns
- API request/response handling
- Token management
- Error handling
- Request interceptors

**Files Owned**:
```
src/api/client.js          # Base axios client
src/api/tokenStore.js      # JWT storage
src/api/auth.js            # Auth endpoints
src/api/tasks.js           # Task API
src/api/reviews.js         # Reviews API
src/api/clients.js         # Client management
src/api/onboarding.js      # Onboarding API
src/api/[all other API modules]
```

**When to Invoke**:
- Backend API endpoints change
- Adding new API calls
- Modifying request/response handling

**Coordination**: Works closely with API Routes Agent

---

### 6. Contexts Agent

**Scope**: `src/contexts/`, `src/hooks/`, `src/routes/`

**Expertise**:
- React Context API
- Custom hooks
- Global state management
- Routing configuration
- Authentication state

**Files Owned**:
```
src/contexts/AuthContext.jsx
src/contexts/ToastContext.jsx
src/contexts/ConfigContext.jsx
src/hooks/
src/routes/index.jsx
src/routes/MainRoutes.jsx
src/routes/AuthenticationRoutes.jsx
```

**When to Invoke**:
- Adding new global state
- Modifying auth flows on frontend
- Adding new routes
- Creating custom hooks

---

## Infrastructure Agents

### 7. Database Agent

**Scope**: `server/sql/`, `server/db.js`

**Expertise**:
- PostgreSQL schema design
- Migrations
- Indexes and constraints
- Query optimization
- Data relationships

**Files Owned**:
```
server/sql/init.sql
server/sql/migrate_*.sql
server/db.js
```

**When to Invoke**:
- Adding new tables/columns
- Creating migrations
- Optimizing queries
- Schema changes

**Update Triggers**: MUST update `SKILLS.md` Database Schema Map section

---

### 8. Documentation Agent

**Scope**: `docs/`, `README.md`, `SKILLS.md`

**Expertise**:
- Technical writing
- Mermaid diagrams
- API documentation
- Architecture documentation

**Files Owned**:
```
README.md
SKILLS.md
docs/ARCHITECTURE.md
docs/API_REFERENCE.md
docs/DATA_FLOWS.md
docs/INTEGRATIONS.md
docs/SECURITY.md
docs/SETUP.md
```

**When to Invoke**:
- After any significant code changes
- When adding new features
- When workflows change
- Periodically for review

---

## Task Assignment Matrix

| Feature Type | Primary Agent | Secondary Agents |
|--------------|---------------|------------------|
| New API endpoint | API Routes | Services, API Client, Docs |
| New page/view | Views | API Client, Contexts |
| Database change | Database | API Routes, Services, Docs |
| Auth/security | Security | API Routes, Contexts |
| External integration | Services | API Routes, API Client, Docs |
| Task automation | Services | API Routes, Database |
| Form builder feature | Views | API Routes, Services |
| Client onboarding | Views | API Routes, Services |
| Review management | Services | Views, API Routes |

---

## Parallel Execution Patterns

### Pattern 1: Full Feature Development

For a new feature touching all layers:

```
Master Agent receives: "Add SMS notification feature"

Phase 1 (Parallel):
  - Database Agent: Add tables for SMS config, logs
  - Documentation Agent: Draft feature spec

Phase 2 (Parallel, after Phase 1):
  - Services Agent: Implement SMS service (Twilio)
  - API Client Agent: Add SMS API module (can start with contract)

Phase 3 (Parallel, after Services complete):
  - API Routes Agent: Add SMS endpoints
  - Views Agent: Add SMS config UI

Phase 4:
  - Documentation Agent: Update all affected docs
  - Master Agent: Integration testing, final review
```

### Pattern 2: Bug Fix

For a targeted bug fix:

```
Master Agent receives: "Fix MFA not triggering for new devices"

Phase 1:
  - Security Agent: Investigate and fix issue

Phase 2 (if needed):
  - Contexts Agent: Update frontend auth flow

Phase 3:
  - Documentation Agent: Update if behavior changed
```

### Pattern 3: UI Enhancement

For frontend-only changes:

```
Master Agent receives: "Improve task board performance"

Phase 1 (Parallel):
  - Views Agent: Optimize TaskManager component
  - API Client Agent: Add pagination/caching

Phase 2:
  - Documentation Agent: Update if API patterns changed
```

---

## Agent Communication Protocol

### Task Handoff Format

```markdown
## Task: [Short description]

**From**: [Source Agent]
**To**: [Target Agent]
**Priority**: [High/Medium/Low]

### Context
[What the source agent did and why this task is needed]

### Requirements
- [Specific requirement 1]
- [Specific requirement 2]

### Dependencies
- [Files/features this depends on]

### Acceptance Criteria
- [ ] [Criterion 1]
- [ ] [Criterion 2]
```

### Completion Report Format

```markdown
## Completed: [Task description]

**Agent**: [Agent name]
**Files Modified**:
- path/to/file1.js (added/modified/deleted)
- path/to/file2.js

### Changes Summary
[Brief description of changes]

### Documentation Updates Needed
- [ ] Update docs/X.md section Y
- [ ] Update SKILLS.md schema section

### Integration Notes
[Any notes for other agents]
```

---

## Invocation Commands

When working with the Master Agent, use these commands:

```
/backend-api [task]    - Invoke API Routes Agent
/backend-svc [task]    - Invoke Services Agent
/backend-sec [task]    - Invoke Security Agent
/frontend-views [task] - Invoke Views Agent
/frontend-api [task]   - Invoke API Client Agent
/frontend-ctx [task]   - Invoke Contexts Agent
/database [task]       - Invoke Database Agent
/docs [task]           - Invoke Documentation Agent
/parallel [tasks...]   - Run multiple agents in parallel
```

---

## Quality Gates

Before marking any feature complete:

1. **Code Review**: Master Agent reviews all changes
2. **Documentation Check**: All maintenance directives satisfied
3. **Integration Test**: Cross-agent work integrates correctly
4. **Schema Sync**: SKILLS.md matches init.sql
5. **API Sync**: API_REFERENCE.md matches routes

---

## Getting Started

To begin a development session:

1. **Initialize Master Agent** with project context:
   - Read README.md and SKILLS.md
   - Read relevant docs/ files for the feature area

2. **Define the task** clearly with acceptance criteria

3. **Let Master Agent** break down into sub-tasks and assign agents

4. **Run agents** in parallel where possible

5. **Integrate** outputs and verify quality gates

---

*Last updated: January 2026*
