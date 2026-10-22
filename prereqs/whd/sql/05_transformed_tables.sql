-- Phase 2: TRANSFORMED layer — typed case table, program reference, and unpivoted case x program table.
-- Generated program mapping verified against RAW.WHD_ENFORCEMENT column names (note _BW_AMT / _EE_CNT naming quirks
-- for FLSA_SMW14, CWHSSA, EPPA; FLSA_CL has no back-wage column; EEV has violations only).
USE ROLE DOL_WHD_DEMO_ROLE;
USE WAREHOUSE DOL_WHD_WH;
USE DATABASE DOL_WHD_DEMO;

CREATE SCHEMA IF NOT EXISTS DOL_WHD_DEMO.TRANSFORMED;
USE SCHEMA DOL_WHD_DEMO.TRANSFORMED;

-- Program reference: single source of truth for labels and dashboard categories.
CREATE OR REPLACE TABLE TRANSFORMED.PROGRAM_REF AS
SELECT CAST(column1 AS VARCHAR(12))  AS program_code,
       CAST(column2 AS VARCHAR(80))  AS program_label,
       CAST(column3 AS VARCHAR(40))  AS program_category,
       CAST(column4 AS VARCHAR(200)) AS description
FROM VALUES
    ('FLSA', 'Fair Labor Standards Act', 'Wage & Hour (FLSA)', 'Minimum wage, overtime and retaliation'),
    ('FLSA_CL', 'FLSA Child Labor', 'Child Labor', 'Child labor provisions (ee = minors employed in violation)'),
    ('FLSA_SMW14', 'FLSA 14(c) Subminimum Wage', 'Wage & Hour (FLSA)', 'Section 14(c) workers with disabilities'),
    ('FLSA_HMWKR', 'FLSA Homeworker', 'Wage & Hour (FLSA)', 'Industrial homework regulations'),
    ('FLSA_SMWPW', 'FLSA Subminimum Wage - Patient Workers', 'Wage & Hour (FLSA)', 'Subminimum wage certificates: patient workers'),
    ('FLSA_SMWAP', 'FLSA Subminimum Wage - Apprentices', 'Wage & Hour (FLSA)', 'Subminimum wage certificates: apprentices'),
    ('FLSA_SMWFT', 'FLSA Subminimum Wage - Full-Time Students', 'Wage & Hour (FLSA)', 'Subminimum wage certificates: full-time students'),
    ('FLSA_SMWL', 'FLSA Subminimum Wage - Learners', 'Wage & Hour (FLSA)', 'Subminimum wage certificates: learners'),
    ('FLSA_SMWMG', 'FLSA Subminimum Wage - Messengers', 'Wage & Hour (FLSA)', 'Subminimum wage certificates: messengers'),
    ('FLSA_SMWSL', 'FLSA Subminimum Wage - Student Learners', 'Wage & Hour (FLSA)', 'Subminimum wage certificates: student learners'),
    ('SCA', 'Service Contract Act', 'Government Contracts', 'Prevailing wages on federal service contracts'),
    ('DBRA', 'Davis-Bacon and Related Acts', 'Government Contracts', 'Prevailing wages on federal construction'),
    ('CWHSSA', 'Contract Work Hours & Safety Standards Act', 'Government Contracts', 'Overtime on federal contracts'),
    ('CA', 'Copeland Anti-Kickback Act', 'Government Contracts', 'Kickbacks on federal construction'),
    ('PCA', 'Public Contracts Act', 'Government Contracts', 'Walsh-Healey public contracts'),
    ('MSPA', 'Migrant & Seasonal Agricultural Worker Protection Act', 'Agriculture', 'Protections for migrant/seasonal farmworkers'),
    ('H2A', 'H-2A Temporary Agricultural Workers', 'Agriculture', 'Temporary foreign agricultural workers'),
    ('SRAW', 'Seasonal Agricultural Workers', 'Agriculture', 'Seasonal agricultural workers'),
    ('OSHA', 'OSH Act Field Sanitation / Housing', 'Agriculture', 'WHD-enforced field sanitation and temporary labor camp standards'),
    ('H1B', 'H-1B Specialty Occupation Visas', 'Immigration / Visa Programs', 'Specialty occupation nonimmigrant workers'),
    ('H1A', 'H-1A Nurses', 'Immigration / Visa Programs', 'Registered nurse nonimmigrant workers'),
    ('H2B', 'H-2B Temporary Non-Agricultural Workers', 'Immigration / Visa Programs', 'Temporary foreign non-agricultural workers'),
    ('CREW', 'Longshore Crewmembers (D-1)', 'Immigration / Visa Programs', 'Alien crewmembers performing longshore work'),
    ('EEV', 'Employment Eligibility Verification (I-9)', 'Immigration / Visa Programs', 'Form I-9 inspections (violations only)'),
    ('FMLA', 'Family and Medical Leave Act', 'Leave & Other Protections', 'Job-protected family and medical leave'),
    ('EPPA', 'Employee Polygraph Protection Act', 'Leave & Other Protections', 'Restrictions on employer polygraph use'),
    ('CCPA', 'Consumer Credit Protection Act', 'Leave & Other Protections', 'Wage garnishment limits');

