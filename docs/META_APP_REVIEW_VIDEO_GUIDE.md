# Meta App Review — Video Recording Guide

> **Purpose:** Step-by-step guide for recording a screencast that demonstrates the end-to-end experience for each Meta permission requested in the Anchor Client Dashboard app review submission.

---

## Overview

Meta rejected our previous submission because the screencast didn't show the **complete end-to-end flow** of how our app uses each permission. This guide walks through exactly what to record, what to say, and what to set up beforehand.

### Permissions We're Requesting

| Permission | Purpose in Our App |
|---|---|
| `pages_show_list` | List which Facebook Pages a client manages so we can save them as CRM resources |
| `pages_read_engagement` | Read page ratings/reviews and feed posts to monitor client page health in our CRM dashboard |
| `leads_retrieval` | Pull leads from Facebook Lead Ad forms into our CRM lead pipeline, so all leads (calls, forms, Facebook) are in one place |
| `instagram_basic` | Read the linked Instagram business account info to display in the CRM integrations panel |
| `ads_read` | Read ad account data to attribute leads to ad campaigns |

---

## Pre-Recording Setup Checklist

Do these things **before** you hit record. Each step is essential.

### 1. Meta App Developer Setup

- [ ] Go to [developers.facebook.com](https://developers.facebook.com)
- [ ] Open your app → **Roles** → **People** (or App Roles)
- [ ] Make sure your personal Facebook account is listed as **Administrator** or **Developer**
- [ ] Note: In **Development Mode**, you (and all listed developers/testers) have full API access to your own data — no approval needed

### 2. Facebook Page

- [ ] You need a Facebook Page you manage (any page works — even a test one)
- [ ] If you don't have one: **Facebook → Menu → Pages → Create New Page**
  - Name it something like "Anchor Test Business" or use a real client page you manage
  - Add a category (e.g., "Marketing Agency")
  - Publish at least 1-2 posts so the engagement section has data to show

### 3. Lead Ad Form (CRITICAL for `leads_retrieval`)

This is what the reviewer specifically called out as unclear. You need a lead form on the page.

**Option A — Create via Facebook Page (no ad spend required):**
1. Go to your Facebook Page
2. Click **"Create Ad"** or go to [Meta Ads Manager](https://www.facebook.com/adsmanager)
3. Choose objective: **Leads**
4. In the ad creation flow, you'll be prompted to create an **Instant Form**
5. Create the form with a few fields (Name, Email, Phone)
6. You can **save as draft** — you don't need to publish or spend money
7. The form will appear in the API under `/{page-id}/leadgen_forms`

**Option B — Create via Publishing Tools:**
1. Go to your Facebook Page → **Professional Dashboard** → **All Tools**
2. Look for **"Instant Forms"** or **"Lead Ads Forms"**
3. Create a new form with basic fields
4. Save as draft

**Option C — Submit a test lead (if the form is active):**
1. If you have an active lead form, click the preview link
2. Submit it yourself with test data
3. This creates a real lead that will show up when we fetch leads

### 4. Instagram Business Account (for `instagram_basic`)

- [ ] If you have an Instagram Business or Creator account, link it to your Facebook Page:
  - **Instagram → Settings → Account → Linked Accounts → Facebook → Choose your page**
  - OR **Facebook Page → Settings → Instagram → Connect Account**
- [ ] If you don't have one, you can skip `instagram_basic` for now and note in the submission that you'll demonstrate it separately, OR create a test IG account

### 5. Anchor Dashboard Setup

- [ ] Make sure the app is running (local dev or deployed)
- [ ] Log in as a **superadmin** or **admin** account
- [ ] Have at least one client in the CRM (the one you'll connect Facebook to)
- [ ] Navigate to the client drawer → **Integrations** tab to verify it loads

### 6. Screen Recording Tool

- [ ] Use a tool that can record your screen with a microphone: QuickTime (Mac), OBS, Loom, or any screen recorder
- [ ] Set resolution to at least 1280x720
- [ ] Use English for all UI — Meta requires this
- [ ] Have a quiet environment for narration

---

## Recording Script — Scene by Scene

### Intro (15 seconds)

**Show:** The Anchor Client Dashboard login screen or home page.

**Say:**
> "This is the Anchor Client Dashboard — a CRM and client management platform for marketing agencies. I'm going to demonstrate how our app uses Facebook and Instagram integrations to manage client pages, monitor engagement, and retrieve leads from Facebook Lead Ad forms."

---

### Scene 1: Navigate to Client (15 seconds)

**Actions:**
1. Click on **Client Hub** in the sidebar
2. Click on a client name to open the client drawer

**Say:**
> "Here I'm opening a client profile in our CRM. Each client can have connected integrations for various platforms."

---

### Scene 2: Open Integrations Tab (10 seconds)

**Actions:**
1. Click the **Integrations** tab in the client drawer

**Say:**
> "The Integrations tab is where we manage OAuth connections for each client. Let me connect this client's Facebook account."

---

### Scene 3: Initiate Facebook OAuth — The Login Flow (30 seconds)

**Actions:**
1. Click **"Add Connection"**
2. Select **"Facebook"** as the provider and save (or if there's a direct connect button, click that)
3. You'll be redirected to Facebook's login/authorization page

**Say:**
> "I'm initiating the Facebook OAuth connection. This redirects to Facebook's login page where the user grants our app access to their pages and data."

**IMPORTANT — Show these things clearly:**
- The Facebook login screen (if not already logged in, log in)
- The **permission consent screen** — this is CRITICAL. The reviewer needs to see the user granting access to: pages_show_list, pages_read_engagement, leads_retrieval, instagram_basic
- Click **"Continue"** to grant all permissions
- Wait for the redirect back to your app

**Say (while on Facebook consent screen):**
> "The user is presented with a clear consent screen showing exactly which permissions our app is requesting — access to pages, page engagement data, lead form data, and basic Instagram account information. The user clicks Continue to grant these permissions."

---

### Scene 4: Successful Connection (15 seconds)

**Actions:**
1. After redirect, you should be back on the Integrations tab
2. The new Facebook connection should appear with a **"Connected"** status chip

**Say:**
> "The connection was successful. The OAuth tokens are securely stored with AES-256 encryption, and we can see the connection is active."

---

### Scene 5: Fetch Pages (15 seconds)

**Actions:**
1. Expand the Facebook connection accordion
2. Click **"Fetch Pages"**
3. A dialog should appear showing the available Facebook Pages
4. Select/save the pages you want

**Say:**
> "Now I'll fetch the Facebook Pages this account manages. This uses the pages_show_list permission to retrieve all managed pages."

---

### Scene 6: Load Meta Insights — The End-to-End Data (60 seconds)

**THIS IS THE MOST IMPORTANT PART.** This is where you show the actual data consumption.

**Actions:**
1. Still in the expanded Facebook connection accordion
2. Scroll down to the **"Meta Insights"** section
3. Click **"Load Insights"**
4. Wait for the data to load

**Say:**
> "Now I'm loading the Meta Insights for this connection. This demonstrates how our app actually uses each permission to display real data in our CRM."

**Once data loads, narrate each section:**

#### 6a. Facebook Pages card

**Say:**
> "First, we see the connected Facebook Pages with their profile pictures and categories. This data comes from the pages_show_list permission."

#### 6b. Page Engagement card

**Say:**
> "Next, the Page Engagement section shows recent page posts and ratings. We use the pages_read_engagement permission to monitor page health — this helps our agency track how a client's Facebook page is performing alongside other marketing channels. We display the post type, date, and a preview. This is read-only monitoring — we don't post or modify anything."

**Pause on this section so the reviewer can see the data.**

#### 6c. Lead Ad Forms card

**Say:**
> "The Lead Ad Forms section is powered by the leads_retrieval permission. We retrieve all lead forms associated with the client's Facebook Page and show each form's name, status, and lead count. When a potential customer fills out a Facebook Lead Ad form, that lead appears here in our CRM alongside leads from phone calls, website forms, and other channels. This gives our agency clients a single view of all their leads so they can respond quickly. We only retrieve lead metadata — we do not store or display personally identifiable information from the lead form fields."

**Pause on this section. If there are leads showing with timestamps, point to them.**

#### 6d. Instagram Accounts card

**Say:**
> "Finally, the Instagram Accounts section shows the Instagram Business Account linked to each Facebook Page. We use the instagram_basic permission to display the account username, follower count, and post count. This gives our agency clients a quick overview of their Instagram presence right within our CRM dashboard — no need to switch between apps."

---

### Scene 7: Wrap-Up (15 seconds)

**Say:**
> "That covers the complete end-to-end flow: the user connects their Facebook account through our OAuth flow, grants the required permissions, and our CRM immediately displays their page data, engagement metrics, lead forms with leads, and Instagram account information. All data access is read-only and follows least-privilege principles."

---

## Total Video Length Target: ~3 minutes

---

## Submission Notes — Copy-Paste for Each Permission

Use these in the **"Additional Information"** or **"Notes"** field when re-submitting each permission request.

### `pages_show_list`

> **Use case:** Anchor Client Dashboard is a CRM for marketing agencies. When a client connects their Facebook account, we use pages_show_list to retrieve the list of Facebook Pages they manage. These pages are saved as CRM resources, allowing agency staff to associate the correct Facebook Page with each client account. This is the foundation for all other Meta integrations — page engagement monitoring, lead retrieval, and Instagram account linking all depend on knowing which pages the client manages.

### `pages_read_engagement`

> **Use case:** We use pages_read_engagement to read page ratings/recommendations and feed activity for agency clients' Facebook Pages. This data is displayed in the CRM's Integrations tab as a "Page Engagement" panel, allowing agency staff to monitor a client's Facebook page health alongside other marketing channels (Google reviews, call tracking, etc.) without leaving our dashboard. We display: rating counts, recent post types, post dates, and brief post snippets. We do NOT write, post, or modify any page content — this is strictly read-only monitoring for reporting purposes. This permission enhances our platform by giving agencies a unified view of client engagement across all channels.

### `leads_retrieval`

> **Use case:** We use leads_retrieval to import leads from Facebook Lead Ad forms into our CRM lead pipeline. Marketing agencies run Lead Ad campaigns for their clients on Facebook. When a potential customer fills out a Lead Ad form, we retrieve that lead's metadata (form name, submission timestamp, lead count) and display it in our CRM alongside leads from other sources (phone calls via call tracking, website form submissions, etc.). This gives agencies a single, unified view of all leads for each client, enabling faster follow-up and better conversion tracking. Specifically: we fetch /page-id/leadgen_forms to list the client's lead forms and their status, then fetch /form-id/leads to get the individual lead submissions. We only display metadata (ID, created timestamp, form name) in the UI — we do not store or display the lead's personal contact details (field_data) in our dashboard, in compliance with our HIPAA data handling policies.

### `instagram_basic`

> **Use case:** We use instagram_basic to retrieve basic Instagram Business Account information for each client's linked Instagram account. Our CRM displays the Instagram username, profile picture, follower count, and media count in the Integrations tab alongside Facebook Page data. This allows marketing agencies to see a snapshot of their client's Instagram presence directly within our dashboard — no need to switch between apps. Many of our agency clients manage both Facebook and Instagram for their customers, and having this data in one place improves workflow efficiency. We only read basic public account data — we do not publish, modify, or interact with Instagram content.

### `ads_read`

> **Use case:** We use ads_read to attribute leads and calls to specific ad campaigns. When a lead comes in through a Facebook Lead Ad form, knowing which ad campaign generated it helps our agency clients optimize their ad spend. The ads_read permission is used in conjunction with leads_retrieval to provide campaign-level attribution data in our CRM reporting. This is read-only — we do not create, modify, or manage ads.

---

## Common Rejection Reasons & How to Avoid Them

| Rejection Reason | How We Address It |
|---|---|
| "Screencast doesn't show end-to-end flow" | Our video starts with login, shows OAuth consent, and ends with data displayed in the app |
| "Use case is unclear" | Each permission has detailed submission notes explaining exactly what we use it for and how |
| "Use case is not needed" | Each permission maps to a specific CRM feature visible in the UI |
| "Missing Meta login flow" | Scene 3 explicitly shows the Facebook login and permission consent screen |
| "UI not in English" | All our UI is in English by default |

---

## Quick Reference — What Each API Call Returns

| Permission | API Call | What We Show in UI |
|---|---|---|
| `pages_show_list` | `GET /me/accounts` | Page name, category, profile picture, link |
| `pages_read_engagement` | `GET /{page-id}/feed`, `GET /{page-id}/ratings` | Recent posts (type, date, snippet), rating count |
| `leads_retrieval` | `GET /{page-id}/leadgen_forms`, `GET /{form-id}/leads` | Form name, status, lead count, latest lead timestamp |
| `instagram_basic` | `GET /{page-id}?fields=instagram_business_account{...}` | IG username, profile pic, follower count, media count |

---

## After Recording

1. **Watch the video** — make sure every permission's data is visible on screen
2. **Trim** any dead time or mistakes
3. **Upload** to a hosting service (YouTube unlisted, Vimeo, Google Drive, etc.)
4. **Submit** at [developers.facebook.com](https://developers.facebook.com) → App Review
5. For each permission, paste the corresponding **submission notes** from above
6. In the general notes, mention: *"Our screencast demonstrates the complete Meta login flow, user granting permissions, and the end-to-end experience showing how each permission's data is displayed in our CRM dashboard."*
