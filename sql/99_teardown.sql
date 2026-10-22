-- =============================================================================
-- DOL Fraud Detection Demo - 99 Teardown
-- Removes everything this demo created. Does NOT touch DOL_WHD_DEMO,
-- DOL_OSHA_DEMO, the DOL_S3_INT integration or the S3 bucket.
-- Run as ACCOUNTADMIN. Review before running: this is irreversible.
-- =============================================================================

USE ROLE ACCOUNTADMIN;

-- Stop scheduled work first
ALTER TASK  IF EXISTS DOL_FRAUD_DEMO.ANALYTICS.TASK_REFRESH_EMPLOYER_RISK SUSPEND;
ALTER ALERT IF EXISTS DOL_FRAUD_DEMO.GOVERNANCE.ALERT_NEW_FRAUD_RING SUSPEND;
ALTER ALERT IF EXISTS DOL_FRAUD_DEMO.GOVERNANCE.ALERT_CLAIMS_SURGE SUSPEND;
ALTER ALERT IF EXISTS DOL_FRAUD_DEMO.GOVERNANCE.ALERT_HIGH_RISK_EMPLOYER SUSPEND;

-- CoWork agent: remove from Snowflake Intelligence, then drop (the database
-- drop would also remove it)
ALTER SNOWFLAKE INTELLIGENCE IF EXISTS SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT DROP AGENT DOL_FRAUD_DEMO.ANALYTICS.DOL_FRAUD_AGENT;
DROP AGENT IF EXISTS DOL_FRAUD_DEMO.ANALYTICS.DOL_FRAUD_AGENT;

-- Database (stages, tables, DTs, models, search services, semantic views, policies)
DROP DATABASE IF EXISTS DOL_FRAUD_DEMO;

-- Compute
DROP WAREHOUSE IF EXISTS DOL_FRAUD_WH;

-- Persona roles and the owner role
DROP ROLE IF EXISTS DOL_OUI_ANALYST;
DROP ROLE IF EXISTS DOL_WHD_INVESTIGATOR;
DROP ROLE IF EXISTS DOL_OSHA_INSPECTOR;
DROP ROLE IF EXISTS DOL_OIG_EXECUTIVE;
DROP ROLE IF EXISTS DOL_STATE_PARTNER_TX;
DROP ROLE IF EXISTS DOL_FRAUD_DEMO_ROLE;

-- Grants made on shared objects in 00_setup.sql are removed with the role.
-- 14_credit_tracker.sql: the COST schema and the Streamlit app go with the
-- database; PYPI_ACCESS_INTEGRATION is left in place because other apps may use it.
