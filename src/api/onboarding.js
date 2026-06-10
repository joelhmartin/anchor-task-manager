import client from './client';

export function fetchOnboarding(token) {
  return client.get(`/onboarding/${token}`).then((res) => res.data);
}

export function fetchOnboardingMe() {
  return client.get('/onboarding/me').then((res) => res.data);
}

export function submitOnboarding(token, payload) {
  return client.post(`/onboarding/${token}`, payload).then((res) => res.data);
}

export function submitOnboardingMe(payload) {
  return client.post('/onboarding/me/submit', payload).then((res) => res.data);
}

export function saveOnboardingDraft(token, draft) {
  return client.post(`/onboarding/${token}/draft`, { draft }).then((res) => res.data);
}

export function saveOnboardingDraftMe(draft) {
  return client.post('/onboarding/me/draft', { draft }).then((res) => res.data);
}

export function activateOnboardingFromToken(token, payload) {
  return client.post(`/onboarding/${token}/activate`, payload).then((res) => res.data);
}

export function uploadOnboardingAvatar(token, file) {
  const formData = new FormData();
  formData.append('avatar', file);
  return client.post(`/onboarding/${token}/avatar`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
}

export function uploadOnboardingAvatarMe(file) {
  const formData = new FormData();
  formData.append('avatar', file);
  return client.post(`/onboarding/me/avatar`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
}

export function uploadOnboardingBrandAsset(token, file) {
  const formData = new FormData();
  formData.append('brand_assets', file);
  formData.append('asset_kind', 'logo');
  return client.post(`/onboarding/${token}/brand-assets`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
}

export function uploadOnboardingBrandAssets(token, files, { kind = 'logo' } = {}) {
  const formData = new FormData();
  Array.from(files || []).forEach((f) => formData.append('brand_assets', f));
  formData.append('asset_kind', kind);
  return client.post(`/onboarding/${token}/brand-assets`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
}

export function uploadOnboardingBrandAssetsMe(files, { kind = 'logo' } = {}) {
  const formData = new FormData();
  Array.from(files || []).forEach((f) => formData.append('brand_assets', f));
  formData.append('asset_kind', kind);
  return client.post(`/onboarding/me/brand-assets`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
}

export function deleteOnboardingBrandAsset(token, assetId) {
  return client.delete(`/onboarding/${token}/brand-assets/${assetId}`).then((res) => res.data);
}

export function deleteOnboardingBrandAssetMe(assetId) {
  return client.delete(`/onboarding/me/brand-assets/${assetId}`).then((res) => res.data);
}

export function uploadOnboardingDisplayLogo(token, file) {
  const formData = new FormData();
  formData.append('logo', file);
  return client
    .post(`/onboarding/${token}/brand-assets/display-logo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    .then((res) => res.data.display_logo);
}

export function uploadOnboardingDisplayLogoMe(file) {
  const formData = new FormData();
  formData.append('logo', file);
  return client
    .post('/onboarding/me/brand-assets/display-logo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    .then((res) => res.data.display_logo);
}

export function deleteOnboardingDisplayLogo(token) {
  return client
    .delete(`/onboarding/${token}/brand-assets/display-logo`)
    .then((res) => res.data.display_logo);
}

export function deleteOnboardingDisplayLogoMe() {
  return client
    .delete('/onboarding/me/brand-assets/display-logo')
    .then((res) => res.data.display_logo);
}
