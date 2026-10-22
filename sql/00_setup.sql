-- =============================================================================
-- DOL Fraud Detection Demo - 00 Setup
-- Role, warehouse, database, schemas, and read access to the existing
-- DOL_OSHA_DEMO / DOL_WHD_DEMO databases and the DOL_S3_INT storage integration.
-- Run as ACCOUNTADMIN. Persona roles are created in 11_governance.sql.
-- =============================================================================

USE ROLE ACCOUNTADMIN;

-- Demo owner role -------------------------------------------------------------
CREATE ROLE IF NOT EXISTS DOL_FRAUD_DEMO_ROLE
  COMMENT = 'Owner role for the DOL Fraud Detection demo';
GRANT ROLE DOL_FRAUD_DEMO_ROLE TO ROLE SYSADMIN;
SET my_user = CURRENT_USER();
GRANT ROLE DOL_FRAUD_DEMO_ROLE TO USER IDENTIFIER($my_user);

-- Account-level privileges the demo needs (ML models, Cortex, agents, alerts)
GRANT EXECUTE TASK, EXECUTE ALERT ON ACCOUNT TO ROLE DOL_FRAUD_DEMO_ROLE;
GRANT CREATE INTEGRATION ON ACCOUNT TO ROLE DOL_FRAUD_DEMO_ROLE;  -- notification integration (12)
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE DOL_FRAUD_DEMO_ROLE;

-- Warehouse --------------------------------------------------------------------
CREATE WAREHOUSE IF NOT EXISTS DOL_FRAUD_WH
  WAREHOUSE_SIZE = 'MEDIUM'
  AUTO_SUSPEND = 60
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE
  COMMENT = 'DOL Fraud Detection demo';
GRANT OWNERSHIP ON WAREHOUSE DOL_FRAUD_WH TO ROLE DOL_FRAUD_DEMO_ROLE COPY CURRENT GRANTS;

-- Database and schemas --------------------------------------------------------
CREATE DATABASE IF NOT EXISTS DOL_FRAUD_DEMO
  COMMENT = 'DOL Fraud Detection demo - public DOL data plus synthetic UI claims';
GRANT OWNERSHIP ON DATABASE DOL_FRAUD_DEMO TO ROLE DOL_FRAUD_DEMO_ROLE COPY CURRENT GRANTS;

-- S3 storage integration for the public-data downloads (see README "Data
-- preparation"). Create it once, then follow the Snowflake guide to trust it in
-- AWS IAM: https://docs.snowflake.com/en/user-guide/data-load-s3-config-storage-integration
-- The WHD and OSHA prerequisite demos (prereqs/) use the same integration.
-- CREATE STORAGE INTEGRATION IF NOT EXISTS DOL_S3_INT
--   TYPE = EXTERNAL_STAGE
--   STORAGE_PROVIDER = 'S3'
--   ENABLED = TRUE
--   STORAGE_AWS_ROLE_ARN = 'arn:aws:iam::<AWS_ACCOUNT_ID>:role/<SNOWFLAKE_READER_ROLE>'
--   STORAGE_ALLOWED_LOCATIONS = ('s3://YOUR-BUCKET/');
GRANT USAGE ON INTEGRATION DOL_S3_INT TO ROLE DOL_FRAUD_DEMO_ROLE;

-- Read access to the existing DOL databases (used in place, not copied)
GRANT USAGE ON DATABASE DOL_OSHA_DEMO TO ROLE DOL_FRAUD_DEMO_ROLE;
GRANT USAGE ON SCHEMA DOL_OSHA_DEMO.TRANSFORMED TO ROLE DOL_FRAUD_DEMO_ROLE;
GRANT SELECT ON ALL TABLES IN SCHEMA DOL_OSHA_DEMO.TRANSFORMED TO ROLE DOL_FRAUD_DEMO_ROLE;
GRANT USAGE ON DATABASE DOL_WHD_DEMO TO ROLE DOL_FRAUD_DEMO_ROLE;
GRANT USAGE ON SCHEMA DOL_WHD_DEMO.TRANSFORMED TO ROLE DOL_FRAUD_DEMO_ROLE;
GRANT SELECT ON ALL TABLES IN SCHEMA DOL_WHD_DEMO.TRANSFORMED TO ROLE DOL_FRAUD_DEMO_ROLE;

-- Everything below is owned by the demo role
USE ROLE DOL_FRAUD_DEMO_ROLE;
USE WAREHOUSE DOL_FRAUD_WH;
USE DATABASE DOL_FRAUD_DEMO;

CREATE SCHEMA IF NOT EXISTS RAW_PUBLIC  COMMENT = 'Public DOL/BLS data as published';
CREATE SCHEMA IF NOT EXISTS RAW_SYNTH   COMMENT = 'Synthetic data. Not real individuals.';
CREATE SCHEMA IF NOT EXISTS CURATED     COMMENT = 'Cleaned, conformed and entity-resolved data';
CREATE SCHEMA IF NOT EXISTS ANALYTICS   COMMENT = 'Risk scores, flags and app-facing tables';
CREATE SCHEMA IF NOT EXISTS ML          COMMENT = 'Cortex ML models and predictions';
CREATE SCHEMA IF NOT EXISTS AI          COMMENT = 'Cortex AI enrichment, search services, semantic views, agent';
CREATE SCHEMA IF NOT EXISTS GOVERNANCE  COMMENT = 'Tags, masking and row access policies';
CREATE SCHEMA IF NOT EXISTS APP         COMMENT = 'React SAR app and case write-back';

DROP SCHEMA IF EXISTS PUBLIC;
