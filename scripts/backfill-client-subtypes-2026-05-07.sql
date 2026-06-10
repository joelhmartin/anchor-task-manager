-- Backfill: client_subtype + ai_prompt for clients added 2026-05-07
--
-- These rows were created via a batch script that posted to /api/hub/clients with
-- only client_type set. The server does not auto-derive ai_prompt, and client_subtype
-- was never provided, so they ended up with subtype=NULL and ai_prompt=NULL (or, for 4
-- rows, a stale legacy default string that no longer matches the current preset).
--
-- This script fixes:
--   - 11 TMJ medical clients → tmj_sleep
--   - 5 dental medical clients → dental
--   - 1 med spa medical client → med_spa
--   - 7 non-medical clients (subtype + hardcoded home_service-family prompts).
--     Note: client_type stays 'non-medical' (the binary used by the HIPAA email gate).
--     ai_prompts are computed from the home_service preset family.
--
-- The 3 NULL-client_type rows are intentionally NOT touched here (staff invites).
--
-- Run via Cloud SQL Auth Proxy:
--   gcloud beta sql connect anchor --user=jmartin --database=anchor < scripts/backfill-client-subtypes-2026-05-07.sql
-- or with the proxy already running on a known port:
--   PGPASSWORD=... psql -h 127.0.0.1 -p <port> -U jmartin -d anchor -f scripts/backfill-client-subtypes-2026-05-07.sql
--
-- The script wraps everything in BEGIN; ... ROLLBACK; — review the diff, then change
-- the final ROLLBACK to COMMIT and re-run to apply.

\pset pager off
\set ON_ERROR_STOP on

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- BEFORE: confirm targets
-- ─────────────────────────────────────────────────────────────────────────────
\echo
\echo === BEFORE ===
SELECT
  cp.user_id,
  cp.client_identifier_value AS label,
  cp.client_type,
  cp.client_subtype,
  CASE
    WHEN cp.ai_prompt IS NULL THEN 'NULL'
    WHEN cp.ai_prompt LIKE '%TMJ & Sleep Therapy centers%' THEN 'tmj_sleep_preset'
    WHEN cp.ai_prompt LIKE '%dental clinics%' THEN 'dental_preset'
    WHEN cp.ai_prompt LIKE '%medical spas%' THEN 'med_spa_preset'
    WHEN cp.ai_prompt = 'You are an assistant that classifies call transcripts for service businesses. Analyze the conversation and determine the caller intent.' THEN 'legacy_stale'
    ELSE 'custom_or_other'
  END AS prompt_state
FROM client_profiles cp
WHERE cp.user_id IN (
  -- TMJ group (11)
  '8d471314-c6a5-42f3-b40c-c5d963d47d0c', -- Farm View Dental (email: tmjsleepmontana — actually TMJ)
  'f7501063-e8fd-4ce3-88fd-921a4d2f8e0e', -- TMJ Vegas
  '906422b6-6599-45f0-bd9c-04aa5c7da10d', -- TMJ Reno
  'ecc7f26f-5003-4bc4-8fc7-df79ab5ae39a', -- TMJ Ontario
  '7a6d386e-3aa4-4ac8-b12b-3b2280ea6e40', -- TMJ Gorge
  '21624ade-d1c3-44e2-b476-35d15d169e49', -- TMJ Montana (subtype already set; this fixes the stale ai_prompt)
  '09ad1c70-ec45-4df9-90ed-044411e76322', -- TMJ NOLA
  'e9e6e3af-f166-4918-94e4-930653f07f48', -- TMJ New England
  'd6cfbb6b-f04d-4091-9b25-b231ceff1002', -- TMJ of Los Angeles & Conejo Valley
  '84f8c0d6-1718-4a0e-ae7b-a458744545f6', -- TMJ Pittsburgh
  '67fecf23-4897-4683-af99-682d7c8e3b02', -- TMJ Cleveland

  -- Dental group (5)
  '68d8d496-9ce7-48c6-8cb6-46cee5638ee3', -- Well Beyond Dental
  '7b5d2a99-a4a7-4ac9-864d-69581b3ad1f9', -- Billings Family Dentistry
  'f3679642-6602-4872-8fd9-e2ec776ec16a', -- Gawlas Family Dental
  '75e03eec-1b3c-408f-9766-942bd154dd1c', -- Bolton Dental
  'f777caab-6d10-4e9f-b195-94640486795d', -- Blue Stream Dental

  -- Med Spa group (1)
  'c10ef7d5-58ab-499b-9c55-e3dd2a07f870', -- Restorative Wellness Center

  -- Non-medical → roofing (3)
  '1a05cc3f-3c11-4451-b9d3-0d73c7be6c27', -- Pearson Roofing
  'bf525151-c01e-4067-bfcf-37434294055e', -- Roof Gurus
  '1e403406-7ac9-4446-a1f5-36d1a48024e5', -- Gutter Gurus

  -- Non-medical → plumbing (2)
  '740376c7-0373-4668-b5e3-41f082cdfdd9', -- Water Heater Co.
  'd5c32843-9ba3-48f7-bf44-2d6d5368331b', -- Cochran & Son

  -- Non-medical → no subtype, home_service default prompt (2)
  '89a73501-0e04-453a-bb1e-f4f43c69ac91', -- DealerFlex
  '97567712-4a5c-4468-84bd-eb15bca284ae'  -- Tustin Floors
)
ORDER BY cp.client_type, cp.client_identifier_value;

