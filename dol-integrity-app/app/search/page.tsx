"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { motion } from "framer-motion"
import { FileText, HardHat, MessageSquareWarning, Search } from "lucide-react"
import { useApi, usePersona } from "@/lib/client"
import { EmptyState, ErrorState, OriginBadge, PageHeader, Restricted, Skeleton } from "@/components/kit"
import { cn } from "@/lib/utils"

const TABS = [
  { id: "CS_POLICY_DOCS", label: "Policy and OIG reports", Icon: FileText, text: "chunkText" },
  { id: "CS_OSHA_NARRATIVES", label: "OSHA narratives", Icon: HardHat, text: "abstractText" },
  { id: "CS_COMPLAINTS", label: "Worker complaints", Icon: MessageSquareWarning, text: "englishText" },
] as const

type Result = Record<string, unknown>

/** Cortex Search returns columns as given (UPPERCASE); normalize keys for display. */
function norm(r: Result): Record<string, any> {
  const o: Record<string, any> = {}
  for (const [k, v] of Object.entries(r)) o[k.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())] = v
  return o
}

function highlight(text: string, q: string) {
  const words = q.split(/\s+/).filter((w) => w.length > 3).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  if (!words.length) return text
  const re = new RegExp(`(${words.join("|")})`, "gi")
  return text.split(re).map((p, i) => (i % 2 ? <mark key={i} className="rounded bg-amber-50 px-0.5 text-foreground">{p}</mark> : p))
}

function Results({ service, q, field }: { service: string; q: string; field: string }) {
  const { persona } = usePersona()
  const r = useApi<{ results: Result[]; origin: "PUBLIC" | "SYNTHETIC" }>(q ? `/api/search?service=${service}&q=${encodeURIComponent(q)}` : null, { staleTime: 120_000 })
  if (!q) return <EmptyState title="Ask the evidence" body="Try: identity theft overpayment, failure to abate scaffolding, or unpaid overtime retaliation." />
  if (r.isLoading) return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
  if (r.error?.restricted) return <Restricted persona={persona} reason={r.error.message} what={`the ${service} Cortex Search service`} />
  if (r.error) return <ErrorState message={r.error.message} onRetry={() => r.refetch()} />
  const rows = (r.data?.results ?? []).map(norm)
  if (!rows.length) return <EmptyState title="No passages matched" body="Cortex Search found nothing close. Rephrase with the words a report or complaint would use." />
  return (
    <div className="space-y-2">
      {rows.map((x, i) => {
        const source =
          service === "CS_POLICY_DOCS"
            ? `${x.docTitle ?? x.fileName}, page ${x.pageNumber}`
            : service === "CS_OSHA_NARRATIVES"
              ? `OSHA summary ${x.summaryNr}  ${x.displayId ?? "Unmatched employer"}  ${x.stateCode ?? ""}  ${x.eventDate ?? ""}`
              : `${x.complaintId}  ${x.displayId ?? ""}  route to ${x.routeToAgency ?? "n/a"}  ${x.language ?? ""}`
        const score = (x["@scores"] as { cosineSimilarity?: number } | undefined)?.cosineSimilarity
        return (
          <motion.article key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="card card-hover p-4">
            <div className="mb-1.5 flex items-center gap-2 text-[11.5px] text-muted-foreground">
              <OriginBadge origin={r.data!.origin} />
              <span className="mono">{source}</span>
              {score != null && <span className="num ml-auto">similarity {score.toFixed(2)}</span>}
            </div>
            <p className="text-[13.5px] leading-relaxed">{highlight(String(x[field] ?? "").slice(0, 700), q)}</p>
            {service === "CS_COMPLAINTS" && x.originalText && x.language !== "EN" && (
              <p className="mt-2 border-l-2 border-hair pl-3 text-[12.5px] italic text-muted-foreground">{String(x.originalText).slice(0, 300)}</p>
            )}
          </motion.article>
        )
      })}
    </div>
  )
}

export default function SearchPage() {
  const sp = useSearchParams()
  const router = useRouter()
  const q = sp.get("q") ?? ""
  const service = sp.get("service") ?? "CS_POLICY_DOCS"
  const [draft, setDraft] = useState(q)
  useEffect(() => setDraft(q), [q])
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp.toString())
    n.set(k, v)
    router.replace(`/search?${n.toString()}`, { scroll: false })
  }
  const tab = TABS.find((t) => t.id === service) ?? TABS[0]
  return (
    <>
      <PageHeader
        eyebrow="Investigate  /  Cortex Search"
        title="Find the evidence behind a referral."
        sub="Semantic search over OIG audits and UI program letters, OSHA accident narratives, and worker complaints in English and Spanish."
      />
      <form onSubmit={(e) => { e.preventDefault(); set("q", draft.trim()) }} className="mb-4">
        <label className="card flex h-12 items-center gap-3 px-4">
          <Search className="size-4 text-muted-foreground" />
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search evidence" className="flex-1 bg-transparent text-[14px] outline-none" autoFocus />
          <button className="h-8 rounded-full bg-navy px-4 text-[12.5px] font-medium text-white">Search</button>
        </label>
      </form>
      <div className="mb-4 flex gap-1 rounded-full border border-hair bg-white p-1" style={{ width: "fit-content" }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => set("service", t.id)} className={cn("relative flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium", service === t.id ? "text-white" : "text-muted-foreground hover:text-foreground")}>
            {service === t.id && <motion.span layoutId="search-tab" className="absolute inset-0 rounded-full bg-navy" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <t.Icon className="relative size-3.5" />
            <span className="relative">{t.label}</span>
            <span className="mono relative text-[10px] opacity-70">{t.id}</span>
          </button>
        ))}
      </div>
      <Results service={service} q={q} field={tab.text} />
    </>
  )
}
