import { useState } from 'react';
import { Alert, Box, Button, Chip, Container, Paper, Stack, Step, StepLabel, Stepper, Typography } from '@mui/material';
import AnchorStepIcon from 'ui-component/extended/AnchorStepIcon';
import { useToast } from 'contexts/ToastContext';

import ProfileStep from './steps/ProfileStep';
import BrandStep from './steps/BrandStep';
import ServicesStep from './steps/ServicesStep';
import WebsiteAccessStep from './steps/WebsiteAccessStep';
import Ga4Step from './steps/Ga4Step';
import GoogleAdsStep from './steps/GoogleAdsStep';
import MetaStep from './steps/MetaStep';
import FormsStep from './steps/FormsStep';

const STEP_CONFIG = [
  { key: 'profile', label: 'Login Details', description: 'These details let you come back anytime and access your dashboard later.' },
  { key: 'brand', label: 'Business & Brand', description: 'Share what you can — best guesses are totally fine.' },
  { key: 'services', label: 'Services to Promote', description: 'This helps us prioritize content and tracking. You can change this later.' },
  { key: 'website_access', label: 'Website Info & Access', description: 'If someone else manages this, you can loop them in later.' },
  { key: 'ga4', label: 'Google Analytics (GA4)', description: "If you're unsure, choose \"Not sure\"." },
  { key: 'google_ads', label: 'Google Ads (If Applicable)', description: 'Only complete this if you run or plan to run Google Ads.' },
  { key: 'meta', label: 'Facebook & Instagram (Meta)', description: 'If you advertise (or plan to), this helps connect tracking and campaigns.' },
  { key: 'forms', label: 'Contact & Lead Forms', description: 'These are the forms visitors use to contact you, book, or request info.' }
];

const MOCK_DATA = {
  user: { id: 'preview', email: 'jane@example.com', first_name: 'Jane', last_name: 'Smith', avatar_url: '', has_password: false },
  profile: { client_type: 'dental', client_subtype: 'dental', monthly_revenue_goal: '' },
  brand: { business_name: 'Smile Dental Studio', business_description: '', primary_brand_colors: '', brand_notes: '', website_url: 'https://smiledentalstudio.com' },
  brand_assets: []
};

