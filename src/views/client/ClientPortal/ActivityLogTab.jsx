import { useState } from 'react';
import PropTypes from 'prop-types';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';

import MainCard from 'ui-component/cards/MainCard';
import EmailLogsPane from './activity/EmailLogsPane';
import ActivityLogsPane from './activity/ActivityLogsPane';

export default function ActivityLogTab({ triggerMessage }) {
  const [subTab, setSubTab] = useState(0);

  return (
    <MainCard title="Activity Log" sx={{ mt: 2 }}>
      <Tabs value={subTab} onChange={(_e, v) => setSubTab(v)} sx={{ mb: 2 }}>
        <Tab label="Email logs" />
        <Tab label="Activity logs" />
      </Tabs>
      <Box hidden={subTab !== 0}>{subTab === 0 && <EmailLogsPane triggerMessage={triggerMessage} />}</Box>
      <Box hidden={subTab !== 1}>{subTab === 1 && <ActivityLogsPane triggerMessage={triggerMessage} />}</Box>
    </MainCard>
  );
}

ActivityLogTab.propTypes = {
  triggerMessage: PropTypes.func
};
