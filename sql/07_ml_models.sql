-- =============================================================================
-- DOL Fraud Detection Demo - 07 ML models (Snowflake Cortex ML, SQL-native)
--   1. ANOMALY_DETECTION on real ETA 539 weekly initial claims by state
--      (trained on 2015-2019, detects from 2020 on: the pandemic surge)
--   2. FORECAST of real ETA 227 fraud overpayment dollars, demo states
--   3. Claim fraud classifier (gradient-boosted trees, Snowpark Python in the
--      warehouse) on the seeded labels, with holdout metrics and feature
--      importance; scores are stored separately from the rule flags (06)
-- =============================================================================

USE ROLE DOL_FRAUD_DEMO_ROLE;
USE WAREHOUSE DOL_FRAUD_WH;
USE SCHEMA DOL_FRAUD_DEMO.ML;

GRANT CREATE SNOWFLAKE.ML.ANOMALY_DETECTION ON SCHEMA DOL_FRAUD_DEMO.ML TO ROLE DOL_FRAUD_DEMO_ROLE;
GRANT CREATE SNOWFLAKE.ML.FORECAST ON SCHEMA DOL_FRAUD_DEMO.ML TO ROLE DOL_FRAUD_DEMO_ROLE;

-- -----------------------------------------------------------------------------
-- 1. State claims anomaly detection (public)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_539_TRAIN COMMENT = 'Public: ETA 539 weekly initial claims 2015-2019 (training baseline)' AS
SELECT STATE_CODE, WEEK_ENDING::TIMESTAMP_NTZ AS TS, INITIAL_CLAIMS::FLOAT AS INITIAL_CLAIMS
FROM DOL_FRAUD_DEMO.CURATED.ETA_539_WEEKLY_CLAIMS
WHERE WEEK_ENDING BETWEEN '2015-01-01' AND '2019-12-31' AND INITIAL_CLAIMS IS NOT NULL
  AND STATE_CODE IN (SELECT STATE_CODE FROM DOL_FRAUD_DEMO.CURATED.STATE_REF);

CREATE OR REPLACE VIEW V_539_DETECT COMMENT = 'Public: ETA 539 weekly initial claims 2020 to latest (scored)' AS
SELECT STATE_CODE, WEEK_ENDING::TIMESTAMP_NTZ AS TS, INITIAL_CLAIMS::FLOAT AS INITIAL_CLAIMS
FROM DOL_FRAUD_DEMO.CURATED.ETA_539_WEEKLY_CLAIMS
WHERE WEEK_ENDING >= '2020-01-01' AND INITIAL_CLAIMS IS NOT NULL
  AND STATE_CODE IN (SELECT STATE_CODE FROM DOL_FRAUD_DEMO.CURATED.STATE_REF);

CREATE OR REPLACE SNOWFLAKE.ML.ANOMALY_DETECTION CLAIMS_ANOMALY_MODEL(
  INPUT_DATA => TABLE(V_539_TRAIN),
  SERIES_COLNAME => 'STATE_CODE',
  TIMESTAMP_COLNAME => 'TS',
  TARGET_COLNAME => 'INITIAL_CLAIMS',
  LABEL_COLNAME => '');

CREATE OR REPLACE TABLE CLAIMS_ANOMALIES (
  STATE_CODE VARCHAR(2), WEEK_ENDING DATE, INITIAL_CLAIMS NUMBER, FORECAST NUMBER,
  LOWER_BOUND NUMBER, UPPER_BOUND NUMBER, IS_ANOMALY BOOLEAN, PERCENTILE FLOAT, DISTANCE FLOAT,
  DATA_ORIGIN VARCHAR
) COMMENT = 'Public: Cortex ANOMALY_DETECTION results on ETA 539 weekly initial claims by state';

