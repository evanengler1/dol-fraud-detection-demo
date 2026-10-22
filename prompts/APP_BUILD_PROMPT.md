# Prompt: DOL Program Integrity Command Center (React app, local first)

Use the `snowflake-apps` skill (create, then develop) with the `nextjs-template`. Build and run locally against Snowflake. Do NOT deploy until I approve the local build.

## Context

The data layer already exists in `DOL_FRAUD_DEMO` (built by SQL files 00-13 in this folder). Read `README.md` and the SQL files before writing code. Run `DESCRIBE` on every object you query. Do not guess column names. Never use mock or hardcoded data.

- Connection: `<your connection>`
- Role: `DOL_FRAUD_DEMO_ROLE`
- Warehouse: `DOL_FRAUD_WH`
- Audience: DOL leadership (OUI, WHD, OSHA, OIG)
- Lead story: OUI UI fraud
- Supporting story: cross-agency employer risk

Project root: `dol-integrity-app/` inside this folder.

## Design

- Light theme only. Remove the dark-mode toggle and force light. Make it flashy but government-credible: clean white surfaces, a navy/teal palette with one alert accent, motion on load and transitions.
- Charts: `recharts`. Icons: `lucide-react`.
- Ring graph: an npm-bundled library (for example `react-force-graph-2d`) or custom SVG/d3. No CDN scripts or remote fonts or images; bundle everything.
- Copy rules:
  - No em dashes anywhere in UI text.
  - Real employers appear only as `DISPLAY_ID`. Never show a real name or EIN.
  - Label synthetic data as synthetic.
- Every view shows provenance. Keep rule flags (R1-R6) visually distinct from ML scores. Show `DETECTION_SOURCE` (RULE_ONLY / ML_ONLY / BOTH).
- Persistent header containing:
  - App title.
  - Persona switcher.
  - Global search box.
  - A "data as of" timestamp.

## Views

### 1. Executive overview

- KPI tiles from `APP.V_KPI_HEADLINE`, including:
  - $462M (2025)
  - BAM peak 11.73%
  - SEVERE surge weeks
  - Cross-agency employers
  - Flagged claims
  - $ at risk
  - ML_ONLY catches
  - Rings
- US state choropleth of surge severity, using `ANALYTICS.V_CLAIMS_SURGE_ALERTS` and `DT_STATE_UI_BASELINE`. Bundle a TopoJSON in `public/`.
- Fraud-dollars forecast line with confidence band, from `ML.FRAUD_OP_FORECAST` plus the actuals.

### 2. Claims triage queue

- Paginated, sortable, filterable table over `ANALYTICS.V_CLAIM_RISK`.
- Filters: state, detection source, rule flag, score band.
- Use server-side pagination with `LIMIT`/`OFFSET` binds. Never ship 50k rows to the browser.
- Claim drawer, showing:
  - Rule flags and ML score.
  - Feature importance (`ML.CLAIM_MODEL_FEATURE_IMPORTANCE`).
  - Linked claims.
- Actions in the drawer, each writing to its table:

  | Action | Table |
  |---|---|
  | Assign / Escalate / Clear | `APP.CASE_ACTIONS` |
  | Refer to OIG | `APP.REFERRALS` |
  | Thumbs up/down on the ML score | `APP.MODEL_FEEDBACK` |

- After a write, show an optimistic update and confirm it with a re-read.

### 3. Fraud ring graph

- Interactive network from `APP.V_RING_GRAPH_EDGES` and `DT_CLAIM_RING_STATS`.
- Select a ring to load it.
- Nodes are claims and shared attributes (bank account, device, address, phone). Color nodes by attribute type and size them by risk.
- Clicking a node opens the claim drawer from view 2.
- Show ring stats: claim count, dollars, states spanned.

### 4. Employer 360

- Search/select an employer by `DISPLAY_ID`. Default to the hero `Employer #1000001`.
- Risk score breakdown from `ANALYTICS.EMPLOYER_RISK_360`, covering WHD, OSHA and OFLC components.
- Predecessor link (`#1000002`).
- AI case brief (`AI.EMPLOYER_CASE_BRIEF`).
- Complaints (`AI.COMPLAINT_ENRICHED`, with the translated text).
- OSHA narratives (`AI.OSHA_NARRATIVE_ENRICHED`).
- Timeline of enforcement events.

