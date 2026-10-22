import { handle, requireAccess, STATE_SCOPE } from "@/lib/server/route"
import { queryPlatform } from "@/lib/server/db"
import { CLAIM_EXPOSURE, FLAGGED, LATEST_CLAIM_ACTION, RULES, STATUS_EXPR } from "@/lib/server/sql"

export const dynamic = "force-dynamic"

const SORTS: Record<string, string> = {
  priority: "c.PRIORITY_SCORE",
  ml: "c.ML_FRAUD_PROBABILITY",
  exposure: "COALESCE(e.EXPOSURE, 0)",
  paid: "c.AMOUNT_PAID",
  filed: "c.FILED_TS",
  rules: "c.RULES_HIT",
  state: "c.STATE_CODE",
}
const SOURCES = new Set(["RULES_ONLY", "ML_ONLY", "RULES_AND_ML", "NONE"])
const BANDS: Record<string, string> = {
  critical: "c.PRIORITY_SCORE >= 90",
  high: "c.PRIORITY_SCORE >= 70 AND c.PRIORITY_SCORE < 90",
  medium: "c.PRIORITY_SCORE >= 50 AND c.PRIORITY_SCORE < 70",
  low: "c.PRIORITY_SCORE < 50",
}
const STATUSES = new Set(["OPEN", "HELD", "VERIFYING", "CLEARED", "REFERRED", "ESCALATED", "ASSIGNED"])

export async function GET(req: Request) {
  return handle(req, async (persona) => {
    await requireAccess(persona, "DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK")
    const p = new URL(req.url).searchParams
    const where: string[] = [STATE_SCOPE]
    const binds: (string | number)[] = [persona, persona]

    const queue = p.get("queue") === "all" ? "all" : "intercept"
    if (queue === "intercept") where.push(`${FLAGGED} AND COALESCE(e.EXPOSURE, 0) > 0`)

    const state = p.get("state")
    if (state && /^[A-Z]{2}$/.test(state)) {
      where.push("c.STATE_CODE = ?")
      binds.push(state)
    }
    const source = p.get("source")
    if (source && SOURCES.has(source)) {
      where.push("c.DETECTION_SOURCE = ?")
      binds.push(source)
    }
    const rule = p.get("rule") as keyof typeof RULES | null
    if (rule && rule in RULES) where.push(`c.${RULES[rule].col}`)
    const band = p.get("band")
    if (band && band in BANDS) where.push(BANDS[band])
    const status = p.get("status")
    if (status && STATUSES.has(status)) {
      where.push(`${STATUS_EXPR} = ?`)
      binds.push(status)
    }
    const q = p.get("q")?.trim()
    if (q) {
      where.push("(c.CLAIM_ID ILIKE ? OR c.LAST_EMPLOYER_DISPLAY_ID ILIKE ?)")
      binds.push(`%${q}%`, `%${q}%`)
    }

    const sortKey = p.get("sort") ?? (queue === "intercept" ? "exposure" : "priority")
    const sortCol = SORTS[sortKey] ?? SORTS.priority
    const dir = p.get("dir") === "asc" ? "ASC" : "DESC"
    const pageSize = Math.min(Math.max(Number(p.get("pageSize")) || 25, 10), 100)
    const page = Math.max(Number(p.get("page")) || 0, 0)
    binds.push(pageSize, page * pageSize)

    const rows = await queryPlatform(
      `WITH ${LATEST_CLAIM_ACTION}, ${CLAIM_EXPOSURE}
       SELECT c.CLAIM_ID, c.STATE_CODE, c.LAST_EMPLOYER_DISPLAY_ID, c.FILED_TS, c.AMOUNT_PAID,
              c.R1_SHARED_BANK_ACCOUNT, c.R2_DEVICE_OR_IP_FARM, c.R3_MULTI_STATE_SSN,
              c.R4_WORKING_WHILE_CLAIMING, c.R5_FICTITIOUS_EMPLOYER, c.R6_SYNTHETIC_IDENTITY,
              c.RULES_HIT, c.ML_FRAUD_PROBABILITY, c.PRIORITY_SCORE, c.DETECTION_SOURCE,
              COALESCE(e.EXPOSURE, 0) AS EXPOSURE, e.PENDING_PAYMENTS, e.NEXT_PAYMENT,
              ${STATUS_EXPR} AS PREVENTION_STATUS, l.LAST_ACTED_AT,
              COUNT(*) OVER () AS TOTAL_ROWS, SUM(COALESCE(e.EXPOSURE, 0)) OVER () AS TOTAL_EXPOSURE
       FROM DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK c
       LEFT JOIN exposure e ON e.CLAIM_ID = c.CLAIM_ID
       LEFT JOIN latest l ON l.CLAIM_ID = c.CLAIM_ID
       WHERE ${where.join(" AND ")}
       ORDER BY ${sortCol} ${dir} NULLS LAST, c.CLAIM_ID
       LIMIT ? OFFSET ?`,
      { binds, long: true },
    )
    return {
      rows,
      total: Number(rows[0]?.totalRows ?? 0),
      totalExposure: Number(rows[0]?.totalExposure ?? 0),
      page,
      pageSize,
      queue,
      provenance: "ANALYTICS.V_CLAIM_RISK + RAW_SYNTH.UI_PAYMENT (scheduled) + APP.CASE_ACTIONS. Synthetic data.",
    }
  })
}
