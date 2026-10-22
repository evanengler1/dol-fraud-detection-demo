"use client"

import { ArchitectureFlow } from "@/components/architecture-flow"
import { PageHeader } from "@/components/kit"

export default function ArchitecturePage() {
  return (
    <>
      <PageHeader
        eyebrow="Platform  /  How it is built"
        title="One governed platform, source to referral."
        sub="Hover a node to trace its lineage. Click it for what it does, the SQL file that builds it, and live stats from Snowflake. Or play the story of a claim caught and stopped."
      />
      <ArchitectureFlow />
    </>
  )
}
