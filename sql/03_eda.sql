-- =============================================================================
-- DOL Fraud Detection Demo - 03 Exploratory Data Analysis (EDA)
-- Profiles every public source, checks coverage and join keys, surfaces the
-- real fraud signal in DOL's own data, and derives the calibration targets
-- used by 05_synthetic_data.sql. Read-only.
-- =============================================================================

USE ROLE DOL_FRAUD_DEMO_ROLE;
USE WAREHOUSE DOL_FRAUD_WH;
USE SCHEMA DOL_FRAUD_DEMO.CURATED;

-- -----------------------------------------------------------------------------
-- 1. Inventory: rows, columns, size and lineage for every RAW table
-- -----------------------------------------------------------------------------
SELECT t.table_name, t.row_count, ROUND(t.bytes / 1e6, 1) AS mb,
       COUNT(c.column_name) AS columns
FROM DOL_FRAUD_DEMO.INFORMATION_SCHEMA.TABLES t
JOIN DOL_FRAUD_DEMO.INFORMATION_SCHEMA.COLUMNS c
  ON c.table_schema = t.table_schema AND c.table_name = t.table_name
WHERE t.table_schema = 'RAW_PUBLIC'
GROUP BY 1, 2, 3 ORDER BY 1;

-- Date coverage per curated source
SELECT 'ETA 539 weekly claims' AS source, MIN(WEEK_ENDING) AS min_date, MAX(WEEK_ENDING) AS max_date, COUNT(*) AS rows_, COUNT(DISTINCT STATE_CODE) AS states FROM ETA_539_WEEKLY_CLAIMS
UNION ALL SELECT 'ETA 227 overpayments', MIN(QUARTER_ENDING), MAX(QUARTER_ENDING), COUNT(*), COUNT(DISTINCT STATE_CODE) FROM ETA_227_OVERPAYMENTS
UNION ALL SELECT 'ETA 5159 payments', MIN(MONTH_ENDING), MAX(MONTH_ENDING), COUNT(*), COUNT(DISTINCT STATE_CODE) FROM ETA_5159_PAYMENTS
UNION ALL SELECT 'ETA 902P PUA', MIN(MONTH_ENDING), MAX(MONTH_ENDING), COUNT(*), COUNT(DISTINCT STATE_CODE) FROM ETA_902P_PUA
UNION ALL SELECT 'BAM integrity rates', MIN(DATE_FROM_PARTS(YEAR, QUARTER * 3, 1)), MAX(DATE_FROM_PARTS(YEAR, QUARTER * 3, 1)), COUNT(*), COUNT(DISTINCT STATE_CODE) FROM BAM_INTEGRITY_RATES
UNION ALL SELECT 'OSHA inspections', MIN(OPEN_DATE), MAX(OPEN_DATE), COUNT(*), COUNT(DISTINCT STATE_CODE) FROM OSHA_INSPECTION
UNION ALL SELECT 'OSHA accidents', MIN(EVENT_DATE), MAX(EVENT_DATE), COUNT(*), NULL FROM OSHA_ACCIDENT
UNION ALL SELECT 'WHD cases', MIN(FINDINGS_END_DATE), MAX(FINDINGS_END_DATE), COUNT(*), COUNT(DISTINCT STATE_CODE) FROM WHD_CASE
UNION ALL SELECT 'ITA 300A', NULL, NULL, COUNT(*), COUNT(DISTINCT STATE_CODE) FROM ITA_300A
UNION ALL SELECT 'ITA case detail', MIN(INCIDENT_DATE), MAX(INCIDENT_DATE), COUNT(*), COUNT(DISTINCT STATE_CODE) FROM ITA_CASE_DETAIL
UNION ALL SELECT 'Form 5500', MIN(PLAN_YEAR_BEGIN), MAX(PLAN_YEAR_BEGIN), COUNT(*), COUNT(DISTINCT STATE_CODE) FROM FORM_5500
UNION ALL SELECT 'OFLC H-2A/H-2B', MIN(RECEIVED_DATE), MAX(RECEIVED_DATE), COUNT(*), COUNT(DISTINCT STATE_CODE) FROM OFLC_H2_CASES
ORDER BY 1;

