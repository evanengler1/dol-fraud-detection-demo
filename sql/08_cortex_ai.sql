-- =============================================================================
-- DOL Fraud Detection Demo - 08 Cortex AI: unstructured data + search
--   A. Policy and audit PDFs (OIG reports, BAM annual report, UIPL 16-21):
--      AI_PARSE_DOCUMENT -> page chunks -> Cortex Search CS_POLICY_DOCS
--   B. OSHA accident abstracts (public): AI_CLASSIFY event type + AI_EXTRACT
--      facts -> Cortex Search CS_OSHA_NARRATIVES
--   C. ITA case narratives (public): AI_CLASSIFY severity (underreporting lens)
--   D. Worker complaints (synthetic, 20% Spanish): AI_TRANSLATE + AI_CLASSIFY
--      + AI_EXTRACT -> Cortex Search CS_COMPLAINTS
--   E. Employer case briefs: AI_COMPLETE over Risk 360 facts (display ids only)
-- Batch sizes are scoped to employers with risk signals to control cost
-- (input-token estimate, 2026-10-13: ~1.7M for B, ~115k for C, ~30k for E).
-- =============================================================================

USE ROLE DOL_FRAUD_DEMO_ROLE;
USE WAREHOUSE DOL_FRAUD_WH;
USE SCHEMA DOL_FRAUD_DEMO.AI;

-- =============================================================================
-- A. Policy documents
-- =============================================================================
CREATE STAGE IF NOT EXISTS DOCS
  DIRECTORY = (ENABLE = TRUE)
  ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE')
  COMMENT = 'Public DOL/OIG policy and audit PDFs copied from S3 for AI_PARSE_DOCUMENT';

COPY FILES INTO @DOCS FROM @DOL_FRAUD_DEMO.RAW_PUBLIC.S3_DOL/docs/;
ALTER STAGE DOCS REFRESH;

CREATE OR REPLACE TABLE POLICY_DOC_PARSED COMMENT = 'Public: AI_PARSE_DOCUMENT (LAYOUT) output per PDF' AS
SELECT RELATIVE_PATH AS FILE_NAME,
       AI_PARSE_DOCUMENT(TO_FILE('@DOCS', RELATIVE_PATH), {'mode': 'LAYOUT', 'page_split': TRUE}) AS PARSED
FROM DIRECTORY(@DOCS)
WHERE RELATIVE_PATH ILIKE '%.pdf';

CREATE OR REPLACE TABLE POLICY_DOC_CHUNKS (
  CHUNK_ID VARCHAR, FILE_NAME VARCHAR, DOC_TITLE VARCHAR, DOC_TYPE VARCHAR, PAGE_NUMBER NUMBER,
  CHUNK_INDEX NUMBER, CHUNK_TEXT VARCHAR, DATA_ORIGIN VARCHAR
) COMMENT = 'Public: page-level chunks of DOL OIG, BAM and UIPL documents for Cortex Search';

INSERT INTO POLICY_DOC_CHUNKS
SELECT p.FILE_NAME || ':p' || (pg.value:index::NUMBER + 1) || ':c' || c.index,
       p.FILE_NAME,
       CASE
         WHEN p.FILE_NAME ILIKE 'BAM%'       THEN 'BAM PIIA 2024 Annual Report'
         WHEN p.FILE_NAME ILIKE 'UIPL 16-21%' THEN 'UIPL 16-21: Identity verification for UI claims'
         WHEN p.FILE_NAME ILIKE '%19-23-011%' THEN 'OIG 19-23-011-03-315: UI Integrity Data Hub'
         WHEN p.FILE_NAME ILIKE '%19-23-012%' THEN 'OIG 19-23-012-03-315: Pandemic UI improper payments'
         ELSE 'OIG ' || REGEXP_SUBSTR(p.FILE_NAME, '19-[0-9]{2}-[0-9]{3}-03-315')
       END,
       IFF(p.FILE_NAME ILIKE 'OIG%', 'OIG audit report', IFF(p.FILE_NAME ILIKE 'UIPL%', 'ETA guidance (UIPL)', 'BAM / PIIA report')),
       pg.value:index::NUMBER + 1,
       c.index,
       c.value::STRING,
       'PUBLIC'
FROM POLICY_DOC_PARSED p,
     LATERAL FLATTEN(INPUT => p.PARSED:pages) pg,
     LATERAL FLATTEN(INPUT => SNOWFLAKE.CORTEX.SPLIT_TEXT_RECURSIVE_CHARACTER(pg.value:content::STRING, 'markdown', 1800, 200)) c
