/**
 * Onboarding Questionnaire Templates
 *
 * Defines type-specific questionnaire sections for each client subtype.
 * These are appended to the standard onboarding flow based on client_type and client_subtype.
 */

// ─────────────────────────────────────────────────────────────────────────────
// DENTAL QUESTIONNAIRE TEMPLATE
// ─────────────────────────────────────────────────────────────────────────────

export const DENTAL_QUESTIONNAIRE = {
  id: 'dental',
  title: 'Dental Market Research & SEO Intake',
  subtitle: 'Help us understand your practice to create the best marketing strategy',
  sections: [
    {
      id: 'practice_overview',
      title: 'Section 1: Practice Overview & Operational Reality',
      fields: [
        {
          id: 'provider_count',
          label: 'How many providers are currently producing (FT / PT / Associate)?',
          type: 'text',
          placeholder: 'e.g., 2 FT, 1 PT'
        },
        {
          id: 'days_open',
          label: 'How many days per week is the practice open?',
          type: 'select',
          options: ['5 days', '6 days', '7 days', '4 days', 'Other']
        },
        {
          id: 'wait_time',
          label: 'Average wait time for a new patient appointment?',
          type: 'select',
          options: ['Same day', '1-3 days', '1 week', '2+ weeks', '1 month+']
        },
        {
          id: 'services_not_grow',
          label: 'Are there services you do not want to grow?',
          type: 'textarea',
          placeholder: 'List any services you want to de-emphasize...'
        },
        {
          id: 'scheduling_method',
          label: 'How are new patients currently scheduled?',
          type: 'multiselect',
          options: ['Phone', 'Online booking', 'Both']
        },
        {
          id: 'online_booking_platform',
          label: 'If they book online, what platform are they using?',
          type: 'text',
          placeholder: 'e.g., LocalMed, Zocdoc, etc.',
          conditional: { field: 'scheduling_method', includes: 'Online booking' }
        },
        {
          id: 'pms_system',
          label: 'Which PMS are you using?',
          type: 'select',
          options: ['Dentrix', 'OpenDental', 'Eaglesoft', 'Curve Dental', 'Denticon', 'Other']
        },
        {
          id: 'pms_other',
          label: 'Please specify your PMS',
          type: 'text',
          conditional: { field: 'pms_system', equals: 'Other' }
        },
        {
          id: 'decision_maker',
          label: 'Who is the primary decision-maker for marketing and website approvals?',
          type: 'text',
          placeholder: 'Name and title'
        },
        {
          id: 'point_of_contact',
          label: 'Who will be our point of contact?',
          type: 'text',
          placeholder: 'Name and title (if different from above)'
        }
      ]
    },
    {
      id: 'revenue_services',
      title: 'Section 2: Revenue, Services & Growth Priorities',
      fields: [
        {
          id: 'top_revenue_procedures',
          label: 'List your top 5 revenue-driving procedures',
          type: 'textarea',
          placeholder: '1.\n2.\n3.\n4.\n5.'
        },
        {
          id: 'highest_margin_procedures',
          label: 'List your highest-margin procedures (even if low volume)',
          type: 'textarea',
          placeholder: 'e.g., Implants, Cosmetic...'
        },
        {
          id: 'growth_priorities',
          label: 'Which services are strategic growth priorities this year?',
          type: 'textarea',
          placeholder: 'List services you want to grow...'
        },
        {
          id: 'services_changes',
          label: 'Any services being added or removed in the next 6-12 months?',
          type: 'textarea',
          placeholder: 'Describe any planned changes...'
        },
        {
          id: 'cash_insurance_mix',
          label: 'Approximate cash vs insurance mix (%)',
          type: 'text',
          placeholder: 'e.g., 30% cash / 70% insurance'
        }
      ]
    },
    {
      id: 'buyer_psychology',
      title: 'Section 3: Buyer Psychology & Case Acceptance',
      fields: [
        {
          id: 'delayed_services',
          label: 'Which services do patients most often delay or hesitate on?',
          type: 'textarea',
          placeholder: 'List services patients hesitate on...'
        },
        {
          id: 'shopping_around',
          label: 'Do patients often shop around or seek second opinions? What procedures do they inquire about most frequently?',
          type: 'textarea'
        },
        {
          id: 'common_objections',
          label: 'Most common objections heard:',
          type: 'multiselect',
          options: ['Cost', 'Fear', 'Time', 'Insurance', 'Trust']
        },
        {
          id: 'treatment_presenter',
          label: 'Who typically presents treatment plans?',
          type: 'select',
          options: ['Doctor', 'Treatment Coordinator', 'Front Desk', 'Combination']
        },
        {
          id: 'financing_offered',
          label: 'Do you offer financing?',
          type: 'select',
          options: ['Yes', 'No']
        },
        {
          id: 'financing_provider',
          label: 'If yes, through whom?',
          type: 'text',
          placeholder: 'e.g., CareCredit, Sunbit, etc.',
          conditional: { field: 'financing_offered', equals: 'Yes' }
        },
        {
          id: 'acceptance_rate',
          label: 'Rough treatment acceptance rate (%)',
          type: 'text',
          placeholder: 'e.g., 65%'
        },
        {
          id: 'value_propositions',
          label: 'What value propositions do you currently offer your customers?',
          type: 'textarea',
          placeholder: 'e.g., Same-day crowns, sedation options, etc.'
        },
        {
          id: 'differentiators',
          label: 'What would make a patient choose you over another practice?',
          type: 'textarea'
        },
        {
          id: 'promotions',
          label: 'Do you run any promotions that change throughout the year? Would you be open to doing them?',
          type: 'textarea'
        }
      ]
    },
    {
      id: 'geographic_targeting',
      title: 'Section 4: Geographic Targeting & Market Footprint',
      fields: [
        {
          id: 'zip_code_data',
          label: 'Can you provide patient totals by zip code file?',
          type: 'select',
          options: ['Yes, I can provide this', 'No, I cannot provide this', 'I need help exporting this']
        },
        {
          id: 'surrounding_areas',
          label: 'What surrounding cities or areas do patients commonly travel from?',
          type: 'textarea',
          placeholder: 'List cities/areas...'
        },
        {
          id: 'excluded_areas',
          label: 'Are there areas you do NOT want to target, even if demand exists?',
          type: 'textarea',
          placeholder: 'List any areas to exclude...'
        }
      ]
    },
    {
      id: 'website_seo',
      title: 'Section 5: Website, SEO & Content Reality',
      fields: [
        {
          id: 'website_goal',
          label: 'What is the primary goal of your website?',
          type: 'multiselect',
          options: ['Calls', 'Appointments', 'Education', 'Brand trust']
        },
        {
          id: 'monthly_leads',
          label: 'Approximate monthly website inquiries/leads?',
          type: 'text',
          placeholder: 'e.g., 20-30 per month'
        },
        {
          id: 'current_assets',
          label: 'Do you currently have:',
          type: 'multiselect',
          options: ['Service pages for core procedures', 'Blog or resource section', 'Educational videos']
        },
        {
          id: 'previous_seo',
          label: 'Have you done SEO or online marketing before? If yes, what kind?',
          type: 'textarea',
          placeholder: 'Describe previous marketing efforts...'
        },
        {
          id: 'priority_services_online',
          label: 'Are there specific services/pages you want prioritized online?',
          type: 'textarea'
        },
        {
          id: 'expertise_highlights',
          label: 'Do you have expertise or points of interest we can highlight?',
          type: 'textarea',
          placeholder: 'e.g., Advanced training, specializations, awards...'
        },
        {
          id: 'professional_media',
          label: 'Do you have professional photos and videos that we can use?',
          type: 'select',
          options: ['Yes', 'No', 'Some, but need more']
        }
      ]
    },
    {
      id: 'competitive_awareness',
      title: 'Section 6: Competitive Awareness',
      fields: [
        {
          id: 'top_competitors',
          label: 'Who do you believe are your top 5 competitors locally?',
          type: 'textarea',
          placeholder: '1.\n2.\n3.\n4.\n5.'
        },
        {
          id: 'losing_to',
          label: 'Are there competitors you lose patients to specifically?',
          type: 'textarea'
        },
        {
          id: 'compete_with',
          label: 'Do you compete more with:',
          type: 'multiselect',
          options: ['GPs (General Dentists)', 'Specialists']
        },
        {
          id: 'competitor_marketing_opinion',
          label: 'What do you like or dislike about your competitors\' marketing?',
          type: 'textarea'
        },
        {
          id: 'competitor_keywords',
          label: 'Any keywords or services you believe competitors "own"?',
          type: 'textarea',
          placeholder: 'e.g., "implants near me", "emergency dentist"...'
        }
      ]
    },
    {
      id: 'reputation',
      title: 'Section 7: Reputation & Brand Sensitivity',
      fields: [
        {
          id: 'reputation_platforms',
          label: 'Any reputation platforms you are concerned about?',
          type: 'textarea',
          placeholder: 'e.g., Google, Yelp, Healthgrades...'
        },
        {
          id: 'request_reviews',
          label: 'Do you actively request Google reviews? How?',
          type: 'textarea',
          placeholder: 'Describe your review request process...'
        },
        {
          id: 'reputation_incidents',
          label: 'Any past reputation incidents we should know about?',
          type: 'textarea',
          placeholder: 'Optional - describe any issues...'
        },
        {
          id: 'provider_visibility',
          label: 'Are providers comfortable being visible in marketing?',
          type: 'select',
          options: ['Yes, all providers', 'Some providers', 'No, prefer practice-focused']
        }
      ]
    },
    {
      id: 'marketing_channels',
      title: 'Section 8: Marketing Channels',
      fields: [
        {
          id: 'current_channels',
          label: 'What channels are currently in use?',
          type: 'multiselect',
          options: ['Google Ads', 'SEO', 'Social Media', 'Email', 'Direct Mail', 'Print', 'TV', 'Radio', 'Other']
        },
        {
          id: 'channels_other',
          label: 'Please specify other channels',
          type: 'text',
          conditional: { field: 'current_channels', includes: 'Other' }
        }
      ]
    },
    {
      id: 'growth_goals',
      title: 'Section 9: Growth Goals & Success Definition',
      fields: [
        {
          id: 'primary_goal',
          label: 'Primary goal for next 12 months?',
          type: 'textarea',
          placeholder: 'Describe your main goal...'
        },
        {
          id: 'growth_aggressiveness',
          label: 'How aggressive should growth be?',
          type: 'select',
          options: ['Conservative', 'Moderate', 'Aggressive']
        },
        {
          id: 'success_definition',
          label: 'What would make you say "this is working" in 120 days?',
          type: 'textarea',
          placeholder: 'Describe what success looks like...'
        }
      ]
    },
    {
      id: 'final_constraints',
      title: 'Section 10: Final Constraints & Non-Negotiables',
      fields: [
        {
          id: 'services_not_advertise',
          label: 'Any services you will not advertise?',
          type: 'textarea',
          placeholder: 'List any services to exclude from marketing...'
        },
        {
          id: 'additional_notes',
          label: 'Anything else we should know?',
          type: 'textarea',
          placeholder: 'Any other information that would help us serve you better...'
        }
      ]
    }
  ]
};

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE REGISTRY
// Maps client_type/client_subtype to their questionnaire templates
// ─────────────────────────────────────────────────────────────────────────────

