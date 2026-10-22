import { BadRequestError, handle, requireAccess, STATE_SCOPE } from "@/lib/server/route"
import { claimInScope, queryPlatform, RestrictedError } from "@/lib/server/db"
import { RING_BY_ID } from "@/lib/server/sql"
import { PERSONA_META, type Persona } from "@/lib/personas"

export const dynamic = "force-dynamic"

/*
 * Prevention and triage write-back. Every value is bound; action enums are allow-listed.
 * Writes run through the writer connection; ACTED_ROLE records the active persona.
 */

const CLAIM_ACTIONS = new Set(["HOLD_PAYMENT", "REQUEST_ID_VERIFICATION", "CLEAR", "ESCALATE", "ASSIGN", "REFER_OIG", "NOTE"])
const EMPLOYER_REFER = new Set(["WHD", "OSHA", "OIG", "OFLC", "STATE_UI"])
const LABELS = new Set(["CONFIRMED_FRAUD", "NOT_FRAUD", "UNSURE"])
const ID_RE = /^[A-Za-z0-9#:_\- ]{1,64}$/

function clean(note: unknown): string {
  return typeof note === "string" ? note.slice(0, 500) : ""
}

async function readBackAction(id: string) {
  const rows = await queryPlatform(
    `SELECT ACTION_ID, SUBJECT_TYPE, SUBJECT_ID, ACTION, NOTE, ACTED_BY, ACTED_ROLE, ACTED_AT
     FROM DOL_FRAUD_DEMO.APP.CASE_ACTIONS WHERE ACTION_ID = ?`,
    { binds: [id] },
  )
  return rows[0] ?? null
}

async function claimAction(persona: Persona, claimId: string, action: string, note: string) {
  // Row access is enforced by reading as the persona before any write
  if (!(await claimInScope(persona, claimId))) throw new RestrictedError(persona, `${claimId} is outside ${persona}'s row access scope`)
  const [{ id }] = (await queryPlatform(`SELECT UUID_STRING() AS ID`)) as { id: string }[]
  await queryPlatform(
    `INSERT INTO DOL_FRAUD_DEMO.APP.CASE_ACTIONS (ACTION_ID, SUBJECT_TYPE, SUBJECT_ID, ACTION, NOTE, ACTED_ROLE)
     SELECT ?, 'CLAIM', CLAIM_ID, ?, ?, ? FROM DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK WHERE CLAIM_ID = ?`,
    { binds: [id, action, note, persona, claimId] },
  )
  if (action === "REFER_OIG") {
    await queryPlatform(
      `INSERT INTO DOL_FRAUD_DEMO.APP.REFERRALS (EMPLOYER_ID, FROM_AGENCY, TO_AGENCY, REASON)
       SELECT LAST_EMPLOYER_ID, ?, 'OIG', ? FROM DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK WHERE CLAIM_ID = ?`,
      { binds: [PERSONA_META[persona].agency, `Claim ${claimId}: ${note || "Referred from fraud triage"}`, claimId] },
    )
  }
  const saved = await readBackAction(id)
  if (!saved) throw new Error(`Claim ${claimId} not found; nothing written`)
  return saved
}

export async function POST(req: Request) {
  return handle(req, async (persona) => {
    const body = (await req.json()) as Record<string, unknown>
    const kind = String(body.kind ?? "")
    const note = clean(body.note)

    if (kind === "claim") {
      await requireAccess(persona, "DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK")
      const claimId = String(body.claimId ?? "")
      const action = String(body.action ?? "")
      if (!ID_RE.test(claimId) || !CLAIM_ACTIONS.has(action)) throw new BadRequestError("Invalid claim action")
      return { saved: await claimAction(persona, claimId, action, note) }
    }

    if (kind === "ring-hold") {
      await requireAccess(persona, "DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK")
      const ringId = String(body.ringId ?? "")
      if (!/^[a-f0-9]{64}$/.test(ringId)) throw new BadRequestError("Invalid ring")
      const ringNote = `Ring hold ${ringId.slice(0, 10)}. ${note}`.trim()
      // One batch id per click so the read-back counts only this hold
      const [{ batch }] = (await queryPlatform(`SELECT 'RH-' || UUID_STRING() AS BATCH`)) as { batch: string }[]
      await queryPlatform(
        `INSERT INTO DOL_FRAUD_DEMO.APP.CASE_ACTIONS (ACTION_ID, SUBJECT_TYPE, SUBJECT_ID, ACTION, NOTE, ACTED_ROLE)
         WITH ${RING_BY_ID}
         SELECT ? || ':' || c.CLAIM_ID, 'CLAIM', c.CLAIM_ID, 'HOLD_PAYMENT', ?, ?
         FROM (SELECT l.CLAIM_ID_A AS CLAIM_ID FROM DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_LINKS l JOIN ring USING (LINK_TYPE, LINK_VALUE)
               UNION SELECT l.CLAIM_ID_B FROM DOL_FRAUD_DEMO.ANALYTICS.DT_CLAIM_LINKS l JOIN ring USING (LINK_TYPE, LINK_VALUE)) r
         JOIN DOL_FRAUD_DEMO.RAW_SYNTH.UI_CLAIM c ON c.CLAIM_ID = r.CLAIM_ID
         WHERE ${STATE_SCOPE}`,
        { binds: [ringId, batch, ringNote, persona, persona, persona] },
      )
      await queryPlatform(
        `INSERT INTO DOL_FRAUD_DEMO.APP.CASE_ACTIONS (SUBJECT_TYPE, SUBJECT_ID, ACTION, NOTE, ACTED_ROLE)
         VALUES ('RING', ?, 'HOLD_PAYMENT', ?, ?)`,
        { binds: [ringId, ringNote, persona] },
      )
      const [check] = await queryPlatform(
        `SELECT COUNT(DISTINCT a.SUBJECT_ID) AS CLAIMS_HELD, COALESCE(SUM(p.AMOUNT), 0) AS DOLLARS_INTERCEPTED
         FROM (SELECT DISTINCT SUBJECT_ID FROM DOL_FRAUD_DEMO.APP.CASE_ACTIONS
               WHERE SUBJECT_TYPE = 'CLAIM' AND STARTSWITH(ACTION_ID, ? || ':')) a
         LEFT JOIN DOL_FRAUD_DEMO.RAW_SYNTH.UI_PAYMENT p ON p.CLAIM_ID = a.SUBJECT_ID AND p.WEEK_ENDING >= CURRENT_DATE()`,
        { binds: [batch] },
      )
      return { saved: check }
    }

    if (kind === "feedback") {
      await requireAccess(persona, "DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK")
      const claimId = String(body.claimId ?? "")
      const label = String(body.label ?? "")
      if (!ID_RE.test(claimId) || !LABELS.has(label)) throw new BadRequestError("Invalid feedback")
      await queryPlatform(
        `INSERT INTO DOL_FRAUD_DEMO.APP.MODEL_FEEDBACK (CLAIM_ID, ML_PROBABILITY, ANALYST_LABEL, NOTE)
         SELECT CLAIM_ID, ML_FRAUD_PROBABILITY, ?, ? FROM DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK c
         WHERE CLAIM_ID = ? AND ${STATE_SCOPE}`,
        { binds: [label, `${persona}: ${note}`.trim(), claimId, persona, persona] },
      )
      const rows = await queryPlatform(
        `SELECT CLAIM_ID, ML_PROBABILITY, ANALYST_LABEL, NOTE, CREATED_AT FROM DOL_FRAUD_DEMO.APP.MODEL_FEEDBACK
         WHERE CLAIM_ID = ? ORDER BY CREATED_AT DESC LIMIT 1`,
        { binds: [claimId] },
      )
      return { saved: rows[0] ?? null }
    }

    if (kind === "employer-refer") {
      await requireAccess(persona, "DOL_FRAUD_DEMO.ANALYTICS.EMPLOYER_RISK_360")
      const employerId = String(body.employerId ?? "")
      const to = String(body.toAgency ?? "")
      if (!ID_RE.test(employerId) || !EMPLOYER_REFER.has(to)) throw new BadRequestError("Invalid referral")
      const [{ id }] = (await queryPlatform(`SELECT UUID_STRING() AS ID`)) as { id: string }[]
      await queryPlatform(
        `INSERT INTO DOL_FRAUD_DEMO.APP.REFERRALS (REFERRAL_ID, EMPLOYER_ID, FROM_AGENCY, TO_AGENCY, REASON)
         SELECT ?, EMPLOYER_ID, ?, ?, ? FROM DOL_FRAUD_DEMO.ANALYTICS.EMPLOYER_RISK_360 WHERE EMPLOYER_ID = ?`,
        { binds: [id, PERSONA_META[persona].agency, to, note || "Cross-agency risk referral", employerId] },
      )
      await queryPlatform(
        `INSERT INTO DOL_FRAUD_DEMO.APP.CASE_ACTIONS (SUBJECT_TYPE, SUBJECT_ID, ACTION, NOTE, ACTED_ROLE)
         VALUES ('EMPLOYER', ?, ?, ?, ?)`,
        { binds: [employerId, `REFER_${to}`, note, persona] },
      )
      const rows = await queryPlatform(
        `SELECT REFERRAL_ID, EMPLOYER_ID, FROM_AGENCY, TO_AGENCY, REASON, STATUS, CREATED_AT
         FROM DOL_FRAUD_DEMO.APP.REFERRALS WHERE REFERRAL_ID = ?`,
        { binds: [id] },
      )
      if (!rows.length) throw new Error("Employer not found; nothing written")
      return { saved: rows[0] }
    }

    if (kind === "employer-flag-claims") {
      const employerId = String(body.employerId ?? "")
      if (!ID_RE.test(employerId)) throw new BadRequestError("Invalid employer")
      await requireAccess(persona, "DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK")
      const flagNote = `Ex-worker of ${employerId} flagged from Employer 360`
      const [{ batch }] = (await queryPlatform(`SELECT 'EF-' || UUID_STRING() AS BATCH`)) as { batch: string }[]
      await queryPlatform(
        `INSERT INTO DOL_FRAUD_DEMO.APP.CASE_ACTIONS (ACTION_ID, SUBJECT_TYPE, SUBJECT_ID, ACTION, NOTE, ACTED_ROLE)
         SELECT ? || ':' || CLAIM_ID, 'CLAIM', CLAIM_ID, 'ESCALATE', ?, ? FROM DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK c
         WHERE LAST_EMPLOYER_ID = ? AND (RULES_HIT > 0 OR ML_FRAUD_PROBABILITY >= 0.5) AND ${STATE_SCOPE}`,
        { binds: [batch, flagNote, persona, employerId, persona, persona] },
      )
      const [check] = await queryPlatform(
        `SELECT COUNT(DISTINCT SUBJECT_ID) AS CLAIMS_ESCALATED FROM DOL_FRAUD_DEMO.APP.CASE_ACTIONS
         WHERE STARTSWITH(ACTION_ID, ? || ':')`,
        { binds: [batch] },
      )
      return { saved: check }
    }

    throw new BadRequestError("Unknown action kind")
  })
}
