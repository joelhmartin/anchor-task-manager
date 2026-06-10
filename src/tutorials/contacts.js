/**
 * Contacts Tutorial (Contacts Master List — Phase 5)
 *
 * Walks a client through the Contacts experience: find anyone regardless of
 * lifecycle (new lead, in journey, active client, archived), filter precisely
 * (status + multi-select tags/services), read a row, open a full profile,
 * review services history + activity, archive/restore, and export — plus how
 * the Leads switcher relates to Contacts.
 *
 * Steps 7–10 (0-indexed) describe the contact profile drawer, so ContactsTab
 * auto-opens it with a mock contact for that range (see ContactsTab.jsx
 * `drawerTutorialMode` + src/tutorials/mockData.js MOCK_CONTACT_DETAIL). Keep
 * that index range in sync with this file if you reorder steps.
 */

const contactsOverview = {
  id: 'contacts-overview',
  label: 'Your Contacts Hub',
  description: 'Find anyone, filter precisely, open a full profile, and export — your whole people directory in one place.',
  estimatedMinutes: 3,
  audience: 'client',
  steps: [
    // 0 — intro
    {
      target: 'body',
      title: 'Meet Contacts',
      content:
        "Contacts is your master directory — everyone who's ever reached out, one row each, no matter where they are in the journey. It replaces the old Client List and Archive. Let's take a quick look.",
      placement: 'center',
      navigateTo: '/portal?tab=contacts'
    },
    // 1 — Leads switcher (Contacts is reachable from the Leads bar too)
    {
      target: '[data-tutorial="leads-switcher"]',
      title: 'Reachable From Leads, Too',
      content:
        'Quick heads-up: Contacts also lives right here on your Leads bar. Leads is the inbox for brand-new activity; Contacts is where you browse and manage everyone. Same list, two doors.',
      placement: 'bottom',
      navigateTo: '/portal?tab=leads'
    },
    // 2 — search
    {
      target: '[data-tutorial="contacts-search"]',
      title: 'Find Anyone in Seconds',
      content: 'Search by name, phone, or email to jump straight to a person — no scrolling required.',
      placement: 'bottom',
      navigateTo: '/portal?tab=contacts'
    },
    // 3 — status filter
    {
      target: '[data-tutorial="contacts-status"]',
      title: 'Filter by Lifecycle',
      content:
        "Status finds people by where they are: New Lead, In Journey, Active Client, or Archived. Archived contacts are hidden by default — switch to 'Archived' here whenever you need them.",
      placement: 'bottom',
      navigateTo: null
    },
    // 4 — tags multi-select (AND)
    {
      target: '[data-tutorial="contacts-tags"]',
      title: 'Narrow by Tags',
      content: 'Pick one or more tags to filter. Choose two and you only see people who carry both — precise targeting in a click.',
      placement: 'bottom',
      navigateTo: null
    },
    // 5 — services multi-select (AND)
    {
      target: '[data-tutorial="contacts-services"]',
      title: 'Narrow by Services',
      content: 'Same idea for services: select two and you get everyone interested in both. Great for building a focused outreach list.',
      placement: 'bottom',
      navigateTo: null
    },
    // 6 — reading a row
    {
      target: '[data-tutorial="contacts-table"]',
      title: 'Reading a Row',
      content:
        'Each row shows the essentials at a glance: status, tags, services, last activity, and how many times they’ve been in touch.',
      placement: 'top',
      navigateTo: null
    },
    // 7 — drawer opens (auto, with a mock contact): profile + identifiers
    {
      target: '[data-tutorial="contact-drawer-header"]',
      title: 'Open a Full Profile',
      content:
        'Click any contact and their full profile slides open here — name, phone, and email up top, with tags and consent just below. You can rename anyone, too.',
      placement: 'left',
      navigateTo: null,
      disableScrolling: true
    },
    // 8 — services history
    {
      target: '[data-tutorial="contact-drawer-services"]',
      title: 'Services History',
      content:
        'Every service this person signed up for, where it came from (a journey or as an active client), and when — a running ledger you can trust.',
      placement: 'left',
      navigateTo: null,
      disableScrolling: true
    },
    // 9 — activity timeline
    {
      target: '[data-tutorial="contact-drawer-activity"]',
      title: 'The Full Timeline',
      content: 'Below that is every call, form, and email for this contact, newest first — so the whole relationship is in one place.',
      placement: 'left',
      navigateTo: null,
      disableScrolling: true
    },
    // 10 — archive / restore
    {
      target: '[data-tutorial="contact-drawer-archive"]',
      title: 'Archive or Restore',
      content:
        'Done with someone for now? Archive them right here and they slide out of your default view. Restore brings them back any time — nothing is ever lost.',
      placement: 'left',
      navigateTo: null,
      disableScrolling: true
    },
    // 11 — export (drawer closes)
    {
      target: '[data-tutorial="contacts-export"]',
      title: 'Export What You See',
      content:
        'Export CSV downloads everyone matching your current filters — across all pages, not just this one. Pick your columns (Name, Phone, Email, Tags, Services by default) and you’re set.',
      placement: 'bottom',
      navigateTo: '/portal?tab=contacts'
    },
    // 12 — outro
    {
      target: 'body',
      title: "That's Your Contacts Hub",
      content:
        'Search to find anyone, filter to focus, open a profile for the full story, and export when you need a list. Everyone you’ve ever talked to, always at your fingertips.',
      placement: 'center',
      navigateTo: '/portal?tab=tutorials'
    }
  ]
};

export default contactsOverview;
