const TMJ_AND_SLEEP_SERVICES = [
  'TMJ',
  'CPAP',
  'Sleep Apnea',
  'Appliance',
  'Pediatric',
  'Nightlase',
  'Sleep Study',
  'Nuvola',
  'Botox',
  'Oral Surgery'
];

// ─────────────────────────────────────────────────────────────────────────────
// CONCERN PRESETS BY SUBTYPE
// ───────────────────────────────────────────────────────────────-──────────────

// Medical - TMJ & Sleep
export const TMJ_AND_SLEEP_CONCERNS = [
  'Jaw Pain',
  'Snoring',
  'Clenching',
  'Headaches',
  'Sleep Apnea',
  'Jaw Popping',
  'Teeth Grinding',
  'Locked Jaw',
  'Insomnia',
  'Ear Pain',
  'Tinnitus / Ringing',
  'Clicking',
  'Neck Pain',
  'Fatigue',
  'Difficulty Sleeping',
  'CPAP Issues'
];

// Medical - Dental
export const DENTAL_CONCERNS = [
  'Tooth Pain',
  'Cavity',
  'Broken Tooth',
  'Missing Teeth',
  'Crooked Teeth',
  'Gum Disease',
  'Bleeding Gums',
  'Bad Breath',
  'Teeth Whitening',
  'Tooth Sensitivity',
  'Wisdom Teeth',
  'Dental Emergency',
  'Cosmetic Concerns',
  'Braces / Aligners'
];

// Medical - Med Spa
export const MED_SPA_CONCERNS = [
  'Wrinkles',
  'Fine Lines',
  'Acne Scars',
  'Sun Damage',
  'Uneven Skin Tone',
  'Sagging Skin',
  'Stubborn Fat',
  'Unwanted Hair',
  'Age Spots',
  'Cellulite',
  'Dull Skin',
  'Large Pores',
  'Rosacea',
  'Stretch Marks'
];

// Medical - Chiropractic
export const CHIROPRACTIC_CONCERNS = [
  'Back Pain',
  'Neck Pain',
  'Sciatica',
  'Poor Posture',
  'Sports Injury',
  'Headaches',
  'Shoulder Pain',
  'Hip Pain',
  'Muscle Tension',
  'Limited Mobility',
  'Herniated Disc',
  'Whiplash',
  'Pregnancy Discomfort',
  'Joint Stiffness'
];

// Home Service - Roofing
export const ROOFING_CONCERNS = [
  'Roof Leak',
  'Storm Damage',
  'Missing Shingles',
  'Hail Damage',
  'Old Roof',
  'Roof Inspection',
  'Insurance Claim',
  'Gutter Issues',
  'Ice Dam',
  'Sagging Roof',
  'Ventilation Problems',
  'Skylight Leak',
  'Flashing Damage',
  'Moss / Algae Growth'
];

// Home Service - Plumbing
export const PLUMBING_CONCERNS = [
  'Clogged Drain',
  'Leaky Faucet',
  'No Hot Water',
  'Water Heater Issue',
  'Low Water Pressure',
  'Running Toilet',
  'Sewer Backup',
  'Pipe Leak',
  'Frozen Pipes',
  'Garbage Disposal',
  'Water Bill High',
  'Gas Line Issue',
  'Sump Pump',
  'Water Quality'
];

// Home Service - HVAC
export const HVAC_CONCERNS = [
  'AC Not Cooling',
  'Furnace Not Heating',
  'Strange Noises',
  'High Energy Bills',
  'Uneven Temperatures',
  'Thermostat Issues',
  'Poor Air Quality',
  'Bad Smell',
  'Unit Not Starting',
  'Refrigerant Leak',
  'Ductwork Issues',
  'Seasonal Tune-Up',
  'New System Quote',
  'Emergency Repair'
];

