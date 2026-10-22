import { handle, requireAccess } from "@/lib/server/route"
import { queryAs, queryPlatform, RestrictedError } from "@/lib/server/db"

export const dynamic = "force-dynamic"

async function optional<T>(p: Promise<T>): Promise<T | { restricted: true }> {
  try {
    return await p
  } catch (err) {
    if (err instanceof RestrictedError) return { restricted: true }
    throw err
  }
}

/**
 * Employer 360. Risk, brief, complaints and narratives are read as the persona.
 * The enforcement timeline and prevention exposure read through the platform role
 * (dates, amounts and counts only; no names or EINs).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return handle(req, async (persona) => {
    await requireAccess(persona, "DOL_FRAUD_DEMO.ANALYTICS.EMPLOYER_RISK_360")
    if (!/^[A-Za-z0-9_\-]{1,40}$/.test(id)) throw new Error("Invalid employer id")
    const [risk, brief, complaints, narratives, timeline, links, exposure, referrals] = await Promise.all([
      queryAs(persona, `SELECT * FROM DOL_FRAUD_DEMO.ANALYTICS.EMPLOYER_RISK_360 WHERE EMPLOYER_ID = ?`, { binds: [id] }),
      optional(
        queryAs(
          persona,
          `SELECT BRIEF, MODEL, GENERATED_AT, AGENCY_LIST, RISK_SCORE FROM DOL_FRAUD_DEMO.AI.EMPLOYER_CASE_BRIEF WHERE EMPLOYER_ID = ?`,
          { binds: [id] },
        ),
      ),
      optional(
        queryAs(
          persona,
          `SELECT COMPLAINT_ID, RECEIVED_DATE, LANGUAGE, CHANNEL, ORIGINAL_TEXT, ENGLISH_TEXT, ISSUE_TYPES, ROUTE_TO_AGENCY,
                  MENTIONS_RETALIATION_OR_COERCION, WORKERS_AFFECTED, DATA_ORIGIN
           FROM DOL_FRAUD_DEMO.AI.COMPLAINT_ENRICHED WHERE EMPLOYER_ID = ? ORDER BY RECEIVED_DATE DESC LIMIT 20`,
          { binds: [id] },
        ),
      ),
      optional(
        queryAs(
          persona,
          `SELECT SUMMARY_NR, EVENT_DATE, STATE_CODE, FATALITY, ABSTRACT_TEXT, EVENT_TYPE, INVOLVES_TEMP_OR_CONTRACT_WORKER,
                  EQUIPMENT_INVOLVED, TRAINING_OR_GUARDING_GAP, DATA_ORIGIN
           FROM DOL_FRAUD_DEMO.AI.OSHA_NARRATIVE_ENRICHED WHERE EMPLOYER_ID = ? ORDER BY EVENT_DATE DESC LIMIT 20`,
          { binds: [id] },
        ),
      ),
      queryPlatform(
        `SELECT 'WHD' AS AGENCY, FINDINGS_END_DATE AS EVENT_DATE, PROGRAM || ' findings: ' || TOTAL_VIOLATIONS || ' violations' AS TITLE,
                TOTAL_BACK_WAGES AS AMOUNT, IFF(IS_REPEAT_VIOLATOR, 'Repeat', NULL) AS TAG, 'SYNTHETIC' AS ORIGIN
         FROM DOL_FRAUD_DEMO.RAW_SYNTH.SYNTH_WHD_CASE WHERE EMPLOYER_ID = ?
         UNION ALL
         SELECT 'OSHA', ISSUANCE_DATE, VIOL_TYPE || ' citation ' || CITATION_ID, CURRENT_PENALTY,
                IFF(FAILURE_TO_ABATE, 'Failure to abate', NULL), 'SYNTHETIC'
         FROM DOL_FRAUD_DEMO.RAW_SYNTH.SYNTH_OSHA_VIOLATION WHERE EMPLOYER_ID = ?
         UNION ALL
         SELECT 'OFLC', RECEIVED_DATE, PROGRAM || ' ' || CASE_STATUS || ': ' || WORKERS_CERTIFIED || ' workers', WAGE_OFFER,
                WAGE_PER, 'SYNTHETIC'
         FROM DOL_FRAUD_DEMO.RAW_SYNTH.SYNTH_OFLC_H2_CASE WHERE EMPLOYER_ID = ?
         UNION ALL
         SELECT 'WHD', w.FINDINGS_END_DATE, 'WHD case: ' || w.TOTAL_VIOLATIONS || ' violations', w.TOTAL_BACK_WAGES,
                IFF(w.IS_REPEAT_VIOLATOR, 'Repeat', NULL), 'PUBLIC'
         FROM DOL_FRAUD_DEMO.CURATED.EMPLOYER_XREF x JOIN DOL_FRAUD_DEMO.CURATED.WHD_CASE w ON TO_VARCHAR(w.CASE_ID) = x.SOURCE_KEY
         WHERE x.SOURCE_SYSTEM = 'WHD' AND x.EMPLOYER_ID = ?
         UNION ALL
         SELECT 'OSHA', i.OPEN_DATE, 'OSHA ' || COALESCE(i.INSP_TYPE, '') || ' inspection', NULL, i.INSP_SCOPE, 'PUBLIC'
         FROM DOL_FRAUD_DEMO.CURATED.EMPLOYER_XREF x JOIN DOL_FRAUD_DEMO.CURATED.OSHA_INSPECTION i ON TO_VARCHAR(i.ACTIVITY_NR) = x.SOURCE_KEY
         WHERE x.SOURCE_SYSTEM = 'OSHA' AND x.EMPLOYER_ID = ?
         ORDER BY EVENT_DATE DESC NULLS LAST LIMIT 60`,
        { binds: [id, id, id, id, id] },
      ),
      queryPlatform(
        `SELECT l.LINK_TYPE, l.EVIDENCE, IFF(l.FROM_EMPLOYER_ID = ?, l.TO_EMPLOYER_ID, l.FROM_EMPLOYER_ID) AS OTHER_ID,
                IFF(l.FROM_EMPLOYER_ID = ?, 'SUCCESSOR', 'PREDECESSOR') AS RELATION, r.DISPLAY_ID AS OTHER_DISPLAY_ID, r.RISK_SCORE AS OTHER_RISK
         FROM DOL_FRAUD_DEMO.RAW_SYNTH.SYNTH_EMPLOYER_LINK l
         LEFT JOIN DOL_FRAUD_DEMO.ANALYTICS.EMPLOYER_RISK_360 r ON r.EMPLOYER_ID = IFF(l.FROM_EMPLOYER_ID = ?, l.TO_EMPLOYER_ID, l.FROM_EMPLOYER_ID)
         WHERE ? IN (l.FROM_EMPLOYER_ID, l.TO_EMPLOYER_ID)`,
        { binds: [id, id, id, id] },
      ),
      queryPlatform(
        `SELECT COUNT(*) AS EXWORKER_CLAIMS, COUNT_IF(v.RULES_HIT > 0 OR v.ML_FRAUD_PROBABILITY >= 0.5) AS FLAGGED_CLAIMS,
                COALESCE(SUM(p.EXPOSURE), 0) AS EXPOSURE
         FROM DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK v
         LEFT JOIN (SELECT CLAIM_ID, SUM(AMOUNT) AS EXPOSURE FROM DOL_FRAUD_DEMO.RAW_SYNTH.UI_PAYMENT
                    WHERE WEEK_ENDING >= CURRENT_DATE() GROUP BY 1) p ON p.CLAIM_ID = v.CLAIM_ID
         WHERE v.LAST_EMPLOYER_ID = ?`,
        { binds: [id] },
      ),
      queryPlatform(
        `SELECT REFERRAL_ID, FROM_AGENCY, TO_AGENCY, REASON, STATUS, CREATED_AT FROM DOL_FRAUD_DEMO.APP.REFERRALS
         WHERE EMPLOYER_ID = ? ORDER BY CREATED_AT DESC LIMIT 20`,
        { binds: [id] },
      ),
    ])
    if (!risk.length) return { notFound: true }
    return {
      employer: risk[0],
      brief: Array.isArray(brief) ? brief[0] ?? null : brief,
      complaints,
      narratives,
      timeline,
      links,
      exposure: exposure[0] ?? {},
      referrals,
    }
  })
}
