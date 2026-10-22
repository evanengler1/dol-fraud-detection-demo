"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { useQuery, type UseQueryOptions } from "@tanstack/react-query"
import { PERSONAS, type Persona } from "@/lib/personas"

/* ---------- Persona ---------- */

interface PersonaCtx {
  persona: Persona
  setPersona: (p: Persona) => void
}
const Ctx = createContext<PersonaCtx>({ persona: "DOL_OUI_ANALYST", setPersona: () => {} })

export function PersonaProvider({ children }: { children: React.ReactNode }) {
  const [persona, set] = useState<Persona>("DOL_OUI_ANALYST")
  useEffect(() => {
    const saved = window.localStorage.getItem("dol.persona")
    if (saved && (PERSONAS as readonly string[]).includes(saved)) set(saved as Persona)
  }, [])
  const setPersona = useCallback((p: Persona) => {
    set(p)
    window.localStorage.setItem("dol.persona", p)
  }, [])
  return <Ctx.Provider value={{ persona, setPersona }}>{children}</Ctx.Provider>
}

export const usePersona = () => useContext(Ctx)

/* ---------- API ---------- */

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public restricted = false,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, persona: Persona, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", "x-persona": persona, ...(init?.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(body?.reason ?? body?.error ?? `Request failed (${res.status})`, res.status, !!body?.restricted)
  }
  return body as T
}

export function useApi<T>(
  path: string | null,
  opts: Omit<UseQueryOptions<T, ApiError>, "queryKey" | "queryFn"> = {},
) {
  const { persona } = usePersona()
  return useQuery<T, ApiError>({
    queryKey: [path, persona],
    queryFn: () => api<T>(path!, persona),
    enabled: !!path,
    retry: (n, err) => !err.restricted && n < 1,
    ...opts,
  })
}

/* ---------- Formatting ---------- */

export const fmt = {
  usd(n: unknown, compact = true) {
    const v = Number(n ?? 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: compact && Math.abs(v) >= 10_000 ? "compact" : "standard",
      maximumFractionDigits: compact && Math.abs(v) >= 10_000 ? 1 : 0,
    }).format(v)
  },
  int(n: unknown) {
    return new Intl.NumberFormat("en-US").format(Number(n ?? 0))
  },
  compact(n: unknown) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(n ?? 0))
  },
  pct(n: unknown, digits = 1) {
    return `${(Number(n ?? 0) * 100).toFixed(digits)}%`
  },
  date(v: unknown) {
    if (!v) return "n/a"
    const d = new Date(String(v))
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
  },
  dateTime(v: unknown) {
    if (!v) return "n/a"
    return new Date(String(v)).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  },
}
