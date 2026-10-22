-- =============================================================================
-- DOL Fraud Detection Demo - 09 Semantic views (Cortex Analyst / CoWork agent)
--   SV_UI_INTEGRITY  : public state UI integrity (ETA/BAM, anomalies, forecast)
--                      + synthetic claim triage and fraud rings
--   SV_EMPLOYER_RISK : Employer Risk 360 across WHD, OSHA/ITA and OFLC (public
--                      + fictional hero), AI enrichment, complaints
-- Every description says whether a field is (public) or (synthetic).
-- Real employer names are never exposed: only DISPLAY_ID.
-- Ring link values (bank, device, IP, phone) are exposed only as LINK_LABEL
-- (last 4 or a hash), never raw, so the agent cannot return them.
-- Created with SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML (YAML inline; session
-- variables cap at 256 bytes). Add TRUE as a 3rd argument to validate only.
-- =============================================================================

USE ROLE DOL_FRAUD_DEMO_ROLE;
USE WAREHOUSE DOL_FRAUD_WH;
USE SCHEMA DOL_FRAUD_DEMO.ANALYTICS;

-- Ring summary without raw link values. Cortex Analyst sees every column of a
-- semantic view's base table (including primary keys), so the RINGS table is
-- built on this view, not on DT_CLAIM_RING_STATS, which holds raw bank,
-- device, IP and phone values.
CREATE OR REPLACE VIEW DOL_FRAUD_DEMO.ANALYTICS.V_RING_SUMMARY
  COMMENT = 'Synthetic data. Fraud ring summary with masked link labels only (last 4 for bank accounts, hashed label otherwise). No raw link values.'
AS
SELECT UPPER(LEFT(SHA2(LINK_TYPE || ':' || LINK_VALUE), 12)) AS RING_ID,
       LINK_TYPE,
       IFF(LINK_TYPE = 'BANK_ACCOUNT', '****' || RIGHT(SPLIT_PART(LINK_VALUE, ':', 2), 4),
           LINK_TYPE || '-' || UPPER(LEFT(SHA2(LINK_VALUE), 8))) AS LINK_LABEL,
       STATES, CLAIM_COUNT, STATE_COUNT, TOTAL_PAID, FIRST_FILED, LAST_FILED, FILING_SPAN_HOURS, DATA_ORIGIN
FROM DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_RING_STATS;
-- Persona SELECT on this view is granted in 10_agent.sql (roles come from 11).

