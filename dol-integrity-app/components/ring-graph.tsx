"use client"

import dynamic from "next/dynamic"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import type { ForceGraphMethods, NodeObject } from "react-force-graph-2d"

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false })

export interface RingNode {
  kind: "CLAIM" | "ATTR"
  nodeId: string
  label: string
  nodeType: string
  stateCode?: string
  priorityScore?: number
  detectionSource?: string
  exposure?: number
  isHeld?: boolean
}
export interface RingLink {
  source: string
  target: string
  type: string
}

export const ATTR_COLORS: Record<string, string> = {
  BANK_ACCOUNT: "#2563a8",
  DEVICE: "#7c5cc4",
  PHONE: "#d97706",
  IP: "#64748b",
  EMAIL: "#c2417a",
}

type GNode = NodeObject & RingNode

export const RingGraph = memo(function RingGraph({
  nodes,
  links,
  onClaim,
}: {
  nodes: RingNode[]
  links: RingLink[]
  onClaim: (id: string) => void
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const fg = useRef<ForceGraphMethods<GNode> | undefined>(undefined)
  const [size, setSize] = useState({ w: 800, h: 520 })
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    if (!wrap.current) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: 520 }))
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [])

  const data = useMemo(
    () => ({ nodes: nodes.map((n) => ({ ...n, id: n.nodeId })) as GNode[], links: links.map((l) => ({ ...l })) }),
    [nodes, links],
  )
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const l of links) {
      if (!m.has(l.source)) m.set(l.source, new Set())
      if (!m.has(l.target)) m.set(l.target, new Set())
      m.get(l.source)!.add(l.target)
      m.get(l.target)!.add(l.source)
    }
    return m
  }, [links])

  useEffect(() => {
    const t = setTimeout(() => fg.current?.zoomToFit(500, 40), 900)
    return () => clearTimeout(t)
  }, [data])

  const lit = (id: string) => !hover || hover === id || neighbors.get(hover)?.has(id)

  return (
    <div ref={wrap} className="relative overflow-hidden rounded-xl border border-hair bg-[radial-gradient(circle_at_1px_1px,rgb(11_37_69/0.08)_1px,transparent_0)] [background-size:18px_18px]">
      <ForceGraph2D
        ref={fg as never}
        graphData={data}
        width={size.w}
        height={size.h}
        cooldownTicks={120}
        backgroundColor="rgba(0,0,0,0)"
        linkColor={(l) => {
          const s = typeof l.source === "object" ? (l.source as GNode).id : l.source
          const t = typeof l.target === "object" ? (l.target as GNode).id : l.target
          const on = !hover || hover === s || hover === t
          return on ? "rgba(11,37,69,0.22)" : "rgba(11,37,69,0.05)"
        }}
        linkWidth={1}
        onNodeHover={(n) => setHover(n ? String((n as GNode).id) : null)}
        onNodeClick={(n) => {
          const g = n as GNode
          if (g.kind === "CLAIM") onClaim(g.nodeId)
        }}
        nodeLabel={(n) => {
          const g = n as GNode
          return g.kind === "CLAIM"
            ? `${g.label}  ${g.stateCode}  priority ${Math.round(g.priorityScore ?? 0)}${g.isHeld ? "  HELD" : ""}`
            : g.label
        }}
        nodeCanvasObject={(n, ctx, scale) => {
          const g = n as GNode
          const alpha = lit(String(g.id)) ? 1 : 0.15
          ctx.globalAlpha = alpha
          if (g.kind === "ATTR") {
            const r = 9
            ctx.fillStyle = ATTR_COLORS[g.nodeType] ?? "#64748b"
            ctx.beginPath()
            ctx.roundRect((g.x ?? 0) - r, (g.y ?? 0) - r, r * 2, r * 2, 3)
            ctx.fill()
            if (scale > 1.2) {
              ctx.font = `${10 / scale + 2}px var(--font-geist-sans)`
              ctx.fillStyle = "#0a0a0a"
              ctx.textAlign = "center"
              ctx.fillText(g.label, g.x ?? 0, (g.y ?? 0) + r + 9)
            }
          } else {
            const r = 3 + ((g.priorityScore ?? 0) / 100) * 5
            ctx.beginPath()
            ctx.arc(g.x ?? 0, g.y ?? 0, r, 0, 2 * Math.PI)
            ctx.fillStyle = g.isHeld ? "#0e7c7b" : g.detectionSource === "NONE" ? "#c9d5e3" : "#0b2545"
            ctx.fill()
            if (!g.isHeld && (g.exposure ?? 0) > 0) {
              ctx.strokeStyle = "#d97706"
              ctx.lineWidth = 1.5
              ctx.stroke()
            }
          }
          ctx.globalAlpha = 1
        }}
        nodePointerAreaPaint={(n, color, ctx) => {
          const g = n as GNode
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(g.x ?? 0, g.y ?? 0, 10, 0, 2 * Math.PI)
          ctx.fill()
        }}
      />
    </div>
  )
})
