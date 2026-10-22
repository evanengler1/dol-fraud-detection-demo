"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowRight, ShieldCheck } from "lucide-react"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts"
import { fmt, useApi, usePersona } from "@/lib/client"
import { CountUp, ErrorState, Kpi, PageHeader, Panel, Provenance, Restricted, Skeleton, Tip } from "@/components/kit"
import { SurgeMap, type SurgeRow } from "@/components/surge-map"
import { cn } from "@/lib/utils"

type Kpis = Record<string, number | string>
type Prevention = Record<string, number | null>
type Forecast = {
  rows: { quarterEnding: string; actual: number | null; forecast: number | null; lowerBound: number | null; upperBound: number | null }[]
  states: string[]
}

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } }

function KpiGrid() {
  const { data, isLoading, error, refetch } = useApi<Kpis>("/api/kpis", { staleTime: 60_000 })
  if (isLoading) return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[118px]" />)}</div>
  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />
  const k = data!
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Kpi label={`Fraud overpayments, ${new Date().getFullYear() - 1}`} value={Number(k.publicFraudOpLastFullYear)} format={(n) => fmt.usd(n)} origin="PUBLIC" source="ETA 227 via ANALYTICS.DT_STATE_UI_BASELINE" note="Established fraud overpayments, all states, last full year." sub="ETA 227, all states" />
      <Kpi label="BAM fraud rate peak" value={Number(k.publicBamPeakFraudRate)} format={(n) => fmt.pct(n, 2)} origin="PUBLIC" source="BAM / PIIA via CURATED.BAM_INTEGRITY_RATES" note="National peak, 2020 Q4." sub="National, 2020 Q4" tone="alert" />
      <Kpi label="SEVERE surge weeks" value={Number(k.publicSevereSurgeWeeks)} format={(n) => fmt.int(n)} origin="DERIVED" source="Cortex ANOMALY_DETECTION on ETA 539, ML.V_CLAIMS_SURGE_ALERTS" sub="State-weeks above forecast band" />
      <Kpi label="Cross-agency employers" value={Number(k.publicCrossAgencyEmployers)} format={(n) => fmt.int(n)} origin="DERIVED" source="ANALYTICS.EMPLOYER_RISK_360 (AGENCIES_FLAGGED >= 2, real employers)" note="Risk signals from 2+ of WHD, OSHA, OFLC." sub={`of ${fmt.compact(k.publicResolvedEmployers)} resolved employers`} />
      <Kpi label="Flagged claims" value={Number(k.synthFlaggedClaims)} format={(n) => fmt.int(n)} origin="SYNTHETIC" source="ANALYTICS.V_CLAIM_RISK (PRIORITY_SCORE >= 50)" sub={`of ${fmt.int(k.synthCurrentClaims)} current claims`} tone="alert" />
      <Kpi label="Paid on flagged claims" value={Number(k.synthDollarsAtRisk)} format={(n) => fmt.usd(n)} origin="SYNTHETIC" source="ANALYTICS.V_CLAIM_RISK AMOUNT_PAID where PRIORITY_SCORE >= 50" note="Already paid out: recovery target. See the intercept queue for what can still be stopped." sub="Recovery target" />
      <Kpi label="ML-only catches" value={Number(k.synthMlOnlyCatches)} format={(n) => fmt.int(n)} origin="SYNTHETIC" source="V_CLAIM_RISK DETECTION_SOURCE = ML_ONLY" note="Claims no rule flagged that the classifier caught." sub="Missed by every rule" />
      <Kpi label="Fraud rings" value={Number(k.synthRings)} format={(n) => fmt.int(n)} origin="SYNTHETIC" source="ANALYTICS.DT_CLAIM_RING_STATS (5+ claims sharing an attribute)" sub="Shared bank, device or phone" />
    </motion.div>
  )
}

