-- ============================================================================
-- DEMO ACCOUNT SEED DATA
-- ============================================================================
-- Creates a fully-populated demo client account (Bright Smiles Family Dentistry)
-- with realistic data across all dashboard features:
--   • CRM clients, journeys, services, active clients
--   • Calls + form submissions with full caller enrichment (names, locations,
--     sources, system tags, recordings, transcripts)
--   • Twilio tracking numbers tied to attribution sources
--   • Attribution sessions + per-call attribution rows (gclid/fbclid/UTMs)
--   • CTM forms + form submissions with attribution_json
--   • Reviews, notifications, documents
--
-- The demo account has NO external service credentials (no CTM keys, no Monday
-- board, no OAuth integrations), so all external API calls naturally
-- short-circuit. This is the "global guard" — no per-action is_demo checks
-- needed.
--
-- This script is IDEMPOTENT — safe to run multiple times. It uses fixed UUIDs
-- so re-runs update rather than duplicate.
-- ============================================================================

DO $$
DECLARE
  v_demo_id UUID := '00000000-0000-4000-a000-000000000001';
  v_team1_id UUID := '00000000-0000-4000-a000-000000000002';
  v_team2_id UUID := '00000000-0000-4000-a000-000000000003';
  v_password_hash TEXT := '__DEMO_PASSWORD_HASH__';
  -- Services
  v_svc_seo UUID := '00000000-0000-4000-b000-000000000001';
  v_svc_ads UUID := '00000000-0000-4000-b000-000000000002';
  v_svc_web UUID := '00000000-0000-4000-b000-000000000003';
  v_svc_social UUID := '00000000-0000-4000-b000-000000000004';
  -- Active clients
  v_ac1 UUID := '00000000-0000-4000-c000-000000000001';
  v_ac2 UUID := '00000000-0000-4000-c000-000000000002';
  v_ac3 UUID := '00000000-0000-4000-c000-000000000003';
  -- Journeys
  v_j1 UUID := '00000000-0000-4000-d000-000000000001';
  v_j2 UUID := '00000000-0000-4000-d000-000000000002';
  v_j3 UUID := '00000000-0000-4000-d000-000000000003';
  v_j4 UUID := '00000000-0000-4000-d000-000000000004';
  v_j5 UUID := '00000000-0000-4000-d000-000000000005';
  -- Twilio tracking numbers
  v_tn_google   UUID := '00000000-0000-4000-e000-000000000001';
  v_tn_facebook UUID := '00000000-0000-4000-e000-000000000002';
  v_tn_organic  UUID := '00000000-0000-4000-e000-000000000003';
  v_tn_referral UUID := '00000000-0000-4000-e000-000000000004';
  -- Twilio config
  v_twilio_cfg UUID := '00000000-0000-4000-e000-0000000000ff';
  -- CTM forms
  v_form_contact   UUID := '00000000-0000-4000-f000-000000000001';
  v_form_whitening UUID := '00000000-0000-4000-f000-000000000002';
  -- Additional journeys (won/lost variety)
  v_j6 UUID := '00000000-0000-4000-d000-000000000006';
  v_j7 UUID := '00000000-0000-4000-d000-000000000007';
  v_j8 UUID := '00000000-0000-4000-d000-000000000008';
  v_j9 UUID := '00000000-0000-4000-d000-000000000009';
  -- Tasks workspace + board + groups + status labels
  v_ws_ops    UUID := '00000000-0000-4000-1000-000000000001';
  v_board_ppl UUID := '00000000-0000-4000-1000-000000000010';
  v_grp_new   UUID := '00000000-0000-4000-1000-000000000020';
  v_grp_wip   UUID := '00000000-0000-4000-1000-000000000021';
  v_grp_done  UUID := '00000000-0000-4000-1000-000000000022';
  v_sl_todo   UUID := '00000000-0000-4000-1000-000000000030';
  v_sl_wip    UUID := '00000000-0000-4000-1000-000000000031';
  v_sl_wait   UUID := '00000000-0000-4000-1000-000000000032';
  v_sl_stuck  UUID := '00000000-0000-4000-1000-000000000033';
  v_sl_done   UUID := '00000000-0000-4000-1000-000000000034';
BEGIN

-- ============================================================================
-- 1. DEMO USER
-- ============================================================================
INSERT INTO users (id, first_name, last_name, email, password_hash, role, is_demo, created_at)
VALUES (
  v_demo_id, 'Bright', 'Smiles', 'demo@anchorcorps.com',
  v_password_hash, 'client', TRUE, NOW() - INTERVAL '90 days'
)
ON CONFLICT (id) DO UPDATE SET
  is_demo = TRUE,
  password_hash = EXCLUDED.password_hash,
  updated_at = NOW();

UPDATE users SET email = 'demo@anchorcorps.com' WHERE id = v_demo_id;

-- ============================================================================
-- 2. CLIENT PROFILE
-- ============================================================================
INSERT INTO client_profiles (
  user_id, call_tracking_main_number, front_desk_emails,
  office_admin_name, office_admin_email, office_admin_phone,
  form_email_recipients,
  website_access_provided, website_access_understood,
  ga4_access_provided, ga4_access_understood,
  google_ads_access_provided, google_ads_access_understood,
  meta_access_provided, meta_access_understood,
  website_forms_details_provided, website_forms_details_understood,
  onboarding_completed_at, activated_at, client_type, client_subtype,
  ai_prompt, auto_star_enabled, client_identifier_value
)
VALUES (
  v_demo_id, '(555) 123-4567', 'reception@brightsmilesdental.example',
  'Sarah Johnson', 'sarah@brightsmilesdental.example', '(555) 123-4568',
  'sarah@brightsmilesdental.example',
  TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE,
  NOW() - INTERVAL '85 days', NOW() - INTERVAL '84 days', 'medical', 'dental',
  'You are a dental practice call classifier. Analyze calls for Bright Smiles Family Dentistry and categorize caller intent.',
  TRUE, 'Bright Smiles Family Dentistry'
)
ON CONFLICT (user_id) DO UPDATE SET
  call_tracking_main_number = EXCLUDED.call_tracking_main_number,
  office_admin_name = EXCLUDED.office_admin_name,
  onboarding_completed_at = EXCLUDED.onboarding_completed_at,
  activated_at = EXCLUDED.activated_at,
  client_type = EXCLUDED.client_type,
  client_subtype = EXCLUDED.client_subtype,
  auto_star_enabled = EXCLUDED.auto_star_enabled,
  client_identifier_value = EXCLUDED.client_identifier_value,
  updated_at = NOW();

-- ============================================================================
-- 3. BRAND ASSETS
-- ============================================================================
DELETE FROM brand_assets WHERE user_id = v_demo_id;
INSERT INTO brand_assets (user_id, business_name, business_description, website_url, primary_brand_colors)
VALUES (
  v_demo_id,
  'Bright Smiles Family Dentistry',
  'Bright Smiles Family Dentistry has been serving the North Texas community for over 15 years. We specialize in general, cosmetic, and pediatric dentistry with a warm, patient-first approach.',
  'https://brightsmilesdental.example',
  '#2196F3, #4CAF50, #FFFFFF'
);

-- ============================================================================
-- 4. TEAM MEMBERS
-- ============================================================================
INSERT INTO users (id, first_name, last_name, email, password_hash, role, is_demo, created_at)
VALUES
  (v_team1_id, 'Sarah', 'Johnson', 'demo-sarah@anchorcorps.com', v_password_hash, 'client', TRUE, NOW() - INTERVAL '80 days'),
  (v_team2_id, 'Mike', 'Chen', 'demo-mike@anchorcorps.com', v_password_hash, 'client', TRUE, NOW() - INTERVAL '60 days')
ON CONFLICT (id) DO UPDATE SET
  is_demo = TRUE,
  updated_at = NOW();

INSERT INTO client_account_members (client_owner_id, member_user_id, role, invited_by, invited_at, accepted_at, status)
VALUES
  (v_demo_id, v_team1_id, 'admin', v_demo_id, NOW() - INTERVAL '80 days', NOW() - INTERVAL '79 days', 'active'),
  (v_demo_id, v_team2_id, 'member', v_demo_id, NOW() - INTERVAL '60 days', NOW() - INTERVAL '59 days', 'active')
ON CONFLICT (client_owner_id, member_user_id) DO UPDATE SET
  status = 'active',
  updated_at = NOW();

-- Demo accounts must log in via the single shared password without any second step:
-- the demo deployment has no Mailgun creds (and DEMO_MODE suppresses sends), so the
-- email-verification link can't be delivered. Pre-verify every demo user so the login
-- flow doesn't dead-end at EMAIL_NOT_VERIFIED. Idempotent. (activated_at lives on
-- client_profiles, not users, and client activation already isn't a blocker for the demo.)
UPDATE users
   SET email_verified_at = COALESCE(email_verified_at, created_at)
 WHERE is_demo = TRUE;

-- ============================================================================
-- 5. SERVICES
-- ============================================================================
INSERT INTO services (id, name, description, base_price, active) VALUES
  (v_svc_seo,    'Local SEO',             'Monthly local SEO including Google Business Profile optimization, citation building, and keyword targeting.', 1500.00, TRUE),
  (v_svc_ads,    'Google Ads Management', 'Search and display campaign management with monthly reporting and optimization.', 2000.00, TRUE),
  (v_svc_web,    'Website Maintenance',   'Monthly website updates, security patches, performance monitoring, and content changes.', 500.00, TRUE),
  (v_svc_social, 'Social Media',          'Content creation and scheduling across Facebook and Instagram with engagement management.', 1200.00, TRUE)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  base_price = EXCLUDED.base_price,
  updated_at = NOW();

-- ============================================================================
-- 6. TWILIO CONFIG + TRACKING NUMBERS
-- ============================================================================
-- Demo Twilio config (fake credentials — the demo account has no real Twilio).
INSERT INTO twilio_client_configs (id, client_user_id, account_sid, auth_token, is_active)
VALUES (
  v_twilio_cfg, v_demo_id,
  'ACdemo0000000000000000000000000001',
  'demo_auth_token_not_real',
  TRUE
)
ON CONFLICT (client_user_id) DO UPDATE SET
  id = EXCLUDED.id,
  is_active = TRUE,
  updated_at = NOW();

-- Tracking numbers, each tied to a marketing source.
INSERT INTO twilio_tracking_numbers (
  id, client_user_id, twilio_config_id, phone_number, phone_number_sid,
  friendly_name, forward_to_number, source_type, campaign_name,
  recording_enabled, transcription_enabled, is_active
) VALUES
  (v_tn_google,   v_demo_id, v_twilio_cfg, '+15551234701', 'PNdemo0000000000000000000000000001',
   'Google Ads — Implants & Emergency', '+15551234567', 'google_ads', 'Search — Emergency & Implants',
   TRUE, TRUE, TRUE),
  (v_tn_facebook, v_demo_id, v_twilio_cfg, '+15551234702', 'PNdemo0000000000000000000000000002',
   'Facebook Ads — Family Dentistry', '+15551234567', 'facebook_ads', 'FB/IG — Pediatric & Family',
   TRUE, TRUE, TRUE),
  (v_tn_organic,  v_demo_id, v_twilio_cfg, '+15551234703', 'PNdemo0000000000000000000000000003',
   'Organic Search — Website', '+15551234567', 'organic_search', 'SEO — Brand & General',
   TRUE, TRUE, TRUE),
  (v_tn_referral, v_demo_id, v_twilio_cfg, '+15551234704', 'PNdemo0000000000000000000000000004',
   'Patient & Doctor Referrals', '+15551234567', 'referral', 'Referral — Patient & Doctor',
   TRUE, TRUE, TRUE)
ON CONFLICT (id) DO UPDATE SET
  phone_number = EXCLUDED.phone_number,
  friendly_name = EXCLUDED.friendly_name,
  source_type = EXCLUDED.source_type,
  campaign_name = EXCLUDED.campaign_name,
  is_active = TRUE,
  updated_at = NOW();

