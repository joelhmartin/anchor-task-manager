/**
 * Mock data for tutorials — ensures tutorials always have
 * realistic-looking data to show, regardless of account state.
 */

// ---- Mock Leads / Calls ----

const MOCK_CALLS = [
  {
    id: 'mock-lead-001',
    caller_name: 'Sarah Johnson',
    caller_number: '14155551234',
    caller_type: 'new',
    category: 'very_good',
    classification_summary:
      'Caller expressed strong interest in scheduling an initial consultation. Asked about availability and insurance coverage.',
    is_inbound: true,
    direction: 'inbound',
    activity_type: 'call',
    duration_sec: 185,
    duration_formatted: '3m 5s',
    started_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    call_time: 'Today',
    time_ago: '2h ago',
    lifecycle_state: 'new',
    source: 'Google Ads',
    source_key: 'google',
    form_name: null,
    recording_url: '#',
    transcript: 'Sample transcript for tutorial purposes.',
    call_sequence: 1
  },
  {
    id: 'mock-lead-002',
    caller_name: 'Michael Chen',
    caller_number: '12125559876',
    caller_type: 'new',
    category: 'needs_attention',
    classification_summary: 'Left voicemail requesting callback about treatment options. Mentioned referral from another patient.',
    is_inbound: true,
    direction: 'inbound',
    activity_type: 'call',
    duration_sec: 45,
    duration_formatted: '0m 45s',
    started_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    call_time: 'Today',
    time_ago: '5h ago',
    lifecycle_state: 'new',
    source: 'Website',
    source_key: 'website',
    form_name: null,
    recording_url: '#',
    transcript: 'Sample voicemail transcript for tutorial purposes.',
    is_voicemail: true,
    call_sequence: 1
  },
  {
    id: 'mock-lead-003',
    caller_name: 'Emily Rodriguez',
    caller_number: '13105554567',
    caller_type: 'repeat',
    category: 'unreviewed',
    classification_summary: null,
    is_inbound: true,
    direction: 'inbound',
    activity_type: 'form',
    duration_sec: 0,
    duration_formatted: '',
    started_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    call_time: 'Yesterday',
    time_ago: '1d ago',
    lifecycle_state: 'repeat',
    source: 'Facebook',
    source_key: 'facebook',
    form_name: 'Contact Form',
    recording_url: null,
    transcript: null,
    call_sequence: 2
  },
  {
    id: 'mock-lead-004',
    caller_name: 'David Park',
    caller_number: '17735558901',
    caller_type: 'new',
    category: 'not_a_fit',
    classification_summary: 'Price inquiry only. Caller was comparing costs and not ready to commit.',
    is_inbound: true,
    direction: 'inbound',
    activity_type: 'call',
    duration_sec: 92,
    duration_formatted: '1m 32s',
    started_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    call_time: '2 days ago',
    time_ago: '2d ago',
    lifecycle_state: 'new',
    source: 'Google Ads',
    source_key: 'google',
    form_name: null,
    recording_url: '#',
    transcript: 'Sample transcript for tutorial purposes.',
    call_sequence: 1
  },
  {
    id: 'mock-lead-005',
    caller_name: 'Lisa Thompson',
    caller_number: '16465553210',
    caller_type: 'new',
    category: 'warm',
    classification_summary: 'Very interested — asked detailed questions about treatment plans and requested a follow-up call.',
    is_inbound: true,
    direction: 'inbound',
    activity_type: 'call',
    duration_sec: 310,
    duration_formatted: '5m 10s',
    started_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    call_time: '3 days ago',
    time_ago: '3d ago',
    lifecycle_state: 'new',
    source: 'Instagram',
    source_key: 'instagram',
    form_name: null,
    recording_url: '#',
    transcript: 'Sample transcript for tutorial purposes.',
    call_sequence: 1
  }
];

// ---- Mock Tags (keyed by call ID) ----

const MOCK_TAGS = {
  'mock-lead-001': [
    { id: 'tag-1', name: 'High Value', color: '#22c55e' },
    { id: 'tag-2', name: 'Insurance Verified', color: '#6366f1' }
  ],
  'mock-lead-002': [
    { id: 'tag-3', name: 'Needs Follow-Up', color: '#f59e0b' },
    { id: 'tag-4', name: 'Referred', color: '#8b5cf6' }
  ],
  'mock-lead-003': [{ id: 'tag-5', name: 'Web Form', color: '#3b82f6' }],
  'mock-lead-004': [{ id: 'tag-6', name: 'Price Shopper', color: '#ef4444' }],
  'mock-lead-005': [
    { id: 'tag-1', name: 'High Value', color: '#22c55e' },
    { id: 'tag-3', name: 'Needs Follow-Up', color: '#f59e0b' },
    { id: 'tag-7', name: 'Hot Lead', color: '#ec4899' },
    { id: 'tag-8', name: 'Returning', color: '#14b8a6' }
  ]
};

