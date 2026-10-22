import { handle, requireAccess } from "@/lib/server/route"
import { queryAs } from "@/lib/server/db"

export const dynamic = "force-dynamic"

/** Employer search by DISPLAY_ID only. Names and EINs are never returned. */
export async function GET(req: Request) {
  return handle(req, async (persona) => {
    await requireAccess(persona, "DOL_FRAUD_DEMO.ANALYTICS.EMPLOYER_RISK_360")
    const q = (new URL(req.url).searchParams.get("q") ?? "").replace(/[^0-9]/g, "").slice(0, 10)
    return queryAs(
      persona,
      `SELECT EMPLOYER_ID, DISPLAY_ID, STATE_CODE, CITY, NAICS_CODE, IS_SYNTHETIC, AGENCIES_FLAGGED, AGENCY_LIST, RISK_SCORE
       FROM DOL_FRAUD_DEMO.ANALYTICS.EMPLOYER_RISK_360
       WHERE (? = '' OR DISPLAY_ID LIKE ?) AND AGENCIES_FLAGGED >= IFF(? = '', 2, 0)
       ORDER BY IS_SYNTHETIC DESC, RISK_SCORE DESC NULLS LAST LIMIT 25`,
      { binds: [q, `%${q}%`, q] },
    )
  })
}
