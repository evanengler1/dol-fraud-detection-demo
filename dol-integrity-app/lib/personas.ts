export const PERSONAS = [
  "DOL_OUI_ANALYST",
  "DOL_WHD_INVESTIGATOR",
  "DOL_OSHA_INSPECTOR",
  "DOL_OIG_EXECUTIVE",
  "DOL_STATE_PARTNER_TX",
] as const

export type Persona = (typeof PERSONAS)[number]

export const WRITER_ROLE = "DOL_FRAUD_DEMO_ROLE"

export const PERSONA_META: Record<Persona, { label: string; agency: string; blurb: string }> = {
  DOL_OUI_ANALYST: { label: "OUI Integrity Analyst", agency: "ETA / OUI", blurb: "Full claim triage. SSN last 4, bank last 4." },
  DOL_WHD_INVESTIGATOR: { label: "WHD Investigator", agency: "WHD", blurb: "Employer risk and complaints. No claim data." },
  DOL_OSHA_INSPECTOR: { label: "OSHA Inspector", agency: "OSHA", blurb: "Employer risk and OSHA narratives. No claim data." },
  DOL_OIG_EXECUTIVE: { label: "OIG Executive", agency: "OIG", blurb: "Cross-agency view. Claimant PII redacted." },
  DOL_STATE_PARTNER_TX: { label: "Texas State Partner", agency: "TWC", blurb: "Texas rows only. Names abbreviated." },
}
