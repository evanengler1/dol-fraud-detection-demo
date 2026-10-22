"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, X } from "lucide-react"
import { fmt, useApi, usePersona } from "@/lib/client"
import {
  DetectionSource,
  EmptyState,
  ErrorState,
  MlScore,
  PageHeader,
  PreventionStatus,
  Provenance,
  Restricted,
  RuleFlag,
  RULE_LABELS,
  Skeleton,
  Tip,
  ruleCodes,
} from "@/components/kit"
import { useClaimAction, useClaimDrawer } from "@/components/claim-drawer"
import { cn } from "@/lib/utils"

type Row = Record<string, any>
type Page = { rows: Row[]; total: number; totalExposure: number; page: number; pageSize: number; queue: string }

const STATES = ["CA", "FL", "GA", "NY", "PA", "TX"]
const SOURCES = [
  ["RULES_AND_ML", "Both"],
  ["RULES_ONLY", "Rule only"],
  ["ML_ONLY", "ML only"],
]
const BANDS = [
  ["critical", "90+"],
  ["high", "70 to 89"],
  ["medium", "50 to 69"],
  ["low", "Under 50"],
]
const STATUSES = [
  ["OPEN", "Open"],
  ["HELD", "Held"],
  ["VERIFYING", "Verifying"],
  ["ESCALATED", "Escalated"],
  ["REFERRED", "Referred"],
  ["CLEARED", "Cleared"],
]

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button
      layout
      onClick={onClick}
      className={cn(
        "relative flex h-7 items-center gap-1 rounded-full border px-3 text-[12px] font-medium transition-colors duration-150",
        active ? "border-navy/20 bg-[#eef3fa] text-navy" : "border-transparent bg-[#f2f2f3] text-muted-foreground hover:border-hair hover:text-foreground",
      )}
    >
      {children}
      {active && <X className="size-3" />}
    </motion.button>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="eyebrow mr-1">{label}</span>
      {children}
    </div>
  )
}

const COLS: { key: string; label: string; sort?: string; className?: string }[] = [
  { key: "claim", label: "Claim" },
  { key: "state", label: "State", sort: "state" },
  { key: "rules", label: "Rule flags", sort: "rules" },
  { key: "ml", label: "ML score", sort: "ml" },
  { key: "source", label: "Detection" },
  { key: "exposure", label: "Still to pay", sort: "exposure", className: "text-right" },
  { key: "paid", label: "Paid to date", sort: "paid", className: "text-right" },
  { key: "status", label: "Prevention" },
]

