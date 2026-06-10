/**
 * Forms & Submissions Tutorial (Admin)
 *
 * Shows admins how to access form submissions, open the builder,
 * view analytics, and grab embed codes from the client drawer.
 */

const adminForms = {
  id: 'admin-forms',
  label: 'Forms & Submissions',
  description: 'Learn how to view form submissions, open the builder, check analytics, and grab embed codes — all from the client drawer.',
  estimatedMinutes: 2,
  audience: 'admin',
  steps: [
    {
      target: 'body',
      title: 'Managing Client Forms',
      content: "Let's walk through how to manage forms for any client. Everything starts from the Client Hub.",
      placement: 'center',
      navigateTo: '/client-hub'
    },
    {
      target: '[data-tutorial="admin-client-list"]',
      title: 'Open a Client',
      content: 'Click any client to open their drawer. Then navigate to the Forms tab.',
      placement: 'top',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'The Forms Tab',
      content: "Inside the drawer, the Forms tab lists every form for that client — with its name, status, and submission count at a glance.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Quick Actions',
      content: "Each form row has icon buttons for quick actions:\n\n\u{1F528} Form Builder — edit the form's fields and layout\n\u{1F441} Submissions — view every submission with full details\n\u{1F4CA} Analytics — see submission trends over time\n\u{1F4CB} Embed Code — grab the snippet to put on a website",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Viewing Submissions',
      content: "Click the eye icon next to any form to see its submissions. From there you can view full form data, retry failed CTM syncs, or resend notification emails.",
      placement: 'center',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Forms — Done!',
      content: "That's all there is to it! Open a client, go to Forms, and you have full control over their forms and submissions.",
      placement: 'center',
      navigateTo: null
    }
  ]
};

export default adminForms;
