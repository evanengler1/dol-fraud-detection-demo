import { handle, requireAccess } from "@/lib/server/route"
import { queryPlatform } from "@/lib/server/db"
import { MASKED_LINK_LABEL } from "@/lib/server/sql"

export const dynamic = "force-dynamic"

/** Synthetic: fraud rings (5+ claims sharing one attribute) with exposure and hold state. */
export async function GET(req: Request) {
  return handle(req, async (persona) => {
    await requireAccess(persona, "DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_RING_STATS")
    return queryPlatform(
      `WITH members AS (
         SELECT DISTINCT LINK_TYPE, LINK_VALUE, CLAIM_ID_A AS CLAIM_ID FROM DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_LINKS
         UNION SELECT DISTINCT LINK_TYPE, LINK_VALUE, CLAIM_ID_B FROM DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_LINKS),
       held AS (SELECT DISTINCT SUBJECT_ID FROM DOL_FRAUD_DEMO.APP.CASE_ACTIONS WHERE SUBJECT_TYPE = 'CLAIM' AND ACTION = 'HOLD_PAYMENT'),
       exp AS (
         SELECT m.LINK_TYPE, m.LINK_VALUE, SUM(p.AMOUNT) AS EXPOSURE,
                SUM(IFF(h.SUBJECT_ID IS NOT NULL, p.AMOUNT, 0)) AS HELD_EXPOSURE,
                COUNT(DISTINCT h.SUBJECT_ID) AS HELD_CLAIMS
         FROM members m
         LEFT JOIN DOL_FRAUD_DEMO.RAW_SYNTH.UI_PAYMENT p ON p.CLAIM_ID = m.CLAIM_ID AND p.WEEK_ENDING >= CURRENT_DATE()
         LEFT JOIN held h ON h.SUBJECT_ID = m.CLAIM_ID
         GROUP BY 1, 2)
       SELECT r.LINK_TYPE, SHA2(r.LINK_TYPE || ':' || r.LINK_VALUE, 256) AS RING_ID,
              ${MASKED_LINK_LABEL("r")} AS RING_LABEL, r.CLAIM_COUNT, r.STATE_COUNT, r.STATES,
              r.TOTAL_PAID, r.FIRST_FILED, r.LAST_FILED, r.FILING_SPAN_HOURS,
              COALESCE(e.EXPOSURE, 0) AS EXPOSURE, COALESCE(e.HELD_EXPOSURE, 0) AS HELD_EXPOSURE, COALESCE(e.HELD_CLAIMS, 0) AS HELD_CLAIMS
       FROM DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_RING_STATS r
       LEFT JOIN exp e ON e.LINK_TYPE = r.LINK_TYPE AND e.LINK_VALUE = r.LINK_VALUE
       WHERE r.CLAIM_COUNT >= 5
       ORDER BY r.TOTAL_PAID DESC`,
      { long: true },
    )
  })
}
