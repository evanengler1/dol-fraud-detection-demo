"use client"

import { memo, useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Pause, Play, X } from "lucide-react"
import { fmt, useApi } from "@/lib/client"
import { OriginBadge, Skeleton } from "@/components/kit"
import { cn } from "@/lib/utils"

type Counts = Record<string, number>
type Stats = {
  counts: Counts
  dynamicTables: { name: string; state: string; refreshAction: string; refreshStartTime: string; dataTimestamp: string }[]
  tasks: { name: string; state: string; scheduledTime: string; completedTime: string | null; errorMessage: string | null }[]
}

type Col = 0 | 1 | 2
interface N {
  id: string
  col: Col
  title: string
  sub: string
  synthetic?: boolean
  countKey?: (c: Counts) => number
  what: string
  file: string
  stats: (s: Stats) => [string, string][]
  code: string
}

const sum = (c: Counts, ...k: string[]) => k.reduce((a, x) => a + Number(c[x] ?? 0), 0)
const dt = (s: Stats, name: string): [string, string][] => {
  const d = s.dynamicTables.find((x) => x.name === name)
  return d
    ? [[`${name}`, `${d.state.toLowerCase()} (${d.refreshAction?.toLowerCase() ?? "n/a"}), data ${fmt.dateTime(d.dataTimestamp)}`]]
    : [[name, "no refresh in recent history (suspended or idle)"]]
}

