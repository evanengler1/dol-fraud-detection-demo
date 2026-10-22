"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ArrowUpRight,
  Ban,
  BadgeCheck,
  Fingerprint,
  Flag,
  ThumbsDown,
  ThumbsUp,
  UserPlus,
  X,
  CircleCheck,
} from "lucide-react"
import { api, fmt, useApi, usePersona } from "@/lib/client"
import {
  DetectionSource,
  ErrorState,
  MlScore,
  OriginBadge,
  PreventionStatus,
  Restricted,
  RuleFlag,
  Skeleton,
  Tip,
  ruleCodes,
} from "@/components/kit"
import { cn } from "@/lib/utils"

/* ---------- Drawer context (shared by intercept queue, rings and palette) ---------- */

const Ctx = createContext<{ openClaim: (id: string) => void; claimId: string | null; close: () => void }>({
  openClaim: () => {},
  claimId: null,
  close: () => {},
})
export const useClaimDrawer = () => useContext(Ctx)

export function ClaimDrawerProvider({ children }: { children: React.ReactNode }) {
  const [claimId, setClaimId] = useState<string | null>(null)
  const close = useCallback(() => setClaimId(null), [])
  return (
    <Ctx.Provider value={{ openClaim: setClaimId, claimId, close }}>
      {children}
      <ClaimDrawer claimId={claimId} onClose={close} />
    </Ctx.Provider>
  )
}

/* ---------- Write-back hook: optimistic update, then re-read to confirm ---------- */

export type ClaimAction = "HOLD_PAYMENT" | "REQUEST_ID_VERIFICATION" | "CLEAR" | "ESCALATE" | "ASSIGN" | "REFER_OIG"

const ACTION_STATUS: Record<ClaimAction, string> = {
  HOLD_PAYMENT: "HELD",
  REQUEST_ID_VERIFICATION: "VERIFYING",
  CLEAR: "CLEARED",
  ESCALATE: "ESCALATED",
  ASSIGN: "ASSIGNED",
  REFER_OIG: "REFERRED",
}
const ACTION_TOAST: Record<ClaimAction, string> = {
  HOLD_PAYMENT: "Payment hold recorded",
  REQUEST_ID_VERIFICATION: "ID verification requested",
  CLEAR: "Claim cleared and released",
  ESCALATE: "Claim escalated",
  ASSIGN: "Claim assigned",
  REFER_OIG: "Referred to OIG",
}

type ClaimsPage = { rows: Record<string, unknown>[] } & Record<string, unknown>

export function useClaimAction() {
  const { persona } = usePersona()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { claimId: string; action: ClaimAction; note?: string }) =>
      api<{ saved: Record<string, unknown> }>("/api/actions", persona, {
        method: "POST",
        body: JSON.stringify({ kind: "claim", ...v }),
      }),
    onMutate: async (v) => {
      const status = ACTION_STATUS[v.action]
      await qc.cancelQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/claims") })
      const snapshots = qc.getQueriesData<ClaimsPage>({
        predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/claims?"),
      })
      for (const [key, data] of snapshots) {
        if (!data?.rows) continue
        qc.setQueryData(key, {
          ...data,
          rows: data.rows.map((r) => (r.claimId === v.claimId ? { ...r, preventionStatus: status } : r)),
        })
      }
      const detailKey = [`/api/claims/${v.claimId}`, persona]
      const detail = qc.getQueryData<Record<string, any>>(detailKey)
      if (detail?.prevention) qc.setQueryData(detailKey, { ...detail, prevention: { ...detail.prevention, status } })
      return { snapshots, detailKey, detail }
    },
    onError: (err, _v, ctx) => {
      ctx?.snapshots.forEach(([k, d]) => qc.setQueryData(k, d))
      if (ctx?.detail) qc.setQueryData(ctx.detailKey, ctx.detail)
      toast.error("Write-back failed", { description: (err as Error).message })
    },
    onSuccess: (res, v) => {
      const s = res.saved ?? {}
      toast.success(ACTION_TOAST[v.action], {
        description: `Confirmed in APP.CASE_ACTIONS as ${String(s.actedRole ?? persona)} at ${fmt.dateTime(s.actedAt)}`,
      })
    },
    onSettled: (_r, _e, v) => {
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/claims") })
      qc.invalidateQueries({ queryKey: ["/api/prevention"] })
      qc.invalidateQueries({ queryKey: [`/api/claims/${v.claimId}`] })
    },
  })
}