-- -----------------------------------------------------------------------------
-- 2. Data quality: nulls and key fill rates
-- -----------------------------------------------------------------------------
-- EIN fill rate (the cross-agency join key) by source
SELECT 'ITA 300A' AS source, COUNT(*) AS rows_, COUNT(EIN) AS with_ein, ROUND(COUNT(EIN) / COUNT(*) * 100, 1) AS pct_ein, COUNT(DISTINCT EIN) AS distinct_ein FROM ITA_300A
UNION ALL SELECT 'Form 5500', COUNT(*), COUNT(EIN), ROUND(COUNT(EIN) / COUNT(*) * 100, 1), COUNT(DISTINCT EIN) FROM FORM_5500
UNION ALL SELECT 'OFLC H-2A/H-2B', COUNT(*), COUNT(EIN), ROUND(COUNT(EIN) / COUNT(*) * 100, 1), COUNT(DISTINCT EIN) FROM OFLC_H2_CASES
UNION ALL SELECT 'WHD (no EIN published)', COUNT(*), 0, 0, 0 FROM WHD_CASE
UNION ALL SELECT 'OSHA inspection (no EIN published)', COUNT(*), 0, 0, 0 FROM OSHA_INSPECTION;

-- Narrative text availability (for Cortex AI)
SELECT 'OSHA accident abstracts' AS source, COUNT(*) AS rows_, COUNT_IF(LENGTH(ABSTRACT_TEXT) > 100) AS with_text, ROUND(AVG(LENGTH(ABSTRACT_TEXT))) AS avg_chars FROM OSHA_ACCIDENT
UNION ALL SELECT 'ITA case narratives', COUNT(*), COUNT_IF(LENGTH(NARRATIVE_WHAT_HAPPENED) > 50), ROUND(AVG(LENGTH(NARRATIVE_WHAT_HAPPENED))) FROM ITA_CASE_DETAIL;

-- ETA 227 completeness: how many state-quarters report fraud dollars
SELECT YEAR(QUARTER_ENDING) AS yr, COUNT(*) AS state_quarters,
       COUNT_IF(FRAUD_DOLLARS IS NULL) AS null_fraud_dollars,
       COUNT_IF(FRAUD_DOLLARS = 0) AS zero_fraud_dollars
FROM ETA_227_OVERPAYMENTS WHERE QUARTER_ENDING >= '2015-01-01'
GROUP BY 1 ORDER BY 1;

-- -----------------------------------------------------------------------------
-- 3. OUI: the real claims surge (ETA 539)
-- -----------------------------------------------------------------------------
-- National weekly initial claims, 2018 onward (the 2020 surge)
SELECT WEEK_ENDING, SUM(INITIAL_CLAIMS) AS national_initial_claims,
       SUM(CONTINUED_WEEKS) AS national_continued_weeks
FROM ETA_539_WEEKLY_CLAIMS WHERE WEEK_ENDING >= '2018-01-01'
GROUP BY 1 ORDER BY 1;

-- Peak week vs 2019 baseline by state (surge multiple)
WITH base AS (
  SELECT STATE_CODE, MEDIAN(INITIAL_CLAIMS) AS median_2019
  FROM ETA_539_WEEKLY_CLAIMS WHERE YEAR(WEEK_ENDING) = 2019 GROUP BY 1),
peak AS (
  SELECT STATE_CODE, WEEK_ENDING AS peak_week, INITIAL_CLAIMS AS peak_claims
  FROM ETA_539_WEEKLY_CLAIMS WHERE WEEK_ENDING BETWEEN '2020-01-01' AND '2021-12-31'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY STATE_CODE ORDER BY INITIAL_CLAIMS DESC) = 1)
SELECT p.STATE_CODE, b.median_2019, p.peak_week, p.peak_claims,
       ROUND(p.peak_claims / NULLIF(b.median_2019, 0), 1) AS surge_multiple
FROM peak p JOIN base b USING (STATE_CODE)
ORDER BY surge_multiple DESC;

