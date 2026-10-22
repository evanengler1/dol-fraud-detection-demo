"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { motion } from "framer-motion"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Ban, ShieldCheck } from "lucide-react"
import { api, fmt, useApi, usePersona } from "@/lib/client"
import { ErrorState, PageHeader, Panel, Provenance, Restricted, Skeleton } from "@/components/kit"
import { ATTR_COLORS, RingGraph, type RingLink, type RingNode } from "@/components/ring-graph"
import { useClaimDrawer } from "@/components/claim-drawer"
import { cn } from "@/lib/utils"

interface Ring {
  ringId: string
  ringLabel: string
  linkType: string
  claimCount: number
  stateCount: number
  states: string[]
  totalPaid: number
  filingSpanHours: number
  firstFiled: string
  exposure: number
  heldExposure: number
  heldClaims: number
}

export default function RingsPage() {
  const { persona } = usePersona()
  const sp = useSearchParams()
  const router = useRouter()
  const qc = useQueryClient()
  const { openClaim } = useClaimDrawer()
  const rings = useApi<Ring[]>("/api/rings", { staleTime: 30_000 })
  const selected = sp.get("id") ?? (Array.isArray(rings.data) ? rings.data[0]?.ringId : undefined)
  const ring = rings.data?.find?.((r) => r.ringId === selected)
  const graph = useApi<{ nodes: RingNode[]; links: RingLink[] }>(selected ? `/api/rings/${selected}` : null, { staleTime: 30_000 })

  useEffect(() => {
    if (!sp.get("id") && selected) router.replace(`/rings?id=${selected}`, { scroll: false })
  }, [sp, selected, router])

  const hold = useMutation({
    mutationFn: () =>
      api<{ saved: { claimsHeld: number; dollarsIntercepted: number } }>("/api/actions", persona, {
        method: "POST",
        body: JSON.stringify({ kind: "ring-hold", ringId: selected, note: "Ring-wide hold from network view" }),
      }),
    onSuccess: (r) =>
      toast.success(`Held ${fmt.int(r.saved.claimsHeld)} claims in this ring`, {
        description: `${fmt.usd(r.saved.dollarsIntercepted, false)} in scheduled payments intercepted. Confirmed in APP.CASE_ACTIONS.`,
      }),
    onError: (e) => toast.error("Ring hold failed", { description: (e as Error).message }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["/api/rings"] })
      qc.invalidateQueries({ queryKey: [`/api/rings/${selected}`] })
      qc.invalidateQueries({ queryKey: ["/api/prevention"] })
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/claims") })
    },
  })

  const restricted = rings.error?.restricted || graph.error?.restricted
  const fullyHeld = ring && ring.exposure > 0 && ring.heldExposure >= ring.exposure

  return (
    <>
      <PageHeader
        eyebrow="Detect  /  Organized fraud"
        title="Break up rings, not just single claims."
        sub="Claims that share a bank account, device or phone form networks the Dynamic Tables surface within minutes. Hold every payment in a ring in one action."
      />
      {restricted ? (
        <Restricted persona={persona} reason={rings.error?.message ?? graph.error?.message} what="the claim link graph" />
      ) : rings.error ? (
        <ErrorState message={rings.error.message} onRetry={() => rings.refetch()} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
          <Panel eyebrow="Rings" title="5 or more linked claims" right={<Provenance origin="SYNTHETIC" source="ANALYTICS.DT_CLAIM_RING_STATS + DT_CLAIM_LINKS" note="Attribute values never leave the server; rings are addressed by an opaque hash and labeled with the last 4 characters." />}>
            <div className="-mx-2 space-y-1">
              {rings.isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
              {rings.data?.map?.((r) => (
                <button
                  key={r.ringId}
                  onClick={() => router.replace(`/rings?id=${r.ringId}`, { scroll: false })}
                  className={cn("relative w-full rounded-lg px-3 py-2.5 text-left", r.ringId === selected ? "" : "hover:bg-muted/60")}
                >
                  {r.ringId === selected && (
                    <motion.span layoutId="ring-active" className="absolute inset-0 rounded-lg border border-hair bg-[#f7f9fc]" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
                  )}
                  <span className="relative flex items-center gap-2">
                    <span className="size-2.5 rounded-[3px]" style={{ background: ATTR_COLORS[r.linkType] }} />
                    <span className="text-[13px] font-medium">{r.ringLabel}</span>
                    {r.heldClaims > 0 && <ShieldCheck className="ml-auto size-3.5 text-teal" />}
                  </span>
                  <span className="relative mt-1 flex gap-3 text-[11.5px] text-muted-foreground">
                    <span className="num">{r.claimCount} claims</span>
                    <span className="num">{r.stateCount} states</span>
                    <span className="num">{fmt.usd(r.totalPaid)} paid</span>
                  </span>
                </button>
              ))}
            </div>
          </Panel>

          <div className="space-y-4">
            {ring && (
              <motion.div key={ring.ringId} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 gap-3 md:grid-cols-5">
                {[
                  ["Claims", fmt.int(ring.claimCount)],
                  ["States spanned", `${ring.stateCount}  ${ring.states.join(" ")}`],
                  ["Paid to date", fmt.usd(ring.totalPaid, false)],
                  ["Filed within", `${fmt.int(ring.filingSpanHours)} hours`],
                  ["Still to pay", fmt.usd(ring.exposure - ring.heldExposure, false)],
                ].map(([l, v], i) => (
                  <div key={l} className="card p-3.5">
                    <div className="text-[11.5px] text-muted-foreground">{l}</div>
                    <div className={cn("num mt-1 text-[17px] font-medium", i === 4 && ring.exposure - ring.heldExposure > 0 && "text-amber")}>{v}</div>
                  </div>
                ))}
              </motion.div>
            )}
            <Panel
              eyebrow="Network"
              title={ring ? ring.ringLabel : "Select a ring"}
              right={
                ring && (
                  <button
                    disabled={hold.isPending || !!fullyHeld}
                    onClick={() => hold.mutate()}
                    className="flex h-9 items-center gap-2 rounded-full bg-navy px-4 text-[13px] font-medium text-white transition-colors duration-300 hover:bg-[#13315c] disabled:bg-teal"
                  >
                    {fullyHeld ? <ShieldCheck className="size-4" /> : <Ban className="size-4" />}
                    {fullyHeld ? "All payments held" : hold.isPending ? "Holding..." : "Hold all payments in ring"}
                  </button>
                )
              }
            >
              {graph.isLoading || !graph.data ? (
                <Skeleton className="h-[520px]" />
              ) : (
                <RingGraph nodes={graph.data.nodes} links={graph.data.links} onClaim={openClaim} />
              )}
              <div className="mt-3 flex flex-wrap items-center gap-4 text-[11.5px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-navy" />Flagged claim (size = priority)</span>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-amber" />Payments still scheduled</span>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-teal" />Payment held</span>
                {Object.entries(ATTR_COLORS).map(([k, c]) => (
                  <span key={k} className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: c }} />{k.replace("_", " ").toLowerCase()}</span>
                ))}
                <span className="ml-auto">Click a claim to open it</span>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </>
  )
}
