import { handle } from "@/lib/server/route"
import { queryPlatform } from "@/lib/server/db"

export const dynamic = "force-dynamic"

/** Public: claims-surge severity per state (ML.V_CLAIMS_SURGE_ALERTS) plus latest-year fraud dollars (DT_STATE_UI_BASELINE). */
export async function GET(req: Request) {
  return handle(req, async () =>
    queryPlatform(
      `WITH surge AS (
         SELECT STATE_CODE, COUNT_IF(SEVERITY = 'SEVERE') AS SEVERE_WEEKS, COUNT_IF(SEVERITY = 'HIGH') AS HIGH_WEEKS,
                COUNT_IF(SEVERITY = 'ELEVATED') AS ELEVATED_WEEKS, MAX(SURGE_MULTIPLE) AS PEAK_MULTIPLE,
                MAX_BY(WEEK_ENDING, SURGE_MULTIPLE) AS PEAK_WEEK,
                COUNT_IF(WEEK_ENDING >= DATEADD(week, -26, CURRENT_DATE())) AS RECENT_ALERT_WEEKS
         FROM DOL_FRAUD_DEMO.ML.V_CLAIMS_SURGE_ALERTS GROUP BY 1),
       fraud AS (
         SELECT STATE_CODE, ANY_VALUE(STATE_NAME) AS STATE_NAME,
                SUM(IFF(YEAR(QUARTER_ENDING) = YEAR(CURRENT_DATE()) - 1, FRAUD_DOLLARS, 0)) AS FRAUD_DOLLARS_LAST_YEAR
         FROM DOL_FRAUD_DEMO.ANALYTICS.DT_STATE_UI_BASELINE GROUP BY 1)
       SELECT f.STATE_CODE, f.STATE_NAME, COALESCE(s.SEVERE_WEEKS, 0) AS SEVERE_WEEKS, COALESCE(s.HIGH_WEEKS, 0) AS HIGH_WEEKS,
              COALESCE(s.ELEVATED_WEEKS, 0) AS ELEVATED_WEEKS, s.PEAK_MULTIPLE, s.PEAK_WEEK,
              COALESCE(s.RECENT_ALERT_WEEKS, 0) AS RECENT_ALERT_WEEKS, f.FRAUD_DOLLARS_LAST_YEAR
       FROM fraud f LEFT JOIN surge s ON s.STATE_CODE = f.STATE_CODE ORDER BY f.STATE_CODE`,
      { long: true },
    ),
  )
}
