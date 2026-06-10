/**
 * Getting Started Tutorial
 *
 * Overview of the client portal — navigation, key sections.
 */

const gettingStarted = {
  id: 'getting-started',
  label: 'Getting Started',
  description: 'A quick tour of your client portal — learn how to navigate and find what you need.',
  estimatedMinutes: 2,
  audience: 'client',
  steps: [
    {
      target: 'body',
      title: 'Welcome to Your Portal!',
      content: "Let's take a quick tour so you feel right at home. We'll show you where everything lives — it only takes a minute.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: '[data-tutorial="portal-sidebar"]',
      title: 'Your Navigation Menu',
      content: "Everything lives here in the sidebar. Use these links to jump between sections anytime. Let's highlight the key ones.",
      placement: 'right',
      navigateTo: null
    },
    {
      target: '[data-tutorial="nav-profile"]',
      title: 'Profile',
      content: 'This is where you manage your account — update your display name, change your password, and set your monthly revenue goal.',
      placement: 'right',
      navigateTo: null
    },
    {
      target: '[data-tutorial="nav-leads"]',
      title: 'Leads',
      content:
        'Every new inquiry lands here. The Leads tab is organized into three queues — New Leads, Lead Journeys, and Contacts — so the front desk can work one at a time.',
      placement: 'right',
      navigateTo: null
    },
    {
      target: '[data-tutorial="nav-journey"]',
      title: 'Lead Journey',
      content:
        'This is your active follow-up queue. Open a journey to mark steps complete, add notes, pause follow-up, or convert the person into an active client when they agree to service.',
      placement: 'right',
      navigateTo: null
    },
    {
      target: 'body',
      title: "You're All Set!",
      content:
        "That's the overview! Explore at your own pace — and if you want a deeper dive into any area, head to the Tutorials section in the sidebar.",
      placement: 'center',
      navigateTo: '/portal?tab=tutorials'
    }
  ]
};

export default gettingStarted;