-- ============================================================================
-- 7. CTM FORMS
-- ============================================================================
INSERT INTO ctm_forms (id, org_id, name, status, form_mode, config_json, success_message)
VALUES
  (v_form_contact, v_demo_id, 'Contact Us', 'published', 'builder',
    '{"fields":[
       {"id":"name","type":"text","label":"Name","required":true},
       {"id":"email","type":"email","label":"Email","required":true},
       {"id":"phone_number","type":"tel","label":"Phone","required":true},
       {"id":"message","type":"textarea","label":"How can we help?","required":false}
     ],"settings":{}}'::jsonb,
    'Thanks! We''ll be in touch shortly.'),
  (v_form_whitening, v_demo_id, 'Whitening Consultation Request', 'published', 'builder',
    '{"fields":[
       {"id":"name","type":"text","label":"Name","required":true},
       {"id":"email","type":"email","label":"Email","required":true},
       {"id":"phone_number","type":"tel","label":"Phone","required":true},
       {"id":"event_date","type":"date","label":"Event date (if any)","required":false},
       {"id":"message","type":"textarea","label":"Anything we should know?","required":false}
     ],"settings":{}}'::jsonb,
    'Got it! A whitening specialist will reach out within one business day.')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  config_json = EXCLUDED.config_json,
  success_message = EXCLUDED.success_message,
  updated_at = NOW();

-- ============================================================================
-- 8. CALL LOGS — 40 calls with full caller enrichment
-- ============================================================================
-- Clean old demo calls so re-runs land cleanly.
DELETE FROM call_logs WHERE user_id = v_demo_id AND call_id LIKE 'DEMO_%';

INSERT INTO call_logs (
  user_id, owner_user_id, call_id, direction, from_number, to_number,
  started_at, duration_sec, score, activity_type, caller_type,
  tracking_number_id, recording_url, meta
) VALUES
-- ---- Very hot leads (score 3, category very_hot) ----
(v_demo_id, v_demo_id, 'DEMO_001', 'inbound', '+15551001001', '+15551234703', NOW() - INTERVAL '2 days 10 hours', 245, 3, 'call', 'new', v_tn_organic, 'https://cdn.example/demo/rec_001.mp3',
 '{"category":"very_hot","caller_name":"Jessica Martinez","caller_number":"+15551001001","caller_city":"Plano","caller_state":"TX","region":"Plano, TX","source":"Google Search","source_key":"google_organic","system_tags":[],"classification_summary":"New patient wants to schedule teeth cleaning and whitening consultation. Asked about insurance and availability this week.","classification_reasoning":"Caller is new, asking about appointment availability and insurance — strong booking intent.","summary":"New patient wants to schedule teeth cleaning and whitening consultation. Asked about insurance and availability this week.","transcript":"Hi, I''m calling to schedule a cleaning appointment. I just moved to the area and I''m looking for a new dentist. Do you accept Blue Cross? Great! And I was also wondering about teeth whitening — do you offer that? I''d love to come in this week if possible.","classification_source":"ai","caller":{"name":"Jessica Martinez","phone":"+15551001001","city":"Plano","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_002', 'inbound', '+15551001002', '+15551234702', NOW() - INTERVAL '4 days 14 hours', 312, 3, 'call', 'new', v_tn_facebook, 'https://cdn.example/demo/rec_002.mp3',
 '{"category":"very_hot","caller_name":"Robert Chen","caller_number":"+15551001002","caller_city":"Frisco","caller_state":"TX","region":"Frisco, TX","source":"Facebook Ads","source_key":"facebook_ads","system_tags":[],"classification_summary":"Parent calling to schedule pediatric dental visit for two children. Ready to book immediately.","classification_reasoning":"Parent of two minors with clear scheduling intent and time-window preference.","summary":"Parent calling to schedule pediatric dental visit for two children. Ready to book immediately.","transcript":"Hello, I need to make appointments for both of my kids. My daughter is 7 and my son is 10. They both need checkups and cleanings. We can come in any day after school, around 3:30 or later. Do you have anything available next week?","classification_source":"ai","caller":{"name":"Robert Chen","phone":"+15551001002","city":"Frisco","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_003', 'inbound', '+15551001003', '+15551234701', NOW() - INTERVAL '5 days 9 hours', 198, 3, 'call', 'new', v_tn_google, 'https://cdn.example/demo/rec_003.mp3',
 '{"category":"very_hot","caller_name":"Marcus Williams","caller_number":"+15551001003","caller_city":"Allen","caller_state":"TX","region":"Allen, TX","source":"Google Ads","source_key":"google_ads","system_tags":[],"classification_summary":"Emergency dental patient with severe toothache, needs same-day appointment.","classification_reasoning":"Urgency keywords (severe pain, today, cracked tooth) plus willingness to pay out-of-pocket.","summary":"Emergency dental patient with severe toothache, needs same-day appointment.","transcript":"Hi, I''m in a lot of pain. I think I have a cracked tooth — it happened while I was eating lunch. Is there any way I can come in today? The pain is really bad and I can''t wait until next week. I''ll pay out of pocket if needed.","classification_source":"ai","caller":{"name":"Marcus Williams","phone":"+15551001003","city":"Allen","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_004', 'inbound', '+15551001004', '+15551234704', NOW() - INTERVAL '8 days 11 hours', 276, 3, 'call', 'new', v_tn_referral, 'https://cdn.example/demo/rec_004.mp3',
 '{"category":"very_hot","caller_name":"Emma Thompson","caller_number":"+15551001004","caller_city":"McKinney","caller_state":"TX","region":"McKinney, TX","source":"Patient Referral","source_key":"referral","system_tags":["Referral"],"classification_summary":"Caller interested in Invisalign consultation. Asking about pricing and payment plans.","classification_reasoning":"Referred by an existing patient, asking about pricing and payment plans — high-intent prospect.","summary":"Caller interested in Invisalign consultation. Asking about pricing and payment plans.","transcript":"I''ve been thinking about getting Invisalign for a while now. A friend of mine went to your office and had a great experience. Can you tell me about pricing? Do you offer payment plans? I''d like to schedule a consultation.","classification_source":"ai","caller":{"name":"Emma Thompson","phone":"+15551001004","city":"McKinney","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_005', 'inbound', '+15551001005', '+15551234704', NOW() - INTERVAL '12 days 15 hours', 189, 3, 'call', 'new', v_tn_referral, 'https://cdn.example/demo/rec_005.mp3',
 '{"category":"very_hot","caller_name":"David Patel","caller_number":"+15551001005","caller_city":"Dallas","caller_state":"TX","region":"Dallas, TX","source":"Dentist Referral","source_key":"referral","system_tags":["Referral"],"classification_summary":"Prospective patient requesting dental implant consultation. Has been referred by their general dentist.","classification_reasoning":"Dentist referral with records in hand — high-intent specialty consult.","summary":"Prospective patient requesting dental implant consultation. Has been referred by their general dentist.","transcript":"My dentist recommended I come see you about getting a dental implant. I lost a molar and he said you do great implant work. Can I set up a consultation? I have the X-rays from my dentist I can bring along.","classification_source":"ai","caller":{"name":"David Patel","phone":"+15551001005","city":"Dallas","state":"TX","country":"US"}}'),

-- ---- Warm leads (score 3, category warm) ----
(v_demo_id, v_demo_id, 'DEMO_006', 'inbound', '+15551002001', '+15551234701', NOW() - INTERVAL '1 day 13 hours', 156, 3, 'call', 'new', v_tn_google, 'https://cdn.example/demo/rec_006.mp3',
 '{"category":"warm","caller_name":"Ashley Rodriguez","caller_number":"+15551002001","caller_city":"Carrollton","caller_state":"TX","region":"Carrollton, TX","source":"Google Ads","source_key":"google_ads","system_tags":[],"classification_summary":"Caller asking about dental services and pricing but not ready to book yet.","classification_reasoning":"Comparison shopping — needs nurturing.","summary":"Caller asking about dental services and pricing but not ready to book yet.","transcript":"Hi, I was just calling to get some information. What are your rates for a basic cleaning? And do you accept Aetna insurance? I''m not ready to schedule just yet but I''m comparing a few offices in the area.","classification_source":"ai","caller":{"name":"Ashley Rodriguez","phone":"+15551002001","city":"Carrollton","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_007', 'inbound', '+15551002002', '+15551234703', NOW() - INTERVAL '3 days 16 hours', 201, 3, 'call', 'new', v_tn_organic, 'https://cdn.example/demo/rec_007.mp3',
 '{"category":"warm","caller_name":"Michelle Park","caller_number":"+15551002002","caller_city":"Plano","caller_state":"TX","region":"Plano, TX","source":"Google Search","source_key":"google_organic","system_tags":[],"classification_summary":"Caller inquiring about cosmetic dentistry options including veneers.","classification_reasoning":"Service research — wants info before committing.","summary":"Caller inquiring about cosmetic dentistry options including veneers.","transcript":"I''ve been looking into veneers and I saw your website mentions cosmetic dentistry. Can you explain the process? How many visits does it take and what does it typically cost? I want to do some research before committing.","classification_source":"ai","caller":{"name":"Michelle Park","phone":"+15551002002","city":"Plano","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_008', 'inbound', '+15551002003', '+15551234702', NOW() - INTERVAL '6 days 10 hours', 134, 3, 'call', 'new', v_tn_facebook, 'https://cdn.example/demo/rec_008.mp3',
 '{"category":"warm","caller_name":"Heather Ellis","caller_number":"+15551002003","caller_city":"Frisco","caller_state":"TX","region":"Frisco, TX","source":"Facebook Ads","source_key":"facebook_ads","system_tags":[],"classification_summary":"Parent asking about pediatric services and whether the office is kid-friendly.","classification_reasoning":"First-time pediatric inquiry — child anxiety mentioned, comfort-focused.","summary":"Parent asking about pediatric services and whether the office is kid-friendly.","transcript":"Hi, I have a 4-year-old who needs her first dental visit. Is your office good with little kids? Does the dentist have experience with children? She''s a little nervous so I want to make sure it''s a comfortable environment.","classification_source":"ai","caller":{"name":"Heather Ellis","phone":"+15551002003","city":"Frisco","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_009', 'inbound', '+15551002004', '+15551234567', NOW() - INTERVAL '9 days 14 hours', 178, 3, 'call', 'new', NULL, 'https://cdn.example/demo/rec_009.mp3',
 '{"category":"warm","caller_name":"George Anderson","caller_number":"+15551002004","caller_city":"Dallas","caller_state":"TX","region":"Dallas, TX","source":"Direct","source_key":"direct","system_tags":[],"classification_summary":"Senior caller asking about denture options and Medicare coverage.","classification_reasoning":"Senior with budget concern — needs cost transparency to convert.","summary":"Senior caller asking about denture options and Medicare coverage.","transcript":"Hello, I''m calling about dentures. My current set is getting worn out and I need to look into replacements. Does your office handle that? And do you take Medicare? I''m on a fixed income so cost is a concern.","classification_source":"ai","caller":{"name":"George Anderson","phone":"+15551002004","city":"Dallas","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_010', 'inbound', '+15551002005', '+15551234701', NOW() - INTERVAL '11 days 11 hours', 145, 3, 'call', 'new', v_tn_google, 'https://cdn.example/demo/rec_010.mp3',
 '{"category":"warm","caller_name":"Brian Foster","caller_number":"+15551002005","caller_city":"Tucson","caller_state":"AZ","region":"Tucson, AZ","source":"Google Ads","source_key":"google_ads","system_tags":[],"classification_summary":"Caller from out of state asking about sedation dentistry services.","classification_reasoning":"Out-of-state, high-anxiety patient willing to travel — niche service match.","summary":"Caller from out of state asking about sedation dentistry services.","transcript":"I found your practice online and I noticed you offer sedation dentistry. I have severe dental anxiety and I haven''t been to a dentist in years. Can you tell me more about the sedation options? I might be willing to travel for this.","classification_source":"ai","caller":{"name":"Brian Foster","phone":"+15551002005","city":"Tucson","state":"AZ","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_011', 'inbound', '+15551002006', '+15551234704', NOW() - INTERVAL '14 days 9 hours', 167, 3, 'call', 'new', v_tn_referral, 'https://cdn.example/demo/rec_011.mp3',
 '{"category":"warm","caller_name":"Natalie Brooks","caller_number":"+15551002006","caller_city":"Plano","caller_state":"TX","region":"Plano, TX","source":"Patient Referral","source_key":"referral","system_tags":["Referral"],"classification_summary":"Referral from another patient asking about new patient specials.","classification_reasoning":"Word-of-mouth referral — booking checkup plus possible crown.","summary":"Referral from another patient asking about new patient specials.","transcript":"Hi, my neighbor told me about your office and said you''re really good. Do you have any specials for new patients? I need a cleaning and checkup. I also might need a crown — one of my fillings fell out recently.","classification_source":"ai","caller":{"name":"Natalie Brooks","phone":"+15551002006","city":"Plano","state":"TX","country":"US"}}'),

