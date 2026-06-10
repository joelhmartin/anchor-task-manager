# Anchor Client Dashboard - Video / Scribe Scripts

> Concise walkthrough scripts for every level of the platform.
> Each entry is one standalone video or Scribe interaction.

---

## 1. Logging In

**Duration:** ~30s

1. Navigate to the login page.
2. Enter your **email** and **password**.
3. Click **Sign In**.
4. If prompted, enter the **6-digit MFA code** sent to your email.
5. You land on either **Client Hub** (admin) or **Client Portal** (client).

> Forgot your password? Click **Forgot Password** on the login page and follow the email link.

---

## 2. Client Onboarding (New Clients)

**Duration:** ~2 min

1. After your first login, you're taken to the **Onboarding Wizard**.
2. Complete each step using the stepper at the top:
   - **Login Details** - Set your display name and password.
   - **Business & Brand** - Business name, description, logo uploads, style guide files.
   - **Services to Promote** - Select the services you offer (pre-populated by business type).
   - **Website Info & Access** - Provide website URL and admin access details.
   - **Google Analytics (GA4)** - Indicate GA4 access status.
   - **Google Ads** - Connect or skip if not applicable.
   - **Facebook & Instagram (Meta)** - Connect or skip.
   - **Contact & Lead Forms** - Describe how your website captures leads.
   - **Market Research & SEO** *(if applicable)* - Answer business-type-specific questions.
3. Click **Next** to advance, or **Back** to revisit a step. Progress auto-saves as a draft.
4. On the final step, click **Submit**. You'll see a confirmation with fireworks.
5. Your account enters **Pending Activation** until an admin activates you.

---

## 3. Client Portal Overview

**Duration:** ~1 min

1. From the **sidebar**, the Client Portal is organized into sections:
   - **Profile** | **Analytics** | **Brand Assets** | **Documents** | **Team**
   - **Leads** | **Client Journey** | **Archive** | **Active Clients**
   - **Blog Posts**
2. Click any sidebar item to navigate. The active section highlights automatically.
3. Use the **top-right avatar menu** to switch between portal areas (Task Manager, etc.) or log out.

---

## 4. Profile Tab

**Duration:** ~30s

1. Click **Profile** in the sidebar.
2. Upload or change your **avatar photo**.
3. Edit your **Display Name**, **Email**, or **Monthly Revenue Goal**.
4. To change your password: enter your **Current Password**, then your **New Password** twice.
5. Click **Save Profile**.

---

## 5. Analytics Tab

**Duration:** ~20s

1. Click **Analytics** in the sidebar.
2. Your embedded analytics dashboard loads automatically (Looker Studio or similar).
3. Interact with the charts and filters directly inside the iframe.

---

## 6. Brand Assets Tab

**Duration:** ~45s

1. Click **Brand Assets** in the sidebar.
2. Edit fields: **Business Name**, **Business Description**, **Brand Notes**, **Website URL**.
3. Upload **Logos** and **Style Guide** files using the upload buttons.
4. Delete existing assets by clicking the trash icon next to them.
5. Click **Save Brand** to save all changes at once.

---

## 7. Documents Tab

**Duration:** ~30s

1. Click **Documents** in the sidebar.
2. **Helpful Documents** (shared by your agency) appear at the top. Click to download or view.
3. **Your Documents** appear below. Upload new files by clicking **Upload Documents** and selecting files.
4. Delete a document by clicking its trash icon.

---

## 8. Team Management Tab

**Duration:** ~30s

1. Click **Team** in the sidebar.
2. View your current team members and their roles.
3. Invite new team members by entering their email and assigning a role.
4. Remove team members as needed.

---

## 9. Tasks / Requests Tab

**Duration:** ~45s

1. Click **Tasks** in the sidebar (inside the portal).
2. View your **active tasks** and **completed tasks** using the toggle.
3. Click **New Request** to submit a work request to your agency:
   - Enter a **title** and **description**.
   - Set a **desired due date**.
   - Optionally attach a file.
   - Toggle **"I need this done today"** for rush requests (note: rush fees may apply).
4. Click **Submit Request**. It appears in your active tasks immediately.

---

