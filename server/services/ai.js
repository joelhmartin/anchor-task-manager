import { VertexAI } from '@google-cloud/vertexai';
import { Compute } from 'google-auth-library';

const DEFAULT_MODEL = process.env.VERTEX_MODEL || 'gemini-2.5-flash';
const DEFAULT_LOCATION = process.env.GOOGLE_CLOUD_REGION || process.env.VERTEX_LOCATION || 'us-central1';
const VERTEX_SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];
const DEFAULT_SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
];

let vertexInstance = null;
let cachedProject = null;
let cachedLocation = null;
const modelCache = new Map();

function getProjectId() {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_PROJECT_ID;
}

function isCloudRunRuntime() {
  return Boolean(process.env.K_SERVICE || process.env.K_REVISION);
}

function ensureVertexInstance(project, location) {
  if (!vertexInstance || cachedProject !== project || cachedLocation !== location) {
    // Vertex AI client uses google-auth-library under the hood. In local dev,
    // authorized_user ADC (application_default_credentials.json) typically
    // requires explicit scopes to mint access tokens. Cloud Run service accounts
    // work without this, which is why prod can succeed while local fails.
    const googleAuthOptions = isCloudRunRuntime()
      ? {
          // Cloud Run may set GOOGLE_APPLICATION_CREDENTIALS for other services
          // such as GA4. Force Vertex onto the runtime identity instead.
          authClient: new Compute({
            serviceAccountEmail: 'default',
            scopes: VERTEX_SCOPES
          })
        }
      : {
          scopes: VERTEX_SCOPES
        };
    if (!isCloudRunRuntime() && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      googleAuthOptions.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }

    vertexInstance = new VertexAI({ project, location, googleAuthOptions });
    cachedProject = project;
    cachedLocation = location;
    modelCache.clear();
  }
  return vertexInstance;
}

function getGenerativeModel(modelName = DEFAULT_MODEL) {
  const project = getProjectId();
  if (!project) {
    throw new Error('Vertex AI is not configured. Set GOOGLE_CLOUD_PROJECT (or VERTEX_PROJECT_ID).');
  }
  const location = DEFAULT_LOCATION;
  const instance = ensureVertexInstance(project, location);
  if (!modelCache.has(modelName)) {
    const createModel =
      typeof instance.preview?.getGenerativeModel === 'function'
        ? instance.preview.getGenerativeModel.bind(instance.preview)
        : instance.getGenerativeModel.bind(instance);
    modelCache.set(modelName, createModel({ model: modelName }));
  }
  return modelCache.get(modelName);
}

function sanitizeResponse(text = '') {
  let output = text.trim();
  if (output.startsWith('```')) {
    output = output.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '').trim();
  }
  return output;
}

export async function generateAiResponse(args, maybeOptions = {}) {
  const options = typeof args === 'string' ? { ...maybeOptions, prompt: args } : (args || {});
  const {
    prompt,
    systemPrompt = 'You are a helpful assistant.',
    temperature = 0.7,
    topP = null,
    topK = null,
    candidateCount = null,
    maxTokens = 800,
    model = DEFAULT_MODEL,
    responseMimeType = null,
    responseSchema = null,
    safetySettings = DEFAULT_SAFETY_SETTINGS,
    returnMetadata = false
  } = options;
  if (!prompt) {
    throw new Error('Prompt is required for AI generation');
  }

  const generativeModel = getGenerativeModel(model);
  const contents = [
    {
      role: 'user',
      parts: [{ text: prompt }]
    }
  ];

  const generationConfig = {
    temperature,
    maxOutputTokens: maxTokens
  };
  if (topP != null) generationConfig.topP = topP;
  if (topK != null) generationConfig.topK = topK;
  if (candidateCount != null) generationConfig.candidateCount = candidateCount;
  if (responseMimeType) generationConfig.responseMimeType = responseMimeType;
  if (responseSchema) generationConfig.responseSchema = responseSchema;

  const result = await generativeModel.generateContent({
    contents,
    ...(systemPrompt
      ? {
          systemInstruction: {
            role: 'system',
            parts: [{ text: systemPrompt }]
          }
        }
      : {}),
    generationConfig,
    safetySettings
  });

  const candidate = result?.response?.candidates?.[0];
  const text = candidate?.content?.parts
    ?.map((part) => part.text || part.inlineData || '')
    .join('')
    .trim();
  if (!text) {
    console.warn('[vertex:empty-response]', {
      modelUsed: model,
      project: getProjectId(),
      location: DEFAULT_LOCATION,
      candidateCount: result?.response?.candidates?.length || 0,
      promptPreview: prompt.slice(0, 200),
      systemPreview: (systemPrompt || '').slice(0, 120)
    });
    throw new Error('AI response was empty');
  }
  const output = sanitizeResponse(text);
  if (!returnMetadata) return output;
  return {
    text: output,
    metadata: {
      model,
      project: getProjectId(),
      location: DEFAULT_LOCATION,
      finishReason: candidate?.finishReason || null,
      safetyRatings: candidate?.safetyRatings || [],
      usageMetadata: result?.response?.usageMetadata || null
    }
  };
}
