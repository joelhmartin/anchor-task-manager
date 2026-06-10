import { useState, useEffect, useCallback } from 'react';
import {
  Box, Stepper, Step, StepLabel, StepButton,
  CircularProgress, Typography
} from '@mui/material';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import {
  getTrackingConfig, createTrackingConfig, updateTrackingConfig
} from 'api/tracking';

import ClientTypeStep from './tracking/ClientTypeStep';
import GtmContainerStep from './tracking/GtmContainerStep';
import ConversionEventsStep from './tracking/ConversionEventsStep';
import InstallStatusStep from './tracking/InstallStatusStep';

const STEPS = [
  'Tracking Mode',
  'GTM Container',
  'Conversion Events',
  'Install & Status',
];

export default function TrackingWizard({ clientId }) {
  const { showToast } = useToast();
  const [activeStep, setActiveStep] = useState(0);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getTrackingConfig(clientId);
      setConfig(data.config || null);
      // If config already exists, advance past step 0 to avoid re-entering type
      if (data.config) {
        setActiveStep((prev) => (prev === 0 ? 1 : prev));
      }
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to load tracking config'), 'error');
    } finally {
      setLoading(false);
    }
  }, [clientId, showToast]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Shared save function passed to each step.
  // Creates if no config exists yet, otherwise updates.
  const saveConfig = useCallback(async (fields) => {
    if (config) {
      const data = await updateTrackingConfig(config.id, fields);
      setConfig(data.config);
      return data.config;
    } else {
      const data = await createTrackingConfig({ ...fields, user_id: clientId });
      setConfig(data.config);
      return data.config;
    }
  }, [config, clientId]);

  const handleNext = () => setActiveStep((s) => Math.min(s + 1, STEPS.length - 1));
  const handleBack = () => setActiveStep((s) => Math.max(s - 1, 0));
  const handleReload = () => loadConfig();

  const stepProps = { config, saveConfig, onNext: handleNext, onBack: handleBack, onReload: handleReload, clientId, userId: clientId };

  const stepComponents = [
    <ClientTypeStep key="type" {...stepProps} />,
    <GtmContainerStep key="gtm" {...stepProps} />,
    <ConversionEventsStep key="conversions" {...stepProps} />,
    <InstallStatusStep key="status" {...stepProps} />,
  ];

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Stepper activeStep={activeStep} orientation="horizontal" sx={{ mb: 4 }} nonLinear={!!config}>
        {STEPS.map((label, index) => (
          <Step key={label} completed={config && index < activeStep}>
            <StepButton
              onClick={() => config && setActiveStep(index)}
              disabled={!config && index > activeStep}
            >
              <StepLabel>
                <Typography variant="body2">{label}</Typography>
              </StepLabel>
            </StepButton>
          </Step>
        ))}
      </Stepper>

      <Box>{stepComponents[activeStep]}</Box>
    </Box>
  );
}