function useFeedback() {
  const { persona } = usePersona()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { claimId: string; label: "CONFIRMED_FRAUD" | "NOT_FRAUD" }) =>
      api<{ saved: Record<string, unknown> }>("/api/actions", persona, {
        method: "POST",
        body: JSON.stringify({ kind: "feedback", ...v }),
      }),
    onSuccess: (res) =>
      toast.success("Model feedback saved", {
        description: `APP.MODEL_FEEDBACK: ${String(res.saved?.analystLabel)} at ${fmt.dateTime(res.saved?.createdAt)}`,
      }),
    onError: (err) => toast.error("Feedback failed", { description: (err as Error).message }),
    onSettled: (_r, _e, v) => qc.invalidateQueries({ queryKey: [`/api/claims/${v.claimId}`] }),
  })
}

/* ---------- Drawer ---------- */

interface ClaimDetail {
  notFound?: boolean
  claim: Record<string, any>
  identity: Record<string, any> | { restricted: true } | null
  links: Record<string, any>[] | { restricted: true }
  features: Record<string, any> | { restricted: true } | null
  importance: { rank: number; feature: string; score: number; featureType: string }[]
  prevention: { status: string; exposure: number; pendingPayments: number; nextPayment: string | null }
  history: Record<string, any>[]
}

const isRestricted = (v: unknown): v is { restricted: true } =>
  !!v && typeof v === "object" && (v as { restricted?: boolean }).restricted === true

function FieldRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hair py-1.5 text-[13px] last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right", mono && "mono text-[12px]")}>{value ?? "n/a"}</span>
    </div>
  )
}

const FEATURE_TO_COL: Record<string, string> = {}
function featureValue(features: Record<string, any>, feature: string) {
  const key = (FEATURE_TO_COL[feature] ?? feature).toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
  const v = features?.[key]
  if (v === undefined) return null
  if (typeof v === "boolean") return v ? "Yes" : "No"
  return typeof v === "number" ? fmt.int(Math.round(v * 100) / 100) : String(v)
}

