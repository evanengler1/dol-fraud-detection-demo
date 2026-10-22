import { handle, requireAccess, STATE_SCOPE } from "@/lib/server/route"
import { queryPlatform } from "@/lib/server/db"
import { CLAIM_EXPOSURE, FLAGGED, LATEST_CLAIM_ACTION, STATUS_EXPR } from "@/lib/server/sql"

export const dynamic = "force-dynamic"

/**
 * Prevention scoreboard and detection-to-prevention funnel.
 * Prevented dollars = scheduled (future) payments on claims whose latest action is a hold.
 * Scoped to the persona's states via GOVERNANCE.ROLE_STATE_ACCESS. Aggregates only.
 */
export async function GET(req: Request) {
  return handle(req, async (persona) => {
    await requireAccess(persona, "DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK")
    const rows = await queryPlatform(
      `WITH ${LATEST_CLAIM_ACTION}, ${CLAIM_EXPOSURE},
       base AS (
         SELECT c.CLAIM_ID, c.DETECTION_SOURCE, ${FLAGGED} AS IS_FLAGGED, COALESCE(e.EXPOSURE, 0) AS EXPOSURE,
                ${STATUS_EXPR} AS STATUS, l.LAST_ACTED_AT, c.FILED_TS
         FROM DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK c
         LEFT JOIN exposure e ON e.CLAIM_ID = c.CLAIM_ID
         LEFT JOIN latest l ON l.CLAIM_ID = c.CLAIM_ID
         WHERE ${STATE_SCOPE}),
       acts AS (
         SELECT COUNT(*) AS TOTAL_ACTIONS, COUNT_IF(SUBJECT_TYPE = 'RING') AS RING_HOLDS,
                MAX(ACTED_AT) AS LAST_ACTION_AT
         FROM DOL_FRAUD_DEMO.APP.CASE_ACTIONS),
       refs AS (SELECT COUNT(*) AS REFERRALS, COUNT_IF(STATUS = 'OPEN') AS OPEN_REFERRALS FROM DOL_FRAUD_DEMO.APP.REFERRALS),
       fb AS (SELECT COUNT(*) AS FEEDBACK, COUNT_IF(ANALYST_LABEL = 'CONFIRMED_FRAUD') AS CONFIRMED FROM DOL_FRAUD_DEMO.APP.MODEL_FEEDBACK)
       SELECT COUNT(*) AS SCORED,
              COUNT_IF(IS_FLAGGED) AS FLAGGED,
              COUNT_IF(DETECTION_SOURCE = 'RULES_ONLY') AS RULES_ONLY,
              COUNT_IF(DETECTION_SOURCE = 'ML_ONLY') AS ML_ONLY,
              COUNT_IF(DETECTION_SOURCE = 'RULES_AND_ML') AS BOTH,
              COUNT_IF(IS_FLAGGED AND EXPOSURE > 0) AS INTERCEPTABLE,
              SUM(IFF(IS_FLAGGED, EXPOSURE, 0)) AS EXPOSURE_FLAGGED,
              COUNT_IF(STATUS <> 'OPEN') AS ACTIONED,
              COUNT_IF(STATUS = 'HELD') AS HELD,
              SUM(IFF(STATUS = 'HELD', EXPOSURE, 0)) AS DOLLARS_PREVENTED,
              COUNT_IF(STATUS = 'VERIFYING') AS VERIFYING,
              SUM(IFF(STATUS = 'VERIFYING', EXPOSURE, 0)) AS DOLLARS_PAUSED,
              COUNT_IF(STATUS = 'CLEARED') AS CLEARED,
              COUNT_IF(STATUS = 'REFERRED') AS REFERRED_CLAIMS,
              COUNT_IF(STATUS = 'ESCALATED') AS ESCALATED,
              SUM(IFF(IS_FLAGGED AND STATUS = 'OPEN', EXPOSURE, 0)) AS DOLLARS_STILL_EXPOSED,
              MEDIAN(IFF(STATUS <> 'OPEN', DATEDIFF(hour, FILED_TS, LAST_ACTED_AT), NULL)) AS MEDIAN_HOURS_TO_ACTION,
              ANY_VALUE(a.TOTAL_ACTIONS) AS TOTAL_ACTIONS, ANY_VALUE(a.RING_HOLDS) AS RING_HOLDS,
              ANY_VALUE(a.LAST_ACTION_AT) AS LAST_ACTION_AT,
              ANY_VALUE(r.REFERRALS) AS REFERRALS, ANY_VALUE(r.OPEN_REFERRALS) AS OPEN_REFERRALS,
              ANY_VALUE(f.FEEDBACK) AS FEEDBACK, ANY_VALUE(f.CONFIRMED) AS CONFIRMED_FRAUD
       FROM base CROSS JOIN acts a CROSS JOIN refs r CROSS JOIN fb f`,
      { binds: [persona, persona], long: true },
    )
    return rows[0] ?? {}
  })
}
