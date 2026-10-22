# Prompt: DOL Fraud Detection and Prevention CoWork Agent (deliverable 3)

Use the `agent-studio` skill (Cortex Agent create, then evaluate). Build the agent as reproducible SQL in `sql/10_agent.sql`, test it from SQL, then stop for my review. Do NOT add it to Snowflake Intelligence until I approve the test results.

## Context

Deliverables 1 and 2 are done. The data layer lives in `DOL_FRAUD_DEMO` (SQL files 00-13 in this folder). The React app "DOL Fraud Detection and Prevention Command Center" is deployed as `DOL_FRAUD_DEMO.APP.DOL_FRAUD_PREVENTION_APP`. Its architecture page already shows the CoWork agent as built, so this agent must match that page:

- Name: `DOL_FRAUD_DEMO.ANALYTICS.DOL_FRAUD_AGENT`
- Surface: Snowflake Intelligence (CoWork)
- Tools: 2 semantic views and 3 Cortex Search services

Read `README.md`, `sql/09_semantic_views.sql`, `sql/08_cortex_ai.sql` and `sql/11_governance.sql` before writing anything. Run `DESCRIBE SEMANTIC VIEW` and `SHOW CORTEX SEARCH SERVICES IN DATABASE DOL_FRAUD_DEMO` to confirm names, columns and verified queries. Do not guess names. Never use mock data.

- Connection: `<your connection>` (pass it explicitly)
- Role: `DOL_FRAUD_DEMO_ROLE` (owns every object). Use `ACCOUNTADMIN` only for the Snowflake Intelligence step.
- Warehouse: `DOL_FRAUD_WH`
- Audience: DOL leadership (OUI, WHD, OSHA, OIG)
- Lead story: OUI UI fraud detection and prevention
- Supporting story: cross-agency employer risk

The spec planned four agents (Build Spec section 11). Build ONE executive agent instead, because the app and the architecture page tell a single-agent story. Its persona governance comes from Snowflake roles, not from separate agents.

## Tools (verified 2026-10-14)

| Tool name | Type | Object | Use it for |
|---|---|---|---|
| `ui_integrity` | Cortex Analyst | `DOL_FRAUD_DEMO.ANALYTICS.SV_UI_INTEGRITY` | Public UI trends (ETA 539 claims, ETA 227 fraud overpayments and recovery, BAM fraud rates, surge alerts, fraud forecast) and synthetic claims (flagged claims, rules R1-R6 vs ML, detection source, dollars at risk, fraud rings) |
| `employer_risk` | Cortex Analyst | `DOL_FRAUD_DEMO.ANALYTICS.SV_EMPLOYER_RISK` | Cross-agency employer risk (WHD back wages, OSHA penalties and willful/repeat, OFLC H-2A wage gaps, ITA underreporting), AI case briefs, complaint routing, OSHA accident counts |
| `policy_search` | Cortex Search | `DOL_FRAUD_DEMO.AI.CS_POLICY_DOCS` | OIG audits, BAM PIIA report, UIPL 16-21 guidance. Cite `DOC_TITLE` and `PAGE_NUMBER` |
| `osha_narratives` | Cortex Search | `DOL_FRAUD_DEMO.AI.CS_OSHA_NARRATIVES` | Public OSHA accident abstracts. Cite `DISPLAY_ID`, `EVENT_DATE`, `EVENT_TYPE` |
| `worker_complaints` | Cortex Search | `DOL_FRAUD_DEMO.AI.CS_COMPLAINTS` | Synthetic worker complaints, English and translated Spanish, with AI routing. Cite `DISPLAY_ID`, `ROUTE_TO_AGENCY` |

Each search tool needs `id_column` and `title_column` set to real columns (for example `CHUNK_ID`/`DOC_TITLE`, `SUMMARY_NR`/`DISPLAY_ID`, `COMPLAINT_ID`/`DISPLAY_ID`). Confirm against the service definitions.

Write a tool `description` for each tool that says what data it holds, whether it is public or synthetic, and when NOT to use it. The descriptions drive routing, so they matter more than the instructions.

## Step 0: Governance check before building (required)