EXECUTE IMMEDIATE $$
BEGIN
  CALL CLAIMS_ANOMALY_MODEL!DETECT_ANOMALIES(
    INPUT_DATA => TABLE(V_539_DETECT),
    SERIES_COLNAME => 'STATE_CODE',
    TIMESTAMP_COLNAME => 'TS',
    TARGET_COLNAME => 'INITIAL_CLAIMS',
    CONFIG_OBJECT => {'prediction_interval': 0.99});
  LET qid VARCHAR := SQLID;
  INSERT INTO CLAIMS_ANOMALIES
  SELECT SERIES::STRING, TS::DATE, Y, FORECAST, LOWER_BOUND, UPPER_BOUND, IS_ANOMALY, PERCENTILE, DISTANCE, 'PUBLIC'
  FROM TABLE(RESULT_SCAN(:qid));
END;
$$;

-- Surge alerts: only weeks ABOVE the expected range. Low-side anomalies (claims
-- under a 2015-2019 trend that extrapolates high) are not integrity signals.
CREATE OR REPLACE VIEW V_CLAIMS_SURGE_ALERTS COMMENT = 'Public: ETA 539 weeks where initial claims exceeded the anomaly model upper bound, with surge multiple' AS
SELECT STATE_CODE, WEEK_ENDING, INITIAL_CLAIMS, FORECAST, UPPER_BOUND,
       ROUND(DIV0NULL(INITIAL_CLAIMS, FORECAST), 1) AS SURGE_MULTIPLE,
       CASE WHEN DIV0NULL(INITIAL_CLAIMS, FORECAST) >= 3 THEN 'SEVERE'
            WHEN DIV0NULL(INITIAL_CLAIMS, FORECAST) >= 1.5 THEN 'HIGH'
            ELSE 'ELEVATED' END AS SEVERITY,
       DATA_ORIGIN
FROM CLAIMS_ANOMALIES
WHERE IS_ANOMALY AND INITIAL_CLAIMS > UPPER_BOUND;

-- -----------------------------------------------------------------------------
-- 2. Fraud overpayment forecast (public, ETA 227)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_227_FRAUD_SERIES COMMENT = 'Public: ETA 227 quarterly fraud overpayment dollars, demo states, 2015+' AS
SELECT STATE_CODE, QUARTER_ENDING::TIMESTAMP_NTZ AS TS, COALESCE(FRAUD_DOLLARS, 0)::FLOAT AS FRAUD_DOLLARS
FROM DOL_FRAUD_DEMO.CURATED.ETA_227_OVERPAYMENTS
WHERE QUARTER_ENDING >= '2015-01-01'
  AND STATE_CODE IN (SELECT STATE_CODE FROM DOL_FRAUD_DEMO.RAW_SYNTH.DEMO_STATE);

CREATE OR REPLACE SNOWFLAKE.ML.FORECAST FRAUD_OP_FORECAST_MODEL(
  INPUT_DATA => TABLE(V_227_FRAUD_SERIES),
  SERIES_COLNAME => 'STATE_CODE',
  TIMESTAMP_COLNAME => 'TS',
  TARGET_COLNAME => 'FRAUD_DOLLARS');

CREATE OR REPLACE TABLE FRAUD_OP_FORECAST (
  STATE_CODE VARCHAR(2), QUARTER_ENDING DATE, FORECAST NUMBER, LOWER_BOUND NUMBER, UPPER_BOUND NUMBER,
  DATA_ORIGIN VARCHAR
) COMMENT = 'Public: Cortex FORECAST of ETA 227 fraud overpayment dollars, next 4 quarters';