-- Recent 52 weeks: claims per 1,000 covered workers
SELECT STATE_CODE, SUM(INITIAL_CLAIMS) AS ic_52wk,
       MAX(COVERED_EMPLOYMENT) AS covered_employment,
       ROUND(SUM(INITIAL_CLAIMS) / NULLIF(MAX(COVERED_EMPLOYMENT), 0) * 1000, 1) AS ic_per_1k_workers
FROM ETA_539_WEEKLY_CLAIMS
WHERE WEEK_ENDING > DATEADD(week, -52, (SELECT MAX(WEEK_ENDING) FROM ETA_539_WEEKLY_CLAIMS))
GROUP BY 1 ORDER BY ic_52wk DESC;

-- -----------------------------------------------------------------------------
-- 4. OUI: fraud in DOL's own numbers (ETA 227, 5159, 902P, BAM)
-- -----------------------------------------------------------------------------
-- National fraud overpayments by year, with prosecutions and recoveries
SELECT YEAR(QUARTER_ENDING) AS yr,
       SUM(FRAUD_CASES) AS fraud_cases, ROUND(SUM(FRAUD_DOLLARS) / 1e6, 1) AS fraud_usd_m,
       ROUND(SUM(SCHEME_DOLLARS) / 1e6, 1) AS multi_claimant_scheme_usd_m,
       ROUND(SUM(FRAUD_RECOVERED) / 1e6, 1) AS fraud_recovered_usd_m,
       SUM(REFERRED_FOR_PROSECUTION) AS referred, SUM(CONVICTIONS) AS convictions
FROM ETA_227_OVERPAYMENTS WHERE QUARTER_ENDING >= '2015-01-01'
GROUP BY 1 ORDER BY 1;

-- How fraud was detected (last 3 years): detection-method mix
SELECT m.value:method::STRING AS method,
       SUM(m.value:cases::NUMBER) AS cases,
       ROUND(SUM(m.value:dollars::NUMBER) / 1e6, 1) AS usd_m,
       ROUND(RATIO_TO_REPORT(SUM(m.value:dollars::NUMBER)) OVER () * 100, 1) AS pct_dollars
FROM ETA_227_OVERPAYMENTS o,
     LATERAL FLATTEN(INPUT => ARRAY_CONSTRUCT(
       OBJECT_CONSTRUCT('method', 'Wage/benefit crossmatch',         'cases', DET_WAGE_CROSSMATCH_CASES, 'dollars', DET_WAGE_CROSSMATCH_DOLLARS),
       OBJECT_CONSTRUCT('method', 'Interstate crossmatch',           'cases', DET_IB_CROSSMATCH_CASES,   'dollars', DET_IB_CROSSMATCH_DOLLARS),
       OBJECT_CONSTRUCT('method', 'National Directory of New Hires', 'cases', DET_NDNH_CASES,            'dollars', DET_NDNH_DOLLARS),
       OBJECT_CONSTRUCT('method', 'State Directory of New Hires',    'cases', DET_SDNH_CASES,            'dollars', DET_SDNH_DOLLARS),
       OBJECT_CONSTRUCT('method', 'Multi-claimant scheme systems',   'cases', DET_SCHEME_SYSTEM_CASES,   'dollars', DET_SCHEME_SYSTEM_DOLLARS),
       OBJECT_CONSTRUCT('method', 'Special project',                 'cases', DET_SPECIAL_PROJECT_CASES, 'dollars', DET_SPECIAL_PROJECT_DOLLARS),
       OBJECT_CONSTRUCT('method', 'Other controllable',              'cases', DET_OTHER_CASES,           'dollars', DET_OTHER_DOLLARS),
       OBJECT_CONSTRUCT('method', 'Noncontrollable',                 'cases', DET_NONCONTROLLABLE_CASES, 'dollars', DET_NONCONTROLLABLE_DOLLARS))) m
WHERE o.QUARTER_ENDING > DATEADD(year, -3, (SELECT MAX(QUARTER_ENDING) FROM ETA_227_OVERPAYMENTS))
GROUP BY 1 ORDER BY usd_m DESC NULLS LAST;