-- ---- Needs attention (score 3) ----
(v_demo_id, v_demo_id, 'DEMO_012', 'inbound', '+15551003001', '+15551234567', NOW() - INTERVAL '2 days 8 hours', 45, 3, 'call', 'returning_customer', NULL, 'https://cdn.example/demo/rec_012.mp3',
 '{"category":"needs_attention","caller_name":"Jennifer Torres","caller_number":"+15551003001","caller_city":"Plano","caller_state":"TX","region":"Plano, TX","source":"Direct","source_key":"direct","system_tags":["Existing Client","Active Client"],"classification_summary":"Patient left message about billing discrepancy, needs callback regarding insurance claim.","classification_reasoning":"Active patient with billing concern — front-desk action required.","summary":"Patient left message about billing discrepancy, needs callback regarding insurance claim.","transcript":"Hi, this is Jennifer Torres. I received a bill for $340 but my insurance should have covered most of my last visit. Can someone please call me back to sort this out? My number is 555-100-3001. Thanks.","classification_source":"ai","caller":{"name":"Jennifer Torres","phone":"+15551003001","city":"Plano","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_013', 'inbound', '+15551003002', '+15551234567', NOW() - INTERVAL '7 days 15 hours', 38, 3, 'call', 'returning_customer', NULL, 'https://cdn.example/demo/rec_013.mp3',
 '{"category":"needs_attention","caller_name":"David Park","caller_number":"+15551003002","caller_city":"Allen","caller_state":"TX","region":"Allen, TX","source":"Direct","source_key":"direct","system_tags":["Existing Client"],"classification_summary":"Patient requesting prescription refill for post-procedure pain medication.","classification_reasoning":"Existing patient with post-op concern — clinical staff callback needed.","summary":"Patient requesting prescription refill for post-procedure pain medication.","transcript":"This is David Park. I had a root canal last week and the prescription you gave me has run out but I''m still in some pain. Can Dr. Martinez call me back about getting a refill or maybe adjusting the medication? My number is 555-100-3002.","classification_source":"ai","caller":{"name":"David Park","phone":"+15551003002","city":"Allen","state":"TX","country":"US"}}'),

-- ---- Voicemails (score 0) ----
(v_demo_id, v_demo_id, 'DEMO_014', 'inbound', '+15551004001', '+15551234567', NOW() - INTERVAL '1 day 7 hours', 22, 0, 'call', 'new', NULL, 'https://cdn.example/demo/rec_014.mp3',
 '{"category":"voicemail","caller_name":"Unknown Caller","caller_number":"+15551004001","caller_city":"Richardson","caller_state":"TX","region":"Richardson, TX","source":"Direct","source_key":"direct","system_tags":[],"is_voicemail":true,"classification_summary":"Short voicemail, caller hung up without leaving details.","classification_reasoning":"Caller did not state a reason for the call.","summary":"Short voicemail, caller hung up without leaving details.","transcript":"Hi, um... [long pause] ...I was calling about... actually, never mind. I''ll try again later.","classification_source":"ai","caller":{"phone":"+15551004001","city":"Richardson","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_015', 'inbound', '+15551004002', '+15551234567', NOW() - INTERVAL '3 days 7 hours', 18, 0, 'call', 'new', NULL, 'https://cdn.example/demo/rec_015.mp3',
 '{"category":"voicemail","caller_name":"Unknown Caller","caller_number":"+15551004002","caller_city":"Garland","caller_state":"TX","region":"Garland, TX","source":"Direct","source_key":"direct","system_tags":[],"is_voicemail":true,"requires_callback":true,"classification_summary":"Voicemail left requesting appointment but no callback number provided clearly.","classification_reasoning":"Audio cut out before callback number was captured.","summary":"Voicemail left requesting appointment but no callback number provided clearly.","transcript":"Hey, I need to schedule an appointment. Call me back at... [audio cuts out]","classification_source":"ai","caller":{"phone":"+15551004002","city":"Garland","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_016', 'inbound', '+15551004003', '+15551234567', NOW() - INTERVAL '6 days 7 hours', 15, 0, 'call', 'new', NULL, 'https://cdn.example/demo/rec_016.mp3',
 '{"category":"voicemail","caller_name":"Unknown Caller","caller_number":"+15551004003","caller_city":"Mesquite","caller_state":"TX","region":"Mesquite, TX","source":"Direct","source_key":"direct","system_tags":[],"is_voicemail":true,"classification_summary":"Blank voicemail — caller did not speak.","classification_reasoning":"Empty audio. No caller intent.","summary":"Blank voicemail — caller did not speak.","transcript":"[silence]","classification_source":"ai","caller":{"phone":"+15551004003","city":"Mesquite","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_017', 'inbound', '+15551004004', '+15551234567', NOW() - INTERVAL '10 days 8 hours', 28, 0, 'call', 'new', NULL, 'https://cdn.example/demo/rec_017.mp3',
 '{"category":"voicemail","caller_name":"Unknown Caller","caller_number":"+15551004004","caller_city":"Plano","caller_state":"TX","region":"Plano, TX","source":"Direct","source_key":"direct","system_tags":[],"is_voicemail":true,"classification_summary":"Patient confirming they received a reminder but did not leave their name.","classification_reasoning":"Confirmation without identifying patient — no action required.","summary":"Patient confirming they received a reminder but did not leave their name.","transcript":"Hi, I got a reminder about my appointment tomorrow. Just wanted to confirm I''ll be there. Thanks!","classification_source":"ai","caller":{"phone":"+15551004004","city":"Plano","state":"TX","country":"US"}}'),

-- ---- Unanswered (score 0) ----
(v_demo_id, v_demo_id, 'DEMO_018', 'inbound', '+15551005001', '+15551234567', NOW() - INTERVAL '1 day 18 hours', 0, 0, 'call', 'new', NULL, NULL,
 '{"category":"unanswered","caller_name":"Unknown Caller","caller_number":"+15551005001","caller_city":"Frisco","caller_state":"TX","region":"Frisco, TX","source":"Direct","source_key":"direct","system_tags":[],"classification_summary":"Missed call — no voicemail left.","classification_reasoning":"No audio. No reachable intent.","summary":"Missed call — no voicemail left.","transcript":"","classification_source":"ai","caller":{"phone":"+15551005001","city":"Frisco","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_019', 'inbound', '+15551005002', '+15551234567', NOW() - INTERVAL '4 days 19 hours', 0, 0, 'call', 'new', NULL, NULL,
 '{"category":"unanswered","caller_name":"Unknown Caller","caller_number":"+15551005002","caller_city":"Allen","caller_state":"TX","region":"Allen, TX","source":"Direct","source_key":"direct","system_tags":[],"classification_summary":"Missed call after hours — no voicemail left.","classification_reasoning":"Call came in after hours.","summary":"Missed call after hours — no voicemail left.","transcript":"","classification_source":"ai","caller":{"phone":"+15551005002","city":"Allen","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_020', 'inbound', '+15551005003', '+15551234567', NOW() - INTERVAL '7 days 12 hours', 0, 0, 'call', 'new', NULL, NULL,
 '{"category":"unanswered","caller_name":"Unknown Caller","caller_number":"+15551005003","caller_city":"McKinney","caller_state":"TX","region":"McKinney, TX","source":"Direct","source_key":"direct","system_tags":[],"classification_summary":"Missed call during lunch — no message.","classification_reasoning":"Lunch hour gap.","summary":"Missed call during lunch — no message.","transcript":"","classification_source":"ai","caller":{"phone":"+15551005003","city":"McKinney","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_021', 'inbound', '+15551005004', '+15551234567', NOW() - INTERVAL '13 days 17 hours', 0, 0, 'call', 'new', NULL, NULL,
 '{"category":"unanswered","caller_name":"Unknown Caller","caller_number":"+15551005004","caller_city":"Plano","caller_state":"TX","region":"Plano, TX","source":"Direct","source_key":"direct","system_tags":[],"classification_summary":"Missed call — no voicemail left.","classification_reasoning":"No audio.","summary":"Missed call — no voicemail left.","transcript":"","classification_source":"ai","caller":{"phone":"+15551005004","city":"Plano","state":"TX","country":"US"}}'),

-- ---- Not a fit (score 2) ----
(v_demo_id, v_demo_id, 'DEMO_022', 'inbound', '+15551006001', '+15551234703', NOW() - INTERVAL '5 days 13 hours', 89, 2, 'call', 'new', v_tn_organic, 'https://cdn.example/demo/rec_022.mp3',
 '{"category":"not_a_fit","caller_name":"Tyler Brooks","caller_number":"+15551006001","caller_city":"Plano","caller_state":"TX","region":"Plano, TX","source":"Google Search","source_key":"google_organic","system_tags":[],"classification_summary":"Caller looking for orthodontist — referred elsewhere.","classification_reasoning":"Orthodontic service requested — out of scope.","summary":"Caller looking for orthodontist — referred elsewhere.","transcript":"Hi, I''m looking for an orthodontist for my teenager. Do you do braces? No? OK, can you recommend anyone in the area? Thanks for the help.","classification_source":"ai","caller":{"name":"Tyler Brooks","phone":"+15551006001","city":"Plano","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_023', 'inbound', '+15551006002', '+15551234703', NOW() - INTERVAL '8 days 10 hours', 67, 2, 'call', 'new', v_tn_organic, 'https://cdn.example/demo/rec_023.mp3',
 '{"category":"not_a_fit","caller_name":"Sandra Lopez","caller_number":"+15551006002","caller_city":"Frisco","caller_state":"TX","region":"Frisco, TX","source":"Google Search","source_key":"google_organic","system_tags":[],"classification_summary":"Caller looking for oral surgeon for wisdom teeth extraction.","classification_reasoning":"Surgical extraction — refer to oral surgeon.","summary":"Caller looking for oral surgeon for wisdom teeth extraction.","transcript":"Hi, I need to get my wisdom teeth removed. My dentist said I need an oral surgeon. Do you do that kind of thing? Oh, you don''t do surgical extractions? OK, do you know who does?","classification_source":"ai","caller":{"name":"Sandra Lopez","phone":"+15551006002","city":"Frisco","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_024', 'inbound', '+15551006003', '+15551234703', NOW() - INTERVAL '15 days 14 hours', 45, 2, 'call', 'new', v_tn_organic, 'https://cdn.example/demo/rec_024.mp3',
 '{"category":"not_a_fit","caller_name":"Michael Reed","caller_number":"+15551006003","caller_city":"Phoenix","caller_state":"AZ","region":"Phoenix, AZ","source":"Google Search","source_key":"google_organic","system_tags":[],"classification_summary":"Caller is outside service area in a different state.","classification_reasoning":"Out of service area.","summary":"Caller is outside service area in a different state.","transcript":"Hi, I saw your practice online and it looks great. I''m located in Phoenix though — do you have an office out here? No? OK, no worries. Thanks anyway.","classification_source":"ai","caller":{"name":"Michael Reed","phone":"+15551006003","city":"Phoenix","state":"AZ","country":"US"}}'),