function ClaimDrawer({ claimId, onClose }: { claimId: string | null; onClose: () => void }) {
  const { persona } = usePersona()
  const { openClaim } = useClaimDrawer()
  const q = useApi<ClaimDetail>(claimId ? `/api/claims/${claimId}` : null)
  const act = useClaimAction()
  const fb = useFeedback()

  useEffect(() => {
    if (!claimId) return
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", on)
    return () => window.removeEventListener("keydown", on)
  }, [claimId, onClose])

  const d = q.data
  const c = d?.claim
  const status = d?.prevention.status ?? "OPEN"
  const run = (action: ClaimAction) => claimId && act.mutate({ claimId, action })

  return (
    <AnimatePresence>
      {claimId && (
        <>
          <motion.div
            className="fixed inset-0 z-[60] bg-black/10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
            className="fixed bottom-2 right-2 top-2 z-[70] flex w-[560px] max-w-[96vw] flex-col overflow-hidden rounded-xl border border-hair bg-white"
            style={{ boxShadow: "var(--shadow-raise)" }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-hair px-5 py-4">
              <div>
                <div className="eyebrow mb-1 flex items-center gap-2">
                  Claim <OriginBadge origin="SYNTHETIC" />
                </div>
                <div className="mono text-[20px] font-medium tracking-[-0.02em]">{claimId}</div>
                {c && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                    <span className="mono">{c.stateCode}</span>
                    <span>Filed {fmt.date(c.filedTs)}</span>
                    <span>Last employer {c.lastEmployerDisplayId ?? "n/a"}</span>
                  </div>
                )}
              </div>
              <button onClick={onClose} className="rounded-md p-1.5 hover:bg-muted" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {q.isLoading && (
                <div className="space-y-3">
                  <Skeleton className="h-28" />
                  <Skeleton className="h-40" />
                  <Skeleton className="h-52" />
                </div>
              )}
              {q.error?.restricted && <Restricted persona={persona} reason={q.error.message} what="claim records" />}
              {q.error && !q.error.restricted && <ErrorState message={q.error.message} onRetry={() => q.refetch()} />}
              {d?.notFound && (
                <ErrorState message={`${claimId} is not a current claim, or it is outside this persona's row access.`} />
              )}
              {d && c && (
                <div className="space-y-5">
                  {/* Prevention */}
                  <section className="rounded-xl border border-hair bg-[#fcfcfb] p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="eyebrow">Prevention</div>
                      <PreventionStatus status={status} />
                    </div>
                    <div className="mb-4 grid grid-cols-3 gap-3">
                      <div>
                        <div className="text-[11.5px] text-muted-foreground">Still to be paid</div>
                        <div className={cn("num text-[22px] font-medium", d.prevention.exposure > 0 && status === "OPEN" && "text-amber")}>
                          {fmt.usd(d.prevention.exposure, false)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11.5px] text-muted-foreground">Scheduled payments</div>
                        <div className="num text-[22px] font-medium">{d.prevention.pendingPayments}</div>
                      </div>
                      <div>
                        <div className="text-[11.5px] text-muted-foreground">Next release</div>
                        <div className="num text-[15px] font-medium leading-[33px]">{fmt.date(d.prevention.nextPayment)}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <ActionButton primary icon={Ban} label="Hold payment" kbd="h" onClick={() => run("HOLD_PAYMENT")} busy={act.isPending} />
                      <ActionButton icon={Fingerprint} label="Request ID verification" kbd="v" onClick={() => run("REQUEST_ID_VERIFICATION")} busy={act.isPending} />
                      <ActionButton icon={Flag} label="Escalate" kbd="e" onClick={() => run("ESCALATE")} busy={act.isPending} />
                      <ActionButton icon={ArrowUpRight} label="Refer to OIG" onClick={() => run("REFER_OIG")} busy={act.isPending} />
                      <ActionButton icon={UserPlus} label="Assign to me" onClick={() => run("ASSIGN")} busy={act.isPending} />
                      <ActionButton icon={CircleCheck} label="Clear and release" kbd="c" onClick={() => run("CLEAR")} busy={act.isPending} />
                    </div>
                    <p className="mt-3 text-[11.5px] text-muted-foreground">
                      Writes to APP.CASE_ACTIONS (Refer also writes APP.REFERRALS) with ACTED_ROLE = {persona}. Each write is
                      confirmed by re-reading the table.
                    </p>
                  </section>

                  {/* Detection */}
                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="eyebrow">Detection</div>
                      <DetectionSource value={c.detectionSource} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-hair p-3">
                        <div className="mb-2 text-[12px] font-medium">Rule flags</div>
                        <div className="flex flex-col items-start gap-1.5">
                          {ruleCodes(c).length ? (
                            ruleCodes(c).map((r) => <RuleFlag key={r} code={r} />)
                          ) : (
                            <span className="text-[12px] text-muted-foreground">No rule fired</span>
                          )}
                        </div>
                        {Array.isArray(c.ruleReasons) && c.ruleReasons.length > 0 && (
                          <ul className="mt-2 space-y-1 text-[11.5px] text-muted-foreground">
                            {c.ruleReasons.map((r: string) => (
                              <li key={r}>{r}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="rounded-xl border border-hair p-3">
                        <div className="mb-2 flex items-center justify-between text-[12px] font-medium">
                          ML score
                          <span className="flex gap-1">
                            <Tip content="Confirm fraud: writes APP.MODEL_FEEDBACK for retraining">
                              <button
                                className="rounded-md border border-hair p-1 hover:bg-muted"
                                onClick={() => claimId && fb.mutate({ claimId, label: "CONFIRMED_FRAUD" })}
                                aria-label="Confirm fraud"
                              >
                                <ThumbsUp className="size-3.5" />
                              </button>
                            </Tip>
                            <Tip content="Not fraud: writes APP.MODEL_FEEDBACK for retraining">
                              <button
                                className="rounded-md border border-hair p-1 hover:bg-muted"
                                onClick={() => claimId && fb.mutate({ claimId, label: "NOT_FRAUD" })}
                                aria-label="Not fraud"
                              >
                                <ThumbsDown className="size-3.5" />
                              </button>
                            </Tip>
                          </span>
                        </div>
                        <MlScore p={c.mlFraudProbability} width={140} />
                        <div className="mt-3 text-[11.5px] text-muted-foreground">
                          Priority score <span className="num text-foreground">{Math.round(c.priorityScore)}</span> of 100
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Feature importance */}
                  <section>
                    <div className="eyebrow mb-2">What drives the model</div>
                    <div className="rounded-xl border border-hair p-3">
                      {d.importance.slice(0, 8).map((f) => {
                        const max = d.importance[0]?.score || 1
                        const val = !isRestricted(d.features) && d.features ? featureValue(d.features, f.feature) : null
                        return (
                          <div key={f.feature} className="grid grid-cols-[1fr_120px_70px] items-center gap-3 py-1 text-[12px]">
                            <span className="mono truncate text-[11px]">{f.feature}</span>
                            <span className="h-1.5 rounded-full bg-[#eef0f3]">
                              <motion.span
                                className="block h-full rounded-full bg-navy/70"
                                initial={{ width: 0 }}
                                animate={{ width: `${(f.score / max) * 100}%` }}
                                transition={{ duration: 0.6, ease: [0.25, 1, 0.5, 1] }}
                              />
                            </span>
                            <span className="num text-right text-muted-foreground">{val ?? ""}</span>
                          </div>
                        )
                      })}
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Global importance from ML.CLAIM_MODEL_FEATURE_IMPORTANCE; right column is this claim&apos;s value
                        from DT_CLAIM_FEATURES.
                      </p>
                    </div>
                  </section>

                  {/* Identity, masked by policy */}
                  <section>
                    <div className="eyebrow mb-2 flex items-center gap-2">
                      Claimant identity <span className="normal-case tracking-normal">(masked by policy for {persona})</span>
                    </div>
                    {isRestricted(d.identity) ? (
                      <div className="rounded-xl border border-dashed border-hair p-4 text-[12.5px] text-muted-foreground">
                        This persona has no grant on RAW_SYNTH claimant tables. Identity fields are withheld by Snowflake RBAC.
                      </div>
                    ) : d.identity ? (
                      <div className="rounded-xl border border-hair px-3 py-1">
                        <FieldRow label="SSN" value={d.identity.ssn} mono />
                        <FieldRow label="Name" value={`${d.identity.firstName ?? ""} ${d.identity.lastName ?? ""}`} />
                        <FieldRow label="Date of birth" value={fmt.date(d.identity.dob)} />
                        <FieldRow label="Bank account" value={d.identity.bankAccount} mono />
                        <FieldRow label="Email" value={d.identity.email} />
                        <FieldRow label="Phone" value={d.identity.phone} mono />
                        <FieldRow
                          label="Identity verified"
                          value={d.identity.identityVerified ? <BadgeCheck className="ml-auto size-4 text-teal" /> : "No"}
                        />
                        <FieldRow label="Weekly benefit" value={fmt.usd(d.identity.weeklyBenefitAmt, false)} />
                      </div>
                    ) : null}
                  </section>

                  {/* Linked claims */}
                  <section>
                    <div className="eyebrow mb-2">Linked claims</div>
                    {isRestricted(d.links) ? (
                      <div className="text-[12.5px] text-muted-foreground">Link graph restricted for this persona.</div>
                    ) : d.links.length === 0 ? (
                      <div className="text-[12.5px] text-muted-foreground">No shared bank, device, IP, phone or email.</div>
                    ) : (
                      <div className="divide-y divide-hair rounded-xl border border-hair">
                        {d.links.map((l) => (
                          <button
                            key={`${l.linkedClaimId}-${l.linkType}`}
                            onClick={() => openClaim(l.linkedClaimId)}
                            className="grid w-full grid-cols-[110px_1fr_auto_60px] items-center gap-3 px-3 py-2 text-left text-[12px] hover:bg-muted/60"
                          >
                            <span className="mono">{l.linkedClaimId}</span>
                            <span className="text-muted-foreground">Shares {String(l.linkType).toLowerCase().replace("_", " ")}</span>
                            {l.detectionSource ? <DetectionSource value={l.detectionSource} /> : <span />}
                            <span className="mono text-right">{l.stateCode}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* History */}
                  <section>
                    <div className="eyebrow mb-2">Audit trail</div>
                    {d.history.length === 0 ? (
                      <div className="text-[12.5px] text-muted-foreground">No actions yet. Every action is logged with user and role.</div>
                    ) : (
                      <ol className="space-y-2">
                        {d.history.map((h, i) => (
                          <motion.li
                            key={`${h.action}-${h.actedAt}-${i}`}
                            initial={{ opacity: 0, x: -4 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="flex items-start gap-3 text-[12px]"
                          >
                            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-navy" />
                            <span className="flex-1">
                              <span className="mono">{h.action}</span>
                              {h.note && <span className="text-muted-foreground"> {h.note}</span>}
                            </span>
                            <span className="text-muted-foreground">
                              {h.actedRole && <span className="mono mr-2 text-[10.5px]">{h.actedRole}</span>}
                              {fmt.dateTime(h.actedAt)}
                            </span>
                          </motion.li>
                        ))}
                      </ol>
                    )}
                  </section>
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  primary,
  kbd,
  busy,
}: {
  icon: typeof Ban
  label: string
  onClick: () => void
  primary?: boolean
  kbd?: string
  busy?: boolean
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      disabled={busy}
      onClick={onClick}
      className={cn(
        "flex h-9 items-center gap-2 rounded-lg border px-3 text-[12.5px] font-medium transition-colors duration-300 disabled:opacity-60",
        primary ? "border-navy bg-navy text-white hover:bg-[#13315c]" : "border-hair bg-white hover:bg-muted",
      )}
      style={{ transitionTimingFunction: "cubic-bezier(.25,1,.5,1)" }}
    >
      <Icon className="size-3.5" />
      {label}
      {kbd && <span className={cn("kbd ml-auto", primary && "border-white/20 bg-white/10 text-white/80")}>{kbd}</span>}
    </motion.button>
  )
}
