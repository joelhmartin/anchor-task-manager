/**
 * AI Form Builder Service
 *
 * Uses Vertex AI (Gemini) to generate form schemas from natural language descriptions.
 */

import { generateAiResponse } from './ai.js';

const SYSTEM_PROMPT = `You are an expert form builder assistant. When the user describes a form they want, you generate a valid form schema JSON.

FIELD TYPES (use only these):
Input fields: text, email, phone, number, url, textarea, hidden
Choice fields: select, radio, checkbox, consent
Layout fields: heading, paragraph, divider
Special: score_display

FIELD SCHEMA:
Each field must have this structure:
{
  "type": "text",           // One of the types above
  "label": "Full Name",      // Display label
  "name": "full_name",       // Machine name (snake_case, no spaces)
  "required": false,         // Boolean
  "placeholder": "",         // Placeholder text (for input fields)
  "helpText": "",            // Help text shown below field
  "defaultValue": "",        // Default value
  "width": "full",           // full | half | third | quarter
  "labelStyle": "inherit",   // inherit | above | floating | hidden
  "conditions": [],          // Conditional visibility rules (leave empty)
  "conditionLogic": "all"    // all | any
}

FIELD-SPECIFIC PROPERTIES:
- select, radio, checkbox: add "options" array of { "label": "...", "value": "...", "score": 0 }
- consent: add "consentText" string
- number: add "min", "max", "step" (null if not needed)
- heading: add "content" string (the heading text)
- paragraph: add "content" string (the paragraph text)
- hidden: use "defaultValue" for the value

CTM CORE FIELD NAMES (use these exact names when applicable):
- caller_name → contact's name
- email → email address
- phone → phone number

STYLE SCHEMA:
{
  "labelStyle": "above",     // above | floating | hidden
  "colorScheme": "light",    // light | dark
  "primaryColor": "#007bff",
  "backgroundColor": "#ffffff",
  "formMaxWidth": 480,
  "borderRadius": 4,
  "fieldSpacing": 16,
  "submitLabel": "Submit"
}

OUTPUT FORMAT:
Return ONLY valid JSON (no markdown, no explanation) with this structure:
{
  "fields": [ ... ],
  "style": { ... }
}

RULES:
1. Use snake_case for all field names
2. Use CTM core field names when the field matches (caller_name, email, phone)
3. Make email and phone required by default
4. Use appropriate field types (email for email, phone for phone, textarea for messages)
5. Use half width for name + email or first_name + last_name side by side
6. Add a heading field at the top if the form has a clear title
7. Keep forms concise — typically 4-8 fields
8. For service/category selection, use select or radio (radio for 2-4 options, select for more)
9. Set reasonable placeholders`;

/**
 * Generate a form schema from a natural language description.
 *
 * @param {string} prompt - User's description of the form they want
 * @param {object} options - { formType? }
 * @returns {object} { fields, style } — valid schema_json
 */
export async function generateFormFromPrompt(prompt, options = {}) {
  const { formType = 'conversion' } = options;

  const userPrompt = `Create a ${formType} form based on this description: ${prompt}`;

  const response = await generateAiResponse({
    prompt: userPrompt,
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.5,
    maxTokens: 2000
  });

  // Parse the JSON response
  let schema;
  try {
    // Strip any markdown code fences
    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '').trim();
    }
    schema = JSON.parse(cleaned);
  } catch (parseErr) {
    throw new Error(`AI returned invalid JSON: ${parseErr.message}`);
  }

  // Validate basic structure
  if (!schema.fields || !Array.isArray(schema.fields)) {
    throw new Error('AI response missing fields array');
  }

  // Add unique IDs to fields
  schema.fields = schema.fields.map((field, i) => ({
    ...field,
    id: `f_ai_${Date.now().toString(36)}${i}`
  }));

  return {
    fields: schema.fields,
    style: schema.style || {}
  };
}