const NODES: N[] = [
  // Sources
  { id: "eta", col: 0, title: "ETA 539, 227, 5159, 902P", sub: "UI claims, overpayments, PUA", countKey: (c) => sum(c, "eta539", "eta227", "eta5159", "eta902p"), what: "Weekly claims (539), overpayment detection and recovery (227), benefits paid (5159) and pandemic PUA (902P), mapped from the ET Handbook 402 cell layout.", file: "02_curated_public.sql", stats: (s) => [["ETA 539 rows", fmt.int(s.counts.eta539)], ["ETA 227 rows", fmt.int(s.counts.eta227)], ["ETA 5159 rows", fmt.int(s.counts.eta5159)], ["ETA 902P rows", fmt.int(s.counts.eta902p)]], code: "SELECT STATE_CODE, QUARTER_ENDING, FRAUD_DOLLARS\nFROM CURATED.ETA_227_OVERPAYMENTS;" },
  { id: "bam", col: 0, title: "BAM / PIIA", sub: "Improper payment rates", countKey: (c) => c.bam, what: "Benefit Accuracy Measurement integrity rates by state and quarter, the federal estimate of fraud rate.", file: "02_curated_public.sql", stats: (s) => [["Rate rows", fmt.int(s.counts.bam)]], code: "SELECT MAX(FRAUD_RATE)\nFROM CURATED.BAM_INTEGRITY_RATES\nWHERE STATE_CODE = 'US';" },
  { id: "f5500", col: 0, title: "Form 5500", sub: "EBSA plan filings", countKey: (c) => c.form5500, what: "Employer benefit plan filings, used as EIN anchors for entity resolution.", file: "02_curated_public.sql", stats: (s) => [["Filings", fmt.int(s.counts.form5500)]], code: "SELECT EIN, SPONSOR_NAME, STATE_CODE\nFROM CURATED.FORM_5500;" },
  { id: "oflc", col: 0, title: "OFLC H-2A / H-2B", sub: "Foreign labor disclosure", countKey: (c) => c.oflc, what: "Foreign labor certification cases, compared to QCEW wages to spot offers far below the industry wage.", file: "02_curated_public.sql", stats: (s) => [["Cases", fmt.int(s.counts.oflc)]], code: "SELECT EMPLOYER_NAME, WAGE_OFFER, WAGE_PER\nFROM CURATED.OFLC_H2_CASES;" },
  { id: "whdosha", col: 0, title: "WHD + OSHA enforcement", sub: "Wage cases, inspections, citations", countKey: (c) => sum(c, "whd", "osha"), what: "Wage and Hour cases and back wages, plus OSHA inspections, violations and accidents. Read in place from the existing WHD and OSHA databases through views in CURATED, so nothing is duplicated.", file: "02_curated_public.sql", stats: (s) => [["WHD cases", fmt.int(s.counts.whd)], ["OSHA inspections", fmt.int(s.counts.osha)], ["ITA 300A rows", fmt.int(s.counts.ita)]], code: "CREATE VIEW CURATED.WHD_CASE AS\nSELECT ... FROM DOL_WHD_DEMO.TRANSFORMED.CASES;" },
  { id: "pdfs", col: 0, title: "Policy PDFs", sub: "OIG audits, BAM report, UIPL 16-21", countKey: (c) => c.policyChunks, what: "Five OIG audits, the BAM PIIA report and UIPL 16-21, parsed into searchable chunks.", file: "08_cortex_ai.sql", stats: (s) => [["Documents", fmt.int(s.counts.policyDocs)], ["Chunks", fmt.int(s.counts.policyChunks)]], code: "-- 08_cortex_ai.sql\n-- AI_PARSE_DOCUMENT -> page chunks\n--   -> Cortex Search CS_POLICY_DOCS" },
  { id: "synth", col: 0, title: "Synthetic claims", sub: "Claimants, payments, complaints", synthetic: true, countKey: (c) => sum(c, "synthClaims", "synthPayments"), what: "Deterministic synthetic claims calibrated to ETA 539, QCEW and BAM, with six seeded fraud patterns. Not real people.", file: "05_synthetic_data.sql", stats: (s) => [["Claims", fmt.int(s.counts.synthClaims)], ["Payments (incl. scheduled)", fmt.int(s.counts.synthPayments)]], code: "-- six seeded patterns\n-- shared bank, device farm, multi-state SSN,\n-- working while claiming, fictitious employer,\n-- synthetic identity" },
  // Layers
  { id: "stage", col: 1, title: "External stage + Python loaders", sub: "RAW_PUBLIC, RAW_SYNTH", what: "Python stored procedures unzip, read CSV and XLSX from the stage and land 16 RAW tables. Synthetic data lands in RAW_SYNTH.", file: "01_ingest_s3.sql", stats: (s) => [["Public rows", fmt.int(sum(s.counts, "eta539", "eta227", "eta5159", "eta902p", "bam", "form5500", "oflc"))], ["Synthetic claims", fmt.int(s.counts.synthClaims)]], code: "CALL SP_LOAD_XLSX('@DOL_FRAUD_DEMO.RAW_PUBLIC.S3_DOL/oui/\n  PIIA_2024_Integrity_Rates_By_Cause.xlsx', ...);" },
  { id: "er", col: 1, title: "Entity resolution", sub: "EIN anchors + Jaro-Winkler", what: "Records from five sources are anchored on EIN, then matched on normalized name and address with JAROWINKLER_SIMILARITY, producing one employer master.", file: "04_entity_resolution.sql", stats: (s) => [["Source records", fmt.int(s.counts.erSourceRecords)], ["Resolved employers", fmt.int(s.counts.erEmployers)], ["In 2+ agencies", fmt.int(s.counts.erMultiAgency)]], code: "JAROWINKLER_SIMILARITY(r.NORM_NAME, e.NORM_NAME) >= 88" },
  { id: "dt", col: 1, title: "Dynamic Tables", sub: "5 min and 1 day lag", what: "A five-step chain: claim features, rule flags, claim links, ring stats (5 minutes) and the state UI baseline (1 day). Rules R1 to R6 are computed here, incrementally where possible.", file: "06_curated_dynamic_tables.sql", stats: (s) => [...dt(s, "DT_CLAIM_FEATURES"), ...dt(s, "DT_CLAIM_RULE_FLAGS"), ...dt(s, "DT_CLAIM_LINKS"), ...dt(s, "DT_CLAIM_RING_STATS"), ...dt(s, "DT_STATE_UI_BASELINE")], code: "CREATE DYNAMIC TABLE DT_CLAIM_RULE_FLAGS\n  lag = '5 minutes' refresh_mode = 'AUTO'\nAS SELECT CLAIM_ID, ...,\n  BANK_ACCOUNT_CLAIM_COUNT >= 5 AS R1_SHARED_BANK_ACCOUNT, ...\nFROM DT_CLAIM_FEATURES;" },
  { id: "risk", col: 1, title: "Employer risk procedure + weekly task", sub: "EMPLOYER_RISK_360", what: "The WHD and OSHA source tables belong to other demo roles without change tracking, so SP_REFRESH_EMPLOYER_RISK rebuilds Employer Risk 360 on a weekly task.", file: "06_curated_dynamic_tables.sql", stats: (s) => [["Employers scored", fmt.int(s.counts.risk360Rows)], ["Cross-agency (2+)", fmt.int(s.counts.riskCrossAgency)], ...s.tasks.map((t) => [t.name, `${t.state.toLowerCase()} ${fmt.dateTime(t.completedTime ?? t.scheduledTime)}`] as [string, string])], code: "CREATE OR REPLACE TASK TASK_REFRESH_EMPLOYER_RISK\n  WAREHOUSE = DOL_FRAUD_WH\n  SCHEDULE = 'USING CRON 0 6 * * 1 America/New_York'\nAS CALL DOL_FRAUD_DEMO.ANALYTICS.SP_REFRESH_EMPLOYER_RISK();" },
  { id: "ml", col: 1, title: "ML", sub: "Anomaly, forecast, classifier", what: "Cortex ANOMALY_DETECTION on weekly claims, FORECAST on fraud dollars, and a HistGradientBoosting classifier. The classifier runs as a Snowpark Python procedure because ML.CLASSIFICATION is broken on this account.", file: "07_ml_models.sql", stats: (s) => [["Anomalous state-weeks", fmt.int(s.counts.mlAnomalies)], ["Claims scored", fmt.int(s.counts.mlScored)], ["Holdout AUC", Number(s.counts.mlAuc ?? 0).toFixed(4) + " (synthetic, separable by design)"], ["Forecast rows", fmt.int(s.counts.mlForecastRows)]], code: "CALL SP_TRAIN_CLAIM_CLASSIFIER();\n-- sklearn HistGradientBoostingClassifier\n-- in a Snowpark Python stored procedure" },
  { id: "ai", col: 1, title: "Cortex AI", sub: "Parse, classify, translate, complete", what: "Policy PDFs are parsed; complaints are translated, classified and routed; OSHA narratives are enriched; case briefs are precomputed with AI_COMPLETE. Three Cortex Search services index the text.", file: "08_cortex_ai.sql", stats: (s) => [["Complaints enriched", fmt.int(s.counts.aiComplaints)], ["OSHA narratives", fmt.int(s.counts.aiNarratives)], ["Case briefs", fmt.int(s.counts.aiBriefs)], ["Search services", "CS_POLICY_DOCS, CS_OSHA_NARRATIVES, CS_COMPLAINTS"]], code: "IFF(c.LANGUAGE = 'ES',\n    AI_TRANSLATE(c.COMPLAINT_TEXT, 'es', 'en'),\n    c.COMPLAINT_TEXT) AS ENGLISH_TEXT" },
  { id: "sv", col: 1, title: "Semantic views", sub: "SV_UI_INTEGRITY, SV_EMPLOYER_RISK", what: "Business definitions and verified queries for natural-language questions through Cortex Analyst and the CoWork agent.", file: "09_semantic_views.sql", stats: () => [["Views", "2, with verified queries"]], code: "CREATE SEMANTIC VIEW ANALYTICS.SV_UI_INTEGRITY\n  TABLES (...) FACTS (...) DIMENSIONS (...) METRICS (...);" },
  { id: "gov", col: 1, title: "Horizon governance", sub: "Tags, masking, row access, personas", what: "DATA_ORIGIN and PII tags, masking for SSN, bank account, names and EIN, a state row access policy, and five persona roles. Policies key off CURRENT_ROLE().", file: "11_governance.sql", stats: () => [["Masking policies", "SSN, bank, PII, DOB, employer name, EIN"], ["Row access", "RAP_CLAIM_STATE (TX partner)"], ["Persona roles", "5"]], code: "CREATE MASKING POLICY IF NOT EXISTS MP_SSN ...\nALTER MASKING POLICY MP_SSN SET BODY ->\n  CASE WHEN CURRENT_ROLE() IN ('DOL_FRAUD_DEMO_ROLE', 'ACCOUNTADMIN') THEN V\n       WHEN CURRENT_ROLE() IN ('DOL_OUI_ANALYST', 'DOL_STATE_PARTNER_TX')\n       THEN 'XXX-XX-' || RIGHT(V, 4)\n       ELSE '***-**-****' END;" },
  { id: "alerts", col: 1, title: "Alerts", sub: "New ring, claims surge, employer", what: "Three alerts watch the Dynamic Tables and log to GOVERNANCE.ALERT_LOG. Created suspended for the demo.", file: "12_alerts.sql", stats: (s) => [["Alerts fired", fmt.int(s.counts.alertsFired)]], code: "CREATE OR REPLACE ALERT ALERT_NEW_FRAUD_RING\n  WAREHOUSE = DOL_FRAUD_WH\n  SCHEDULE = '15 MINUTE'\n  IF (EXISTS (SELECT 1 FROM ANALYTICS.DT_CLAIM_RING_STATS r\n              WHERE r.CLAIM_COUNT >= 5 AND ...))" },
  // Consumption
  { id: "app", col: 2, title: "This app", sub: "snow app on SPCS", what: "Next.js on Snowflake App Runtime. Reads the Dynamic Tables and Employer Risk 360, and writes only to APP.CASE_ACTIONS, APP.REFERRALS and APP.MODEL_FEEDBACK.", file: "13_app_support.sql", stats: (s) => [["Actions recorded", fmt.int(s.counts.appActions)], ["Referrals", fmt.int(s.counts.appReferrals)]], code: "INSERT INTO APP.CASE_ACTIONS\n  (SUBJECT_TYPE, SUBJECT_ID, ACTION, ACTED_ROLE)\nVALUES ('CLAIM', ?, 'HOLD_PAYMENT', ?);" },
  { id: "cowork", col: 2, title: "CoWork agent", sub: "Snowflake Intelligence", what: "A Cortex Agent that orchestrates Cortex Analyst over the semantic views and Cortex Search over policy, OSHA narratives and complaints. Leaders ask questions in plain English in Snowflake Intelligence and get governed answers with citations, scoped by the same persona roles.", file: "10_agent.sql", stats: () => [["Tools", "2 semantic views, 3 search services"], ["Surface", "Snowflake Intelligence"]], code: "CREATE AGENT ANALYTICS.DOL_FRAUD_AGENT\n  FROM SPECIFICATION $$\n  tools:\n    - analyst: SV_UI_INTEGRITY, SV_EMPLOYER_RISK\n    - search: CS_POLICY_DOCS, CS_OSHA_NARRATIVES,\n              CS_COMPLAINTS\n  $$;" },
  { id: "personas", col: 2, title: "Persona roles", sub: "OUI, WHD, OSHA, OIG, TX", what: "Each persona sees the same objects through different masking and row filters. The switcher in the header runs queries in that role's own session.", file: "11_governance.sql", stats: () => [["Personas", "DOL_OUI_ANALYST, DOL_WHD_INVESTIGATOR, DOL_OSHA_INSPECTOR, DOL_OIG_EXECUTIVE, DOL_STATE_PARTNER_TX"]], code: "GRANT SELECT ON VIEW DOL_FRAUD_DEMO.ANALYTICS.V_CLAIM_RISK\n  TO ROLE DOL_STATE_PARTNER_TX;" },
]

