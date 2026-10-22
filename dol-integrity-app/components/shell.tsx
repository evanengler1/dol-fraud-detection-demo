"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { Command } from "cmdk"
import {
  Building2,
  ChevronDown,
  Gauge,
  Network,
  Search,
  ShieldCheck,
  ShieldHalf,
  Workflow,
  Check,
  FileSearch,
  RotateCcw,
} from "lucide-react"
import { useEffect, useState } from "react"
import * as Tooltip from "@radix-ui/react-tooltip"
import { Toaster, toast } from "sonner"
import { QueryClient, QueryClientProvider, useMutation, useQueryClient } from "@tanstack/react-query"
import { APP_SHORT, APP_TAGLINE, LOGO_SRC } from "@/lib/constants"
import { api, fmt, PersonaProvider, useApi, usePersona } from "@/lib/client"
import { PERSONAS, PERSONA_META, type Persona } from "@/lib/personas"
import { CountUp, Tip } from "@/components/kit"
import { ClaimDrawerProvider, useClaimDrawer } from "@/components/claim-drawer"
import { cn } from "@/lib/utils"

export const NAV = [
  { href: "/", label: "Overview", Icon: Gauge, hint: "Detection and prevention at a glance" },
  { href: "/intercept", label: "Intercept queue", Icon: ShieldCheck, hint: "Stop payments before they go out" },
  { href: "/rings", label: "Fraud rings", Icon: Network, hint: "Shared bank, device and phone networks" },
  { href: "/employers", label: "Employer 360", Icon: Building2, hint: "Cross-agency employer risk" },
  { href: "/search", label: "Evidence search", Icon: FileSearch, hint: "Cortex Search over policy, OSHA, complaints" },
  { href: "/architecture", label: "Architecture", Icon: Workflow, hint: "How it is built on Snowflake" },
] as const