-- ---- Spam (score 1) ----
(v_demo_id, v_demo_id, 'DEMO_025', 'inbound', '+15551007001', '+15551234567', NOW() - INTERVAL '2 days 12 hours', 34, 1, 'call', 'new', NULL, 'https://cdn.example/demo/rec_025.mp3',
 '{"category":"spam","caller_name":"Dental Supply Direct","caller_number":"+15551007001","caller_city":"","caller_state":"","region":"","source":"Cold Call","source_key":"cold_call","system_tags":[],"classification_summary":"Telemarketer selling dental supply products.","classification_reasoning":"B2B sales call, not a patient.","summary":"Telemarketer selling dental supply products.","transcript":"Good afternoon! I''m calling from Dental Supply Direct. We have amazing deals on dental equipment this month. Can I speak with your office manager about your supply needs? We can save you up to 40% on...","classification_source":"ai","caller":{"name":"Dental Supply Direct","phone":"+15551007001","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_026', 'inbound', '+15551007002', '+15551234567', NOW() - INTERVAL '6 days 11 hours', 12, 1, 'call', 'new', NULL, 'https://cdn.example/demo/rec_026.mp3',
 '{"category":"spam","caller_name":"Unknown Caller","caller_number":"+15551007002","caller_city":"","caller_state":"","region":"","source":"Robocall","source_key":"robocall","system_tags":[],"classification_summary":"Robocall — automated message about extended warranty.","classification_reasoning":"Automated robocall.","summary":"Robocall — automated message about extended warranty.","transcript":"[automated voice] We''ve been trying to reach you about your vehicle''s extended warranty. This is your final notice...","classification_source":"ai","caller":{"phone":"+15551007002","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_027', 'inbound', '+15551007003', '+15551234567', NOW() - INTERVAL '11 days 16 hours', 56, 1, 'call', 'new', NULL, 'https://cdn.example/demo/rec_027.mp3',
 '{"category":"spam","caller_name":"Digital Marketing Pros","caller_number":"+15551007003","caller_city":"","caller_state":"","region":"","source":"Cold Call","source_key":"cold_call","system_tags":[],"classification_summary":"Cold call from marketing company offering SEO services.","classification_reasoning":"SEO sales pitch.","summary":"Cold call from marketing company offering SEO services.","transcript":"Hello, I''m calling from Digital Marketing Pros. We noticed your Google listing could be improved. We specialize in dental SEO and can guarantee you first page rankings. Can I schedule a quick 15-minute call with the decision maker?","classification_source":"ai","caller":{"name":"Digital Marketing Pros","phone":"+15551007003","country":"US"}}'),

-- ---- Neutral (score 0) ----
(v_demo_id, v_demo_id, 'DEMO_028', 'inbound', '+15551008001', '+15551234567', NOW() - INTERVAL '3 days 9 hours', 78, 0, 'call', 'new', NULL, 'https://cdn.example/demo/rec_028.mp3',
 '{"category":"neutral","caller_name":"Linda Walker","caller_number":"+15551008001","caller_city":"Plano","caller_state":"TX","region":"Plano, TX","source":"Direct","source_key":"direct","system_tags":[],"classification_summary":"General inquiry about office hours and location.","classification_reasoning":"Informational only — may call back.","summary":"General inquiry about office hours and location.","transcript":"Hi, I was just wondering what your office hours are? And where exactly are you located? I drove by but I wasn''t sure which building. OK, great, thanks for the info. I might call back to schedule something.","classification_source":"ai","caller":{"name":"Linda Walker","phone":"+15551008001","city":"Plano","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_029', 'inbound', '+15551008002', '+15551234567', NOW() - INTERVAL '9 days 10 hours', 92, 0, 'call', 'new', NULL, 'https://cdn.example/demo/rec_029.mp3',
 '{"category":"neutral","caller_name":"Walgreens Pharmacy","caller_number":"+15551008002","caller_city":"Plano","caller_state":"TX","region":"Plano, TX","source":"Pharmacy","source_key":"pharmacy","system_tags":[],"classification_summary":"Pharmacy calling to verify patient prescription.","classification_reasoning":"B2B pharmacy verification, not a lead.","summary":"Pharmacy calling to verify patient prescription.","transcript":"Hi, this is Walgreens Pharmacy on Main Street. I''m calling to verify a prescription for one of your patients. We received a prescription for amoxicillin but the dosage seems different from what we usually see. Can I speak with Dr. Martinez?","classification_source":"ai","caller":{"name":"Walgreens Pharmacy","phone":"+15551008002","city":"Plano","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_030', 'inbound', '+15551008003', '+15551234567', NOW() - INTERVAL '13 days 14 hours', 45, 0, 'call', 'new', NULL, 'https://cdn.example/demo/rec_030.mp3',
 '{"category":"neutral","caller_name":"Karen — Delta Dental","caller_number":"+15551008003","caller_city":"","caller_state":"","region":"","source":"Insurance Carrier","source_key":"insurance","system_tags":[],"classification_summary":"Insurance company calling about pre-authorization.","classification_reasoning":"B2B insurance verification.","summary":"Insurance company calling about pre-authorization.","transcript":"This is Karen from Delta Dental calling about a pre-authorization request for patient ID ending in 4523. We need some additional documentation before we can approve the crown. Can someone fax over the X-rays?","classification_source":"ai","caller":{"name":"Karen — Delta Dental","phone":"+15551008003","country":"US"}}'),

-- ---- Applicant (score 2) ----
(v_demo_id, v_demo_id, 'DEMO_031', 'inbound', '+15551009001', '+15551234567', NOW() - INTERVAL '4 days 11 hours', 167, 2, 'call', 'new', NULL, 'https://cdn.example/demo/rec_031.mp3',
 '{"category":"applicant","caller_name":"Rebecca Lin","caller_number":"+15551009001","caller_city":"Dallas","caller_state":"TX","region":"Dallas, TX","source":"Indeed","source_key":"indeed","system_tags":["Applicant"],"classification_summary":"Dental hygienist calling to inquire about open positions.","classification_reasoning":"Job inquiry — refer to HR.","summary":"Dental hygienist calling to inquire about open positions.","transcript":"Hi, I''m a registered dental hygienist and I saw that you might be looking for staff. I have five years of experience and I just moved to the area. Would it be possible to submit my resume? I''m really interested in joining a family practice like yours.","classification_source":"ai","caller":{"name":"Rebecca Lin","phone":"+15551009001","city":"Dallas","state":"TX","country":"US"}}'),

-- ---- Returning callers (repeat — same phone as earlier entry) ----
(v_demo_id, v_demo_id, 'DEMO_032', 'inbound', '+15551001001', '+15551234703', NOW() - INTERVAL '1 day 10 hours', 134, 3, 'call', 'returning_customer', v_tn_organic, 'https://cdn.example/demo/rec_032.mp3',
 '{"category":"warm","caller_name":"Jessica Martinez","caller_number":"+15551001001","caller_city":"Plano","caller_state":"TX","region":"Plano, TX","source":"Google Search","source_key":"google_organic","system_tags":["Repeat Caller","Existing Client"],"classification_summary":"Previous caller following up — ready to schedule cleaning appointment.","classification_reasoning":"Follow-up from first inquiry — ready to book.","summary":"Previous caller following up — ready to schedule cleaning appointment.","transcript":"Hi, I called a couple days ago about a cleaning. I checked with my insurance and I''m all set. Can I schedule for sometime next week? Tuesday or Wednesday would work best for me.","classification_source":"ai","caller":{"name":"Jessica Martinez","phone":"+15551001001","city":"Plano","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_033', 'inbound', '+15551001002', '+15551234702', NOW() - INTERVAL '1 day 14 hours', 98, 3, 'call', 'returning_customer', v_tn_facebook, 'https://cdn.example/demo/rec_033.mp3',
 '{"category":"very_hot","caller_name":"Robert Chen","caller_number":"+15551001002","caller_city":"Frisco","caller_state":"TX","region":"Frisco, TX","source":"Facebook Ads","source_key":"facebook_ads","system_tags":["Repeat Caller","Existing Client"],"classification_summary":"Parent calling back to confirm children''s appointments.","classification_reasoning":"Confirmation of previously booked visits.","summary":"Parent calling back to confirm children''s appointments.","transcript":"Hi, I called earlier this week about my two kids. I just wanted to confirm their appointments — Tuesday at 3:30 for both of them, right? Great, we''ll see you then!","classification_source":"ai","caller":{"name":"Robert Chen","phone":"+15551001002","city":"Frisco","state":"TX","country":"US"}}'),

-- ---- Form submissions surfaced as call_logs (provider=form) ----
(v_demo_id, v_demo_id, 'DEMO_034', 'inbound', '+15552004001', NULL, NOW() - INTERVAL '3 days 20 hours', 0, 3, 'form', 'new', NULL, NULL,
 '{"category":"very_hot","caller_name":"Amanda Richards","caller_number":"+15552004001","caller_email":"amanda.r@example.com","caller_city":"Frisco","caller_state":"TX","region":"Frisco, TX","source":"Google Ads","source_key":"google_ads","form_name":"Whitening Consultation Request","provider":"form","system_tags":[],"classification_summary":"Website contact form — new patient requesting appointment for teeth whitening.","classification_reasoning":"Time-bound (wedding in 6 weeks) — high-intent cosmetic lead.","summary":"Website contact form — new patient requesting appointment for teeth whitening.","transcript":"Name: Amanda Richards\nEmail: amanda.r@example.com\nPhone: (555) 200-4001\nMessage: Hi! I''d like to schedule a teeth whitening consultation. I have a wedding coming up in 6 weeks and want my smile to look perfect. What are my options?","message":"Hi! I''d like to schedule a teeth whitening consultation. I have a wedding coming up in 6 weeks and want my smile to look perfect. What are my options?","classification_source":"ai","caller":{"name":"Amanda Richards","phone":"+15552004001","email":"amanda.r@example.com","city":"Frisco","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_035', 'inbound', '+15552004002', NULL, NOW() - INTERVAL '7 days 22 hours', 0, 3, 'form', 'new', NULL, NULL,
 '{"category":"warm","caller_name":"Robert Kim","caller_number":"+15552004002","caller_email":"rkim77@example.com","caller_city":"Plano","caller_state":"TX","region":"Plano, TX","source":"Organic Search","source_key":"google_organic","form_name":"Contact Us","provider":"form","system_tags":[],"classification_summary":"Website contact form — patient asking about insurance acceptance.","classification_reasoning":"Insurance-qualifying inquiry, lapsed patient.","summary":"Website contact form — patient asking about insurance acceptance.","transcript":"Name: Robert Kim\nEmail: rkim77@example.com\nPhone: (555) 200-4002\nMessage: Do you accept MetLife dental insurance? I need a checkup and possibly some fillings. I haven''t been to the dentist in about 2 years.","message":"Do you accept MetLife dental insurance? I need a checkup and possibly some fillings. I haven''t been to the dentist in about 2 years.","classification_source":"ai","caller":{"name":"Robert Kim","phone":"+15552004002","email":"rkim77@example.com","city":"Plano","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_036', 'inbound', NULL, NULL, NOW() - INTERVAL '10 days 18 hours', 0, 1, 'form', 'new', NULL, NULL,
 '{"category":"spam","caller_name":"SEO Expert","caller_number":null,"caller_email":"marketing@spamsite.biz","caller_city":"","caller_state":"","region":"","source":"Direct","source_key":"direct","form_name":"Contact Us","provider":"form","system_tags":[],"classification_summary":"Spam form submission — marketing pitch for website redesign.","classification_reasoning":"Promotional spam content, not a patient.","summary":"Spam form submission — marketing pitch for website redesign.","transcript":"Name: SEO Expert\nEmail: marketing@spamsite.biz\nMessage: YOUR WEBSITE NEEDS HELP!!! We can get you to #1 on Google GUARANTEED. Special offer this week only: $99/month for unlimited SEO. Call now!!!","message":"YOUR WEBSITE NEEDS HELP!!! We can get you to #1 on Google GUARANTEED. Special offer this week only: $99/month for unlimited SEO. Call now!!!","classification_source":"ai","caller":{"name":"SEO Expert","email":"marketing@spamsite.biz","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_037', 'inbound', '+15552004003', NULL, NOW() - INTERVAL '14 days 10 hours', 0, 3, 'form', 'new', NULL, NULL,
 '{"category":"warm","caller_name":"Patricia Nguyen","caller_number":"+15552004003","caller_email":"p.nguyen@example.com","caller_city":"Carrollton","caller_state":"TX","region":"Carrollton, TX","source":"Facebook Ads","source_key":"facebook_ads","form_name":"Contact Us","provider":"form","system_tags":[],"classification_summary":"Website contact form — question about dental implant pricing.","classification_reasoning":"Specialty service inquiry, no insurance — needs financing options.","summary":"Website contact form — question about dental implant pricing.","transcript":"Name: Patricia Nguyen\nEmail: p.nguyen@example.com\nPhone: (555) 200-4003\nMessage: I lost a front tooth in an accident and my dentist recommended an implant. Can you give me a ballpark on cost? I don''t have dental insurance currently.","message":"I lost a front tooth in an accident and my dentist recommended an implant. Can you give me a ballpark on cost? I don''t have dental insurance currently.","classification_source":"ai","caller":{"name":"Patricia Nguyen","phone":"+15552004003","email":"p.nguyen@example.com","city":"Carrollton","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_038', 'inbound', '+15552004004', NULL, NOW() - INTERVAL '18 days 16 hours', 0, 2, 'form', 'new', NULL, NULL,
 '{"category":"applicant","caller_name":"Jessica Taylor","caller_number":"+15552004004","caller_email":"jtaylor.dental@example.com","caller_city":"Allen","caller_state":"TX","region":"Allen, TX","source":"Indeed","source_key":"indeed","form_name":"Contact Us","provider":"form","system_tags":["Applicant"],"classification_summary":"Online application for dental assistant position.","classification_reasoning":"Job application — refer to HR.","summary":"Online application for dental assistant position.","transcript":"Name: Jessica Taylor\nEmail: jtaylor.dental@example.com\nPhone: (555) 200-4004\nMessage: I''m a certified dental assistant with 3 years of experience. I saw your Indeed posting and wanted to apply directly. I''m available for interviews any time this week. Resume attached.","message":"I''m a certified dental assistant with 3 years of experience. I saw your Indeed posting and wanted to apply directly. I''m available for interviews any time this week. Resume attached.","classification_source":"ai","caller":{"name":"Jessica Taylor","phone":"+15552004004","email":"jtaylor.dental@example.com","city":"Allen","state":"TX","country":"US"}}'),

