/**
 * Form Notifications Tutorial (Admin)
 *
 * Shows admins how to control who receives form submission
 * notifications for each client — default recipients and
 * per-form overrides.
 */

const adminNotifications = {
  id: 'admin-notifications',
  label: 'Form Notifications',
  description: 'Learn how to control who gets notified when forms are submitted — set default recipients and per-form overrides.',
  estimatedMinutes: 2,
  audience: 'admin',
  steps: [
    {
      target: 'body',
      title: 'Notification Settings',
      content: "Let's set up who gets notified when a client's forms are submitted. You can set default recipients and override them per form.",
      placement: 'center',
      navigateTo: '/client-hub'
    },
    {
      target: '[data-tutorial="admin-client-list"]',
      title: 'Open a Client',
      content: 'Click any client to open their drawer, then navigate to the Notifications tab.',
      placement: 'top',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Default Recipients',
      content: "The Notifications tab lets you set default email recipients for all form submissions. Type an email address and press Enter to add it. These recipients get notified whenever any of this client's forms are submitted.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Adding & Removing Emails',
      content: "Type an email and press Enter or comma to add it. You can paste a comma-separated list too. Hit Backspace to remove the last one, or click the X on any chip to remove a specific email.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Fallback Behavior',
      content: "If no recipients are set here, form notifications fall back to the client's own account email address. So there's always someone getting notified.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Per-Form Overrides',
      content: "Need different recipients for a specific form? Open that form in the Form Builder and check its notification settings. Per-form settings override the defaults you set here.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Notifications — Done!',
      content: "That's how notification routing works! Set defaults in the Notifications tab, and override per form when needed. Don't forget to hit Save.",
      placement: 'center',
      navigateTo: null
    }
  ]
};

export default adminNotifications;
