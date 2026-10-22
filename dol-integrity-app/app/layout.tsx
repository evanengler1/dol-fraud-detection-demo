import type { Metadata } from "next"
import type React from "react"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { AppShell } from "@/components/shell"
import { APP_TITLE, LOGO_SRC } from "@/lib/constants"
import "./globals.css"

export const metadata: Metadata = {
  title: APP_TITLE,
  description:
    "Detect and prevent unemployment insurance fraud and cross-agency employer risk on Snowflake. Synthetic claim data; public DOL data.",
  icons: { icon: LOGO_SRC },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
