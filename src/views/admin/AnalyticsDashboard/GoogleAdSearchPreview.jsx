import { Box, Typography } from '@mui/material';

const GOOGLE_BLUE = '#1a0dab';
const GOOGLE_GREEN = '#006621';
const GOOGLE_GREY = '#4d5156';
const SPONSORED_GREY = '#5f6368';

function buildDisplayUrl(domain, path1, path2) {
  if (!domain) return '';
  const parts = [domain];
  if (path1) parts.push(path1);
  if (path2) parts.push(path2);
  return parts.join(' › ');
}

export default function GoogleAdSearchPreview({ ad, compact = false }) {
  if (!ad) return null;

  const headlines = ad.headlinesList?.length
    ? ad.headlinesList
    : (ad.headlines ? ad.headlines.split(' | ').filter(Boolean) : []);
  const descriptions = ad.descriptionsList?.length
    ? ad.descriptionsList
    : (ad.descriptions ? ad.descriptions.split(' | ').filter(Boolean) : []);

  const headlineText = headlines.slice(0, 3).join(' · ');
  const descriptionText = descriptions.slice(0, 2).join(' ');
  const displayUrl = buildDisplayUrl(ad.displayDomain, ad.path1, ad.path2);

  if (!headlineText && !descriptionText) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
        No ad copy available
      </Typography>
    );
  }

  return (
    <Box
      sx={{
        fontFamily: 'arial, sans-serif',
        maxWidth: compact ? 380 : 600,
        p: compact ? 1 : 1.5,
        borderRadius: 1,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider'
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <Box
          sx={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            bgcolor: 'grey.200',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 700,
            color: SPONSORED_GREY
          }}
        >
          {ad.displayDomain?.[0]?.toUpperCase() || 'A'}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            component="div"
            sx={{ fontSize: 12, fontWeight: 700, color: SPONSORED_GREY, lineHeight: 1.2 }}
          >
            Sponsored
          </Typography>
          {displayUrl && (
            <Typography
              component="div"
              noWrap
              sx={{ fontSize: 12, color: GOOGLE_GREEN, lineHeight: 1.2 }}
            >
              {displayUrl}
            </Typography>
          )}
        </Box>
      </Box>

      {headlineText && (
        <Typography
          component="div"
          sx={{
            fontSize: compact ? 16 : 20,
            lineHeight: 1.3,
            color: GOOGLE_BLUE,
            fontWeight: 400,
            mb: 0.5,
            display: '-webkit-box',
            WebkitLineClamp: compact ? 1 : 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}
        >
          {headlineText}
        </Typography>
      )}

      {descriptionText && (
        <Typography
          component="div"
          sx={{
            fontSize: compact ? 12 : 14,
            lineHeight: 1.4,
            color: GOOGLE_GREY,
            display: '-webkit-box',
            WebkitLineClamp: compact ? 2 : 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}
        >
          {descriptionText}
        </Typography>
      )}
    </Box>
  );
}
