import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, CircularProgress, Container, Paper, Stack, Step, StepLabel, Stepper, Typography, Button } from '@mui/material';

import {
  fetchOnboarding,
  fetchOnboardingMe,
  submitOnboardingMe,
  saveOnboardingDraft,
  saveOnboardingDraftMe,
  activateOnboardingFromToken,
  uploadOnboardingAvatar,
  uploadOnboardingAvatarMe,
  uploadOnboardingBrandAssets,
  uploadOnboardingBrandAssetsMe,
  deleteOnboardingBrandAsset,
  deleteOnboardingBrandAssetMe,
  uploadOnboardingDisplayLogo,
  uploadOnboardingDisplayLogoMe,
  deleteOnboardingDisplayLogo,
  deleteOnboardingDisplayLogoMe
} from 'api/onboarding';
import useAuth from 'hooks/useAuth';
import { clientLabel } from 'hooks/useClientLabel';
import { findClientTypePreset } from 'constants/clientPresets';
import { getOnboardingTemplate } from 'constants/onboardingTemplates';
import { strengthColor, strengthIndicator } from 'utils/password-strength';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import AnchorStepIcon from 'ui-component/extended/AnchorStepIcon';
import FireworksCanvas from 'ui-component/FireworksCanvas';

import ProfileStep from './steps/ProfileStep';
import BrandStep from './steps/BrandStep';
import ServicesStep from './steps/ServicesStep';
import WebsiteAccessStep from './steps/WebsiteAccessStep';
import Ga4Step from './steps/Ga4Step';
import GoogleAdsStep from './steps/GoogleAdsStep';
import MetaStep from './steps/MetaStep';
import FormsStep from './steps/FormsStep';
import TypeSpecificQuestionnaire from './steps/TypeSpecificQuestionnaire';

const emptyService = () => ({ name: '', active: true, isDefault: false });
const CALENDAR_LINK = 'https://calendar.app.google/zgRn9gFuVizsnMmM9';
const BASE_STEP_CONFIG = [
  { key: 'profile', label: 'Login Details', description: 'These details let you come back anytime and access your dashboard later.' },
  { key: 'brand', label: 'Business & Brand', description: 'Share what you can — best guesses are totally fine.' },
  {
    key: 'services',
    label: 'Services to Promote',
    description: 'This helps us prioritize content and tracking. You can change this later.'
  }
];

const ACCESS_STEP_CONFIG = [
  { key: 'website_access', label: 'Website Info & Access', description: 'If someone else manages this, you can loop them in later.' },
  { key: 'ga4', label: 'Google Analytics (GA4)', description: 'If you’re unsure, choose “Not sure”.' },
  { key: 'google_ads', label: 'Google Ads (If Applicable)', description: 'Only complete this if you run or plan to run Google Ads.' },
  {
    key: 'meta',
    label: 'Facebook & Instagram (Meta)',
    description: 'If you advertise (or plan to), this helps connect tracking and campaigns.'
  },
  {
    key: 'forms',
    label: 'Contact & Lead Forms',
    description: 'These are the forms visitors use to contact you, book, or request info.'
  }
];

const DEFAULT_ACCESS_REQUIREMENTS = {
  requires_website_access: true,
  requires_ga4_access: true,
  requires_google_ads_access: true,
  requires_meta_access: true,
  requires_forms_step: true
};

const buildStepConfig = (requirements = DEFAULT_ACCESS_REQUIREMENTS, questionnaireTemplate = null) => {
  const steps = [...BASE_STEP_CONFIG];
  ACCESS_STEP_CONFIG.forEach((step) => {
    const flagKey = step.key === 'forms' ? 'requires_forms_step' : `requires_${step.key}_access`;
    const enabled = requirements?.[flagKey];
    if (enabled !== false) {
      steps.push(step);
    }
  });
  // Add type-specific questionnaire step if template exists
  if (questionnaireTemplate) {
    steps.push({
      key: 'questionnaire',
      label: 'Market Research & SEO',
      description: questionnaireTemplate.subtitle || 'Please complete these additional questions specific to your business type.'
    });
  }
  return steps;
};