const EDGES: [string, string][] = [
  ["eta", "stage"], ["bam", "stage"], ["f5500", "stage"], ["oflc", "stage"], ["pdfs", "stage"], ["synth", "stage"],
  ["whdosha", "er"], ["f5500", "er"], ["oflc", "er"], ["stage", "er"],
  ["stage", "dt"], ["synth", "dt"], ["er", "risk"], ["whdosha", "risk"],
  ["dt", "ml"], ["eta", "ml"], ["dt", "alerts"], ["pdfs", "ai"], ["whdosha", "ai"], ["synth", "ai"], ["risk", "ai"],
  ["dt", "sv"], ["risk", "sv"], ["ml", "sv"],
  ["dt", "app"], ["ml", "app"], ["risk", "app"], ["ai", "app"], ["alerts", "app"], ["gov", "app"],
  ["sv", "cowork"], ["ai", "cowork"], ["gov", "personas"], ["personas", "app"], ["gov", "cowork"],
]

const STORY: { nodes: string[]; caption: string }[] = [
  { nodes: ["synth", "stage"], caption: "A claim arrives. It lands in RAW_SYNTH with its bank account, device and employer." },
  { nodes: ["stage", "dt"], caption: "Within the 5 minute lag, Dynamic Tables compute features and fire rules R1 to R6." },
  { nodes: ["dt", "ml"], caption: "The classifier scores it. ML catches what rules miss and clears rule false positives." },
  { nodes: ["dt", "alerts"], caption: "The claim shares a device with 49 others. A ring forms and the new-ring alert fires." },
  { nodes: ["alerts", "app"], caption: "An analyst holds every scheduled payment in the ring before the next release." },
  { nodes: ["er", "risk"], caption: "The ring's last employer resolves to one entity across WHD, OSHA and OFLC." },
  { nodes: ["risk", "ai"], caption: "Cortex AI drafts the case brief and routes the worker complaints." },
  { nodes: ["ai", "app", "gov", "personas"], caption: "A referral goes to OIG. Each agency sees it through its own masking and row filters." },
]

