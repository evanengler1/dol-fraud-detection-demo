import { handle, requireAccess } from "@/lib/server/route"
import { queryPlatform } from "@/lib/server/db"
import { MASKED_LINK_LABEL, RING_BY_ID } from "@/lib/server/sql"

export const dynamic = "force-dynamic"

/**
 * One ring as a graph. Nodes: claims plus attribute nodes (bank, device, phone, IP, email)
 * shared among the ring's claims. Attribute identifiers are hashed; labels show last 4 only.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return handle(req, async (persona) => {
    await requireAccess(persona, "DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_RING_STATS")
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid ring id")
    const rows = await queryPlatform(
      `WITH ${RING_BY_ID},
       claims AS (
         SELECT l.CLAIM_ID_A AS CLAIM_ID FROM DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_LINKS l JOIN ring USING (LINK_TYPE, LINK_VALUE)
         UNION SELECT l.CLAIM_ID_B FROM DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_LINKS l JOIN ring USING (LINK_TYPE, LINK_VALUE)),
       edges AS (
         SELECT l.CLAIM_ID_A AS CLAIM_ID, l.LINK_TYPE, l.LINK_VALUE FROM DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_LINKS l
         WHERE l.CLAIM_ID_A IN (SELECT CLAIM_ID FROM claims) AND l.CLAIM_ID_B IN (SELECT CLAIM_ID FROM claims)
         UNION
         SELECT l.CLAIM_ID_B, l.LINK_TYPE, l.LINK_VALUE FROM DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_LINKS l
         WHERE l.CLAIM_ID_A IN (SELECT CLAIM_ID FROM claims) AND l.CLAIM_ID_B IN (SELECT CLAIM_ID FROM claims)),
       held AS (SELECT DISTINCT SUBJECT_ID FROM DOL_FRAUD_DEMO.APP.CASE_ACTIONS WHERE SUBJECT_TYPE = 'CLAIM' AND ACTION = 'HOLD_PAYMENT'),
       exp AS (SELECT CLAIM_ID, SUM(AMOUNT) AS EXPOSURE FROM DOL_FRAUD_DEMO.RAW_SYNTH.UI_PAYMENT
               WHERE WEEK_ENDING >= CURRENT_DATE() AND CLAIM_ID IN (SELECT CLAIM_ID FROM claims) GROUP BY 1)
       SELECT 'CLAIM' AS KIND, v.CLAIM_ID AS NODE_ID, v.CLAIM_ID AS LABEL, 'CLAIM' AS NODE_TYPE, v.STATE_CODE,
              v.PRIORITY_SCORE, v.DETECTION_SOURCE, v.AMOUNT_PAID, COALESCE(x.EXPOSURE, 0) AS EXPOSURE,
              (h.SUBJECT_ID IS NOT NULL) AS IS_HELD, NULL AS SOURCE, NULL AS TARGET, v.ML_FRAUD_PROBABILITY, v.RULES_HIT
       FROM DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK v
       JOIN claims c ON c.CLAIM_ID = v.CLAIM_ID
       LEFT JOIN held h ON h.SUBJECT_ID = v.CLAIM_ID
       LEFT JOIN exp x ON x.CLAIM_ID = v.CLAIM_ID
       UNION ALL
       SELECT DISTINCT 'ATTR', LEFT(SHA2(e.LINK_TYPE || ':' || e.LINK_VALUE, 256), 16),
              ${MASKED_LINK_LABEL("e")}, e.LINK_TYPE,
              NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
       FROM edges e
       UNION ALL
       SELECT DISTINCT 'EDGE', NULL, NULL, LINK_TYPE, NULL, NULL, NULL, NULL, NULL, NULL,
              CLAIM_ID, LEFT(SHA2(LINK_TYPE || ':' || LINK_VALUE, 256), 16), NULL, NULL
       FROM edges`,
      { binds: [id], long: true },
    )
    return {
      nodes: rows.filter((r) => r.kind !== "EDGE"),
      links: rows.filter((r) => r.kind === "EDGE").map((r) => ({ source: r.source, target: r.target, type: r.nodeType })),
    }
  })
}