EXECUTE IMMEDIATE $$
BEGIN
  CALL FRAUD_OP_FORECAST_MODEL!FORECAST(FORECASTING_PERIODS => 4, CONFIG_OBJECT => {'prediction_interval': 0.9});
  LET qid VARCHAR := SQLID;
  INSERT INTO FRAUD_OP_FORECAST
  SELECT SERIES::STRING, TS::DATE, GREATEST(FORECAST, 0), GREATEST(LOWER_BOUND, 0), UPPER_BOUND, 'PUBLIC'
  FROM TABLE(RESULT_SCAN(:qid));
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Claim fraud classifier (synthetic, seeded labels)
-- -----------------------------------------------------------------------------
-- Deterministic 70/30 split on claim id
CREATE OR REPLACE VIEW V_CLAIM_MODEL_INPUT COMMENT = 'Synthetic data. Claim features used by the fraud classifier (no ids or labels besides the target).' AS
SELECT CLAIM_ID,
       MOD(ABS(HASH(CLAIM_ID, 'split')), 10) < 7 AS IS_TRAIN,
       STATE_CODE, FILING_CHANNEL, WEEKLY_BENEFIT_AMT, WBA_PCT_OF_MAX,
       BANK_ACCOUNT_CLAIM_COUNT, DEVICE_CLAIM_COUNT, DEVICE_STATE_COUNT, IP_CLAIM_COUNT,
       SSN_STATE_COUNT, NEW_HIRE_MATCHES, WAGE_QTRS_DURING_CLAIM, BASE_PERIOD_WAGE_QTRS, ROUND_WAGE_QTRS,
       ACCOUNT_AGE_HOURS, IDENTITY_VERIFIED, PHONE_IS_VOIP, ADDRESS_IS_CMRA, EMAIL_UNCOMMON_DOMAIN,
       CLAIMANT_AGE, EMPLOYER_HAS_PUBLIC_FOOTPRINT, EMPLOYER_AGE_AT_SEPARATION_DAYS,
       EMPLOYER_MAX_MONTHLY_SEPARATIONS,
       IS_FRAUD
FROM DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_FEATURES;

-- Training runs in-warehouse as a Snowpark Python procedure (gradient-boosted
-- trees, scikit-learn). Note: SNOWFLAKE.ML.CLASSIFICATION returned "must have
-- an active version defined" on this account (2026-10-13, even for a toy
-- table as ACCOUNTADMIN); the procedure writes the same outputs the app reads.
CREATE OR REPLACE PROCEDURE SP_TRAIN_CLAIM_CLASSIFIER()
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.11'
  PACKAGES = ('snowflake-snowpark-python', 'scikit-learn', 'pandas', 'numpy')
  HANDLER = 'run'
  COMMENT = 'Trains the claim fraud classifier on V_CLAIM_MODEL_INPUT and writes scores, holdout metrics and feature importance'
  EXECUTE AS CALLER
AS
$$
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import roc_auc_score, precision_score, recall_score, f1_score, average_precision_score

