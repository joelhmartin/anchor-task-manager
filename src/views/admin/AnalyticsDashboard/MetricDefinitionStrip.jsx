import PropTypes from 'prop-types';
import { Accordion, AccordionDetails, AccordionSummary, Box, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

export default function MetricDefinitionStrip({ title = 'What do these numbers mean?', items = [], sx = null }) {
  const theme = useTheme();
  if (!items.length) return null;

  // Single brand-teal accent used throughout — no per-metric color coding.
  const accent = theme.palette.primary.dark;
  const bg = alpha(accent, 0.06);
  const border = alpha(accent, 0.18);

  return (
    <Accordion
      disableGutters
      elevation={0}
      square={false}
      sx={{
        bgcolor: bg,
        border: `1px solid ${border}`,
        borderRadius: 2,
        '&:before': { display: 'none' },
        ...sx
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon sx={{ color: accent }} />}
        sx={{
          px: 2,
          minHeight: 48,
          '& .MuiAccordionSummary-content': { my: 1, alignItems: 'center', gap: 1 },
          '&.Mui-expanded': { minHeight: 48 }
        }}
      >
        <InfoOutlinedIcon fontSize="small" sx={{ color: accent }} />
        <Typography variant="body2" fontWeight={600}>
          {title}
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 2, pt: 2, pb: 2 }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            columnGap: 3,
            rowGap: 2
          }}
        >
          {items.map((item) => (
            <Stack key={item.label} spacing={0.5}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ color: accent }}>
                {item.label}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {item.definition}
              </Typography>
            </Stack>
          ))}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

MetricDefinitionStrip.propTypes = {
  title: PropTypes.string,
  sx: PropTypes.object,
  items: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      definition: PropTypes.string.isRequired
    })
  )
};
