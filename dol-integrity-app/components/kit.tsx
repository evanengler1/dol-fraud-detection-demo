"use client"

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion"
import * as Tooltip from "@radix-ui/react-tooltip"
import { Info, Lock, ShieldAlert, ShieldCheck, ShieldQuestion, TriangleAlert } from "lucide-react"
import { memo, useEffect } from "react"
import { cn } from "@/lib/utils"
import { PERSONA_META, type Persona } from "@/lib/personas"

/* ---------- Tooltip ---------- */

export function Tip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <Tooltip.Root delayDuration={150}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="z-[100] max-w-xs rounded-md border border-hair bg-white px-3 py-2 text-[12px] leading-relaxed text-foreground"
          style={{ boxShadow: "var(--shadow-pop)" }}
        >
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/* ---------- Provenance ---------- */

export type Origin = "PUBLIC" | "SYNTHETIC" | "DERIVED" | "AI" | "APP"

const ORIGIN_STYLE: Record<Origin, string> = {
  PUBLIC: "bg-[#eef3fa] text-[#13315c] border-[#d9e3f2]",
  SYNTHETIC: "bg-[#f6f1ff] text-[#5b3fa6] border-[#e6dcfb]",
  DERIVED: "bg-teal-50 text-teal border-[#cfe9e7]",
  AI: "bg-[#fff7ea] text-[#9a5b06] border-[#f6e2bf]",
  APP: "bg-[#f2f2f3] text-[#344054] border-[#e4e4e7]",
}
const ORIGIN_LABEL: Record<Origin, string> = { PUBLIC: "Public", SYNTHETIC: "Synthetic", DERIVED: "Derived", AI: "AI generated", APP: "App write-back" }

export function OriginBadge({ origin }: { origin: Origin }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-2 text-[10.5px] font-medium tracking-wide",
        ORIGIN_STYLE[origin],
      )}
    >
      {ORIGIN_LABEL[origin]}
    </span>
  )
}

export function Provenance({ origin, source, note }: { origin: Origin; source: string; note?: string }) {
  return (
    <Tip
      content={
        <div className="space-y-1">
          <div className="eyebrow">Provenance</div>
          <div className="mono text-[11px] text-foreground">{source}</div>
          {note && <div className="text-muted-foreground">{note}</div>}
          {origin === "SYNTHETIC" && (
            <div className="text-muted-foreground">Synthetic records. Not real people or businesses.</div>
          )}
        </div>
      }
    >
      <button type="button" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
        <OriginBadge origin={origin} />
        <Info className="size-3.5" />
      </button>
    </Tip>
  )
}

/* ---------- Card ---------- */