### 5. Architecture (animated, interactive)

A custom SVG flow diagram in three columns (sources, Snowflake layers, consumption) with animated particles moving along the edges. Lay it out from left to right as follows.

**Column 1: sources** (one node each, sized by row count queried live):
- S3 manual downloads (`s3://YOUR-BUCKET/dol-fraud-demo/`)
- ETA 539, 227, 5159 and 902P
- BAM
- Form 5500
- OFLC
- The `DOL_WHD_DEMO` and `DOL_OSHA_DEMO` databases (reused in place)
- Policy PDFs
- Synthetic claims (labeled synthetic)

**Column 2: Snowflake layers.** Show each layer below; the line under it is what clicking it reveals:
- **External stage and Python loaders**
  - Shows: the `RAW_PUBLIC` and `RAW_SYNTH` schemas.
- **Entity resolution**
  - Shows: EIN anchors plus Jaro-Winkler matching, producing 983,609 employers.
- **Dynamic Tables**
  - Shows: the 5-minute and 1-day lags, and the 5-step DT chain itself.
- **Employer risk procedure and weekly task**
- **ML**
  - Shows: anomaly detection, forecast, and the Python HistGradientBoosting classifier.
  - Note: the classifier is a Snowpark Python procedure because `ML.CLASSIFICATION` is broken on this account.
- **Cortex AI**
  - Shows: the PARSE, CLASSIFY, EXTRACT, TRANSLATE and COMPLETE functions, plus 3 Cortex Search services.
- **Semantic views**
- **Horizon governance**
  - Shows: tags, masking, row access, personas.
- **Alerts**

**Column 3: consumption**
- This app (`snow app` / SPCS)
- The CoWork agent (coming)
- Persona roles

Interactions:
- Hover a node to highlight its upstream and downstream lineage and dim everything else.
- Click a node to open a side panel with:
  - What the step does in plain language.
  - The SQL file that builds it (for example `06_curated_dynamic_tables.sql`).
  - Live stats queried from Snowflake (row counts, DT refresh state and lag via `INFORMATION_SCHEMA.DYNAMIC_TABLE_REFRESH_HISTORY`, last task run, model AUC from `ML.CLAIM_MODEL_METRICS`).
  - A short code snippet.
- A "Play the story" button that steps through the flow with a narrated caption per stage, from a claim arriving to a ring caught to an employer cross-referenced to a referral.
- Edges animate with stroke-dash offset or moving dots. Keep it at 60fps; animate only transform and opacity, and respect `prefers-reduced-motion`.

### Global search (Cortex Search only, no Analyst)

- Search box with a tab per service: `CS_POLICY_DOCS`, `CS_OSHA_NARRATIVES`, `CS_COMPLAINTS`.
- Call them from API routes with `SNOWFLAKE.CORTEX.SEARCH_PREVIEW(...)` and bind the query text.
- Show snippets with source labels.

## Product quality bar (Vercel / Linear / Granola feel)

The app should feel like a polished modern SaaS product, not a dashboard template.

- **Typography:**
  - Geist Sans and Geist Mono via the npm `geist` package, self-hosted. No Google Fonts CDN.
  - A tight type scale, large confident headlines on each page, and tabular numerals for all figures.
- **Surfaces:**
  - Near-white background (`#FAFAFA`) with white cards and 1px hairline borders (`#EAEAEA`).
  - Subtle shadows on hover only, 12px radius, generous whitespace on an 8px grid.
  - A faint grid or dot background pattern on hero areas.
- **Color:**
  - Mostly monochrome.
  - One brand accent (deep navy or teal) and one alert accent (amber or red) used sparingly for risk.
  - Charts use muted tones with the accent reserved for the key series.
- **Motion:**
  - `framer-motion` for page transitions, staggered card entrances and layout animations (drawer, tabs, filter chips).
  - Numbers count up on KPI tiles.
  - Springy but quick (200-300ms). Skeleton shimmer loaders, never spinners on a blank page.
- **Navigation:**
  - Slim top nav or collapsible left rail with active-route indicator animation.
  - A `Cmd+K` command palette (`cmdk`) that jumps to pages, employers, rings and claims, and runs searches.
  - Keyboard shortcuts in the triage queue (`j`/`k` to move, `e` to escalate).
