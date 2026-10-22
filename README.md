# DOL Fraud Detection Demo on Snowflake

How the U.S. Department of Labor could detect, investigate and prevent unemployment insurance (UI) fraud and employer noncompliance in one governed platform. It combines DOL's own public data with synthetic claim-level data.

> **Data notice.** Objects are labeled **(public)** or **(synthetic)** in table comments, semantic view descriptions and the `DATA_ORIGIN` tag.
>
> - Public data comes from oui.doleta.gov, osha.gov, enforcedata.dol.gov, askebsa.dol.gov, the OFLC performance data page and data.bls.gov, retrieved 2026-10-13.
> - Synthetic claimants, claims, payments, wage records, complaints and fictional employers are not real individuals or businesses.
> - Real employers appear only under a pseudonymous `DISPLAY_ID` and are never given a synthetic fraud flag.
> - Risk scores and flags are risk indicators for prioritization, not findings of fraud or violation.

## Repository layout

| Path | Contents |
|---|---|
| `sql/` | Numbered build scripts, run in the order under [Run order](#run-order). The same files are in the Snowsight workspace "DoL Fraud Demo". |
| `prereqs/` | Scripts that build the WHD and OSHA databases this demo reads. Run first. |
| `dol-integrity-app/` | React command center, deployed to Snowflake App Runtime |
| `streamlit/credit_tracker/` | Streamlit app that tracks the credits used by the app and the agent |
| `scripts/` | `run_sql.sh` (runs SQL files with the Snowflake CLI) and `agent_test.py` (agent tests per persona) |
| `prompts/` | The specs used to build the demo, kept for reference |

Placeholders to replace before you run anything: `YOUR-BUCKET` (S3 bucket), the role ARN in the `DOL_S3_INT` template (`sql/00_setup.sql`), and your Snowflake CLI connection name (`SNOWFLAKE_CONNECTION`, default `default`).

## What it shows

| Story | Data | Snowflake features |
|---|---|---|
| UI integrity baseline: the 2020 surge, fraud overpayments, detection methods, recovery | ETA 539, 227, 5159, 902P; BAM / PIIA (public) | Dynamic Tables, Cortex `ANOMALY_DETECTION`, `FORECAST` |
| Claim triage: six seeded fraud patterns, rules plus ML side by side | Synthetic claims calibrated to ETA 539, QCEW and BAM | Dynamic Tables, Snowpark Python ML, row access by state |
| Fraud rings: shared bank accounts, device farms, multi-state SSNs | Synthetic | Link graph Dynamic Tables, alerts |
| Employer Risk 360: one employer view across WHD, OSHA/ITA, OFLC | WHD, OSHA, ITA 300A/301, OFLC H-2A/H-2B, Form 5500, QCEW (public), plus the fictional hero employer | Entity resolution (EIN anchors plus Jaro-Winkler), weekly task |
| Unstructured evidence: OIG audits, OSHA narratives, worker complaints in English and Spanish | OIG / BAM / UIPL PDFs and OSHA abstracts (public); complaints (synthetic) | `AI_PARSE_DOCUMENT`, `AI_CLASSIFY`, `AI_EXTRACT`, `AI_TRANSLATE`, `AI_COMPLETE`, Cortex Search |
| Natural-language questions | Everything above | Semantic views for Cortex Analyst / CoWork |
| Trust | All | Tags, masking (SSN, bank, PII, employer names, EIN), row access, audit history |

**Hero employer** (fictional): *Summit Ridge Staffing LLC*, `Employer #1000001`, a San Antonio staffing firm. Its risk signals:
- **WHD:** repeat H-2A and FLSA findings.
- **OSHA:** failure-to-abate citations, and zero recordable injuries on ITA despite 5 serious citations.
- **OFLC:** offered wage at 38% of the QCEW industry wage.
- **Workforce:** a 1099-to-W-2 ratio of 9.5x, and 140 ex-workers flagged for working while claiming.
- **Successor link:** possibly a successor to a debarred predecessor (`Employer #1000002`).

## Data sources

Download the files below (links in [Source links](#source-links)) and upload them to your own bucket under `s3://YOUR-BUCKET/dol-fraud-demo/`, keeping these folder names:

| Folder | Files |
|---|---|
| `oui/` | `ar539.csv`, `ar227.csv`, `ar5159.csv`, `ap902.csv`, `IPIA_2020_Thru_PIIA_2024_Integrity_Rates_by_Quarter_&_State.xlsx`, `PIIA_2024_Integrity_Rates_By_Cause.xlsx` |
| `employer/` | ITA 300A (2024 zip, 2025 csv), ITA case detail 2025 csv, `OSHA_accident_abstract.zip`, `F_5500_2024_Latest.zip`, `H-2A_Disclosure_Data_FY2025_Q4.xlsx`, `H-2B_Disclosure_Data_FY2025_Q4.xlsx`, `H-2B_Foreign_Labor_Recruiter_List_FY2026_Q3.xlsx`, `2024_annual_singlefile.zip` (QCEW) |
| `docs/` | BAM PIIA 2024 Annual Report; OIG 19-22-006, 19-23-005, 19-23-011, 19-23-012; UIPL 16-21 |

The `DOL_WHD_DEMO.TRANSFORMED` and `DOL_OSHA_DEMO.TRANSFORMED` data is read in place (views in `CURATED`), not copied. Build those two databases first (see [Prerequisites](#prerequisites)).

## Prerequisites

1. **A Snowflake account and a user with ACCOUNTADMIN.** Cortex AI functions, Cortex Search, Cortex Agents, Snowflake Intelligence (CoWork), Snowflake App Runtime and Streamlit container runtime must be available in your region.
2. **An S3 bucket and storage integration `DOL_S3_INT`.** Create it with the commented template in `sql/00_setup.sql`, then follow Snowflake's [S3 storage integration guide](https://docs.snowflake.com/en/user-guide/data-load-s3-config-storage-integration) to trust it in AWS IAM. Replace `YOUR-BUCKET` in `sql/01_ingest_s3.sql` and in the `prereqs/` stage definitions.
3. **The WHD and OSHA databases.** Run `prereqs/osha/` and then `prereqs/whd/` (see the README in each). They build `DOL_OSHA_DEMO.TRANSFORMED` and `DOL_WHD_DEMO.TRANSFORMED`, which this demo reads.
4. **Snowflake CLI 3.14 or later** to deploy the React app and the Streamlit tracker, and **Node 20+** to build the React app.

## Run order

Run as a user with ACCOUNTADMIN. Every file sets its own role and warehouse.

| File | Purpose | Notes |
|---|---|---|
| `sql/00_setup.sql` | Role `DOL_FRAUD_DEMO_ROLE`, warehouse `DOL_FRAUD_WH`, database `DOL_FRAUD_DEMO` and schemas | ACCOUNTADMIN; uses storage integration `DOL_S3_INT` (template in the file) |
| `sql/01_ingest_s3.sql` | S3 stage and Python loaders (unzip, CSV, XLSX), then 16 RAW tables | ~10 min. In Snowsight run as is; with the snow CLI add `--enable-templating NONE` (file names contain `&`) |
| `sql/02_curated_public.sql` | Typed public tables (ETA cell map from ET Handbook 402) and views over WHD/OSHA | |
| `sql/03_eda.sql` | Exploratory analysis: coverage, quality, fraud trends, join potential, state selection | Read only |
| `sql/04_entity_resolution.sql` | Employer master across 5 sources | ~5 min |
| `sql/05_synthetic_data.sql` | Claimants, claims, payments, wages, new hires, complaints, fictional employers, seeded patterns | Deterministic; rerun 06 to 13 afterwards |
| `sql/06_curated_dynamic_tables.sql` | State baseline and claims Dynamic Tables, rule flags, employer risk procedure and weekly task | |
| `sql/07_ml_models.sql` | Anomaly detection, forecast, claim classifier, triage view `V_CLAIM_RISK` | |
| `sql/08_cortex_ai.sql` | PDF parsing, narrative and complaint enrichment, case briefs, 3 Cortex Search services | ~13 min; about 1.9M input tokens |
| `sql/09_semantic_views.sql` | `SV_UI_INTEGRITY`, `SV_EMPLOYER_RISK` with verified queries, ring summary view `V_RING_SUMMARY` (masked link labels) | |
| `sql/11_governance.sql` | Persona roles, tags, masking, row access, audit queries | Rerun after 05 or 06 |
| `sql/12_alerts.sql` | New ring, claims surge and cross-agency employer alerts (created suspended) | Includes a commented live-demo script |
| `sql/13_app_support.sql` | App write-back tables, KPI and ring graph views | |
| `sql/10_agent.sql` | CoWork agent `DOL_FRAUD_AGENT` and persona usage grants | Run last, after 00-13 (needs the persona roles from 11) |
| `sql/14_credit_tracker.sql` | `COST` schema: credit views for the app and agent, usage-view grants, PyPI integration for Streamlit | ACCOUNTADMIN; after 10. Rerun section 2 when apps are added or dropped |
| `sql/99_teardown.sql` | Drops everything this demo created | Irreversible; leaves WHD/OSHA demos and S3 alone |

The React app ("DOL Fraud Detection and Prevention Command Center") lives in `dol-integrity-app/` and is deployed as `DOL_FRAUD_DEMO.APP.DOL_FRAUD_PREVENTION_APP`.

The credit tracker (Streamlit) lives in `streamlit/credit_tracker/` and is deployed as `DOL_FRAUD_DEMO.COST.DOL_CREDIT_TRACKER`. See [Credit tracker](#credit-tracker).

`scripts/run_sql.sh` runs files with the snow CLI and stops on the first error:

```bash
scripts/run_sql.sh 05_synthetic_data.sql 06_curated_dynamic_tables.sql 07_ml_models.sql
```

## Key results (2026-10-13 build)

Public data:
- **Claims surge (ETA 539):** the 2020 peak reached 83x the 2019 median in FL and 80x in GA. The anomaly model flags 1,092 SEVERE state-weeks in 2020.
- **Fraud overpayments (ETA 227):** $674M established in 2024 and $462M in 2025. Wage/benefit crossmatch found 31% of fraud dollars over the last 3 years.
- **BAM fraud rate:** peaked at 11.7% nationally in 2020 Q4; the 2019 Q3 to 2024 Q2 mean is 6.4%.

Entity resolution:
- 1.95M source records resolved to 983,609 employers.
- 12,671 employers appear in 2+ agencies, and 579 in all three.
- 1,583 real employers carry risk signals from 2+ agencies.

Synthetic claims:
- **Volume:** 50,393 current claims, with a seeded fraud share of 6.5% to 8.5% per state.
- **Rule precision:** 99–100% for R1, R2, R3, R5 and R6. R4 (working while claiming) is 75%, because legitimate return-to-work hires look similar.
- **Rules plus ML:** ML catches the claims the rules miss (`DETECTION_SOURCE = 'ML_ONLY'`) and clears the R4 false positives.

## CoWork agent

`DOL_FRAUD_DEMO.ANALYTICS.DOL_FRAUD_AGENT` ("DOL Fraud Detection and Prevention Agent") is one executive agent for OUI, WHD, OSHA and OIG leadership. Persona governance comes from Snowflake roles: in Snowflake Intelligence the agent runs with the caller's rights, so grants, masking and row access apply to each persona.

| Tool | Type | Object | Data |
|---|---|---|---|
| `ui_integrity` | Cortex Analyst | `ANALYTICS.SV_UI_INTEGRITY` | Public UI trends (ETA, BAM, surges, forecast) and synthetic claims, rules, ML and rings |
| `employer_risk` | Cortex Analyst | `ANALYTICS.SV_EMPLOYER_RISK` | Cross-agency employer risk, AI case briefs, complaint and accident counts |
| `policy_search` | Cortex Search | `AI.CS_POLICY_DOCS` | OIG audits, BAM PIIA report, UIPL 16-21 (public) |
| `osha_narratives` | Cortex Search | `AI.CS_OSHA_NARRATIVES` | OSHA accident abstracts (public) |
| `worker_complaints` | Cortex Search | `AI.CS_COMPLAINTS` | Worker complaints, English and translated Spanish (synthetic) |

Tools each persona can use (from `11_governance.sql`; a denied tool is reported as restricted, never worked around):

| Role | Tools |
|---|---|
| `DOL_OUI_ANALYST` | ui_integrity, policy_search |
| `DOL_WHD_INVESTIGATOR` | employer_risk, worker_complaints, policy_search |
| `DOL_OSHA_INSPECTOR` | employer_risk, osha_narratives, policy_search |
| `DOL_STATE_PARTNER_TX` | ui_integrity (Texas claims only), policy_search |
| `DOL_OIG_EXECUTIVE` | all five |

Sample questions:
1. What were total UI fraud overpayments by year since 2019?
2. Which states had the highest BAM fraud rate at the pandemic peak?
3. How many synthetic claims did ML catch that the rules missed?
4. Which fraud rings span the most states, and how many dollars are at risk?
5. What does UIPL 16-21 say about identity verification?
6. Which employers have risk signals from all three DOL agencies?
7. Give me a briefing on Employer #1000001. (follow up: What should OIG do next?)
8. What are the highest-risk staffing employers in Texas?
9. Find accident narratives about trench collapses involving temp workers.
10. Show worker complaints in Spanish about unpaid overtime and where they were routed.

Test from SQL with `scripts/agent_test.py <out_dir> <cases.json>` (calls `SNOWFLAKE.CORTEX.DATA_AGENT_RUN` per role with secondary roles off).

Add to Snowflake Intelligence (as ACCOUNTADMIN, after review):

```sql
ALTER SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT
  ADD AGENT DOL_FRAUD_DEMO.ANALYTICS.DOL_FRAUD_AGENT;
```

Then open https://ai.snowflake.com, pick the agent, and switch roles (for example OIG, then OUI, then the TX partner) to show governance.

## Credit tracker

`DOL_FRAUD_DEMO.COST.DOL_CREDIT_TRACKER` is a Streamlit app that reports the credits used by the React app and the CoWork agent. It reads the views from `sql/14_credit_tracker.sql`, which sit on `SNOWFLAKE.ACCOUNT_USAGE` (up to about 3 hours behind).

| Component | What is counted | Source | Basis |
|---|---|---|---|
| CoWork agent | LLM tokens for chats in Snowflake Intelligence | `SNOWFLAKE_COWORK_USAGE_HISTORY` | Exact |
| CoWork agent | LLM tokens for REST / `DATA_AGENT_RUN` calls | `CORTEX_AGENT_USAGE_HISTORY` | Exact |
| CoWork agent | SQL its Analyst tools ran on `DOL_FRAUD_WH` | `QUERY_ATTRIBUTION_HISTORY` (`snowflake-intelligence-*`, `cortex-agent-*` query tags) | Exact |
| React app | Queries by the app's service user on `DOL_FRAUD_WH` | `QUERY_ATTRIBUTION_HISTORY` (users of type `SNOWFLAKE_SERVICE`) | Exact |
| React app | App Runtime hosting | `SNOWFLAKE_APP_RUNTIME_COMPUTE_HISTORY` | **Estimate**: hourly pool credits ÷ running apps |
| Shared | Cortex Search serving for the 3 services | `CORTEX_SEARCH_DAILY_USAGE_HISTORY` | Exact daily charge |

Why hosting is an estimate: every App Runtime app in an account runs on one Snowflake-managed pool, and Snowflake does not report credits per app. Section 2 of `14_credit_tracker.sql` counts the running apps into `COST.TRACKER_CONFIG`; rerun it when apps change. In an account where this is the only app, the estimate equals the actual pool cost.

Query attribution leaves out warehouse idle time, so the app also plots total metered `DOL_FRAUD_WH` credits for context. Enter a credit price to see approximate dollars.

The **Production scenario** view estimates the monthly and yearly cost for teams of any size (default 10, 15 and 20 users). Its defaults come from the demo's measured rates (agent credits per question, App Runtime hosting and search per day). You can change every assumption: questions per user, workdays, warehouse size and active hours, and credit price. It is an estimate for planning, not a quote.

Deploy (Snowflake CLI 3.14+), from `streamlit/credit_tracker/`:

```bash
snow streamlit deploy DOL_CREDIT_TRACKER --replace --role DOL_FRAUD_DEMO_ROLE --warehouse DOL_FRAUD_WH
```

It uses the container runtime on `SYSTEM_COMPUTE_POOL_CPU` and needs a PyPI external access integration (created in `14_credit_tracker.sql`). For a local preview, copy `.streamlit/secrets.toml.example` to `.streamlit/secrets.toml`, fill it in, and run `streamlit run streamlit_app.py`.

## Known limitations

- **The classifier score is unrealistically high.** Holdout AUC is about 0.9999, because seeded synthetic patterns are separable by construction. Present it as a demonstration of the workflow, not of expected real-world accuracy.
- **Employer risk is not a Dynamic Table.** The WHD and OSHA source tables belong to other demo roles and have change tracking off, so employer risk is rebuilt by a procedure on a weekly task.
- **ITA underreporting (P7) is conservative.** It needs 20+ NAICS peers, an injury rate under 40% of the peer median, and serious citations or a fatality.
- **Fraud ring aggregates are not filtered by state.** `DT_CLAIM_RING_STATS` has no row access policy, so the TX partner sees ring totals across all six demo states (masked labels only through the agent). The table also holds raw link values and is readable by OUI, OIG and TX through `11_governance.sql` dynamic-table grants; the agent cannot reach them (it reads `V_RING_SUMMARY`).

## Source links

All public data was retrieved 2026-10-13.

### Source home pages

| Source | Home page |
|---|---|
| DOL Office of Unemployment Insurance (OUI) data downloads | https://oui.doleta.gov/unemploy/DataDownloads.asp |
| UI improper payments / BAM | https://oui.doleta.gov/unemploy/improp_pay.asp |
| OSHA Injury Tracking Application (ITA) data | https://www.osha.gov/Establishment-Specific-Injury-and-Illness-Data |
| DOL enforcement data catalog (OSHA, WHD) | https://data.dol.gov/data-catalog |
| DOL Open Data Portal | https://dataportal.dol.gov |
| OFLC performance data (H-2A, H-2B) | https://www.dol.gov/agencies/eta/foreign-labor/performance |
| EBSA Form 5500 datasets | https://askebsa.dol.gov/FOIA%20Files/ |
| BLS QCEW data files | https://www.bls.gov/cew/downloadable-data-files.htm |
| DOL Office of Inspector General reports | https://www.oig.dol.gov |
| UI Program Letters (UIPL) | https://www.dol.gov/agencies/eta/advisories |

### Direct data links

| S3 folder | File | Direct link |
|---|---|---|
| `oui/` | `ar539.csv` | https://oui.doleta.gov/unemploy/csv/ar539.csv |
| `oui/` | `ar227.csv` | https://oui.doleta.gov/unemploy/csv/ar227.csv |
| `oui/` | `ar5159.csv` | https://oui.doleta.gov/unemploy/csv/ar5159.csv |
| `oui/` | `ap902.csv` | https://oui.doleta.gov/unemploy/csv/ap902.csv |
| `oui/` | BAM rates by quarter and state | https://oui.doleta.gov/unemploy/bam/2024/IPIA_2020_Thru_PIIA_2024_Integrity_Rates_by_Quarter_&_State.xlsx |
| `oui/` | BAM rates by cause | https://oui.doleta.gov/unemploy/bam/2024/PIIA_2024_Integrity_Rates_By_Cause.xlsx |
| `employer/` | ITA 300A 2024 | https://www.osha.gov/sites/default/files/ITA_300A_Summary_Data_2024_through_12-31-2025.zip |
| `employer/` | ITA 300A 2025 | https://www.osha.gov/sites/default/largefiles/ITA_300A_Summary_Data_2025_through_08-31-2026.csv |
| `employer/` | ITA case detail 2025 | https://www.osha.gov/sites/default/largefiles/ITA_Case_Detail_Data_2025_through_08-31-2026.csv |
| `employer/` | OSHA accident abstracts | https://data.dol.gov/data-catalog/OSHA/accident_abstract/OSHA_accident_abstract.zip |
| `employer/` | Form 5500 2024 | https://askebsa.dol.gov/FOIA%20Files/2024/Latest/F_5500_2024_Latest.zip |
| `employer/` | QCEW 2024 annual | https://data.bls.gov/cew/data/files/2024/csv/2024_annual_singlefile.zip |
| `employer/` | H-2A and H-2B disclosure FY2025 Q4, H-2B recruiter list FY2026 Q3 | Download in a browser from the OFLC performance data page above (the page blocks scripted access) |
| `docs/` | BAM PIIA 2024 Annual Report | https://oui.doleta.gov/unemploy/bam/2024/PIIA_2024_Benefit_Accuracy_Measurement_Annual_Report.pdf |
| `docs/` | OIG 19-22-006-03-315 | https://www.oig.dol.gov/public/reports/oa/2022/19-22-006-03-315.pdf |
| `docs/` | OIG 19-23-005-03-315 | https://www.oig.dol.gov/public/reports/oa/2023/19-23-005-03-315.pdf |
| `docs/` | OIG 19-23-011-03-315 | https://www.oig.dol.gov/public/reports/oa/2023/19-23-011-03-315.pdf |
| `docs/` | OIG 19-23-012-03-315 | https://www.oig.dol.gov/public/reports/oa/2023/19-23-012-03-315.pdf |
| `docs/` | UIPL 16-21 | https://www.dol.gov/sites/dolgov/files/ETA/advisories/UIPL/2021/UIPL_16-21.pdf |
| Reference | ET Handbook 402 data map (not loaded) | https://oui.doleta.gov/dmstree/handbooks/402/402_4/4024c6/4024c6.pdf |
