-- =============================================================================
-- DOL Fraud Detection Demo - 14 Credit tracker
-- Views behind the Streamlit credit tracker (streamlit/credit_tracker). They
-- report the credits used by the two demo front ends:
--   APP    = the React app DOL_FRAUD_DEMO.APP.DOL_FRAUD_PREVENTION_APP
--   AGENT  = the CoWork agent DOL_FRAUD_DEMO.ANALYTICS.DOL_FRAUD_AGENT
--   SHARED = services both of them use
--
-- Sources (SNOWFLAKE.ACCOUNT_USAGE, latency up to ~3 hours):
--   AGENT  LLM tokens via CoWork     SNOWFLAKE_COWORK_USAGE_HISTORY        exact
--   AGENT  LLM tokens via API/SQL    CORTEX_AGENT_USAGE_HISTORY            exact
--   AGENT  Tool SQL on DOL_FRAUD_WH  QUERY_ATTRIBUTION_HISTORY, query_tag  exact
--   SHARED Cortex Search serving     CORTEX_SEARCH_DAILY_USAGE_HISTORY     exact
--          (standing daily charge for the 3 services both the app and agent query)
--   APP    Query compute             QUERY_ATTRIBUTION_HISTORY, app's
--                                    SNOWFLAKE_SERVICE user on DOL_FRAUD_WH exact
--   APP    Hosting                   SNOWFLAKE_APP_RUNTIME_COMPUTE_HISTORY ESTIMATE
--
-- Why hosting is an estimate: all App Runtime apps in an account share one
-- Snowflake-managed pool and Snowflake does not report per-app credits. This
-- file splits each hour equally across the running apps counted in
-- TRACKER_CONFIG. Rerun section 2 whenever apps are added or dropped.
--
-- Not included: idle warehouse time and cloud services that are not attributed
-- to a query. QUERY_ATTRIBUTION_HISTORY excludes both, so warehouse totals in
-- WAREHOUSE_METERING_HISTORY will be higher (shown in the app for context).
--
-- Run after 13_app_support.sql (and 10_agent.sql). Needs ACCOUNTADMIN for the
-- grants in section 1.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Grants: usage views for the demo role, PyPI access for the Streamlit app
-- -----------------------------------------------------------------------------
USE ROLE ACCOUNTADMIN;

GRANT DATABASE ROLE SNOWFLAKE.USAGE_VIEWER      TO ROLE DOL_FRAUD_DEMO_ROLE;
GRANT DATABASE ROLE SNOWFLAKE.GOVERNANCE_VIEWER TO ROLE DOL_FRAUD_DEMO_ROLE;
GRANT DATABASE ROLE SNOWFLAKE.SECURITY_VIEWER   TO ROLE DOL_FRAUD_DEMO_ROLE;

-- Streamlit container runtime resolves pyproject.toml from PyPI. Uses the
-- Snowflake-managed PyPI network rule; skip if your account already has one.
CREATE EXTERNAL ACCESS INTEGRATION IF NOT EXISTS PYPI_ACCESS_INTEGRATION
  ALLOWED_NETWORK_RULES = (SNOWFLAKE.EXTERNAL_ACCESS.PYPI_RULE)
  ENABLED = TRUE;
GRANT USAGE ON INTEGRATION PYPI_ACCESS_INTEGRATION TO ROLE DOL_FRAUD_DEMO_ROLE;

USE ROLE DOL_FRAUD_DEMO_ROLE;
USE WAREHOUSE DOL_FRAUD_WH;
CREATE SCHEMA IF NOT EXISTS DOL_FRAUD_DEMO.COST
  COMMENT = 'Credit usage of the demo app and agent, and the Streamlit tracker';
USE SCHEMA DOL_FRAUD_DEMO.COST;

-- -----------------------------------------------------------------------------
-- 2. Config: objects to track and the App Runtime share basis
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TABLE TRACKER_CONFIG (
  KEY         VARCHAR,
  VALUE       VARCHAR,
  DESCRIPTION VARCHAR
) COMMENT = 'Settings for the credit tracker views. Edit VALUE to retarget.';

INSERT INTO TRACKER_CONFIG VALUES
  ('WAREHOUSE',     'DOL_FRAUD_WH',             'Warehouse the app and agent tools query'),
  ('DATABASE',      'DOL_FRAUD_DEMO',           'Database holding the app, agent and search services'),
  ('AGENT_NAME',    'DOL_FRAUD_AGENT',          'Cortex Agent used in CoWork'),
  ('APP_NAME',      'DOL_FRAUD_PREVENTION_APP', 'Snowflake App Runtime application service'),
  ('APP_COUNT',     '1',                        'Running App Runtime apps sharing the pool (set below)'),
  ('APP_CREATED',   NULL,                       'App creation time; hosting share starts here (set below)');