-- ---- Outbound calls ----
(v_demo_id, v_demo_id, 'DEMO_039', 'outbound', '+15551234567', '+15551001003', NOW() - INTERVAL '5 days 10 hours', 145, 3, 'call', 'new', NULL, 'https://cdn.example/demo/rec_039.mp3',
 '{"category":"warm","caller_name":"Marcus Williams","caller_number":"+15551001003","caller_city":"Allen","caller_state":"TX","region":"Allen, TX","source":"Outbound Follow-up","source_key":"outbound","system_tags":[],"classification_summary":"Outbound follow-up to emergency patient — confirmed appointment time.","classification_reasoning":"Outbound from staff to confirm same-day visit.","summary":"Outbound follow-up to emergency patient — confirmed appointment time.","transcript":"Hi, this is Sarah from Bright Smiles. I''m calling back about your toothache. Dr. Martinez can see you at 2:00 PM today. Does that work? Great, please bring your insurance card and arrive 15 minutes early to fill out paperwork.","classification_source":"ai","caller":{"name":"Marcus Williams","phone":"+15551001003","city":"Allen","state":"TX","country":"US"}}'),
(v_demo_id, v_demo_id, 'DEMO_040', 'outbound', '+15551234567', '+15551002001', NOW() - INTERVAL '1 day 15 hours', 178, 3, 'call', 'new', NULL, 'https://cdn.example/demo/rec_040.mp3',
 '{"category":"warm","caller_name":"Ashley Rodriguez","caller_number":"+15551002001","caller_city":"Carrollton","caller_state":"TX","region":"Carrollton, TX","source":"Outbound Follow-up","source_key":"outbound","system_tags":[],"classification_summary":"Follow-up call to warm lead — discussed insurance and scheduled first visit.","classification_reasoning":"Outbound nurture call — converted to booked appointment.","summary":"Follow-up call to warm lead — discussed insurance and scheduled first visit.","transcript":"Hi, this is Sarah from Bright Smiles Family Dentistry. You called earlier about pricing and insurance. I wanted to let you know we do accept Aetna — your plan covers two cleanings per year. Would you like to go ahead and schedule? We have openings next Thursday.","classification_source":"ai","caller":{"name":"Ashley Rodriguez","phone":"+15551002001","city":"Carrollton","state":"TX","country":"US"}}');

-- ============================================================================
-- 9. CTM FORM SUBMISSIONS — linked to the form-type call_logs above
-- ============================================================================
DELETE FROM ctm_form_submissions WHERE form_id IN (v_form_contact, v_form_whitening);

INSERT INTO ctm_form_submissions (
  form_id, field_data, attribution_json, ctm_reactor_id, ip_address, user_agent, spam, hashed_phone, created_at
) VALUES
  (v_form_whitening,
    '{"name":"Amanda Richards","email":"amanda.r@example.com","phone_number":"+15552004001","event_date":"2026-06-25","message":"Hi! I''d like to schedule a teeth whitening consultation. I have a wedding coming up in 6 weeks and want my smile to look perfect. What are my options?"}'::jsonb,
    '{"utm_source":"google","utm_medium":"cpc","utm_campaign":"whitening-spring","gclid":"DEMO-GCLID-AMANDA-001","landing_page":"https://brightsmilesdental.example/whitening","referrer":"https://www.google.com/"}'::jsonb,
    'DEMO_REACTOR_034', '203.0.113.41', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    FALSE, encode(digest('5552004001', 'sha256'), 'hex'), NOW() - INTERVAL '3 days 20 hours'),
  (v_form_contact,
    '{"name":"Robert Kim","email":"rkim77@example.com","phone_number":"+15552004002","message":"Do you accept MetLife dental insurance? I need a checkup and possibly some fillings. I haven''t been to the dentist in about 2 years."}'::jsonb,
    '{"utm_source":"google","utm_medium":"organic","landing_page":"https://brightsmilesdental.example/insurance","referrer":"https://www.google.com/"}'::jsonb,
    'DEMO_REACTOR_035', '198.51.100.22', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    FALSE, encode(digest('5552004002', 'sha256'), 'hex'), NOW() - INTERVAL '7 days 22 hours'),
  (v_form_contact,
    '{"name":"SEO Expert","email":"marketing@spamsite.biz","message":"YOUR WEBSITE NEEDS HELP!!! We can get you to #1 on Google GUARANTEED. Special offer this week only: $99/month for unlimited SEO. Call now!!!"}'::jsonb,
    '{"utm_source":"direct","landing_page":"https://brightsmilesdental.example/contact"}'::jsonb,
    NULL, '192.0.2.99', 'curl/8.4.0',
    TRUE, NULL, NOW() - INTERVAL '10 days 18 hours'),
  (v_form_contact,
    '{"name":"Patricia Nguyen","email":"p.nguyen@example.com","phone_number":"+15552004003","message":"I lost a front tooth in an accident and my dentist recommended an implant. Can you give me a ballpark on cost? I don''t have dental insurance currently."}'::jsonb,
    '{"utm_source":"facebook","utm_medium":"cpc","utm_campaign":"implants-q2","fbclid":"DEMO-FBCLID-PATRICIA-001","landing_page":"https://brightsmilesdental.example/implants","referrer":"https://l.facebook.com/"}'::jsonb,
    'DEMO_REACTOR_037', '203.0.113.88', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    FALSE, encode(digest('5552004003', 'sha256'), 'hex'), NOW() - INTERVAL '14 days 10 hours'),
  (v_form_contact,
    '{"name":"Jessica Taylor","email":"jtaylor.dental@example.com","phone_number":"+15552004004","message":"I''m a certified dental assistant with 3 years of experience. I saw your Indeed posting and wanted to apply directly. I''m available for interviews any time this week. Resume attached."}'::jsonb,
    '{"utm_source":"indeed","utm_medium":"referral","utm_campaign":"hiring-dental-assistant","landing_page":"https://brightsmilesdental.example/careers","referrer":"https://www.indeed.com/"}'::jsonb,
    'DEMO_REACTOR_038', '198.51.100.55', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    FALSE, encode(digest('5552004004', 'sha256'), 'hex'), NOW() - INTERVAL '18 days 16 hours');

-- ============================================================================
-- 10. ATTRIBUTION SESSIONS — visitor sessions, some converted to calls/forms
-- ============================================================================
DELETE FROM attribution_sessions WHERE client_user_id = v_demo_id;

INSERT INTO attribution_sessions (
  session_id, client_user_id, tracking_number_id,
  visitor_data, gclid, fbclid, utm_source, utm_medium, utm_campaign,
  landing_page, referrer, expires_at, call_log_id, form_submission_id, created_at
) VALUES
  ('DEMO_SESS_001', v_demo_id, v_tn_organic,
    '{"device":"desktop","browser":"Chrome","os":"macOS","city":"Plano","state":"TX"}'::jsonb,
    NULL, NULL, 'google', 'organic', NULL,
    'https://brightsmilesdental.example/', 'https://www.google.com/',
    NOW() - INTERVAL '1 day 22 hours',
    (SELECT id FROM call_logs WHERE call_id = 'DEMO_001'), NULL,
    NOW() - INTERVAL '2 days 11 hours'),
  ('DEMO_SESS_002', v_demo_id, v_tn_facebook,
    '{"device":"mobile","browser":"Safari","os":"iOS","city":"Frisco","state":"TX"}'::jsonb,
    NULL, 'DEMO-FBCLID-ROBERT-001', 'facebook', 'cpc', 'pediatric-spring',
    'https://brightsmilesdental.example/pediatric', 'https://l.facebook.com/',
    NOW() - INTERVAL '3 days 23 hours',
    (SELECT id FROM call_logs WHERE call_id = 'DEMO_002'), NULL,
    NOW() - INTERVAL '4 days 15 hours'),
  ('DEMO_SESS_003', v_demo_id, v_tn_google,
    '{"device":"mobile","browser":"Chrome","os":"Android","city":"Allen","state":"TX"}'::jsonb,
    'DEMO-GCLID-MARCUS-001', NULL, 'google', 'cpc', 'emergency-dentist',
    'https://brightsmilesdental.example/emergency', 'https://www.google.com/',
    NOW() - INTERVAL '4 days 22 hours',
    (SELECT id FROM call_logs WHERE call_id = 'DEMO_003'), NULL,
    NOW() - INTERVAL '5 days 10 hours'),
  ('DEMO_SESS_006', v_demo_id, v_tn_google,
    '{"device":"desktop","browser":"Firefox","os":"Windows","city":"Carrollton","state":"TX"}'::jsonb,
    'DEMO-GCLID-ASHLEY-001', NULL, 'google', 'cpc', 'cleanings-general',
    'https://brightsmilesdental.example/pricing', 'https://www.google.com/',
    NOW() - INTERVAL '23 hours',
    (SELECT id FROM call_logs WHERE call_id = 'DEMO_006'), NULL,
    NOW() - INTERVAL '1 day 14 hours'),
  ('DEMO_SESS_007', v_demo_id, v_tn_organic,
    '{"device":"desktop","browser":"Safari","os":"macOS","city":"Plano","state":"TX"}'::jsonb,
    NULL, NULL, 'google', 'organic', NULL,
    'https://brightsmilesdental.example/cosmetic/veneers', 'https://www.google.com/',
    NOW() - INTERVAL '2 days 23 hours',
    (SELECT id FROM call_logs WHERE call_id = 'DEMO_007'), NULL,
    NOW() - INTERVAL '3 days 17 hours'),
  ('DEMO_SESS_008', v_demo_id, v_tn_facebook,
    '{"device":"mobile","browser":"Instagram","os":"iOS","city":"Frisco","state":"TX"}'::jsonb,
    NULL, 'DEMO-FBCLID-HEATHER-001', 'instagram', 'cpc', 'pediatric-spring',
    'https://brightsmilesdental.example/pediatric', 'https://l.instagram.com/',
    NOW() - INTERVAL '5 days 23 hours',
    (SELECT id FROM call_logs WHERE call_id = 'DEMO_008'), NULL,
    NOW() - INTERVAL '6 days 11 hours'),
  ('DEMO_SESS_010', v_demo_id, v_tn_google,
    '{"device":"desktop","browser":"Chrome","os":"Windows","city":"Tucson","state":"AZ"}'::jsonb,
    'DEMO-GCLID-BRIAN-001', NULL, 'google', 'cpc', 'sedation-dentistry',
    'https://brightsmilesdental.example/sedation', 'https://www.google.com/',
    NOW() - INTERVAL '10 days 23 hours',
    (SELECT id FROM call_logs WHERE call_id = 'DEMO_010'), NULL,
    NOW() - INTERVAL '11 days 12 hours'),
  ('DEMO_SESS_022', v_demo_id, v_tn_organic,
    '{"device":"mobile","browser":"Chrome","os":"Android","city":"Plano","state":"TX"}'::jsonb,
    NULL, NULL, 'google', 'organic', NULL,
    'https://brightsmilesdental.example/services', 'https://www.google.com/',
    NOW() - INTERVAL '4 days 23 hours',
    (SELECT id FROM call_logs WHERE call_id = 'DEMO_022'), NULL,
    NOW() - INTERVAL '5 days 14 hours'),
  -- Form-attributed sessions
  ('DEMO_SESS_F034', v_demo_id, NULL,
    '{"device":"mobile","browser":"Safari","os":"iOS","city":"Frisco","state":"TX"}'::jsonb,
    'DEMO-GCLID-AMANDA-001', NULL, 'google', 'cpc', 'whitening-spring',
    'https://brightsmilesdental.example/whitening', 'https://www.google.com/',
    NOW() - INTERVAL '2 days 21 hours',
    NULL, NULL,
    NOW() - INTERVAL '3 days 21 hours'),
  ('DEMO_SESS_F037', v_demo_id, NULL,
    '{"device":"mobile","browser":"Chrome","os":"Android","city":"Carrollton","state":"TX"}'::jsonb,
    NULL, 'DEMO-FBCLID-PATRICIA-001', 'facebook', 'cpc', 'implants-q2',
    'https://brightsmilesdental.example/implants', 'https://l.facebook.com/',
    NOW() - INTERVAL '13 days 11 hours',
    NULL, NULL,
    NOW() - INTERVAL '14 days 11 hours');