function Rail() {
  const path = usePathname()
  return (
    <nav className="sticky top-14 hidden h-[calc(100vh-56px)] w-[220px] shrink-0 flex-col gap-1 border-r border-hair bg-[#fafafa]/80 px-3 py-5 lg:flex">
      <div className="eyebrow px-3 pb-2">Workspace</div>
      {NAV.map(({ href, label, Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            prefetch
            className={cn(
              "relative flex h-9 items-center gap-2.5 rounded-md px-3 text-[13.5px] font-medium transition-colors duration-150",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId="rail-active"
                className="absolute inset-0 rounded-md border border-hair bg-white"
                style={{ boxShadow: "0 1px 2px rgb(0 0 0 / 0.04)" }}
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <Icon className={cn("relative size-4", active && "text-navy")} />
            <span className="relative">{label}</span>
          </Link>
        )
      })}
      <ResetDemo />
      <div className="mt-2 rounded-lg border border-hair bg-white p-3 text-[11.5px] leading-relaxed text-muted-foreground">
        <div className="mb-1 font-medium text-foreground">Data notice</div>
        Claims, claimants and complaints are <b className="text-[#5b3fa6]">synthetic</b>. Real employers appear only as a
        Display ID. Scores are risk indicators, not findings.
      </div>
    </nav>
  )
}

function ResetDemo() {
  const { persona } = usePersona()
  const qc = useQueryClient()
  const [armed, setArmed] = useState(false)
  const reset = useMutation({
    mutationFn: () =>
      api<{ cleared: Record<string, number> }>("/api/demo/reset", persona, {
        method: "POST",
        body: JSON.stringify({ confirm: "RESET" }),
      }),
    onSuccess: (r) => {
      const c = r.cleared
      toast.success("Demo reset", {
        description: `Cleared ${c.CASE_ACTIONS} actions, ${c.REFERRALS} referrals, ${c.MODEL_FEEDBACK} feedback rows. All claims are Open again.`,
      })
      qc.invalidateQueries()
    },
    onError: (e) => toast.error("Reset failed", { description: (e as Error).message }),
    onSettled: () => setArmed(false),
  })
  return (
    <div className="mt-auto">
      {armed ? (
        <div className="rounded-lg border border-[#fecdca] bg-[#fef3f2] p-2.5 text-[11.5px]">
          <div className="mb-2 text-alert">Clear all holds, referrals and feedback?</div>
          <div className="flex gap-1.5">
            <button
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
              className="h-7 flex-1 rounded-md bg-alert text-[11.5px] font-medium text-white disabled:opacity-60"
            >
              {reset.isPending ? "Resetting..." : "Reset"}
            </button>
            <button onClick={() => setArmed(false)} className="h-7 flex-1 rounded-md border border-hair bg-white text-[11.5px]">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setArmed(true)}
          className="flex h-8 w-full items-center gap-2 rounded-md px-3 text-[12.5px] font-medium text-muted-foreground hover:bg-white hover:text-foreground"
        >
          <RotateCcw className="size-3.5" /> Reset demo
        </button>
      )}
    </div>
  )
}

function PersonaSwitcher() {
  const { persona, setPersona } = usePersona()
  const [open, setOpen] = useState(false)
  const meta = PERSONA_META[persona]
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-2 rounded-full border border-hair bg-white pl-1 pr-3 text-[12.5px] font-medium hover:bg-muted"
      >
        <span className="flex h-6 items-center rounded-full bg-navy px-2 text-[10.5px] font-semibold tracking-wide text-white">
          {meta.agency}
        </span>
        {meta.label}
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.16, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="absolute right-0 z-50 mt-2 w-[340px] rounded-xl border border-hair bg-white p-1.5"
              style={{ boxShadow: "var(--shadow-pop)" }}
            >
              <div className="eyebrow px-2.5 pb-1.5 pt-2">Run queries as persona role</div>
              {PERSONAS.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setPersona(p as Persona)
                    setOpen(false)
                  }}
                  className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-muted"
                >
                  <span className="mt-0.5 flex h-5 w-12 shrink-0 items-center justify-center rounded-full bg-[#eef3fa] text-[10px] font-semibold text-navy">
                    {PERSONA_META[p].agency}
                  </span>
                  <span className="flex-1">
                    <span className="block text-[13px] font-medium">{PERSONA_META[p].label}</span>
                    <span className="block text-[11.5px] text-muted-foreground">{PERSONA_META[p].blurb}</span>
                    <span className="mono block text-[10.5px] text-muted-foreground">{p}</span>
                  </span>
                  {p === persona && <Check className="mt-1 size-4 text-teal" />}
                </button>
              ))}
              <div className="mt-1 border-t border-hair px-2.5 py-2 text-[11px] text-muted-foreground">
                Masking and row access policies key off CURRENT_ROLE(). Each persona uses its own Snowflake session.
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function PreventedChip() {
  const { data } = useApi<{ dollarsPrevented?: number; held?: number }>("/api/prevention", { staleTime: 15_000 })
  if (!data) return null
  return (
    <Tip
      content={
        <span>
          Scheduled payments stopped by a hold in APP.CASE_ACTIONS, valued from RAW_SYNTH.UI_PAYMENT (future weeks).
          Synthetic data.
        </span>
      }
    >
      <Link
        href="/"
        className="hidden h-8 items-center gap-2 rounded-full border border-[#cfe9e7] bg-teal-50 px-3 text-[12.5px] font-medium text-teal md:flex"
      >
        <ShieldHalf className="size-3.5" />
        <CountUp value={Number(data.dollarsPrevented ?? 0)} format={(n) => fmt.usd(n)} />
        <span className="font-normal text-teal/80">prevented</span>
      </Link>
    </Tip>
  )
}

