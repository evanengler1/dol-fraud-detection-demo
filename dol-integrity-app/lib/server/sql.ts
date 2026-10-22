import "server-only"

/** Shared SQL fragments over real objects. All names fully qualified. */

export const LATEST_CLAIM_ACTION = `latest AS (
  SELECT SUBJECT_ID AS CLAIM_ID, ACTION AS LAST_ACTION, ACTED_AT AS LAST_ACTED_AT, ACTED_ROLE AS LAST_ACTED_ROLE
  FROM DOL_FRAUD_DEMO.APP.CASE_ACTIONS WHERE SUBJECT_TYPE = 'CLAIM' AND ACTION <> 'NOTE'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY SUBJECT_ID ORDER BY ACTED_AT DESC, ACTION_ID DESC) = 1)`

/** Scheduled (future-dated) payments still to be released: the preventable dollars. */
export const CLAIM_EXPOSURE = `exposure AS (
  SELECT CLAIM_ID, SUM(AMOUNT) AS EXPOSURE, COUNT(*) AS PENDING_PAYMENTS, MIN(WEEK_ENDING) AS NEXT_PAYMENT
  FROM DOL_FRAUD_DEMO.RAW_SYNTH.UI_PAYMENT WHERE WEEK_ENDING >= CURRENT_DATE() GROUP BY CLAIM_ID)`

export const FLAGGED = `(c.RULES_HIT > 0 OR c.ML_FRAUD_PROBABILITY >= 0.5)`

export const STATUS_EXPR = `CASE l.LAST_ACTION
  WHEN 'HOLD_PAYMENT' THEN 'HELD' WHEN 'REQUEST_ID_VERIFICATION' THEN 'VERIFYING'
  WHEN 'CLEAR' THEN 'CLEARED' WHEN 'REFER_OIG' THEN 'REFERRED' WHEN 'ESCALATE' THEN 'ESCALATED'
  WHEN 'ASSIGN' THEN 'ASSIGNED' ELSE 'OPEN' END`

/**
 * Ring attribute values (bank account, phone, device) are raw identifiers and never leave the server.
 * Rings are addressed by an opaque SHA2 id; labels show only the last 4 characters.
 */
export const MASKED_LINK_LABEL = (alias: string) =>
  `CASE ${alias}.LINK_TYPE WHEN 'BANK_ACCOUNT' THEN 'Bank account' WHEN 'DEVICE' THEN 'Device' WHEN 'PHONE' THEN 'Phone'
     WHEN 'IP' THEN 'IP address' WHEN 'EMAIL' THEN 'Email' ELSE ${alias}.LINK_TYPE END || ' ending ' || RIGHT(${alias}.LINK_VALUE, 4)`

export const RING_BY_ID = `ring AS (
  SELECT LINK_TYPE, LINK_VALUE FROM DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_RING_STATS
  WHERE SHA2(LINK_TYPE || ':' || LINK_VALUE, 256) = ?)`

export const RULES = {
  R1: { col: "R1_SHARED_BANK_ACCOUNT", label: "Shared bank account" },
  R2: { col: "R2_DEVICE_OR_IP_FARM", label: "Device or IP farm" },
  R3: { col: "R3_MULTI_STATE_SSN", label: "Multi-state SSN" },
  R4: { col: "R4_WORKING_WHILE_CLAIMING", label: "Working while claiming" },
  R5: { col: "R5_FICTITIOUS_EMPLOYER", label: "Fictitious employer" },
  R6: { col: "R6_SYNTHETIC_IDENTITY", label: "Synthetic identity" },
} as const