export default function InterceptPage() {
  const { persona } = usePersona()
  const sp = useSearchParams()
  const router = useRouter()
  const { openClaim, claimId: openId } = useClaimDrawer()
  const act = useClaimAction()

  const get = (k: string, d = "") => sp.get(k) ?? d
  const queue = get("queue", "intercept")
  const setParam = useCallback(
    (k: string, v: string | null) => {
      const next = new URLSearchParams(sp.toString())
      if (v === null || v === "" || next.get(k) === v) next.delete(k)
      else next.set(k, v)
      if (k !== "page") next.delete("page")
      router.replace(`/intercept?${next.toString()}`, { scroll: false })
    },
    [sp, router],
  )

  const apiParams = useMemo(() => {
    const p = new URLSearchParams()
    for (const k of ["queue", "state", "source", "rule", "band", "status", "sort", "dir", "page"]) {
      const v = sp.get(k)
      if (v) p.set(k, v)
    }
    if (!p.get("queue")) p.set("queue", "intercept")
    p.set("pageSize", "25")
    return p.toString()
  }, [sp])

  const q = useApi<Page>(`/api/claims?${apiParams}`, { placeholderData: (prev) => prev })
  const rows = q.data?.rows ?? []
  const [cursor, setCursor] = useState(0)
  useEffect(() => setCursor(0), [apiParams])

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || e.metaKey || e.ctrlKey) return
      const row = rows[cursor]
      const target = openId ?? (row?.claimId as string | undefined)
      if (e.key === "j") setCursor((c) => Math.min(rows.length - 1, c + 1))
      else if (e.key === "k") setCursor((c) => Math.max(0, c - 1))
      else if (e.key === "Enter" && row) openClaim(row.claimId)
      else if (target && e.key === "e") act.mutate({ claimId: target, action: "ESCALATE" })
      else if (target && e.key === "h") act.mutate({ claimId: target, action: "HOLD_PAYMENT" })
      else if (target && e.key === "v") act.mutate({ claimId: target, action: "REQUEST_ID_VERIFICATION" })
      else if (target && e.key === "c") act.mutate({ claimId: target, action: "CLEAR" })
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", on)
    return () => window.removeEventListener("keydown", on)
  }, [rows, cursor, openClaim, openId, act])

  const sort = get("sort", queue === "intercept" ? "exposure" : "priority")
  const dir = get("dir", "desc")
  const page = Number(get("page", "0"))
  const total = q.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / 25))

  return (
    <>
      <PageHeader
        eyebrow="Prevent  /  Pre-payment intercept"
        title={queue === "intercept" ? "Stop suspect payments before they are released." : "Every scored claim, rules and ML side by side."}
        sub={
          queue === "intercept"
            ? "Flagged claims that still have scheduled payments, ranked by dollars that can be stopped. Hold, verify identity, escalate or clear."
            : "The full triage queue over ANALYTICS.V_CLAIM_RISK, with rule flags kept separate from the ML score."
        }
        right={
          <div className="flex rounded-full border border-hair bg-white p-1">
            {[
              ["intercept", "Intercept queue"],
              ["all", "All claims"],
            ].map(([v, l]) => (
              <button
                key={v}
                onClick={() => setParam("queue", v === "intercept" ? null : v)}
                className={cn("relative h-8 rounded-full px-4 text-[13px] font-medium", queue === v ? "text-white" : "text-muted-foreground")}
              >
                {queue === v && (
                  <motion.span layoutId="queue-tab" className="absolute inset-0 rounded-full bg-navy" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
                )}
                <span className="relative">{l}</span>
              </button>
            ))}
          </div>
        }
      />

      {q.error?.restricted ? (
        <Restricted persona={persona} reason={q.error.message} what="UI claim records (ANALYTICS.V_CLAIM_RISK)" />
      ) : (
        <div className="card overflow-hidden">
          <div className="space-y-3 border-b border-hair p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-baseline gap-6">
                <div>
                  <div className="eyebrow">Claims</div>
                  <div className="num text-[22px] font-medium">{q.data ? fmt.int(total) : "..."}</div>
                </div>
                <div>
                  <div className="eyebrow">Scheduled dollars in view</div>
                  <div className="num text-[22px] font-medium text-amber">{q.data ? fmt.usd(q.data.totalExposure, false) : "..."}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[11.5px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="kbd">j</span><span className="kbd">k</span> move</span>
                <span className="flex items-center gap-1"><span className="kbd">↵</span> open</span>
                <span className="flex items-center gap-1"><span className="kbd">h</span> hold</span>
                <span className="flex items-center gap-1"><span className="kbd">v</span> verify</span>
                <span className="flex items-center gap-1"><span className="kbd">e</span> escalate</span>
                <Provenance origin="SYNTHETIC" source="ANALYTICS.V_CLAIM_RISK + RAW_SYNTH.UI_PAYMENT + APP.CASE_ACTIONS" note="Server-side paging with LIMIT/OFFSET binds; 25 rows per page." />
              </div>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Group label="State">
                {STATES.map((s) => (
                  <Chip key={s} active={get("state") === s} onClick={() => setParam("state", s)}>
                    <span className="mono">{s}</span>
                  </Chip>
                ))}
              </Group>
              <Group label="Detection">
                {SOURCES.map(([v, l]) => (
                  <Chip key={v} active={get("source") === v} onClick={() => setParam("source", v)}>{l}</Chip>
                ))}
              </Group>
              <Group label="Rule">
                {Object.keys(RULE_LABELS).map((r) => (
                  <Tip key={r} content={RULE_LABELS[r]}>
                    <span>
                      <Chip active={get("rule") === r} onClick={() => setParam("rule", r)}>
                        <span className="mono">{r}</span>
                      </Chip>
                    </span>
                  </Tip>
                ))}
              </Group>
              <Group label="Score">
                {BANDS.map(([v, l]) => (
                  <Chip key={v} active={get("band") === v} onClick={() => setParam("band", v)}>{l}</Chip>
                ))}
              </Group>
              <Group label="Status">
                {STATUSES.map(([v, l]) => (
                  <Chip key={v} active={get("status") === v} onClick={() => setParam("status", v)}>{l}</Chip>
                ))}
              </Group>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-hair text-left">
                  {COLS.map((c) => (
                    <th key={c.key} className={cn("h-9 px-4 text-[11.5px] font-medium text-muted-foreground", c.className)}>
                      {c.sort ? (
                        <button
                          onClick={() => {
                            const next = new URLSearchParams(sp.toString())
                            next.set("sort", c.sort!)
                            next.set("dir", sort === c.sort && dir === "desc" ? "asc" : "desc")
                            next.delete("page")
                            router.replace(`/intercept?${next.toString()}`, { scroll: false })
                          }}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          {c.label}
                          {sort === c.sort && (dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={cn("transition-opacity", q.isFetching && "opacity-70")}>
                {q.isLoading &&
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b border-hair">
                      <td colSpan={COLS.length} className="px-4 py-2.5"><Skeleton className="h-5" /></td>
                    </tr>
                  ))}
                <AnimatePresence initial={false}>
                  {rows.map((r, i) => (
                    <motion.tr
                      key={r.claimId}
                      layout="position"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18, delay: Math.min(i * 0.012, 0.2) }}
                      onClick={() => {
                        setCursor(i)
                        openClaim(r.claimId)
                      }}
                      className={cn(
                        "cursor-pointer border-b border-hair transition-colors duration-150 hover:bg-[#f7f7f6]",
                        i === cursor && "bg-[#f3f6fa] shadow-[inset_2px_0_0_#0b2545]",
                      )}
                    >
                      <td className="mono px-4 py-2.5 text-[12px]">{r.claimId}</td>
                      <td className="mono px-4 text-[12px]">{r.stateCode}</td>
                      <td className="px-4">
                        <div className="flex gap-1">
                          {ruleCodes(r).length ? ruleCodes(r).map((c) => <RuleFlag key={c} code={c} compact />) : <span className="text-muted-foreground">None</span>}
                        </div>
                      </td>
                      <td className="px-4"><MlScore p={r.mlFraudProbability} /></td>
                      <td className="px-4"><DetectionSource value={r.detectionSource} /></td>
                      <td className={cn("num px-4 text-right", r.exposure > 0 && r.preventionStatus === "OPEN" && "font-medium text-amber")}>
                        {fmt.usd(r.exposure, false)}
                      </td>
                      <td className="num px-4 text-right text-muted-foreground">{fmt.usd(r.amountPaid, false)}</td>
                      <td className="px-4"><PreventionStatus status={r.preventionStatus} /></td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
            {q.error && !q.error.restricted && <div className="p-4"><ErrorState message={q.error.message} onRetry={() => q.refetch()} /></div>}
            {q.data && rows.length === 0 && (
              <EmptyState
                title={queue === "intercept" ? "Nothing left to intercept here" : "No claims match"}
                body={queue === "intercept" ? "Every flagged claim in this filter has been actioned or has no scheduled payments. Clear a filter to widen the view." : "Try removing a filter."}
              />
            )}
          </div>

          <div className="flex items-center justify-between px-4 py-3 text-[12.5px] text-muted-foreground">
            <span>
              Page <span className="num text-foreground">{page + 1}</span> of <span className="num">{fmt.int(pages)}</span>
            </span>
            <div className="flex gap-1">
              <button disabled={page === 0} onClick={() => setParam("page", String(page - 1))} className="flex h-8 items-center gap-1 rounded-md border border-hair bg-white px-2.5 disabled:opacity-40">
                <ChevronLeft className="size-3.5" /> Prev
              </button>
              <button disabled={page + 1 >= pages} onClick={() => setParam("page", String(page + 1))} className="flex h-8 items-center gap-1 rounded-md border border-hair bg-white px-2.5 disabled:opacity-40">
                Next <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