WHERE LENGTH(c.value::STRING) > 80;

CREATE OR REPLACE CORTEX SEARCH SERVICE CS_POLICY_DOCS
  ON CHUNK_TEXT
  ATTRIBUTES DOC_TITLE, DOC_TYPE, FILE_NAME
  WAREHOUSE = DOL_FRAUD_WH
  TARGET_LAG = '1 day'
  COMMENT = 'Public: search over OIG audit reports, BAM PIIA report and UIPL 16-21'
AS SELECT CHUNK_ID, CHUNK_TEXT, DOC_TITLE, DOC_TYPE, FILE_NAME, PAGE_NUMBER FROM POLICY_DOC_CHUNKS;

-- =============================================================================
-- B. OSHA accident narratives (employers with at least one agency signal)
-- =============================================================================
CREATE OR REPLACE TABLE OSHA_NARRATIVE_ENRICHED (
  SUMMARY_NR NUMBER, EMPLOYER_ID VARCHAR, DISPLAY_ID VARCHAR, STATE_CODE VARCHAR(2), NAICS4 VARCHAR(4),
  EVENT_DATE DATE, FATALITY BOOLEAN, ABSTRACT_TEXT VARCHAR,
  EVENT_TYPE VARCHAR, INVOLVES_TEMP_OR_CONTRACT_WORKER VARCHAR, EQUIPMENT_INVOLVED VARCHAR,
  TRAINING_OR_GUARDING_GAP VARCHAR, DATA_ORIGIN VARCHAR
) COMMENT = 'Public: OSHA accident abstracts with Cortex AI_CLASSIFY event type and AI_EXTRACT facts';

INSERT INTO OSHA_NARRATIVE_ENRICHED
WITH src AS (
  SELECT a.SUMMARY_NR, r.EMPLOYER_ID, r.DISPLAY_ID, r.STATE_CODE, r.NAICS4, a.EVENT_DATE, a.FATALITY, a.ABSTRACT_TEXT
  FROM DOL_FRAUD_DEMO.CURATED.OSHA_ACCIDENT a
  JOIN DOL_FRAUD_DEMO.CURATED.EMPLOYER_XREF x ON x.SOURCE_SYSTEM = 'OSHA' AND x.SOURCE_KEY = TO_VARCHAR(a.ACTIVITY_NR)
  JOIN DOL_FRAUD_DEMO.ANALYTICS.EMPLOYER_RISK_360 r ON r.EMPLOYER_ID = x.EMPLOYER_ID
  WHERE r.AGENCIES_FLAGGED >= 1 AND LENGTH(a.ABSTRACT_TEXT) > 100
  QUALIFY ROW_NUMBER() OVER (PARTITION BY a.SUMMARY_NR ORDER BY r.RISK_SCORE DESC) = 1)
SELECT SUMMARY_NR, EMPLOYER_ID, DISPLAY_ID, STATE_CODE, NAICS4, EVENT_DATE, FATALITY, ABSTRACT_TEXT,
       AI_CLASSIFY(ABSTRACT_TEXT, [
         {'label': 'Fall', 'description': 'fall from height, ladder, roof, scaffold or through an opening'},
         {'label': 'Struck by', 'description': 'struck by a falling, flying or moving object or vehicle'},
         {'label': 'Caught in or between', 'description': 'caught in machinery, crushed, trench collapse, amputation'},
         {'label': 'Electrical', 'description': 'electrocution, electric shock or arc flash'},
         {'label': 'Heat or chemical exposure', 'description': 'heat illness, chemical, gas or toxic exposure, burns'},
         {'label': 'Other', 'description': 'any other incident type'}],
         {'task_description': 'Classify the primary OSHA accident event type'}):labels[0]::STRING,
       e:response:temp_worker::STRING,
       e:response:equipment::STRING,
       e:response:gap::STRING,
       'PUBLIC'
FROM (SELECT s.*,
             AI_EXTRACT(text => ABSTRACT_TEXT, responseFormat => {
               'temp_worker': 'Was the injured employee a temporary, staffing agency or contract worker? Answer yes, no or unknown.',
               'equipment': 'What equipment, machine or tool was involved? Answer in five words or fewer, or none.',
               'gap': 'Does the text mention missing training, missing guarding, or missing protective equipment? Answer yes or no.'}) AS e
      FROM src s);