## 10. Leads Tab - Viewing & Filtering Leads

**Duration:** ~1.5 min

1. Click **Leads** in the sidebar.
2. The **search bar** at top lets you search by name, phone, or email.
3. Toggle between **Card View** and **Table View** using the icons.
4. **Filter leads** using the dropdowns:
   - **Activity Type**: All, Call, SMS, Form
   - **Caller Type**: All, New, Repeat, Returning
   - **Source**: All Sources, or specific tracking sources
   - **Category**: All, Warm, Very Good, Converted, Not a Fit, Spam, etc.
5. **Date range** filters let you narrow by time period.
6. Click **Refresh** to reload data, or **Sync CTM** to pull latest from CallTrackingMetrics.
7. Click **Export** (download icon) to download leads as CSV.

---

## 11. Leads Tab - Lead Detail Drawer

**Duration:** ~1 min

1. Click any **lead card** (or table row) to open the **Lead Detail Drawer**.
2. The drawer shows:
   - **Contact info**: Name, phone, email, region.
   - **Call details**: Direction (inbound/outbound), duration, source, tracking number.
   - **AI Classification**: The system auto-categorizes leads (warm, very good, not a fit, spam, etc.).
   - **Rating**: Rate the lead 1-5 stars manually.
   - **Tags**: Add or remove tags for custom organization.
   - **Notes**: Add timestamped notes about this lead.
3. **Actions** at the bottom:
   - **Start Journey** - Begin tracking this lead through your sales pipeline.
   - **Agreed to Service** - Convert this lead to an active client.
4. Click the **X** or press **Escape** to close the drawer.

---

## 12. Leads Tab - Categorizing & Scoring

**Duration:** ~45s

1. Each lead has a **color-coded category chip** (green = warm, red = not a fit, purple = spam, etc.).
2. Click the **category chip** on any lead to reclassify it manually.
3. Use the **star rating** to score leads 1-5:
   - 1 = Spam/Junk
   - 2 = Not a Fit
   - 3 = Solid Lead
   - 4 = Great Lead
   - 5 = Converted
4. Admins can click **Reclassify** to re-run AI classification on all leads in bulk.

---

## 13. Starting a Client Journey from a Lead

**Duration:** ~1 min

1. From the **Leads** tab, find the lead you want to track.
2. Click **Start Journey** on the lead card (or in the detail drawer).
3. A dialog opens - **select the services or concerns** this lead is interested in (e.g., "Root Canal", "Dental Implants").
4. Click **Save**. The journey is created and appears in the **Client Journey** tab.
5. The lead is now tracked through your follow-up pipeline.

---

## 14. Client Journey Tab - Overview

**Duration:** ~1 min

1. Click **Client Journey** in the sidebar.
2. Toggle between **List View** and **Kanban Board** using the view icons.
3. **Kanban Board** organizes journeys into columns:
   - **Pending** | **In Progress** | **Active Client** | **Won** | **Lost**
4. Each journey card shows: client name, phone, current step, and concern tags.
5. The count at top shows total active journeys.
6. Click **Refresh** to reload journey data.

---

## 15. Client Journey Tab - Managing a Journey

**Duration:** ~1.5 min

1. Click **View Journey** on any journey card to open the **Journey Drawer**.
2. Inside the drawer you can:
   - **Update status** (Pending, In Progress, Active Client, Won, Lost).
   - **Pause/Resume** the journey.
   - **View and manage follow-up steps**: Each step has a label, channel (call/email/SMS), message, and due date.
   - **Mark steps complete** by checking them off.
   - **Add new steps** manually.
   - **Add notes** to any step or to the journey overall.
3. **Concern tags** (symptoms) show what the lead is interested in.
4. Click **Archive** to move the journey to the Archive tab.

---

## 16. Client Journey Tab - Follow-Up Templates

**Duration:** ~45s

1. From the **Client Journey** tab, click **Edit Follow-Up Template**.
2. The template defines the default steps applied to every new journey:
   - Each step has a **label**, **channel** (call/email/SMS), **message**, and **offset in weeks**.
3. Add, edit, or remove steps in the template.
4. Click **Save Template**. New journeys will inherit these steps automatically.
5. Existing journeys are not affected - use **Apply Template** on individual journeys if needed.