-- Fraud as % of benefits paid, last 4 quarters, by state (227 / 5159)
WITH op AS (
  SELECT STATE_CODE, SUM(FRAUD_DOLLARS) AS fraud_dollars, SUM(FRAUD_RECOVERED) AS recovered
  FROM ETA_227_OVERPAYMENTS
  WHERE QUARTER_ENDING > DATEADD(month, -12, (SELECT MAX(QUARTER_ENDING) FROM ETA_227_OVERPAYMENTS))
  GROUP BY 1),
paid AS (
  SELECT STATE_CODE, SUM(BENEFITS_PAID) AS benefits_paid
  FROM ETA_5159_PAYMENTS
  WHERE MONTH_ENDING > DATEADD(month, -12, (SELECT MAX(QUARTER_ENDING) FROM ETA_227_OVERPAYMENTS))
    AND MONTH_ENDING <= (SELECT MAX(QUARTER_ENDING) FROM ETA_227_OVERPAYMENTS)
  GROUP BY 1)
SELECT op.STATE_CODE, ROUND(paid.benefits_paid / 1e6, 1) AS paid_usd_m,
       ROUND(op.fraud_dollars / 1e6, 2) AS fraud_usd_m,
       ROUND(op.fraud_dollars / NULLIF(paid.benefits_paid, 0) * 100, 2) AS fraud_pct_of_paid,
       ROUND(op.recovered / NULLIF(op.fraud_dollars, 0) * 100, 1) AS recovery_pct
FROM op JOIN paid USING (STATE_CODE)
ORDER BY fraud_usd_m DESC;

-- Pandemic Unemployment Assistance: fraud and identity-theft overpayments
SELECT STATE_CODE, ROUND(SUM(AMOUNT_COMPENSATED) / 1e9, 2) AS pua_paid_usd_b,
       ROUND(SUM(FRAUD_OP_DOLLARS) / 1e6, 1) AS fraud_op_usd_m,
       ROUND(SUM(ID_THEFT_OP_DOLLARS) / 1e6, 1) AS id_theft_op_usd_m
FROM ETA_902P_PUA GROUP BY 1 ORDER BY fraud_op_usd_m DESC NULLS LAST LIMIT 15;

-- BAM: national fraud rate by quarter, and state averages over the series
SELECT YEAR_QTR, FRAUD_RATE, OVERPAYMENT_RATE, ROUND(FRAUD_DOLLARS / 1e6, 1) AS fraud_usd_m
FROM BAM_INTEGRITY_RATES WHERE STATE_CODE = 'US' ORDER BY YEAR, QUARTER;

SELECT STATE_CODE, ROUND(AVG(FRAUD_RATE) * 100, 2) AS avg_fraud_rate_pct,
       ROUND(AVG(OVERPAYMENT_RATE) * 100, 2) AS avg_op_rate_pct,
       ROUND(SUM(FRAUD_DOLLARS) / 1e6, 1) AS fraud_usd_m
FROM BAM_INTEGRITY_RATES WHERE STATE_CODE <> 'US'
GROUP BY 1 ORDER BY avg_fraud_rate_pct DESC;

-- BAM root causes of fraud (national)
SELECT CAUSE, PCT_OF_FRAUD_OP, ROUND(ESTIMATED_FRAUD_DOLLARS / 1e6, 1) AS usd_m
FROM BAM_FRAUD_BY_CAUSE WHERE STATE_CODE = 'US' ORDER BY ESTIMATED_FRAUD_DOLLARS DESC;

-- -----------------------------------------------------------------------------
-- 5. Employers: enforcement and program footprint
-- -----------------------------------------------------------------------------
-- WHD: back wages by NAICS sector, repeat/willful counts
SELECT LEFT(NAICS_CODE, 2) AS naics2, COUNT(*) AS cases,
       ROUND(SUM(TOTAL_BACK_WAGES) / 1e6, 1) AS back_wages_usd_m,
       COUNT_IF(IS_REPEAT_VIOLATOR) AS repeat_cases, COUNT_IF(IS_WILLFUL_VIOLATOR) AS willful_cases
FROM WHD_CASE GROUP BY 1 ORDER BY back_wages_usd_m DESC LIMIT 15;

