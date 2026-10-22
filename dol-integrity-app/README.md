# DOL Fraud Detection and Prevention Command Center

A Next.js app on Snowflake App Runtime for detecting and preventing unemployment insurance (UI) fraud and cross-agency employer risk. It reads the data layer built by `../sql/00` through `../sql/13` and writes analyst decisions back to `DOL_FRAUD_DEMO.APP`.

> Claims, claimants, payments and complaints are **synthetic**. Real employers appear only as a `DISPLAY_ID` (for example `Employer #1000001`). Scores and flags are risk indicators, not findings of fraud.

## What it does

| View | Detect | Prevent |
|---|---|---|
| Overview | Public KPIs (ETA 227, BAM, ETA 539 surges, Employer 360), synthetic KPIs, surge map, fraud forecast | Live prevention scoreboard (dollars prevented vs still exposed) and detection-to-prevention funnel |
| Intercept queue | Rule flags R1 to R6 kept separate from the ML score; detection source (Rule only, ML only, Both) | Flagged claims with scheduled payments, ranked by dollars still to be paid. Hold payment, request ID verification, escalate, refer to OIG, assign, clear. Keyboard: `j` `k` `Enter` `h` `v` `e` `c` |
| Claim drawer | Rule reasons, ML probability, model drivers, masked identity, linked claims | Prevention actions, model feedback, audit trail |
| Fraud rings | Networks of 5+ claims sharing a bank account, device or phone | Hold every payment in a ring in one action |
| Employer 360 | Cross-agency risk (WHD, OSHA, OFLC), AI case brief, complaints, OSHA narratives, enforcement timeline, predecessor link | Refer to OIG, WHD or OSHA; escalate flagged ex-worker claims |
| Evidence search | Cortex Search over policy/OIG PDFs, OSHA narratives, worker complaints | |
| Architecture | Animated lineage of sources, Snowflake layers and consumers with live counts and the SQL file behind each node; "Play the story" walkthrough | |

"Dollars prevented" is the sum of scheduled (future-dated) payments in `RAW_SYNTH.UI_PAYMENT` on claims whose latest action in `APP.CASE_ACTIONS` is `HOLD_PAYMENT`.

## Run locally

```bash
npm install
SNOWFLAKE_CONNECTION_NAME=<your connection> npx next dev -p 3217
```

The connection comes from `~/.snowflake/connections.toml`. Your user needs the five persona roles plus `DOL_FRAUD_DEMO_ROLE` (all granted by `../sql/11_governance.sql`).

## Personas and governance

The header switcher runs queries as one of `DOL_OUI_ANALYST`, `DOL_WHD_INVESTIGATOR`, `DOL_OSHA_INSPECTOR`, `DOL_OIG_EXECUTIVE`, `DOL_STATE_PARTNER_TX`.

- **Local:** each persona gets its own connection pool with that role as the primary role, and each connection runs `USE SECONDARY ROLES NONE`. Masking and `RAP_CLAIM_STATE` apply for real. Denied objects show a designed "Restricted by governance" state; the app does not hide anything itself.
- **Writes and aggregates:** go through one writer connection (`DOL_FRAUD_DEMO_ROLE` locally, the service owner role in SPCS). `ACTED_ROLE` records the active persona. Writes check visibility as the persona first. Platform-pool aggregates honour `GOVERNANCE.ROLE_STATE_ACCESS`.
- **Ring identifiers:** raw bank, phone and device values never leave the server. Rings are addressed by a SHA2 hash and labelled with the last 4 characters.

## Code map

| Path | Purpose |
|---|---|
| `lib/server/db.ts` | Persona pools, writer pool, SPCS fallback to `lib/snowflake.ts`, `RestrictedError` |
| `lib/server/route.ts` | Route wrapper, cached access probe, `STATE_SCOPE` |
| `lib/server/sql.ts` | Shared SQL fragments (exposure, latest action, status, ring lookup) |
| `lib/server/map.ts` | The single row mapper (`normalizeRows`) |
| `app/api/*` | 14 `force-dynamic` routes; every user value is bound |
| `components/kit.tsx` | KPI, provenance, rule flag, ML score, status, restricted and empty states |
| `components/shell.tsx` | Header, rail, persona switcher, Cmd+K palette |
| `lib/snowflake.ts` | Template connection layer (unmodified) |

## Deploy

`snowflake.yml` targets `DOL_FRAUD_DEMO.APP.DOL_FRAUD_PREVENTION_APP` on `DOL_FRAUD_WH`. `app.yml` holds build/run phases and the `profile:` label and icon. From this folder, after `sql/00`-`14` have run:

```bash
npm install
snow app deploy --role DOL_FRAUD_DEMO_ROLE
```

Pass `--role` explicitly: without it the CLI uses your connection's default role and the app ends up owned by the wrong role. Then grant `USAGE` on the application service to the roles that should open it.

### Deploy checklist

1. **Service role grants:** `SELECT` on the objects the app reads, and `INSERT, SELECT` on `APP.CASE_ACTIONS`, `APP.REFERRALS` and `APP.MODEL_FEEDBACK`, for the service owner role.
2. **Caller's rights (optional):** `GRANT CALLER` on the needed objects to the app owner role, then pass `callersRights: true` for reads that should run as the signed-in user.
3. **Persona emulation in SPCS:** the role cannot change per request in a deployed service, so persona reads run with owner's rights and `lib/server/emulate.ts` applies each persona's grants (snapshot in `lib/server/persona-grants.json`), masking (mirrors the `MP_*` policies) and state scope (`ROLE_STATE_ACCESS`). This is on by default in SPCS; run locally with `PERSONA_MODE=emulate` to test it. The service must run as `DOL_FRAUD_DEMO_ROLE` (or another role the masking policies leave unmasked). After changing grants in `11_governance.sql`, run `scripts/snapshot-grants.sh`. Set `DEMO_RESET_ENABLED=false` to disable Reset demo.
4. **Network and egress:** confirm the account network policy allows the App Runtime endpoint. No external access integration is needed (fonts and map data are bundled).
5. Do not set `NODE_ENV` in the manifest.

## Known notes

- `ANALYTICS.DT_CLAIM_LINKS` and `DT_CLAIM_RING_STATS` are currently **suspended**, so ring data is frozen at the last refresh. The architecture panel reports this live.
- The fraud forecast covers the 6 states in `ML.FRAUD_OP_FORECAST` (CA, FL, GA, NY, PA, TX) and is summed.
- `__tests__/lib/snowflake.test.ts` is the template's test for `lib/snowflake.ts` and has pre-existing type errors; app code type-checks clean.
