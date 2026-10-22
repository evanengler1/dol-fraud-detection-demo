-- =============================================================================
-- DOL Fraud Detection Demo - 05 Synthetic data
-- "Synthetic data. Not real individuals."
-- Record-level UI data is not public, so claimants, claims, payments, wage
-- records, new hires and complaints are generated here, calibrated to DOL's
-- public numbers (see 03_eda.sql):
--   * claim volume by state and week follows ETA 539 for CA, NY, TX, FL, GA, PA
--   * wages follow BLS QCEW 2024 average weekly wage by state x NAICS sector
--   * the seeded fraud share (~7.5% of current claims) sits inside the BAM
--     state fraud-rate range (national mean 6.4%, NY 13.2%, CA 9.1%)
-- All values are deterministic (hash-based), so reruns produce the same data.
-- Seeded patterns (only on synthetic records and synthetic employers):
--   F1 shared bank account rings      F2 device / IP farm
--   F3 same SSN in multiple states    F4 working while claiming
--   F5 fictitious employer scheme     F6 synthetic identity
--   (with benign look-alikes so no single attribute separates fraud)
--   W1 1099 misclassification (hero employer)
-- Real employers appear only as a claimant's last employer and are never
-- given a synthetic fraud flag.
-- =============================================================================

USE ROLE DOL_FRAUD_DEMO_ROLE;
USE WAREHOUSE DOL_FRAUD_WH;
USE SCHEMA DOL_FRAUD_DEMO.RAW_SYNTH;

-- Deterministic uniform(0,1) from a seed and a salt
CREATE OR REPLACE FUNCTION U01(SEED NUMBER, SALT VARCHAR)
  RETURNS FLOAT
  COMMENT = 'Deterministic pseudo-random value in [0,1) for reproducible synthetic data'
AS $$ (MOD(ABS(HASH(SEED, SALT)), 1000000) / 1000000.0)::FLOAT $$;

-- -----------------------------------------------------------------------------
-- 0. Calibration inputs (from public data)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TABLE DEMO_STATE (
  STATE_CODE VARCHAR(2), MIN_WBA NUMBER, MAX_WBA NUMBER, MAX_WEEKS NUMBER
) COMMENT = 'Demo states and benefit parameters (approximate published state values)';
INSERT INTO DEMO_STATE VALUES
  ('CA', 40, 450, 26), ('NY', 124, 504, 26), ('TX', 74, 577, 26),
  ('FL', 32, 275, 12), ('GA', 55, 365, 14), ('PA', 68, 613, 26);

-- Claim filing distribution: ETA 539 initial claims by state and week.
-- CUR = 52 weeks ending at the latest ETA week, PRI = the 52 weeks before.
CREATE OR REPLACE TABLE CLAIM_WEEK_WEIGHTS AS
WITH w AS (
  SELECT e.STATE_CODE, e.WEEK_ENDING, e.INITIAL_CLAIMS,
         DATEDIFF(week, e.WEEK_ENDING, MAX(e.WEEK_ENDING) OVER ()) AS WEEKS_AGO
  FROM DOL_FRAUD_DEMO.CURATED.ETA_539_WEEKLY_CLAIMS e
  JOIN DEMO_STATE d USING (STATE_CODE)
  WHERE e.WEEK_ENDING > DATEADD(week, -104, (SELECT MAX(WEEK_ENDING) FROM DOL_FRAUD_DEMO.CURATED.ETA_539_WEEKLY_CLAIMS))),