-- Count every application service in the account. Needs a role that can see
-- them all, so this runs as ACCOUNTADMIN and writes through a session variable.
USE ROLE ACCOUNTADMIN;
SHOW APPLICATION SERVICES IN ACCOUNT;
SET APP_COUNT = (SELECT COUNT(*) FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())) WHERE "status" = 'RUNNING');
SHOW APPLICATION SERVICES LIKE 'DOL_FRAUD_PREVENTION_APP' IN SCHEMA DOL_FRAUD_DEMO.APP;
SET APP_CREATED = (SELECT "created_on"::VARCHAR FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())));
USE ROLE DOL_FRAUD_DEMO_ROLE;

UPDATE TRACKER_CONFIG SET VALUE = GREATEST($APP_COUNT, 1)::VARCHAR WHERE KEY = 'APP_COUNT';
UPDATE TRACKER_CONFIG SET VALUE = $APP_CREATED                   WHERE KEY = 'APP_CREATED';

CREATE OR REPLACE VIEW V_CONFIG AS
SELECT
  MAX(IFF(KEY = 'WAREHOUSE',   VALUE, NULL))                      AS WAREHOUSE_NAME,
  MAX(IFF(KEY = 'DATABASE',    VALUE, NULL))                      AS DATABASE_NAME,
  MAX(IFF(KEY = 'AGENT_NAME',  VALUE, NULL))                      AS AGENT_NAME,
  MAX(IFF(KEY = 'APP_NAME',    VALUE, NULL))                      AS APP_NAME,
  MAX(IFF(KEY = 'APP_COUNT',   VALUE, NULL))::NUMBER              AS APP_COUNT,
  MAX(IFF(KEY = 'APP_CREATED', VALUE, NULL))::TIMESTAMP_LTZ       AS APP_CREATED
FROM TRACKER_CONFIG;

-- -----------------------------------------------------------------------------
-- 3. Hourly credits, one row per hour x component x category
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_HOURLY_CREDITS
  COMMENT = 'Hourly credits for the demo app and CoWork agent. IS_ESTIMATE = TRUE for App Runtime hosting.'
AS
WITH cfg AS (SELECT * FROM V_CONFIG),
svc_users AS (
  SELECT NAME FROM SNOWFLAKE.ACCOUNT_USAGE.USERS WHERE TYPE = 'SNOWFLAKE_SERVICE'
),
wh_queries AS (
  SELECT q.START_TIME, q.USER_NAME, q.QUERY_TAG,
         q.CREDITS_ATTRIBUTED_COMPUTE + COALESCE(q.CREDITS_USED_QUERY_ACCELERATION, 0) AS CREDITS
  FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_ATTRIBUTION_HISTORY q, cfg
  WHERE q.WAREHOUSE_NAME = cfg.WAREHOUSE_NAME
)
-- AGENT: LLM tokens for chats in CoWork
SELECT DATE_TRUNC('hour', h.START_TIME) AS USAGE_HOUR, 'AGENT' AS COMPONENT,
       'LLM tokens (CoWork)' AS CATEGORY, SUM(h.TOKEN_CREDITS) AS CREDITS,
       SUM(h.TOKENS) AS TOKENS, COUNT(DISTINCT h.REQUEST_ID) AS REQUESTS, FALSE AS IS_ESTIMATE
FROM SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_COWORK_USAGE_HISTORY h, cfg
WHERE h.AGENT_NAME = cfg.AGENT_NAME AND h.AGENT_DATABASE_NAME = cfg.DATABASE_NAME
GROUP BY ALL
UNION ALL
-- AGENT: LLM tokens for direct calls (REST API, DATA_AGENT_RUN)
SELECT DATE_TRUNC('hour', h.START_TIME), 'AGENT', 'LLM tokens (API)', SUM(h.TOKEN_CREDITS),
       SUM(h.TOKENS), COUNT(DISTINCT h.REQUEST_ID), FALSE
FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AGENT_USAGE_HISTORY h, cfg
WHERE h.AGENT_NAME = cfg.AGENT_NAME AND h.AGENT_DATABASE_NAME = cfg.DATABASE_NAME
GROUP BY ALL
UNION ALL
-- AGENT: SQL that the agent's Analyst tools ran on the demo warehouse
SELECT DATE_TRUNC('hour', START_TIME), 'AGENT', 'Tool SQL (warehouse)', SUM(CREDITS),
       NULL, COUNT(*), FALSE
FROM wh_queries
WHERE QUERY_TAG ILIKE 'snowflake-intelligence-%' OR QUERY_TAG ILIKE 'cortex-agent-%'
GROUP BY ALL
UNION ALL
-- SHARED: Cortex Search services both the app and the agent query (daily grain)
SELECT s.USAGE_DATE::TIMESTAMP_LTZ, 'SHARED', 'Cortex Search serving', SUM(s.CREDITS), NULL, NULL, FALSE
FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_SEARCH_DAILY_USAGE_HISTORY s, cfg
WHERE s.DATABASE_NAME = cfg.DATABASE_NAME
GROUP BY ALL
UNION ALL
-- APP: queries the app's service user ran on the demo warehouse
SELECT DATE_TRUNC('hour', w.START_TIME), 'APP', 'Query compute (warehouse)', SUM(w.CREDITS),
       NULL, COUNT(*), FALSE
