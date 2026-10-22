import { BadRequestError, handle } from "@/lib/server/route"
import { RestrictedError } from "@/lib/server/db"
import { queryPlatform } from "@/lib/server/db"

export const dynamic = "force-dynamic"

/**
 * Demo reset: clears analyst write-backs made while using the app, then restores a fixed
 * baseline of prior activity (rows with SEED- ids) so the prevention scoreboard is never empty.
 * Touches only the three APP write-back tables; source data, scores and pipelines are unchanged.
 */

// Deterministic pick of flagged synthetic claims that still have scheduled payments
const RANKED = `ranked AS (
  SELECT c.CLAIM_ID, c.LAST_EMPLOYER_ID, c.ML_FRAUD_PROBABILITY,
         ROW_NUMBER() OVER (ORDER BY HASH(c.CLAIM_ID)) AS RN
  FROM DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK c
  JOIN (SELECT DISTINCT CLAIM_ID FROM DOL_FRAUD_DEMO.RAW_SYNTH.UI_PAYMENT
        WHERE WEEK_ENDING >= CURRENT_DATE()) p ON p.CLAIM_ID = c.CLAIM_ID
  WHERE c.RULES_HIT > 0 OR c.ML_FRAUD_PROBABILITY >= 0.5)`

// RN bands -> baseline action. 14 holds, 4 ID checks, 3 cleared, 2 escalated.
const SEED_ACTION = `CASE WHEN RN <= 14 THEN 'HOLD_PAYMENT' WHEN RN <= 18 THEN 'REQUEST_ID_VERIFICATION'
  WHEN RN <= 21 THEN 'CLEAR' ELSE 'ESCALATE' END`

const SEED_SQL = [
  `INSERT INTO DOL_FRAUD_DEMO.APP.CASE_ACTIONS (ACTION_ID, SUBJECT_TYPE, SUBJECT_ID, ACTION, NOTE, ACTED_BY, ACTED_ROLE, ACTED_AT)
   WITH ${RANKED}
   SELECT 'SEED-CA-' || CLAIM_ID, 'CLAIM', CLAIM_ID, ${SEED_ACTION}, 'Baseline triage activity (demo seed)',
          'demo-seed', 'DOL_OUI_ANALYST', DATEADD(hour, -6 * RN, CURRENT_TIMESTAMP())
   FROM ranked r WHERE RN <= 23
     AND NOT EXISTS (SELECT 1 FROM DOL_FRAUD_DEMO.APP.CASE_ACTIONS a WHERE a.ACTION_ID = 'SEED-CA-' || r.CLAIM_ID)`,
  `INSERT INTO DOL_FRAUD_DEMO.APP.REFERRALS (REFERRAL_ID, EMPLOYER_ID, FROM_AGENCY, TO_AGENCY, REASON, STATUS, CREATED_BY, CREATED_AT)
   WITH ${RANKED}
   SELECT 'SEED-RF-' || CLAIM_ID, LAST_EMPLOYER_ID, 'OUI', 'OIG', 'Claim ' || CLAIM_ID || ': baseline referral (demo seed)',
          'OPEN', 'demo-seed', DATEADD(hour, -6 * RN, CURRENT_TIMESTAMP())
   FROM ranked r WHERE RN BETWEEN 22 AND 23 AND LAST_EMPLOYER_ID IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM DOL_FRAUD_DEMO.APP.REFERRALS x WHERE x.REFERRAL_ID = 'SEED-RF-' || r.CLAIM_ID)`,
  `INSERT INTO DOL_FRAUD_DEMO.APP.MODEL_FEEDBACK (CLAIM_ID, ML_PROBABILITY, ANALYST_LABEL, NOTE, CREATED_BY, CREATED_AT)
   WITH ${RANKED}
   SELECT CLAIM_ID, ML_FRAUD_PROBABILITY, IFF(RN <= 18, 'CONFIRMED_FRAUD', 'NOT_FRAUD'), 'Baseline feedback (demo seed)',
          'demo-seed', DATEADD(hour, -6 * RN, CURRENT_TIMESTAMP())
   FROM ranked r WHERE RN IN (1, 2, 3, 15, 19, 20)
     AND NOT EXISTS (SELECT 1 FROM DOL_FRAUD_DEMO.APP.MODEL_FEEDBACK f WHERE f.CLAIM_ID = r.CLAIM_ID AND f.CREATED_BY = 'demo-seed')`,
]

const CLEAR_SQL: Record<string, string> = {
  CASE_ACTIONS: `ACTION_ID NOT LIKE 'SEED-%'`,
  REFERRALS: `COALESCE(REFERRAL_ID, '') NOT LIKE 'SEED-%'`,
  MODEL_FEEDBACK: `COALESCE(CREATED_BY, '') <> 'demo-seed'`,
}

export async function POST(req: Request) {
  return handle(req, async (persona) => {
    // Set DEMO_RESET_ENABLED=false to turn reset off in a shared deployment
    if (process.env.DEMO_RESET_ENABLED === "false") throw new RestrictedError(persona, "Demo reset is disabled in this deployment.")
    const body = (await req.json().catch(() => ({}))) as { confirm?: string }
    if (body.confirm !== "RESET") throw new BadRequestError("Reset requires confirmation")
    const cleared: Record<string, number> = {}
    for (const [t, where] of Object.entries(CLEAR_SQL)) {
      const [r] = await queryPlatform(`SELECT COUNT(*) AS N FROM DOL_FRAUD_DEMO.APP.${t} WHERE ${where}`)
      await queryPlatform(`DELETE FROM DOL_FRAUD_DEMO.APP.${t} WHERE ${where}`)
      cleared[t] = Number(r?.n ?? 0)
    }
    for (const sql of SEED_SQL) await queryPlatform(sql, { long: true })
    return { cleared }
  })
}
