import "server-only"
import fs from "node:fs"
import snowflake from "snowflake-sdk"
import {
  querySnowflake,
  querySnowflakeLongRunning,
  readTomlDefaultConnection,
} from "@/lib/snowflake"
import { normalizeRows, type Row } from "@/lib/server/map"
import { PERSONAS, WRITER_ROLE, type Persona } from "@/lib/personas"
import { applyGovernance, deniedObject, referencedObjects } from "@/lib/server/emulate"

/*
 * Persona-aware query layer.
 *
 * Local dev: one pool per persona role, each with that role as the primary
 * role, so masking and row access policies keyed on CURRENT_ROLE() apply for
 * real. Writes go through a single writer pool (DOL_FRAUD_DEMO_ROLE).
 *
 * SPCS: the role cannot change per request, so persona reads run in "emulate" mode:
 * owner's rights, then lib/server/emulate.ts applies the persona's grants, masking and
 * state scope. PERSONA_MODE=emulate forces this locally so it can be tested before deploy.
 */

type Binds = snowflake.Binds
const WAREHOUSE = "DOL_FRAUD_WH"
const IN_SPCS = fs.existsSync("/snowflake/session/token")
/** "roles": real persona roles (local default). "emulate": owner's rights plus app-side governance. */
export const PERSONA_MODE: "roles" | "emulate" =
  process.env.PERSONA_MODE === "emulate" || process.env.PERSONA_MODE === "roles"
    ? process.env.PERSONA_MODE
    : IN_SPCS ? "emulate" : "roles"

const pools = new Map<string, ReturnType<typeof snowflake.createPool>>()

function normalizeToml(conn: Record<string, unknown>): snowflake.ConnectionOptions {
  const normalize = (snowflake as unknown as {
    normalizeConnectionOptions: (o: Record<string, unknown>) => snowflake.ConnectionOptions
  }).normalizeConnectionOptions
  return normalize(conn)
}

function poolFor(role: string) {
  let pool = pools.get(role)
  if (!pool) {
    const conn = readTomlDefaultConnection()
    if (!conn) throw new Error("No local Snowflake connection found in ~/.snowflake")
    pool = snowflake.createPool(
      { ...normalizeToml(conn as Record<string, unknown>), role, warehouse: WAREHOUSE, application: "SnowflakeAppRuntime" },
      { min: 0, max: 4 },
    )
    pools.set(role, pool)
  }
  return pool
}

function exec(conn: snowflake.Connection, sql: string, binds?: Binds): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sql,
      ...(binds && binds.length ? { binds } : {}),
      complete: (err, _stmt, rows) => (err ? reject(err) : resolve((rows ?? []) as Record<string, unknown>[])),
    })
  })
}

// Users often default to DEFAULT_SECONDARY_ROLES = ('ALL'), which would leak privileges
// from other granted roles into a persona session. Pin each connection to its primary role once.
const pinned = new WeakSet<object>()

function runOnPool(role: string, sql: string, binds?: Binds): Promise<Record<string, unknown>[]> {
  return poolFor(role).use(async (conn) => {
    if (!pinned.has(conn)) {
      await exec(conn, "USE SECONDARY ROLES NONE")
      pinned.add(conn)
    }
    return exec(conn, sql, binds)
  })
}

export class RestrictedError extends Error {
  constructor(public persona: string, message: string) {
    super(message)
  }
}

const RESTRICTED_CODES = ["003001", "002003", "002043"]

function isRestricted(err: unknown): boolean {
  const e = err as { code?: string | number; message?: string }
  const code = String(e?.code ?? "")
  const msg = e?.message ?? ""
  return RESTRICTED_CODES.includes(code) || /does not exist or (access is )?not authorized|error_code: 390404|Insufficient privileges/i.test(msg)
}

export interface QueryOpts {
  binds?: Binds
  long?: boolean
}

/** Read as a persona. Throws RestrictedError when the role lacks a grant. */
let stateCache: { at: number; map: Map<string, string[]> } | null = null

/** ROLE_STATE_ACCESS as a map, cached for a minute. Personas not listed are unrestricted. */
async function stateScope(persona: Persona): Promise<string[] | null> {
  if (!stateCache || Date.now() - stateCache.at > 60_000) {
    const rows = await queryPlatform(`SELECT ROLE_NAME, STATE_CODE FROM DOL_FRAUD_DEMO.GOVERNANCE.ROLE_STATE_ACCESS`)
    const map = new Map<string, string[]>()
    for (const r of rows) map.set(String(r.roleName), [...(map.get(String(r.roleName)) ?? []), String(r.stateCode)])
    stateCache = { at: Date.now(), map }
  }
  return stateCache.map.get(persona) ?? null
}

async function queryEmulated(persona: Persona, sql: string, opts: QueryOpts): Promise<Row[]> {
  const denied = deniedObject(persona, referencedObjects(sql, opts.binds as unknown[] | undefined))
  if (denied) throw new RestrictedError(persona, `${persona} has no grant on ${denied}`)
  const rows = await queryPlatform(sql, opts)
  return applyGovernance(persona, sql, rows, await stateScope(persona))
}

export async function queryAs(persona: Persona, sql: string, opts: QueryOpts = {}): Promise<Row[]> {
  if (PERSONA_MODE === "emulate") return queryEmulated(persona, sql, opts)
  try {
    if (IN_SPCS) {
      const fn = opts.long ? querySnowflakeLongRunning : querySnowflake
      return normalizeRows(await fn(sql, { binds: opts.binds, warehouse: WAREHOUSE }))
    }
    return normalizeRows(await runOnPool(persona, sql, opts.binds))
  } catch (err) {
    if (isRestricted(err)) throw new RestrictedError(persona, (err as Error).message)
    throw err
  }
}

/** Platform reads and all writes: the demo owner role locally, the service role in SPCS. */
export async function queryPlatform(sql: string, opts: QueryOpts = {}): Promise<Row[]> {
  if (IN_SPCS) {
    const fn = opts.long ? querySnowflakeLongRunning : querySnowflake
    return normalizeRows(await fn(sql, { binds: opts.binds, warehouse: WAREHOUSE }))
  }
  return normalizeRows(await runOnPool(WRITER_ROLE, sql, opts.binds))
}

export function personaFromRequest(req: Request): Persona {
  const p = req.headers.get("x-persona") ?? ""
  return (PERSONAS as readonly string[]).includes(p) ? (p as Persona) : "DOL_OUI_ANALYST"
}

export const runtimeMode = IN_SPCS ? "spcs" : "local"

/** True when the persona may see this claim under its state scope (both modes). */
export async function claimInScope(persona: Persona, claimId: string): Promise<boolean> {
  const states = PERSONA_MODE === "emulate" ? await stateScope(persona) : null
  if (PERSONA_MODE === "roles") {
    const rows = await queryAs(persona, `SELECT 1 AS OK FROM DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK WHERE CLAIM_ID = ?`, { binds: [claimId] })
    return rows.length > 0
  }
  if (!states) return true
  const rows = await queryPlatform(`SELECT STATE_CODE FROM DOL_FRAUD_DEMO.RAW_SYNTH.UI_CLAIM WHERE CLAIM_ID = ?`, { binds: [claimId] })
  return rows.length > 0 && states.includes(String(rows[0].stateCode))
}
