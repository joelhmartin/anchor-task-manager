import gettingStarted from './gettingStarted';
import leads from './leads';
import leadJourneys from './leadJourneys';
import taggingLeads from './taggingLeads';
import contactsOverview from './contacts';
import ADMIN_TUTORIALS from './admin';

// All tutorials available in the system.
// Order here determines display order in the Tutorials tab.
const TUTORIALS = [
  // Client-audience tutorials
  gettingStarted,
  leadJourneys,
  taggingLeads,
  leads,
  contactsOverview,
  // Admin-audience tutorials
  ...ADMIN_TUTORIALS
];

export default TUTORIALS;