export const ONBOARDING_TEMPLATES = {
  // Medical subtypes
  medical: {
    dental: DENTAL_QUESTIONNAIRE,
    tmj_sleep: null, // To be added
    med_spa: null, // To be added
    chiropractic: null // To be added
  },
  // Home Service subtypes
  home_service: {
    roofing: null, // To be added
    plumbing: null, // To be added
    hvac: null, // To be added
    landscaping: null // To be added
  },
  // Food Service (no subtypes currently)
  food_service: null,
  // Other
  other: null
};

/**
 * Get the onboarding questionnaire template for a given client type/subtype
 * @param {string} clientType - The client type (e.g., 'medical', 'home_service')
 * @param {string} clientSubtype - The client subtype (e.g., 'dental', 'hvac')
 * @returns {object|null} The questionnaire template or null if none exists
 */
export function getOnboardingTemplate(clientType, clientSubtype) {
  if (!clientType) return null;

  const typeTemplates = ONBOARDING_TEMPLATES[clientType];
  if (!typeTemplates) return null;

  // If typeTemplates is not an object (no subtypes), return it directly
  if (typeof typeTemplates !== 'object' || typeTemplates === null) {
    return typeTemplates;
  }

  // Look up subtype template
  if (clientSubtype && typeTemplates[clientSubtype]) {
    return typeTemplates[clientSubtype];
  }

  return null;
}

/**
 * Check if a client type/subtype has a custom questionnaire
 * @param {string} clientType
 * @param {string} clientSubtype
 * @returns {boolean}
 */
export function hasCustomQuestionnaire(clientType, clientSubtype) {
  return getOnboardingTemplate(clientType, clientSubtype) !== null;
}
