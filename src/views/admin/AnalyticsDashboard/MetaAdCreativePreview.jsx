import { useState } from 'react';
import { Box, Typography, Button } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ImageNotSupportedIcon from '@mui/icons-material/ImageNotSupported';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import MetaAdPreviewDialog from './MetaAdPreviewDialog';

const CTA_LABELS = {
  LEARN_MORE: 'Learn More',
  SIGN_UP: 'Sign Up',
  SHOP_NOW: 'Shop Now',
  BOOK_NOW: 'Book Now',
  CONTACT_US: 'Contact Us',
  GET_OFFER: 'Get Offer',
  GET_QUOTE: 'Get Quote',
  SUBSCRIBE: 'Subscribe',
  SEND_MESSAGE: 'Send Message',
  CALL_NOW: 'Call Now',
  APPLY_NOW: 'Apply Now',
  DOWNLOAD: 'Download',
  WATCH_MORE: 'Watch More',
  NO_BUTTON: null
};

function formatCTA(raw) {
  if (!raw) return null;
  return CTA_LABELS[raw] || raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function MetaAdCreativePreview({ creative, compact = false, userId }) {
  if (!creative) return null;

  const [imgFailed, setImgFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const { imageUrl, thumbnailUrl, headline, body, callToAction, isVideo } = creative;
  const imgSrc = imageUrl || thumbnailUrl;
  const ctaLabel = formatCTA(callToAction);
  const imgSize = compact ? 120 : 180;

  const handleImageClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (imgSrc && !imgFailed) setLightboxOpen(true);
  };

  return (
    <>
      <Box sx={{ display: 'flex', gap: 1.5, minWidth: 0 }}>
        {/* Image / Video Thumbnail */}
        <Box
          onClick={handleImageClick}
          sx={{
            width: imgSize,
            height: imgSize,
            minWidth: imgSize,
            borderRadius: 1,
            overflow: 'hidden',
            bgcolor: 'grey.100',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            cursor: imgSrc && !imgFailed ? 'zoom-in' : 'default',
            '&:hover .zoom-icon': { opacity: 1 }
          }}
        >
          {imgSrc && !imgFailed ? (
            <>
              <Box
                component="img"
                src={imgSrc}
                alt={headline || 'Ad creative'}
                sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={() => setImgFailed(true)}
              />
              {isVideo && (
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: 'rgba(0,0,0,0.3)',
                    borderRadius: 1
                  }}
                >
                  <PlayArrowIcon sx={{ color: 'white', fontSize: 48 }} />
                </Box>
              )}
              {/* Zoom hint overlay */}
              <Box
                className="zoom-icon"
                sx={{
                  position: 'absolute',
                  bottom: 4,
                  right: 4,
                  bgcolor: 'rgba(0,0,0,0.5)',
                  borderRadius: '50%',
                  width: 28,
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0,
                  transition: 'opacity 0.2s'
                }}
              >
                <ZoomInIcon sx={{ color: 'white', fontSize: 18 }} />
              </Box>
            </>
          ) : (
            <ImageNotSupportedIcon sx={{ color: 'grey.400', fontSize: 40 }} />
          )}
        </Box>

        {/* Text + CTA */}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          {headline && (
            <Typography variant="subtitle2" noWrap sx={{ mb: 0.25 }}>
              {headline}
            </Typography>
          )}
          {!compact && body && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {body}
            </Typography>
          )}
          {ctaLabel && (
            <Button size="small" variant="outlined" sx={{ textTransform: 'none', pointerEvents: 'none', mt: 0.5 }}>
              {ctaLabel} →
            </Button>
          )}
        </Box>
      </Box>

      <MetaAdPreviewDialog open={lightboxOpen} onClose={() => setLightboxOpen(false)} creative={creative} userId={userId} />
    </>
  );
}