x AS (SELECT *, IFF(WEEKS_AGO < 52, 'CUR', 'PRI') AS WIN FROM w)
SELECT STATE_CODE, WEEK_ENDING, WIN, INITIAL_CLAIMS,
       COALESCE(SUM(INITIAL_CLAIMS) OVER (PARTITION BY WIN ORDER BY STATE_CODE, WEEK_ENDING
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)
         / SUM(INITIAL_CLAIMS) OVER (PARTITION BY WIN) AS CUM_LO,
       SUM(INITIAL_CLAIMS) OVER (PARTITION BY WIN ORDER BY STATE_CODE, WEEK_ENDING
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
         / SUM(INITIAL_CLAIMS) OVER (PARTITION BY WIN) AS CUM_HI
FROM x;

-- Average weekly wage by state x NAICS sector (QCEW sector codes like 31-33)
CREATE OR REPLACE TABLE WAGE_BENCHMARK AS
SELECT q.STATE_CODE, s.value::STRING AS NAICS2, q.AVG_WEEKLY_WAGE
FROM DOL_FRAUD_DEMO.CURATED.QCEW_STATE_INDUSTRY_2024 q
JOIN DEMO_STATE USING (STATE_CODE),
     LATERAL FLATTEN(INPUT => CASE q.NAICS_CODE
                                WHEN '31-33' THEN ARRAY_CONSTRUCT('31', '32', '33')
                                WHEN '44-45' THEN ARRAY_CONSTRUCT('44', '45')
                                WHEN '48-49' THEN ARRAY_CONSTRUCT('48', '49')
                                ELSE ARRAY_CONSTRUCT(q.NAICS_CODE) END) s
WHERE q.AGGLVL_CODE = 54;   -- state x NAICS sector

-- Real employers that can be a claimant's last employer: 600 per demo state.
-- Only used as the separating employer; never flagged.
CREATE OR REPLACE TABLE EMPLOYER_POOL AS
SELECT m.EMPLOYER_ID, m.STATE_CODE, m.CITY, m.ZIP5, LEFT(m.NAICS_CODE, 2) AS NAICS2,
       ROW_NUMBER() OVER (PARTITION BY m.STATE_CODE ORDER BY HASH(m.EMPLOYER_ID, 'pool')) - 1 AS POOL_IDX
FROM DOL_FRAUD_DEMO.CURATED.EMPLOYER_MASTER m
JOIN DEMO_STATE d USING (STATE_CODE)
WHERE m.IS_SYNTHETIC = FALSE AND m.NAICS_CODE IS NOT NULL AND m.CITY IS NOT NULL AND m.ZIP5 IS NOT NULL
  AND LEFT(m.NAICS_CODE, 2) IN (SELECT NAICS2 FROM WAGE_BENCHMARK)
QUALIFY POOL_IDX < 600;

-- -----------------------------------------------------------------------------
-- 1. Synthetic employers: hero, predecessor, F5 shells, W1 peer sample
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TABLE SYNTH_EMPLOYER (
  EMPLOYER_ID VARCHAR, EMPLOYER_NAME VARCHAR, ROLE VARCHAR, EIN VARCHAR(9),
  STREET_ADDRESS VARCHAR, CITY VARCHAR, STATE_CODE VARCHAR(2), ZIP5 VARCHAR(5),
  NAICS_CODE VARCHAR, REGISTERED_DATE DATE, STATUS VARCHAR, PREDECESSOR_ID VARCHAR
) COMMENT = 'Synthetic data. Fictional employers: hero, predecessor, F5 shells and W1 peer sample.';

INSERT INTO SYNTH_EMPLOYER VALUES
  ('SYN-HERO-001', 'Summit Ridge Staffing LLC', 'HERO', '990000001',
   '4800 Commerce Park Dr', 'SAN ANTONIO', 'TX', '78218', '561320', '2022-06-14', 'ACTIVE', 'SYN-PRED-001'),
  ('SYN-PRED-001', 'Ridgeline Labor Partners LLC', 'PREDECESSOR', '990000002',
   '4800 Commerce Park Dr', 'SAN ANTONIO', 'TX', '78218', '561320', '2016-03-02', 'DEBARRED', NULL);

-- F5 shells: 24 recently registered employers, 4 per demo state, no footprint in
-- ITA, Form 5500, OSHA or WHD
INSERT INTO SYNTH_EMPLOYER
SELECT 'SYN-SHELL-' || LPAD(g.i + 1, 3, '0'),
       GET(ARRAY_CONSTRUCT('Apex Harbor', 'Bluegate', 'Crescent Point', 'Delta Crest', 'Evergreen Arc', 'Falcon Ridge',
                           'Granite Bay', 'Horizon Peak', 'Ironwood', 'Juniper Lane', 'Keystone Arc', 'Lakeshore Prime',
                           'Meridian Way', 'Northfield', 'Oakline', 'Pinecrest', 'Quarry Hill', 'Redstone',
                           'Silverline', 'Tidewater', 'Union Square', 'Valley Forge', 'Westbrook', 'Yellowpine'), g.i)::STRING
         || ' ' || GET(ARRAY_CONSTRUCT('Logistics LLC', 'Services Inc', 'Solutions LLC', 'Group LLC'), MOD(g.i, 4))::STRING,
       'SHELL', '98' || LPAD(TO_VARCHAR(1000000 + g.i), 7, '0'),
       (100 + MOD(ABS(HASH(g.i, 'st')), 8800)) || ' ' ||
         GET(ARRAY_CONSTRUCT('Suite 210, Main St', 'Unit 4, Commerce Blvd', 'PMB 118, Market St', 'Suite 9, Park Ave'), MOD(g.i, 4))::STRING,
       p.CITY, s.STATE_CODE, p.ZIP5,
       GET(ARRAY_CONSTRUCT('484110', '561320', '238990', '722511'), MOD(g.i, 4))::STRING,
       DATEADD(day, -MOD(ABS(HASH(g.i, 'reg')), 150) - 60, '2026-10-03'::DATE), 'ACTIVE', NULL
FROM (SELECT SEQ4() AS i FROM TABLE(GENERATOR(ROWCOUNT => 24))) g
JOIN (SELECT STATE_CODE, ROW_NUMBER() OVER (ORDER BY STATE_CODE) - 1 AS sidx FROM DEMO_STATE) s
  ON s.sidx = MOD(g.i, 6)
JOIN EMPLOYER_POOL p ON p.STATE_CODE = s.STATE_CODE AND p.POOL_IDX = g.i;

-- W1 peer sample: 30 fictional TX staffing firms (comparison group only)
INSERT INTO SYNTH_EMPLOYER
SELECT 'SYN-PEER-' || LPAD(g.i + 1, 3, '0'), 'Peer Staffing Firm ' || LPAD(g.i + 1, 2, '0'), 'PEER',
       '97' || LPAD(TO_VARCHAR(1000000 + g.i), 7, '0'), NULL, 'SAN ANTONIO', 'TX', '782' || LPAD(MOD(g.i, 50), 2, '0'),
       '561320', DATEADD(year, -3 - MOD(g.i, 10), '2026-01-01'::DATE), 'ACTIVE', NULL
FROM (SELECT SEQ4() AS i FROM TABLE(GENERATOR(ROWCOUNT => 30))) g;

-- Benign ambiguity: 300 small, established employers (50 per state) with no
-- footprint in ITA, Form 5500, OSHA, WHD or OFLC, like most small businesses
INSERT INTO SYNTH_EMPLOYER
SELECT 'SYN-SMALL-' || LPAD(g.i + 1, 3, '0'), 'Local Business ' || LPAD(g.i + 1, 3, '0'), 'SMALL',
       '96' || LPAD(TO_VARCHAR(1000000 + g.i), 7, '0'), NULL, p.CITY, s.STATE_CODE, p.ZIP5,
       GET(ARRAY_CONSTRUCT('722511', '811111', '238220', '445110', '541211', '621111'), MOD(g.i, 6))::STRING,
       DATEADD(day, -(730 + MOD(ABS(HASH(g.i, 'sreg')), 4700)), '2026-10-03'::DATE), 'ACTIVE', NULL
FROM (SELECT SEQ4() AS i FROM TABLE(GENERATOR(ROWCOUNT => 300))) g
JOIN (SELECT STATE_CODE, ROW_NUMBER() OVER (ORDER BY STATE_CODE) - 1 AS sidx FROM DEMO_STATE) s
  ON s.sidx = MOD(g.i, 6)
JOIN EMPLOYER_POOL p ON p.STATE_CODE = s.STATE_CODE AND p.POOL_IDX = 100 + FLOOR(g.i / 6);

-- Register synthetic employers in the employer master (flagged)
DELETE FROM DOL_FRAUD_DEMO.CURATED.EMPLOYER_MASTER WHERE IS_SYNTHETIC;
INSERT INTO DOL_FRAUD_DEMO.CURATED.EMPLOYER_MASTER
SELECT EMPLOYER_ID,
       -- 7-digit ids (#1000001+) cannot collide with the 6-digit public display ids
       CASE ROLE WHEN 'HERO' THEN 'Employer #1000001' WHEN 'PREDECESSOR' THEN 'Employer #1000002'
            ELSE 'Employer #' || TO_VARCHAR(1000010 + ROW_NUMBER() OVER (ORDER BY EMPLOYER_ID)) END,
       EMPLOYER_NAME, EIN, STATE_CODE, CITY, ZIP5, NAICS_CODE, LEFT(NAICS_CODE, 4),
       ROLE = 'HERO', ROLE = 'HERO', ROLE = 'HERO', ROLE IN ('HERO', 'PREDECESSOR'), ROLE = 'HERO',
       IFF(ROLE = 'HERO', 5, IFF(ROLE = 'PREDECESSOR', 1, 0)),
       IFF(ROLE = 'HERO', 3, IFF(ROLE = 'PREDECESSOR', 1, 0)),
       0, 1.00, TRUE, 'SYNTHETIC'
FROM SYNTH_EMPLOYER;

-- Hero / predecessor enforcement records, shaped like the public tables -----------
CREATE OR REPLACE TABLE SYNTH_WHD_CASE COMMENT = 'Synthetic data. WHD-shaped cases for the fictional hero and predecessor.' AS
SELECT * FROM VALUES
  (990001, 'SYN-PRED-001', '2019-04-01'::DATE, '2021-03-31'::DATE, 'H-2A', 61, 318400, 74, 96500,  TRUE,  TRUE),
  (990002, 'SYN-PRED-001', '2020-06-01'::DATE, '2022-02-28'::DATE, 'FLSA', 38, 141200, 52, 41800,  TRUE,  FALSE),
  (990003, 'SYN-HERO-001', '2022-09-01'::DATE, '2023-08-31'::DATE, 'H-2A', 44, 186300, 58, 72400,  FALSE, FALSE),
  (990004, 'SYN-HERO-001', '2023-06-01'::DATE, '2024-11-30'::DATE, 'FLSA', 57, 242700, 96, 64300,  TRUE,  FALSE),
  (990005, 'SYN-HERO-001', '2024-10-01'::DATE, '2026-02-28'::DATE, 'MSPA', 29,  97150, 41, 38900,  TRUE,  TRUE)
  AS t(CASE_ID, EMPLOYER_ID, FINDINGS_START_DATE, FINDINGS_END_DATE, PROGRAM, TOTAL_VIOLATIONS,
       TOTAL_BACK_WAGES, EMPLOYEES_OWED_BACK_WAGES, TOTAL_CMP_ASSESSED, IS_REPEAT_VIOLATOR, IS_WILLFUL_VIOLATOR);

CREATE OR REPLACE TABLE SYNTH_OSHA_VIOLATION COMMENT = 'Synthetic data. OSHA-shaped citations for the fictional hero (unpaid penalties, failure to abate).' AS
SELECT * FROM VALUES
  (990100001, 'SYN-HERO-001', '01001', 'S', '2025-05-12'::DATE, 16131, 16131, FALSE),
  (990100001, 'SYN-HERO-001', '01002', 'S', '2025-05-12'::DATE, 16131, 16131, FALSE),
  (990100001, 'SYN-HERO-001', '01003', 'S', '2025-05-12'::DATE, 16131, 16131, FALSE),
  (990100001, 'SYN-HERO-001', '01004', 'S', '2025-05-12'::DATE, 16131, 16131, FALSE),
  (990100001, 'SYN-HERO-001', '02001', 'R', '2025-05-12'::DATE, 161323, 161323, TRUE),
  (990100002, 'SYN-HERO-001', '01001', 'S', '2026-03-03'::DATE, 16550, 16550, TRUE)
  AS t(ACTIVITY_NR, EMPLOYER_ID, CITATION_ID, VIOL_TYPE, ISSUANCE_DATE, INITIAL_PENALTY, CURRENT_PENALTY, FAILURE_TO_ABATE);

-- ITA filing: 412 employees, 0 recordable cases despite 5 serious OSHA citations
-- and worker reports of unrecorded injuries (possible underreporting, P7)
CREATE OR REPLACE TABLE SYNTH_ITA_300A COMMENT = 'Synthetic data. ITA-shaped 300A filing for the fictional hero (possible underreporting).' AS
SELECT 'SYN-HERO-001' AS EMPLOYER_ID, 2025 AS FILING_YEAR, 412 AS ANNUAL_AVG_EMPLOYEES,
       824000 AS TOTAL_HOURS_WORKED, 0 AS TOTAL_DEATHS, 0 AS DAFW_CASES, 0 AS DJTR_CASES, 0 AS OTHER_CASES;

-- OFLC H-2A application: offered wage well below the QCEW benchmark
CREATE OR REPLACE TABLE SYNTH_OFLC_H2_CASE COMMENT = 'Synthetic data. OFLC-shaped H-2A case for the fictional hero.' AS
SELECT 'H-300-25999-000001' AS CASE_NUMBER, 'SYN-HERO-001' AS EMPLOYER_ID, 'H-2A' AS PROGRAM,
       'Determination Issued - Certification' AS CASE_STATUS, '2025-01-21'::DATE AS RECEIVED_DATE,
       140 AS WORKERS_REQUESTED, 140 AS WORKERS_CERTIFIED, 11.20::NUMBER(10, 2) AS WAGE_OFFER, 'Hour' AS WAGE_PER,
       'TX' AS WORKSITE_STATE, '561320' AS NAICS_CODE;

-- Successor link (W3): same address, same officer, new name after debarment
CREATE OR REPLACE TABLE SYNTH_EMPLOYER_LINK COMMENT = 'Synthetic data. Possible related-entity links between fictional employers.' AS
SELECT 'SYN-PRED-001' AS FROM_EMPLOYER_ID, 'SYN-HERO-001' AS TO_EMPLOYER_ID, 'POSSIBLE_SUCCESSOR' AS LINK_TYPE,
       ARRAY_CONSTRUCT('Same street address', 'Same registered officer', 'Predecessor debarred 2022-03', 'Successor registered 2022-06') AS EVIDENCE;

-- W1: payroll split (hero vs peer sample)
CREATE OR REPLACE TABLE EMPLOYER_PAYROLL_SUMMARY COMMENT = 'Synthetic data. W-2 vs 1099 counts for fictional employers (W1 misclassification).' AS
SELECT EMPLOYER_ID, y.yr AS TAX_YEAR,
       CASE WHEN ROLE = 'HERO' THEN 38 + y.yr - 2023
            WHEN ROLE = 'SHELL' THEN 3
            ELSE 120 + MOD(ABS(HASH(EMPLOYER_ID, y.yr)), 260) END AS W2_COUNT,
       CASE WHEN ROLE = 'HERO' THEN 290 + (y.yr - 2023) * 45
            WHEN ROLE = 'SHELL' THEN 0
            ELSE 10 + MOD(ABS(HASH(EMPLOYER_ID, y.yr, 'k')), 45) END AS FORM_1099_COUNT
FROM SYNTH_EMPLOYER,
     (SELECT 2023 AS yr UNION ALL SELECT 2024 UNION ALL SELECT 2025) y
WHERE ROLE IN ('HERO', 'PEER', 'SHELL');

-- -----------------------------------------------------------------------------
-- 2. Claimants (50,000 base identities)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TABLE UI_CLAIMANT (
  CLAIMANT_ID VARCHAR, SSN VARCHAR(11), FIRST_NAME VARCHAR, LAST_NAME VARCHAR, DOB DATE,
  EMAIL VARCHAR, PHONE VARCHAR(12), PHONE_IS_VOIP BOOLEAN, STREET_ADDRESS VARCHAR, CITY VARCHAR,
  STATE_CODE VARCHAR(2), ZIP5 VARCHAR(5), ADDRESS_IS_CMRA BOOLEAN, ACCOUNT_CREATED_TS TIMESTAMP_NTZ,
  IDENTITY_VERIFIED BOOLEAN, PRIMARY_LANGUAGE VARCHAR(2)
) COMMENT = 'Synthetic data. Not real individuals. SSNs use the never-issued 9xx area.';

CREATE OR REPLACE TABLE UI_CLAIM (
  CLAIM_ID VARCHAR, CLAIMANT_ID VARCHAR, STATE_CODE VARCHAR(2), LAST_EMPLOYER_ID VARCHAR,
  SEPARATION_DATE DATE, SEPARATION_REASON VARCHAR, FILED_TS TIMESTAMP_NTZ, CLAIM_WINDOW VARCHAR(3),
  WEEKLY_BENEFIT_AMT NUMBER(8, 2), BASE_WEEKLY_WAGE NUMBER(10, 2), STATUS VARCHAR, WEEKS_PAID NUMBER,
  FILING_CHANNEL VARCHAR, IP_ADDRESS VARCHAR(15), DEVICE_ID VARCHAR, BANK_ROUTING VARCHAR(9),
  BANK_ACCOUNT VARCHAR(17), CLAIM_EMAIL VARCHAR, CLAIM_PHONE VARCHAR(12),
  IS_FRAUD BOOLEAN, FRAUD_PATTERN VARCHAR, FRAUD_GROUP VARCHAR
) COMMENT = 'Synthetic data. UI claims calibrated to ETA 539 volume. IS_FRAUD/FRAUD_PATTERN are seeded labels.';

-- Claims: 1..50,000 = current year (one per claimant); 50,001..80,000 = prior year
INSERT INTO UI_CLAIM
WITH g AS (SELECT SEQ4() + 1 AS n FROM TABLE(GENERATOR(ROWCOUNT => 80000))),
c AS (
  SELECT g.n, IFF(g.n <= 50000, 'CUR', 'PRI') AS win,
         IFF(g.n <= 50000, g.n, 1 + MOD(ABS(HASH(g.n, 'repeat')), 50000)) AS claimant_n,
         U01(g.n, 'wk') AS u_wk
  FROM g),
placed AS (
  SELECT c.*, w.STATE_CODE, w.WEEK_ENDING
  FROM c JOIN CLAIM_WEEK_WEIGHTS w ON w.WIN = c.win AND c.u_wk >= w.CUM_LO AND c.u_wk < w.CUM_HI),
emp AS (
  SELECT p.*, e.EMPLOYER_ID, e.NAICS2, b.AVG_WEEKLY_WAGE
  FROM placed p
  JOIN EMPLOYER_POOL e ON e.STATE_CODE = p.STATE_CODE AND e.POOL_IDX = MOD(ABS(HASH(p.n, 'emp')), 600)
  JOIN WAGE_BENCHMARK b ON b.STATE_CODE = p.STATE_CODE AND b.NAICS2 = e.NAICS2)
SELECT 'CLM-' || LPAD(n, 7, '0'),
       'CLT-' || LPAD(claimant_n, 6, '0'),
       e.STATE_CODE, e.EMPLOYER_ID,
       DATEADD(day, -7 - MOD(ABS(HASH(n, 'sep')), 21), WEEK_ENDING),
       CASE WHEN U01(n, 'why') < 0.78 THEN 'LACK OF WORK' WHEN U01(n, 'why') < 0.90 THEN 'DISCHARGE'
            WHEN U01(n, 'why') < 0.97 THEN 'VOLUNTARY QUIT' ELSE 'OTHER' END,
       DATEADD(second, MOD(ABS(HASH(n, 'sec')), 86400), DATEADD(day, -MOD(ABS(HASH(n, 'dow')), 7), WEEK_ENDING))::TIMESTAMP_NTZ,
       win,
       LEAST(d.MAX_WBA, GREATEST(d.MIN_WBA, ROUND(e.AVG_WEEKLY_WAGE * (0.55 + 0.7 * U01(n, 'wage')) * 0.5))),
       ROUND(e.AVG_WEEKLY_WAGE * (0.55 + 0.7 * U01(n, 'wage')), 2),
       NULL, 0,
       CASE WHEN U01(n, 'chan') < 0.85 THEN 'ONLINE' WHEN U01(n, 'chan') < 0.97 THEN 'PHONE' ELSE 'IN_PERSON' END,
       (11 + MOD(ABS(HASH(claimant_n, 'ip1')), 200)) || '.' || MOD(ABS(HASH(claimant_n, 'ip2')), 256) || '.' ||
         MOD(ABS(HASH(claimant_n, 'ip3')), 256) || '.' || (1 + MOD(ABS(HASH(claimant_n, 'ip4')), 254)),
       'DEV-' || UPPER(LEFT(SHA2(TO_VARCHAR(claimant_n) || 'dev'), 12)),
       GET(ARRAY_CONSTRUCT('021000021', '026009593', '121000248', '111000025', '063100277', '061000052',
                           '031000503', '322271627', '044000037', '071000013', '091000019', '053000196'),
           MOD(ABS(HASH(claimant_n, 'rt')), 12))::STRING,
       TO_VARCHAR(1000000000 + MOD(ABS(HASH(claimant_n, 'acct')), 8999999999)),
       NULL, NULL, FALSE, NULL, NULL
FROM emp e JOIN DEMO_STATE d ON d.STATE_CODE = e.STATE_CODE;

-- Claimants: identity follows the current-year claim's state
INSERT INTO UI_CLAIMANT
WITH base AS (
  SELECT c.CLAIMANT_ID, TO_NUMBER(RIGHT(c.CLAIMANT_ID, 6)) AS k, c.STATE_CODE, p.CITY, p.ZIP5, c.FILED_TS
  FROM UI_CLAIM c
  JOIN EMPLOYER_POOL p ON p.STATE_CODE = c.STATE_CODE AND p.POOL_IDX = MOD(ABS(HASH(c.CLAIMANT_ID, 'home')), 600)
  WHERE c.CLAIM_WINDOW = 'CUR')
SELECT CLAIMANT_ID,
       '9' || LPAD(MOD(ABS(HASH(k, 'a')), 100), 2, '0') || '-' || LPAD(1 + MOD(ABS(HASH(k, 'g')), 98), 2, '0') || '-'
         || LPAD(1 + MOD(ABS(HASH(k, 's')), 9998), 4, '0'),
       GET(ARRAY_CONSTRUCT('James','Maria','Robert','Jennifer','Michael','Linda','David','Patricia','Jose','Elizabeth',
                           'William','Ana','Richard','Susan','Carlos','Jessica','Joseph','Sarah','Juan','Karen',
                           'Thomas','Nancy','Luis','Lisa','Daniel','Betty','Miguel','Sandra','Anthony','Ashley',
                           'Kevin','Emily','Jorge','Donna','Brian','Michelle','Wei','Carol','Andre','Amanda',
                           'Kenneth','Melissa','Rosa','Deborah','Steven','Stephanie','Ahmed','Rebecca','Tyrone','Laura'),
           MOD(ABS(HASH(k, 'fn')), 50))::STRING,
       GET(ARRAY_CONSTRUCT('Smith','Garcia','Johnson','Rodriguez','Williams','Martinez','Brown','Hernandez','Jones','Lopez',
                           'Miller','Gonzalez','Davis','Perez','Wilson','Sanchez','Anderson','Ramirez','Taylor','Torres',
                           'Thomas','Flores','Moore','Rivera','Jackson','Gomez','Martin','Diaz','Lee','Reyes',
                           'Thompson','Cruz','White','Morales','Harris','Ortiz','Clark','Gutierrez','Lewis','Chavez',
                           'Walker','Nguyen','Hall','Kim','Allen','Patel','Young','Chen','King','Washington'),
           MOD(ABS(HASH(k, 'ln')), 50))::STRING,
       DATEADD(day, -(7300 + MOD(ABS(HASH(k, 'dob')), 17500)), '2026-10-03'::DATE),
       NULL,
       LPAD(200 + MOD(ABS(HASH(k, 'ac')), 790), 3, '0') || '-555-' || LPAD(MOD(ABS(HASH(k, 'ph')), 10000), 4, '0'),
       FALSE,
       (100 + MOD(ABS(HASH(k, 'hn')), 9800)) || ' ' ||
         GET(ARRAY_CONSTRUCT('Oak','Maple','Cedar','Pine','Elm','Main','Park','Lake','Hill','Washington','Lincoln','Sunset'),
             MOD(ABS(HASH(k, 'stn')), 12))::STRING || ' ' ||
         GET(ARRAY_CONSTRUCT('St','Ave','Dr','Rd','Ln','Blvd'), MOD(ABS(HASH(k, 'sfx')), 6))::STRING,
       CITY, STATE_CODE, ZIP5, FALSE,
       DATEADD(day, -(400 + MOD(ABS(HASH(k, 'acct_age')), 2500)), FILED_TS),
       U01(k, 'idv') < 0.93,
       IFF(U01(k, 'lang') < 0.18, 'ES', 'EN')
FROM base;

UPDATE UI_CLAIMANT
SET EMAIL = LOWER(LEFT(FIRST_NAME, 1) || LAST_NAME || RIGHT(CLAIMANT_ID, 4)) || '@' ||
            GET(ARRAY_CONSTRUCT('gmail.com', 'yahoo.com', 'outlook.com', 'icloud.com', 'aol.com', 'hotmail.com'),
                MOD(ABS(HASH(CLAIMANT_ID, 'em')), 6))::STRING;

UPDATE UI_CLAIM c SET CLAIM_EMAIL = t.EMAIL, CLAIM_PHONE = t.PHONE
FROM UI_CLAIMANT t WHERE t.CLAIMANT_ID = c.CLAIMANT_ID;

-- Status and weeks paid (benign baseline)
UPDATE UI_CLAIM c
SET STATUS = CASE
               WHEN U01(TO_NUMBER(RIGHT(CLAIM_ID, 7)), 'deny') < 0.12 THEN 'DENIED'
               WHEN CLAIM_WINDOW = 'PRI' THEN IFF(U01(TO_NUMBER(RIGHT(CLAIM_ID, 7)), 'exh') < 0.35, 'EXHAUSTED', 'CLOSED')
               WHEN DATEDIFF(week, FILED_TS, '2026-10-03') >= d.MAX_WEEKS THEN IFF(U01(TO_NUMBER(RIGHT(CLAIM_ID, 7)), 'exh') < 0.35, 'EXHAUSTED', 'CLOSED')
               ELSE 'ACTIVE' END
FROM DEMO_STATE d WHERE d.STATE_CODE = c.STATE_CODE;

UPDATE UI_CLAIM c
SET WEEKS_PAID = CASE
                   WHEN STATUS = 'DENIED' THEN 0
                   WHEN STATUS = 'EXHAUSTED' THEN d.MAX_WEEKS
                   WHEN STATUS = 'CLOSED' THEN 1 + MOD(ABS(HASH(CLAIM_ID, 'wk')), GREATEST(d.MAX_WEEKS - 2, 1))
                   ELSE LEAST(d.MAX_WEEKS, GREATEST(1, DATEDIFF(week, FILED_TS, '2026-10-03') - 1)) END
FROM DEMO_STATE d WHERE d.STATE_CODE = c.STATE_CODE;

-- Benign noise so fraud is not trivially separable: 2% of households share a bank
-- account and 3% share a device with exactly one other claimant (pairs only)
UPDATE UI_CLAIM c
SET BANK_ACCOUNT = p.BANK_ACCOUNT, BANK_ROUTING = p.BANK_ROUTING
FROM UI_CLAIM p
WHERE c.CLAIM_WINDOW = 'CUR' AND p.CLAIM_WINDOW = 'CUR'
  AND TO_NUMBER(RIGHT(c.CLAIM_ID, 7)) <= 49000
  AND U01(TO_NUMBER(RIGHT(c.CLAIM_ID, 7)), 'hh') < 0.02
  AND TO_NUMBER(RIGHT(p.CLAIM_ID, 7)) = TO_NUMBER(RIGHT(c.CLAIM_ID, 7)) + 1;

UPDATE UI_CLAIM c
SET DEVICE_ID = p.DEVICE_ID
FROM UI_CLAIM p
WHERE c.CLAIM_WINDOW = 'CUR' AND p.CLAIM_WINDOW = 'CUR'
  AND TO_NUMBER(RIGHT(c.CLAIM_ID, 7)) <= 49000
  AND U01(TO_NUMBER(RIGHT(c.CLAIM_ID, 7)), 'dv') < 0.03
  AND TO_NUMBER(RIGHT(p.CLAIM_ID, 7)) = TO_NUMBER(RIGHT(c.CLAIM_ID, 7)) + 2;

-- Benign ambiguity on legitimate claims (so no single attribute separates fraud):
--   6% worked for a small employer with no public footprint
--   30% created their online account at filing time (first-time filers)
--   10% use a VOIP phone; 5% use an ISP email domain
UPDATE UI_CLAIM c
SET LAST_EMPLOYER_ID = e.EMPLOYER_ID
FROM (SELECT EMPLOYER_ID, STATE_CODE, ROW_NUMBER() OVER (PARTITION BY STATE_CODE ORDER BY EMPLOYER_ID) - 1 AS k
      FROM SYNTH_EMPLOYER WHERE ROLE = 'SMALL') e
WHERE e.STATE_CODE = c.STATE_CODE AND e.k = MOD(ABS(HASH(c.CLAIM_ID, 'small')), 50)
  AND U01(TO_NUMBER(RIGHT(c.CLAIM_ID, 7)), 'smallemp') < 0.06;

UPDATE UI_CLAIMANT t
SET ACCOUNT_CREATED_TS = DATEADD(hour, -(1 + MOD(ABS(HASH(t.CLAIMANT_ID, 'newacct')), 70)), c.FILED_TS)
FROM UI_CLAIM c
WHERE c.CLAIMANT_ID = t.CLAIMANT_ID AND c.CLAIM_WINDOW = 'CUR'
  AND U01(TO_NUMBER(RIGHT(t.CLAIMANT_ID, 6)), 'firsttime') < 0.30;

UPDATE UI_CLAIMANT
SET PHONE_IS_VOIP = U01(TO_NUMBER(RIGHT(CLAIMANT_ID, 6)), 'voip') < 0.10,
    EMAIL = IFF(U01(TO_NUMBER(RIGHT(CLAIMANT_ID, 6)), 'isp') < 0.05,
                SPLIT_PART(EMAIL, '@', 1) || '@' ||
                  GET(ARRAY_CONSTRUCT('comcast.net', 'att.net', 'verizon.net', 'sbcglobal.net'),
                      MOD(ABS(HASH(CLAIMANT_ID, 'ispd')), 4))::STRING,
                EMAIL);

UPDATE UI_CLAIM c SET CLAIM_EMAIL = t.EMAIL FROM UI_CLAIMANT t WHERE t.CLAIMANT_ID = c.CLAIMANT_ID;

-- -----------------------------------------------------------------------------
-- 3. Seeded fraud patterns (current-year claims only)
-- -----------------------------------------------------------------------------
-- Hero ex-workers: 220 TX claims list Summit Ridge Staffing as last employer
CREATE OR REPLACE TEMPORARY TABLE HERO_CLAIMS AS
SELECT CLAIM_ID FROM UI_CLAIM
WHERE CLAIM_WINDOW = 'CUR' AND STATE_CODE = 'TX' AND STATUS <> 'DENIED'
QUALIFY ROW_NUMBER() OVER (ORDER BY HASH(CLAIM_ID, 'hero')) <= 220;

UPDATE UI_CLAIM SET LAST_EMPLOYER_ID = 'SYN-HERO-001', SEPARATION_REASON = 'LACK OF WORK'
WHERE CLAIM_ID IN (SELECT CLAIM_ID FROM HERO_CLAIMS);

-- Disjoint fraud cohorts, assigned by rank over a hash of the claim id
CREATE OR REPLACE TEMPORARY TABLE FRAUD_PICK AS
SELECT CLAIM_ID, CLAIMANT_ID, STATE_CODE,
       ROW_NUMBER() OVER (ORDER BY HASH(CLAIM_ID, 'fraudpick')) AS r
FROM UI_CLAIM
WHERE CLAIM_WINDOW = 'CUR' AND STATUS <> 'DENIED' AND CLAIM_ID NOT IN (SELECT CLAIM_ID FROM HERO_CLAIMS);

-- F1: 6 bank-account rings (sizes 18, 22, 16, 20, 15, 19 = 110 claims)
CREATE OR REPLACE TEMPORARY TABLE F1_RING AS
SELECT CLAIM_ID, CLAIMANT_ID,
       CASE WHEN r <= 18 THEN 1 WHEN r <= 40 THEN 2 WHEN r <= 56 THEN 3
            WHEN r <= 76 THEN 4 WHEN r <= 91 THEN 5 ELSE 6 END AS ring
FROM FRAUD_PICK WHERE r BETWEEN 1 AND 110;

UPDATE UI_CLAIM c
SET BANK_ROUTING = '011000015', BANK_ACCOUNT = '77' || LPAD(TO_VARCHAR(f.ring * 1111), 8, '0'),
    CLAIM_PHONE = IFF(MOD(ABS(HASH(c.CLAIM_ID)), 3) = 0, '702-555-01' || LPAD(f.ring, 2, '0'), c.CLAIM_PHONE),
    IS_FRAUD = TRUE, FRAUD_PATTERN = 'F1_BANK_RING', FRAUD_GROUP = 'RING-' || f.ring
FROM F1_RING f WHERE f.CLAIM_ID = c.CLAIM_ID;

-- Ring 1 spans all 6 demo states: move its claimants across states
UPDATE UI_CLAIM c
SET STATE_CODE = s.STATE_CODE
FROM (SELECT CLAIM_ID, ROW_NUMBER() OVER (ORDER BY CLAIM_ID) - 1 AS i FROM F1_RING WHERE ring = 1) f,
     (SELECT STATE_CODE, ROW_NUMBER() OVER (ORDER BY STATE_CODE) - 1 AS sidx FROM DEMO_STATE) s
WHERE f.CLAIM_ID = c.CLAIM_ID AND s.sidx = MOD(f.i, 6);

-- F2: 3 device/IP farms, 50 claims each, all filed within 48 hours, across states
UPDATE UI_CLAIM c
SET DEVICE_ID = 'DEV-FARM' || f.farm, IP_ADDRESS = '185.220.10' || f.farm || '.' || (10 + MOD(f.r, 40)),
    FILED_TS = DATEADD(minute, MOD(ABS(HASH(c.CLAIM_ID, 'f2')), 2880), f.base_ts),
    FILING_CHANNEL = 'ONLINE',
    IS_FRAUD = TRUE, FRAUD_PATTERN = 'F2_DEVICE_FARM', FRAUD_GROUP = 'FARM-' || f.farm
FROM (SELECT CLAIM_ID, r, 1 + FLOOR((r - 111) / 50) AS farm,
             DATEADD(week, -(6 + 9 * FLOOR((r - 111) / 50)), '2026-10-01 02:00:00'::TIMESTAMP_NTZ) AS base_ts
      FROM FRAUD_PICK WHERE r BETWEEN 111 AND 260) f
WHERE f.CLAIM_ID = c.CLAIM_ID;

-- F3: same identity filing in a second state at the same time (400 identities)
CREATE OR REPLACE TEMPORARY TABLE F3_PICK AS
SELECT f.CLAIM_ID, f.CLAIMANT_ID, f.STATE_CODE, f.r,
       s.STATE_CODE AS SECOND_STATE
FROM FRAUD_PICK f
JOIN (SELECT STATE_CODE, ROW_NUMBER() OVER (ORDER BY STATE_CODE) - 1 AS sidx FROM DEMO_STATE) s
  ON s.sidx = MOD(f.r + 1, 6)
WHERE f.r BETWEEN 261 AND 660;

INSERT INTO UI_CLAIMANT
SELECT 'CLT-D' || RIGHT(t.CLAIMANT_ID, 6), t.SSN, t.FIRST_NAME, t.LAST_NAME, t.DOB,
       t.EMAIL, t.PHONE, t.PHONE_IS_VOIP, (100 + MOD(ABS(HASH(t.CLAIMANT_ID, 'f3a')), 9800)) || ' Commerce St',
       p.CITY, f.SECOND_STATE, p.ZIP5, FALSE, DATEADD(day, -3, c.FILED_TS), FALSE, t.PRIMARY_LANGUAGE
FROM F3_PICK f
JOIN UI_CLAIMANT t ON t.CLAIMANT_ID = f.CLAIMANT_ID
JOIN UI_CLAIM c ON c.CLAIM_ID = f.CLAIM_ID
JOIN EMPLOYER_POOL p ON p.STATE_CODE = f.SECOND_STATE AND p.POOL_IDX = MOD(f.r, 600);

INSERT INTO UI_CLAIM
SELECT 'CLM-D' || RIGHT(c.CLAIM_ID, 6), 'CLT-D' || RIGHT(c.CLAIMANT_ID, 6), f.SECOND_STATE, p.EMPLOYER_ID,
       c.SEPARATION_DATE, c.SEPARATION_REASON, DATEADD(day, 2 + MOD(f.r, 9), c.FILED_TS), 'CUR',
       LEAST(d.MAX_WBA, c.WEEKLY_BENEFIT_AMT), c.BASE_WEEKLY_WAGE, 'ACTIVE',
       GREATEST(1, LEAST(d.MAX_WEEKS, c.WEEKS_PAID - 1)),
       'ONLINE', c.IP_ADDRESS, c.DEVICE_ID, '084009519', TO_VARCHAR(5000000000 + MOD(ABS(HASH(c.CLAIM_ID, 'f3b')), 999999999)),
       c.CLAIM_EMAIL, c.CLAIM_PHONE, TRUE, 'F3_MULTI_STATE', 'SSN-' || RIGHT(c.CLAIMANT_ID, 6)
FROM F3_PICK f
JOIN UI_CLAIM c ON c.CLAIM_ID = f.CLAIM_ID
JOIN EMPLOYER_POOL p ON p.STATE_CODE = f.SECOND_STATE AND p.POOL_IDX = MOD(f.r, 600)
JOIN DEMO_STATE d ON d.STATE_CODE = f.SECOND_STATE;

UPDATE UI_CLAIM SET IS_FRAUD = TRUE, FRAUD_PATTERN = 'F3_MULTI_STATE', FRAUD_GROUP = 'SSN-' || RIGHT(CLAIMANT_ID, 6),
                    STATUS = 'ACTIVE', WEEKS_PAID = GREATEST(WEEKS_PAID, 3)
WHERE CLAIM_ID IN (SELECT CLAIM_ID FROM F3_PICK);

-- F4: working while claiming. 1,060 general cohort + 140 hero ex-workers
CREATE OR REPLACE TEMPORARY TABLE F4_PICK AS
SELECT CLAIM_ID FROM FRAUD_PICK WHERE r BETWEEN 661 AND 1720
UNION ALL
SELECT CLAIM_ID FROM HERO_CLAIMS QUALIFY ROW_NUMBER() OVER (ORDER BY HASH(CLAIM_ID, 'f4hero')) <= 140;

UPDATE UI_CLAIM SET IS_FRAUD = TRUE, FRAUD_PATTERN = 'F4_WORKING_WHILE_CLAIMING',
                    WEEKS_PAID = GREATEST(WEEKS_PAID, 6), STATUS = IFF(STATUS = 'DENIED', 'ACTIVE', STATUS)
WHERE CLAIM_ID IN (SELECT CLAIM_ID FROM F4_PICK);

-- F5: fictitious employer scheme. 600 claims cite a recently registered shell;
-- separations cluster within two weeks of each other
UPDATE UI_CLAIM c
SET LAST_EMPLOYER_ID = s.EMPLOYER_ID,
    SEPARATION_DATE = DATEADD(day, MOD(ABS(HASH(c.CLAIM_ID, 'f5s')), 14), DATEADD(day, 75, s.REGISTERED_DATE)),
    FILED_TS = DATEADD(day, 10 + MOD(ABS(HASH(c.CLAIM_ID, 'f5f')), 10), DATEADD(day, 75, s.REGISTERED_DATE))::TIMESTAMP_NTZ,
    WEEKLY_BENEFIT_AMT = d.MAX_WBA, SEPARATION_REASON = 'LACK OF WORK',
    IS_FRAUD = TRUE, FRAUD_PATTERN = 'F5_FICTITIOUS_EMPLOYER', FRAUD_GROUP = s.EMPLOYER_ID
FROM (SELECT f.CLAIM_ID, f.STATE_CODE, f.r FROM FRAUD_PICK f WHERE f.r BETWEEN 1721 AND 2320) f
JOIN (SELECT EMPLOYER_ID, STATE_CODE, REGISTERED_DATE,
             ROW_NUMBER() OVER (PARTITION BY STATE_CODE ORDER BY EMPLOYER_ID) - 1 AS k
      FROM SYNTH_EMPLOYER WHERE ROLE = 'SHELL') s
  ON s.STATE_CODE = f.STATE_CODE AND s.k = MOD(f.r, 4)
JOIN DEMO_STATE d ON d.STATE_CODE = f.STATE_CODE
WHERE f.CLAIM_ID = c.CLAIM_ID;

UPDATE UI_CLAIM c
SET WEEKS_PAID = LEAST(d.MAX_WEEKS, GREATEST(1, DATEDIFF(week, c.FILED_TS, '2026-10-03') - 1)), STATUS = 'ACTIVE'
FROM DEMO_STATE d
WHERE d.STATE_CODE = c.STATE_CODE AND c.FRAUD_PATTERN = 'F5_FICTITIOUS_EMPLOYER';

-- F6: synthetic identities (800). New account, unverified, VOIP phone, mail-drop
-- address, disposable-style email, and no wage history (see section 4)
CREATE OR REPLACE TEMPORARY TABLE F6_PICK AS
SELECT CLAIM_ID, CLAIMANT_ID, r FROM FRAUD_PICK WHERE r BETWEEN 2321 AND 3120;

UPDATE UI_CLAIMANT t
SET ACCOUNT_CREATED_TS = DATEADD(hour, -(6 + MOD(ABS(HASH(t.CLAIMANT_ID, 'f6t')), 60)), c.FILED_TS),
    IDENTITY_VERIFIED = MOD(f.r, 5) = 0,        -- 1 in 5 passed ID verification with stolen documents
    PHONE_IS_VOIP = MOD(f.r, 3) <> 0,           -- 1 in 3 used a prepaid mobile number
    ADDRESS_IS_CMRA = U01(TO_NUMBER(RIGHT(t.CLAIMANT_ID, 6)), 'cmra') < 0.7,
    STREET_ADDRESS = IFF(U01(TO_NUMBER(RIGHT(t.CLAIMANT_ID, 6)), 'cmra') < 0.7,
                         (200 + MOD(ABS(HASH(t.CLAIMANT_ID, 'pmb')), 800)) || ' Market St PMB ' || (100 + MOD(f.r, 900)),
                         t.STREET_ADDRESS),
    EMAIL = LOWER(LEFT(t.FIRST_NAME, 2) || LEFT(t.LAST_NAME, 3)) || MOD(ABS(HASH(t.CLAIMANT_ID, 'f6e')), 99999) || '@' ||
            GET(ARRAY_CONSTRUCT('mailbox-now.net', 'quickinbox.io', 'gmail.com', 'outlook.com'), MOD(f.r, 4))::STRING,
    DOB = DATEADD(day, -(6900 + MOD(ABS(HASH(t.CLAIMANT_ID, 'f6d')), 900)), '2026-10-03'::DATE)
FROM F6_PICK f JOIN UI_CLAIM c ON c.CLAIM_ID = f.CLAIM_ID
WHERE t.CLAIMANT_ID = f.CLAIMANT_ID;

UPDATE UI_CLAIM c
SET CLAIM_EMAIL = t.EMAIL, FILING_CHANNEL = 'ONLINE', WEEKLY_BENEFIT_AMT = d.MAX_WBA,
    IS_FRAUD = TRUE, FRAUD_PATTERN = 'F6_SYNTHETIC_IDENTITY'
FROM F6_PICK f, UI_CLAIMANT t, DEMO_STATE d
WHERE f.CLAIM_ID = c.CLAIM_ID AND t.CLAIMANT_ID = c.CLAIMANT_ID AND d.STATE_CODE = c.STATE_CODE;

-- -----------------------------------------------------------------------------
-- 4. Quarterly wage records and new hires
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TABLE WAGE_RECORD (
  SSN VARCHAR(11), EMPLOYER_ID VARCHAR, STATE_CODE VARCHAR(2), YEAR_QTR VARCHAR(6),
  QTR_START DATE, WAGES NUMBER(12, 2)
) COMMENT = 'Synthetic data. Quarterly UI wage records reported by employers.';

-- Base period: four quarters before separation at the last employer.
-- F6 identities have none; F5 shell claims have 1-2 round-number quarters.
INSERT INTO WAGE_RECORD
SELECT t.SSN, c.LAST_EMPLOYER_ID, c.STATE_CODE,
       TO_VARCHAR(YEAR(q.qs)) || 'Q' || QUARTER(q.qs), q.qs,
       IFF(c.FRAUD_PATTERN = 'F5_FICTITIOUS_EMPLOYER',
           ROUND(c.WEEKLY_BENEFIT_AMT * 26, -3),
           ROUND(c.BASE_WEEKLY_WAGE * 13 * (0.85 + 0.3 * U01(HASH(c.CLAIM_ID, q.k), 'wq')), 2))
FROM UI_CLAIM c
JOIN UI_CLAIMANT t ON t.CLAIMANT_ID = c.CLAIMANT_ID
CROSS JOIN (SELECT 1 AS k UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4) k4
CROSS JOIN LATERAL (SELECT DATE_TRUNC(quarter, DATEADD(quarter, -k4.k, c.SEPARATION_DATE)) AS qs, k4.k AS k) q
WHERE (COALESCE(c.FRAUD_PATTERN, '') <> 'F6_SYNTHETIC_IDENTITY'
         OR (k4.k = 2 AND MOD(ABS(HASH(c.CLAIM_ID, 'f6wage')), 4) = 0))   -- 1 in 4 F6 has one stolen wage quarter
  AND NOT (c.FRAUD_PATTERN = 'F5_FICTITIOUS_EMPLOYER' AND k4.k > 1 + MOD(ABS(HASH(c.CLAIM_ID)), 2))
  AND c.CLAIMANT_ID NOT LIKE 'CLT-D%';

CREATE OR REPLACE TABLE NEW_HIRE (
  SSN VARCHAR(11), EMPLOYER_ID VARCHAR, STATE_CODE VARCHAR(2), HIRE_DATE DATE, SOURCE VARCHAR
) COMMENT = 'Synthetic data. State and national directory of new hires (SDNH/NDNH) reports.';

-- F4: hired 2-6 weeks into the claim while certifications continue
INSERT INTO NEW_HIRE
SELECT t.SSN, p.EMPLOYER_ID, c.STATE_CODE,
       DATEADD(week, 2 + MOD(ABS(HASH(c.CLAIM_ID, 'nh')), 4), c.FILED_TS)::DATE,
       IFF(U01(TO_NUMBER(RIGHT(c.CLAIM_ID, 7)), 'nds') < 0.5, 'SDNH', 'NDNH')
FROM UI_CLAIM c
JOIN UI_CLAIMANT t ON t.CLAIMANT_ID = c.CLAIMANT_ID
JOIN EMPLOYER_POOL p ON p.STATE_CODE = c.STATE_CODE AND p.POOL_IDX = MOD(ABS(HASH(c.CLAIM_ID, 'newemp')), 600)
WHERE c.FRAUD_PATTERN = 'F4_WORKING_WHILE_CLAIMING';

-- F4: wages earned in the claim quarter at the new employer
INSERT INTO WAGE_RECORD
SELECT n.SSN, n.EMPLOYER_ID, n.STATE_CODE, TO_VARCHAR(YEAR(n.HIRE_DATE)) || 'Q' || QUARTER(n.HIRE_DATE),
       DATE_TRUNC(quarter, n.HIRE_DATE), ROUND(c.BASE_WEEKLY_WAGE * 8, 2)
FROM NEW_HIRE n
JOIN UI_CLAIMANT t ON t.SSN = n.SSN AND t.CLAIMANT_ID NOT LIKE 'CLT-D%'
JOIN UI_CLAIM c ON c.CLAIMANT_ID = t.CLAIMANT_ID AND c.FRAUD_PATTERN = 'F4_WORKING_WHILE_CLAIMING';

-- Benign new hires: 3,000 claimants hired after their last paid week
INSERT INTO NEW_HIRE
SELECT t.SSN, p.EMPLOYER_ID, c.STATE_CODE,
       DATEADD(week, c.WEEKS_PAID + 1 + MOD(ABS(HASH(c.CLAIM_ID, 'bnh')), 3), c.FILED_TS)::DATE,
       IFF(U01(TO_NUMBER(RIGHT(c.CLAIM_ID, 7)), 'bnds') < 0.5, 'SDNH', 'NDNH')
FROM UI_CLAIM c
JOIN UI_CLAIMANT t ON t.CLAIMANT_ID = c.CLAIMANT_ID
JOIN EMPLOYER_POOL p ON p.STATE_CODE = c.STATE_CODE AND p.POOL_IDX = MOD(ABS(HASH(c.CLAIM_ID, 'bemp')), 600)
WHERE c.STATUS = 'CLOSED' AND NOT c.IS_FRAUD AND c.CLAIM_WINDOW = 'CUR'
QUALIFY ROW_NUMBER() OVER (ORDER BY HASH(c.CLAIM_ID, 'bpick')) <= 3000;

-- Benign look-alike: 400 claimants returned to work in their final paid week and
-- reported it (a new-hire match inside the claim that is not fraud)
INSERT INTO NEW_HIRE
SELECT t.SSN, p.EMPLOYER_ID, c.STATE_CODE,
       DATEADD(day, -2, DATEADD(week, c.WEEKS_PAID, c.FILED_TS))::DATE, 'SDNH'
FROM UI_CLAIM c
JOIN UI_CLAIMANT t ON t.CLAIMANT_ID = c.CLAIMANT_ID
JOIN EMPLOYER_POOL p ON p.STATE_CODE = c.STATE_CODE AND p.POOL_IDX = MOD(ABS(HASH(c.CLAIM_ID, 'rtw')), 600)
WHERE c.STATUS = 'CLOSED' AND NOT c.IS_FRAUD AND c.CLAIM_WINDOW = 'CUR' AND c.WEEKS_PAID >= 2
QUALIFY ROW_NUMBER() OVER (ORDER BY HASH(c.CLAIM_ID, 'rtwpick')) <= 400;

-- -----------------------------------------------------------------------------
-- 5. Weekly payments
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TABLE UI_PAYMENT (
  PAYMENT_ID VARCHAR, CLAIM_ID VARCHAR, WEEK_NUMBER NUMBER, WEEK_ENDING DATE,
  AMOUNT NUMBER(8, 2), BANK_ROUTING VARCHAR(9), BANK_ACCOUNT VARCHAR(17), PAYMENT_METHOD VARCHAR
) COMMENT = 'Synthetic data. Weekly UI benefit payments.';

INSERT INTO UI_PAYMENT
SELECT c.CLAIM_ID || '-W' || LPAD(w.wk, 2, '0'), c.CLAIM_ID, w.wk,
       DATEADD(week, w.wk, DATE_TRUNC(week, c.FILED_TS::DATE) + 5),
       c.WEEKLY_BENEFIT_AMT, c.BANK_ROUTING, c.BANK_ACCOUNT,
       IFF(U01(TO_NUMBER(REGEXP_REPLACE(c.CLAIM_ID, '[^0-9]', '')), 'pm') < 0.9, 'DIRECT_DEPOSIT', 'DEBIT_CARD')
FROM UI_CLAIM c
JOIN (SELECT SEQ4() + 1 AS wk FROM TABLE(GENERATOR(ROWCOUNT => 26))) w ON w.wk <= c.WEEKS_PAID;

-- -----------------------------------------------------------------------------
-- 6. Worker complaints (about fictional employers only), 20% Spanish
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TABLE WORKER_COMPLAINT (
  COMPLAINT_ID VARCHAR, EMPLOYER_ID VARCHAR, RECEIVED_DATE DATE, LANGUAGE VARCHAR(2),
  CHANNEL VARCHAR, COMPLAINT_TEXT VARCHAR
) COMMENT = 'Synthetic data. Worker complaint text about fictional employers (hero, predecessor, shells, peers).';

INSERT INTO WORKER_COMPLAINT
WITH targets AS (
  SELECT EMPLOYER_ID, ROLE,
         CASE ROLE WHEN 'HERO' THEN 90 WHEN 'PREDECESSOR' THEN 20 WHEN 'SHELL' THEN 3 WHEN 'SMALL' THEN 0 ELSE 4 END AS n
  FROM SYNTH_EMPLOYER),
rows_ AS (
  SELECT t.EMPLOYER_ID, t.ROLE, g.i
  FROM targets t JOIN (SELECT SEQ4() AS i FROM TABLE(GENERATOR(ROWCOUNT => 90))) g ON g.i < t.n),
txt AS (
  SELECT r.*, U01(HASH(r.EMPLOYER_ID, r.i), 'lang') < 0.2 AS es,
         MOD(ABS(HASH(r.EMPLOYER_ID, r.i, 'topic')), 6) AS topic
  FROM rows_ r)
SELECT 'CMP-' || LPAD(ROW_NUMBER() OVER (ORDER BY EMPLOYER_ID, i), 5, '0'), EMPLOYER_ID,
       DATEADD(day, -MOD(ABS(HASH(EMPLOYER_ID, i, 'd')), 700), '2026-10-01'::DATE),
       IFF(es, 'ES', 'EN'),
       GET(ARRAY_CONSTRUCT('WHD hotline', 'Online form', 'Walk-in', 'Email'), MOD(i, 4))::STRING,
       CASE
         WHEN ROLE = 'SHELL' AND es THEN 'Nunca trabaje para esta empresa pero aparece como mi ultimo empleador en una solicitud de desempleo que yo no presente. Alguien uso mi nombre.'
         WHEN ROLE = 'SHELL' THEN 'I never worked for this company, but it is listed as my last employer on an unemployment claim I did not file. Someone used my identity.'
         WHEN es THEN GET(ARRAY_CONSTRUCT(
           'Nos pagan como contratistas 1099 aunque trabajamos turnos fijos con supervisor. No pagan horas extra despues de 40 horas.',
           'El supervisor nos quito parte del salario por la vivienda y el transporte. Somos trabajadores H-2A y nos prometieron otra tarifa.',
           'Hubo un accidente con una maquina y la empresa nos dijo que no lo reportaramos. El companero estuvo una semana sin trabajar.',
           'Nos despidieron a todos el mismo dia y nos dijeron que solicitaramos desempleo, pero algunos siguen trabajando para ellos en efectivo.',
           'No nos dieron equipo de proteccion para trabajar en el calor. Varios companeros se enfermaron.',
           'Cambiaron el nombre de la compania pero son los mismos duenos y la misma oficina. Siguen sin pagar los salarios atrasados.'), topic)::STRING
         ELSE GET(ARRAY_CONSTRUCT(
           'We are paid as 1099 contractors even though we work fixed shifts under a supervisor. No overtime is paid after 40 hours.',
           'The crew lead deducted housing and transport from our pay. We are H-2A workers and were promised a higher hourly rate than we receive.',
           'A worker was hurt on a forklift and the manager told everyone not to report it. He missed a week of work and it was never written down.',
           'They laid off the whole crew on the same day and told us to file for unemployment, but some people are still working for them for cash.',
           'No heat breaks, no water stations and no protective equipment on the site. Several coworkers got sick last month.',
           'The company changed its name but the owners, the office and the managers are the same. Back wages from the old company were never paid.'), topic)::STRING
       END
FROM txt;

-- Dynamic Tables in 06 read these tables; CREATE OR REPLACE resets change
-- tracking, so re-enable it (rerun 06 after rerunning this file)
ALTER TABLE UI_CLAIM SET CHANGE_TRACKING = TRUE;
ALTER TABLE UI_CLAIMANT SET CHANGE_TRACKING = TRUE;
ALTER TABLE NEW_HIRE SET CHANGE_TRACKING = TRUE;
ALTER TABLE WAGE_RECORD SET CHANGE_TRACKING = TRUE;
ALTER TABLE SYNTH_EMPLOYER SET CHANGE_TRACKING = TRUE;
ALTER TABLE DEMO_STATE SET CHANGE_TRACKING = TRUE;
ALTER TABLE DOL_FRAUD_DEMO.CURATED.EMPLOYER_MASTER SET CHANGE_TRACKING = TRUE;

-- -----------------------------------------------------------------------------
-- 7. Validation: pattern counts, fraud share by state, real-employer guard
-- -----------------------------------------------------------------------------
SELECT COALESCE(FRAUD_PATTERN, 'NONE') AS pattern, COUNT(*) AS claims, COUNT(DISTINCT STATE_CODE) AS states,
       ROUND(SUM(WEEKLY_BENEFIT_AMT * WEEKS_PAID) / 1e6, 2) AS paid_usd_m
FROM UI_CLAIM GROUP BY 1 ORDER BY 2 DESC;

SELECT STATE_CODE, COUNT(*) AS current_claims, COUNT_IF(IS_FRAUD) AS fraud_claims,
       ROUND(COUNT_IF(IS_FRAUD) / COUNT(*) * 100, 2) AS fraud_pct
FROM UI_CLAIM WHERE CLAIM_WINDOW = 'CUR' GROUP BY 1 ORDER BY 1;

-- Must return 0: no employer-level synthetic flag on a real employer
SELECT COUNT(*) AS real_employers_with_employer_level_fraud
FROM UI_CLAIM c JOIN DOL_FRAUD_DEMO.CURATED.EMPLOYER_MASTER m ON m.EMPLOYER_ID = c.LAST_EMPLOYER_ID
WHERE c.FRAUD_PATTERN = 'F5_FICTITIOUS_EMPLOYER' AND NOT m.IS_SYNTHETIC;

SELECT 'claimants' AS t, COUNT(*) FROM UI_CLAIMANT UNION ALL SELECT 'claims', COUNT(*) FROM UI_CLAIM
UNION ALL SELECT 'payments', COUNT(*) FROM UI_PAYMENT UNION ALL SELECT 'wage records', COUNT(*) FROM WAGE_RECORD
UNION ALL SELECT 'new hires', COUNT(*) FROM NEW_HIRE UNION ALL SELECT 'complaints', COUNT(*) FROM WORKER_COMPLAINT;

-- Must return 0: display ids are unique across public and synthetic employers
SELECT COUNT(*) - COUNT(DISTINCT DISPLAY_ID) AS duplicate_display_ids FROM DOL_FRAUD_DEMO.CURATED.EMPLOYER_MASTER;