// Home Service - Landscaping / Hardscaping
export const LANDSCAPING_CONCERNS = [
  'Lawn Care',
  'Overgrown Yard',
  'New Landscape Design',
  'Patio Installation',
  'Retaining Wall',
  'Drainage Issues',
  'Tree Removal',
  'Irrigation System',
  'Outdoor Lighting',
  'Fence Installation',
  'Mulch / Rock Beds',
  'Sod Installation',
  'Seasonal Cleanup',
  'Driveway / Walkway'
];

// Food Service
export const FOOD_SERVICE_CONCERNS = [
  'Catering Quote',
  'Event Planning',
  'Menu Questions',
  'Dietary Restrictions',
  'Group Reservation',
  'Private Event',
  'Delivery Issue',
  'Order Problem',
  'Feedback / Complaint',
  'Gift Cards',
  'Hours / Location',
  'Job Inquiry'
];

// General / Other
export const GENERAL_CONCERNS = [
  'Pricing / Quote',
  'Availability',
  'Service Area',
  'Emergency Service',
  'Follow-Up',
  'Rescheduling',
  'Billing Question',
  'Insurance',
  'Warranty',
  'Complaint',
  'General Inquiry'
];

export const CLIENT_CONCERN_PRESETS = {
  // Medical
  tmj_sleep: TMJ_AND_SLEEP_CONCERNS,
  dental: DENTAL_CONCERNS,
  med_spa: MED_SPA_CONCERNS,
  chiropractic: CHIROPRACTIC_CONCERNS,
  // Home Service
  roofing: ROOFING_CONCERNS,
  plumbing: PLUMBING_CONCERNS,
  hvac: HVAC_CONCERNS,
  landscaping: LANDSCAPING_CONCERNS,
  // Food Service
  food_service: FOOD_SERVICE_CONCERNS,
  // General / Other
  other: GENERAL_CONCERNS
};

export const CLIENT_TYPE_PRESETS = [
  {
    value: 'medical',
    label: 'Medical',
    subtypes: [
      {
        value: 'dental',
        label: 'Dental',
        services: [
          'Dental Exam',
          'Teeth Whitening',
          'Dental Implants',
          'Root Canal Therapy',
          'Invisalign',
          'Crowns & Bridges',
          'Emergency Dentistry',
          'Pediatric Dentistry',
          'Cosmetic Dentistry',
          'Periodontal Therapy'
        ]
      },
      {
        value: 'tmj_sleep',
        label: 'TMJ & Sleep Therapy',
        services: TMJ_AND_SLEEP_SERVICES
      },
      {
        value: 'med_spa',
        label: 'Med Spa',
        services: [
          'Botox & Fillers',
          'Microneedling',
          'Laser Hair Removal',
          'Hydrafacial',
          'Chemical Peel',
          'CoolSculpting',
          'IPL Photofacial',
          'Body Contouring'
        ]
      },
      {
        value: 'chiropractic',
        label: 'Chiropractic',
        services: [
          'Spinal Adjustment',
          'Posture Correction',
          'Sports Injury Rehab',
          'Prenatal Chiropractic',
          'Massage Therapy',
          'Corrective Exercises',
          'Neck & Back Pain Relief'
        ]
      }
    ]
  },
  {
    value: 'home_service',
    label: 'Home Service',
    subtypes: [
      {
        value: 'roofing',
        label: 'Roofing',
        services: [
          'Roof Inspection',
          'Roof Repair',
          'Roof Replacement',
          'Storm Damage Repair',
          'Gutter Installation',
          'Skylight Installation'
        ]
      },
      {
        value: 'plumbing',
        label: 'Plumbing',
        services: [
          'Drain Cleaning',
          'Water Heater Repair',
          'Tankless Water Heater Install',
          'Pipe Replacement',
          'Leak Detection',
          'Sewer Line Repair'
        ]
      },
      {
        value: 'hvac',
        label: 'HVAC',
        services: [
          'AC Installation',
          'AC Repair',
          'Furnace Installation',
          'Furnace Repair',
          'Heat Pump Service',
          'Duct Cleaning',
          'Seasonal Tune-Up'
        ]
      },
      {
        value: 'landscaping',
        label: 'Landscaping / Hardscaping',
        services: [
          'Landscape Design',
          'Lawn Maintenance',
          'Patio & Pavers',
          'Retaining Walls',
          'Outdoor Lighting',
          'Irrigation Systems',
          'Tree & Shrub Care',
          'Sod Installation',
          'Hardscape Construction',
          'Seasonal Cleanup'
        ]
      }
    ]
  },
  {
    value: 'food_service',
    label: 'Food Service',
    subtypes: []
  },
  {
    value: 'other',
    label: 'Other',
    subtypes: []
  }
];

