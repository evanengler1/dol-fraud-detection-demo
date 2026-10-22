"use client"

import { memo, useEffect, useMemo, useState } from "react"
import { geoAlbersUsa, geoPath } from "d3-geo"
import { feature } from "topojson-client"
import type { Topology, GeometryCollection } from "topojson-specification"
import type { Feature, Geometry } from "geojson"
import { motion } from "framer-motion"
import { fmt } from "@/lib/client"

/** us-atlas states-10m.json only carries properties.name, so map names to codes ourselves. */
const NAME_TO_CODE: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT",
  Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL",
  Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT",
  Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA",
  "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
  "Puerto Rico": "PR",
}

export interface SurgeRow {
  stateCode: string
  stateName: string
  severeWeeks: number
  highWeeks: number
  elevatedWeeks: number
  peakMultiple: number | null
  peakWeek: string | null
  recentAlertWeeks: number
  fraudDollarsLastYear: number
}

const STOPS = ["#f1f4f8", "#d6e0ec", "#a9bed6", "#6f8fb3", "#3a5f8a", "#0b2545"]

/** Quantile shading so differences between states read clearly. */
function quantileScale(values: number[]) {
  const sorted = [...values].filter((v) => v > 0).sort((a, b) => a - b)
  return (v: number) => {
    if (!v || !sorted.length) return STOPS[0]
    const rank = sorted.findIndex((x) => x >= v) / sorted.length
    return STOPS[Math.min(STOPS.length - 1, 1 + Math.floor(rank * (STOPS.length - 1)))]
  }
}

export const SurgeMap = memo(function SurgeMap({ rows }: { rows: SurgeRow[] }) {
  const [features, setFeatures] = useState<Feature<Geometry, { name: string }>[]>([])
  const [hover, setHover] = useState<SurgeRow | null>(null)
  useEffect(() => {
    fetch("/states-10m.json")
      .then((r) => r.json())
      .then((topo: Topology) => {
        const fc = feature(topo, topo.objects.states as GeometryCollection<{ name: string }>)
        setFeatures((fc as unknown as { features: Feature<Geometry, { name: string }>[] }).features)
      })
  }, [])
  const byCode = useMemo(() => new Map(rows.map((r) => [r.stateCode, r])), [rows])
  const colorFor = useMemo(() => quantileScale(rows.map((r) => r.severeWeeks)), [rows])
  const path = useMemo(() => geoPath(geoAlbersUsa().scale(1050).translate([480, 300])), [])

  return (
    <div className="relative">
      <svg viewBox="0 0 960 600" className="h-auto w-full" role="img" aria-label="Claims surge severity by state">
        {features.map((f, i) => {
          const code = NAME_TO_CODE[f.properties.name]
          const r = code ? byCode.get(code) : undefined
          const d = path(f)
          if (!d) return null
          return (
            <motion.path
              key={f.properties.name}
              d={d}
              tabIndex={-1}
              fill={colorFor(r?.severeWeeks ?? 0)}
              stroke="#ffffff"
              strokeWidth={0.8}
              initial={{ opacity: 0 }}
              animate={{ opacity: hover && hover.stateCode !== code ? 0.55 : 1 }}
              transition={{ duration: 0.3, delay: hover ? 0 : i * 0.006 }}
              onMouseEnter={() => r && setHover(r)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: r ? "pointer" : "default" }}
            />
          )
        })}
      </svg>
      <div className="pointer-events-none absolute left-3 top-3 min-w-[220px] rounded-lg border border-hair bg-white/95 p-3 text-[12px] backdrop-blur">
        {hover ? (
          <>
            <div className="mb-1 text-[13px] font-medium">
              {hover.stateName} <span className="mono text-muted-foreground">{hover.stateCode}</span>
            </div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">SEVERE weeks</span><span className="num">{hover.severeWeeks}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">HIGH weeks</span><span className="num">{hover.highWeeks}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Peak surge</span><span className="num">{hover.peakMultiple ? `${hover.peakMultiple}x` : "n/a"}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Peak week</span><span className="num">{fmt.date(hover.peakWeek)}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Fraud OP last year</span><span className="num">{fmt.usd(hover.fraudDollarsLastYear)}</span></div>
          </>
        ) : (
          <span className="text-muted-foreground">Hover a state for surge detail</span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>Fewer SEVERE surge weeks (quantiles)</span>
        <span className="flex">
          {STOPS.map((s) => (
            <span key={s} className="h-2 w-6" style={{ background: s }} />
          ))}
        </span>
        <span>More</span>
      </div>
    </div>
  )
})
