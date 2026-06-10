/**
 * Tracking Configuration Tutorial (Admin)
 *
 * Shows admins how to view and manage a client's tracking setup —
 * GA4, Google Ads, Meta, GTM containers, and conversion events.
 */

const adminTracking = {
  id: 'admin-tracking',
  label: 'Tracking Configuration',
  description: "Learn how to view and manage a client's tracking setup — GA4, Google Ads, Meta pixels, GTM, and conversion events.",
  estimatedMinutes: 3,
  audience: 'admin',
  steps: [
    {
      target: 'body',
      title: 'Client Tracking Setup',
      content: "Let's explore how to view and manage tracking configuration for any client. This is where GA4, Google Ads, Meta, and GTM all come together.",
      placement: 'center',
      navigateTo: '/client-hub'
    },
    {
      target: '[data-tutorial="admin-client-list"]',
      title: 'Open a Client',
      content: 'Click any client to open their drawer, then navigate to the Tracking tab (the last tab).',
      placement: 'top',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'The Tracking Wizard',
      content: "The Tracking tab opens a 5-step wizard that walks through the client's entire tracking configuration. You can review or update any step at any time.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Step 1: Client Type',
      content: "The first step sets the client's business type (dental, medical, therapy, etc.). This determines privacy rules — medical clients have stricter HIPAA protections that block certain tracking platforms.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Step 2: Linked Accounts',
      content: "Step 2 shows which analytics accounts are linked — GA4 property, Google Ads customer, Meta ad account, and Meta pixel. You can change selections or link new accounts here.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Step 3: GTM Container',
      content: "Step 3 manages the Google Tag Manager container — select an existing one or create a new one, provision tags and triggers, and publish changes.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Step 4: Conversion Events',
      content: "Step 4 maps internal events (form submitted, qualified call, new client signed) to external conversion actions in Google Ads and Meta. This powers the server-side relay.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Step 5: Install & Status',
      content: "The final step shows the GTM install snippet, relay toggle, and overall provisioning status. Copy the snippet to add tracking to the client's website.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Tracking — Done!',
      content: "That covers the tracking setup! Open any client's drawer and head to the Tracking tab to review or update their configuration.",
      placement: 'center',
      navigateTo: null
    }
  ]
};

export default adminTracking;