- **Detail:**
  - Toasts (`sonner`) for write-back confirmations.
  - Empty and error states that are designed, not default text.
  - Tooltips everywhere numbers appear, explaining provenance.
  - A responsive layout down to laptop width.
- **Performance:**
  - No layout shift.
  - Prefetch on hover.
  - Route-level streaming with Suspense.
  - Memoized heavy components (the ring graph and the architecture SVG).
- Before building, look at vercel.com, linear.app, granola.ai, stripe.com (animated gradients, data-dense polish) and raycast.com (command palette, crisp micro-interactions) for reference, and describe the specific patterns you are borrowing.

## Persona switcher (read this carefully)

Personas:

- `DOL_OUI_ANALYST`
- `DOL_WHD_INVESTIGATOR`
- `DOL_OSHA_INSPECTOR`
- `DOL_OIG_EXECUTIVE`
- `DOL_STATE_PARTNER_TX`

Masking and the row access policy key off `CURRENT_ROLE()`.

There is a platform constraint: in SPCS the role cannot be changed after a caller's-rights session is established, and owner's-rights sessions run as the service role. So `USE ROLE` per request will not work once deployed.

Implement it so it works both locally and in SPCS:

- **Local:** keep one connection pool per persona role, each with that role as primary. The switcher picks the pool. Grant the persona roles to my user if they are not already granted, and tell me which grants you ran.
- **Deployed:** propose the approach before building it. My preferred option is a "persona preview" mode: owner's-rights queries through `APP` secure views or functions that apply the same masking and row filters keyed by a persona parameter, clearly labeled "Preview as persona". Alongside it, a "Signed in as" badge runs one caller's-rights query to show real enforcement for the actual user.
- Do not change the existing policies in `11_governance.sql` without asking me.

## Snowflake / SAR gotchas to respect

1. **Template files.**
   - Do not modify `lib/snowflake.ts` or the workspace-root pin in `next.config.mjs`.
   - Check for a `package-lock.json` in any parent folder; it silently re-roots Next.js.
2. **Query rules.**
   - Every page and route that queries Snowflake must declare `export const dynamic = "force-dynamic"`.
   - Client components fetch API routes and never import `querySnowflake`.
   - Use `querySnowflakeLongRunning` for anything that may exceed about 10 seconds (warehouse resume, search, aggregations).
3. **SQL safety.**
   - Bind every user-supplied value (`?` binds).
   - Allow-list sort columns and filter enums. Never concatenate them into SQL.
4. **Naming.**
   - Use fully qualified names (`DOL_FRAUD_DEMO.SCHEMA.OBJECT`) everywhere. Unqualified names resolve differently in SPCS sessions.
   - The Snowflake Node driver returns UPPERCASE column keys and NUMBER as strings or numbers depending on scale. Normalize them in a single mapper.
5. **Permissions.**
   - Caller's-rights queries need `GRANT CALLER ...` on the app owning role. Plan this for deploy, but do not run it yet.
   - The demo role must stay unmasked, because the DTs and procedures depend on it.
6. **Do not mutate the source pipeline.**
   - The app reads the DTs and the weekly-rebuilt `EMPLOYER_RISK_360`, and writes only to `APP.*` tables.
   - `EMPLOYER_RISK_360` is recreated weekly, so never attach policies to it from the app.
7. **Cost and latency.**
   - Cache KPI and forecast routes briefly (react-query `staleTime`).
   - Do not call `AI_COMPLETE` live; the briefs are precomputed.
   - Keep each query to one warehouse round trip.
8. **Manifest (`snow app setup`).**
   - Let the CLI choose the manifest layout (`app.yml` v2 preferred).
   - Put `label`, `description` and `icon` in the right place for that layout.
   - Replace the default `public/icon.svg` with a custom icon.

## Done criteria (local)

- `npm run build` passes with no type errors.
- The architecture page animates smoothly, its lineage highlight works, and its side panels show live stats.
- It passes a polish pass: no default-looking components, no em dashes, consistent spacing, and motion that feels intentional.
- All five views load real data in under 3 seconds when the warehouse is warm.
- The persona switch visibly changes masking (SSN, bank account, employer name) and TX row filtering.
- Write-back round-trips are verified by querying the `APP` tables.
- Search returns hits on all three services.
- Rewrite the README for the app.
- Report what was built and the deploy-time items (caller grants, the persona approach). Then stop for my review.
