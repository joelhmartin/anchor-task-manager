/**
 * Managing Your Leads Tutorial
 *
 * Deep dive into the Leads tab — viewing, filtering, and acting on leads.
 */

const leads = {
  id: 'managing-leads',
  label: 'Managing Your Leads',
  description: 'Learn how to track incoming leads, view call details, and take action.',
  estimatedMinutes: 3,
  audience: 'client',
  steps: [
    {
      target: 'body',
      title: 'Your Lead Pipeline',
      content: "Let's walk through the Leads section — where every new inquiry lands and how to manage them effectively.",
      placement: 'center',
      navigateTo: '/portal?tab=leads'
    },
    {
      target: '[data-tutorial="leads-card-list"]',
      title: 'All Your Leads, One Place',
      content:
        'These cards are your current lead queue. The tabs up top — New Leads, Lead Journeys, and Contacts — let you focus on one at a time instead of mixing everything together.',
      placement: 'top',
      navigateTo: null
    },
    {
      target: '[data-tutorial="leads-search"]',
      title: 'Find a Lead Fast',
      content:
        'Type a name, phone number, or keyword to instantly filter your leads list. Great for pulling up a specific contact quickly.',
      placement: 'bottom',
      navigateTo: null
    },
    {
      target: '[data-tutorial="leads-card-list"]',
      title: 'Dig Into the Details',
      content:
        'Click any card to open the full record. The drawer shows the overview, notes, tags, AI summary, and the full activity history for that contact.',
      placement: 'top',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Lead Management Mastered!',
      content: "You're all set to start working your pipeline. New inquiries flow in automatically — your job is just to follow up fast.",
      placement: 'center',
      navigateTo: '/portal?tab=tutorials'
    }
  ]
};

export default leads;