FROM wh_queries w JOIN svc_users u ON u.NAME = w.USER_NAME
GROUP BY ALL
UNION ALL
-- APP: equal share of the account's App Runtime pool
SELECT r.START_TIME, 'APP', 'App Runtime hosting (est.)', SUM(r.CREDITS_USED) / MAX(cfg.APP_COUNT),
       NULL, NULL, TRUE
FROM SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_APP_RUNTIME_COMPUTE_HISTORY r, cfg
WHERE r.START_TIME >= DATE_TRUNC('hour', cfg.APP_CREATED)
GROUP BY ALL;

CREATE OR REPLACE VIEW V_DAILY_CREDITS
  COMMENT = 'Daily rollup of V_HOURLY_CREDITS'
AS
SELECT USAGE_HOUR::DATE AS USAGE_DATE, COMPONENT, CATEGORY, IS_ESTIMATE,
       SUM(CREDITS) AS CREDITS, SUM(TOKENS) AS TOKENS, SUM(REQUESTS) AS REQUESTS
FROM V_HOURLY_CREDITS
GROUP BY ALL;

-- -----------------------------------------------------------------------------
-- 4. Drill-downs
-- -----------------------------------------------------------------------------
-- One row per agent request (CoWork and API), for the most expensive questions
CREATE OR REPLACE VIEW V_AGENT_REQUESTS AS
WITH cfg AS (SELECT * FROM V_CONFIG)
SELECT h.START_TIME, 'CoWork' AS CHANNEL, h.USER_NAME, h.REQUEST_ID,
       h.TOKEN_CREDITS AS CREDITS, h.TOKENS
FROM SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_COWORK_USAGE_HISTORY h, cfg
WHERE h.AGENT_NAME = cfg.AGENT_NAME AND h.AGENT_DATABASE_NAME = cfg.DATABASE_NAME
UNION ALL
SELECT h.START_TIME, 'API', h.USER_NAME, h.REQUEST_ID, h.TOKEN_CREDITS, h.TOKENS
FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AGENT_USAGE_HISTORY h, cfg
WHERE h.AGENT_NAME = cfg.AGENT_NAME AND h.AGENT_DATABASE_NAME = cfg.DATABASE_NAME;

-- Agent token credits by model and underlying service (CoWork requests)
CREATE OR REPLACE VIEW V_AGENT_MODEL_CREDITS AS
WITH cfg AS (SELECT * FROM V_CONFIG)
SELECT h.START_TIME::DATE AS USAGE_DATE,
       COALESCE(NULLIF(m.KEY, ''), 'unknown') AS MODEL_NAME,
       s.KEY AS SERVICE_TYPE,
       SUM(COALESCE(m.VALUE:input::FLOAT, 0) + COALESCE(m.VALUE:output::FLOAT, 0)
         + COALESCE(m.VALUE:cache_read_input::FLOAT, 0)
         + COALESCE(m.VALUE:cache_write_input::FLOAT, 0)) AS CREDITS
FROM SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_COWORK_USAGE_HISTORY h, cfg,
     LATERAL FLATTEN(input => h.CREDITS_GRANULAR) g,
     LATERAL FLATTEN(input => g.VALUE) r,
     LATERAL FLATTEN(input => r.VALUE) s,
     LATERAL FLATTEN(input => s.VALUE) m
WHERE h.AGENT_NAME = cfg.AGENT_NAME AND h.AGENT_DATABASE_NAME = cfg.DATABASE_NAME
  AND r.KEY != 'start_time'
GROUP BY ALL;

-- Total metered warehouse credits (includes idle time) for context
CREATE OR REPLACE VIEW V_WAREHOUSE_METERED AS
SELECT m.START_TIME::DATE AS USAGE_DATE, SUM(m.CREDITS_USED) AS CREDITS
FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY m, V_CONFIG c
WHERE m.WAREHOUSE_NAME = c.WAREHOUSE_NAME
GROUP BY ALL;

-- Total App Runtime pool credits (all apps) for context
CREATE OR REPLACE VIEW V_APP_RUNTIME_POOL AS
SELECT START_TIME::DATE AS USAGE_DATE, SUM(CREDITS_USED) AS CREDITS
FROM SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_APP_RUNTIME_COMPUTE_HISTORY
GROUP BY ALL;

-- Viewers of the tracker (OIG executive persona) read the views via the app,
-- which runs with the owner's rights; no extra grants are needed here.