CALL SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML('DOL_FRAUD_DEMO.ANALYTICS', $$
name: SV_UI_INTEGRITY
description: >-
  Unemployment insurance (UI) program integrity. Public U.S. DOL data (ETA 539 weekly claims,
  ETA 227 overpayments, ETA 5159 payments, BAM fraud rates, Cortex anomaly and forecast results)
  plus synthetic claim-level data (claims, rule flags, ML scores, fraud rings) for six demo states.
  Synthetic data is not real individuals. Flags are risk indicators, not findings of fraud.
tables:
  - name: STATES
    description: (public) U.S. states and territories.
    base_table: {database: DOL_FRAUD_DEMO, schema: CURATED, table: STATE_REF}
    primary_key: {columns: [STATE_CODE]}
    dimensions:
      - name: STATE_CODE
        expr: STATE_CODE
        data_type: VARCHAR
        description: (public) Two-letter state postal code.
        synonyms: [state, state abbreviation]
      - name: STATE_NAME
        expr: STATE_NAME
        data_type: VARCHAR
        description: (public) State name.
  - name: STATE_QUARTERS
    description: (public) Quarterly UI claims, benefits paid, fraud overpayments, recoveries and BAM rates by state, 2015 onward.
    base_table: {database: DOL_FRAUD_DEMO, schema: ANALYTICS, table: DT_STATE_UI_BASELINE}
    primary_key: {columns: [STATE_CODE, QUARTER_ENDING]}
    dimensions:
      - name: BASELINE_STATE_CODE
        expr: STATE_CODE
        data_type: VARCHAR
        description: (public) State code for the quarter row.
    time_dimensions:
      - name: QUARTER_ENDING
        expr: QUARTER_ENDING
        data_type: DATE
        description: (public) Last day of the calendar quarter.
        synonyms: [quarter, period]
    facts:
      - name: INITIAL_CLAIMS_F
        expr: INITIAL_CLAIMS
        data_type: NUMBER
        description: (public) ETA 539 initial claims filed in the quarter.
      - name: BENEFITS_PAID_F
        expr: BENEFITS_PAID
        data_type: NUMBER
        description: (public) ETA 5159 state UI benefits paid in dollars.
      - name: FRAUD_DOLLARS_F
        expr: FRAUD_DOLLARS
        data_type: NUMBER
        description: (public) ETA 227 fraud overpayments established, dollars.
      - name: FRAUD_CASES_F
        expr: FRAUD_CASES
        data_type: NUMBER
        description: (public) ETA 227 fraud overpayment cases established.
      - name: FRAUD_RECOVERED_F
        expr: FRAUD_RECOVERED
        data_type: NUMBER
        description: (public) ETA 227 fraud overpayment dollars recovered.
      - name: CROSSMATCH_DETECTED_F
        expr: CROSSMATCH_DETECTED_DOLLARS
        data_type: NUMBER
        description: (public) ETA 227 fraud dollars detected by wage, interstate and new-hire crossmatches.
      - name: BAM_FRAUD_RATE_F
        expr: BAM_FRAUD_RATE
        data_type: NUMBER
        description: (public) BAM estimated fraud rate (share of benefits paid), quarterly, 2019 Q3 to 2024 Q2.
    metrics:
      - name: TOTAL_INITIAL_CLAIMS
        expr: SUM(INITIAL_CLAIMS_F)
        description: (public) Total initial UI claims.
      - name: TOTAL_BENEFITS_PAID
        expr: SUM(BENEFITS_PAID_F)
        description: (public) Total UI benefits paid, dollars.
      - name: TOTAL_FRAUD_OVERPAYMENTS
        expr: SUM(FRAUD_DOLLARS_F)
        description: (public) Total fraud overpayments established, dollars.
        synonyms: [fraud overpayments, fraud dollars]
      - name: FRAUD_SHARE_OF_PAID
        expr: SUM(FRAUD_DOLLARS_F) / NULLIF(SUM(BENEFITS_PAID_F), 0)
        description: (public) Fraud overpayments established as a share of benefits paid.
      - name: FRAUD_RECOVERY_RATE
        expr: SUM(FRAUD_RECOVERED_F) / NULLIF(SUM(FRAUD_DOLLARS_F), 0)
        description: (public) Fraud dollars recovered as a share of fraud dollars established.
      - name: CROSSMATCH_SHARE
        expr: SUM(CROSSMATCH_DETECTED_F) / NULLIF(SUM(FRAUD_DOLLARS_F), 0)
        description: (public) Share of fraud dollars found by data crossmatches.
      - name: AVG_BAM_FRAUD_RATE
        expr: AVG(BAM_FRAUD_RATE_F)
        description: (public) Average BAM estimated fraud rate.
  - name: SURGE_ALERTS
    description: (public) Weeks where state initial claims exceeded the Cortex anomaly model upper bound (trained on 2015-2019).
    base_table: {database: DOL_FRAUD_DEMO, schema: ML, table: V_CLAIMS_SURGE_ALERTS}
    primary_key: {columns: [STATE_CODE, WEEK_ENDING]}
    dimensions:
      - name: SURGE_STATE_CODE
        expr: STATE_CODE
        data_type: VARCHAR
        description: (public) State code.
      - name: SEVERITY
        expr: SEVERITY
        data_type: VARCHAR
        description: (public) SEVERE (3x expected or more), HIGH (1.5x), ELEVATED.
        is_enum: true
        sample_values: [SEVERE, HIGH, ELEVATED]
    time_dimensions:
      - name: SURGE_WEEK
        expr: WEEK_ENDING
        data_type: DATE
        description: (public) Week ending date of the surge.
    facts:
      - name: SURGE_CLAIMS_F
        expr: INITIAL_CLAIMS
        data_type: NUMBER
        description: (public) Initial claims in the surge week.
      - name: SURGE_MULTIPLE_F
        expr: SURGE_MULTIPLE
        data_type: NUMBER
        description: (public) Initial claims divided by the model forecast.
    metrics:
      - name: SURGE_WEEKS
        expr: COUNT(SURGE_CLAIMS_F)
        description: (public) Number of surge weeks.
      - name: MAX_SURGE_MULTIPLE
        expr: MAX(SURGE_MULTIPLE_F)
        description: (public) Largest claims-to-forecast multiple.
  - name: FRAUD_FORECAST
    description: (public) Cortex FORECAST of ETA 227 fraud overpayment dollars, next four quarters, demo states.
    base_table: {database: DOL_FRAUD_DEMO, schema: ML, table: FRAUD_OP_FORECAST}
    primary_key: {columns: [STATE_CODE, QUARTER_ENDING]}
    dimensions:
      - name: FORECAST_STATE_CODE
        expr: STATE_CODE
        data_type: VARCHAR
        description: (public) State code.
    time_dimensions:
      - name: FORECAST_QUARTER
        expr: QUARTER_ENDING
        data_type: DATE
        description: (public) Forecast quarter end date.
    facts:
      - name: FORECAST_F
        expr: FORECAST
        data_type: NUMBER
        description: (public) Forecast fraud overpayment dollars.
    metrics:
      - name: FORECAST_FRAUD_OVERPAYMENTS
        expr: SUM(FORECAST_F)
        description: (public) Forecast fraud overpayment dollars.
  - name: CLAIMS
    description: (synthetic) Current-year UI claims in CA, NY, TX, FL, GA and PA with rule flags, ML fraud probability and priority. Not real individuals.
    base_table: {database: DOL_FRAUD_DEMO, schema: ANALYTICS, table: V_CLAIM_RISK}
    primary_key: {columns: [CLAIM_ID]}
    dimensions:
      - name: CLAIM_ID
        expr: CLAIM_ID
        data_type: VARCHAR
        description: (synthetic) Claim identifier.
      - name: CLAIM_STATE_CODE
        expr: STATE_CODE
        data_type: VARCHAR
        description: (synthetic) State where the claim was filed.
      - name: DETECTION_SOURCE
        expr: DETECTION_SOURCE
        data_type: VARCHAR
        description: (synthetic) Which layer flagged the claim. ML_ONLY means the model caught what rules missed.
        is_enum: true
        sample_values: [RULES_AND_ML, ML_ONLY, RULES_ONLY, NONE]
      - name: LAST_EMPLOYER_DISPLAY_ID
        expr: LAST_EMPLOYER_DISPLAY_ID
        data_type: VARCHAR
        description: (synthetic) Pseudonymous id of the claimant's last employer.
      - name: RULE_REASONS_TEXT
        expr: ARRAY_TO_STRING(RULE_REASONS, '; ')
        data_type: VARCHAR
        description: (synthetic) Plain-language reasons from the rules engine.
      - name: FLAG_SHARED_BANK
        expr: R1_SHARED_BANK_ACCOUNT
        data_type: BOOLEAN
        description: (synthetic) Rule R1, bank account shared by 5 or more claims.
      - name: FLAG_DEVICE_FARM
        expr: R2_DEVICE_OR_IP_FARM
        data_type: BOOLEAN
        description: (synthetic) Rule R2, device or IP used for 10 or more claims.
      - name: FLAG_MULTI_STATE
        expr: R3_MULTI_STATE_SSN
        data_type: BOOLEAN
        description: (synthetic) Rule R3, same SSN claiming in 2 or more states.
      - name: FLAG_WORKING
        expr: R4_WORKING_WHILE_CLAIMING
        data_type: BOOLEAN
        description: (synthetic) Rule R4, new-hire report or wages during the claim.
      - name: FLAG_FICTITIOUS_EMPLOYER
        expr: R5_FICTITIOUS_EMPLOYER
        data_type: BOOLEAN
        description: (synthetic) Rule R5, recently registered employer with no public footprint and a separation burst.
      - name: FLAG_SYNTHETIC_IDENTITY
        expr: R6_SYNTHETIC_IDENTITY
        data_type: BOOLEAN
        description: (synthetic) Rule R6, unverified new identity with no wage history.
    time_dimensions:
      - name: FILED_DATE
        expr: FILED_TS::DATE
        data_type: DATE
        description: (synthetic) Date the claim was filed.
    facts:
      - name: AMOUNT_PAID_F
        expr: AMOUNT_PAID
        data_type: NUMBER
        description: (synthetic) Benefits paid on the claim to date, dollars.
      - name: PRIORITY_SCORE_F
        expr: PRIORITY_SCORE
        data_type: NUMBER
        description: (synthetic) Triage priority 0-100 combining rules and ML.
      - name: ML_PROBABILITY_F
        expr: ML_FRAUD_PROBABILITY
        data_type: NUMBER
        description: (synthetic) Model fraud probability 0-1.
      - name: RULES_HIT_F
        expr: RULES_HIT
        data_type: NUMBER
        description: (synthetic) Number of rules triggered.
    metrics:
      - name: CLAIM_COUNT
        expr: COUNT(AMOUNT_PAID_F)
        description: (synthetic) Number of claims.
      - name: FLAGGED_CLAIMS
        expr: COUNT_IF(PRIORITY_SCORE_F >= 50)
        description: (synthetic) Claims with priority 50 or higher (rules or ML).
      - name: DOLLARS_AT_RISK
        expr: SUM(IFF(PRIORITY_SCORE_F >= 50, AMOUNT_PAID_F, 0))
        description: (synthetic) Benefits paid on flagged claims, dollars.
        synonyms: [exposure, at-risk dollars]
      - name: TOTAL_CLAIM_PAYMENTS
        expr: SUM(AMOUNT_PAID_F)
        description: (synthetic) Benefits paid on all claims, dollars.
      - name: AVG_ML_PROBABILITY
        expr: AVG(ML_PROBABILITY_F)
        description: (synthetic) Average model fraud probability.
  - name: RINGS
    description: (synthetic) Clusters of 3 or more current claims sharing one bank account, device, IP address or phone.
    base_table: {database: DOL_FRAUD_DEMO, schema: ANALYTICS, table: V_RING_SUMMARY}
    primary_key: {columns: [RING_ID]}
    dimensions:
      - name: RING_ID
        expr: RING_ID
        data_type: VARCHAR
        description: (synthetic) Hashed ring identifier.
      - name: LINK_TYPE
        expr: LINK_TYPE
        data_type: VARCHAR
        description: (synthetic) Shared attribute type.
        is_enum: true
        sample_values: [BANK_ACCOUNT, DEVICE, IP, PHONE]
      - name: LINK_LABEL
        expr: LINK_LABEL
        data_type: VARCHAR
        description: "(synthetic) Masked label for the shared attribute: last 4 digits for bank accounts, a hashed label for devices, IPs and phones. The raw value is never exposed."
        synonyms: [ring id, shared account, shared device]
      - name: RING_STATES
        expr: ARRAY_TO_STRING(STATES, ', ')
        data_type: VARCHAR
        description: (synthetic) States the cluster spans.
    facts:
      - name: RING_CLAIMS_F
        expr: CLAIM_COUNT
        data_type: NUMBER
        description: (synthetic) Claims in the cluster.
      - name: RING_STATE_COUNT_F
        expr: STATE_COUNT
        data_type: NUMBER
        description: (synthetic) Number of states in the cluster.
      - name: RING_PAID_F
        expr: TOTAL_PAID
        data_type: NUMBER
        description: (synthetic) Benefits paid to the cluster, dollars.
    metrics:
      - name: RING_COUNT
        expr: COUNT(RING_CLAIMS_F)
        description: (synthetic) Number of clusters.
      - name: RING_DOLLARS
        expr: SUM(RING_PAID_F)
        description: (synthetic) Benefits paid to clustered claims, dollars.
relationships:
  - name: QUARTERS_TO_STATES
    left_table: STATE_QUARTERS
    right_table: STATES
    relationship_columns: [{left_column: BASELINE_STATE_CODE, right_column: STATE_CODE}]
    join_type: inner
    relationship_type: many_to_one
  - name: SURGE_TO_STATES
    left_table: SURGE_ALERTS
    right_table: STATES
    relationship_columns: [{left_column: SURGE_STATE_CODE, right_column: STATE_CODE}]
    join_type: inner
    relationship_type: many_to_one
  - name: FORECAST_TO_STATES
    left_table: FRAUD_FORECAST
    right_table: STATES
    relationship_columns: [{left_column: FORECAST_STATE_CODE, right_column: STATE_CODE}]
    join_type: inner
    relationship_type: many_to_one
  - name: CLAIMS_TO_STATES
    left_table: CLAIMS
    right_table: STATES
    relationship_columns: [{left_column: CLAIM_STATE_CODE, right_column: STATE_CODE}]
    join_type: inner
    relationship_type: many_to_one
verified_queries:
  - name: fraud_overpayments_by_year
    question: What were total UI fraud overpayments by year since 2019?
    use_as_onboarding_question: true
    verified_by: DOL Fraud Demo build
    verified_at: 1791936000
    sql: >-
      SELECT YEAR(quarter_ending) AS year, SUM(fraud_dollars_f) AS fraud_overpayments
      FROM __state_quarters WHERE quarter_ending >= '2019-01-01' GROUP BY 1 ORDER BY 1
  - name: detection_source_mix
    question: How many synthetic claims did ML catch that the rules missed?
    use_as_onboarding_question: true
    verified_by: DOL Fraud Demo build
    verified_at: 1791936000
    sql: >-
      SELECT detection_source, COUNT(claim_id) AS claims, SUM(amount_paid_f) AS dollars_paid
      FROM __claims GROUP BY 1 ORDER BY 2 DESC
  - name: largest_rings
    question: Which fraud rings span the most states?
    verified_by: DOL Fraud Demo build
    verified_at: 1791936000
    sql: >-
      SELECT link_type, link_label, ring_states, ring_claims_f AS claims, ring_paid_f AS dollars_paid
      FROM __rings ORDER BY ring_state_count_f DESC, ring_claims_f DESC LIMIT 10
$$);