export function Panel({
  title,
  eyebrow,
  right,
  children,
  className,
}: {
  title?: React.ReactNode
  eyebrow?: React.ReactNode
  right?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("card card-hover p-5", className)}>
      {(title || right || eyebrow) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
            {title && <h2 className="text-[15px] font-medium tracking-[-0.01em]">{title}</h2>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

/* ---------- Count up ---------- */

export const CountUp = memo(function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = useReducedMotion()
  const mv = useMotionValue(reduce ? value : 0)
  // Integers stay integers mid-animation; fractional values (rates) keep their precision
  const integral = Number.isInteger(value)
  const text = useTransform(mv, (v) => format(integral ? Math.round(v) : v))
  useEffect(() => {
    if (reduce) {
      mv.set(value)
      return
    }
    const c = animate(mv, value, { duration: 1.1, ease: [0.25, 1, 0.5, 1] })
    return () => c.stop()
  }, [value, reduce, mv])
  return <motion.span className="num">{text}</motion.span>
})

export function Kpi({
  label,
  value,
  format,
  origin,
  source,
  note,
  tone = "default",
  sub,
}: {
  label: string
  value: number
  format: (n: number) => string
  origin: Origin
  source: string
  note?: string
  tone?: "default" | "alert" | "good"
  sub?: React.ReactNode
}) {
  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="card card-hover flex flex-col justify-between gap-3 p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
        <Provenance origin={origin} source={source} note={note} />
      </div>
      <div
        className={cn(
          "text-[30px] font-medium leading-none",
          tone === "alert" && "text-amber",
          tone === "good" && "text-teal",
        )}
      >
        <CountUp value={value} format={format} />
      </div>
      {sub && <div className="text-[12px] text-muted-foreground">{sub}</div>}
    </motion.div>
  )
}

/* ---------- Detection: rules vs ML vs source ---------- */

export const RULE_LABELS: Record<string, string> = {
  R1: "Shared bank account",
  R2: "Device or IP farm",
  R3: "Multi-state SSN",
  R4: "Working while claiming",
  R5: "Fictitious employer",
  R6: "Synthetic identity",
}
export const RULE_KEYS: Record<string, string> = {
  R1: "r1SharedBankAccount",
  R2: "r2DeviceOrIpFarm",
  R3: "r3MultiStateSsn",
  R4: "r4WorkingWhileClaiming",
  R5: "r5FictitiousEmployer",
  R6: "r6SyntheticIdentity",
}

/** Rule flags: outlined, monospace, deterministic. Visually distinct from ML scores. */
export function RuleFlag({ code, compact = false }: { code: string; compact?: boolean }) {
  return (
    <Tip content={<span><b>Rule {code}</b>: {RULE_LABELS[code]}. Deterministic rule in DT_CLAIM_RULE_FLAGS.</span>}>
      <span className="mono inline-flex h-5 items-center gap-1 rounded-[5px] border border-[#cbd5e1] bg-white px-1.5 text-[10.5px] font-medium text-[#13315c]">
        {code}
        {!compact && <span className="font-sans text-[11px] font-normal text-muted-foreground">{RULE_LABELS[code]}</span>}
      </span>
    </Tip>
  )
}

export function ruleCodes(row: Record<string, unknown>): string[] {
  return Object.entries(RULE_KEYS)
    .filter(([, k]) => row[k] === true)
    .map(([c]) => c)
}

/** ML score: filled gradient bar with probability. Never looks like a rule chip. */
export function MlScore({ p, width = 72 }: { p: number | null | undefined; width?: number }) {
  const v = Math.max(0, Math.min(1, Number(p ?? 0)))
  const hot = v >= 0.5
  return (
    <Tip
      content={
        <span>
          <b>ML fraud probability</b> {(v * 100).toFixed(1)}%. Gradient-boosted classifier (Snowpark Python),
          ML.CLAIM_ML_SCORES. Threshold 50%.
        </span>
      }
    >
      <span className="inline-flex items-center gap-2">
        <span className="relative h-1.5 overflow-hidden rounded-full bg-[#eef0f3]" style={{ width }}>
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${v * 100}%`,
              background: hot ? "linear-gradient(90deg,#f5a524,#d97706)" : "linear-gradient(90deg,#9fb3c8,#5b7a99)",
            }}
          />
        </span>
        <span className={cn("num text-[12px]", hot ? "text-amber font-medium" : "text-muted-foreground")}>
          {(v * 100).toFixed(0)}%
        </span>
      </span>
    </Tip>
  )
}

const SOURCE_STYLE: Record<string, { label: string; cls: string; tip: string }> = {
  RULES_AND_ML: { label: "Both", cls: "bg-navy text-white", tip: "Caught by a rule and the ML model." },
  RULES_ONLY: { label: "Rule only", cls: "bg-white text-navy border border-[#cbd5e1]", tip: "A rule fired; ML below 50%." },
  ML_ONLY: { label: "ML only", cls: "bg-amber-50 text-[#9a5b06] border border-[#f6e2bf]", tip: "ML caught what no rule flagged." },
  NONE: { label: "Not flagged", cls: "bg-muted text-muted-foreground", tip: "No rule fired and ML below 50%." },
}

export function DetectionSource({ value }: { value: string }) {
  const s = SOURCE_STYLE[value] ?? SOURCE_STYLE.NONE
  return (
    <Tip content={<span><b>DETECTION_SOURCE = {value}</b>. {s.tip}</span>}>
      <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-medium", s.cls)}>{s.label}</span>
    </Tip>
  )
}

/* ---------- Prevention status ---------- */

export const STATUS_META: Record<string, { label: string; cls: string; Icon: typeof ShieldCheck }> = {
  OPEN: { label: "Open", cls: "text-muted-foreground bg-white border-hair", Icon: ShieldQuestion },
  HELD: { label: "Payment held", cls: "text-teal bg-teal-50 border-[#cfe9e7]", Icon: ShieldCheck },
  VERIFYING: { label: "ID verification", cls: "text-[#9a5b06] bg-amber-50 border-[#f6e2bf]", Icon: ShieldAlert },
  CLEARED: { label: "Cleared", cls: "text-[#475467] bg-[#f2f4f7] border-[#e4e7ec]", Icon: ShieldCheck },
  REFERRED: { label: "Referred to OIG", cls: "text-white bg-navy border-navy", Icon: ShieldAlert },
  ESCALATED: { label: "Escalated", cls: "text-alert bg-[#fef3f2] border-[#fecdca]", Icon: TriangleAlert },
  ASSIGNED: { label: "Assigned", cls: "text-navy bg-[#eef3fa] border-[#d9e3f2]", Icon: ShieldQuestion },
}

export function PreventionStatus({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.OPEN
  return (
    <motion.span
      layout
      key={status}
      initial={{ scale: 0.92, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={cn("inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[10.5px] font-medium", m.cls)}
    >
      <m.Icon className="size-3" />
      {m.label}
    </motion.span>
  )
}

/* ---------- States ---------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-lg", className)} />
}

export function Restricted({ persona, reason, what }: { persona: Persona; reason?: string; what: string }) {
  const meta = PERSONA_META[persona]
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="card relative overflow-hidden p-10 text-center"
    >
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-60" />
      <div className="relative mx-auto flex max-w-md flex-col items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-full border border-hair bg-white">
          <Lock className="size-5 text-navy" />
        </span>
        <h3 className="text-[22px] font-medium tracking-[-0.03em]">Restricted by governance</h3>
        <p className="text-[14px] text-muted-foreground">
          {meta.label} ({meta.agency}) does not have access to {what}. Snowflake RBAC denied the query; the app did not hide
          anything itself.
        </p>
        {reason && <code className="mono rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">{reason}</code>}
        <p className="text-[12px] text-muted-foreground">Switch persona in the header to see this view.</p>
      </div>
    </motion.div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card flex flex-col items-center gap-3 p-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-[#fef3f2]">
        <TriangleAlert className="size-5 text-alert" />
      </span>
      <h3 className="text-[18px] font-medium tracking-[-0.02em]">That query did not come back</h3>
      <p className="max-w-md text-[13px] text-muted-foreground">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="h-8 rounded-full border border-hair bg-white px-4 text-[13px] font-medium hover:bg-muted"
        >
          Try again
        </button>
      )}
    </div>
  )
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <h3 className="text-[18px] font-medium tracking-[-0.02em]">{title}</h3>
      <p className="max-w-sm text-[13px] text-muted-foreground">{body}</p>
      {action}
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  sub,
  right,
}: {
  eyebrow: string
  title: React.ReactNode
  sub?: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div className="relative mb-8">
      <div className="hero-gradient pointer-events-none absolute -inset-x-10 -top-10 h-56" />
      <div className="dot-grid pointer-events-none absolute -inset-x-10 -top-10 h-56" />
      <div className="relative flex flex-wrap items-end justify-between gap-4 pt-2">
        <div>
          <div className="eyebrow mb-3">{eyebrow}</div>
          <h1 className="headline max-w-3xl">{title}</h1>
          {sub && <p className="mt-3 max-w-2xl text-[15px] text-muted-foreground">{sub}</p>}
        </div>
        {right}
      </div>
    </div>
  )
}
