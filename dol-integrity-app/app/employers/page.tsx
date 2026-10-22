"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowUpRight, Flag, GitBranch, Languages, Search, Sparkles } from "lucide-react"
import { api, fmt, useApi, usePersona } from "@/lib/client"
import { ErrorState, OriginBadge, PageHeader, Panel, Provenance, Restricted, Skeleton, Tip } from "@/components/kit"
import { cn } from "@/lib/utils"

const HERO = "SYN-HERO-001"
type E = Record<string, any>

const SIGNALS: { key: string; label: string; agency: string }[] = [
  { key: "p1RepeatViolator", label: "Repeat WHD violator", agency: "WHD" },
  { key: "p2HighBackWages", label: "High back wages per employee", agency: "WHD" },
  { key: "p3H2aEmployerWithH2aViolation", label: "H-2A employer with H-2A violation", agency: "WHD" },
  { key: "p4WageBelowBenchmark", label: "Offered wage below QCEW benchmark", agency: "OFLC" },
  { key: "p5WillfulRepeatFta", label: "Willful, repeat or failure to abate", agency: "OSHA" },
  { key: "p6PenaltyReduced", label: "Penalty heavily reduced", agency: "OSHA" },
  { key: "p7PossibleUnderreporting", label: "Possible injury underreporting (ITA)", agency: "OSHA" },
  { key: "w1Misclassification", label: "1099 to W-2 misclassification", agency: "UI" },
  { key: "w3PossibleSuccessor", label: "Possible successor to debarred employer", agency: "UI" },
]
const AGENCY_COLOR: Record<string, string> = { WHD: "#0b2545", OSHA: "#d97706", OFLC: "#0e7c7b", UI: "#7c5cc4" }