const MOCK_ALL_TAGS = [
  { id: 'tag-1', name: 'High Value', color: '#22c55e' },
  { id: 'tag-2', name: 'Insurance Verified', color: '#6366f1' },
  { id: 'tag-3', name: 'Needs Follow-Up', color: '#f59e0b' },
  { id: 'tag-4', name: 'Referred', color: '#8b5cf6' },
  { id: 'tag-5', name: 'Web Form', color: '#3b82f6' },
  { id: 'tag-6', name: 'Price Shopper', color: '#ef4444' },
  { id: 'tag-7', name: 'Hot Lead', color: '#ec4899' },
  { id: 'tag-8', name: 'Returning', color: '#14b8a6' }
];

// ---- Mock Journeys ----

const now = new Date();
const weeksAgo = (n) => new Date(now.getTime() - n * 7 * 24 * 60 * 60 * 1000).toISOString();
const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
const daysFromNow = (n) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

// Redesigned-journey shape: status 'active' + a `stage` (so the Pipeline board
// groups them) + an `activities` array (so the drawer's Notes/Activity tabs and
// "Started by" line render). journeys[0] is intentionally rich so the tutorial's
// drawer steps have notes + activity to show.
const MOCK_JOURNEYS = [
  {
    id: 'mock-journey-001',
    owner_user_id: 'mock-owner',
    lead_call_id: 'mock-lead-001',
    client_name: 'Sarah Johnson',
    client_phone: '(415) 555-1234',
    client_email: 'sarah.j@example.com',
    status: 'active',
    stage: 'second_touch',
    paused: false,
    symptoms: ['Initial Consultation', 'Insurance Question'],
    created_by_name: 'You',
    created_at: weeksAgo(2),
    updated_at: daysAgo(1),
    activities: [
      {
        id: 'act-1a',
        type: 'stage_change',
        to_stage: 'first_touch',
        author_name: 'You',
        created_at: weeksAgo(2),
        metadata: { event: 'started' }
      },
      { id: 'act-1b', type: 'note', body: 'Patient very responsive — prefers morning calls.', author_name: 'You', created_at: weeksAgo(2) },
      {
        id: 'act-1c',
        type: 'email',
        subject: 'Welcome to our practice',
        body: 'Sent the new-patient intro and insurance overview.',
        email_status: 'sent',
        author_name: 'You',
        created_at: weeksAgo(1)
      },
      { id: 'act-1d', type: 'stage_change', to_stage: 'second_touch', author_name: 'You', created_at: weeksAgo(1) },
      {
        id: 'act-1e',
        type: 'note',
        body: 'Left a voicemail about scheduling — will try again Thursday.',
        author_name: 'You',
        created_at: daysAgo(1)
      }
    ]
  },
  {
    id: 'mock-journey-002',
    owner_user_id: 'mock-owner',
    lead_call_id: 'mock-lead-005',
    client_name: 'Lisa Thompson',
    client_phone: '(646) 555-3210',
    client_email: null,
    status: 'active',
    stage: 'first_touch',
    paused: false,
    symptoms: ['Treatment Plan'],
    created_by_name: 'You',
    created_at: daysAgo(3),
    updated_at: daysAgo(3),
    activities: [
      {
        id: 'act-2a',
        type: 'stage_change',
        to_stage: 'first_touch',
        author_name: 'You',
        created_at: daysAgo(3),
        metadata: { event: 'started' }
      }
    ]
  },
  {
    id: 'mock-journey-003',
    owner_user_id: 'mock-owner',
    lead_call_id: 'mock-lead-003',
    client_name: 'Marcus Lee',
    client_phone: '(310) 555-4567',
    client_email: 'marcus.lee@example.com',
    status: 'active',
    stage: 'third_touch',
    paused: false,
    symptoms: ['Follow-Up Care'],
    created_by_name: 'Anchor Team',
    created_at: weeksAgo(3),
    updated_at: daysAgo(2),
    activities: [
      {
        id: 'act-3a',
        type: 'stage_change',
        to_stage: 'first_touch',
        author_name: 'Anchor Team',
        created_at: weeksAgo(3),
        metadata: { event: 'started' }
      }
    ]
  },
  {
    id: 'mock-journey-004',
    owner_user_id: 'mock-owner',
    lead_call_id: 'mock-lead-002',
    client_name: 'Priya Patel',
    client_phone: '(212) 555-9876',
    client_email: 'priya.p@example.com',
    status: 'active',
    stage: 'awaiting_decision',
    paused: false,
    symptoms: ['Treatment Plan', 'Financing'],
    created_by_name: 'You',
    created_at: weeksAgo(4),
    updated_at: daysAgo(1),
    pending_send: { scheduled_for: daysFromNow(2) },
    activities: [
      {
        id: 'act-4a',
        type: 'stage_change',
        to_stage: 'first_touch',
        author_name: 'You',
        created_at: weeksAgo(4),
        metadata: { event: 'started' }
      }
    ]
  }
];

// ---- Mock Contact (Contacts master-list tutorial) ----

