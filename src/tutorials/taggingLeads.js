/**
 * Tagging Leads Tutorial
 *
 * Explains how to tag unique cases and create custom tags
 * to keep the lead list organized.
 */

const taggingLeads = {
  id: 'tagging-leads',
  label: 'Tagging Unique Cases',
  description: 'Use tags to flag and organize leads by case type, urgency, or any custom category that matters to your practice.',
  estimatedMinutes: 2,
  audience: 'client',
  steps: [
    {
      target: 'body',
      title: 'Why Tags?',
      content:
        "Not every lead fits neatly into a category. Tags let you add your own labels — things like 'High Value', 'TMJ Flare-Up', 'Referred by Dr. Smith', or 'Needs Follow-Up'. They're fully custom and searchable.",
      placement: 'center',
      navigateTo: '/portal?tab=leads'
    },
    {
      target: '[data-tutorial="lead-tag-area"]',
      title: 'Tags Live Right Here',
      content:
        "Each lead card shows its tags inline as colored chips. You can see at a glance what's already been noted about a lead without opening it. Up to 3 tags show on the card — and a '+N' badge if there are more.",
      placement: 'bottom',
      navigateTo: null
    },
    {
      target: '[data-tutorial="lead-tag-area"]',
      title: 'Adding a Tag',
      content:
        "Click the tag icon (the price-tag icon) on any lead card to open the full lead detail panel. Inside, scroll to the Tags section to add or remove tags.",
      placement: 'bottom',
      navigateTo: null
    },
    {
      target: '[data-tutorial="lead-tag-area"]',
      title: 'Creating Custom Tags',
      content:
        "The tag input works like a search box. Type any existing tag name to select it — or type something brand new and press Enter to create a custom tag on the spot. Your new tag is saved and available for all future leads.",
      placement: 'bottom',
      navigateTo: null
    },
    {
      target: '[data-tutorial="leads-search"]',
      title: 'Filter by What Matters',
      content:
        "Use the lead list together with tags to keep quick context on the right people. Tags are best for front-desk flags like case type, urgency, referral source, or anything your team needs to spot immediately.",
      placement: 'bottom',
      navigateTo: null
    },
    {
      target: 'body',
      title: 'Tags = Instant Context',
      content:
        "Great tagging habits mean your whole team always has context at a glance. When someone picks up the phone to follow up, they already know they're calling a 'Warm + TMJ + Referred' lead before they even say hello.",
      placement: 'center',
      navigateTo: '/portal?tab=tutorials'
    }
  ]
};

export default taggingLeads;