-- ============================================================================
-- 11. CALL ATTRIBUTION — full marketing detail per converted call
-- ============================================================================
DELETE FROM call_attribution WHERE client_user_id = v_demo_id;

INSERT INTO call_attribution (
  call_log_id, session_id, client_user_id,
  gclid, gbraid, wbraid, fbclid, fbc, fbp,
  utm_source, utm_medium, utm_campaign, utm_content, utm_term,
  landing_page_url, referrer_url, user_agent, ip_hash
) VALUES
  ((SELECT id FROM call_logs WHERE call_id = 'DEMO_001'), 'DEMO_SESS_001', v_demo_id,
    NULL, NULL, NULL, NULL, NULL, NULL,
    'google', 'organic', NULL, NULL, 'family dentist plano',
    'https://brightsmilesdental.example/', 'https://www.google.com/',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    encode(digest('203.0.113.10', 'sha256'), 'hex')),
  ((SELECT id FROM call_logs WHERE call_id = 'DEMO_002'), 'DEMO_SESS_002', v_demo_id,
    NULL, NULL, NULL, 'DEMO-FBCLID-ROBERT-001', 'fb.1.1715000000.DEMO-FBCLID-ROBERT-001', 'fb.1.1715000000.DEMO-FBP-002',
    'facebook', 'cpc', 'pediatric-spring', 'carousel-kids-01', NULL,
    'https://brightsmilesdental.example/pediatric', 'https://l.facebook.com/',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1',
    encode(digest('203.0.113.20', 'sha256'), 'hex')),
  ((SELECT id FROM call_logs WHERE call_id = 'DEMO_003'), 'DEMO_SESS_003', v_demo_id,
    'DEMO-GCLID-MARCUS-001', 'DEMO-GBRAID-001', NULL, NULL, NULL, NULL,
    'google', 'cpc', 'emergency-dentist', 'rsa-emergency-01', 'emergency dentist near me',
    'https://brightsmilesdental.example/emergency', 'https://www.google.com/',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/124.0.0.0 Mobile',
    encode(digest('203.0.113.30', 'sha256'), 'hex')),
  ((SELECT id FROM call_logs WHERE call_id = 'DEMO_006'), 'DEMO_SESS_006', v_demo_id,
    'DEMO-GCLID-ASHLEY-001', NULL, NULL, NULL, NULL, NULL,
    'google', 'cpc', 'cleanings-general', 'rsa-cleaning-01', 'teeth cleaning cost',
    'https://brightsmilesdental.example/pricing', 'https://www.google.com/',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/124.0',
    encode(digest('203.0.113.60', 'sha256'), 'hex')),
  ((SELECT id FROM call_logs WHERE call_id = 'DEMO_007'), 'DEMO_SESS_007', v_demo_id,
    NULL, NULL, NULL, NULL, NULL, NULL,
    'google', 'organic', NULL, NULL, 'porcelain veneers plano',
    'https://brightsmilesdental.example/cosmetic/veneers', 'https://www.google.com/',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/17.4',
    encode(digest('203.0.113.70', 'sha256'), 'hex')),
  ((SELECT id FROM call_logs WHERE call_id = 'DEMO_008'), 'DEMO_SESS_008', v_demo_id,
    NULL, NULL, NULL, 'DEMO-FBCLID-HEATHER-001', 'fb.1.1715000000.DEMO-FBCLID-HEATHER-001', 'fb.1.1715000000.DEMO-FBP-008',
    'instagram', 'cpc', 'pediatric-spring', 'reel-pediatric-02', NULL,
    'https://brightsmilesdental.example/pediatric', 'https://l.instagram.com/',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Instagram 327.0',
    encode(digest('203.0.113.80', 'sha256'), 'hex')),
  ((SELECT id FROM call_logs WHERE call_id = 'DEMO_010'), 'DEMO_SESS_010', v_demo_id,
    'DEMO-GCLID-BRIAN-001', NULL, NULL, NULL, NULL, NULL,
    'google', 'cpc', 'sedation-dentistry', 'rsa-sedation-01', 'sedation dentist anxiety',
    'https://brightsmilesdental.example/sedation', 'https://www.google.com/',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0',
    encode(digest('203.0.113.95', 'sha256'), 'hex')),
  ((SELECT id FROM call_logs WHERE call_id = 'DEMO_022'), 'DEMO_SESS_022', v_demo_id,
    NULL, NULL, NULL, NULL, NULL, NULL,
    'google', 'organic', NULL, NULL, 'orthodontist plano',
    'https://brightsmilesdental.example/services', 'https://www.google.com/',
    'Mozilla/5.0 (Linux; Android 13) Chrome/124.0.0.0',
    encode(digest('203.0.113.220', 'sha256'), 'hex'));

-- ============================================================================
-- 12. ACTIVE CLIENTS (converted leads)
-- ============================================================================
-- active_clients carries both the legacy `user_id` (NOT NULL) and the newer
-- `owner_user_id`; both point at the owner. Set both so the NOT NULL holds.
INSERT INTO active_clients (id, user_id, owner_user_id, client_name, client_phone, client_email, source, status, created_at)
VALUES
  (v_ac1, v_demo_id, v_demo_id, 'Jennifer Torres', '+15551003001', 'jtorres@example.com', 'phone', 'active', NOW() - INTERVAL '60 days'),
  (v_ac2, v_demo_id, v_demo_id, 'Marcus Williams', '+15551010001', 'mwilliams@example.com', 'phone', 'active', NOW() - INTERVAL '45 days'),
  (v_ac3, v_demo_id, v_demo_id, 'Lisa Chen', '+15551010002', 'lchen@example.com', 'referral', 'active', NOW() - INTERVAL '30 days')
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  owner_user_id = EXCLUDED.owner_user_id,
  client_name = EXCLUDED.client_name,
  updated_at = NOW();

DELETE FROM client_services WHERE active_client_id IN (v_ac1, v_ac2, v_ac3);
INSERT INTO client_services (active_client_id, service_id, agreed_price, agreed_date)
VALUES
  (v_ac1, v_svc_seo, 1500.00, NOW() - INTERVAL '60 days'),
  (v_ac1, v_svc_web, 500.00, NOW() - INTERVAL '60 days'),
  (v_ac2, v_svc_ads, 2000.00, NOW() - INTERVAL '45 days'),
  (v_ac2, v_svc_seo, 1500.00, NOW() - INTERVAL '45 days'),
  (v_ac3, v_svc_social, 1200.00, NOW() - INTERVAL '30 days')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 13. CLIENT JOURNEYS (lead pipeline entries)