export function findClientTypePreset(value) {
  return CLIENT_TYPE_PRESETS.find((preset) => preset.value === value);
}

const envPrompt =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_DEFAULT_AI_PROMPT) ||
  (typeof process !== 'undefined' && process.env?.VITE_DEFAULT_AI_PROMPT);

// Note: Category definitions are always appended server-side in classifyContent()
// This base prompt should focus on business context and tone only
export const AI_PROMPT_BASE =
  envPrompt ||
  'You are an assistant that classifies call transcripts for service businesses. Analyze the conversation to determine caller intent and provide a brief summary.';

const formatServiceLine = (services = []) => {
  const cleaned = services.filter(Boolean);
  if (!cleaned.length) return '';
  return `Services include ${cleaned.join(', ')}.`;
};

const promptFor = (typeLabel, services = []) =>
  `${AI_PROMPT_BASE} Focus the tone and examples on ${typeLabel} clients. ${formatServiceLine(services)}`;

function collectServices(typeValue, subtypeValue) {
  const typeEntry = CLIENT_TYPE_PRESETS.find((entry) => entry.value === typeValue);
  if (!typeEntry) return [];
  if (subtypeValue) {
    const subtypeEntry = typeEntry.subtypes?.find((sub) => sub.value === subtypeValue);
    if (subtypeEntry?.services?.length) {
      return subtypeEntry.services;
    }
  }
  return typeEntry.subtypes?.flatMap((sub) => sub.services || []) || [];
}

export const CLIENT_AI_PROMPTS = {
  medical: {
    description: 'medical practices',
    default: promptFor('medical practices', collectServices('medical')),
    dental: promptFor('dental clinics', collectServices('medical', 'dental')),
    tmj_sleep: promptFor('TMJ & Sleep Therapy centers', collectServices('medical', 'tmj_sleep')),
    med_spa: promptFor('medical spas', collectServices('medical', 'med_spa')),
    chiropractic: promptFor('chiropractic care studios', collectServices('medical', 'chiropractic'))
  },
  home_service: {
    description: 'home services',
    default: promptFor('home service businesses', collectServices('home_service')),
    roofing: promptFor('roofing contractors', collectServices('home_service', 'roofing')),
    plumbing: promptFor('plumbing companies', collectServices('home_service', 'plumbing')),
    hvac: promptFor('HVAC firms', collectServices('home_service', 'hvac')),
    landscaping: promptFor('landscaping and hardscaping companies', collectServices('home_service', 'landscaping'))
  },
  food_service: {
    description: 'food and hospitality businesses',
    default: promptFor('food service operations', collectServices('food_service'))
  },
  other: {
    description: 'other business types',
    default:
      `${AI_PROMPT_BASE} This is a custom business type.` +
      ' Business type: {{business_type}}. Core services: {{services}}. Target audience: {{audience}}.'
  }
};

export function getAiPromptForClient(type = 'medical', subtype) {
  const typeGroup = CLIENT_AI_PROMPTS[type] || CLIENT_AI_PROMPTS.medical;
  if (subtype && typeGroup[subtype]) {
    return typeGroup[subtype];
  }
  return typeGroup.default;
}