-- WHD: H-2A statute findings
SELECT PROGRAM_LABEL, COUNT(DISTINCT CASE_ID) AS cases, ROUND(SUM(BACK_WAGES) / 1e6, 2) AS back_wages_usd_m,
       ROUND(SUM(CMP_ASSESSED) / 1e6, 2) AS cmp_usd_m
FROM WHD_CASE_PROGRAM WHERE PROGRAM_CODE ILIKE '%H2%' OR PROGRAM_LABEL ILIKE '%H-2%' GROUP BY 1;

-- OSHA: citation mix and penalty reduction
SELECT VIOL_TYPE, COUNT(*) AS citations, ROUND(SUM(INITIAL_PENALTY) / 1e6, 1) AS initial_usd_m,
       ROUND(SUM(CURRENT_PENALTY) / 1e6, 1) AS current_usd_m,
       ROUND((1 - SUM(CURRENT_PENALTY) / NULLIF(SUM(INITIAL_PENALTY), 0)) * 100, 1) AS pct_reduced
FROM OSHA_VIOLATION GROUP BY 1 ORDER BY citations DESC;

-- ITA: injury rate (per 200k hours) distribution by NAICS sector
SELECT LEFT(NAICS_CODE, 2) AS naics2, COUNT(*) AS establishments,
       ROUND(MEDIAN((DAFW_CASES + DJTR_CASES + OTHER_CASES) * 200000 / NULLIF(TOTAL_HOURS_WORKED, 0)), 2) AS median_tcr,
       ROUND(AVG((DAFW_CASES + DJTR_CASES + OTHER_CASES) * 200000 / NULLIF(TOTAL_HOURS_WORKED, 0)), 2) AS mean_tcr,
       COUNT_IF(DAFW_CASES + DJTR_CASES + OTHER_CASES = 0) AS zero_case_filers
FROM ITA_300A WHERE TOTAL_HOURS_WORKED >= 2000 GROUP BY 1 ORDER BY establishments DESC;  -- >= 1 FTE-year

-- OFLC: offered wage vs QCEW average hourly wage (state x 3-digit NAICS)
WITH q AS (
  SELECT STATE_CODE, NAICS_CODE, AVG_WEEKLY_WAGE / 40 AS qcew_hourly
  FROM QCEW_STATE_INDUSTRY_2024 WHERE NAICS_DIGITS = 3)
SELECT o.PROGRAM, COUNT(*) AS certified_cases,
       ROUND(MEDIAN(o.WAGE_OFFER), 2) AS median_offer_hr,
       ROUND(MEDIAN(q.qcew_hourly), 2) AS median_qcew_hr,
       COUNT_IF(o.WAGE_OFFER < 0.6 * q.qcew_hourly) AS offers_below_60pct_of_industry
FROM OFLC_H2_CASES o
JOIN q ON q.STATE_CODE = o.WORKSITE_STATE AND q.NAICS_CODE = LEFT(o.NAICS_CODE, 3)
WHERE o.CASE_STATUS ILIKE 'Determination Issued - Certif%' AND o.WAGE_PER ILIKE 'Hour%'
GROUP BY 1;

-- -----------------------------------------------------------------------------
-- 6. Entity resolution potential (feeds 04_entity_resolution.sql)
-- -----------------------------------------------------------------------------
-- EIN overlap across EIN-bearing sources
WITH ita AS (SELECT DISTINCT EIN FROM ITA_300A WHERE EIN IS NOT NULL),
     f55 AS (SELECT DISTINCT EIN FROM FORM_5500 WHERE EIN IS NOT NULL),
     ofl AS (SELECT DISTINCT EIN FROM OFLC_H2_CASES WHERE EIN IS NOT NULL)
SELECT (SELECT COUNT(*) FROM ita) AS ita_eins, (SELECT COUNT(*) FROM f55) AS f5500_eins, (SELECT COUNT(*) FROM ofl) AS oflc_eins,
       (SELECT COUNT(*) FROM ita JOIN f55 USING (EIN)) AS ita_and_5500,
       (SELECT COUNT(*) FROM ofl JOIN f55 USING (EIN)) AS oflc_and_5500,
       (SELECT COUNT(*) FROM ofl JOIN ita USING (EIN)) AS oflc_and_ita;