function AsOf() {
  const { data } = useApi<{ queriedAt?: string; latestClaimTs?: string; latest227Quarter?: string }>("/api/kpis", {
    staleTime: 60_000,
  })
  return (
    <Tip
      content={
        <div className="space-y-1">
          <div>Queried {fmt.dateTime(data?.queriedAt)}</div>
          <div>Latest synthetic claim {fmt.date(data?.latestClaimTs)}</div>
          <div>Latest ETA 227 quarter {fmt.date(data?.latest227Quarter)}</div>
        </div>
      }
    >
      <span className="hidden items-center gap-1.5 text-[11.5px] text-muted-foreground xl:flex">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-teal opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-teal" />
        </span>
        Data as of <span className="num text-foreground">{data ? fmt.dateTime(data.queriedAt) : "loading"}</span>
      </span>
    </Tip>
  )
}

function Header({ onPalette }: { onPalette: () => void }) {
  const [scrolled, setScrolled] = useState(false)
  const router = useRouter()
  const [q, setQ] = useState("")
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4)
    window.addEventListener("scroll", on, { passive: true })
    return () => window.removeEventListener("scroll", on)
  }, [])
  return (
    <header
      className={cn(
        "sticky top-0 z-40 h-14 w-full border-b bg-[#fafafa]/85 backdrop-blur-md transition-colors duration-300",
        scrolled ? "border-hair" : "border-transparent",
      )}
    >
      <div className="flex h-full items-center gap-4 px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src={LOGO_SRC} alt="" width={26} height={26} priority />
          <span className="leading-tight">
            <span className="block text-[13.5px] font-semibold tracking-[-0.01em]">DOL {APP_SHORT}</span>
            <span className="block text-[11px] text-muted-foreground">{APP_TAGLINE} Command Center</span>
          </span>
        </Link>
        <form
          className="ml-4 hidden max-w-md flex-1 md:block"
          onSubmit={(e) => {
            e.preventDefault()
            if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`)
          }}
        >
          <label className="flex h-8 items-center gap-2 rounded-lg border border-hair bg-white px-2.5 text-[13px] focus-within:border-[#c7ced8]">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search policy, OSHA narratives, complaints"
              className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            />
            <button type="button" onClick={onPalette} className="flex items-center gap-0.5">
              <span className="kbd">⌘</span>
              <span className="kbd">K</span>
            </button>
          </label>
        </form>
        <div className="ml-auto flex items-center gap-3">
          <AsOf />
          <PreventedChip />
          <PersonaSwitcher />
        </div>
      </div>
    </header>
  )
}

function Palette({ open, setOpen }: { open: boolean; setOpen: (o: boolean) => void }) {
  const router = useRouter()
  const { openClaim } = useClaimDrawer()
  const [value, setValue] = useState("")
  const rings = useApi<{ ringId: string; ringLabel: string; claimCount: number }[]>(open ? "/api/rings" : null, {
    staleTime: 60_000,
  })
  const emps = useApi<{ employerId: string; displayId: string; riskScore: number }[]>(open ? "/api/employers" : null, {
    staleTime: 60_000,
  })
  const go = (href: string) => {
    setOpen(false)
    router.push(href)
  }
  const claimLike = /^CLM-\d{4,7}$/i.test(value.trim())
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-start justify-center bg-black/20 pt-[14vh] backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.25, 0.46, 0.45, 0.94] }}
            onClick={(e) => e.stopPropagation()}
            className="w-[620px] max-w-[92vw] overflow-hidden rounded-xl border border-hair bg-white"
            style={{ boxShadow: "var(--shadow-pop)" }}
          >
            <Command label="Command palette" loop>
              <div className="flex items-center gap-2 border-b border-hair px-4">
                <Search className="size-4 text-muted-foreground" />
                <Command.Input
                  autoFocus
                  value={value}
                  onValueChange={setValue}
                  placeholder="Jump to a page, employer, ring or claim (CLM-0005728), or search evidence"
                  className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
                />
                <span className="kbd">esc</span>
              </div>
              <Command.List className="max-h-[420px] overflow-y-auto p-2 [&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                <Command.Empty className="px-3 py-6 text-center text-[13px] text-muted-foreground">
                  No matches. Press Enter to search evidence.
                </Command.Empty>
                {claimLike && (
                  <Command.Group heading="Claim">
                    <Item
                      onSelect={() => {
                        setOpen(false)
                        openClaim(value.trim().toUpperCase())
                      }}
                    >
                      Open claim {value.trim().toUpperCase()}
                    </Item>
                  </Command.Group>
                )}
                <Command.Group heading="Pages">
                  {NAV.map((n) => (
                    <Item key={n.href} onSelect={() => go(n.href)} hint={n.hint}>
                      <n.Icon className="size-4 text-muted-foreground" />
                      {n.label}
                    </Item>
                  ))}
                </Command.Group>
                {value.trim().length > 2 && (
                  <Command.Group heading="Search evidence">
                    {[
                      ["CS_POLICY_DOCS", "Policy and OIG reports"],
                      ["CS_OSHA_NARRATIVES", "OSHA accident narratives"],
                      ["CS_COMPLAINTS", "Worker complaints"],
                    ].map(([s, l]) => (
                      <Item key={s} value={`search ${s} ${value}`} onSelect={() => go(`/search?q=${encodeURIComponent(value)}&service=${s}`)}>
                        <FileSearch className="size-4 text-muted-foreground" />
                        Search {l} for &ldquo;{value}&rdquo;
                      </Item>
                    ))}
                  </Command.Group>
                )}
                {Array.isArray(emps.data) && (
                  <Command.Group heading="Employers">
                    {emps.data.slice(0, 8).map((e) => (
                      <Item key={e.employerId} onSelect={() => go(`/employers?id=${encodeURIComponent(e.employerId)}`)} hint={`Risk ${e.riskScore}`}>
                        <Building2 className="size-4 text-muted-foreground" />
                        {e.displayId}
                      </Item>
                    ))}
                  </Command.Group>
                )}
                {Array.isArray(rings.data) && (
                  <Command.Group heading="Fraud rings">
                    {rings.data.map((r) => (
                      <Item key={r.ringId} onSelect={() => go(`/rings?id=${r.ringId}`)} hint={`${r.claimCount} claims`}>
                        <Network className="size-4 text-muted-foreground" />
                        {r.ringLabel}
                      </Item>
                    ))}
                  </Command.Group>
                )}
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Item({
  children,
  onSelect,
  hint,
  value,
}: {
  children: React.ReactNode
  onSelect: () => void
  hint?: string
  value?: string
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] data-[selected=true]:bg-muted"
    >
      {children}
      {hint && <span className="ml-auto text-[11.5px] text-muted-foreground">{hint}</span>}
    </Command.Item>
  )
}

function Inner({ children }: { children: React.ReactNode }) {
  const [palette, setPalette] = useState(false)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    window.addEventListener("keydown", on)
    return () => window.removeEventListener("keydown", on)
  }, [])
  const path = usePathname()
  return (
    <>
      <Header onPalette={() => setPalette(true)} />
      <div className="flex">
        <Rail />
        <main className="min-w-0 flex-1 px-6 pb-24 pt-8 xl:px-10">
          <motion.div
            key={path}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
            className="mx-auto max-w-[1360px]"
          >
            {children}
          </motion.div>
        </main>
      </div>
      <Palette open={palette} setOpen={setPalette} />
    </>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 20_000 } } }),
  )
  return (
    <QueryClientProvider client={client}>
      <PersonaProvider>
        <Tooltip.Provider>
          <ClaimDrawerProvider>
            <Inner>{children}</Inner>
          </ClaimDrawerProvider>
        </Tooltip.Provider>
        <Toaster
          position="bottom-right"
          toastOptions={{
            className: "!rounded-lg !border !border-hair !font-sans !text-[13px]",
            style: { boxShadow: "var(--shadow-pop)" },
          }}
        />
      </PersonaProvider>
    </QueryClientProvider>
  )
}
