/**
 * Client Drawer Overview Tutorial (Admin)
 *
 * Introduces the client drawer and its tabs — the central hub
 * for managing everything about a client account.
 */

const clientDrawerOverview = {
  id: 'admin-client-drawer',
  label: 'Client Drawer Overview',
  description: 'Learn how to open a client drawer and navigate its tabs — your one-stop shop for managing each client.',
  estimatedMinutes: 2,
  audience: 'admin',
  steps: [
    {
      target: 'body',
      title: 'Welcome to the Client Hub',
      content: "Let's take a quick tour of the Client Hub — the command center for managing all your client accounts.",
      placement: 'center',
      navigateTo: '/client-hub'
    },
    {
      target: '[data-tutorial="admin-client-list"]',
      title: 'Your Client List',
      content: 'This is your client list. Clients are organized into groups that you can customize. Click any client row to open their drawer.',
      placement: 'top',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'The Client Drawer',
      content: "When you click a client, a drawer slides open on the right side with 9 tabs — everything you need to manage that client's account in one place.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Client Details & Assets',
      content: "The first few tabs cover the basics: Client Details (name, email, status, onboarding), Client Assets (logos, brand info), and Client Documents (uploaded files).",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Integrations & Forms',
      content: "The Integrations tab manages OAuth connections (Google, Facebook, etc.). The Forms tab gives you quick access to all their forms, submissions, analytics, and embed codes.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Team, Notifications & More',
      content: "Team lets you manage who has access to the client's account. Notifications controls who gets emailed when forms are submitted. Activity Log tracks everything, and Tracking manages their conversion setup.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: "You're All Set!",
      content: "That's the overview! Try clicking a client to explore the drawer yourself. Check out the other admin tutorials for deeper dives into Forms, Team, Notifications, and Tracking.",
      placement: 'center',
      navigateTo: null
    }
  ]
};

export default clientDrawerOverview;
