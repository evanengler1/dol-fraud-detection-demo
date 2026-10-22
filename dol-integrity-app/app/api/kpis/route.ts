import { handle } from "@/lib/server/route"
import { queryPlatform } from "@/lib/server/db"

export const dynamic = "force-dynamic"

/** Headline KPIs (APP.V_KPI_HEADLINE) plus model AUC and a data-as-of stamp. Aggregates only. */
export async function GET(req: Request) {
  return handle(req, async () => {
    const rows = await queryPlatform(
      `SELECT k.*,
              (SELECT METRIC_VALUE FROM DOL_FRAUD_DEMO.ML.CLAIM_MODEL_METRICS WHERE ERROR_METRIC = 'auc' LIMIT 1) AS MODEL_AUC,
              (SELECT MAX(FILED_TS) FROM DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_RULE_FLAGS) AS LATEST_CLAIM_TS,
              (SELECT MAX(QUARTER_ENDING) FROM DOL_FRAUD_DEMO.CURATED.ETA_227_OVERPAYMENTS) AS LATEST_227_QUARTER,
              CURRENT_TIMESTAMP() AS QUERIED_AT
       FROM DOL_FRAUD_DEMO.APP.V_KPI_HEADLINE k`,
      { long: true },
    )
    return rows[0] ?? {}
  })
}