-- One row per concluded case, typed. Blanks are '' in RAW, so NULLIF(TRIM()) precedes every cast.
CREATE OR REPLACE TABLE TRANSFORMED.WHD_CASE AS
WITH typed AS (
    SELECT
        CAST(TRY_TO_NUMBER(NULLIF(TRIM(CASE_ID),'')) AS NUMBER(12))                       AS case_id,
        CAST(NULLIF(TRIM(LEGAL_NAME),'') AS VARCHAR(200))         AS legal_name,
        CAST(NULLIF(TRIM(TRADE_NM),'') AS VARCHAR(200))           AS trade_name,
        CAST(NULLIF(TRIM(STREET_ADDR_1_TXT),'') AS VARCHAR(200))  AS street_address,
        CAST(NULLIF(TRIM(CTY_NM),'') AS VARCHAR(100))             AS city,
        CAST(NULLIF(TRIM(ST_CD),'') AS VARCHAR(2))                AS state_code,
        CAST(NULLIF(TRIM(ZIP_CD),'') AS VARCHAR(10))              AS zip_code,
        CAST(NULLIF(TRIM(NAIC_CD),'') AS VARCHAR(6))              AS naics_code,
        CAST(NULLIF(TRIM(NAICS_CODE_DESCRIPTION),'') AS VARCHAR(200)) AS naics_description,
        TRY_TO_TIMESTAMP_TZ(NULLIF(TRIM(FINDINGS_START_DATE),''))::DATE                                AS raw_start_date,
        TRY_TO_TIMESTAMP_TZ(NULLIF(TRIM(FINDINGS_END_DATE),''))::DATE                                  AS raw_end_date,
        TRY_TO_TIMESTAMP_TZ(NULLIF(TRIM(LOAD_DT),''))::DATE                                            AS dol_load_date,
        CAST(TRY_TO_NUMBER(NULLIF(TRIM(CASE_VIOLTN_CNT),'')) AS NUMBER(10))                AS total_violations,
        CAST(TRY_TO_NUMBER(NULLIF(TRIM(BW_ATP_AMT),''),14,2) AS NUMBER(14,2))                   AS total_back_wages,
        CAST(TRY_TO_NUMBER(NULLIF(TRIM(EE_ATP_CNT),'')) AS NUMBER(10))                     AS employees_owed_back_wages,
        CAST(TRY_TO_NUMBER(NULLIF(TRIM(EE_VIOLTD_CNT),'')) AS NUMBER(10))                  AS employees_with_violations,
        CAST(TRY_TO_NUMBER(NULLIF(TRIM(CMP_ASSD),''),14,2) AS NUMBER(14,2))                     AS total_cmp_assessed,
        CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_MW_BW_ATP_AMT),''),14,2) AS NUMBER(14,2))           AS flsa_min_wage_back_wages,
        CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_OT_BW_ATP_AMT),''),14,2) AS NUMBER(14,2))           AS flsa_overtime_back_wages,
        CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_15A3_BW_ATP_AMT),''),14,2) AS NUMBER(14,2))         AS flsa_retaliation_back_wages,
        CAST(NULLIF(NULLIF(TRIM(FLSA_REPEAT_VIOLATOR),''),'N/A') AS VARCHAR(2)) AS repeat_willful_code,
        COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_CL_VIOLTN_CNT),'')),0) + COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_CL_MINOR_CNT),'')),0) AS cl_signal,
        CAST(
          IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_CL_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMW14_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_HMWKR_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWPW_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWAP_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWFT_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWL_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWMG_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWSL_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(SCA_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(DBRA_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(CWHSSA_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(CA_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(PCA_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(MSPA_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(H2A_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(SRAW_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(OSHA_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(H1B_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(H1A_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(H2B_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(CREW_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(EEV_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(FMLA_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(EPPA_VIOLTN_CNT),'')),0) > 0, 1, 0)
        + IFF(COALESCE(TRY_TO_NUMBER(NULLIF(TRIM(CCPA_VIOLTN_CNT),'')),0) > 0, 1, 0)
        AS NUMBER(3))                                             AS programs_violated_count,
        _LOADED_AT                                                AS _loaded_at
    FROM DOL_WHD_DEMO.RAW.WHD_ENFORCEMENT
),
dated AS (
    SELECT t.*,
        -- Out-of-range dates (e.g. 3590-01-10) are nulled, not dropped.
        IFF(raw_start_date BETWEEN '1990-01-01' AND CURRENT_DATE(), raw_start_date, NULL) AS findings_start_date,
        IFF(raw_end_date   BETWEEN '1990-01-01' AND CURRENT_DATE(), raw_end_date,   NULL) AS findings_end_date
    FROM typed t
)
SELECT
    case_id, legal_name, trade_name, street_address, city, state_code, zip_code,
    naics_code, naics_description, CAST(LEFT(naics_code, 2) AS VARCHAR(2)) AS naics_sector_2,
    findings_start_date, findings_end_date,
    CAST(YEAR(findings_start_date) AS NUMBER(4)) AS findings_start_year,
    CAST(IFF(findings_end_date >= findings_start_date,
             DATEDIFF('day', findings_start_date, findings_end_date), NULL) AS NUMBER(6)) AS findings_duration_days,
    dol_load_date,
    total_violations, total_back_wages, employees_owed_back_wages, employees_with_violations, total_cmp_assessed,
    flsa_min_wage_back_wages, flsa_overtime_back_wages, flsa_retaliation_back_wages, repeat_willful_code,
    COALESCE(total_violations, 0) > 0                 AS has_violations,
    COALESCE(total_back_wages, 0) > 0                 AS has_back_wages,
    COALESCE(total_cmp_assessed, 0) > 0               AS has_cmp,
    COALESCE(repeat_willful_code IN ('R','RW'), FALSE) AS is_repeat_violator,
    COALESCE(repeat_willful_code IN ('W','RW'), FALSE) AS is_willful_violator,
    cl_signal > 0                                     AS has_child_labor,
    COALESCE(YEAR(findings_start_date) >= 2024, FALSE) AS is_recent_partial_year,
    (raw_start_date IS NOT NULL AND findings_start_date IS NULL)
      OR (raw_end_date IS NOT NULL AND findings_end_date IS NULL)
      OR (findings_end_date < findings_start_date)    AS has_date_issue,
    CAST(DIV0NULL(total_back_wages, employees_owed_back_wages) AS NUMBER(14,2)) AS back_wages_per_employee,
    programs_violated_count,
    _loaded_at
FROM dated;

ALTER TABLE TRANSFORMED.WHD_CASE ADD CONSTRAINT pk_whd_case PRIMARY KEY (case_id);

-- Case x program, one row per program with any non-zero measure.
-- UNION ALL chosen over UNPIVOT: measure sets and column names are uneven across programs
-- (missing back-wage/CMP columns, _BW_AMT vs _BW_ATP_AMT, _EE_CNT vs _EE_ATP_CNT). A multi-measure
-- UNPIVOT would need four unpivots re-joined on program; one SELECT per program reads as the mapping itself.
CREATE OR REPLACE TABLE TRANSFORMED.WHD_CASE_PROGRAM AS
WITH raw_c AS (
    SELECT *, CAST(TRY_TO_NUMBER(NULLIF(TRIM(CASE_ID),'')) AS NUMBER(12)) AS case_id_typed FROM DOL_WHD_DEMO.RAW.WHD_ENFORCEMENT
),
long AS (
    SELECT case_id_typed AS case_id, 'FLSA' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_CMP_ASSD_AMT),''),14,2) AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'FLSA_CL' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_CL_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(NULL AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_CL_MINOR_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_CL_CMP_ASSD_AMT),''),14,2) AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'FLSA_SMW14' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMW14_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMW14_BW_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMW14_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(NULL AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'FLSA_HMWKR' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_HMWKR_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_HMWKR_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_HMWKR_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_HMWKR_CMP_ASSD_AMT),''),14,2) AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'FLSA_SMWPW' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWPW_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWPW_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWPW_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(NULL AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'FLSA_SMWAP' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWAP_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWAP_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWAP_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(NULL AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'FLSA_SMWFT' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWFT_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWFT_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWFT_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(NULL AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'FLSA_SMWL' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWL_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWL_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWL_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(NULL AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'FLSA_SMWMG' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWMG_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWMG_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWMG_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(NULL AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'FLSA_SMWSL' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWSL_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWSL_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FLSA_SMWSL_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(NULL AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'SCA' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(SCA_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(SCA_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(SCA_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(NULL AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'DBRA' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(DBRA_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(DBRA_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(DBRA_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(NULL AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'CWHSSA' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(CWHSSA_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(CWHSSA_BW_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(CWHSSA_EE_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(NULL AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'CA' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(CA_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(CA_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(CA_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(NULL AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'PCA' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(PCA_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(PCA_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(PCA_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(NULL AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'MSPA' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(MSPA_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(MSPA_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(MSPA_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(TRY_TO_NUMBER(NULLIF(TRIM(MSPA_CMP_ASSD_AMT),''),14,2) AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'H2A' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(H2A_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(H2A_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(H2A_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(TRY_TO_NUMBER(NULLIF(TRIM(H2A_CMP_ASSD_AMT),''),14,2) AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'SRAW' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(SRAW_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(SRAW_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(SRAW_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(NULL AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'OSHA' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(OSHA_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(OSHA_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(OSHA_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(TRY_TO_NUMBER(NULLIF(TRIM(OSHA_CMP_ASSD_AMT),''),14,2) AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'H1B' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(H1B_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(H1B_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(H1B_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(TRY_TO_NUMBER(NULLIF(TRIM(H1B_CMP_ASSD_AMT),''),14,2) AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'H1A' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(H1A_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(H1A_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(H1A_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(TRY_TO_NUMBER(NULLIF(TRIM(H1A_CMP_ASSD_AMT),''),14,2) AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'H2B' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(H2B_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(H2B_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(H2B_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(NULL AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'CREW' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(CREW_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(CREW_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(CREW_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(TRY_TO_NUMBER(NULLIF(TRIM(CREW_CMP_ASSD_AMT),''),14,2) AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'EEV' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(EEV_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(NULL AS NUMBER(14,2)) AS back_wages,
           CAST(NULL AS NUMBER(10)) AS employees_owed, CAST(NULL AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'FMLA' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FMLA_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(FMLA_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(FMLA_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(TRY_TO_NUMBER(NULLIF(TRIM(FMLA_CMP_ASSD_AMT),''),14,2) AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'EPPA' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(EPPA_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(EPPA_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(EPPA_EE_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(TRY_TO_NUMBER(NULLIF(TRIM(EPPA_CMP_ASSD_AMT),''),14,2) AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
    UNION ALL
    SELECT case_id_typed AS case_id, 'CCPA' AS program_code,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(CCPA_VIOLTN_CNT),'')) AS NUMBER(10)) AS violation_count, CAST(TRY_TO_NUMBER(NULLIF(TRIM(CCPA_BW_ATP_AMT),''),14,2) AS NUMBER(14,2)) AS back_wages,
           CAST(TRY_TO_NUMBER(NULLIF(TRIM(CCPA_EE_ATP_CNT),'')) AS NUMBER(10)) AS employees_owed, CAST(NULL AS NUMBER(14,2)) AS cmp_assessed
    FROM raw_c
)
SELECT l.case_id, l.program_code, r.program_label, r.program_category,
       l.violation_count, l.back_wages, l.employees_owed, l.cmp_assessed
FROM long l
JOIN TRANSFORMED.PROGRAM_REF r ON r.program_code = l.program_code
WHERE COALESCE(l.violation_count,0) > 0 OR COALESCE(l.back_wages,0) > 0
   OR COALESCE(l.employees_owed,0) > 0 OR COALESCE(l.cmp_assessed,0) > 0;