1. **Raw ring identifiers.** `SV_UI_INTEGRITY` exposes `RINGS.LINK_VALUE`: the raw shared bank account, device or IP value behind a ring. The app never sends these values to the browser.
   - Option A: remove the dimension from the semantic view.
   - Option B: replace it with a masked form (last 4 for bank accounts, a hashed label for devices and IPs).
   - Show me which you recommend, make the change in `09_semantic_views.sql`, and re-create the view. Do not let the agent return raw link values to any role.
2. **Masking and row access reach the agent.** In Snowflake Intelligence, agents run with the caller's rights. So masking (`MP_*`) and row access (`RAP_CLAIM_STATE`) apply for real to each persona role.
   - Confirm `SV_UI_INTEGRITY` queries `RAW_SYNTH.UI_CLAIM` or `ANALYTICS.V_CLAIM_RISK`, so the TX partner gets Texas rows only.
   - List any table in either semantic view that has no policy coverage.
3. **Agent access per persona.** Map each persona's grants (`SHOW GRANTS TO ROLE`) to the five tools.
   - Today, for example, OUI has `SV_UI_INTEGRITY` and `CS_POLICY_DOCS` but not `SV_EMPLOYER_RISK`. WHD has `CS_COMPLAINTS` but not `CS_OSHA_NARRATIVES`.
   - Show me the table. Do not add grants to make tools work; a denied tool is part of the governance story.

## Agent spec

`CREATE AGENT ... FROM SPECIFICATION $$ ... $$` in `sql/10_agent.sql`, re-runnable (`CREATE OR REPLACE`; specs cannot be altered).

- `models.orchestration`: `auto` unless a test shows a reason to pin one.
- `profile.display_name`: "DOL Fraud Detection and Prevention Agent".
- `tool_resources`: a top-level key keyed by tool name, not nested under each tool. Set `execution_environment.warehouse` to `DOL_FRAUD_WH` for the Analyst tools.

### Orchestration instructions (write these in full)

- Numbers come from the semantic views; narratives, guidance and quotes come from search. For a briefing, combine both.
- Public versus synthetic:
  - Public: ETA 539/227/5159/902P, BAM/PIIA, WHD, OSHA, ITA, OFLC, Form 5500 and the policy PDFs.
  - Synthetic: claims, claimants, payments, rings, complaints, and synthetic employers (`DATA_ORIGIN` / `IS_SYNTHETIC`).
  - Never blend the two into one number without saying so.
- Employer questions: resolve by `DISPLAY_ID`. Real employers have no name in the views; never try to infer one. The hero employer is synthetic: "Employer #1000001" (Summit Ridge Staffing LLC, TX), with predecessor SYN-PRED-001.
- If a tool is denied for the caller's role, do not retry with other tools to get around it. Say the data is restricted for that role and name the agency that owns it.
- For "what should we do" questions, ground recommendations in the detection signals: rules R1-R6, ML probability, ring size, and scheduled payments still to be released. Point to the app's Intercept queue for prevention actions. The agent itself does not write anything.

### Response instructions (write these in full)

- Lead with the answer in one or two sentences, then a short table when there are three or more rows.
- Label every answer **Public data**, **Synthetic data**, or **Public and synthetic**, and name the source (semantic view, or document title and page).
- Treat risk scores and ML probabilities as indicators for review, not findings of fraud. Say "flagged" or "indicators", never "fraudulent employer" or "committed fraud".
- Show real employers only as `Employer #<DISPLAY_ID>`. Never show an SSN, a full bank account, an email or a phone number. Show only what the masking policy returns, and never reconstruct a value.
- No em dashes. Plain, government-credible tone. Dollar figures rounded to sensible precision ($462M, $20,993).
- When a question is out of scope (benefits eligibility for a person, legal conclusions), say so briefly.

### Sample questions (put the best 5 in the spec as `sample_questions`)

