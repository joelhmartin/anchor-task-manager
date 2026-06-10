# Business Workflows & Data Flows

> **MAINTENANCE DIRECTIVE**: Update this file when:
> - Business workflow logic changes (onboarding, leads, journeys, tasks)
> - State machines or status transitions are modified
> - New integration data flows are added
> - Email notification triggers change
> - Lead classification categories change
> - Journey or task lifecycle stages change

This document describes the key business processes and data flows in the Anchor Client Dashboard.

---

## Table of Contents

1. [Client Onboarding Flow](#1-client-onboarding-flow)
2. [Authentication Flow](#2-authentication-flow)
3. [Lead Management Flow](#3-lead-management-flow)
4. [Client Journey Flow](#4-client-journey-flow)
5. [Task Management Flow](#5-task-management-flow)
6. [Form Submission Flow](#6-form-submission-flow)
7. [Review Management Flow](#7-review-management-flow)
8. [Email Notification Flow](#8-email-notification-flow)

---

## 1. Client Onboarding Flow

### Overview

New clients are onboarded through a multi-step wizard that collects profile information, credentials, and brand assets. The flow supports "Save and Continue Later" functionality.

### Sequence Diagram

```mermaid
sequenceDiagram
    participant Admin
    participant Dashboard as Admin Hub
    participant Email as Mailgun
    participant Client
    participant Wizard as Onboarding Wizard
    participant API
    participant DB as PostgreSQL

    Admin->>Dashboard: Create new client
    Dashboard->>API: POST /api/hub/clients
    API->>DB: INSERT users (role=client)
    API->>DB: INSERT client_profiles
    API->>Email: Send onboarding invitation
    Email->>Client: Invitation email with token link

    Client->>Wizard: Click onboarding link
    Wizard->>API: GET /api/onboarding/:token
    API->>DB: Validate token
    DB->>API: Token valid, user data
    API->>Wizard: Onboarding state

    loop Each Step
        Client->>Wizard: Fill step data
        Wizard->>API: POST /api/onboarding/:token/step
        API->>DB: Update client_profiles
    end

    Client->>Wizard: Complete Step 1 (Profile)
    Wizard->>API: POST /api/onboarding/:token/activate
    API->>DB: Set password, email_verified_at
    API->>DB: Revoke all onboarding tokens
    API->>Wizard: JWT tokens returned
    Wizard->>Wizard: Login user automatically

    Client->>Wizard: Complete all steps
    Wizard->>API: POST /api/onboarding/me/complete
    API->>DB: Set onboarding_completed_at
    API->>Email: Send completion confirmation
    Wizard->>Client: Fireworks + thank you message
```

### Onboarding Steps

| Step | Fields Collected | Required |
|------|------------------|----------|
| 1. Profile | Name, email, password, phone, communication prefs | Yes |
| 2. Services | Service selection based on client type | Configurable |
| 3. Brand | Logo, style guides, colors | Configurable |
| 4. Website | Admin credentials, CMS type | Configurable |
| 5. GA4 | Google Analytics 4 access | Configurable |
| 6. Google Ads | Google Ads account access | Configurable |
| 7. Meta | Facebook/Instagram access | Configurable |
| 8. Forms | Form integration details | Configurable |

### Key Database Tables

- `users` - Client user account
- `client_profiles` - Extended profile and step status
- `brand_assets` - Logo, style guides
- `client_onboarding_tokens` - Secure invitation tokens

### Token Lifecycle

1. **Created**: When admin sends invitation
2. **Validated**: On each wizard load
3. **Consumed**: After Step 1 completion (password set)
4. **Revoked**: When new token generated or onboarding complete

---

## 2. Authentication Flow

### Login with MFA

```mermaid
sequenceDiagram
    participant User
    participant LoginForm
    participant API as /api/auth
    participant Security as Security Service
    participant DB as PostgreSQL
    participant Email as Mailgun

    User->>LoginForm: Enter credentials
    LoginForm->>API: POST /api/auth/login
    API->>Security: Validate password
    Security->>DB: Check user, password_hash
    DB->>Security: User found

    alt New device or suspicious activity
        Security->>DB: Create MFA challenge
        Security->>Email: Send OTP code
        API->>LoginForm: { requiresMfa: true, challengeId }
        User->>LoginForm: Enter OTP
        LoginForm->>API: POST /api/auth/verify-mfa
        API->>Security: Verify OTP
        Security->>DB: Mark challenge verified
    end

    Security->>DB: Create user_session
    Security->>API: Generate tokens
    API->>LoginForm: { accessToken, user }
    LoginForm->>User: Redirect to dashboard
```

### Token Refresh Flow

```mermaid
sequenceDiagram
    participant App
    participant ApiClient
    participant API
    participant DB

    App->>ApiClient: API request
    ApiClient->>ApiClient: Check access token expiry

    alt Token expired
        ApiClient->>API: POST /api/auth/refresh
        API->>DB: Validate refresh token
        DB->>API: Session valid
        API->>DB: Rotate refresh token
        API->>ApiClient: New access + refresh tokens
        ApiClient->>ApiClient: Update stored token
    end

    ApiClient->>API: Original request with new token
    API->>App: Response
```

### Session Management

| Event | Action |
|-------|--------|
| Login | Create session, issue tokens |
| Token refresh | Rotate refresh token, extend session |
| Logout | Revoke session |
| Password change | Revoke all sessions |
| MFA change | Revoke all sessions |
| 90 days | Absolute session expiry |

---

## 3. Lead Management Flow

### CTM Sync and Classification

```mermaid
sequenceDiagram
    participant Portal as Client Portal
    participant API as /api/hub
    participant CTM as CTM Service
    participant CTMApi as CallTrackingMetrics API
    participant AI as Vertex AI
    participant DB as PostgreSQL

    Portal->>API: GET /api/hub/calls
    API->>DB: Load cached calls
    DB->>API: Cached call_logs
    API->>Portal: Immediate response (cached)

    Portal->>API: POST /api/hub/calls/sync
    API->>CTM: pullCallsFromCtm()
    CTM->>DB: Get sync cursor
    CTM->>CTMApi: Fetch calls since cursor
    CTMApi->>CTM: New/updated calls

    loop Each new call
        CTM->>AI: classifyContent(transcript)
        AI->>CTM: { category, summary }
        CTM->>CTM: Determine star rating
        CTM->>CTM: Enrich caller type
    end

    CTM->>DB: Upsert call_logs
    CTM->>DB: Update sync cursor
    CTM->>API: Sync results
    API->>Portal: Updated calls
```

### Lead Categories

| Category | Description | Auto-Star Rating |
|----------|-------------|------------------|
| `very_good` | Ready to book/buy | ⭐⭐⭐ |
| `warm` | Interested, needs follow-up | ⭐⭐⭐ |
| `needs_attention` | Callback requested / urgent | ⭐⭐⭐ |
| `not_a_fit` | Not qualified | ⭐⭐ |
| `applicant` | Job inquiry | ⭐⭐ |
| `spam` | Junk call | ⭐ |
| `voicemail` | Left voicemail | — (not scored) |
| `unanswered` | No conversation | — (not scored) |
| `neutral` | General inquiry | — (not scored) |
| `unreviewed` | Not yet classified | — (not scored) |
| `converted` | Agreed to service | — (manual 5⭐ only) |
| `active_client` | Existing customer | — (not scored) |
| `returning_customer` | Past client calling back | — (not scored) |

> **Auto-star caps at 3.** Ratings 4 and 5 are never auto-assigned. See `getAutoStarRating()` in `server/services/ctm.js`.

### Rating Sync (Two-Way)

```mermaid
flowchart LR
    subgraph app [Dashboard]
        AppRating[User changes stars]
    end

    subgraph ctm [CTM]
        CTMRating[Rating in CTM]
    end

    subgraph sync [Sync Logic]
        ToApp[CTM → App]
        ToCTM[App → CTM]
    end

    CTMRating --> ToApp
    ToApp --> DB[(call_logs.score)]
    ToApp --> Cat[Recalculate category]

    AppRating --> ToCTM
    ToCTM --> CTMApi[CTM API]
    AppRating --> DB
```

---

## 4. Client Journey Flow

### Journey Lifecycle

```mermaid
stateDiagram-v2
    [*] --> pending: Start Journey
    pending --> in_progress: Begin work
    in_progress --> active_client: Agreed to Service
    in_progress --> won: Mark as Won
    in_progress --> lost: Mark as Lost
    in_progress --> archived: Archive
    active_client --> [*]: Converted
    won --> [*]: Completed
    lost --> [*]: Closed
    archived --> in_progress: Restore
```

### Creating a Journey

```mermaid
sequenceDiagram
    participant User
    participant Portal as Client Portal
    participant API
    participant DB

    User->>Portal: Click "Start Journey" on lead
    Portal->>Portal: Open journey dialog
    User->>Portal: Select services/concerns
    Portal->>API: POST /api/hub/journeys
    API->>DB: INSERT client_journeys
    API->>DB: INSERT client_journey_steps (from template)
    API->>DB: Link to call_logs
    API->>Portal: Journey created
    Portal->>User: Journey drawer opens
```

### Journey to Active Client Conversion

```mermaid
sequenceDiagram
    participant User
    participant Portal
    participant API
    participant DB

    User->>Portal: Mark "Agreed to Service"
    Portal->>Portal: Open service selection dialog
    User->>Portal: Select services, prices
    Portal->>API: POST /api/hub/active-clients
    API->>DB: INSERT active_clients
    API->>DB: INSERT client_services (for each service)
    API->>DB: UPDATE client_journeys (status=active_client)
    API->>DB: UPDATE call_logs (link to active_client)
    API->>Portal: Active client created
```

### Multi-Journey Support

A single active client can have multiple journeys for different services:

```mermaid
flowchart TD
    Lead[Lead Call] --> J1[Journey 1: Dental Cleaning]
    J1 --> AC[Active Client]
    AC --> J2[Journey 2: Teeth Whitening]
    AC --> J3[Journey 3: Invisalign Consultation]
```

---

## 5. Task Management Flow

### Task Hierarchy

```mermaid
graph TD
    Workspace[Workspace] --> Board1[Board A]
    Workspace --> Board2[Board B]
    Board1 --> Group1[Backlog]
    Board1 --> Group2[In Progress]
    Board1 --> Group3[Done]
    Group2 --> Item1[Task Item 1]
    Group2 --> Item2[Task Item 2]
    Item1 --> Subitem1[Subtask 1.1]
    Item1 --> Subitem2[Subtask 1.2]
```

### Task Status Flow

```mermaid
stateDiagram-v2
    [*] --> Backlog: Create task
    Backlog --> InProgress: Start work
    InProgress --> Review: Ready for review
    Review --> Done: Approved
    Review --> InProgress: Needs changes
    Done --> Archived: 30 days
    Archived --> [*]: Purged
```

---

## 6. Form Submission Flow

### Form Embed Lifecycle

```mermaid
sequenceDiagram
    participant Visitor
    participant Website
    participant Embed as /embed/:formId
    participant API
    participant Queue as Submission Queue
    participant AI as Vertex AI
    participant CTM
    participant Email as Mailgun

    Visitor->>Website: Load page
    Website->>Embed: Load form script
    Embed->>Website: Render form

    Visitor->>Embed: Submit form
    Embed->>API: POST /embed/:formId/submit
    API->>Queue: Queue submission job
    API->>Embed: { success: true }

    loop Every 30 seconds
        Queue->>Queue: Process pending jobs
        Queue->>AI: Classify submission
        AI->>Queue: Classification result
        Queue->>CTM: Create call record (optional)
        Queue->>Email: Send notification
        Queue->>Queue: Mark job complete
    end
```

### Form Builder Features

| Feature | Description |
|---------|-------------|
| Visual Editor | Monaco-based JSON editor |
| Field Types | Text, email, phone, select, textarea, checkbox, file |
| Conditional Logic | Show/hide fields based on other values |
| Multi-Step | Split form into multiple pages |
| Theming | Custom colors, fonts per embed |
| AI Processing | Classify submissions, extract data |

---

## 7. Review Management Flow

### Review Response Workflow

```mermaid
sequenceDiagram
    participant GBP as Google Business Profile
    participant API
    participant DB
    participant AI as Vertex AI
    participant User

    API->>GBP: Fetch reviews (OAuth)
    GBP->>API: Review list
    API->>DB: Upsert reviews

    User->>API: Request AI draft
    API->>DB: Get review details
    API->>AI: Generate response draft
    AI->>API: Draft text
    API->>User: Draft for review

    User->>API: Edit and approve
    API->>GBP: Post response
    GBP->>API: Success
    API->>DB: Mark responded
    API->>User: Confirmation
```

### Review States

| State | Description |
|-------|-------------|
| `pending` | New review, needs attention |
| `draft` | AI draft generated |
| `approved` | Response ready to send |
| `responded` | Response posted to GBP |
| `flagged` | Needs manual review |

---

## 8. Email Notification Flow

### Email Types

| Type | Trigger | Template |
|------|---------|----------|
| `onboarding_invite` | Admin creates client | Invitation link |
| `onboarding_complete` | Client finishes onboarding | Welcome message |
| `onboarding_reminder` | Token expires soon | Reminder to complete |
| `password_reset` | User requests reset | Reset link |
| `form_submission` | Form submitted | Submission details |
| `rush_job_notification` | Task marked rush | Rush job alert |
| `blog_notification` | Blog published | Blog post link |
| `document_review` | Document uploaded | Review request |

### Email Logging Flow

```mermaid
sequenceDiagram
    participant Service
    participant Mailgun as mailgun.js
    participant MailgunAPI as Mailgun API
    participant DB
    participant Webhook as /api/webhooks/mailgun

    Service->>Mailgun: sendMailgunMessageWithLogging()
    Mailgun->>DB: INSERT email_logs (status=pending)
    Mailgun->>MailgunAPI: Send email
    MailgunAPI->>Mailgun: Message ID
    Mailgun->>DB: UPDATE email_logs (status=sent, mailgun_id)
    Mailgun->>Service: Success

    Note over MailgunAPI,Webhook: Async webhook events

    MailgunAPI->>Webhook: delivered event
    Webhook->>DB: UPDATE email_logs (delivered_at)

    MailgunAPI->>Webhook: opened event
    Webhook->>DB: UPDATE email_logs (opened_at, open_count++)

    MailgunAPI->>Webhook: clicked event
    Webhook->>DB: UPDATE email_logs (clicked_at, click_count++)
```

---

## Data Lifecycle Summary

### Lead → Active Client

```mermaid
flowchart LR
    Call[Inbound Call] --> CTM[CTM Logs]
    CTM --> Sync[Sync to Dashboard]
    Sync --> Classify[AI Classification]
    Classify --> Lead[Lead Card]
    Lead --> Journey[Client Journey]
    Journey --> ActiveClient[Active Client]
    ActiveClient --> Services[Client Services]
```

### Client Onboarding → Portal Access

```mermaid
flowchart LR
    Create[Admin Creates Client] --> Email[Invitation Email]
    Email --> Wizard[Onboarding Wizard]
    Wizard --> Step1[Set Password]
    Step1 --> Steps[Complete Steps]
    Steps --> Complete[Onboarding Complete]
    Complete --> Portal[Client Portal Access]
```

---

## Related Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture
- [API_REFERENCE.md](API_REFERENCE.md) - API endpoints
- [SECURITY.md](SECURITY.md) - Authentication details
- [INTEGRATIONS.md](INTEGRATIONS.md) - Third-party services
- [SKILLS.md](../SKILLS.md) - Database schema

---

*Last updated: January 2026*

