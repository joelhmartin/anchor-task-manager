import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Dialog, IconButton, Box, Typography, Link, CircularProgress } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FacebookPostPreview from 'ui-component/extended/FacebookPostPreview';
import { fetchMetaAdVideoSource } from 'api/analytics';

function absoluteFacebookUrl(permalink) {
  if (!permalink) return null;
  return permalink.startsWith('http') ? permalink : `https://www.facebook.com${permalink}`;
}

/**
 * Facebook feed-style lightbox for a Meta ad creative.
 *
 * Shared between the single-client Meta Ads view and the group
 * Top Performing Creatives row so both click-to-preview experiences
 * render the exact same popup. Card itself is FacebookPostPreview;
 * this just wraps it in a Dialog with the "Sponsored" framing.
 *
 * For video creatives the playable source is fetched lazily on open
 * (it is an expiring CDN URL, so we resolve it on demand rather than at
 * list-load) and rendered as an inline <video>. If Meta exposes no source
 * (e.g. some Reels), we fall back to the static poster plus a permalink.
 */
export default function MetaAdPreviewDialog({ open, onClose, creative, userId }) {
  const [videoSrc, setVideoSrc] = useState(null);
  const [permalinkUrl, setPermalinkUrl] = useState(null);
  const [loadingVideo, setLoadingVideo] = useState(false);

  const adId = creative?.adId;
  const wantsVideo = open && !!creative?.isVideo && !!adId && !!userId;

  useEffect(() => {
    if (!wantsVideo) {
      setLoadingVideo(false);
      setVideoSrc(null);
      setPermalinkUrl(null);
      return undefined;
    }

    let cancelled = false;
    setLoadingVideo(true);
    setVideoSrc(null);
    setPermalinkUrl(null);

    fetchMetaAdVideoSource(userId, adId)
      .then((data) => {
        if (cancelled) return;
        setVideoSrc(data?.source || null);
        setPermalinkUrl(data?.permalinkUrl || null);
      })
      .catch(() => {
        if (!cancelled) {
          setVideoSrc(null);
          setPermalinkUrl(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingVideo(false);
      });

    return () => {
      cancelled = true;
    };
  }, [wantsVideo, userId, adId]);

  if (!creative) return null;

  const fbUrl = absoluteFacebookUrl(permalinkUrl);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      scroll="body"
      onClick={(e) => e.stopPropagation()}
      PaperProps={{ sx: { borderRadius: 2, overflow: 'visible', maxWidth: 380, my: 2 } }}
      slotProps={{ backdrop: { sx: { bgcolor: 'rgba(0,0,0,0.7)' } } }}
    >
      <IconButton
        onClick={onClose}
        size="small"
        sx={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 1,
          bgcolor: 'rgba(0,0,0,0.05)',
          '&:hover': { bgcolor: 'rgba(0,0,0,0.1)' }
        }}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
      <FacebookPostPreview creative={creative} videoSrc={videoSrc} />
      {creative.isVideo && loadingVideo && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, py: 1 }}>
          <CircularProgress size={16} />
          <Typography variant="caption" color="text.secondary">
            Loading video…
          </Typography>
        </Box>
      )}
      {creative.isVideo && !loadingVideo && !videoSrc && fbUrl && (
        <Box sx={{ px: 2, py: 1, textAlign: 'center' }}>
          <Link href={fbUrl} target="_blank" rel="noopener noreferrer" variant="caption">
            Watch this video on Facebook
          </Link>
        </Box>
      )}
    </Dialog>
  );
}

MetaAdPreviewDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  userId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  creative: PropTypes.shape({
    imageUrl: PropTypes.string,
    thumbnailUrl: PropTypes.string,
    headline: PropTypes.string,
    body: PropTypes.string,
    callToAction: PropTypes.string,
    isVideo: PropTypes.bool,
    adId: PropTypes.string,
    linkUrl: PropTypes.string
  })
};
