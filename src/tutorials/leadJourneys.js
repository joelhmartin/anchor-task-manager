/**
 * Lead Journeys Tutorial (consolidated)
 *
 * Replaces the three pre-redesign journey tutorials (starting-journeys,
 * managing-journeys, journey-template) with a single end-to-end walkthrough of
 * the redesigned journey system: starting a journey from a lead, working the
 * stage pipeline, the journey drawer (Notes + Activity tabs), and the reusable
 * email templates.
 *
 * Steps 5–8 (0-indexed) describe the journey drawer; ClientPortal auto-opens the
 * drawer with a mock journey for those indices (see `drawerTutorialMode`). Step 9
 * switches the journey tab to its "Email Templates" sub-tab. Keep those index
 * ranges in sync with ClientPortal.jsx if you reorder steps.
 */

const leadJourneys = {
  id: 'lead-journeys',
  label: 'Lead Journeys, End to End',
  description:
    'The full flow: start a journey from a lead, work the stage pipeline, use the Notes & Activity tabs, and set up reusable follow-up templates.',
  estimatedMinutes: 5,
  audience: 'client',
  steps: [
    // 0 — intro
    {
      target: 'body',
      title: 'Turning Leads Into Clients',
      content:
        "A Lead Journey is how you turn a promising lead into structured, repeatable follow-up — instead of relying on memory. Let's walk the whole flow: starting a journey, working the pipeline, and using your follow-up templates.",
      placement: 'center',
      navigateTo: '/portal?tab=leads'
    },
    // 1 — leads list
    {
      target: '[data-tutorial="leads-card-list"]',
      title: 'Start From a Lead',
      content:
        'Every journey starts with a lead. Each card shows who reached out, how they came in, and how they were categorized — so you can spot the ones worth pursuing.',
      placement: 'top',
      navigateTo: null
    },
    // 2 — start journey button
    {
      target: '[data-tutorial="lead-start-journey"]',
      title: 'Start the Journey',
      content:
        "When a lead is worth pursuing, click 'Start Journey'. You'll pick the services or concerns they mentioned, and they move into your follow-up pipeline.",
      placement: 'top',
      navigateTo: null
    },
    // 3 — move to journey tab (pipeline)
    {
      target: 'body',
      title: 'The Lead Journey Pipeline',
      content: "This is the Lead Journey tab — your follow-up command center. Let's look at how journeys move through it.",
      placement: 'center',
      navigateTo: '/portal?tab=journey'
    },
    // 4 — pipeline board
    {
      target: '[data-tutorial="journey-pipeline"]',
      title: 'Stages, Left to Right',
      content:
        'Active journeys are grouped by stage — First Touch through Awaiting Decision. Each card is one person, and the count shows how many sit at each stage. Click any card to open it.',
      placement: 'top',
      navigateTo: null
    },
    // 5 — drawer header (drawer auto-opens; target lives in the fixed panel)
    {
      target: '[data-tutorial="journey-drawer-header"]',
      title: 'Inside a Journey',
      content:
        'Opening a journey shows everything in one place: the current stage, who started it and when, and the concerns they raised. The quick actions here let you Convert to Client, Mark Complete to advance a stage, or Archive.',
      placement: 'left',
      navigateTo: null,
      disableScrolling: true
    },
    // 6 — notes tab
    {
      target: '[data-tutorial="journey-drawer-tabs"]',
      title: 'Notes — Your Running Log',
      content:
        "The Notes tab is open by default — your private log for this person. Record what happened on a call, what they're waiting on, anything the team should know, then add it with the composer below.",
      placement: 'left',
      navigateTo: null,
      disableScrolling: true
    },
    // 7 — activity tab
    {
      target: '[data-tutorial="journey-drawer-tabs"]',
      title: 'Activity — The Full History',
      content:
        'Right next to Notes, the Activity tab is the automatic record: emails sent, calls, texts, and every stage change — timestamped, so nothing slips through the cracks.',
      placement: 'left',
      navigateTo: null,
      disableScrolling: true
    },
    // 8 — reaching out
    {
      target: '[data-tutorial="journey-drawer-actions"]',
      title: 'Reaching Out',
      content:
        "Down here, 'Send Email' composes a follow-up built from your templates (texting is on the way). When the person says yes, use Convert to Client up top — they become an active client and show up in your Contacts.",
      placement: 'left',
      navigateTo: null,
      disableScrolling: true
    },
    // 9 — email templates sub-tab (drawer closes)
    {
      target: 'body',
      title: 'Your Follow-Up Templates',
      content:
        "The Email Templates tab is where the time-savings live. Build a template once — subject, body, and reusable tokens like the client's name — and send it in a couple of clicks from any journey.",
      placement: 'center',
      navigateTo: '/portal?tab=journey'
    },
    // 10 — wrap up
    {
      target: 'body',
      title: "That's the Whole Journey",
      content:
        'Start a journey from a strong lead, work the pipeline stage by stage, keep notes as you go, and convert when they’re ready. Consistent follow-up, every time.',
      placement: 'center',
      navigateTo: '/portal?tab=tutorials'
    }
  ]
};

export default leadJourneys;