---

## 17. Active Clients

**Duration:** ~30s

1. Click **Active Clients** in the sidebar.
2. View all clients who have agreed to a service.
3. Each row shows: client name, phone, service name, agreed date, and monthly revenue.
4. Track progress toward your **Monthly Revenue Goal** (set in Profile).
5. Archive clients who are no longer active.

---

## 18. Archive Tab

**Duration:** ~30s

1. Click **Archive** in the sidebar.
2. Two sections: **Archived Journeys** and **Archived Clients**.
3. Each archived item shows when it was archived and key details.
4. Click **Restore** to move an item back to active status.

---

## 19. Blog Posts

**Duration:** ~45s

1. Click **Blog Posts** in the sidebar under "My Content."
2. The left panel lists your existing posts; the right panel is the **rich text editor** (CKEditor).
3. Click **New Post** to start fresh.
4. Enter a **title** and write your content using the toolbar (bold, lists, links, images, etc.).
5. Click **AI Ideas** to generate blog topic suggestions based on your business.
6. Select an idea and click **Write Draft** - AI generates a full draft with a hero image.
7. Click **Save Draft** or **Publish** when ready.

---

## 20. Services Management (Admin)

**Duration:** ~30s

1. Navigate to **Services** from the sidebar.
2. View all configured services in a table: name, description, base price, active status.
3. Click **Add Service** to create a new one (name, description, price).
4. Click the **edit icon** to modify an existing service.
5. Click the **delete icon** to remove a service.

---

## 21. Admin: Client Hub Overview

**Duration:** ~1 min

1. Admins land on the **Client Hub** after login.
2. The hub shows all users in two tables: **Admins/Team** and **Clients**.
3. Use the **search bar** to find users by name, email, or role.
4. Click any row to open the **Client Drawer** with full details.
5. Use the **Invite New Client** or **Add Team Member** buttons to onboard new users.

---

## 22. Admin: Client Drawer Tabs

**Duration:** ~1.5 min

1. Click a client in the Client Hub to open their drawer.
2. Navigate using the **7 tabs** across the top:
   - **Client Details** - Edit name, email, role, client type, CTM source ID.
   - **Client Assets** - View/edit their brand info, logos, style guides.
   - **Client Documents** - Upload or manage documents for this client.
   - **Integrations** - View connected OAuth accounts (Google, Microsoft), manage connections.
   - **Call Tracking** - View this client's call tracking configuration and data.
   - **Forms** - View forms assigned to this client and their submissions.
   - **Activity Log** - Audit trail of all actions this client or admins have taken.
3. Click **Save** at the bottom to persist any changes.

---

## 23. Admin: Jump to Client View

**Duration:** ~20s

1. From the Client Hub, click **Jump to Client View** in the sidebar.
2. Select a client from the dropdown.
3. You now see the platform **as that client would see it** - their portal, leads, journeys, etc.
4. A banner at the top reminds you that you're viewing as a client.
5. Click **Exit Client View** to return to the admin hub.

---

## 24. Task Manager - Home

**Duration:** ~1 min

1. Navigate to **Task Manager** from the top-right dropdown menu.
2. The **Home** pane shows all task boards.
3. Each board displays tasks in a table with columns: name, status, assignee, due date, priority.
4. Click any task row to open the **Task Drawer** with full details, updates, files, time entries, and sub-items.
5. Use **Board Header** controls to filter, sort, or create new tasks and groups.

---

## 25. Task Manager - My Work

**Duration:** ~30s

1. Click **My Work** in the sidebar.
2. See all tasks assigned to you across all boards.
3. Tasks are grouped by board and sorted by due date.
4. Quick-update status or priority directly from this view.

---

## 26. Task Manager - Automations

**Duration:** ~30s

1. Click **Automations** in the sidebar.
2. View all configured task automations (e.g., "When status changes to Done, notify client").
3. Toggle automations **on/off** with the switch.
4. Click **Add Automation** to create a new trigger-action rule.
5. Edit or delete existing automations.

---

## 27. Task Manager - Billing

**Duration:** ~30s

