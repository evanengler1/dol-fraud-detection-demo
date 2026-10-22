import { handle, requireAccess } from "@/lib/server/route"
import { claimInScope, PERSONA_MODE, queryAs, queryPlatform, RestrictedError } from "@/lib/server/db"
import { CLAIM_EXPOSURE, LATEST_CLAIM_ACTION, STATUS_EXPR } from "@/lib/server/sql"
import type { Persona } from "@/lib/personas"

export const dynamic = "force-dynamic"

// In emulate mode, scope the join the way RAP_CLAIM_STATE does in Snowflake: out-of-scope linked
// claims keep their link row but join no claim columns, before ORDER BY and LIMIT
const EMULATED_LINK_SCOPE =
  PERSONA_MODE === "emulate"
    ? ` AND (NOT EXISTS (SELECT 1 FROM DOL_FRAUD_DEMO.GOVERNANCE.ROLE_STATE_ACCESS a WHERE a.ROLE_NAME = ?)
          OR v.STATE_CODE IN (SELECT a.STATE_CODE FROM DOL_FRAUD_DEMO.GOVERNANCE.ROLE_STATE_ACCESS a WHERE a.ROLE_NAME = ?))`
    : ""

async function optional<T>(p: Promise<T>): Promise<T | { restricted: true }> {
  try {
    return await p
  } catch (err) {
    if (err instanceof RestrictedError) return { restricted: true }
    throw err
  }
}

/** Claimant identity fields, read as the persona so masking policies apply. */
function identity(persona: Persona, id: string) {
  return queryAs(
    persona,
    `SELECT cl.CLAIM_ID, ct.SSN, ct.FIRST_NAME, ct.LAST_NAME, ct.DOB, ct.EMAIL, ct.PHONE, ct.CITY, ct.STATE_CODE,
            ct.IDENTITY_VERIFIED, ct.PHONE_IS_VOIP, ct.ADDRESS_IS_CMRA, cl.BANK_ACCOUNT, cl.FILING_CHANNEL,
            cl.WEEKLY_BENEFIT_AMT, cl.WEEKS_PAID, cl.STATUS, cl.SEPARATION_REASON
     FROM DOL_FRAUD_DEMO.RAW_SYNTH.UI_CLAIM cl
     JOIN DOL_FRAUD_DEMO.RAW_SYNTH.UI_CLAIMANT ct ON ct.CLAIMANT_ID = cl.CLAIMANT_ID
     WHERE cl.CLAIM_ID = ?`,
    { binds: [id] },
  )
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return handle(req, async (persona) => {
    await requireAccess(persona, "DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK")
    if (!(await claimInScope(persona, id))) throw new RestrictedError(persona, `${id} is outside ${persona}'s state scope`)
    const [risk, ident, links, features, importance, history] = await Promise.all([
      queryAs(persona, `SELECT * FROM DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK WHERE CLAIM_ID = ?`, { binds: [id] }),
      optional(identity(persona, id)),
      optional(
        queryAs(
          persona,
          `SELECT l.LINKED_CLAIM_ID, l.LINK_TYPE, v.STATE_CODE, v.PRIORITY_SCORE, v.DETECTION_SOURCE, v.AMOUNT_PAID
           FROM (SELECT CLAIM_ID_B AS LINKED_CLAIM_ID, LINK_TYPE FROM DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_LINKS WHERE CLAIM_ID_A = ?
                 UNION SELECT CLAIM_ID_A, LINK_TYPE FROM DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_LINKS WHERE CLAIM_ID_B = ?) l
           LEFT JOIN DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK v ON v.CLAIM_ID = l.LINKED_CLAIM_ID${EMULATED_LINK_SCOPE}
           ORDER BY v.PRIORITY_SCORE DESC NULLS LAST, l.LINKED_CLAIM_ID, l.LINK_TYPE LIMIT 25`,
          { binds: PERSONA_MODE === "emulate" ? [id, id, persona, persona] : [id, id] },
        ),
      ),
      optional(
        queryAs(
          persona,
          `SELECT BANK_ACCOUNT_CLAIM_COUNT, DEVICE_CLAIM_COUNT, DEVICE_STATE_COUNT, IP_CLAIM_COUNT, SSN_STATE_COUNT,
                  NEW_HIRE_MATCHES, WAGE_QTRS_DURING_CLAIM, ROUND_WAGE_QTRS, ACCOUNT_AGE_HOURS, IDENTITY_VERIFIED,
                  PHONE_IS_VOIP, ADDRESS_IS_CMRA, EMAIL_UNCOMMON_DOMAIN, EMPLOYER_HAS_PUBLIC_FOOTPRINT,
                  EMPLOYER_AGE_AT_SEPARATION_DAYS, WBA_PCT_OF_MAX, WEEKLY_BENEFIT_AMT, WEEKS_PAID, FILING_CHANNEL
           FROM DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_FEATURES WHERE CLAIM_ID = ?`,
          { binds: [id] },
        ),
      ),
      queryPlatform(
        `SELECT "RANK", FEATURE, SCORE, FEATURE_TYPE FROM DOL_FRAUD_DEMO.ML.CLAIM_MODEL_FEATURE_IMPORTANCE ORDER BY "RANK" LIMIT 12`,
      ),
      queryPlatform(
        `WITH ${LATEST_CLAIM_ACTION}, ${CLAIM_EXPOSURE}
         SELECT 'STATE' AS K, ${STATUS_EXPR} AS ACTION, NULL AS NOTE, NULL AS ACTED_ROLE, NULL AS ACTED_AT,
                COALESCE(e.EXPOSURE, 0) AS EXPOSURE, e.PENDING_PAYMENTS, e.NEXT_PAYMENT
         FROM (SELECT ? AS CLAIM_ID) c LEFT JOIN latest l ON l.CLAIM_ID = c.CLAIM_ID LEFT JOIN exposure e ON e.CLAIM_ID = c.CLAIM_ID
         UNION ALL
         SELECT 'EVENT', ACTION, NOTE, ACTED_ROLE, ACTED_AT, NULL, NULL, NULL FROM DOL_FRAUD_DEMO.APP.CASE_ACTIONS
         WHERE SUBJECT_TYPE = 'CLAIM' AND SUBJECT_ID = ?
         UNION ALL
         SELECT 'EVENT', 'FEEDBACK_' || ANALYST_LABEL, NOTE, NULL, CREATED_AT, NULL, NULL, NULL FROM DOL_FRAUD_DEMO.APP.MODEL_FEEDBACK
         WHERE CLAIM_ID = ?
         UNION ALL
         SELECT 'EVENT', 'REFERRAL_' || TO_AGENCY, REASON, FROM_AGENCY, CREATED_AT, NULL, NULL, NULL FROM DOL_FRAUD_DEMO.APP.REFERRALS
         WHERE REASON LIKE ?
         ORDER BY K DESC, ACTED_AT DESC NULLS LAST`,
        { binds: [id, id, id, `Claim ${id}:%`] },
      ),
    ])
    if (!risk.length) return { notFound: true }
    const state = history.find((h) => h.k === "STATE") ?? {}
    return {
      claim: risk[0],
      identity: Array.isArray(ident) ? ident[0] ?? null : ident,
      links,
      features: Array.isArray(features) ? features[0] ?? null : features,
      importance,
      prevention: {
        status: state.action ?? "OPEN",
        exposure: Number(state.exposure ?? 0),
        pendingPayments: Number(state.pendingPayments ?? 0),
        nextPayment: state.nextPayment ?? null,
      },
      history: history.filter((h) => h.k === "EVENT"),
    }
  })
}