function PreventionPanel() {
  const { persona } = usePersona()
  const { data, isLoading, error } = useApi<Prevention>("/api/prevention", { staleTime: 10_000 })
  if (error?.restricted) return <Restricted persona={persona} reason={error.message} what="claim prevention data" />
  if (isLoading || !data) return <Skeleton className="h-[320px]" />
  const p = data
  const n = (k: string) => Number(p[k] ?? 0)
  const funnel = [
    { label: "Scored", value: n("scored"), hint: "Every current claim scored by rules and ML" },
    { label: "Flagged", value: n("flagged"), hint: "Any rule fired or ML probability >= 50%" },
    { label: "Interceptable", value: n("interceptable"), hint: "Flagged with scheduled payments still to release" },
    { label: "Actioned", value: n("actioned"), hint: "Any analyst decision in APP.CASE_ACTIONS" },
    { label: "Held", value: n("held"), hint: "Latest action is a payment hold" },
    { label: "Referred", value: n("referredClaims") + n("openReferrals"), hint: "Referred to OIG or another agency" },
  ]
  const max = funnel[0].value || 1
  const exposed = n("dollarsStillExposed")
  const prevented = n("dollarsPrevented")
  const total = exposed + prevented || 1
  return (
    <Panel
      eyebrow="Prevention"
      title="Stopping money before it leaves"
      right={<Provenance origin="SYNTHETIC" source="APP.CASE_ACTIONS + RAW_SYNTH.UI_PAYMENT (future weeks) + V_CLAIM_RISK" note="Prevented = scheduled payments on claims whose latest action is a hold. Starts at zero and grows as analysts act." />}
    >
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[12px] text-muted-foreground">Dollars prevented</div>
              <div className="num text-[40px] font-medium leading-tight text-teal">
                <CountUp value={prevented} format={(v) => fmt.usd(v, false)} />
              </div>
            </div>
            <div>
              <div className="text-[12px] text-muted-foreground">Still exposed on open flagged claims</div>
              <div className="num text-[40px] font-medium leading-tight text-amber">
                <CountUp value={exposed} format={(v) => fmt.usd(v, false)} />
              </div>
            </div>
          </div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-amber-50">
            <motion.div
              className="h-full rounded-full bg-teal"
              initial={{ width: 0 }}
              animate={{ width: `${(prevented / total) * 100}%` }}
              transition={{ duration: 0.9, ease: [0.25, 1, 0.5, 1] }}
            />
          </div>
          <div className="mt-5 grid grid-cols-4 gap-3 text-[12px]">
            {[
              ["Payments held", n("held")],
              ["ID checks", n("verifying")],
              ["Cleared", n("cleared")],
              ["Referrals", n("referrals")],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-lg border border-hair p-2.5">
                <div className="text-muted-foreground">{l}</div>
                <div className="num text-[18px] font-medium">{fmt.int(v)}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-lg bg-[#fcfcfb] px-3 py-2.5 text-[12.5px]">
            <span className="text-muted-foreground">
              Median time from filing to action{" "}
              <span className="num text-foreground">{p.medianHoursToAction != null ? `${fmt.int(p.medianHoursToAction)} h` : "n/a"}</span>
            </span>
            <Link href="/intercept" prefetch className="flex items-center gap-1 font-medium text-navy hover:underline">
              Open intercept queue <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
        <div>
          <div className="mb-2 text-[12px] font-medium">Detection to prevention funnel</div>
          <div className="space-y-2">
            {funnel.map((f, i) => (
              <Tip key={f.label} content={f.hint}>
                <div className="grid grid-cols-[96px_1fr_64px] items-center gap-3 text-[12.5px]">
                  <span className="text-muted-foreground">{f.label}</span>
                  <span className="h-6 rounded-md bg-[#f4f5f7]">
                    <motion.span
                      className={cn("block h-full rounded-md", i < 2 ? "bg-[#c9d5e3]" : i < 3 ? "bg-amber/70" : "bg-teal")}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(1.5, (Math.log10(f.value + 1) / Math.log10(max + 1)) * 100)}%` }}
                      transition={{ duration: 0.7, delay: i * 0.06, ease: [0.25, 1, 0.5, 1] }}
                    />
                  </span>
                  <span className="num text-right">{fmt.int(f.value)}</span>
                </div>
              </Tip>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11.5px]">
            <div className="rounded-lg border border-hair p-2"><div className="text-muted-foreground">Rule only</div><div className="num text-[15px]">{fmt.int(n("rulesOnly"))}</div></div>
            <div className="rounded-lg border border-hair p-2"><div className="text-muted-foreground">Both</div><div className="num text-[15px]">{fmt.int(n("both"))}</div></div>
            <div className="rounded-lg border border-[#f6e2bf] bg-amber-50 p-2"><div className="text-[#9a5b06]">ML only</div><div className="num text-[15px]">{fmt.int(n("mlOnly"))}</div></div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Funnel bars use a log scale.</p>
        </div>
      </div>
    </Panel>
  )
}

function ForecastPanel() {
  const { data, isLoading } = useApi<Forecast>("/api/forecast", { staleTime: 300_000 })
  const rows = (data?.rows ?? []).map((r) => ({
    q: r.quarterEnding.slice(0, 7),
    actual: r.actual,
    forecast: r.forecast,
    band: r.lowerBound != null && r.upperBound != null ? [Math.max(0, r.lowerBound), r.upperBound] : null,
  }))
  return (
    <Panel
      eyebrow="Outlook"
      title="Fraud overpayment dollars and forecast"
      right={<Provenance origin="DERIVED" source="ETA 227 actuals (DT_STATE_UI_BASELINE) + Cortex FORECAST (ML.FRAUD_OP_FORECAST)" note={`Summed over forecast states: ${(data?.states ?? []).join(", ")}. Band is the forecast prediction interval.`} />}
    >
      {isLoading ? (
        <Skeleton className="h-[280px]" />
      ) : (
        <div className="h-[280px]">
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="q" tick={{ fontSize: 11, fill: "#6b6b70" }} tickLine={false} axisLine={false} interval={3} />
              <YAxis tickFormatter={(v) => fmt.usd(v)} tick={{ fontSize: 11, fill: "#6b6b70" }} tickLine={false} axisLine={false} width={64} />
              <RTooltip
                formatter={(v: unknown, name) => [Array.isArray(v) ? `${fmt.usd(v[0])} to ${fmt.usd(v[1])}` : fmt.usd(v), name]}
                contentStyle={{ borderRadius: 8, border: "1px solid #eaeaea", fontSize: 12 }}
              />
              <Area dataKey="band" name="Forecast interval" stroke="none" fill="#0e7c7b" fillOpacity={0.12} isAnimationActive />
              <Line dataKey="actual" name="Actual (ETA 227)" stroke="#9fb3c8" strokeWidth={1.8} dot={false} connectNulls={false} />
              <Line dataKey="forecast" name="Forecast" stroke="#0e7c7b" strokeWidth={2.2} strokeDasharray="4 3" dot={{ r: 2.5 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-2 flex gap-4 text-[11.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[#9fb3c8]" />Actual</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed border-teal" />Forecast</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-teal/15" />Interval</span>
      </div>
    </Panel>
  )
}

function MapPanel() {
  const { data, isLoading } = useApi<SurgeRow[]>("/api/surge-map", { staleTime: 300_000 })
  return (
    <Panel
      eyebrow="Early warning"
      title="Where claim surges broke the forecast"
      right={<Provenance origin="DERIVED" source="Cortex ANOMALY_DETECTION on ETA 539 (ML.V_CLAIMS_SURGE_ALERTS) + DT_STATE_UI_BASELINE" note="Shading = count of SEVERE state-weeks since 2020." />}
    >
      {isLoading || !data ? <Skeleton className="h-[340px]" /> : <SurgeMap rows={data} />}
    </Panel>
  )
}

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        eyebrow="Overview  /  Unemployment insurance integrity"
        title={
          <>
            Fraud detection and prevention,
            <br />
            <span className="text-muted-foreground">from first claim to final referral.</span>
          </>
        }
        sub="Rules and machine learning score every claim as it lands. Analysts hold suspect payments before release, break up rings, and refer cross-agency employers to OIG, WHD and OSHA."
        right={
          <Link
            href="/intercept"
            prefetch
            className="flex h-10 items-center gap-2 rounded-full bg-navy px-5 text-[13.5px] font-medium text-white transition-colors duration-300 hover:bg-[#13315c]"
          >
            <ShieldCheck className="size-4" /> Review payments to intercept
          </Link>
        }
      />
      <div className="space-y-4">
        <KpiGrid />
        <PreventionPanel />
        <div className="grid gap-4 xl:grid-cols-2">
          <MapPanel />
          <ForecastPanel />
        </div>
      </div>
    </>
  )
}