def run(session):
    df = session.table("DOL_FRAUD_DEMO.ML.V_CLAIM_MODEL_INPUT").to_pandas()
    y = df["IS_FRAUD"].astype(bool).astype(int).values
    X = df.drop(columns=["CLAIM_ID", "IS_TRAIN", "IS_FRAUD"])
    cat_cols = [c for c in X.columns if X[c].dtype == object or X[c].dtype == bool]
    for c in X.columns:
        if c in cat_cols:
            X[c] = X[c].astype(str).astype("category")
        else:
            X[c] = pd.to_numeric(X[c], errors="coerce").astype(float)
    train = df["IS_TRAIN"].astype(bool).values
    model = HistGradientBoostingClassifier(
        max_iter=300, learning_rate=0.08, max_leaf_nodes=31, l2_regularization=1.0,
        categorical_features="from_dtype", random_state=42)
    model.fit(X[train], y[train])

    proba = model.predict_proba(X)[:, 1]
    test = ~train
    pred = (proba >= 0.5).astype(int)
    metrics = [
        ("EVAL", "auc", float(roc_auc_score(y[test], proba[test]))),
        ("EVAL", "average_precision", float(average_precision_score(y[test], proba[test]))),
        ("EVAL", "precision", float(precision_score(y[test], pred[test]))),
        ("EVAL", "recall", float(recall_score(y[test], pred[test]))),
        ("EVAL", "f1", float(f1_score(y[test], pred[test]))),
        ("EVAL", "support_fraud", float(y[test].sum())),
        ("EVAL", "support_total", float(test.sum())),
    ]

    rng = np.random.RandomState(7)
    idx = np.where(test)[0]
    idx = rng.choice(idx, size=min(6000, len(idx)), replace=False)
    pi = permutation_importance(model, X.iloc[idx], y[idx], scoring="average_precision",
                                n_repeats=3, random_state=7)
    imp = pd.DataFrame({"FEATURE": X.columns, "SCORE": np.clip(pi.importances_mean, 0, None)})
    imp["SCORE"] = imp["SCORE"] / max(imp["SCORE"].sum(), 1e-9)
    imp = imp.sort_values("SCORE", ascending=False).reset_index(drop=True)
    imp.insert(0, "RANK", imp.index + 1)
    imp["FEATURE_TYPE"] = "user_provided"

    scores = pd.DataFrame({
        "CLAIM_ID": df["CLAIM_ID"], "IS_TRAIN": train,
        "ML_FRAUD_PROBABILITY": proba, "ML_PREDICTED_FRAUD": proba >= 0.5})
    session.sql("TRUNCATE TABLE DOL_FRAUD_DEMO.ML.CLAIM_ML_SCORES").collect()
    session.write_pandas(scores, "CLAIM_ML_SCORES_STAGE", database="DOL_FRAUD_DEMO", schema="ML",
                         auto_create_table=True, overwrite=True, table_type="temporary")
    session.sql("""INSERT INTO DOL_FRAUD_DEMO.ML.CLAIM_ML_SCORES
                   SELECT CLAIM_ID, IS_TRAIN, ML_FRAUD_PROBABILITY, ML_PREDICTED_FRAUD, CURRENT_TIMESTAMP(), 'SYNTHETIC'
                   FROM DOL_FRAUD_DEMO.ML.CLAIM_ML_SCORES_STAGE""").collect()
    session.write_pandas(pd.DataFrame(metrics, columns=["DATASET_TYPE", "ERROR_METRIC", "METRIC_VALUE"]),
                         "CLAIM_MODEL_METRICS", database="DOL_FRAUD_DEMO", schema="ML",
                         auto_create_table=True, overwrite=True)
    session.write_pandas(imp, "CLAIM_MODEL_FEATURE_IMPORTANCE", database="DOL_FRAUD_DEMO", schema="ML",
                         auto_create_table=True, overwrite=True)
    return {"rows_scored": int(len(scores)), "test_auc": metrics[0][2], "test_recall": metrics[3][2],
            "test_precision": metrics[2][2]}
$$;

CREATE OR REPLACE TABLE CLAIM_ML_SCORES (
  CLAIM_ID VARCHAR, IS_TRAIN BOOLEAN, ML_FRAUD_PROBABILITY FLOAT, ML_PREDICTED_FRAUD BOOLEAN,
  SCORED_AT TIMESTAMP_LTZ, DATA_ORIGIN VARCHAR
) COMMENT = 'Synthetic data. ML fraud probability per current claim (gradient-boosted classifier). Risk indicators, not findings.';

CALL SP_TRAIN_CLAIM_CLASSIFIER();

-- -----------------------------------------------------------------------------
-- 4. Combined triage queue: rules (06) and ML side by side
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK
  COMMENT = 'Synthetic data. Claim triage queue: rule flags, ML probability and combined priority. Risk indicators, not findings of fraud.' AS