-- AI_EXTRACT answers in free text ("contract worker", "temporary staffing agency",
-- "None"); normalize to yes / no / unknown for filtering
UPDATE OSHA_NARRATIVE_ENRICHED
SET INVOLVES_TEMP_OR_CONTRACT_WORKER = CASE
      WHEN INVOLVES_TEMP_OR_CONTRACT_WORKER ILIKE ANY ('%temp%', '%staff%', '%contract%', 'yes%') THEN 'yes'
      WHEN INVOLVES_TEMP_OR_CONTRACT_WORKER ILIKE 'no%' AND INVOLVES_TEMP_OR_CONTRACT_WORKER NOT ILIKE 'none%' THEN 'no'
      ELSE 'unknown' END,
    TRAINING_OR_GUARDING_GAP = CASE
      WHEN TRAINING_OR_GUARDING_GAP ILIKE 'yes%' THEN 'yes'
      WHEN TRAINING_OR_GUARDING_GAP ILIKE 'no%' AND TRAINING_OR_GUARDING_GAP NOT ILIKE 'none%' THEN 'no'
      ELSE 'unknown' END;

CREATE OR REPLACE CORTEX SEARCH SERVICE CS_OSHA_NARRATIVES
  ON ABSTRACT_TEXT
  ATTRIBUTES DISPLAY_ID, STATE_CODE, NAICS4, EVENT_TYPE, INVOLVES_TEMP_OR_CONTRACT_WORKER
  WAREHOUSE = DOL_FRAUD_WH
  TARGET_LAG = '1 day'
  COMMENT = 'Public: OSHA accident abstracts for employers with risk signals, with AI-derived event type'
AS SELECT TO_VARCHAR(SUMMARY_NR) AS SUMMARY_NR, ABSTRACT_TEXT, DISPLAY_ID, STATE_CODE, NAICS4, EVENT_TYPE,
          INVOLVES_TEMP_OR_CONTRACT_WORKER, TO_VARCHAR(EVENT_DATE) AS EVENT_DATE
   FROM OSHA_NARRATIVE_ENRICHED;

-- =============================================================================
-- C. ITA case narratives: severity of what employers did record
-- (supports P7: an establishment reporting few, mostly minor cases while
--  OSHA cites serious hazards)
-- =============================================================================
CREATE OR REPLACE TABLE ITA_NARRATIVE_SEVERITY (
  ITA_CASE_ID NUMBER, EMPLOYER_ID VARCHAR, DISPLAY_ID VARCHAR, INCIDENT_DATE DATE, INCIDENT_OUTCOME NUMBER,
  NARRATIVE VARCHAR, AI_SEVERITY VARCHAR, DATA_ORIGIN VARCHAR
) COMMENT = 'Public: OSHA ITA case narratives (2025) with Cortex AI_CLASSIFY severity, employers flagged in 2+ agencies';

INSERT INTO ITA_NARRATIVE_SEVERITY
WITH src AS (
  SELECT c.ITA_CASE_ID, r.EMPLOYER_ID, r.DISPLAY_ID, c.INCIDENT_DATE, c.INCIDENT_OUTCOME,
         c.NARRATIVE_WHAT_HAPPENED || ' Injury: ' || COALESCE(c.NARRATIVE_INJURY, '') AS NARRATIVE
  FROM DOL_FRAUD_DEMO.CURATED.ITA_CASE_DETAIL c
  JOIN DOL_FRAUD_DEMO.CURATED.EMPLOYER_MASTER m ON m.EIN = c.EIN AND NOT m.IS_SYNTHETIC
  JOIN DOL_FRAUD_DEMO.ANALYTICS.EMPLOYER_RISK_360 r ON r.EMPLOYER_ID = m.EMPLOYER_ID
  WHERE r.AGENCIES_FLAGGED >= 2 AND LENGTH(c.NARRATIVE_WHAT_HAPPENED) > 50
  QUALIFY ROW_NUMBER() OVER (ORDER BY r.RISK_SCORE DESC, c.ITA_CASE_ID) <= 3000)
SELECT ITA_CASE_ID, EMPLOYER_ID, DISPLAY_ID, INCIDENT_DATE, INCIDENT_OUTCOME, NARRATIVE,
       AI_CLASSIFY(NARRATIVE, [
         {'label': 'Severe', 'description': 'fracture, amputation, hospitalization, loss of consciousness, crush or serious burn'},
         {'label': 'Moderate', 'description': 'sprain, strain, laceration needing stitches, days away from work'},
         {'label': 'Minor', 'description': 'first aid level, bruise, minor cut, no lost time'}],
         {'task_description': 'Classify the severity of the workplace injury described'}):labels[0]::STRING,
       'PUBLIC'
