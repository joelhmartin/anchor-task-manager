import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Box from '@mui/material/Box';

import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ReplayIcon from '@mui/icons-material/Replay';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import OndemandVideoOutlinedIcon from '@mui/icons-material/OndemandVideoOutlined';

import useTutorial from 'hooks/useTutorial';

const VIDEO_TUTORIALS = [
  {
    id: 'dashboard-overview-video',
    label: 'Dashboard Overview',
    description: 'A recorded walkthrough of the main dashboard and how the portal is organized.',
    videoSrc: 'https://player.vimeo.com/video/1177694501?h=2d4eb7017c&badge=0&autopause=0&player_id=0&app_id=58479'
  },
  {
    id: 'general-settings-team-management-video',
    label: 'General Settings - Team Management',
    description: 'A recorded walkthrough of team management inside general settings.',
    videoSrc: 'https://player.vimeo.com/video/1177697080?h=ac20af54ae&badge=0&autopause=0&player_id=0&app_id=58479'
  }
];

export default function TutorialsTab() {
  const { tutorials, completedIds, startTutorial } = useTutorial();

  return (
    <Stack spacing={3}>
      <Stack spacing={0.5}>
        <Typography variant="h5">Self-Guided Tutorials</Typography>
        <Typography variant="body2" color="text.secondary">
          Step through each tutorial at your own pace. Spotlight guides will highlight key areas of your portal as you go.
        </Typography>
      </Stack>

      <Grid container spacing={2}>
        {tutorials.map((tutorial) => {
          const isCompleted = completedIds.has(tutorial.id);
          return (
            <Grid item xs={12} sm={6} md={4} key={tutorial.id}>
              <Card
                variant="outlined"
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  borderColor: isCompleted ? 'success.light' : 'divider',
                  transition: 'box-shadow 0.2s',
                  '&:hover': { boxShadow: 3 }
                }}
              >
                <CardContent sx={{ flex: 1 }}>
                  <Stack spacing={1.5}>
                    <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                      <SchoolOutlinedIcon sx={{ color: isCompleted ? 'success.main' : 'primary.main', mt: 0.25 }} />
                      {isCompleted ? (
                        <Chip
                          icon={<CheckCircleOutlineIcon />}
                          label="Completed"
                          size="small"
                          color="success"
                          variant="outlined"
                        />
                      ) : (
                        <Chip label="Not started" size="small" variant="outlined" sx={{ color: 'text.secondary', borderColor: 'divider' }} />
                      )}
                    </Stack>

                    <Stack spacing={0.5}>
                      <Typography variant="h6" sx={{ lineHeight: 1.3 }}>
                        {tutorial.label}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {tutorial.description}
                      </Typography>
                    </Stack>

                    <Stack direction="row" alignItems="center" spacing={0.5}>
                      <AccessTimeIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                      <Typography variant="caption" color="text.secondary">
                        ~{tutorial.estimatedMinutes} min
                      </Typography>
                    </Stack>
                  </Stack>
                </CardContent>

                <CardActions sx={{ px: 2, pb: 2 }}>
                  <Button
                    variant={isCompleted ? 'outlined' : 'contained'}
                    size="small"
                    startIcon={isCompleted ? <ReplayIcon /> : <PlayArrowIcon />}
                    onClick={() => startTutorial(tutorial.id)}
                    fullWidth
                  >
                    {isCompleted ? 'Replay' : 'Start Tutorial'}
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      <Stack spacing={0.5}>
        <Typography variant="h5">Video Walkthroughs</Typography>
        <Typography variant="body2" color="text.secondary">
          Recorded walkthroughs for parts of the portal that are better shown than spotlighted.
        </Typography>
      </Stack>

      <Grid container spacing={2}>
        {VIDEO_TUTORIALS.map((tutorial) => (
          <Grid item xs={12} md={6} key={tutorial.id}>
            <Card
              variant="outlined"
              sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                transition: 'box-shadow 0.2s',
                '&:hover': { boxShadow: 3 }
              }}
            >
              <Box sx={{ position: 'relative', width: '100%', pt: '56.25%', borderBottom: 1, borderColor: 'divider' }}>
                <Box
                  component="iframe"
                  src={tutorial.videoSrc}
                  title={tutorial.label}
                  allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    border: 0
                  }}
                />
              </Box>

              <CardContent sx={{ flex: 1 }}>
                <Stack spacing={1.5}>
                  <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                    <OndemandVideoOutlinedIcon sx={{ color: 'primary.main', mt: 0.25 }} />
                    <Chip label="Video" size="small" variant="outlined" />
                  </Stack>

                  <Stack spacing={0.5}>
                    <Typography variant="h6" sx={{ lineHeight: 1.3 }}>
                      {tutorial.label}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {tutorial.description}
                    </Typography>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Stack>
  );
}
