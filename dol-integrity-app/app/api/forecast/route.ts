import { handle } from "@/lib/server/route"
import { queryPlatform } from "@/lib/server/db"

export const dynamic = "force-dynamic"

/** Public: ETA 227 fraud overpayment actuals plus Cortex FORECAST band, summed over the forecast states. */
export async function GET(req: Request) {
  return handle(req, async () => {
    const rows = await queryPlatform(
      `WITH st AS (SELECT DISTINCT STATE_CODE FROM DOL_FRAUD_DEMO.ML.FRAUD_OP_FORECAST),
       act AS (
         SELECT b.QUARTER_ENDING, SUM(b.FRAUD_DOLLARS) AS ACTUAL
         FROM DOL_FRAUD_DEMO.ANALYTICS.DT_STATE_UI_BASELINE b JOIN st USING (STATE_CODE)
         WHERE b.QUARTER_ENDING >= '2019-01-01' AND b.FRAUD_DOLLARS IS NOT NULL GROUP BY 1),
       fc AS (
         SELECT QUARTER_ENDING, SUM(FORECAST) AS FORECAST, SUM(LOWER_BOUND) AS LOWER_BOUND, SUM(UPPER_BOUND) AS UPPER_BOUND
         FROM DOL_FRAUD_DEMO.ML.FRAUD_OP_FORECAST GROUP BY 1)
       SELECT COALESCE(a.QUARTER_ENDING, f.QUARTER_ENDING) AS QUARTER_ENDING, a.ACTUAL, f.FORECAST, f.LOWER_BOUND, f.UPPER_BOUND,
              (SELECT ARRAY_AGG(STATE_CODE) WITHIN GROUP (ORDER BY STATE_CODE) FROM st) AS STATES
       FROM act a FULL OUTER JOIN fc f ON f.QUARTER_ENDING = a.QUARTER_ENDING
       ORDER BY 1`,
    )
    return { rows, states: rows[0]?.states ?? [] }
  })
}