-- ============================================================================
INSERT INTO client_journeys (id, owner_user_id, lead_call_key, client_name, client_phone, client_email, status, created_at, updated_at) VALUES
  (v_j1, v_demo_id, 'DEMO_001', 'Jessica Martinez (Cleaning + Whitening)', '+15551001001', NULL, 'in_progress', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day'),
  (v_j2, v_demo_id, 'DEMO_002', 'Chen Kids (Pediatric)', '+15551001002', NULL, 'in_progress', NOW() - INTERVAL '4 days', NOW() - INTERVAL '1 day'),
  (v_j3, v_demo_id, 'DEMO_004', 'Emma Thompson (Invisalign)', '+15551001004', NULL, 'pending', NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days'),
  (v_j4, v_demo_id, 'DEMO_005', 'David Patel (Implant Referral)', '+15551001005', NULL, 'pending', NOW() - INTERVAL '12 days', NOW() - INTERVAL '12 days'),
  (v_j5, v_demo_id, 'DEMO_034', 'Amanda Richards (Whitening)', NULL, 'amanda.r@example.com', 'in_progress', NOW() - INTERVAL '3 days', NOW() - INTERVAL '2 days'),
  (v_j6, v_demo_id, 'DEMO_003', 'Marcus Williams (Emergency Crown)', '+15551001003', NULL, 'won', NOW() - INTERVAL '5 days', NOW() - INTERVAL '4 days'),
  (v_j7, v_demo_id, 'DEMO_011', 'Natalie Brooks (New Patient Special)', '+15551002006', NULL, 'won', NOW() - INTERVAL '14 days', NOW() - INTERVAL '10 days'),
  (v_j8, v_demo_id, 'DEMO_022', 'Tyler Brooks (Ortho Referral Out)', '+15551006001', NULL, 'lost', NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days'),
  (v_j9, v_demo_id, 'DEMO_010', 'Brian Foster (Sedation, Out of State)', '+15551002005', NULL, 'lost', NOW() - INTERVAL '11 days', NOW() - INTERVAL '9 days')
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  client_name = EXCLUDED.client_name,
  updated_at = NOW();

DELETE FROM client_journey_steps WHERE journey_id IN (v_j1, v_j2, v_j3, v_j4, v_j5, v_j6, v_j7, v_j8, v_j9);
INSERT INTO client_journey_steps (journey_id, position, label, channel, message, due_at, completed_at) VALUES
  (v_j1, 1, 'Initial callback', 'phone', 'Call back to schedule cleaning', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day 10 hours'),
  (v_j1, 2, 'Appointment confirmation', 'email', 'Send appointment details', NOW() + INTERVAL '1 day', NULL),
  (v_j2, 1, 'Verify insurance', 'phone', 'Confirm insurance covers pediatric visits', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'),
  (v_j2, 2, 'Schedule visit', 'phone', 'Book after-school appointment', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'),
  (v_j2, 3, 'Send new patient forms', 'email', 'Email intake forms to parent', NOW() + INTERVAL '2 days', NULL),
  (v_j3, 1, 'Send Invisalign info packet', 'email', 'Email brochure and pricing', NOW() - INTERVAL '6 days', NULL),
  (v_j4, 1, 'Request X-rays from referring dentist', 'email', 'Contact referring office for records', NOW() - INTERVAL '10 days', NULL),
  (v_j5, 1, 'Reply to form submission', 'email', 'Send whitening options and pricing', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'),
  (v_j5, 2, 'Follow-up call', 'phone', 'Call to discuss timeline before wedding', NOW() + INTERVAL '1 day', NULL),
  -- Won: Marcus Williams emergency crown
  (v_j6, 1, 'Same-day emergency exam', 'in_person', 'Diagnosis + temporary crown', NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days'),
  (v_j6, 2, 'Permanent crown seated', 'in_person', 'Final fit + bite check', NOW() - INTERVAL '4 days', NOW() - INTERVAL '4 days'),
  (v_j6, 3, 'Post-op follow-up call', 'phone', 'Confirm no sensitivity', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'),
  -- Won: Natalie Brooks new patient
  (v_j7, 1, 'New patient intake call', 'phone', 'Confirm referral source + book', NOW() - INTERVAL '13 days', NOW() - INTERVAL '13 days'),
  (v_j7, 2, 'Cleaning + crown consult', 'in_person', 'First visit completed', NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days'),
  -- Lost: Tyler Brooks (referred out)
  (v_j8, 1, 'Refer to ortho partner', 'email', 'Sent partner contact info', NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days'),
  -- Lost: Brian Foster (out of state)
  (v_j9, 1, 'Discuss sedation options', 'phone', 'Patient ultimately chose local provider', NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days')
ON CONFLICT DO NOTHING;

DELETE FROM client_journey_notes WHERE journey_id IN (v_j1, v_j2, v_j3, v_j4, v_j5, v_j6, v_j7, v_j8, v_j9);
INSERT INTO client_journey_notes (journey_id, author_id, body, created_at) VALUES
  (v_j1, v_demo_id, 'Patient called back and confirmed Tuesday works. Will need new patient paperwork.', NOW() - INTERVAL '1 day'),
  (v_j2, v_team1_id, 'Insurance verified — both kids are covered for cleanings and X-rays. Scheduled for Tuesday 3:30 PM.', NOW() - INTERVAL '2 days'),
  (v_j5, v_demo_id, 'Wedding is June 15th. Recommended in-office whitening for fastest results. Patient is very motivated.', NOW() - INTERVAL '2 days'),
  (v_j3, v_demo_id, 'Sent info packet. Patient said they''ll review and call back next week.', NOW() - INTERVAL '5 days'),
  (v_j6, v_team1_id, 'Crown placement went smoothly. Patient was relieved we got him in same-day.', NOW() - INTERVAL '4 days'),
  (v_j7, v_demo_id, 'Referral from existing patient. Booked cleaning + crown consult. Loved the office.', NOW() - INTERVAL '10 days'),
  (v_j8, v_demo_id, 'Not a fit — orthodontic case. Referred to Dr. Wong''s office in Plano.', NOW() - INTERVAL '5 days'),
  (v_j9, v_team1_id, 'Out-of-state caller chose to stay local. Wished us well, no hard feelings.', NOW() - INTERVAL '9 days')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 14. DOCUMENTS
-- ============================================================================
DELETE FROM documents WHERE user_id = v_demo_id;
INSERT INTO documents (user_id, label, name, origin, type, created_at) VALUES
  (v_demo_id, 'Practice Logo (Primary)', 'bright-smiles-logo.png', 'client', 'client', NOW() - INTERVAL '85 days'),
  (v_demo_id, 'Insurance Verification Form', 'insurance-verification.pdf', 'admin', 'admin', NOW() - INTERVAL '80 days'),
  (v_demo_id, 'Brand Guidelines', 'brand-guidelines-2024.pdf', 'client', 'client', NOW() - INTERVAL '75 days'),
  (v_demo_id, 'Social Media Content Calendar', 'content-calendar-q2.xlsx', 'admin', 'admin', NOW() - INTERVAL '30 days'),
  (v_demo_id, 'Monthly SEO Report', 'seo-report-march.pdf', 'admin', 'admin', NOW() - INTERVAL '15 days')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 15. NOTIFICATIONS
-- ============================================================================
DELETE FROM notifications WHERE user_id = v_demo_id;
INSERT INTO notifications (user_id, title, body, status, created_at) VALUES
  (v_demo_id, 'Welcome to Anchor!', 'Your dashboard is all set up. Explore your call tracking, lead management, and analytics.', 'read', NOW() - INTERVAL '85 days'),
  (v_demo_id, 'New lead: Emergency toothache', 'A new high-priority call came in from a patient with a dental emergency.', 'read', NOW() - INTERVAL '5 days'),
  (v_demo_id, 'Monthly report ready', 'Your March SEO report has been uploaded to Documents.', 'read', NOW() - INTERVAL '15 days'),
  (v_demo_id, 'Team member joined', 'Mike Chen accepted the team invitation and can now access the dashboard.', 'read', NOW() - INTERVAL '59 days'),
  (v_demo_id, 'New form submission', 'Amanda Richards submitted a contact form requesting a whitening consultation.', 'unread', NOW() - INTERVAL '3 days'),
  (v_demo_id, '5 missed calls this week', 'You had 5 unanswered calls this week. Consider adjusting your after-hours routing.', 'unread', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 16. REVIEWS
-- ============================================================================
INSERT INTO reviews (client_id, platform, platform_review_id, reviewer_name, rating, review_text, review_language, has_response, review_created_at, last_synced_at, created_at) VALUES
  (v_demo_id, 'google', 'DEMO_REV_001', 'Maria S.', 5, 'Dr. Martinez and the whole team are wonderful! I was terrified of the dentist but they made me feel completely at ease. The office is beautiful and modern, and they explained everything before doing it. Highly recommend!', 'en', FALSE, NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days'),
  (v_demo_id, 'google', 'DEMO_REV_002', 'James P.', 5, 'Best dental experience I''ve ever had. Got my teeth cleaned and whitened and the results are amazing. The staff is friendly and professional. Will definitely be coming back!', 'en', FALSE, NOW() - INTERVAL '18 days', NOW() - INTERVAL '18 days', NOW() - INTERVAL '18 days'),
  (v_demo_id, 'google', 'DEMO_REV_003', 'Karen L.', 4, 'Very thorough cleaning and exam. Dr. Martinez took the time to explain what was going on with my teeth. Only giving 4 stars because the wait was a bit long, but the care itself was excellent.', 'en', FALSE, NOW() - INTERVAL '25 days', NOW() - INTERVAL '25 days', NOW() - INTERVAL '25 days'),
  (v_demo_id, 'google', 'DEMO_REV_004', 'Tom R.', 5, 'Brought my kids here for their first dental visit and they loved it! The hygienist was so patient and fun with them. My daughter said she wants to come back — that''s never happened with a dentist before!', 'en', FALSE, NOW() - INTERVAL '32 days', NOW() - INTERVAL '32 days', NOW() - INTERVAL '32 days'),
  (v_demo_id, 'google', 'DEMO_REV_005', 'Anonymous', 2, 'The dentist was fine but the billing department is a nightmare. I was charged for a procedure my insurance should have covered and it took three calls to get it sorted out. Frustrating.', 'en', FALSE, NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days'),
  (v_demo_id, 'google', 'DEMO_REV_006', 'Rachel K.', 5, 'Just got my Invisalign from Bright Smiles and I''m so happy with the process so far. They used a 3D scanner (no gross impressions!) and the treatment plan looks great. Can''t wait to see the final results!', 'en', FALSE, NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days'),
  (v_demo_id, 'google', 'DEMO_REV_007', 'David M.', 4, 'Good experience overall. Had an emergency visit for a chipped tooth and they got me in same day. Appreciate the quick turnaround. Parking can be tricky though.', 'en', FALSE, NOW() - INTERVAL '22 days', NOW() - INTERVAL '22 days', NOW() - INTERVAL '22 days'),
  (v_demo_id, 'google', 'DEMO_REV_008', 'Sandra W.', 5, 'I''ve been a patient at Bright Smiles for 3 years now and wouldn''t go anywhere else. The whole team remembers my name when I walk in. That personal touch means everything. Thank you!', 'en', FALSE, NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days'),
  (v_demo_id, 'google', 'DEMO_REV_009', 'Priya N.', 5, 'My kids actually look forward to the dentist now. The staff is amazing with anxious children — they take their time and explain everything in kid-friendly language. Worth the drive from Frisco.', 'en', TRUE, NOW() - INTERVAL '6 days', NOW() - INTERVAL '6 days', NOW() - INTERVAL '6 days'),
  (v_demo_id, 'google', 'DEMO_REV_010', 'Brandon C.', 4, 'Solid practice. Cleaning was thorough and the dentist answered all my questions. Front desk could be a little warmer but the clinical side is excellent.', 'en', TRUE, NOW() - INTERVAL '12 days', NOW() - INTERVAL '12 days', NOW() - INTERVAL '12 days'),
  (v_demo_id, 'google', 'DEMO_REV_011', 'Anonymous', 3, 'Service was OK. Appointment ran 25 minutes late and nobody acknowledged it. Hygienist did a good job once we got started though.', 'en', TRUE, NOW() - INTERVAL '20 days', NOW() - INTERVAL '20 days', NOW() - INTERVAL '20 days'),
  (v_demo_id, 'google', 'DEMO_REV_012', 'Lauren G.', 5, 'Came in for a second opinion on a crown and Dr. Martinez was honest, thorough, and saved me thousands compared to the other quote. Switching practices immediately.', 'en', FALSE, NOW() - INTERVAL '4 days', NOW() - INTERVAL '4 days', NOW() - INTERVAL '4 days'),
  (v_demo_id, 'google', 'DEMO_REV_013', 'Kevin H.', 5, 'Best dental office in the area. The implant work I had done looks and feels exactly like a natural tooth. Two-year follow-up went perfectly.', 'en', FALSE, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'),
  (v_demo_id, 'google', 'DEMO_REV_014', 'Diane F.', 4, 'Friendly staff and modern equipment. Insurance billing was handled smoothly. Only ding is the parking lot fills up fast at peak hours.', 'en', TRUE, NOW() - INTERVAL '28 days', NOW() - INTERVAL '28 days', NOW() - INTERVAL '28 days')
ON CONFLICT DO NOTHING;

-- Backfill response_text + sentiment on the responded reviews
UPDATE reviews
SET response_text = CASE platform_review_id
    WHEN 'DEMO_REV_009' THEN 'Priya, thank you so much for the kind words! We love seeing your kids and we''re honored you make the drive. See you next visit!'
    WHEN 'DEMO_REV_010' THEN 'Brandon, thanks for the honest feedback. We''ve passed your note along to the front desk team — we''re working on warmer first impressions. Glad the clinical side hit the mark.'
    WHEN 'DEMO_REV_011' THEN 'We''re sorry your appointment ran late and that we didn''t acknowledge it sooner — that''s on us. We''d love a chance to do better next time. Please reach out to the office manager directly.'
    WHEN 'DEMO_REV_014' THEN 'Diane, thank you! Parking is a known sore spot — we''re actively looking at expanding the lot in 2026.'
    ELSE response_text END,
    response_created_at = NOW() - INTERVAL '1 day',
    has_response = TRUE
WHERE client_id = v_demo_id AND platform_review_id IN ('DEMO_REV_009','DEMO_REV_010','DEMO_REV_011','DEMO_REV_014');

UPDATE reviews
SET sentiment_score = CASE WHEN rating >= 4 THEN 0.85 WHEN rating = 3 THEN 0.10 ELSE -0.55 END,
    sentiment_label = CASE WHEN rating >= 4 THEN 'positive' WHEN rating = 3 THEN 'neutral' ELSE 'negative' END,
    sentiment_analyzed_at = NOW() - INTERVAL '1 day'
WHERE client_id = v_demo_id AND sentiment_score IS NULL;

-- Review settings row for the demo client
INSERT INTO review_settings (
  client_id, auto_sync_enabled, sync_interval_minutes,
  notify_new_reviews, notify_negative_reviews, negative_review_threshold,
  default_response_tone, include_business_name_in_response, ai_drafting_enabled,
  response_signature
) VALUES (
  v_demo_id, TRUE, 60,
  TRUE, TRUE, 3,
  'friendly', TRUE, TRUE,
  '— The Bright Smiles Family Dentistry Team'
)
ON CONFLICT (client_id) DO UPDATE SET
  auto_sync_enabled = EXCLUDED.auto_sync_enabled,
  default_response_tone = EXCLUDED.default_response_tone,
  updated_at = NOW();

-- Aggregate review statistics (current 30 days). Compute from the rows we
-- just inserted so the dashboard "Reviews" tab shows non-zero rollups.
DELETE FROM review_statistics WHERE client_id = v_demo_id;
INSERT INTO review_statistics (
  client_id, period_type, period_start, period_end,
  total_reviews, new_reviews, responded_reviews, pending_reviews,
  rating_1_count, rating_2_count, rating_3_count, rating_4_count, rating_5_count,
  average_rating, positive_count, neutral_count, negative_count,
  calculated_at
)
SELECT v_demo_id, 'monthly', date_trunc('month', NOW()), date_trunc('month', NOW()) + INTERVAL '1 month' - INTERVAL '1 second',
  count(*),
  count(*) FILTER (WHERE review_created_at >= NOW() - INTERVAL '30 days'),
  count(*) FILTER (WHERE has_response IS TRUE),
  count(*) FILTER (WHERE has_response IS NOT TRUE),
  count(*) FILTER (WHERE rating = 1),
  count(*) FILTER (WHERE rating = 2),
  count(*) FILTER (WHERE rating = 3),
  count(*) FILTER (WHERE rating = 4),
  count(*) FILTER (WHERE rating = 5),
  ROUND(AVG(rating)::numeric, 2),
  count(*) FILTER (WHERE sentiment_label = 'positive'),
  count(*) FILTER (WHERE sentiment_label = 'neutral'),
  count(*) FILTER (WHERE sentiment_label = 'negative'),
  NOW()
FROM reviews WHERE client_id = v_demo_id;

-- ============================================================================
-- 17. TASKS — workspace, board, status labels, groups, items, subitems
-- ============================================================================
INSERT INTO task_workspaces (id, name, created_by, created_at)
VALUES (v_ws_ops, 'Bright Smiles Operations', v_demo_id, NOW() - INTERVAL '70 days')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Workspace memberships: owner + 2 team
DELETE FROM task_workspace_memberships WHERE workspace_id = v_ws_ops;
INSERT INTO task_workspace_memberships (workspace_id, user_id, role, created_at) VALUES
  (v_ws_ops, v_demo_id,  'owner',  NOW() - INTERVAL '70 days'),
  (v_ws_ops, v_team1_id, 'admin',  NOW() - INTERVAL '68 days'),
  (v_ws_ops, v_team2_id, 'member', NOW() - INTERVAL '55 days');

INSERT INTO task_boards (id, workspace_id, name, description, board_prefix, created_by, created_at)
VALUES (v_board_ppl, v_ws_ops, 'Patient Pipeline', 'Track new leads, in-flight outreach, and confirmed bookings.', 'BSP', v_demo_id, NOW() - INTERVAL '70 days')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

-- Status label palette
DELETE FROM task_board_status_labels WHERE board_id = v_board_ppl;
INSERT INTO task_board_status_labels (id, board_id, label, color, order_index, is_done_state, created_at) VALUES
  (v_sl_todo,  v_board_ppl, 'Not Started',         '#9e9e9e', 0, FALSE, NOW() - INTERVAL '70 days'),
  (v_sl_wip,   v_board_ppl, 'In Progress',         '#1e88e5', 1, FALSE, NOW() - INTERVAL '70 days'),
  (v_sl_wait,  v_board_ppl, 'Waiting on Patient',  '#fb8c00', 2, FALSE, NOW() - INTERVAL '70 days'),
  (v_sl_stuck, v_board_ppl, 'Stuck',               '#e53935', 3, FALSE, NOW() - INTERVAL '70 days'),
  (v_sl_done,  v_board_ppl, 'Done',                '#43a047', 4, TRUE,  NOW() - INTERVAL '70 days');

INSERT INTO task_groups (id, board_id, name, order_index) VALUES
  (v_grp_new,  v_board_ppl, 'New Leads',   0),
  (v_grp_wip,  v_board_ppl, 'In Progress', 1),
  (v_grp_done, v_board_ppl, 'Done',        2)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, order_index = EXCLUDED.order_index;

-- Items: scoped delete then insert (status references the label uuid as text)
DELETE FROM task_items WHERE group_id IN (v_grp_new, v_grp_wip, v_grp_done);
INSERT INTO task_items (id, group_id, name, status, start_date, due_date, needs_attention, created_by, created_at, updated_at) VALUES
  -- New Leads
  ('00000000-0000-4000-1000-000000000040', v_grp_new,  'Call back Jessica Martinez re: cleaning',          v_sl_todo::text,  NOW() - INTERVAL '2 days',  (NOW() + INTERVAL '1 day')::date,  FALSE, v_demo_id, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'),
  ('00000000-0000-4000-1000-000000000041', v_grp_new,  'Send Invisalign packet to Emma Thompson',          v_sl_todo::text,  NOW() - INTERVAL '8 days',  (NOW() + INTERVAL '2 days')::date, FALSE, v_demo_id, NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days'),
  ('00000000-0000-4000-1000-000000000042', v_grp_new,  'Request X-rays from David Patel''s dentist',       v_sl_todo::text,  NOW() - INTERVAL '12 days', (NOW() + INTERVAL '3 days')::date, TRUE,  v_demo_id, NOW() - INTERVAL '12 days', NOW() - INTERVAL '12 days'),
  ('00000000-0000-4000-1000-000000000043', v_grp_new,  'Reply to Amanda Richards web form',                v_sl_todo::text,  NOW() - INTERVAL '3 days',  (NOW() + INTERVAL '1 day')::date,  TRUE,  v_demo_id, NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'),
  -- In Progress
  ('00000000-0000-4000-1000-000000000050', v_grp_wip,  'Confirm Chen kids'' pediatric block',              v_sl_wip::text,   NOW() - INTERVAL '4 days',  (NOW() + INTERVAL '2 days')::date, FALSE, v_team1_id, NOW() - INTERVAL '4 days', NOW() - INTERVAL '1 day'),
  ('00000000-0000-4000-1000-000000000051', v_grp_wip,  'Insurance pre-auth: Jennifer Torres crown',        v_sl_wait::text,  NOW() - INTERVAL '6 days',  (NOW() + INTERVAL '4 days')::date, FALSE, v_team1_id, NOW() - INTERVAL '6 days', NOW() - INTERVAL '2 days'),
  ('00000000-0000-4000-1000-000000000052', v_grp_wip,  'Order veneer materials (Michelle Park consult)',   v_sl_wip::text,   NOW() - INTERVAL '3 days',  (NOW() + INTERVAL '7 days')::date, FALSE, v_team2_id, NOW() - INTERVAL '3 days', NOW() - INTERVAL '1 day'),
  ('00000000-0000-4000-1000-000000000053', v_grp_wip,  'Vendor follow-up: x-ray sensor RMA',               v_sl_stuck::text, NOW() - INTERVAL '9 days',  (NOW() - INTERVAL '1 day')::date,  TRUE,  v_team1_id, NOW() - INTERVAL '9 days', NOW() - INTERVAL '1 day'),
  ('00000000-0000-4000-1000-000000000054', v_grp_wip,  'Draft April newsletter to active patients',        v_sl_wip::text,   NOW() - INTERVAL '5 days',  (NOW() + INTERVAL '3 days')::date, FALSE, v_team2_id, NOW() - INTERVAL '5 days', NOW() - INTERVAL '1 day'),
  -- Done
  ('00000000-0000-4000-1000-000000000060', v_grp_done, 'Permanent crown — Marcus Williams',                v_sl_done::text,  NOW() - INTERVAL '5 days',  (NOW() - INTERVAL '4 days')::date, FALSE, v_team1_id, NOW() - INTERVAL '5 days', NOW() - INTERVAL '4 days'),
  ('00000000-0000-4000-1000-000000000061', v_grp_done, 'New patient intake — Natalie Brooks',              v_sl_done::text,  NOW() - INTERVAL '14 days', (NOW() - INTERVAL '10 days')::date, FALSE, v_demo_id,  NOW() - INTERVAL '14 days', NOW() - INTERVAL '10 days'),
  ('00000000-0000-4000-1000-000000000062', v_grp_done, 'Refer Tyler Brooks to ortho partner',              v_sl_done::text,  NOW() - INTERVAL '5 days',  (NOW() - INTERVAL '5 days')::date,  FALSE, v_demo_id,  NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days'),
  ('00000000-0000-4000-1000-000000000063', v_grp_done, 'Sedation consult call — Brian Foster (closed)',    v_sl_done::text,  NOW() - INTERVAL '11 days', (NOW() - INTERVAL '9 days')::date,  FALSE, v_team1_id, NOW() - INTERVAL '11 days', NOW() - INTERVAL '9 days');

-- Subitems on a couple of in-progress items
DELETE FROM task_subitems WHERE parent_item_id IN (
  '00000000-0000-4000-1000-000000000051',
  '00000000-0000-4000-1000-000000000054'
);
INSERT INTO task_subitems (parent_item_id, name, status, due_date, created_at) VALUES
  ('00000000-0000-4000-1000-000000000051', 'Pull benefits PDF from carrier portal', v_sl_done::text, (NOW() - INTERVAL '4 days')::date, NOW() - INTERVAL '5 days'),
  ('00000000-0000-4000-1000-000000000051', 'Submit pre-auth request',               v_sl_wait::text, (NOW() + INTERVAL '1 day')::date,  NOW() - INTERVAL '3 days'),
  ('00000000-0000-4000-1000-000000000051', 'Notify patient of approval ETA',        v_sl_todo::text, (NOW() + INTERVAL '3 days')::date, NOW() - INTERVAL '3 days'),
  ('00000000-0000-4000-1000-000000000054', 'Pull list of active patients',          v_sl_done::text, (NOW() - INTERVAL '4 days')::date, NOW() - INTERVAL '5 days'),
  ('00000000-0000-4000-1000-000000000054', 'Write subject + intro',                 v_sl_wip::text,  (NOW() + INTERVAL '1 day')::date,  NOW() - INTERVAL '3 days'),
  ('00000000-0000-4000-1000-000000000054', 'Pick photo + CTA',                      v_sl_todo::text, (NOW() + INTERVAL '2 days')::date, NOW() - INTERVAL '3 days');

-- Item assignees: spread work across the team
DELETE FROM task_item_assignees WHERE item_id IN (
  '00000000-0000-4000-1000-000000000040','00000000-0000-4000-1000-000000000041',
  '00000000-0000-4000-1000-000000000042','00000000-0000-4000-1000-000000000043',
  '00000000-0000-4000-1000-000000000050','00000000-0000-4000-1000-000000000051',
  '00000000-0000-4000-1000-000000000052','00000000-0000-4000-1000-000000000053',
  '00000000-0000-4000-1000-000000000054','00000000-0000-4000-1000-000000000060',
  '00000000-0000-4000-1000-000000000061','00000000-0000-4000-1000-000000000062',
  '00000000-0000-4000-1000-000000000063'
);
INSERT INTO task_item_assignees (item_id, user_id, created_at) VALUES
  ('00000000-0000-4000-1000-000000000040', v_demo_id,  NOW() - INTERVAL '2 days'),
  ('00000000-0000-4000-1000-000000000041', v_demo_id,  NOW() - INTERVAL '8 days'),
  ('00000000-0000-4000-1000-000000000042', v_team1_id, NOW() - INTERVAL '12 days'),
  ('00000000-0000-4000-1000-000000000043', v_demo_id,  NOW() - INTERVAL '3 days'),
  ('00000000-0000-4000-1000-000000000050', v_team1_id, NOW() - INTERVAL '4 days'),
  ('00000000-0000-4000-1000-000000000051', v_team1_id, NOW() - INTERVAL '6 days'),
  ('00000000-0000-4000-1000-000000000052', v_team2_id, NOW() - INTERVAL '3 days'),
  ('00000000-0000-4000-1000-000000000053', v_team1_id, NOW() - INTERVAL '9 days'),
  ('00000000-0000-4000-1000-000000000054', v_team2_id, NOW() - INTERVAL '5 days'),
  ('00000000-0000-4000-1000-000000000060', v_team1_id, NOW() - INTERVAL '4 days'),
  ('00000000-0000-4000-1000-000000000061', v_demo_id,  NOW() - INTERVAL '10 days'),
  ('00000000-0000-4000-1000-000000000062', v_demo_id,  NOW() - INTERVAL '5 days'),
  ('00000000-0000-4000-1000-000000000063', v_team1_id, NOW() - INTERVAL '9 days');

RAISE NOTICE 'Demo account seeded successfully: demo@anchorcorps.com';

END $$;