const getDefaultServices = (profile) => {
  if (!profile?.client_type) return [];
  const preset = findClientTypePreset(profile.client_type);
  if (!preset) return [];
  const subtype = preset.subtypes?.find((item) => item.value === profile.client_subtype);
  return subtype?.services || [];
};

const LOCAL_DRAFT_TTL_MS = 60 * 60 * 1000; // 1 hour
const LOCAL_DRAFT_ME_KEY = 'anchor:onboarding:draft:me';
const localDraftKeyForToken = (token) => `anchor:onboarding:draft:token:${token}`;
const localDraftKeyForUser = (userId) => `anchor:onboarding:draft:user:${userId}`;

export default function ClientOnboardingPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user: authUser, setAuthState, refreshUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [data, setData] = useState(null);
  const [activeStep, setActiveStep] = useState(0);
  const [accessRequirements, setAccessRequirements] = useState(DEFAULT_ACCESS_REQUIREMENTS);
  const [stepConfig, setStepConfig] = useState(buildStepConfig(DEFAULT_ACCESS_REQUIREMENTS));
  const [form, setForm] = useState({
    display_name: '',
    email: '',
    monthly_revenue_goal: '',
    call_tracking_main_number: '',
    front_desk_emails: '',
    office_admin_name: '',
    office_admin_email: '',
    office_admin_phone: '',
    form_email_recipients: '',
    password: '',
    password_confirm: '',
    brand: {},
    avatar_url: ''
  });
  const [serviceList, setServiceList] = useState([]);
  const [successMessage, setSuccessMessage] = useState('');
  const [completeOpen, setCompleteOpen] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState('');
  useEffect(() => {
    return () => {
      if (avatarPreviewUrl && typeof URL !== 'undefined') {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
    };
  }, [avatarPreviewUrl]);
  const [logoUploadError, setLogoUploadError] = useState('');
  const [styleGuideUploadError, setStyleGuideUploadError] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingStyleGuide, setUploadingStyleGuide] = useState(false);
  const [removingBrandAssetId, setRemovingBrandAssetId] = useState('');
  const [defaultOptions, setDefaultOptions] = useState([]);
  const [questionnaireTemplate, setQuestionnaireTemplate] = useState(null);
  const [questionnaireValues, setQuestionnaireValues] = useState({});
  const [access, setAccess] = useState({
    website_access_status: '',
    website_access_provided: false,
    website_access_understood: false,
    ga4_access_status: '',
    ga4_access_provided: false,
    ga4_access_understood: false,
    google_ads_access_status: '',
    google_ads_access_provided: false,
    google_ads_access_understood: false,
    google_ads_account_id: '',
    meta_access_status: '',
    meta_access_provided: false,
    meta_access_understood: false,
    website_forms_details_status: '',
    website_forms_details_provided: false,
    website_forms_details_understood: false,
    website_forms_uses_third_party: false,
    website_forms_uses_hipaa: false,
    website_forms_connected_crm: false,
    website_forms_custom: false,
    website_forms_notes: ''
  });
  const [customServiceName, setCustomServiceName] = useState('');

  const isLastStep = activeStep === stepConfig.length - 1;
  const currentStep = stepConfig[activeStep];
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [strength, setStrength] = useState(0);
  const [level, setLevel] = useState();

  const readLocalDraft = useCallback((key) => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const savedAt = Number(parsed?.saved_at || 0);
      const draft = parsed?.draft || null;
      if (!savedAt || !draft) return null;
      if (Date.now() - savedAt > LOCAL_DRAFT_TTL_MS) {
        window.localStorage.removeItem(key);
        return null;
      }
      return { draft, saved_at: savedAt };
    } catch {
      return null;
    }
  }, []);

  const writeLocalDraft = useCallback((key, draft) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          saved_at: Date.now(),
          draft
        })
      );
    } catch {
      // ignore quota errors
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    setStrength(strengthIndicator(''));
    setLevel(strengthColor(strengthIndicator('')));
    const fetcher = token ? () => fetchOnboarding(token) : () => fetchOnboardingMe();
    fetcher()
      .then((payload) => {
        setData(payload);
        const defaultServiceNames = getDefaultServices(payload.profile);
        setDefaultOptions(defaultServiceNames);
        const defaultNameSet = new Set(defaultServiceNames.map((name) => name.toLowerCase()));
        const initialName = clientLabel(payload.user);
        // Don't pre-populate placeholder emails - user must enter their real email
        const isPlaceholderEmail = (payload.user.email || '').includes('@placeholder.anchor');
        const initialEmail = isPlaceholderEmail ? '' : (payload.user.email || '');
        const presetBrand = {
          business_name: payload.brand?.business_name || '',
          business_description: payload.brand?.business_description || '',
          primary_brand_colors: payload.brand?.primary_brand_colors || '',
          brand_notes: payload.brand?.brand_notes || '',
          website_url: payload.brand?.website_url || ''
        };
        const baseForm = {
          display_name: initialName,
          email: initialEmail,
          monthly_revenue_goal: payload.profile?.monthly_revenue_goal || '',
          call_tracking_main_number: payload.profile?.call_tracking_main_number || '',
          front_desk_emails: payload.profile?.front_desk_emails || '',
          office_admin_name: payload.profile?.office_admin_name || '',
          office_admin_email: payload.profile?.office_admin_email || '',
          office_admin_phone: payload.profile?.office_admin_phone || '',
          form_email_recipients: payload.profile?.form_email_recipients || '',
          brand: presetBrand,
          avatar_url: payload.user?.avatar_url || ''
        };

        const serverDraft = payload.profile?.onboarding_draft_json || null;
        const localCandidates = [];
        if (token) localCandidates.push(readLocalDraft(localDraftKeyForToken(token)));
        if (payload?.user?.id) localCandidates.push(readLocalDraft(localDraftKeyForUser(payload.user.id)));
        localCandidates.push(readLocalDraft(LOCAL_DRAFT_ME_KEY));
        const localBest = localCandidates.filter(Boolean).sort((a, b) => Number(b.saved_at || 0) - Number(a.saved_at || 0))[0];
        const draft = localBest?.draft || serverDraft;

        const draftForm = draft?.form ? { ...draft.form } : null;
        if (draftForm) {
          // Never persist passwords in drafts
          delete draftForm.password;
          delete draftForm.password_confirm;
        }

        setForm((prev) => ({
          ...prev,
          ...baseForm,
          ...(draftForm || {})
        }));
        const nextRequirements = {
          requires_website_access: payload.profile?.requires_website_access !== false,
          requires_ga4_access: payload.profile?.requires_ga4_access !== false,
          requires_google_ads_access: payload.profile?.requires_google_ads_access !== false,
          requires_meta_access: payload.profile?.requires_meta_access !== false,
          requires_forms_step: payload.profile?.requires_forms_step !== false
        };
        setAccessRequirements(nextRequirements);

        // Get questionnaire template based on client type
        const template = getOnboardingTemplate(payload.profile?.client_type, payload.profile?.client_subtype);
        setQuestionnaireTemplate(template);

        // Load existing questionnaire values from API or draft
        const savedQuestionnaire = payload.profile?.onboarding_questionnaire || {};
        const draftQuestionnaire = draft?.questionnaireValues || {};
        setQuestionnaireValues({ ...savedQuestionnaire, ...draftQuestionnaire });

        const nextSteps = buildStepConfig(nextRequirements, template);
        setStepConfig(nextSteps);
        const draftStep = Number.isFinite(Number(draft?.activeStep)) ? Number(draft.activeStep) : 0;
        setActiveStep(Math.max(0, Math.min(draftStep, nextSteps.length - 1)));
        setAccess((prev) => ({
          ...prev,
          website_access_status: payload.profile?.website_access_status || '',
          website_access_provided: payload.profile?.website_access_provided || false,
          website_access_understood: payload.profile?.website_access_understood || false,
          ga4_access_status: payload.profile?.ga4_access_status || '',
          ga4_access_provided: payload.profile?.ga4_access_provided || false,
          ga4_access_understood: payload.profile?.ga4_access_understood || false,
          google_ads_access_status: payload.profile?.google_ads_access_status || '',
          google_ads_access_provided: payload.profile?.google_ads_access_provided || false,
          google_ads_access_understood: payload.profile?.google_ads_access_understood || false,
          google_ads_account_id: payload.profile?.google_ads_account_id || '',
          meta_access_status: payload.profile?.meta_access_status || '',
          meta_access_provided: payload.profile?.meta_access_provided || false,
          meta_access_understood: payload.profile?.meta_access_understood || false,
          website_forms_details_status: payload.profile?.website_forms_details_status || '',
          website_forms_details_provided: payload.profile?.website_forms_details_provided || false,
          website_forms_details_understood: payload.profile?.website_forms_details_understood || false,
          website_forms_uses_third_party: payload.profile?.website_forms_uses_third_party || false,
          website_forms_uses_hipaa: payload.profile?.website_forms_uses_hipaa || false,
          website_forms_connected_crm: payload.profile?.website_forms_connected_crm || false,
          website_forms_custom: payload.profile?.website_forms_custom || false,
          website_forms_notes: payload.profile?.website_forms_notes || ''
        }));
        if (draft?.access) {
          setAccess((prev) => ({ ...prev, ...(draft.access || {}) }));
        }
        const initialServices = (payload.services && payload.services.length ? payload.services : []).map((s) => ({
          id: s.id,
          name: s.name || '',
          active: s.active !== false,
          isDefault: defaultNameSet.has((s.name || '').toLowerCase())
        }));
        // Deduplicate by lowercase name — prefer active entry, otherwise last wins
        const dedup = (list) => {
          const map = new Map();
          for (const s of list) {
            const key = (s.name || '').toLowerCase();
            if (!key) continue;
            const existing = map.get(key);
            if (!existing || (s.active && !existing.active)) map.set(key, s);
          }
          return [...map.values()];
        };
        const rawServices = Array.isArray(draft?.services) ? draft.services : initialServices;
        setServiceList(dedup(rawServices));
      })
      .catch((err) => {
        const msg = getErrorMessage(err, 'Unable to load onboarding details');
        setError(msg);
        toast.error(msg);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const allServicesValid = useMemo(() => serviceList.every((service) => !service.name || service.name.trim().length > 0), [serviceList]);

  const addServiceByName = useCallback((name, options = {}) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    setServiceList((prev) => {
      if (prev.some((service) => (service.name || '').toLowerCase() === clean.toLowerCase())) {
        return prev;
      }
      return [
        ...prev,
        {
          ...emptyService(),
          name: clean,
          isDefault: options.isDefault || false
        }
      ];
    });
  }, []);

  const removeServiceByName = useCallback((name) => {
    const target = String(name || '').toLowerCase();
    setServiceList((prev) => prev.filter((service) => (service.name || '').toLowerCase() !== target));
  }, []);

  const handleServiceChange = (index, key, value) => {
    setServiceList((prev) =>
      prev.map((service, idx) => {
        if (idx !== index) return service;
        if (key === 'name' && service.isDefault) {
          return service;
        }
        return { ...service, [key]: value };
      })
    );
  };

  const changePassword = (value) => {
    const temp = strengthIndicator(value);
    setStrength(temp);
    setLevel(strengthColor(temp));
    setForm((prev) => ({ ...prev, password: value }));
  };

  const handleRemoveService = (index) => {
    setServiceList((prev) => prev.filter((_, idx) => idx !== index));
  };

  const isDefaultChecked = useCallback(
    (name) => serviceList.some((service) => (service.name || '').toLowerCase() === String(name || '').toLowerCase()),
    [serviceList]
  );

  const handleToggleDefaultService = (name) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    if (isDefaultChecked(clean)) {
      removeServiceByName(clean);
    } else {
      addServiceByName(clean, { isDefault: true });
    }
  };

  const handleCustomServiceAdd = () => {
    const clean = customServiceName.trim();
    if (!clean) return;
    addServiceByName(clean);
    setCustomServiceName('');
  };

  const handleCustomServiceKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleCustomServiceAdd();
    }
  };

  const handleTogglePassword = () => setShowPassword((prev) => !prev);
  const handleToggleConfirmPassword = () => setShowConfirmPassword((prev) => !prev);
  const handleMouseDownPassword = (event) => event.preventDefault();

  const setAccessStatus = (statusKey, statusValue, mapping) => {
    setAccess((prev) => ({
      ...prev,
      [statusKey]: statusValue,
      ...(typeof mapping === 'function' ? mapping(statusValue, prev) : {})
    }));
  };

  const clearMessages = useCallback(() => {
    setError('');
    setSuccessMessage('');
  }, []);

  // After step 1, the user is logged in and the token is revoked.
  // Use authenticated endpoints if user is logged in, regardless of token in URL.
  const useTokenEndpoint = token && !authUser;

  const uploadAvatar = useCallback(
    (tokenValue, file) => (useTokenEndpoint ? uploadOnboardingAvatar(tokenValue, file) : uploadOnboardingAvatarMe(file)),
    [useTokenEndpoint]
  );

  const uploadBrandAssets = useCallback(
    (tokenValue, files, options) =>
      useTokenEndpoint ? uploadOnboardingBrandAssets(tokenValue, files, options) : uploadOnboardingBrandAssetsMe(files, options),
    [useTokenEndpoint]
  );

  const deleteBrandAsset = useCallback(
    (tokenValue, assetId) => (useTokenEndpoint ? deleteOnboardingBrandAsset(tokenValue, assetId) : deleteOnboardingBrandAssetMe(assetId)),
    [useTokenEndpoint]
  );

  const uploadDisplayLogoHandler = useCallback(
    (tokenValue, file) => (useTokenEndpoint ? uploadOnboardingDisplayLogo(tokenValue, file) : uploadOnboardingDisplayLogoMe(file)),
    [useTokenEndpoint]
  );

  const deleteDisplayLogoHandler = useCallback(
    (tokenValue) => (useTokenEndpoint ? deleteOnboardingDisplayLogo(tokenValue) : deleteOnboardingDisplayLogoMe()),
    [useTokenEndpoint]
  );

  const validateStep = (stepIndex = activeStep) => {
    const key = stepConfig[stepIndex]?.key;
    if (key === 'profile') {
      if (!form.display_name.trim()) {
        toast.error('Display name is required');
        return false;
      }
      // Email is required if using token endpoint (new account setup)
      if (useTokenEndpoint) {
        if (!form.email.trim()) {
          toast.error('Email is required');
          return false;
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(form.email.trim())) {
          toast.error('Please enter a valid email address');
          return false;
        }
      }
      const hasPassword = Boolean(data?.user?.has_password);
      // Only require password if using token endpoint (not yet logged in) or user has no password
      const mustSetPasswordNow = useTokenEndpoint || !hasPassword;
      if (mustSetPasswordNow) {
        if (!form.password || form.password.length < 8) {
          toast.error('Please choose a password with at least 8 characters');
          return false;
        }
        if (form.password !== form.password_confirm) {
          toast.error('Passwords do not match');
          return false;
        }
      } else if (form.password || form.password_confirm) {
        if (form.password.length < 8) {
          toast.error('Please choose a password with at least 8 characters');
          return false;
        }
        if (form.password !== form.password_confirm) {
          toast.error('Passwords do not match');
          return false;
        }
      }
    }
    if (key === 'services') {
      const hasNamedService = serviceList.some((service) => service.name?.trim());
      if (!hasNamedService) {
        toast.error('Please add at least one service');
        return false;
      }
      if (!allServicesValid) {
        toast.error('Every service must include a name');
        return false;
      }
    }
    if (key === 'website_access') {
      if (!String(access.website_access_status || '').trim()) {
        toast.error('Please confirm website access (provided or understood).');
        return false;
      }
    }
    if (key === 'ga4') {
      if (!String(access.ga4_access_status || '').trim()) {
        toast.error('Please confirm Google Analytics access (provided or understood).');
        return false;
      }
    }
    if (key === 'google_ads') {
      if (!String(access.google_ads_access_status || '').trim()) {
        toast.error('Please confirm Google Ads access (provided or understood).');
        return false;
      }
    }
    if (key === 'meta') {
      if (!String(access.meta_access_status || '').trim()) {
        toast.error('Please confirm Facebook Business Manager access (provided or understood).');
        return false;
      }
    }
    if (key === 'forms') {
      if (!String(access.website_forms_details_status || '').trim()) {
        toast.error('Please confirm forms/integrations details (provided or understood).');
        return false;
      }
      // Notes field is optional - no validation required
    }
    setError('');
    return true;
  };

  const buildDraft = useCallback(() => {
    const safeForm = { ...form };
    delete safeForm.password;
    delete safeForm.password_confirm;
    return {
      activeStep,
      form: safeForm,
      access,
      services: serviceList,
      questionnaireValues
    };
  }, [form, access, serviceList, activeStep, questionnaireValues]);

  const handleSaveDraft = async () => {
    if (!data?.user?.email) return;
    try {
      const draft = buildDraft();
      // Local cache (1 hour) so user can instantly resume even if network is spotty.
      if (token) {
        writeLocalDraft(localDraftKeyForToken(token), draft);
      } else if (data?.user?.id) {
        writeLocalDraft(localDraftKeyForUser(data.user.id), draft);
      } else {
        writeLocalDraft(LOCAL_DRAFT_ME_KEY, draft);
      }
      // Use token endpoint only if not yet logged in
      if (useTokenEndpoint) {
        await saveOnboardingDraft(token, draft);
      } else {
        await saveOnboardingDraftMe(draft);
      }
      toast.success('Saved! You can safely come back later.');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Unable to save your progress'));
    }
  };

  const handleNext = async () => {
    if (!validateStep()) return;
    const key = stepConfig[activeStep]?.key;

    // Step 1 completion: activate account immediately (no redirect, stay on same page).
    // Only do this if we're using the token endpoint (user not yet logged in).
    if (key === 'profile' && useTokenEndpoint) {
      try {
        setSubmitting(true);
        // Save draft first so we can land back on step 2 if they return later.
        await saveOnboardingDraft(token, { ...buildDraft(), activeStep: Math.min(activeStep + 1, stepConfig.length - 1) });
        // Activate returns session tokens directly (bypassing MFA since onboarding token already verified identity)
        const activationResult = await activateOnboardingFromToken(token, { display_name: form.display_name.trim(), password: form.password, email: form.email.trim() });
        // Set auth state directly without calling login (avoids MFA trigger for new devices)
        if (activationResult?.user && activationResult?.accessToken) {
          setAuthState({ user: activationResult.user, accessToken: activationResult.accessToken });
        }
        // No redirect - continue to next step on same page
      } catch (err) {
        toast.error(getErrorMessage(err, 'Unable to activate your account'));
        setSubmitting(false);
        return;
      } finally {
        setSubmitting(false);
      }
    }

    setActiveStep((prev) => Math.min(prev + 1, stepConfig.length - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBack = () => {
    setError('');
    setActiveStep((prev) => Math.max(prev - 1, 0));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async () => {
    if (!validateStep()) return;
    if (!data?.user?.email) return;
    setError('');
    setSuccessMessage('');
    setSubmitting(true);
    try {
      const serviceMap = new Map();
      for (const service of serviceList) {
        const name = (service.name || '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const existing = serviceMap.get(key);
        if (!existing || (service.active && !existing.active)) {
          serviceMap.set(key, { name, active: service.active !== false });
        }
      }
      const sanitizedServices = [...serviceMap.values()];
      if (useTokenEndpoint) {
        // Token flow must activate+login first (step 1). If user somehow reaches submit with a token
        // and hasn't logged in yet, force them back to step 1 to set/reset their password.
        toast.error('Please set your password in step 1 before finishing onboarding.');
        setActiveStep(0);
        return;
      }
      await submitOnboardingMe({
        display_name: form.display_name.trim(),
        password: form.password || undefined,
        monthly_revenue_goal: form.monthly_revenue_goal,
        call_tracking_main_number: form.call_tracking_main_number,
        front_desk_emails: form.front_desk_emails,
        office_admin_name: form.office_admin_name,
        office_admin_email: form.office_admin_email,
        office_admin_phone: form.office_admin_phone,
        form_email_recipients: form.form_email_recipients,
        brand: form.brand,
        services: sanitizedServices,
        onboarding_questionnaire: questionnaireValues,
        ...access
      });
      setSuccessMessage('Information saved!');
      // Clear local cached drafts since onboarding is complete.
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('anchor:onboarding:draft:me');
          if (token) window.localStorage.removeItem(`anchor:onboarding:draft:token:${token}`);
          if (data?.user?.id) window.localStorage.removeItem(`anchor:onboarding:draft:user:${data.user.id}`);
        }
      } catch {}
      // Show completion modal - user stays on this page, no redirect
      setOnboardingComplete(true);
      setCompleteOpen(true);
    } catch (err) {
      const msg = getErrorMessage(err, 'Unable to save onboarding information');
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // Once onboarding is complete, we stay on this page showing the completion modal.
  // The user cannot log back in until their account is activated by an admin.

  const renderProfileStep = () => (
    <ProfileStep
      token={token}
      data={data}
      form={form}
      setForm={setForm}
      submitting={submitting}
      avatarPreviewUrl={avatarPreviewUrl}
      setAvatarPreviewUrl={setAvatarPreviewUrl}
      uploadAvatar={uploadAvatar}
      toast={toast}
      getErrorMessage={getErrorMessage}
      showPassword={showPassword}
      showConfirmPassword={showConfirmPassword}
      onTogglePassword={handleTogglePassword}
      onToggleConfirmPassword={handleToggleConfirmPassword}
      onMouseDownPassword={handleMouseDownPassword}
      strength={strength}
      level={level}
      onChangePassword={changePassword}
    />
  );

  const renderBrandStep = () => (
    <BrandStep
      token={token}
      data={data}
      setData={setData}
      form={form}
      setForm={setForm}
      submitting={submitting}
      uploadingLogo={uploadingLogo}
      setUploadingLogo={setUploadingLogo}
      logoUploadError={logoUploadError}
      setLogoUploadError={setLogoUploadError}
      uploadingStyleGuide={uploadingStyleGuide}
      setUploadingStyleGuide={setUploadingStyleGuide}
      styleGuideUploadError={styleGuideUploadError}
      setStyleGuideUploadError={setStyleGuideUploadError}
      removingBrandAssetId={removingBrandAssetId}
      setRemovingBrandAssetId={setRemovingBrandAssetId}
      uploadBrandAssets={uploadBrandAssets}
      deleteBrandAsset={deleteBrandAsset}
      uploadDisplayLogo={uploadDisplayLogoHandler}
      deleteDisplayLogo={deleteDisplayLogoHandler}
      onClearMessages={clearMessages}
      toast={toast}
      getErrorMessage={getErrorMessage}
    />
  );

  const renderServicesStep = () => (
    <ServicesStep
      defaultOptions={defaultOptions}
      isDefaultChecked={isDefaultChecked}
      handleToggleDefaultService={handleToggleDefaultService}
      customServiceName={customServiceName}
      setCustomServiceName={setCustomServiceName}
      handleCustomServiceKeyDown={handleCustomServiceKeyDown}
      handleCustomServiceAdd={handleCustomServiceAdd}
      serviceList={serviceList}
      handleServiceChange={handleServiceChange}
      handleRemoveService={handleRemoveService}
      clientType={data?.profile?.client_type}
      clientSubtype={data?.profile?.client_subtype}
    />
  );

  const renderWebsiteAccessStep = () => <WebsiteAccessStep access={access} setAccessStatus={setAccessStatus} />;

  const renderGa4Step = () => <Ga4Step access={access} setAccessStatus={setAccessStatus} />;

  const renderGoogleAdsStep = () => <GoogleAdsStep access={access} setAccess={setAccess} setAccessStatus={setAccessStatus} />;

  const renderMetaStep = () => <MetaStep access={access} setAccessStatus={setAccessStatus} />;

  const renderFormsStep = () => <FormsStep access={access} setAccess={setAccess} setAccessStatus={setAccessStatus} />;

  const renderQuestionnaireStep = () => (
    <TypeSpecificQuestionnaire
      template={questionnaireTemplate}
      values={questionnaireValues}
      onChange={setQuestionnaireValues}
    />
  );

  const renderStepContent = () => {
    switch (currentStep?.key) {
      case 'profile':
        return renderProfileStep();
      case 'brand':
        return renderBrandStep();
      case 'services':
        return renderServicesStep();
      case 'website_access':
        return renderWebsiteAccessStep();
      case 'ga4':
        return renderGa4Step();
      case 'google_ads':
        return renderGoogleAdsStep();
      case 'meta':
        return renderMetaStep();
      case 'forms':
        return renderFormsStep();
      case 'questionnaire':
        return renderQuestionnaireStep();
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        <Paper elevation={1} sx={{ p: 4, textAlign: 'center' }}>
          <CircularProgress />
          <Typography sx={{ mt: 2 }}>Loading onboarding information…</Typography>
        </Paper>
      </Container>
    );
  }

  if (error && !data) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        <Paper elevation={1} sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="caption" color="error" sx={{ display: 'block', mb: 2 }}>
            Unable to load onboarding details.
          </Typography>
          <Button variant="contained" onClick={() => navigate('/pages/login')}>
            Go to Login
          </Button>
        </Paper>
      </Container>
    );
  }

  return (
    <>
      {/* Local completion modal is no longer used; completion now redirects to /portal to show the modal over the dashboard. */}
      {completeOpen && (
        <Box sx={{ position: 'fixed', inset: 0, zIndex: 2200 }}>
          {/* Semi-transparent overlay */}
          <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(10, 14, 26, 0.5)', zIndex: 0 }} />

          {/* Fireworks behind popup but above overlay */}
          <FireworksCanvas style={{ zIndex: 1 }} />

          {/* Popup */}
          <Box
            sx={{
              position: 'relative',
              zIndex: 2,
              minHeight: '100vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              p: 2
            }}
          >
            <Paper
              elevation={0}
              sx={{
                width: '100%',
                maxWidth: 560,
                p: { xs: 3, md: 4 },
                borderRadius: 3,
                bgcolor: 'rgba(255,255,255,0.96)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.55)'
              }}
            >
              <Stack spacing={2.25}>
                <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: -0.6 }}>
                  Thank You!
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  We appreciate you taking the time to share these details. Your onboarding form has been received and your account has been
                  created.
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  Our team will now build out your dashboard over the next few days. We&apos;ll send you an email when everything is ready
                  for you to log in and explore.
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                  You may now close this browser window.
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  If you have any questions in the meantime, reply to your onboarding email or reach out to your account manager directly.
                </Typography>
              </Stack>
            </Paper>
          </Box>
        </Box>
      )}

      <Container maxWidth="md" sx={{ my: 6 }}>
        <Paper elevation={2} sx={{ p: { xs: 3, md: 4 } }}>
          <Stack spacing={3}>
            <Box>
              <Typography variant="h1" gutterBottom>
                Welcome to Anchor
              </Typography>
              <Typography variant="body1" color="text.secondary">
                We&apos;ll take you through a few quick steps to personalize your dashboard. You can always revisit these details later in
                the client portal.
              </Typography>
            </Box>

            {/* Errors are toast-only. Keep UI clean during multi-step onboarding. */}
            {successMessage && <Alert severity="success">{successMessage}</Alert>}

            <Stepper
              activeStep={activeStep}
              alternativeLabel
              sx={{
                pt: 1,
                '& .MuiStepLabel-label.Mui-active': { fontWeight: 700, transform: 'scale(1.03)' },
                '& .MuiStepLabel-labelContainer': { transformOrigin: 'center' }
              }}
            >
              {stepConfig.map((step) => (
                <Step key={step.key}>
                  <StepLabel StepIconComponent={AnchorStepIcon}>{step.label}</StepLabel>
                </Step>
              ))}
            </Stepper>

            <Typography variant="body2" color="text.secondary">
              {currentStep?.description}
            </Typography>

            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: { xs: 2, md: 3 } }}>{renderStepContent()}</Box>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="flex-end">
              <Button onClick={handleBack} disabled={activeStep === 0 || submitting}>
                Back
              </Button>
              <Button variant="outlined" onClick={handleSaveDraft} disabled={submitting}>
                Save &amp; Continue Later
              </Button>
              <Button variant="contained" size="large" onClick={isLastStep ? handleSubmit : handleNext} disabled={submitting}>
                {isLastStep ? (submitting ? 'Saving…' : 'Complete Onboarding') : 'Continue'}
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Container>
    </>
  );
}
