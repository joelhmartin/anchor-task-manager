import Box from '@mui/material/Box';
import StepIcon from '@mui/material/StepIcon';
import anchorIconBlue from 'assets/images/Anchor Icon Blue.svg';

export default function AnchorStepIcon(props) {
  const { active } = props;

  // Use default MUI behavior for non-active steps (numbers + completed checkmark).
  if (!active) {
    return <StepIcon {...props} />;
  }

  return (
    <Box
      sx={{
        position: 'relative',
        width: 34,
        height: 34,
        transform: 'scale(1.12)',
        transformOrigin: 'center',
        '@keyframes anchorPulse': {
          '0%': { transform: 'translate(-50%, -50%) scale(0.85)', opacity: 0.55 },
          '70%': { transform: 'translate(-50%, -50%) scale(1.55)', opacity: 0 },
          '100%': { transform: 'translate(-50%, -50%) scale(1.55)', opacity: 0 }
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 40,
          height: 40,
          borderRadius: '50%',
          backgroundColor: 'rgba(33, 150, 243, 0.18)',
          transform: 'translate(-50%, -50%) scale(0.85)',
          animation: 'anchorPulse 1.6s ease-out infinite'
        },
        '&::after': {
          content: '""',
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 40,
          height: 40,
          borderRadius: '50%',
          border: '1px solid rgba(33, 150, 243, 0.35)',
          transform: 'translate(-50%, -50%) scale(0.85)',
          animation: 'anchorPulse 1.6s ease-out infinite'
        }
      }}
    >
      <Box
        component="img"
        src={anchorIconBlue}
        alt=""
        sx={{
          position: 'relative',
          zIndex: 1,
          width: 34,
          height: 34,
          display: 'block',
          filter: 'drop-shadow(0 2px 6px rgba(33,150,243,0.35))'
        }}
      />
    </Box>
  );
}


