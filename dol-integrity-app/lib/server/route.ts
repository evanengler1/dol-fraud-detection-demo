import "server-only"
import { personaFromRequest, queryAs, RestrictedError } from "@/lib/server/db"
import type { Persona } from "@/lib/personas"

/** Client input error: surfaces as 400 with its message. */
export class BadRequestError extends Error {}

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init)
}

/** Wrap a route: resolves persona, maps governance denials to a restricted payload. */
export async function handle(req: Request, fn: (persona: Persona) => Promise<unknown>) {
  const persona = personaFromRequest(req)
  try {
    return json(await fn(persona))
  } catch (err) {
    if (err instanceof RestrictedError) {
      // Raw Snowflake text stays in the server log; the client gets a plain reason
      const raw = err.message
      if (/error_code|Query failed/.test(raw)) console.warn(`[restricted] ${persona}: ${raw}`)
      const reason = /error_code|Query failed/.test(raw) ? `This object is not granted to ${persona}.` : raw
      return json({ restricted: true, persona, reason }, { status: 403 })
    }
    if (err instanceof BadRequestError) return json({ error: err.message }, { status: 400 })
    const ref = Math.random().toString(36).slice(2, 10)
    console.error(`[error ${ref}]`, err)
    return json({ error: `The query did not complete (ref ${ref}).` }, { status: 500 })
  }
}

const accessCache = new Map<string, { ok: boolean; at: number }>()

/** Probe whether a persona can read an object (cached 5 min). Throws RestrictedError if not. */
export async function requireAccess(persona: Persona, object: string) {
  const key = `${persona}:${object}`
  const hit = accessCache.get(key)
  if (hit && Date.now() - hit.at < 300_000) {
    if (!hit.ok) throw new RestrictedError(persona, `${persona} has no SELECT on ${object}`)
    return
  }
  try {
    await queryAs(persona, `SELECT 1 FROM ${object} LIMIT 1`)
    accessCache.set(key, { ok: true, at: Date.now() })
  } catch (err) {
    if (err instanceof RestrictedError) {
      accessCache.set(key, { ok: false, at: Date.now() })
      throw new RestrictedError(persona, `${persona} has no SELECT on ${object}`)
    }
    throw err
  }
}

/** SQL fragment honoring GOVERNANCE.ROLE_STATE_ACCESS for a persona (one bind: persona). */
export const STATE_SCOPE = `(NOT EXISTS (SELECT 1 FROM DOL_FRAUD_DEMO.GOVERNANCE.ROLE_STATE_ACCESS a WHERE a.ROLE_NAME = ?)
  OR c.STATE_CODE IN (SELECT a.STATE_CODE FROM DOL_FRAUD_DEMO.GOVERNANCE.ROLE_STATE_ACCESS a WHERE a.ROLE_NAME = ?))`