FROM src;

-- =============================================================================
-- D. Worker complaints (synthetic)
-- =============================================================================
CREATE OR REPLACE TABLE COMPLAINT_ENRICHED (
  COMPLAINT_ID VARCHAR, EMPLOYER_ID VARCHAR, DISPLAY_ID VARCHAR, RECEIVED_DATE DATE, LANGUAGE VARCHAR(2),
  CHANNEL VARCHAR, ORIGINAL_TEXT VARCHAR, ENGLISH_TEXT VARCHAR, ISSUE_TYPES ARRAY,
  ROUTE_TO_AGENCY VARCHAR, MENTIONS_RETALIATION_OR_COERCION VARCHAR, WORKERS_AFFECTED VARCHAR, DATA_ORIGIN VARCHAR
) COMMENT = 'Synthetic data. Worker complaints translated, classified and routed with Cortex AI.';

INSERT INTO COMPLAINT_ENRICHED
WITH t AS (
  SELECT c.*, m.DISPLAY_ID,
         IFF(c.LANGUAGE = 'ES', AI_TRANSLATE(c.COMPLAINT_TEXT, 'es', 'en'), c.COMPLAINT_TEXT) AS ENGLISH_TEXT
  FROM DOL_FRAUD_DEMO.RAW_SYNTH.WORKER_COMPLAINT c
  JOIN DOL_FRAUD_DEMO.CURATED.EMPLOYER_MASTER m ON m.EMPLOYER_ID = c.EMPLOYER_ID)
SELECT COMPLAINT_ID, EMPLOYER_ID, DISPLAY_ID, RECEIVED_DATE, LANGUAGE, CHANNEL, COMPLAINT_TEXT, ENGLISH_TEXT,
       AI_CLASSIFY(ENGLISH_TEXT, [
         {'label': 'Wage theft or overtime', 'description': 'unpaid wages, overtime, illegal deductions, back wages'},
         {'label': 'Misclassification', 'description': 'workers paid as 1099 contractors while treated as employees'},
         {'label': 'H-2A or H-2B program', 'description': 'visa worker wages, housing, transport or recruitment terms'},
         {'label': 'Safety hazard or unreported injury', 'description': 'injury, unsafe conditions, heat, missing protective equipment'},
         {'label': 'Unemployment insurance fraud', 'description': 'identity used for a claim, staged layoffs, working while claiming'},
         {'label': 'Successor or shell company', 'description': 'company renamed or reopened to avoid obligations'}],
         {'task_description': 'Identify every labor issue raised in this worker complaint', 'output_mode': 'multi'}):labels::ARRAY,
       AI_CLASSIFY(ENGLISH_TEXT, [
         {'label': 'WHD', 'description': 'Wage and Hour Division: wages, overtime, misclassification, H-2A worker protections'},
         {'label': 'OSHA', 'description': 'Occupational Safety and Health Administration: injuries and hazards'},
         {'label': 'State UI agency', 'description': 'state unemployment insurance agency: UI claims, identity theft, working while claiming'}],
         {'task_description': 'Which DOL component or partner should receive this complaint first'}):labels[0]::STRING,
       e:response:retaliation::STRING, e:response:workers::STRING,
       'SYNTHETIC'
FROM (SELECT t.*, AI_EXTRACT(text => ENGLISH_TEXT, responseFormat => {
        'retaliation': 'Does the worker describe retaliation, threats or being told not to report? Answer yes or no.',
        'workers': 'How many workers are affected? Answer with a number, several, or unknown.'}) AS e
      FROM t);

CREATE OR REPLACE CORTEX SEARCH SERVICE CS_COMPLAINTS
  ON ENGLISH_TEXT
  ATTRIBUTES DISPLAY_ID, ROUTE_TO_AGENCY, LANGUAGE
  WAREHOUSE = DOL_FRAUD_WH
  TARGET_LAG = '1 hour'
  COMMENT = 'Synthetic data. Worker complaints (English and translated Spanish) with AI routing'
AS SELECT COMPLAINT_ID, ENGLISH_TEXT, ORIGINAL_TEXT, DISPLAY_ID, ROUTE_TO_AGENCY, LANGUAGE,
          ARRAY_TO_STRING(ISSUE_TYPES, ', ') AS ISSUE_TYPES, TO_VARCHAR(RECEIVED_DATE) AS RECEIVED_DATE
   FROM COMPLAINT_ENRICHED;