/* ---------- layout ---------- */

const W = 1100
const COLX = [24, 430, 846]
const COLW = [250, 250, 230]
const GAP = 12

function layout(counts?: Counts) {
  const pos: Record<string, { x: number; y: number; w: number; h: number }> = {}
  let sourceTotal = 720
  for (const col of [0, 1, 2] as Col[]) {
    const items = NODES.filter((n) => n.col === col)
    const heights = items.map((n) => {
      if (col !== 0 || !counts || !n.countKey) return col === 2 ? 92 : 58
      const v = Math.max(1, n.countKey(counts))
      return 50 + Math.min(34, Math.log10(v) * 5)
    })
    const total = heights.reduce((a, b) => a + b, 0) + GAP * (items.length - 1)
    if (col === 0) sourceTotal = Math.max(total, NODES.filter((n) => n.col === 1).length * (58 + GAP))
    let y = col === 0 ? 40 : 40 + Math.max(0, (sourceTotal - total) / 2)
    items.forEach((n, i) => {
      pos[n.id] = { x: COLX[col], y, w: COLW[col], h: heights[i] }
      y += heights[i] + GAP
    })
  }
  return pos
}

function edgePath(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, sameCol: boolean) {
  if (sameCol) {
    const bulge = 36 + Math.abs(b.y - a.y) * 0.08
    // Rightmost column loops out the left side so the curve stays inside the canvas
    if (a.x >= COLX[2]) {
      const x1 = a.x, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2
      return `M${x1},${y1} C${x1 - bulge},${y1} ${x2 - bulge},${y2} ${x2},${y2}`
    }
    const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x + b.w, y2 = b.y + b.h / 2
    return `M${x1},${y1} C${x1 + bulge},${y1} ${x2 + bulge},${y2} ${x2},${y2}`
  }
  const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2
  const mx = (x1 + x2) / 2
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`
}

function lineage(id: string) {
  const up = new Set<string>(), down = new Set<string>()
  const walk = (cur: string, dir: "up" | "down") => {
    for (const [a, b] of EDGES) {
      const next = dir === "down" ? (a === cur ? b : null) : b === cur ? a : null
      const set = dir === "down" ? down : up
      if (next && !set.has(next)) {
        set.add(next)
        walk(next, dir)
      }
    }
  }
  walk(id, "up")
  walk(id, "down")
  return new Set([id, ...up, ...down])
}

/* ---------- component ---------- */

export const ArchitectureFlow = memo(function ArchitectureFlow() {
  const stats = useApi<Stats>("/api/arch/stats", { staleTime: 60_000 })
  const reduce = useReducedMotion()
  const pos = useMemo(() => layout(stats.data?.counts), [stats.data])
  const svgH = useMemo(() => Math.max(...Object.values(pos).map((p) => p.y + p.h)) + 32, [pos])
  const [hover, setHover] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setStep((s) => (s + 1 >= STORY.length ? (setPlaying(false), s) : s + 1)), 3400)
    return () => clearInterval(t)
  }, [playing])

  const storyNodes = playing ? new Set(STORY[step].nodes) : null
  const active = storyNodes ?? (hover ? lineage(hover) : null)
  const isEdgeLit = (a: string, b: string) =>
    storyNodes ? storyNodes.has(a) && storyNodes.has(b) : active ? active.has(a) && active.has(b) : false
  const node = NODES.find((n) => n.id === selected)

  return (
    <div className="relative">
      <div className="mb-3 flex items-center justify-end gap-3">
        <button
          onClick={() => {
            if (playing) setPlaying(false)
            else {
              setSelected(null)
              setStep(0)
              setPlaying(true)
            }
          }}
          className="flex h-9 items-center gap-2 rounded-full bg-navy px-4 text-[13px] font-medium text-white transition-colors duration-300 hover:bg-[#13315c]"
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          {playing ? "Pause story" : "Play the story"}
        </button>
      </div>

      <div className="card relative overflow-hidden">
        <div className="dot-grid pointer-events-none absolute inset-0 opacity-40" />
        <svg viewBox={`0 0 ${W} ${svgH}`} className="relative h-auto w-full select-none" role="img" aria-label="Architecture lineage">
          <defs>
            <linearGradient id="edge-lit" x1="0" x2="1">
              <stop offset="0" stopColor="#0e7c7b" />
              <stop offset="1" stopColor="#0b2545" />
            </linearGradient>
          </defs>
          {["SOURCES", "SNOWFLAKE", "CONSUMPTION"].map((l, i) => (
            <text key={l} x={COLX[i]} y={22} className="mono" fontSize={10.5} letterSpacing="0.1em" fill="#8a8a90">{l}</text>
          ))}
          {/* edges */}
          {EDGES.map(([a, b], i) => {
            const pa = pos[a], pb = pos[b]
            if (!pa || !pb) return null
            const same = NODES.find((n) => n.id === a)!.col === NODES.find((n) => n.id === b)!.col
            const d = edgePath(pa, pb, same)
            const lit = isEdgeLit(a, b)
            const dim = !!active && !lit
            return (
              <g key={`${a}-${b}`} style={{ opacity: dim ? 0.12 : 1, transition: "opacity 250ms" }}>
                <path d={d} fill="none" stroke={lit ? "url(#edge-lit)" : "#dcdfe4"} strokeWidth={lit ? 1.8 : 1.1} />
                {!reduce && (lit || (!active && i % 3 === 0)) && (
                  <circle
                    r={lit ? 3 : 2}
                    fill={lit ? "#0e7c7b" : "#9fb3c8"}
                    style={{
                      offsetPath: `path('${d}')`,
                      animation: `flow ${lit ? 1.6 : 3.6}s linear ${(i % 7) * 0.35}s infinite`,
                      willChange: "offset-distance",
                    }}
                  />
                )}
              </g>
            )
          })}
          {/* nodes */}
          {NODES.map((n) => {
            const p = pos[n.id]
            if (!p) return null
            const lit = !active || active.has(n.id)
            const isSel = selected === n.id
            const cnt = n.countKey && stats.data ? n.countKey(stats.data.counts) : null
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                style={{ opacity: lit ? 1 : 0.25, transition: "opacity 250ms", cursor: "pointer" }}
                onMouseEnter={() => !playing && setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setSelected(n.id)}
                tabIndex={-1}
              >
                <rect width={p.w} height={p.h} rx={10} fill="#fff" stroke={isSel ? "#0b2545" : storyNodes?.has(n.id) ? "#0e7c7b" : "#e6e6e6"} strokeWidth={isSel || storyNodes?.has(n.id) ? 1.6 : 1} />
                {n.synthetic && <rect x={p.w - 64} y={8} width={56} height={16} rx={8} fill="#f6f1ff" />}
                {n.synthetic && <text x={p.w - 36} y={19.5} textAnchor="middle" fontSize={9.5} fill="#5b3fa6" fontWeight={500}>Synthetic</text>}
                <text x={12} y={22} fontSize={12.5} fontWeight={500} fill="#0a0a0a">{n.title}</text>
                <text x={12} y={38} fontSize={10.5} fill="#6b6b70" className="mono">{n.sub.length > 40 ? n.sub.slice(0, 39) + "..." : n.sub}</text>
                {cnt != null && <text x={12} y={p.h - 10} fontSize={10.5} fill="#0b2545" className="num">{fmt.int(cnt)} rows</text>}
              </g>
            )
          })}
        </svg>
        {!stats.data && <div className="absolute bottom-3 right-3 text-[11.5px] text-muted-foreground">Loading live counts...</div>}

        <AnimatePresence>
          {playing && (
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25 }}
              className="absolute bottom-4 left-1/2 w-[620px] max-w-[90%] -translate-x-1/2 rounded-xl border border-hair bg-white/95 px-5 py-3 backdrop-blur"
              style={{ boxShadow: "var(--shadow-pop)" }}
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="eyebrow">Step {step + 1} of {STORY.length}</span>
                <span className="flex flex-1 gap-1">
                  {STORY.map((_, i) => <span key={i} className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-teal" : "bg-[#eceef1]")} />)}
                </span>
              </div>
              <p className="text-[14px] leading-snug">{STORY[step].caption}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {node && (
          <motion.aside
            initial={{ x: 32, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 32, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
            className="fixed bottom-2 right-2 top-16 z-50 flex w-[440px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-hair bg-white"
            style={{ boxShadow: "var(--shadow-raise)" }}
          >
            <div className="flex items-start justify-between border-b border-hair px-5 py-4">
              <div>
                <div className="eyebrow mb-1 flex items-center gap-2">{["Source", "Snowflake layer", "Consumption"][node.col]} {node.synthetic && <OriginBadge origin="SYNTHETIC" />}</div>
                <h3 className="text-[19px] font-medium tracking-[-0.02em]">{node.title}</h3>
                <div className="mono mt-1 text-[11.5px] text-muted-foreground">{node.sub}</div>
              </div>
              <button onClick={() => setSelected(null)} className="rounded-md p-1.5 hover:bg-muted" aria-label="Close"><X className="size-4" /></button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <p className="text-[13.5px] leading-relaxed">{node.what}</p>
              <div>
                <div className="eyebrow mb-1.5">Built by</div>
                <span className="mono rounded-md bg-muted px-2 py-1 text-[12px]">sql/{node.file}</span>
              </div>
              <div>
                <div className="eyebrow mb-1.5">Live from Snowflake</div>
                {stats.data ? (
                  <div className="rounded-lg border border-hair px-3 py-1">
                    {node.stats(stats.data).map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4 border-b border-hair py-1.5 text-[12.5px] last:border-0">
                        <span className="mono text-[11.5px] text-muted-foreground">{k}</span>
                        <span className="num text-right">{v}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Skeleton className="h-24" />
                )}
              </div>
              <div>
                <div className="eyebrow mb-1.5">Snippet</div>
                <pre className="mono overflow-x-auto rounded-lg border border-hair bg-[#fbfbfa] p-3 text-[11.5px] leading-relaxed text-[#13315c]">{node.code}</pre>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      <style>{`@keyframes flow { from { offset-distance: 0%; opacity: 0 } 10% { opacity: 1 } 90% { opacity: 1 } to { offset-distance: 100%; opacity: 0 } }`}</style>
    </div>
  )
})