export default function OnboardingPreview() {
  const toast = useToast();
  const [activeStep, setActiveStep] = useState(0);
  const [form, setForm] = useState({
    display_name: 'Jane Smith',
    email: 'jane@example.com',
    monthly_revenue_goal: '',
    call_tracking_main_number: '',
    front_desk_emails: '',
    office_admin_name: '',
    office_admin_email: '',
    office_admin_phone: '',
    form_email_recipients: '',
    password: '',
    password_confirm: '',
    brand: MOCK_DATA.brand,
    avatar_url: ''
  });
  const [data, setData] = useState(MOCK_DATA);
  const [serviceList, setServiceList] = useState([
    { name: 'Teeth Whitening', active: true, isDefault: true },
    { name: 'Root Canal', active: true, isDefault: true }
  ]);
  const [customServiceName, setCustomServiceName] = useState('');
  const [access, setAccess] = useState({
    website_access_status: '', website_access_provided: false, website_access_understood: false,
    ga4_access_status: '', ga4_access_provided: false, ga4_access_understood: false,
    google_ads_access_status: '', google_ads_access_provided: false, google_ads_access_understood: false, google_ads_account_id: '',
    meta_access_status: '', meta_access_provided: false, meta_access_understood: false,
    website_forms_details_status: '', website_forms_details_provided: false, website_forms_details_understood: false,
    website_forms_uses_third_party: false, website_forms_uses_hipaa: false, website_forms_connected_crm: false, website_forms_custom: false, website_forms_notes: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState('');

  const currentStep = STEP_CONFIG[activeStep];
  const isLastStep = activeStep === STEP_CONFIG.length - 1;

  const setAccessStatus = (statusKey, statusValue, mapping) => {
    setAccess((prev) => ({
      ...prev,
      [statusKey]: statusValue,
      ...(typeof mapping === 'function' ? mapping(statusValue, prev) : {})
    }));
  };

  const defaultOptions = ['Teeth Whitening', 'Root Canal', 'Dental Implants', 'Invisalign', 'Veneers'];
  const isDefaultChecked = (name) => serviceList.some((s) => s.name.toLowerCase() === name.toLowerCase() && s.active);
  const handleToggleDefaultService = (name) => {
    const idx = serviceList.findIndex((s) => s.name.toLowerCase() === name.toLowerCase());
    if (idx >= 0) {
      setServiceList((prev) => prev.filter((_, i) => i !== idx));
    } else {
      setServiceList((prev) => [...prev, { name, active: true, isDefault: true }]);
    }
  };
  const handleServiceChange = (index, field, value) => {
    setServiceList((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  };
  const handleRemoveService = (index) => {
    setServiceList((prev) => prev.filter((_, i) => i !== index));
  };
  const handleCustomServiceAdd = () => {
    const clean = customServiceName.trim();
    if (!clean) return;
    setServiceList((prev) => [...prev, { name: clean, active: true, isDefault: false }]);
    setCustomServiceName('');
  };

  const noopUpload = async () => ({ data: {} });
  const noopDelete = async () => ({});

  const renderStepContent = () => {
    switch (currentStep?.key) {
      case 'profile':
        return (
          <ProfileStep
            token="preview"
            data={data}
            form={form}
            setForm={setForm}
            submitting={false}
            avatarPreviewUrl={avatarPreviewUrl}
            setAvatarPreviewUrl={setAvatarPreviewUrl}
            uploadAvatar={noopUpload}
            toast={toast}
            getErrorMessage={(err, fallback) => err?.message || fallback}
            showPassword={showPassword}
            showConfirmPassword={showConfirmPassword}
            onTogglePassword={() => setShowPassword((p) => !p)}
            onToggleConfirmPassword={() => setShowConfirmPassword((p) => !p)}
            onMouseDownPassword={(e) => e.preventDefault()}
            strength={0}
            level={{ label: '', color: '' }}
            onChangePassword={() => {}}
          />
        );
      case 'brand':
        return (
          <BrandStep
            token="preview"
            data={data}
            setData={setData}
            form={form}
            setForm={setForm}
            submitting={false}
            uploadingLogo={false}
            setUploadingLogo={() => {}}
            logoUploadError=""
            setLogoUploadError={() => {}}
            uploadingStyleGuide={false}
            setUploadingStyleGuide={() => {}}
            styleGuideUploadError=""
            setStyleGuideUploadError={() => {}}
            removingBrandAssetId=""
            setRemovingBrandAssetId={() => {}}
            uploadBrandAssets={noopUpload}
            deleteBrandAsset={noopDelete}
            onClearMessages={() => {}}
            toast={toast}
            getErrorMessage={(err, fallback) => err?.message || fallback}
          />
        );
      case 'services':
        return (
          <ServicesStep
            defaultOptions={defaultOptions}
            isDefaultChecked={isDefaultChecked}
            handleToggleDefaultService={handleToggleDefaultService}
            customServiceName={customServiceName}
            setCustomServiceName={setCustomServiceName}
            handleCustomServiceKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCustomServiceAdd(); } }}
            handleCustomServiceAdd={handleCustomServiceAdd}
            serviceList={serviceList}
            handleServiceChange={handleServiceChange}
            handleRemoveService={handleRemoveService}
            clientType="dental"
            clientSubtype="dental"
          />
        );
      case 'website_access':
        return <WebsiteAccessStep access={access} setAccessStatus={setAccessStatus} />;
      case 'ga4':
        return <Ga4Step access={access} setAccessStatus={setAccessStatus} />;
      case 'google_ads':
        return <GoogleAdsStep access={access} setAccess={setAccess} setAccessStatus={setAccessStatus} />;
      case 'meta':
        return <MetaStep access={access} setAccessStatus={setAccessStatus} />;
      case 'forms':
        return <FormsStep access={access} setAccess={setAccess} setAccessStatus={setAccessStatus} />;
      default:
        return null;
    }
  };

  return (
    <Container maxWidth="md" sx={{ my: 6 }}>
      <Alert severity="info" sx={{ mb: 3 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip label="PREVIEW" size="small" color="info" />
          <Typography variant="body2">
            This is a preview of the onboarding form. No data will be saved. Navigate between steps to review the look and feel.
          </Typography>
        </Stack>
      </Alert>

      <Paper elevation={2} sx={{ p: { xs: 3, md: 4 } }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="h1" gutterBottom>
              Welcome to Anchor
            </Typography>
            <Typography variant="body1" color="text.secondary">
              We&apos;ll take you through a few quick steps to personalize your dashboard. You can always revisit these details later in the
              client portal.
            </Typography>
          </Box>

          <Stepper
            activeStep={activeStep}
            alternativeLabel
            sx={{
              pt: 1,
              '& .MuiStepLabel-label.Mui-active': { fontWeight: 700, transform: 'scale(1.03)' },
              '& .MuiStepLabel-labelContainer': { transformOrigin: 'center' }
            }}
          >
            {STEP_CONFIG.map((step) => (
              <Step key={step.key}>
                <StepLabel StepIconComponent={AnchorStepIcon}>{step.label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          <Typography variant="body2" color="text.secondary">
            {currentStep?.description}
          </Typography>

          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: { xs: 2, md: 3 } }}>
            {renderStepContent()}
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="flex-end">
            <Button onClick={() => setActiveStep((p) => Math.max(p - 1, 0))} disabled={activeStep === 0}>
              Back
            </Button>
            <Button variant="outlined" onClick={() => toast.info('Preview mode — drafts are not saved.')}>
              Save &amp; Continue Later
            </Button>
            <Button
              variant="contained"
              size="large"
              onClick={() => {
                if (isLastStep) {
                  toast.success('Preview mode — form would be submitted here.');
                } else {
                  setActiveStep((p) => Math.min(p + 1, STEP_CONFIG.length - 1));
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }}
            >
              {isLastStep ? 'Complete Onboarding' : 'Continue'}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Container>
  );
}
