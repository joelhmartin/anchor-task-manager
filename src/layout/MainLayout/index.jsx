import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

// material-ui
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Box from '@mui/material/Box';

// project imports
import Footer from './Footer';
import Header from './Header';
import Sidebar from './Sidebar';
import MainContentStyled from './MainContentStyled';
import Loader from 'ui-component/Loader';
import { TaskProvider } from 'contexts/TaskContext';

import useConfig from 'hooks/useConfig';
import { handlerDrawerOpen, useGetMenuMaster } from 'api/menu';
import useAuth from 'hooks/useAuth';
import { TutorialProvider } from 'contexts/TutorialContext';
import TutorialRunner from 'ui-component/extended/TutorialRunner';
import DemoBanner from 'ui-component/extended/DemoBanner';

// ==============================|| MAIN LAYOUT ||============================== //

export default function MainLayout() {
  const theme = useTheme();
  const downMD = useMediaQuery(theme.breakpoints.down('md'));
  const { user, actingClientId } = useAuth();
  const location = useLocation();

  const {
    state: { borderRadius, miniDrawer }
  } = useConfig();
  const { menuMaster, menuMasterLoading } = useGetMenuMaster();
  const drawerOpen = menuMaster?.isDashboardDrawerOpened;

  useEffect(() => {
    handlerDrawerOpen(!miniDrawer);
  }, [miniDrawer]);

  useEffect(() => {
    downMD && handlerDrawerOpen(false);
  }, [downMD]);

  // horizontal menu-list bar : drawer

  if (menuMasterLoading) return <Loader />;

  const content = (
    <Box sx={{ display: 'flex' }}>
      {/* header */}
      <AppBar enableColorOnDark position="fixed" color="inherit" elevation={0} sx={{ bgcolor: 'background.default' }}>
        <Toolbar sx={{ p: 2 }}>
          <Header />
        </Toolbar>
      </AppBar>

      {/* menu / drawer */}
      <Sidebar />

      {/* main content */}
      <MainContentStyled {...{ borderRadius, open: drawerOpen }}>
        <DemoBanner />
        <Box sx={{ ...{ px: { xs: 0 } }, minHeight: 'calc(100vh - 128px)', display: 'flex', flexDirection: 'column' }}>
          <Outlet />
          <Footer />
        </Box>
      </MainContentStyled>
    </Box>
  );

  // Task-only app: TaskProvider always wraps the layout (the sidebar's TaskSidebarPanel
  // needs it on every route, including the initial "/" landing before redirect to /tasks).
  return (
    <TutorialProvider>
      <TaskProvider>{content}</TaskProvider>
      <TutorialRunner />
    </TutorialProvider>
  );
}