-- ─────────────────────────────────────────────────────────────────────────────
-- TMJ & Sleep Therapy group → client_subtype='tmj_sleep' + matching ai_prompt
-- Prompt string captured from src/constants/clientPresets.js getAiPromptForClient('medical','tmj_sleep')
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE client_profiles
SET
  client_type   = 'medical',
  client_subtype = 'tmj_sleep',
  ai_prompt = 'You are an assistant that classifies call transcripts for service businesses. Analyze the conversation to determine caller intent and provide a brief summary. Focus the tone and examples on TMJ & Sleep Therapy centers clients. Services include TMJ, CPAP, Sleep Apnea, Appliance, Pediatric, Nightlase, Sleep Study, Nuvola, Botox, Oral Surgery.',
  updated_at = NOW()
WHERE user_id IN (
  '8d471314-c6a5-42f3-b40c-c5d963d47d0c',
  'f7501063-e8fd-4ce3-88fd-921a4d2f8e0e',
  '906422b6-6599-45f0-bd9c-04aa5c7da10d',
  'ecc7f26f-5003-4bc4-8fc7-df79ab5ae39a',
  '7a6d386e-3aa4-4ac8-b12b-3b2280ea6e40',
  '21624ade-d1c3-44e2-b476-35d15d169e49',
  '09ad1c70-ec45-4df9-90ed-044411e76322',
  'e9e6e3af-f166-4918-94e4-930653f07f48',
  'd6cfbb6b-f04d-4091-9b25-b231ceff1002',
  '84f8c0d6-1718-4a0e-ae7b-a458744545f6',
  '67fecf23-4897-4683-af99-682d7c8e3b02'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Dental group → client_subtype='dental' + matching ai_prompt
-- Prompt string captured from getAiPromptForClient('medical','dental')
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE client_profiles
SET
  client_type   = 'medical',
  client_subtype = 'dental',
  ai_prompt = 'You are an assistant that classifies call transcripts for service businesses. Analyze the conversation to determine caller intent and provide a brief summary. Focus the tone and examples on dental clinics clients. Services include Dental Exam, Teeth Whitening, Dental Implants, Root Canal Therapy, Invisalign, Crowns & Bridges, Emergency Dentistry, Pediatric Dentistry, Cosmetic Dentistry, Periodontal Therapy.',
  updated_at = NOW()
WHERE user_id IN (
  '68d8d496-9ce7-48c6-8cb6-46cee5638ee3',
  '7b5d2a99-a4a7-4ac9-864d-69581b3ad1f9',
  'f3679642-6602-4872-8fd9-e2ec776ec16a',
  '75e03eec-1b3c-408f-9766-942bd154dd1c',
  'f777caab-6d10-4e9f-b195-94640486795d'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Med Spa group → client_subtype='med_spa' + matching ai_prompt
-- Prompt string captured from getAiPromptForClient('medical','med_spa')
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE client_profiles
SET
  client_type   = 'medical',
  client_subtype = 'med_spa',
  ai_prompt = 'You are an assistant that classifies call transcripts for service businesses. Analyze the conversation to determine caller intent and provide a brief summary. Focus the tone and examples on medical spas clients. Services include Botox & Fillers, Microneedling, Laser Hair Removal, Hydrafacial, Chemical Peel, CoolSculpting, IPL Photofacial, Body Contouring.',
  updated_at = NOW()
WHERE user_id IN (
  'c10ef7d5-58ab-499b-9c55-e3dd2a07f870' -- Restorative Wellness Center
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Non-medical → Roofing: client_subtype='roofing' + matching home_service prompt
-- Prompt captured from getAiPromptForClient('home_service','roofing').
-- client_type stays 'non-medical' (the binary used by the HIPAA email gate).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE client_profiles
SET
  client_subtype = 'roofing',
  ai_prompt = 'You are an assistant that classifies call transcripts for service businesses. Analyze the conversation to determine caller intent and provide a brief summary. Focus the tone and examples on roofing contractors clients. Services include Roof Inspection, Roof Repair, Roof Replacement, Storm Damage Repair, Gutter Installation, Skylight Installation.',
  updated_at = NOW()
WHERE user_id IN (
  '1a05cc3f-3c11-4451-b9d3-0d73c7be6c27', -- Pearson Roofing
  'bf525151-c01e-4067-bfcf-37434294055e', -- Roof Gurus
  '1e403406-7ac9-4446-a1f5-36d1a48024e5'  -- Gutter Gurus
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Non-medical → Plumbing: client_subtype='plumbing' + matching home_service prompt
-- Prompt captured from getAiPromptForClient('home_service','plumbing').
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE client_profiles
SET
  client_subtype = 'plumbing',
  ai_prompt = 'You are an assistant that classifies call transcripts for service businesses. Analyze the conversation to determine caller intent and provide a brief summary. Focus the tone and examples on plumbing companies clients. Services include Drain Cleaning, Water Heater Repair, Tankless Water Heater Install, Pipe Replacement, Leak Detection, Sewer Line Repair.',
  updated_at = NOW()
WHERE user_id IN (
  '740376c7-0373-4668-b5e3-41f082cdfdd9', -- Water Heater Co.
  'd5c32843-9ba3-48f7-bf44-2d6d5368331b'  -- Cochran & Son
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Non-medical → home_service generic: ai_prompt only (no subtype).
-- Prompt captured from getAiPromptForClient('home_service', null).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE client_profiles
SET
  ai_prompt = 'You are an assistant that classifies call transcripts for service businesses. Analyze the conversation to determine caller intent and provide a brief summary. Focus the tone and examples on home service businesses clients. Services include Roof Inspection, Roof Repair, Roof Replacement, Storm Damage Repair, Gutter Installation, Skylight Installation, Drain Cleaning, Water Heater Repair, Tankless Water Heater Install, Pipe Replacement, Leak Detection, Sewer Line Repair, AC Installation, AC Repair, Furnace Installation, Furnace Repair, Heat Pump Service, Duct Cleaning, Seasonal Tune-Up, Landscape Design, Lawn Maintenance, Patio & Pavers, Retaining Walls, Outdoor Lighting, Irrigation Systems, Tree & Shrub Care, Sod Installation, Hardscape Construction, Seasonal Cleanup.',
  updated_at = NOW()
WHERE user_id IN (
  '89a73501-0e04-453a-bb1e-f4f43c69ac91', -- DealerFlex
  '97567712-4a5c-4468-84bd-eb15bca284ae'  -- Tustin Floors
);

-- ─────────────────────────────────────────────────────────────────────────────
-- AFTER: verify
-- ─────────────────────────────────────────────────────────────────────────────
\echo
\echo === AFTER ===
SELECT
  cp.client_identifier_value AS label,
  cp.client_type,
  cp.client_subtype,
  CASE
    WHEN cp.ai_prompt LIKE '%TMJ & Sleep Therapy centers%' THEN 'tmj_sleep_preset'
    WHEN cp.ai_prompt LIKE '%dental clinics%' THEN 'dental_preset'
    WHEN cp.ai_prompt LIKE '%medical spas%' THEN 'med_spa_preset'
    WHEN cp.ai_prompt LIKE '%roofing contractors%' THEN 'roofing_preset'
    WHEN cp.ai_prompt LIKE '%plumbing companies%' THEN 'plumbing_preset'
    WHEN cp.ai_prompt LIKE '%home service businesses%' THEN 'home_service_default_preset'
    ELSE 'UNEXPECTED'
  END AS prompt_state
FROM client_profiles cp
WHERE cp.user_id IN (
  '8d471314-c6a5-42f3-b40c-c5d963d47d0c',
  'f7501063-e8fd-4ce3-88fd-921a4d2f8e0e',
  '906422b6-6599-45f0-bd9c-04aa5c7da10d',
  'ecc7f26f-5003-4bc4-8fc7-df79ab5ae39a',
  '7a6d386e-3aa4-4ac8-b12b-3b2280ea6e40',
  '21624ade-d1c3-44e2-b476-35d15d169e49',
  '09ad1c70-ec45-4df9-90ed-044411e76322',
  'e9e6e3af-f166-4918-94e4-930653f07f48',
  'd6cfbb6b-f04d-4091-9b25-b231ceff1002',
  '84f8c0d6-1718-4a0e-ae7b-a458744545f6',
  '67fecf23-4897-4683-af99-682d7c8e3b02',
  '68d8d496-9ce7-48c6-8cb6-46cee5638ee3',
  '7b5d2a99-a4a7-4ac9-864d-69581b3ad1f9',
  'f3679642-6602-4872-8fd9-e2ec776ec16a',
  '75e03eec-1b3c-408f-9766-942bd154dd1c',
  'f777caab-6d10-4e9f-b195-94640486795d',
  'c10ef7d5-58ab-499b-9c55-e3dd2a07f870',
  '1a05cc3f-3c11-4451-b9d3-0d73c7be6c27',
  'bf525151-c01e-4067-bfcf-37434294055e',
  '1e403406-7ac9-4446-a1f5-36d1a48024e5',
  '740376c7-0373-4668-b5e3-41f082cdfdd9',
  'd5c32843-9ba3-48f7-bf44-2d6d5368331b',
  '89a73501-0e04-453a-bb1e-f4f43c69ac91',
  '97567712-4a5c-4468-84bd-eb15bca284ae'
)
ORDER BY cp.client_type, cp.client_subtype NULLS LAST, cp.client_identifier_value;

-- Review the AFTER output. If correct, change the line below to COMMIT and re-run.
ROLLBACK;