// Mirrors the `/hub/contacts/:id` detail response shape (see server/routes/hub.js
// ~line 6798) so the ContactProfileDrawer renders a real-looking profile — with
// identifiers, tags, consent, a services ledger, and an activity timeline —
// without seeding any PHI. `archived_at: null` so the drawer's button reads
// "Archive" (the tour points at it; nothing is actually archived).
const MOCK_CONTACT_DETAIL = {
  contact: {
    id: 'mock-contact-001',
    display_name: 'Sarah Johnson',
    display_name_source: 'system',
    primary_phone: '(415) 555-1234',
    primary_email: 'sarah.j@example.com',
    sms_opted_out: false,
    email_opted_out: false,
    email_unsubscribed_at: null,
    first_seen_at: weeksAgo(6),
    last_activity_at: daysAgo(1),
    archived_at: null
  },
  phones: [{ id: 'mock-phone-1', phone_digits10: '4155551234', phone_e164: '+1 (415) 555-1234', is_primary: true }],
  emails: [{ id: 'mock-email-1', email: 'sarah.j@example.com', is_primary: true }],
  tags: [
    { id: 'tag-1', name: 'High Value', color: '#22c55e', source: 'system' },
    { id: 'tag-2', name: 'Insurance Verified', color: '#6366f1', source: 'user' }
  ],
  services: [
    {
      id: 'mock-svc-1',
      service_id: 'svc-1',
      service_name: 'Initial Consultation',
      source: 'journey',
      source_ref_id: null,
      created_at: weeksAgo(5)
    },
    {
      id: 'mock-svc-2',
      service_id: 'svc-2',
      service_name: 'Treatment Plan',
      source: 'active_client',
      source_ref_id: null,
      created_at: weeksAgo(2)
    }
  ],
  consent: { sms_opted_out: false, email_opted_out: false, email_unsubscribed_at: null },
  activity_count: 4
};

// Mock activity timeline rows for the drawer — shaped for LeadActivityRow.
const MOCK_CONTACT_TIMELINE = [
  {
    id: 'mock-ct-1',
    call_id: 'mock-ct-1',
    activity_type: 'call',
    caller_name: 'Sarah Johnson',
    category: 'very_good',
    classification_summary: 'Asked about availability and insurance coverage for an initial consult.',
    time_ago: '1d ago',
    call_time: 'Yesterday',
    form_name: null
  },
  {
    id: 'mock-ct-2',
    call_id: 'mock-ct-2',
    activity_type: 'form',
    caller_name: 'Sarah Johnson',
    category: 'warm',
    classification_summary: 'Submitted the contact form requesting a callback.',
    time_ago: '2w ago',
    call_time: '2 weeks ago',
    form_name: 'Contact Form'
  },
  {
    id: 'mock-ct-3',
    call_id: 'mock-ct-3',
    activity_type: 'email',
    caller_name: 'Sarah Johnson',
    category: 'neutral',
    classification_summary: 'Replied to the welcome email with a scheduling question.',
    time_ago: '3w ago',
    call_time: '3 weeks ago',
    form_name: null
  },
  {
    id: 'mock-ct-4',
    call_id: 'mock-ct-4',
    activity_type: 'call',
    caller_name: 'Sarah Johnson',
    category: 'unreviewed',
    classification_summary: 'First inbound call — left a voicemail.',
    time_ago: '6w ago',
    call_time: '6 weeks ago',
    form_name: null
  }
];

// ---- Tutorial → Mock Data mapping ----

/** Tutorial IDs that need mock lead data */
const LEADS_TUTORIALS = new Set(['managing-leads', 'tagging-leads', 'lead-journeys']);

/** Tutorial IDs that need mock journey data */
const JOURNEY_TUTORIALS = new Set(['lead-journeys']);

/** Tutorial IDs that need a mock contact profile (for the drawer spotlight steps) */
const CONTACT_TUTORIALS = new Set(['contacts-overview']);

/**
 * Returns mock data appropriate for the given tutorial, or null.
 */
export function getMockDataForTutorial(tutorialId) {
  if (!tutorialId) return null;

  const needsLeads = LEADS_TUTORIALS.has(tutorialId);
  const needsJourneys = JOURNEY_TUTORIALS.has(tutorialId);
  const needsContact = CONTACT_TUTORIALS.has(tutorialId);

  if (!needsLeads && !needsJourneys && !needsContact) return null;

  return {
    ...(needsLeads && {
      calls: MOCK_CALLS,
      callTags: MOCK_TAGS,
      allTags: MOCK_ALL_TAGS
    }),
    ...(needsJourneys && {
      journeys: MOCK_JOURNEYS
    }),
    ...(needsContact && {
      contact: MOCK_CONTACT_DETAIL,
      contactTimeline: MOCK_CONTACT_TIMELINE
    })
  };
}

export {
  MOCK_CALLS,
  MOCK_TAGS,
  MOCK_ALL_TAGS,
  MOCK_JOURNEYS,
  MOCK_CONTACT_DETAIL,
  MOCK_CONTACT_TIMELINE,
  LEADS_TUTORIALS,
  JOURNEY_TUTORIALS,
  CONTACT_TUTORIALS
};