-- Exact normalized name + state overlap between WHD, OSHA and ITA (name-only sources)
WITH norm AS (
  SELECT 'WHD' AS src, STATE_CODE,
         TRIM(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(LEGAL_NAME), '[^A-Z0-9 ]', ' '), '\\b(LLC|INC|CORP|CORPORATION|CO|COMPANY|LTD|LP|LLP|THE)\\b', '')) AS nm
  FROM WHD_CASE
  UNION ALL
  SELECT 'OSHA', STATE_CODE,
         TRIM(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(ESTAB_NAME), '[^A-Z0-9 ]', ' '), '\\b(LLC|INC|CORP|CORPORATION|CO|COMPANY|LTD|LP|LLP|THE)\\b', ''))
  FROM OSHA_INSPECTION
  UNION ALL
  SELECT 'ITA', STATE_CODE,
         TRIM(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(COALESCE(COMPANY_NAME, ESTABLISHMENT_NAME)), '[^A-Z0-9 ]', ' '), '\\b(LLC|INC|CORP|CORPORATION|CO|COMPANY|LTD|LP|LLP|THE)\\b', ''))
  FROM ITA_300A),
keys AS (SELECT REGEXP_REPLACE(nm, ' +', ' ') AS nm, STATE_CODE, ARRAY_AGG(DISTINCT src) AS srcs FROM norm WHERE nm <> '' GROUP BY 1, 2)
SELECT ARRAY_SIZE(srcs) AS agencies, COUNT(*) AS name_state_keys
FROM keys GROUP BY 1 ORDER BY 1;

-- -----------------------------------------------------------------------------
-- 7. Demo state selection (result, 2026-10-13: CA, NY, TX, FL, GA, PA) and calibration targets (used by 05)
-- Criteria: large claim volume, complete ETA 227 + BAM history, a visible
-- 2020 surge, and OFLC/WHD employer activity.
-- -----------------------------------------------------------------------------
WITH claims AS (
  SELECT STATE_CODE, SUM(INITIAL_CLAIMS) AS ic_52wk, ROUND(AVG(INITIAL_CLAIMS)) AS avg_weekly_ic
  FROM ETA_539_WEEKLY_CLAIMS
  WHERE WEEK_ENDING > DATEADD(week, -52, (SELECT MAX(WEEK_ENDING) FROM ETA_539_WEEKLY_CLAIMS))
  GROUP BY 1),
bam AS (
  SELECT STATE_CODE, AVG(FRAUD_RATE) AS bam_fraud_rate, AVG(OVERPAYMENT_RATE) AS bam_op_rate
  FROM BAM_INTEGRITY_RATES WHERE YEAR >= 2023 GROUP BY 1),
emp AS (
  SELECT STATE_CODE, COUNT(*) AS whd_cases_5yr FROM WHD_CASE
  WHERE FINDINGS_END_DATE >= DATEADD(year, -5, CURRENT_DATE()) GROUP BY 1),
h2 AS (SELECT WORKSITE_STATE AS STATE_CODE, COUNT(*) AS oflc_cases FROM OFLC_H2_CASES GROUP BY 1)
SELECT c.STATE_CODE, c.ic_52wk, c.avg_weekly_ic,
       ROUND(b.bam_fraud_rate * 100, 2) AS bam_fraud_rate_pct, ROUND(b.bam_op_rate * 100, 2) AS bam_op_rate_pct,
       e.whd_cases_5yr, h.oflc_cases
FROM claims c
LEFT JOIN bam b USING (STATE_CODE) LEFT JOIN emp e USING (STATE_CODE) LEFT JOIN h2 h USING (STATE_CODE)
ORDER BY c.ic_52wk DESC LIMIT 15;

-- QCEW average weekly wage by state x NAICS sector (wage-record calibration)
SELECT STATE_CODE, NAICS_CODE, EMPLOYMENT, AVG_WEEKLY_WAGE
FROM QCEW_STATE_INDUSTRY_2024
WHERE NAICS_DIGITS = 2 AND STATE_CODE IN ('CA', 'TX', 'FL', 'NY', 'GA', 'AZ')
ORDER BY STATE_CODE, EMPLOYMENT DESC;
