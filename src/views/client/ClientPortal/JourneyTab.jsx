import { useState } from 'react';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';

import PipelineBoard from './leads/PipelineBoard';
import EmailTemplatesPane from './leads/EmailTemplatesPane';

/**
 * Dedicated "Lead Journey" portal tab. Surfaces the redesigned journey pipeline
 * (kanban board grouped by stage) and the per-client email-template manager.
 * The journey drawer itself is owned by ClientPortal via useJourneyDrawer and
 * opened through openJourneyDrawer.
 */
export default function JourneyTab({ journeys, openJourneyDrawer, applyJourneyUpdate, tab: controlledTab, onTabChange }) {
  const [internalTab, setInternalTab] = useState(0);
  const isControlled = controlledTab != null;
  const tab = isControlled ? controlledTab : internalTab;
  const setTab = (v) => {
    if (!isControlled) setInternalTab(v);
    onTabChange?.(v);
  };

  return (
    <Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tab label="Pipeline" />
        <Tab label="Email Templates" />
      </Tabs>

      {tab === 0 && <PipelineBoard journeys={journeys} onOpen={openJourneyDrawer} onJourneyUpdate={applyJourneyUpdate} />}
      {tab === 1 && <EmailTemplatesPane />}
    </Box>
  );
}