1. Click **Billing** in the sidebar.
2. View billing-related task reports and summaries.
3. Use this pane to track billable hours and project costs.

---

## 28. Forms Manager - Forms List

**Duration:** ~30s

1. Navigate to **Forms Manager** from the top-right dropdown menu.
2. The **Forms** pane lists all forms with: name, client, status (draft/published), submission count.
3. Click **Create Form** to start a new form from scratch or from a preset template.
4. Click any form to edit it.

---

## 29. Forms Manager - Builder

**Duration:** ~1 min

1. Click **Builder** in the sidebar.
2. The visual editor has three panels:
   - **Left: Field Palette** - Drag field types (Text, Email, Phone, Textarea, Select, Checkbox, etc.)
   - **Center: Canvas** - Your form layout. Drag fields to reorder.
   - **Right: Properties** - Configure the selected field (label, placeholder, required, validation).
3. Add fields by clicking them in the palette.
4. Reorder fields using the drag handles.
5. Click **Save Draft** to save, or **Publish** to make the form live.

---

## 30. Forms Manager - Submissions

**Duration:** ~30s

1. Click **Submissions** in the sidebar.
2. View all form submissions across all forms.
3. Filter by form name or date range.
4. Click any submission row to open the **Submission Detail** dialog showing all field responses.

---

## 31. Forms Manager - Embed

**Duration:** ~20s

1. Click **Embed** in the sidebar.
2. Select a **published form** from the dropdown.
3. The system generates an **embed code** (HTML snippet).
4. Click **Copy** to copy the code to your clipboard.
5. Paste the embed code into your website to display the form.

---

## 32. Twilio Manager - Overview

**Duration:** ~30s

1. Navigate to **Twilio Manager** from the top-right dropdown menu.
2. The **Overview** pane shows:
   - Connection status (connected/disconnected).
   - Total tracking numbers across all clients.
   - Quick stats on active numbers and clients.

---

## 33. Twilio Manager - Numbers

**Duration:** ~45s

1. Click **Numbers** in the sidebar.
2. View all tracking numbers in a table: number, client, source type, label, status.
3. Click **Purchase Number** to buy a new tracking number:
   - Select an **area code**.
   - Choose the **client** to assign it to.
   - Set the **source type** (Google Ads, Facebook, Organic, etc.) and **forwarding number**.
4. Click the **edit icon** to update a number's label, source, or forwarding.
5. Click the **delete icon** to release a number back to Twilio.

---

## 34. Twilio Manager - Clients & Scripts

**Duration:** ~30s

1. Click **Clients** to see per-client call tracking configuration and number assignments.
2. Click **Scripts** to generate tracking/attribution scripts for client websites:
   - Select a client.
   - Copy the generated JavaScript snippet.
   - Install it on the client's website to enable dynamic number insertion and attribution tracking.

---

## 35. Shared Documents (Admin)

**Duration:** ~20s

1. Click **Shared Documents** in the admin sidebar.
2. Upload files that will be visible to **all clients** in their Documents tab.
3. Use this for onboarding guides, policy documents, or reference materials.

---

## 36. Profile Settings (Admin)

**Duration:** ~20s

1. Click **Profile Settings** in the admin sidebar.
2. Update your admin display name, email, and password.
3. Configure account-level preferences.

---

## 37. Lead-to-Client Full Journey (End-to-End)

**Duration:** ~2 min

This ties together the complete flow:

1. A lead calls or submits a form. It appears automatically in the **Leads** tab.
2. AI classifies the lead (warm, very good, not a fit, etc.).
3. Review the lead in the **Lead Detail Drawer**. Add notes and rate it.
4. Click **Start Journey** and select the services they're interested in.
5. The journey appears in the **Client Journey** tab with auto-generated follow-up steps from your template.
6. Work through the follow-up steps: call, email, SMS - marking each complete.
7. When the lead agrees to a service, click **Agreed to Service** from the Leads tab.
8. Select the service(s) and confirm. The lead becomes an **Active Client**.
9. They appear in the **Active Clients** page, contributing to your monthly revenue goal.
10. The journey status updates to **Won**. Archive it when you're done.

---

*37 scripts total. Each is self-contained and can be recorded independently.*