function Bar({ label, value, max, color, hint }: { label: string; value: number; max: number; color: string; hint: string }) {
  return (
    <Tip content={hint}>
      <div className="grid grid-cols-[150px_1fr_80px] items-center gap-3 text-[12.5px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="h-2 rounded-full bg-[#f1f2f4]">
          <motion.span className="block h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${Math.min(100, (value / (max || 1)) * 100)}%` }} transition={{ duration: 0.7, ease: [0.25, 1, 0.5, 1] }} />
        </span>
        <span className="num text-right">{fmt.int(value)}</span>
      </div>
    </Tip>
  )
}

export default function EmployersPage() {
  const { persona } = usePersona()
  const sp = useSearchParams()
  const router = useRouter()
  const qc = useQueryClient()
  const id = sp.get("id") ?? HERO
  const [q, setQ] = useState("")
  const [translated, setTranslated] = useState(true)
  const list = useApi<E[]>(`/api/employers?q=${encodeURIComponent(q)}`, { staleTime: 60_000 })
  const d = useApi<E>(`/api/employers/${encodeURIComponent(id)}`, { staleTime: 30_000 })

  const refer = useMutation({
    mutationFn: (toAgency: string) =>
      api<{ saved: E }>("/api/actions", persona, {
        method: "POST",
        body: JSON.stringify({ kind: "employer-refer", employerId: id, toAgency, note: `Cross-agency referral from Employer 360 (${d.data?.employer?.displayId})` }),
      }),
    onSuccess: (r) => toast.success(`Referred to ${r.saved.toAgency}`, { description: `APP.REFERRALS ${String(r.saved.referralId).slice(0, 8)} status ${r.saved.status}` }),
    onError: (e) => toast.error("Referral failed", { description: (e as Error).message }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [`/api/employers/${encodeURIComponent(id)}`] })
      qc.invalidateQueries({ queryKey: ["/api/prevention"] })
    },
  })
  const flag = useMutation({
    mutationFn: () => api<{ saved: { claimsEscalated: number } }>("/api/actions", persona, { method: "POST", body: JSON.stringify({ kind: "employer-flag-claims", employerId: id }) }),
    onSuccess: (r) => toast.success(`${fmt.int(r.saved.claimsEscalated)} ex-worker claims escalated`, { description: "They now appear as Escalated in the intercept queue." }),
    onError: (e) => toast.error("Could not flag claims", { description: (e as Error).message }),
    onSettled: () => qc.invalidateQueries({ predicate: (qq) => String(qq.queryKey[0] ?? "").startsWith("/api/") }),
  })

  const restricted = list.error?.restricted || d.error?.restricted
  const e = d.data?.employer
  const ex = d.data?.exposure ?? {}

  return (
    <>
      <PageHeader
        eyebrow="Detect  /  Cross-agency employer risk"
        title="One employer, every agency's signal."
        sub="Entity resolution links WHD, OSHA, ITA, OFLC and Form 5500 records into one employer, so UI fraud tied to a bad actor is visible to every agency that can act."
      />
      {restricted ? (
        <Restricted persona={persona} reason={list.error?.message ?? d.error?.message} what="Employer Risk 360 (ANALYTICS.EMPLOYER_RISK_360)" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
          <Panel eyebrow="Employers" title="Cross-agency risk">
            <label className="mb-3 flex h-8 items-center gap-2 rounded-lg border border-hair px-2.5 text-[13px]">
              <Search className="size-3.5 text-muted-foreground" />
              <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Display ID number" className="flex-1 bg-transparent outline-none" inputMode="numeric" />
            </label>
            <div className="-mx-2 max-h-[640px] space-y-0.5 overflow-y-auto">
              {list.isLoading && Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="mx-2 h-11" />)}
              {list.data?.map?.((r) => (
                <button key={r.employerId} onClick={() => router.replace(`/employers?id=${encodeURIComponent(r.employerId)}`, { scroll: false })} className="relative w-full rounded-lg px-3 py-2 text-left hover:bg-muted/60">
                  {r.employerId === id && <motion.span layoutId="emp-active" className="absolute inset-0 rounded-lg border border-hair bg-[#f7f9fc]" />}
                  <span className="relative flex items-center justify-between">
                    <span className="text-[13px] font-medium">{r.displayId}</span>
                    <span className="num text-[12px] text-muted-foreground">{r.riskScore}</span>
                  </span>
                  <span className="relative flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {r.stateCode} {(r.agencyList ?? []).join(" + ")} {r.isSynthetic && <OriginBadge origin="SYNTHETIC" />}
                  </span>
                </button>
              ))}
            </div>
          </Panel>

          <AnimatePresence mode="wait">
            <motion.div key={id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="space-y-4">
              {d.isLoading && <Skeleton className="h-[600px]" />}
              {d.error && !d.error.restricted && <ErrorState message={d.error.message} onRetry={() => d.refetch()} />}
              {e && (
                <>
                  <div className="card relative overflow-hidden p-5">
                    <div className="dot-grid pointer-events-none absolute inset-0 opacity-50" />
                    <div className="relative flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <OriginBadge origin={e.isSynthetic ? "SYNTHETIC" : "PUBLIC"} />
                          {(e.agencyList ?? []).map((a: string) => (
                            <span key={a} className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold text-white" style={{ background: AGENCY_COLOR[a] ?? "#475467" }}>{a}</span>
                          ))}
                        </div>
                        <h2 className="text-[30px] font-medium tracking-[-0.04em]">{e.displayId}</h2>
                        <div className="mt-1 text-[13px] text-muted-foreground">
                          {e.city}, {e.stateCode}  NAICS <span className="mono">{e.naicsCode}</span>  Identity shown by Display ID only
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="eyebrow">Cross-agency risk score</div>
                        <div className={cn("num text-[48px] font-medium leading-none", e.riskScore >= 70 ? "text-amber" : "text-foreground")}>{e.riskScore}</div>
                        <div className="text-[12px] text-muted-foreground">{e.agenciesFlagged} agencies flag this employer</div>
                      </div>
                    </div>
                    <div className="relative mt-4 flex flex-wrap gap-2">
                      {["OIG", "WHD", "OSHA"].map((a) => (
                        <button key={a} disabled={refer.isPending} onClick={() => refer.mutate(a)} className={cn("flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-medium disabled:opacity-50", a === "OIG" ? "border-navy bg-navy text-white" : "border-hair bg-white hover:bg-muted")}>
                          <ArrowUpRight className="size-3.5" /> Refer to {a}
                        </button>
                      ))}
                      <button disabled={flag.isPending || !ex.flaggedClaims} onClick={() => flag.mutate()} className="flex h-8 items-center gap-1.5 rounded-full border border-[#f6e2bf] bg-amber-50 px-3.5 text-[12.5px] font-medium text-[#9a5b06] disabled:opacity-50">
                        <Flag className="size-3.5" /> Escalate {fmt.int(ex.flaggedClaims ?? 0)} flagged ex-worker claims
                      </button>
                      <Provenance origin="APP" source="APP.REFERRALS, APP.CASE_ACTIONS" note="Referrals and escalations are written back and confirmed by re-read." />
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-3">
                    <Panel eyebrow="WHD" title="Wage and Hour">
                      <div className="space-y-2.5">
                        <Bar label="Cases (5 yr)" value={e.whdCases5yr ?? 0} max={10} color="#0b2545" hint="ANALYTICS.EMPLOYER_RISK_360.WHD_CASES_5YR" />
                        <Bar label="Back wages" value={e.backWages ?? 0} max={Math.max(e.backWages ?? 0, 100000)} color="#0b2545" hint="Back wages assessed (USD)" />
                        <Bar label="Employees owed" value={e.employeesOwed ?? 0} max={Math.max(e.employeesOwed ?? 0, 50)} color="#0b2545" hint="Employees owed back wages" />
                      </div>
                    </Panel>
                    <Panel eyebrow="OSHA" title="Safety">
                      <div className="space-y-2.5">
                        <Bar label="Serious citations" value={e.serious ?? 0} max={10} color="#d97706" hint="Serious citations" />
                        <Bar label="Failure to abate" value={e.failureToAbate ?? 0} max={5} color="#d97706" hint="Failure-to-abate citations" />
                        <Bar label="Injury rate vs peers" value={Math.round(((e.itaTcr ?? 0) / (e.peerMedianTcr || 1)) * 100)} max={100} color="#d97706" hint="ITA TCR as % of NAICS peer median. Low with serious citations suggests underreporting." />
                      </div>
                    </Panel>
                    <Panel eyebrow="OFLC" title="Foreign labor">
                      <div className="space-y-2.5">
                        <Bar label="H-2 cases" value={e.oflcCases ?? 0} max={10} color="#0e7c7b" hint="OFLC H-2A/H-2B cases" />
                        <Bar label="Workers certified" value={e.workersCertified ?? 0} max={Math.max(e.workersCertified ?? 0, 100)} color="#0e7c7b" hint="Workers certified" />
                        <Bar label="Offer vs QCEW, %" value={Math.round((e.offerToBenchmark ?? 0) * 100)} max={100} color="#0e7c7b" hint="Offered hourly wage as % of QCEW industry benchmark" />
                      </div>
                    </Panel>
                  </div>

                  <div className="grid items-start gap-4 lg:grid-cols-[1.2fr_1fr]">
                    <Panel eyebrow="AI case brief" title="Precomputed with Cortex AI_COMPLETE" right={<OriginBadge origin="AI" />}>
                      {d.data?.brief?.restricted ? (
                        <p className="text-[13px] text-muted-foreground">Restricted for this persona.</p>
                      ) : d.data?.brief ? (
                        <>
                          <div className="space-y-2 whitespace-pre-wrap text-[13.5px] leading-relaxed">{String(d.data.brief.brief).replace(/\*\*/g, "")}</div>
                          <div className="mt-3 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                            <Sparkles className="size-3.5" /> {d.data.brief.model}, generated {fmt.date(d.data.brief.generatedAt)}. AI.EMPLOYER_CASE_BRIEF. Review before acting.
                          </div>
                        </>
                      ) : (
                        <p className="text-[13px] text-muted-foreground">No brief was generated for this employer. Briefs exist for the top 50 by risk.</p>
                      )}
                    </Panel>
                    <div className="space-y-4">
                      <Panel eyebrow="Risk signals" title="Why it scores">
                        <div className="space-y-1.5">
                          {SIGNALS.filter((s) => e[s.key]).map((s) => (
                            <div key={s.key} className="flex items-center gap-2 text-[12.5px]">
                              <span className="size-2 rounded-full" style={{ background: AGENCY_COLOR[s.agency] }} />
                              {s.label}
                              <span className="mono ml-auto text-[10.5px] text-muted-foreground">{s.agency}</span>
                            </div>
                          ))}
                          {(e.uiExworkerWorkingWhileClaiming ?? 0) > 0 && (
                            <div className="flex items-center gap-2 text-[12.5px]">
                              <span className="size-2 rounded-full bg-[#7c5cc4]" />
                              {fmt.int(e.uiExworkerWorkingWhileClaiming)} ex-workers flagged working while claiming
                            </div>
                          )}
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-[#fcfcfb] p-2.5 text-[11.5px]">
                          <div><div className="text-muted-foreground">Ex-worker claims</div><div className="num text-[15px]">{fmt.int(ex.exworkerClaims)}</div></div>
                          <div><div className="text-muted-foreground">Flagged</div><div className="num text-[15px] text-amber">{fmt.int(ex.flaggedClaims)}</div></div>
                          <div><div className="text-muted-foreground">Still to pay</div><div className="num text-[15px]">{fmt.usd(ex.exposure, false)}</div></div>
                        </div>
                      </Panel>
                      {d.data?.links?.length > 0 && (
                        <Panel eyebrow="Entity link" title="Predecessor and successor">
                          {d.data!.links.map((l: E) => (
                            <Link key={l.otherId} href={`/employers?id=${encodeURIComponent(l.otherId)}`} className="block rounded-lg border border-hair p-3 hover:bg-muted/50">
                              <div className="flex items-center gap-2 text-[13px] font-medium">
                                <GitBranch className="size-4 text-navy" />
                                {l.relation === "PREDECESSOR" ? "Possible successor of" : "Possible predecessor of"} {l.otherDisplayId}
                                <span className="num ml-auto text-[12px] text-muted-foreground">risk {l.otherRisk}</span>
                              </div>
                              <ul className="mt-2 space-y-0.5 text-[12px] text-muted-foreground">
                                {(l.evidence ?? []).map((ev: string) => <li key={ev}>{ev}</li>)}
                              </ul>
                            </Link>
                          ))}
                        </Panel>
                      )}
                      {!e.isSynthetic && <TimelinePanel d={d} e={e} />}
                    </div>
                  </div>

                  <div className={`grid items-start gap-4 ${e.isSynthetic ? "lg:grid-cols-2" : ""}`}>
                    {e.isSynthetic && (<Panel
                      eyebrow="Worker complaints"
                      title={`${Array.isArray(d.data?.complaints) ? d.data!.complaints.length : 0} complaints`}
                      right={
                        <div className="flex items-center gap-2">
                          <button onClick={() => setTranslated((t) => !t)} className="flex h-7 items-center gap-1.5 rounded-full border border-hair px-2.5 text-[11.5px] font-medium">
                            <Languages className="size-3.5" /> {translated ? "Showing English" : "Showing original"}
                          </button>
                          <Provenance origin="SYNTHETIC" source="AI.COMPLAINT_ENRICHED" note="AI_TRANSLATE, AI_CLASSIFY and AI_EXTRACT over synthetic complaints." />
                        </div>
                      }
                    >
                      {d.data?.complaints?.restricted ? (
                        <p className="text-[13px] text-muted-foreground">Restricted for this persona.</p>
                      ) : (
                        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                          {(d.data?.complaints ?? []).map((c: E) => (
                            <div key={c.complaintId} className="rounded-lg border border-hair p-3">
                              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                <span className="mono">{c.complaintId}</span>
                                <span>{fmt.date(c.receivedDate)}</span>
                                <span className="rounded bg-muted px-1.5">{c.language}</span>
                                <span>Route to <b className="text-foreground">{c.routeToAgency}</b></span>
                                {String(c.mentionsRetaliationOrCoercion).toLowerCase() === "yes" && <span className="text-alert">Retaliation</span>}
                              </div>
                              <p className="text-[13px] leading-relaxed">{translated ? c.englishText : c.originalText}</p>
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {(c.issueTypes ?? []).map((t: string) => <span key={t} className="rounded-full bg-[#f2f2f3] px-2 py-0.5 text-[10.5px]">{t}</span>)}
                              </div>
                            </div>
                          ))}
                          {(d.data?.complaints ?? []).length === 0 && <p className="text-[13px] text-muted-foreground">No complaints on file.</p>}
                        </div>
                      )}
                    </Panel>)}
                      <div className="space-y-4">
                      {!e.isSynthetic && (<Panel eyebrow="OSHA narratives" title="Accident abstracts" right={<Provenance origin="PUBLIC" source="AI.OSHA_NARRATIVE_ENRICHED" note="Public OSHA abstracts with AI-derived event type." />}>
                        {d.data?.narratives?.restricted ? (
                          <p className="text-[13px] text-muted-foreground">Restricted for this persona.</p>
                        ) : (d.data?.narratives ?? []).length === 0 ? (
                          <p className="text-[13px] text-muted-foreground">No OSHA accident abstracts matched to this employer.</p>
                        ) : (
                          <div className="max-h-[220px] space-y-2 overflow-y-auto">
                            {d.data!.narratives.map((n: E) => (
                              <div key={n.summaryNr} className="rounded-lg border border-hair p-3 text-[12.5px]">
                                <div className="mb-1 text-[11px] text-muted-foreground">{fmt.date(n.eventDate)}  {n.eventType}  {n.fatality ? "Fatality" : ""}</div>
                                <Abstract text={String(n.abstractText ?? "")} />
                              </div>
                            ))}
                          </div>
                        )}
                      </Panel>)}
                        {e.isSynthetic && <TimelinePanel d={d} e={e} />}
                      </div>
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </>
  )
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TimelinePanel({ d, e }: { d: any; e: any }) {
  return (
    <Panel eyebrow="Timeline" title="Enforcement events" right={<Provenance origin={e.isSynthetic ? "SYNTHETIC" : "PUBLIC"} source="WHD / OSHA / OFLC cases via CURATED.EMPLOYER_XREF" />}>
      <div className="max-h-[260px] overflow-y-auto overflow-x-hidden pl-1.5 pr-2">
      <ol className="relative space-y-3 border-l border-hair pl-4">
        {(d.data?.timeline ?? []).map((t: E, i: number) => (
          <motion.li key={i} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }} className="relative min-w-0 break-words text-[12.5px]">
            <span className="absolute -left-[21px] top-1 size-2.5 rounded-full border-2 border-white" style={{ background: AGENCY_COLOR[t.agency] ?? "#475467" }} />
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="num">{fmt.date(t.eventDate)}</span> <b className="text-foreground">{t.agency}</b> {t.tag && <span>{t.tag}</span>}
            </div>
            <div>{t.title}{t.amount ? <span className="num text-muted-foreground">  {fmt.usd(t.amount, false)}</span> : null}</div>
          </motion.li>
        ))}
        {(d.data?.timeline ?? []).length === 0 && <li className="text-[12.5px] text-muted-foreground">No enforcement events.</li>}
      </ol>
      </div>
      {(d.data?.referrals ?? []).length > 0 && (
        <div className="mt-3 border-t border-hair pt-3">
          <div className="eyebrow mb-1.5">Referrals from this app</div>
          {d.data!.referrals.map((r: E) => (
            <div key={r.referralId} className="flex justify-between text-[12px]"><span>{r.fromAgency} to <b>{r.toAgency}</b></span><span className="text-muted-foreground">{r.status}  {fmt.dateTime(r.createdAt)}</span></div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function Abstract({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const clean = text.replace(/\s+/g, " ").trim()
  let short = clean
  if (clean.length > 360) {
    const head = clean.slice(0, 360)
    const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "))
    short = end > 120 ? head.slice(0, end + 1) : head.slice(0, head.lastIndexOf(" ")) + "..."
  }
  const truncated = short !== clean
  return (
    <div>
      <p className="leading-relaxed">{open ? clean : short}</p>
      {truncated && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 text-[11.5px] font-medium text-navy hover:underline">
          {open ? "Show less" : "Read full abstract"}
        </button>
      )}
    </div>
  )
}
