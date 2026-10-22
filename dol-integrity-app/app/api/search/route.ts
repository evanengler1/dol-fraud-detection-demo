import { handle } from "@/lib/server/route"
import { queryAs } from "@/lib/server/db"

export const dynamic = "force-dynamic"

/** Cortex Search only. Service names are allow-listed; the query JSON is built here and bound. */
const SERVICES: Record<string, { columns: string[]; origin: string }> = {
  CS_POLICY_DOCS: { columns: ["CHUNK_TEXT", "DOC_TITLE", "DOC_TYPE", "FILE_NAME", "PAGE_NUMBER"], origin: "PUBLIC" },
  CS_OSHA_NARRATIVES: {
    columns: ["ABSTRACT_TEXT", "DISPLAY_ID", "STATE_CODE", "EVENT_TYPE", "EVENT_DATE", "SUMMARY_NR"],
    origin: "PUBLIC",
  },
  CS_COMPLAINTS: {
    columns: ["ENGLISH_TEXT", "ORIGINAL_TEXT", "DISPLAY_ID", "ROUTE_TO_AGENCY", "LANGUAGE", "RECEIVED_DATE", "COMPLAINT_ID"],
    origin: "SYNTHETIC",
  },
}

export async function GET(req: Request) {
  return handle(req, async (persona) => {
    const p = new URL(req.url).searchParams
    const service = p.get("service") ?? ""
    const q = (p.get("q") ?? "").trim().slice(0, 300)
    const cfg = SERVICES[service]
    if (!cfg) throw new Error("Unknown search service")
    if (!q) return { service, results: [], origin: cfg.origin }
    const rows = await queryAs(
      persona,
      `SELECT SNOWFLAKE.CORTEX.SEARCH_PREVIEW(?, ?) AS R`,
      {
        binds: [`DOL_FRAUD_DEMO.AI.${service}`, JSON.stringify({ query: q, columns: cfg.columns, limit: 8 })],
        long: true,
      },
    )
    const raw = rows[0]?.r
    const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as { results?: Record<string, unknown>[] }
    return { service, origin: cfg.origin, results: parsed?.results ?? [] }
  })
}