OUI fraud, detection and prevention:
1. "What were total UI fraud overpayments by year since 2019?" (public, verified query)
2. "Which states had the highest BAM fraud rate at the pandemic peak?" (public)
3. "How many synthetic claims did ML catch that the rules missed?" (synthetic, verified query)
4. "Which fraud rings span the most states, and how many dollars are at risk?" (synthetic, verified query)
5. "What does UIPL 16-21 say about identity verification?" (policy search)

Cross-agency employer risk:

6. "Which employers have risk signals from all three DOL agencies?" (verified query)
7. "Give me a briefing on Employer #1000001." (case brief, risk reasons, complaints, ex-worker claims)
8. "What are the highest-risk staffing employers in Texas?" (verified query)
9. "Find accident narratives about trench collapses involving temp workers." (OSHA search)
10. "Show worker complaints in Spanish about unpaid overtime and where they were routed." (complaints search)

## Testing (required, from SQL)

Test with `SNOWFLAKE.CORTEX.DATA_AGENT_RUN('DOL_FRAUD_DEMO.ANALYTICS.DOL_FRAUD_AGENT', $${"messages":[...],"stream":false}$$)`. The final answer is the last `content[]` item with `type = 'text'`.

1. Run all 10 sample questions as `DOL_FRAUD_DEMO_ROLE`. For each Analyst answer, show the generated SQL (`tool_use` input) and check the numbers against a direct query of the same object. The app's KPIs are a cross-check: $462M (2025), BAM peak 11.73%, about $20,993 prevented after a demo reset.
2. Persona matrix: run questions 3, 6, 7 and 10 as each persona role (`USE ROLE <persona>; USE SECONDARY ROLES NONE;`). Expected:
   - OUI gets claims but is restricted on employer risk.
   - WHD and OSHA get employer risk but are restricted on claims.
   - The TX partner gets Texas-only claim counts (compare with the app's 8,196 scored claims for TX).
   - OIG gets everything.
   - No persona ever sees an unmasked SSN or bank account, or a raw ring link value.
3. Multi-turn: question 7, then "What should OIG do next?" The follow-up must stay on the same employer and label its sources.
4. Report a pass/fail table: question, role, tools called, source label present, numbers verified, governance correct.

Use `evaluate_semantic_view` on both semantic views if useful. In this account its LLM judge calls a model that does not exist, so read the generated SQL yourself.

## Snowflake Intelligence (after my approval only)

1. `GRANT USAGE ON AGENT DOL_FRAUD_DEMO.ANALYTICS.DOL_FRAUD_AGENT TO ROLE <each persona role>` (and `DOL_FRAUD_DEMO_ROLE`).
2. As `ACCOUNTADMIN`: `ALTER SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT ADD AGENT DOL_FRAUD_DEMO.ANALYTICS.DOL_FRAUD_AGENT`.
3. Give me the steps to try it at https://ai.snowflake.com, switching roles to show governance.

## Gotchas to respect

- `CREATE AGENT`, not `CREATE CORTEX AGENT`. The spec goes in `FROM SPECIFICATION $$...$$`. `COMMENT` and `PROFILE` go before `FROM SPECIFICATION`. There is no `QUERY_WAREHOUSE` property. Changing a spec means `CREATE OR REPLACE`.
- `tool_resources` sits next to `tools`, keyed by tool name.
- Semantic view changes go through `SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML` (as in `09`). Quote YAML values that contain commas. `verified_at` is epoch seconds.
- `snow sql` splits `BEGIN...END`; wrap blocks in `EXECUTE IMMEDIATE $$`, or run through `scripts/run_sql.sh`.
- Persona tests need `USE SECONDARY ROLES NONE`, or grants leak from my other roles.
- Do not change `11_governance.sql` grants to make a test pass. Report it instead.

## Done criteria

- `sql/10_agent.sql` runs cleanly from scratch after files 00-13, and `99_teardown.sql` drops the agent.
- Step 0 findings reported, and the ring link value is no longer exposed.
- All 10 sample questions answered with correct numbers and source labels as the owner role.
- Persona matrix matches the expected governance with no PII leaks.
- `README.md` gets a short "CoWork agent" section: tools, sample questions, and how to add it to Snowflake Intelligence.
- Stop and show me the test table. No Snowflake Intelligence step until I approve.
