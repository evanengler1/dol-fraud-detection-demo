import "server-only"

export type Row = Record<string, unknown>

/** UPPER_SNAKE -> camelCase */
function camel(key: string): string {
  return key.toLowerCase().replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

function normalizeValue(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  if (typeof v === "bigint") return Number(v)
  // NUMBER columns with scale may arrive as numeric strings
  if (typeof v === "string" && /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(v) && v.length < 17) return Number(v)
  // The SDK parses VARIANT/ARRAY/OBJECT already; only parse when still a JSON string
  return v
}

/** The single row mapper used by every route. */
export function normalizeRows(rows: Record<string, unknown>[]): Row[] {
  return rows.map((r) => {
    const out: Row = {}
    for (const [k, v] of Object.entries(r)) out[camel(k)] = normalizeValue(v)
    return out
  })
}

/** Parse a VARIANT that may be a string or already an object. */
export function asJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T
    } catch {
      return fallback
    }
  }
  return v as T
}