SELECT r.CLAIM_ID, r.CLAIMANT_ID, r.STATE_CODE, r.LAST_EMPLOYER_ID, m.DISPLAY_ID AS LAST_EMPLOYER_DISPLAY_ID,
       r.FILED_TS, r.AMOUNT_PAID,
       r.R1_SHARED_BANK_ACCOUNT, r.R2_DEVICE_OR_IP_FARM, r.R3_MULTI_STATE_SSN,
       r.R4_WORKING_WHILE_CLAIMING, r.R5_FICTITIOUS_EMPLOYER, r.R6_SYNTHETIC_IDENTITY,
       IFF(r.R1_SHARED_BANK_ACCOUNT, 1, 0) + IFF(r.R2_DEVICE_OR_IP_FARM, 1, 0) + IFF(r.R3_MULTI_STATE_SSN, 1, 0)
         + IFF(r.R4_WORKING_WHILE_CLAIMING, 1, 0) + IFF(r.R5_FICTITIOUS_EMPLOYER, 1, 0) + IFF(r.R6_SYNTHETIC_IDENTITY, 1, 0) AS RULES_HIT,
       r.RULE_REASONS,
       s.ML_FRAUD_PROBABILITY,
       ROUND(LEAST(100, 100 * GREATEST(COALESCE(s.ML_FRAUD_PROBABILITY, 0),
             IFF(IFF(r.R1_SHARED_BANK_ACCOUNT OR r.R2_DEVICE_OR_IP_FARM OR r.R3_MULTI_STATE_SSN
                     OR r.R4_WORKING_WHILE_CLAIMING OR r.R5_FICTITIOUS_EMPLOYER OR r.R6_SYNTHETIC_IDENTITY, 1, 0) = 1, 0.85, 0)))) AS PRIORITY_SCORE,
       CASE WHEN s.ML_FRAUD_PROBABILITY >= 0.5 AND NOT (r.R1_SHARED_BANK_ACCOUNT OR r.R2_DEVICE_OR_IP_FARM OR r.R3_MULTI_STATE_SSN
                     OR r.R4_WORKING_WHILE_CLAIMING OR r.R5_FICTITIOUS_EMPLOYER OR r.R6_SYNTHETIC_IDENTITY) THEN 'ML_ONLY'
            WHEN s.ML_FRAUD_PROBABILITY >= 0.5 THEN 'RULES_AND_ML'
            WHEN (r.R1_SHARED_BANK_ACCOUNT OR r.R2_DEVICE_OR_IP_FARM OR r.R3_MULTI_STATE_SSN
                  OR r.R4_WORKING_WHILE_CLAIMING OR r.R5_FICTITIOUS_EMPLOYER OR r.R6_SYNTHETIC_IDENTITY) THEN 'RULES_ONLY'
            ELSE 'NONE' END AS DETECTION_SOURCE,
       'SYNTHETIC' AS DATA_ORIGIN
FROM DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_RULE_FLAGS r
LEFT JOIN DOL_FRAUD_DEMO.ML.CLAIM_ML_SCORES s ON s.CLAIM_ID = r.CLAIM_ID
LEFT JOIN DOL_FRAUD_DEMO.CURATED.EMPLOYER_MASTER m ON m.EMPLOYER_ID = r.LAST_EMPLOYER_ID;

-- -----------------------------------------------------------------------------
-- 5. Checks
-- -----------------------------------------------------------------------------
-- Anomalies by state, 2020 surge
SELECT YEAR(WEEK_ENDING) AS yr, SEVERITY, COUNT(*) AS surge_weeks, COUNT(DISTINCT STATE_CODE) AS states
FROM V_CLAIMS_SURGE_ALERTS GROUP BY 1, 2 ORDER BY 1, 2;

-- Holdout performance (test split only) and lift over rules
SELECT DETECTION_SOURCE, COUNT(*) AS claims, COUNT_IF(f.IS_FRAUD) AS seeded_fraud
FROM DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK v
JOIN DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_FEATURES f USING (CLAIM_ID)
JOIN CLAIM_ML_SCORES s USING (CLAIM_ID)
WHERE NOT s.IS_TRAIN
GROUP BY 1 ORDER BY 1;

SELECT * FROM CLAIM_MODEL_METRICS;
SELECT * FROM CLAIM_MODEL_FEATURE_IMPORTANCE ORDER BY "RANK" LIMIT 10;
