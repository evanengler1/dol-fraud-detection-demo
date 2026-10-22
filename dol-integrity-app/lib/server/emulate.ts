import "server-only"
import type { Row } from "@/lib/server/map"
import type { Persona } from "@/lib/personas"
import snapshot from "@/lib/server/persona-grants.json"

/*
 * Persona emulation, used where the session role cannot change per request (SPCS).
 * Queries run as the service owner role, which sees unmasked rows; this module then applies
 * each persona's rules so the app shows what that role would see in Snowflake:
 *   1. Object access from a snapshot of the persona role's real grants (persona-grants.json).
 *   2. Masking that mirrors the GOVERNANCE.MP_* policy bodies in sql/11_governance.sql.
 *   3. State row scope from GOVERNANCE.ROLE_STATE_ACCESS, as RAP_CLAIM_STATE does.
 * Keep the mask functions in step with the policy bodies.
 */

const GRANTS = snapshot.grants as Record<string, string[]>
const OBJECT_RE = /DOL_FRAUD_DEMO\.[A-Z0-9_$]+\.[A-Z0-9_$]+/gi

/** Every DOL_FRAUD_DEMO object a statement touches, plus a Cortex Search service passed as a bind. */
export function referencedObjects(sql: string, binds?: unknown[]): string[] {
  const found = new Set((sql.match(OBJECT_RE) ?? []).map((o) => o.toUpperCase()))
  // The row-scope mapping is read by the app to emulate RAP_CLAIM_STATE, not by the persona
  found.delete("DOL_FRAUD_DEMO.GOVERNANCE.ROLE_STATE_ACCESS")
  if (/SEARCH_PREVIEW/i.test(sql) && typeof binds?.[0] === "string") found.add(String(binds[0]).toUpperCase())
  return [...found]
}

/** The first object the persona has no grant on, or null when every object is granted. */
export function deniedObject(persona: Persona, objects: string[]): string | null {
  const allowed = GRANTS[persona] ?? []
  return objects.find((o) => !allowed.includes(o)) ?? null
}

/* ---------- masking (mirrors MP_SSN, MP_BANK_ACCOUNT, MP_PII_STRING, MP_DOB) ---------- */

const str = (v: unknown) => (v === null || v === undefined ? null : String(v))

function maskSsn(p: Persona, v: unknown) {
  const s = str(v)
  if (p === "DOL_OUI_ANALYST" || p === "DOL_STATE_PARTNER_TX") return s === null ? null : `XXX-XX-${s.slice(-4)}`
  return "***-**-****"
}

function maskBank(p: Persona, v: unknown) {
  const s = str(v)
  if (p === "DOL_OUI_ANALYST" || p === "DOL_OIG_EXECUTIVE") return s === null ? null : "*".repeat(Math.max(s.length - 4, 0)) + s.slice(-4)
  return "****"
}

function maskPii(p: Persona, v: unknown) {
  const s = str(v)
  if (p === "DOL_OUI_ANALYST") return s
  if (p === "DOL_STATE_PARTNER_TX") return s === null ? null : `${s.slice(0, 1)}***`
  return "[REDACTED]"
}

function maskDob(p: Persona, v: unknown) {
  const s = str(v)
  if (p === "DOL_OUI_ANALYST" || s === null) return s
  const year = new Date(s).getUTCFullYear()
  return Number.isFinite(year) ? new Date(Date.UTC(year, 0, 1)).toISOString() : null
}

// Masked columns, keyed by the camelCase name normalizeRows produces
const MASKS: Record<string, (p: Persona, v: unknown) => unknown> = {
  ssn: maskSsn,
  bankAccount: maskBank,
  firstName: maskPii,
  lastName: maskPii,
  email: maskPii,
  phone: maskPii,
  streetAddress: maskPii,
  claimEmail: maskPii,
  claimPhone: maskPii,
  dob: maskDob,
}

// Only these tables carry masking policies, so only queries over them are masked
const MASKED_SOURCES = /RAW_SYNTH\.(UI_CLAIMANT|UI_CLAIM|UI_PAYMENT|WAGE_RECORD|NEW_HIRE)\b/i
// Tables under RAP_CLAIM_STATE, directly or through V_CLAIM_RISK
const SCOPED_SOURCES = /RAW_SYNTH\.UI_CLAIM\b|ANALYTICS\.(V_CLAIM_RISK|DT_CLAIM_FEATURES|DT_CLAIM_RULE_FLAGS)\b/i

/**
 * Apply masking and state scope to rows read as the owner role.
 * `states` is the persona's ROLE_STATE_ACCESS list; null means unrestricted.
 */
export function applyGovernance(persona: Persona, sql: string, rows: Row[], states: string[] | null): Row[] {
  let out = rows
  if (states && SCOPED_SOURCES.test(sql)) {
    const inScope = (r: Row) => !("stateCode" in r) || r.stateCode === null || states.includes(String(r.stateCode))
    // Link rows LEFT JOIN the scoped view: Snowflake keeps the link and nulls the joined claim columns
    out = out.flatMap((r) => {
      if (inScope(r)) return [r]
      if (!("linkedClaimId" in r)) return []
      const kept: Row = {}
      for (const [k, v] of Object.entries(r)) kept[k] = k === "linkedClaimId" || k === "linkType" ? v : null
      return [kept]
    })
  }
  if (MASKED_SOURCES.test(sql)) {
    out = out.map((r) => {
      const m: Row = { ...r }
      for (const k of Object.keys(m)) if (MASKS[k]) m[k] = MASKS[k](persona, m[k])
      return m
    })
  }
  return out
}