CALL SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML('DOL_FRAUD_DEMO.ANALYTICS', $$
name: SV_EMPLOYER_RISK
description: >-
  Employer Risk 360. Employers resolved across WHD enforcement, OSHA inspections and ITA
  injury filings, OFLC H-2A/H-2B certifications and Form 5500 (public data), plus fictional
  employers (synthetic) including Employer #1000001. Employers are shown by display id only.
  Scores and reasons are risk indicators for prioritization, not findings of violation or fraud.
tables:
  - name: EMPLOYERS
    description: (public plus synthetic) One row per resolved employer with WHD, OSHA/ITA and OFLC signals and a composite risk score.
    base_table: {database: DOL_FRAUD_DEMO, schema: ANALYTICS, table: EMPLOYER_RISK_360}
    primary_key: {columns: [EMPLOYER_ID]}
    dimensions:
      - name: EMPLOYER_ID
        expr: EMPLOYER_ID
        data_type: VARCHAR
        description: Internal resolved employer key.
      - name: DISPLAY_ID
        expr: DISPLAY_ID
        data_type: VARCHAR
        description: Pseudonymous employer id shown to users, for example Employer #1000001.
        synonyms: [employer, company]
      - name: EMP_STATE_CODE
        expr: STATE_CODE
        data_type: VARCHAR
        description: Employer state.
        synonyms: [state]
      - name: NAICS4
        expr: NAICS4
        data_type: VARCHAR
        description: Four-digit NAICS industry code. 5613 is employment services (staffing).
        synonyms: [industry]
      - name: AGENCIES
        expr: ARRAY_TO_STRING(AGENCY_LIST, ', ')
        data_type: VARCHAR
        description: DOL agencies with a risk signal for the employer (WHD, OSHA, OFLC).
      - name: RISK_REASONS
        expr: ARRAY_TO_STRING(TOP_REASONS, '; ')
        data_type: VARCHAR
        description: Plain-language reasons behind the risk score.
      - name: DATA_ORIGIN
        expr: DATA_ORIGIN
        data_type: VARCHAR
        description: PUBLIC for real DOL data, SYNTHETIC for fictional employers.
        is_enum: true
        sample_values: [PUBLIC, SYNTHETIC]
      - name: IS_REPEAT_WHD
        expr: P1_REPEAT_VIOLATOR
        data_type: BOOLEAN
        description: (public) WHD repeat violator signal.
      - name: IS_H2A_WITH_WHD_FINDINGS
        expr: P3_H2A_EMPLOYER_WITH_H2A_VIOLATION
        data_type: BOOLEAN
        description: (public) H-2A employer with WHD H-2A findings.
      - name: IS_WAGE_BELOW_BENCHMARK
        expr: P4_WAGE_BELOW_BENCHMARK
        data_type: BOOLEAN
        description: (public) OFLC offered wage below 60 percent of the QCEW industry wage.
      - name: IS_OSHA_WILLFUL_REPEAT
        expr: P5_WILLFUL_REPEAT_FTA
        data_type: BOOLEAN
        description: (public) OSHA willful, repeat or failure-to-abate citations.
      - name: IS_POSSIBLE_UNDERREPORTING
        expr: P7_POSSIBLE_UNDERREPORTING
        data_type: BOOLEAN
        description: (public) ITA injury rate far below industry peers while OSHA cited serious hazards.
    facts:
      - name: RISK_SCORE_F
        expr: RISK_SCORE
        data_type: NUMBER
        description: Composite risk score 0-100.
      - name: AGENCIES_FLAGGED_F
        expr: AGENCIES_FLAGGED
        data_type: NUMBER
        description: Number of DOL agencies with a risk signal (0-3).
      - name: BACK_WAGES_F
        expr: BACK_WAGES
        data_type: NUMBER
        description: (public) WHD back wages computed, dollars.
      - name: EMPLOYEES_OWED_F
        expr: EMPLOYEES_OWED
        data_type: NUMBER
        description: (public) Employees owed back wages.
      - name: OSHA_PENALTY_F
        expr: CURRENT_PENALTY
        data_type: NUMBER
        description: (public) Current OSHA penalties, dollars.
      - name: SERIOUS_CITATIONS_F
        expr: SERIOUS
        data_type: NUMBER
        description: (public) OSHA serious citations.
      - name: OFLC_WORKERS_F
        expr: WORKERS_CERTIFIED
        data_type: NUMBER
        description: (public) H-2A/H-2B workers certified.
    metrics:
      - name: EMPLOYER_COUNT
        expr: COUNT(RISK_SCORE_F)
        description: Number of employers.
      - name: CROSS_AGENCY_EMPLOYERS
        expr: COUNT_IF(AGENCIES_FLAGGED_F >= 2)
        description: Employers with risk signals from two or more DOL agencies.
      - name: TOTAL_BACK_WAGES
        expr: SUM(BACK_WAGES_F)
        description: (public) Total WHD back wages, dollars.
      - name: TOTAL_OSHA_PENALTIES
        expr: SUM(OSHA_PENALTY_F)
        description: (public) Total current OSHA penalties, dollars.
      - name: AVG_RISK_SCORE
        expr: AVG(RISK_SCORE_F)
        description: Average composite risk score.
  - name: CASE_BRIEFS
    description: AI-generated investigator briefs (Cortex AI_COMPLETE) for the 50 highest-risk employers.
    base_table: {database: DOL_FRAUD_DEMO, schema: AI, table: EMPLOYER_CASE_BRIEF}
    primary_key: {columns: [EMPLOYER_ID]}
    dimensions:
      - name: BRIEF_EMPLOYER_ID
        expr: EMPLOYER_ID
        data_type: VARCHAR
        description: Employer key.
      - name: BRIEF
        expr: BRIEF
        data_type: VARCHAR
        description: Investigator brief text.
  - name: COMPLAINTS
    description: (synthetic) Worker complaints about fictional employers, translated and routed with Cortex AI.
    base_table: {database: DOL_FRAUD_DEMO, schema: AI, table: COMPLAINT_ENRICHED}
    primary_key: {columns: [COMPLAINT_ID]}
    dimensions:
      - name: COMPLAINT_ID
        expr: COMPLAINT_ID
        data_type: VARCHAR
        description: (synthetic) Complaint id.
      - name: COMPLAINT_EMPLOYER_ID
        expr: EMPLOYER_ID
        data_type: VARCHAR
        description: (synthetic) Employer key.
      - name: ROUTE_TO_AGENCY
        expr: ROUTE_TO_AGENCY
        data_type: VARCHAR
        description: (synthetic) AI-recommended first responder.
        is_enum: true
        sample_values: [WHD, OSHA, State UI agency]
      - name: COMPLAINT_LANGUAGE
        expr: LANGUAGE
        data_type: VARCHAR
        description: (synthetic) Original language, EN or ES.
      - name: ISSUE_TYPES
        expr: ARRAY_TO_STRING(ISSUE_TYPES, ', ')
        data_type: VARCHAR
        description: (synthetic) AI-classified issues raised.
    time_dimensions:
      - name: COMPLAINT_DATE
        expr: RECEIVED_DATE
        data_type: DATE
        description: (synthetic) Date received.
    facts:
      - name: COMPLAINT_ROW
        expr: 1
        data_type: NUMBER
        description: (synthetic) One per complaint.
    metrics:
      - name: COMPLAINT_COUNT
        expr: SUM(COMPLAINT_ROW)
        description: (synthetic) Number of complaints.
  - name: OSHA_NARRATIVES
    description: (public) OSHA accident abstracts for employers with risk signals, with AI event type and extracted facts.
    base_table: {database: DOL_FRAUD_DEMO, schema: AI, table: OSHA_NARRATIVE_ENRICHED}
    primary_key: {columns: [SUMMARY_NR]}
    dimensions:
      - name: SUMMARY_NR
        expr: TO_VARCHAR(SUMMARY_NR)
        data_type: VARCHAR
        description: (public) OSHA accident summary number.
      - name: NARRATIVE_EMPLOYER_ID
        expr: EMPLOYER_ID
        data_type: VARCHAR
        description: Employer key.
      - name: EVENT_TYPE
        expr: EVENT_TYPE
        data_type: VARCHAR
        description: (public) AI-classified accident type.
        is_enum: true
        sample_values: [Caught in or between, Fall, Struck by, Heat or chemical exposure, Electrical, Other]
      - name: TEMP_OR_CONTRACT_WORKER
        expr: INVOLVES_TEMP_OR_CONTRACT_WORKER
        data_type: VARCHAR
        description: (public) Whether the abstract says a temporary, staffing or contract worker was injured.
    time_dimensions:
      - name: ACCIDENT_DATE
        expr: EVENT_DATE
        data_type: DATE
        description: (public) Accident date.
    facts:
      - name: ACCIDENT_ROW
        expr: 1
        data_type: NUMBER
        description: (public) One per accident.
    metrics:
      - name: ACCIDENT_COUNT
        expr: SUM(ACCIDENT_ROW)
        description: (public) Number of accidents.
relationships:
  - name: BRIEFS_TO_EMPLOYERS
    left_table: CASE_BRIEFS
    right_table: EMPLOYERS
    relationship_columns: [{left_column: BRIEF_EMPLOYER_ID, right_column: EMPLOYER_ID}]
    join_type: inner
    relationship_type: one_to_one
  - name: COMPLAINTS_TO_EMPLOYERS
    left_table: COMPLAINTS
    right_table: EMPLOYERS
    relationship_columns: [{left_column: COMPLAINT_EMPLOYER_ID, right_column: EMPLOYER_ID}]
    join_type: inner
    relationship_type: many_to_one
  - name: NARRATIVES_TO_EMPLOYERS
    left_table: OSHA_NARRATIVES
    right_table: EMPLOYERS
    relationship_columns: [{left_column: NARRATIVE_EMPLOYER_ID, right_column: EMPLOYER_ID}]
    join_type: inner
    relationship_type: many_to_one
verified_queries:
  - name: cross_agency_employers
    question: Which employers have risk signals from all three DOL agencies?
    use_as_onboarding_question: true
    verified_by: DOL Fraud Demo build
    verified_at: 1791936000
    sql: >-
      SELECT display_id, emp_state_code, naics4, risk_score_f AS risk_score, agencies, risk_reasons
      FROM __employers WHERE agencies_flagged_f = 3 ORDER BY risk_score_f DESC
  - name: top_staffing_risk
    question: What are the highest-risk staffing employers in Texas?
    use_as_onboarding_question: true
    verified_by: DOL Fraud Demo build
    verified_at: 1791936000
    sql: >-
      SELECT display_id, risk_score_f AS risk_score, agencies, risk_reasons
      FROM __employers WHERE emp_state_code = 'TX' AND naics4 = '5613'
      ORDER BY risk_score_f DESC LIMIT 10
  - name: complaints_by_route
    question: How many worker complaints were routed to each agency?
    verified_by: DOL Fraud Demo build
    verified_at: 1791936000
    sql: >-
      SELECT route_to_agency, COUNT(complaint_id) AS complaints
      FROM __complaints GROUP BY 1 ORDER BY 2 DESC
$$);


-- Checks: query the semantic views directly
SELECT * FROM SEMANTIC_VIEW(
  DOL_FRAUD_DEMO.ANALYTICS.SV_UI_INTEGRITY
  DIMENSIONS CLAIMS.DETECTION_SOURCE
  METRICS CLAIMS.CLAIM_COUNT, CLAIMS.DOLLARS_AT_RISK)
ORDER BY CLAIM_COUNT DESC;

SELECT * FROM SEMANTIC_VIEW(
  DOL_FRAUD_DEMO.ANALYTICS.SV_EMPLOYER_RISK
  DIMENSIONS EMPLOYERS.DATA_ORIGIN
  METRICS EMPLOYERS.EMPLOYER_COUNT, EMPLOYERS.CROSS_AGENCY_EMPLOYERS)
ORDER BY 1;