-- =============================================================================
-- E. Employer case briefs (AI_COMPLETE). Facts only; display ids, never names.
-- =============================================================================
CREATE OR REPLACE TABLE EMPLOYER_CASE_BRIEF (
  EMPLOYER_ID VARCHAR, DISPLAY_ID VARCHAR, RISK_SCORE NUMBER, AGENCY_LIST ARRAY, BRIEF VARCHAR,
  MODEL VARCHAR, GENERATED_AT TIMESTAMP_LTZ, DATA_ORIGIN VARCHAR
) COMMENT = 'AI-generated investigator briefs for the top 50 Employer Risk 360 employers. Risk indicators, not findings.';

INSERT INTO EMPLOYER_CASE_BRIEF
WITH top AS (
  SELECT * FROM DOL_FRAUD_DEMO.ANALYTICS.EMPLOYER_RISK_360
  WHERE AGENCIES_FLAGGED >= 1
  QUALIFY ROW_NUMBER() OVER (ORDER BY RISK_SCORE DESC, EMPLOYER_ID) <= 50)
SELECT EMPLOYER_ID, DISPLAY_ID, RISK_SCORE, AGENCY_LIST,
       AI_COMPLETE('claude-sonnet-4-5',
         'You are a U.S. Department of Labor program integrity analyst. Write a case brief of at most 120 words '
         || 'for ' || DISPLAY_ID || ' (NAICS ' || COALESCE(NAICS4, 'unknown') || ', ' || COALESCE(STATE_CODE, '') || '). '
         || 'Use only these facts. Do not speculate, do not use the words fraud or violation as conclusions, '
         || 'call them risk indicators, do not use em dashes, and end with one recommended next step for the agency that should act first. '
         || 'Facts: ' || TO_JSON(OBJECT_CONSTRUCT(
              'risk_score', RISK_SCORE, 'agencies_with_signals', AGENCY_LIST, 'reasons', TOP_REASONS,
              'whd_cases', WHD_CASES, 'back_wages', BACK_WAGES, 'employees_owed', EMPLOYEES_OWED,
              'oflc_cases', OFLC_CASES, 'offer_to_benchmark', ROUND(OFFER_TO_BENCHMARK, 2),
              'osha_citations', CITATIONS, 'serious', SERIOUS, 'willful', WILLFUL, 'repeat', REPEAT_CITES,
              'failure_to_abate', FAILURE_TO_ABATE, 'ita_injury_rate', ROUND(ITA_TCR, 2),
              'peer_median_injury_rate', ROUND(PEER_MEDIAN_TCR, 2), 'synthetic_employer', IS_SYNTHETIC))),
       'claude-sonnet-4-5', CURRENT_TIMESTAMP(), DATA_ORIGIN
FROM top;

-- =============================================================================
-- Checks
-- =============================================================================
SELECT DOC_TITLE, COUNT(*) AS chunks, MAX(PAGE_NUMBER) AS pages FROM POLICY_DOC_CHUNKS GROUP BY 1 ORDER BY 1;
SELECT EVENT_TYPE, COUNT(*) AS accidents, COUNT_IF(INVOLVES_TEMP_OR_CONTRACT_WORKER ILIKE 'yes%') AS temp_workers
FROM OSHA_NARRATIVE_ENRICHED GROUP BY 1 ORDER BY 2 DESC;
SELECT AI_SEVERITY, COUNT(*) FROM ITA_NARRATIVE_SEVERITY GROUP BY 1;
SELECT ROUTE_TO_AGENCY, LANGUAGE, COUNT(*) FROM COMPLAINT_ENRICHED GROUP BY 1, 2 ORDER BY 1, 2;
SELECT DISPLAY_ID, RISK_SCORE, LEFT(BRIEF, 300) AS brief_preview FROM EMPLOYER_CASE_BRIEF ORDER BY RISK_SCORE DESC LIMIT 3;

SELECT PARSE_JSON(SNOWFLAKE.CORTEX.SEARCH_PREVIEW('DOL_FRAUD_DEMO.AI.CS_POLICY_DOCS',
  '{"query": "identity verification requirements for UI claims", "columns": ["DOC_TITLE", "PAGE_NUMBER"], "limit": 3}')):results AS policy_hits;
