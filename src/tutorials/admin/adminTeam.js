/**
 * Team Management Tutorial (Admin)
 *
 * Shows admins how to manage client team members — view current
 * members, send invites, resend/revoke invitations, and remove members.
 */

const adminTeam = {
  id: 'admin-team',
  label: 'Team Management',
  description: "Learn how to manage a client's team members — invite new users, resend invitations, and control who has access.",
  estimatedMinutes: 2,
  audience: 'admin',
  steps: [
    {
      target: 'body',
      title: 'Managing Client Teams',
      content: "Let's walk through how to manage team members for any client account. You can invite, remove, and control access — all from the client drawer.",
      placement: 'center',
      navigateTo: '/client-hub'
    },
    {
      target: '[data-tutorial="admin-client-list"]',
      title: 'Open a Client',
      content: 'Click any client to open their drawer, then navigate to the Team tab.',
      placement: 'top',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'The Team Tab',
      content: "The Team tab shows two sections: current Team Members and Pending Invitations. You'll see each person's name, email, role, and when they joined.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Inviting Team Members',
      content: 'Click the "Invite" button to send a new invitation. Enter an email, optionally a first name, and choose a role:\n\n\u2022 Member — can view and edit account data\n\u2022 Admin — can also invite and remove team members',
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Invitation Link',
      content: "After sending an invite, you'll get a shareable link you can copy. The invitee also receives an email. If they don't act on it, you can resend from the Pending Invitations section.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Managing Access',
      content: "Need to revoke an invitation? Hit the trash icon next to any pending invite. To remove an existing member, use the delete button on their row. Owners can't be removed.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Team Management — Done!',
      content: "That's it! Open any client's drawer, go to Team, and you can manage their entire team from one place.",
      placement: 'center',
      navigateTo: null
    }
  ]
};

export default adminTeam;
