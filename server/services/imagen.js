import axios from 'axios';

function getProjectId() {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_PROJECT_ID;
}

function getLocation() {
  return process.env.GOOGLE_CLOUD_REGION || process.env.VERTEX_LOCATION || 'us-central1';
}

/**
 * Generate an image using Vertex AI Imagen via the Prediction REST API.
 * Returns { mimeType, bytesBase64Encoded }.
 */
export async function generateImagenImage({
  prompt,
  aspectRatio = '16:9',
  sampleCount = 1,
  model = process.env.VERTEX_IMAGEN_MODEL || 'imagen-3.0-generate-001'
}) {
  if (!prompt) throw new Error('Missing prompt');
  const project = getProjectId();
  if (!project) throw new Error('Vertex AI is not configured. Set GOOGLE_CLOUD_PROJECT (or VERTEX_PROJECT_ID).');
  const location = getLocation();

  // google-auth-library is already used elsewhere in the repo; import lazily to keep startup light
  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = tokenResponse?.token || tokenResponse;
  if (!token) throw new Error('Unable to obtain Google access token for Vertex AI');

  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predict`;

  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount,
      aspectRatio
    }
  };

  const resp = await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    timeout: 120000
  });

  const prediction = resp?.data?.predictions?.[0];
  const bytesBase64Encoded = prediction?.bytesBase64Encoded || prediction?.bytes || null;
  const mimeType = prediction?.mimeType || 'image/png';

  if (!bytesBase64Encoded) {
    throw new Error('Imagen returned no image bytes');
  }

  return { mimeType, bytesBase64Encoded };
}


