# DOL Fraud Detection Demo: Solution Engineer Build Spec

**Audience:** Solution Engineer
**Customer:** U.S. Department of Labor (OUI, WHD, OSHA)
**Demo theme:** "Employer and Claimant Risk 360" on one governed Snowflake platform
**Data principle:** **Public data first.** Use real DOL public datasets wherever they exist. Generate synthetic data only for record-level content that DOL does not publish (individual UI claimants, claims, payments, wage records, new hires).

---

## 1. Objective

Show DOL that Snowflake can:
1. Ingest and unify DOL's **own public data** from WHD, OSHA, OFLC and OUI on one platform, refreshed automatically.
2. Detect unemployment insurance (UI) fraud patterns in near real time (lead story, OUI). Claim-level data is synthetic, but it is anchored to real state baselines.
3. Link the same employers across WHD (wage violations), OSHA (injury underreporting, penalties) and OFLC (H-2A/H-2B) for cross-agency risk.
4. Let investigators and leaders use plain-English AI (CoWork agents) on governed data.
5. Enforce sub-agency access controls and protect PII with native governance.

**Data labeling rules (put them on every screen):**
- Public data: "Source: U.S. DOL public data, [dataset], retrieved [date]."
- Synthetic data: "Synthetic data. Not real individuals."
- Risk scores: "Risk indicators for demonstration only. Not findings of violation or fraud."

---

## 2. Data Sourcing Strategy

### 2.1 What is public and what is synthetic

| Domain | Source | Type |
|--------|--------|------|
| WHD enforcement cases, back wages, penalties, violations by statute | WHD Enforcement (WHISARD) via DOL Open Data Portal | **Public** |
| OSHA inspections, violations, penalties, accident narratives | OSHA datasets via DOL Open Data Portal | **Public** |
| Establishment injury summaries and case details | OSHA ITA 300A and 300/301 | **Public** |
| H-2A, H-2B, LCA, PERM employer applications (offered wage, worksite, worker counts) | OFLC Case Disclosure Data | **Public** |
| H-2B foreign labor recruiters | OFLC Recruiter List | **Public** |
| Weekly UI initial and continued claims by state | ETA 539 | **Public** |
| UI overpayments detected and recovered (fraud and non-fraud) by state | ETA 227 | **Public** |
| UI improper payment rates and root causes by state | BAM / PIIA | **Public** |
| Industry wage and employment benchmarks | BLS QCEW (optional) | **Public** |
| Policy and audit documents (UIPLs, OSHA Field Operations Manual, OIG UI reports) | dol.gov, oig.dol.gov | **Public** |
| Individual claimants, claims, payments, devices, bank accounts | Generated | **Synthetic** |
| Quarterly wage records, new hires, death and incarceration matches | Generated | **Synthetic** |
| Employer payroll split (W-2 vs 1099) | Generated, calibrated to QCEW | **Synthetic** |
| Workers' comp claims | Generated, calibrated to ITA rates | **Synthetic** |
| Worker complaint text (English and Spanish) | Generated | **Synthetic** |
| The fictional "hero employer" (Section 7) | Generated, injected into public tables with a flag | **Synthetic** |

### 2.2 How the two data sets connect
- **Synthetic claims attach to real public employers.** Each synthetic claim's `last_employer_id` points to an employer resolved from the public WHD/OSHA/OFLC data. Claim volume per state is scaled to ETA 539 so the shape is realistic.
- **Synthetic totals reconcile to public totals.** Synthetic flagged overpayment rates per state should land near the published BAM improper payment rates.

### 2.3 Real employer names policy (required)
The public data contains real company names. A fraud demo must not show a real company as a suspected fraudster.
- **The on-screen default is pseudonymized:** "Employer #48213 (NAICS 2381, TX)". Keep the real names in a governed column that is masked for every demo role.
- Seeded fraud patterns are applied **only** to synthetic records and to the fictional hero employer, never to real employers.
- Real employers may appear only with their actual public enforcement facts (for example, "3 WHD cases, $42k back wages"). Never attach synthetic fraud flags to them.

---

## 3. Public Dataset Catalog and Ingestion

### 3.1 DOL Open Data Portal (API)
- **Portal:** https://dataportal.dol.gov (free API key, no approval step). It launched in February 2026 and replaced enforcedata.dol.gov. **Verify endpoints and field names at build time.**
- **API pattern:** `https://apiprod.dol.gov/v4/get/{agency}/{dataset}/json?X-API-KEY=...` with paging (`limit`, `offset`) and filters.
- **Dataset metadata:** `https://apiprod.dol.gov/v4/datasets/{id}`

| Dataset | Approx. size | Load scope for the demo |
|---------|--------------|-------------------------|
| `whd/enforcement` | About 370k rows, 200 MB | Full load |
| `osha/inspection` | About 5.2M rows, 1.4 GB | Filter to the last 10 years (or a few target states) |
| `osha/violation` and related OSHA tables (accident, accident abstract, related activity) | Large | Join to the filtered inspections |

### 3.2 File downloads (stage loads)

| Dataset | Location | Format |
|---------|----------|--------|
| OSHA ITA 300A summary and 300/301 case detail | osha.gov/Establishment-Specific-Injury-and-Illness-Data | CSV (zipped) |
| OFLC disclosure (H-2A, H-2B, LCA, PERM), FY24 to FY26 Q3 | dol.gov/agencies/eta/foreign-labor/performance | xlsx |
| H-2B Recruiter List | Same page | xlsx |
| ETA 539 weekly claims | oui.doleta.gov/unemploy/csv/ar539.csv | CSV |
| ETA 227 overpayments | oui.doleta.gov/unemploy/DataDownloads.asp | CSV |
| BAM improper payment rates | oui.doleta.gov/unemploy/improp_pay.asp and data.gov | CSV / xlsx |
| OUI data map (column definitions for ETA files) | oui.doleta.gov/dmstree/handbooks/402/402_4/4024c6/4024c6.pdf | PDF |
| BLS QCEW (optional) | bls.gov/cew | CSV |
| Policy PDFs (UIPLs, OSHA FOM, OIG reports) | dol.gov, oig.dol.gov | PDF |

**Snowflake Marketplace:** Before building ingestion, check the Marketplace for existing DOL, BLS or QCEW listings. If any exist, use them instead to show zero-ETL data sharing.

### 3.3 Ingestion setup

```sql
CREATE DATABASE IF NOT EXISTS DOL_FRAUD_DEMO;
CREATE SCHEMA IF NOT EXISTS DOL_FRAUD_DEMO.PUBLIC_RAW;   -- public data as published
CREATE SCHEMA IF NOT EXISTS DOL_FRAUD_DEMO.SYNTH_RAW;    -- generated data
CREATE SCHEMA IF NOT EXISTS DOL_FRAUD_DEMO.CURATED;
CREATE SCHEMA IF NOT EXISTS DOL_FRAUD_DEMO.ANALYTICS;
CREATE SCHEMA IF NOT EXISTS DOL_FRAUD_DEMO.GOVERNANCE;
CREATE SCHEMA IF NOT EXISTS DOL_FRAUD_DEMO.APPS;
CREATE STAGE  IF NOT EXISTS DOL_FRAUD_DEMO.PUBLIC_RAW.FILES DIRECTORY = (ENABLE = TRUE);
CREATE STAGE  IF NOT EXISTS DOL_FRAUD_DEMO.PUBLIC_RAW.DOCS  DIRECTORY = (ENABLE = TRUE);

CREATE WAREHOUSE IF NOT EXISTS DOL_DEMO_WH WAREHOUSE_SIZE = 'SMALL' AUTO_SUSPEND = 60;

-- External access for the DOL API and public file hosts
CREATE OR REPLACE NETWORK RULE DOL_FRAUD_DEMO.PUBLIC_RAW.DOL_EGRESS
  MODE = EGRESS TYPE = HOST_PORT
  VALUE_LIST = ('apiprod.dol.gov', 'oui.doleta.gov', 'www.dol.gov', 'www.osha.gov');

CREATE OR REPLACE SECRET DOL_FRAUD_DEMO.PUBLIC_RAW.DOL_API_KEY
  TYPE = GENERIC_STRING SECRET_STRING = '<api key from dataportal.dol.gov>';

CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION DOL_PUBLIC_DATA_EAI
  ALLOWED_NETWORK_RULES = (DOL_FRAUD_DEMO.PUBLIC_RAW.DOL_EGRESS)
  ALLOWED_AUTHENTICATION_SECRETS = (DOL_FRAUD_DEMO.PUBLIC_RAW.DOL_API_KEY)
  ENABLED = TRUE;
```

**Loaders (Snowpark Python stored procedures that use the EAI):**
1. `SP_LOAD_DOL_API(agency, dataset, filter_json)` pages through the API and writes to `PUBLIC_RAW.<AGENCY>_<DATASET>`, stamping `_source`, `_retrieved_at` and `_api_url` on each row.
2. `SP_LOAD_PUBLIC_FILE(url, target_table, format)` downloads a CSV or xlsx file and loads it into a table. Use pandas `read_excel` for the OFLC files.
3. **Scheduling:** a Snowflake Task runs weekly (OSHA updates weekly) and the ETA files are loaded daily. Note: some dol.gov HTML hosts block automated scraping. If a file download fails, download it manually and `PUT` it to `@PUBLIC_RAW.FILES`.

If the build account cannot use an External Access Integration, download all files manually and load them through the stage. The rest of the spec does not change.

---

## 4. Roles

```sql
CREATE ROLE IF NOT EXISTS DOL_OUI_ANALYST;
CREATE ROLE IF NOT EXISTS DOL_WHD_INVESTIGATOR;
CREATE ROLE IF NOT EXISTS DOL_OSHA_INSPECTOR;
CREATE ROLE IF NOT EXISTS DOL_OIG_EXECUTIVE;   -- cross-agency view
CREATE ROLE IF NOT EXISTS DOL_STATE_PARTNER;   -- one state workforce agency
```

---

## 5. Data Model

### 5.1 PUBLIC_RAW (as published; column names follow the source dictionaries)

| Table | Source | Key fields used downstream |
|-------|--------|----------------------------|
| `WHD_ENFORCEMENT` | DOL API whd/enforcement | case_id, trade_nm, legal_name, street_addr, city, st_cd, zip_cd, naic_cd, findings_start/end_date, bw_atp_amt (back wages), ee_atp_cnt (employees), cmp_assd (penalties), per-statute violation and back-wage columns (FLSA, H-2A, child labor, and others) |
| `OSHA_INSPECTION` | DOL API osha/inspection | activity_nr, estab_name, site_address, site_state, site_zip, naics_code, open_date, insp_type, union_status |
| `OSHA_VIOLATION` | DOL API | activity_nr, citation_id, viol_type (S/W/R/O), current_penalty, initial_penalty, abate_date, fta (failure to abate) |
| `OSHA_ACCIDENT`, `OSHA_ACCIDENT_ABSTRACT` | DOL API | summary_nr, activity_nr, event_desc, abstract_text (narratives) |
| `OSHA_ITA_300A` | osha.gov CSV | establishment_name, ein (verify), street, city, state, zip, naics_code, annual_average_employees, total_hours_worked, total_deaths, total_dafw_cases, total_djtr_cases, total_other_cases, total_dafw_days |
| `OSHA_ITA_CASE_DETAIL` | osha.gov CSV (2024 onward) | establishment link, job title, incident description, injury type |
| `OFLC_H2A`, `OFLC_H2B`, `OFLC_LCA` | OFLC xlsx | case_number, case_status, employer_name, employer_fein (verify), employer address, worksite, naics, wage_offer / basic_rate, worker counts, attorney/agent, period of employment |
| `OFLC_H2B_RECRUITERS` | OFLC xlsx | recruiter name, country, employer link |
| `ETA_539` | ar539.csv | st, rptdate, ic (initial claims), cw (continued weeks), ic and cw by program |
| `ETA_227` | DataDownloads | st, rptdate, overpayments established (fraud and non-fraud, count and dollars), recovered amounts |
| `BAM_IMPROPER_RATES` | improp_pay | state, period, improper payment rate, fraud rate, root-cause dollars |
| `BLS_QCEW` (optional) | bls.gov | area, naics, avg_weekly_wage, employment |

Field names above are indicative. **Map them from each published data dictionary at build time** (WHD and OSHA via the portal metadata, the ITA Data Dictionary PDF, the OFLC record layouts and the OUI data map).

### 5.2 SYNTH_RAW (generated only where no public equivalent exists)

| Table | Key columns | Calibration |
|-------|-------------|-------------|
| `UI_CLAIMANTS` | claimant_id, ssn (PII), name, dob, email, phone, address, state | Population scaled per state from ETA 539 |
| `UI_CLAIMS` | claim_id, claimant_id, state, last_employer_id (FK to the real resolved employer), filed_ts, weekly_benefit_amt, status, ip_address, device_id, bank_routing, bank_account (PII) | Weekly volume follows the ETA 539 state curve |
| `UI_PAYMENTS` | payment_id, claim_id, week_ending, amount, bank_account | |
| `WAGE_RECORDS` | ssn, employer_id, quarter, wages | Wages follow QCEW averages by NAICS |
| `NEW_HIRES` | ssn, employer_id, hire_date, state | |
| `DEATH_RECORDS`, `INCARCERATION` | ssn, dates | |
| `EMPLOYER_PAYROLL_SUMMARY` | employer_id, year, w2_count, form_1099_count | Only for the hero employer and a random control sample |
| `WORKERS_COMP_CLAIMS` | wc_claim_id, employer_id, injury_date, lost_days | Rates calibrated to ITA by NAICS |
| `WORKER_COMPLAINTS` | complaint_id, employer_id, language, complaint_text | 20% Spanish. Generate with AI_COMPLETE. |

Target volumes: 50k claimants, 80k claims and 600k payments, spread across 5 to 8 demo states.

---

## 6. Employer Entity Resolution (key Snowflake showcase)

DOL's public data has no shared employer key across WHD, OSHA, ITA and OFLC. **Building one is itself a strong demo moment.**

1. **Standardize:** uppercase names, strip suffixes (LLC, INC, CORP), normalize addresses and ZIP5, and keep NAICS at 4 digits.
2. **Match deterministically:** on FEIN or EIN where present (OFLC, ITA; check the dictionaries), then on exact normalized name plus address.
3. **Match fuzzily:** block on state and ZIP3, then score name and address pairs with `AI_SIMILARITY` or JAROWINKLER_SIMILARITY / EDITDISTANCE. Auto-accept above a threshold and send the middle band to a review table.
4. **Output:** `CURATED.EMPLOYER_MASTER` (employer_id, canonical_name, name_masked, address, state, naics, match_confidence, source_ids_by_agency) and `CURATED.EMPLOYER_XREF` (source system, source key, employer_id).
5. **Successor detection (W3):** employers that share an address or officers (where available) with a prior heavy violator but have a new name. Use only patterns found in the public data, and present them as "possible related entity."

---

## 7. Fraud and Risk Patterns

### 7.1 Patterns computed on real public data (no seeding)

| ID | Agency | Signal | Public sources |
|----|--------|--------|----------------|
| P1 | WHD | Repeat violators: multiple concluded cases within 5 years | WHD_ENFORCEMENT |
| P2 | WHD | Back wages per employee far above NAICS and state peers | WHD_ENFORCEMENT |
| P3 | WHD / OFLC | **H-2A/H-2B employers with WHD H-2A violations** | OFLC + WHD via EMPLOYER_MASTER |
| P4 | OFLC / QCEW | Offered wage well below the industry average wage | OFLC + QCEW |
| P5 | OSHA | Willful or repeat citations, failure to abate | OSHA_VIOLATION |
| P6 | OSHA | Penalties reduced or unpaid (initial vs current penalty) | OSHA_VIOLATION |
| P7 | OSHA / ITA | **Possible underreporting:** ITA total case rate far below NAICS peers while the establishment has serious or fatality-related inspections | ITA_300A + OSHA_INSPECTION + ACCIDENT |
| P8 | Cross | Employers with signals in 2 or more agencies (WHD, OSHA, OFLC) | EMPLOYER_MASTER |
| P9 | OUI | State claim-surge anomalies in the weekly series | ETA_539 (Cortex anomaly detection) |
| P10 | OUI | States with high fraud overpayments and low recovery rates | ETA_227 + BAM |

### 7.2 Patterns seeded into synthetic data

| ID | Pattern | Seed rule |
|----|---------|-----------|
| F1 | Shared bank account ring | 1 to 3 accounts paying 15 or more unrelated claimants |
| F2 | Device/IP farm | 1 device filing 40 or more claims across states within 48 hours |
| F3 | Multi-state duplicate | Same SSN active in 2 or more states at once |
| F4 | Working while claiming | Claim weeks overlap NEW_HIRES or wages above threshold |
| F5 | Deceased / incarcerated | Claims after the date of death or during incarceration |
| F6 | Synthetic identity | SSN/DOB mismatch, new contact info, no wage history |
| W1 | Misclassification | 1099 to W-2 ratio more than 3x peers (hero employer plus a few synthetic employers) |

### 7.3 Hero employer (X1)
A fictional employer, **"Summit Ridge Staffing LLC"** (`is_synthetic = TRUE`), is inserted into EMPLOYER_MASTER and given synthetic records shaped exactly like the public ones:
- Synthetic WHD cases (repeat violator plus H-2A violations), an OFLC H-2A application with a low offered wage, an ITA filing with a low injury rate, and OSHA serious citations with an unpaid penalty
- A successor link to a fictional debarred predecessor
- W1 misclassification, and ex-workers appearing in F4 UI claims

This shows the full cross-agency story without implying anything about a real company.

---

## 8. Curated Layer (Dynamic Tables, TARGET_LAG = '5 minutes' for synthetic, '1 day' for public)

| Dynamic Table | Inputs | Purpose |
|---------------|--------|---------|
| `DT_EMPLOYER_WHD_RISK` | WHD + master | P1, P2, P3 |
| `DT_EMPLOYER_OSHA_RISK` | OSHA + ITA + master | P5, P6, P7 |
| `DT_EMPLOYER_OFLC_RISK` | OFLC + QCEW + master | P3, P4 |
| `DT_EMPLOYER_RISK_360` | All of the above + synthetic W1/F4 | Composite score (0 to 100), agencies flagged, top reasons |
| `DT_STATE_UI_BASELINE` | ETA 539, 227, BAM | Weekly claims, overpayments, recovery and improper rates by state |
| `DT_CLAIM_LINKS` | Synthetic claims | Edges on shared bank, device, IP, email, phone or address |
| `DT_CLAIM_RING_STATS` | Synthetic | Ring size, dollars, state count |
| `DT_CROSS_MATCH_FLAGS` | Synthetic | F3 to F5 flags |
| `DT_CLAIM_RISK` | Synthetic + ML | Claim score and SHAP reasons |

Example (public data):
```sql
CREATE OR REPLACE DYNAMIC TABLE DOL_FRAUD_DEMO.CURATED.DT_EMPLOYER_WHD_RISK
  TARGET_LAG = '1 day' WAREHOUSE = DOL_DEMO_WH AS
SELECT x.employer_id,
       COUNT(DISTINCT w.case_id)                                    AS whd_case_count,
       COUNT(DISTINCT IFF(w.findings_end_date >= DATEADD(year,-5,CURRENT_DATE()), w.case_id, NULL)) AS cases_5yr,
       SUM(w.bw_atp_amt)                                            AS back_wages_total,
       SUM(w.ee_atp_cnt)                                            AS employees_affected,
       SUM(w.cmp_assd)                                              AS penalties_total
FROM DOL_FRAUD_DEMO.PUBLIC_RAW.WHD_ENFORCEMENT w
JOIN DOL_FRAUD_DEMO.CURATED.EMPLOYER_XREF x
  ON x.source_system = 'WHD' AND x.source_key = w.case_id
GROUP BY x.employer_id;
```

---

## 9. ML and AI

### 9.1 Models
- **State claims anomaly detection** (Cortex ML ANOMALY_DETECTION) on **real ETA 539** weekly claims by state. Show real historical spikes (for example, 2020) and the model flagging them.
- **Overpayment forecast** (Cortex ML FORECAST) on real ETA 227 by state.
- **Employer risk model:** peer-normalized scores (z-scores by NAICS and state) on real WHD, OSHA, ITA and OFLC features, plus an Isolation Forest in Snowpark ML. Unsupervised, because there are no fraud labels.
- **Claim fraud classifier** (Snowpark ML XGBoost) trained on the seeded synthetic labels, logged to the Model Registry, with SHAP top 3 reasons.

### 9.2 Cortex AI on public text and documents

| Use | Function | Data |
|-----|----------|------|
| Extract hazard type, root cause and body part from **real OSHA accident abstracts** | AI_EXTRACT / AI_CLASSIFY | OSHA_ACCIDENT_ABSTRACT (public) |
| Classify **real ITA 300/301 incident descriptions** | AI_CLASSIFY | OSHA_ITA_CASE_DETAIL (public) |
| Summarize an employer's enforcement history in plain English | AI_SUMMARIZE_AGG / AI_COMPLETE | WHD + OSHA (public) |
| Parse policy PDFs (UIPLs, OSHA FOM, OIG reports) | AI_PARSE_DOCUMENT | Public PDFs |
| Translate and classify worker complaints | AI_TRANSLATE / AI_CLASSIFY | Synthetic complaints |
| Extract fields from a sample H-2A job order PDF | AI_EXTRACT | Hero employer (synthetic PDF) |
| Fuzzy employer matching | AI_SIMILARITY | Public names and addresses |

### 9.3 Cortex Search services
- `CS_OSHA_NARRATIVES`: **real** accident abstracts and ITA incident descriptions
- `CS_POLICY_DOCS`: **real** UIPLs, OSHA Field Operations Manual, DOL OIG UI audit reports
- `CS_WORKER_COMPLAINTS`: synthetic complaints (translated)

---

## 10. Semantic Views

| Semantic View | Main tables | Example metrics |
|---------------|-------------|-----------------|
| `SV_OUI_FRAUD` | Synthetic claims and risk + DT_STATE_UI_BASELINE (public) | flagged paid, ring count, **published improper payment rate, fraud overpayments, recovery rate (public)** |
| `SV_WHD_ENFORCEMENT` | WHD public + master + OFLC | cases, back wages, employees affected, repeat violators, H-2A violators |
| `SV_OSHA_SAFETY` | OSHA inspections, violations, ITA (public) | serious/willful/repeat citations, penalty reduction %, DART and total case rate vs peers |
| `SV_EMPLOYER_RISK_360` | DT_EMPLOYER_RISK_360 + all of the above | composite risk, agencies flagged |

Tag every metric's description with "(public)" or "(synthetic)". Add 10 to 15 verified queries per view.

---

## 11. CoWork Agents (Cortex Agents)

Every agent must cite its data source (public dataset name, or "synthetic"), show pseudonymized employer IDs by default, and never reveal SSN or bank numbers to unauthorized roles.

| Agent | Tools | Sample prompts |
|-------|-------|----------------|
| **OUI Integrity Agent** | SV_OUI_FRAUD, CS_POLICY_DOCS | "Which states had the highest fraud overpayment rate last year?" (public) "Show bank accounts paying more than 10 claimants." (synthetic) "What does UIPL guidance say about identity verification?" |
| **WHD Investigator Agent** | SV_WHD_ENFORCEMENT, CS_WORKER_COMPLAINTS | "Top industries by back wages in Texas over the last 5 years." "Which H-2A employers also have WHD H-2A violations?" |
| **OSHA Safety Agent** | SV_OSHA_SAFETY, CS_OSHA_NARRATIVES | "Establishments with a low ITA injury rate but serious citations in construction." "Find accident narratives about trench collapses." |
| **DOL Risk 360 Executive Agent** | All semantic views + all search services | "Which employers have signals in all three agencies?" "Give me a briefing on Summit Ridge Staffing." |

System prompt summary: "You are a DOL program integrity assistant. Prefer semantic views for numbers and search for narratives. Label every answer as public or synthetic data. Risk scores are indicators, not findings. Do not reveal real employer names unless the user's role allows it."

---

## 12. Streamlit Investigator App (`APPS.DOL_FRAUD_APP`)

| Page | Contents | Data |
|------|----------|------|
| **Executive Overview** | KPIs: published improper payment rate, fraud overpayments and recovery (public); flagged synthetic claim dollars; employers flagged across 2 or more agencies | Mixed |
| **National UI Trends** | ETA 539 claims by state with anomaly flags; ETA 227 overpayments and recovery map | **Public** |
| **OUI Claims Triage** | Risk queue, claim detail with SHAP reasons, "Mark for review" writes back to `APPS.CASE_ACTIONS` | Synthetic |
| **Fraud Ring Explorer** | Network graph of claimants linked by bank, device and IP | Synthetic |
| **Employer Risk 360** | Search by pseudonymized ID, NAICS or state; WHD, OSHA, ITA and OFLC panels; AI enforcement summary; related entities | **Public** + hero |
| **WHD Workbench** | Back wages by NAICS and state, repeat violators, H-2A crossover | **Public** |
| **OSHA Workbench** | Underreporting scatter (ITA rate vs citations), penalty reductions, narrative search | **Public** |
| **Entity Resolution** | Match statistics across WHD, OSHA, ITA and OFLC; review queue | **Public** |
| **Ask the Agent** | Embedded Risk 360 agent chat | Mixed |

Requirements: a role switcher, a source badge on every chart, `st.connection("snowflake")`, cached queries, and reads from CURATED and ANALYTICS only.

---

## 13. Dashboards

1. **OUI Program Integrity (public):** ETA 539 trends and anomalies, ETA 227 fraud overpayments and recovery, BAM improper rates and root causes by state.
2. **WHD Enforcement (public):** back wages and employees affected by NAICS and state, repeat violators, H-2A violations.
3. **OSHA Compliance (public):** serious, willful and repeat citations, penalty reductions, ITA rates vs peers by industry.
4. **Cross-Agency Risk 360 (public + hero):** employers by number of agencies flagged, top composite list (pseudonymized).
5. **Fraud Operations (synthetic):** rings, devices, flagged dollars, alert history.

---

## 14. Governance (show live)

- **Tags:** `DATA_ORIGIN` (PUBLIC, SYNTHETIC), `PII_TYPE` (SSN, BANK, NAME, DOB), `AGENCY_OWNER` (OUI, WHD, OSHA, OFLC).
- **Masking:**
  - Real employer names are masked for all demo roles (pseudonymized ID shown). Unmask only for a named admin role that is not used on stage.
  - SSN shows the last 4 digits only, except for OUI_ANALYST in a case context. Bank accounts are masked except for OIG_EXECUTIVE.
- **Row access:** DOL_STATE_PARTNER sees only its own state's synthetic claims.
- **Role scoping:** WHD and OSHA roles see employer data but no claimant PII.
- **Data Clean Room (optional):** two "state" accounts run a multi-state duplicate SSN overlap (F3).
- **Lineage and audit:** show Horizon lineage from public source to dashboard, plus ACCESS_HISTORY on a PII column.

---

## 15. Alerts

- A new synthetic fraud ring with 10 or more claimants triggers an email.
- A new ETA 539 state anomaly on the weekly public refresh triggers an email ("Claims spike detected in [state]").
- An employer reaching signals in all three agencies triggers an email.

---

## 16. Demo Script (about 20 minutes)

1. **"This is your data" (3 min):** Open the National UI Trends and WHD/OSHA dashboards, built on **DOL's own public datasets** and refreshed automatically from the new DOL Open Data Portal. Show the entity resolution page linking WHD, OSHA, ITA and OFLC records.
2. **OUI anomaly and triage (5 min):** A real ETA 539 spike is flagged by Cortex anomaly detection. Drill into the synthetic claims for that state, then the Fraud Ring Explorer (one bank account paying 18 claimants in 6 states). Mark it for review.
3. **Governance (2 min):** Switch roles. Rows are filtered, the SSN is masked, and real employer names are pseudonymized.
4. **Ask the agent (4 min):** "Which employers have signals in all three agencies?" The agent returns Summit Ridge Staffing and also cites the real public counts of employers with crossover signals.
5. **Employer Risk 360 (4 min):** The hero employer's H-2A, WHD, OSHA and ITA signals, the successor link, and ex-workers in F4 claims. Then a real OSHA accident narrative search, plus policy questions answered from real UIPLs.
6. **Close (2 min):** Public and agency data on one governed platform with AI built in. Mention FedRAMP and government regions (**confirm the current authorization before citing it**) and state collaboration through clean rooms.

---

## 17. Build Checklist

**Public data**
- [ ] DOL Open Data Portal API key obtained, EAI and secret created
- [ ] Marketplace checked for DOL, BLS and QCEW listings
- [ ] WHD enforcement loaded (full)
- [ ] OSHA inspection, violation and accident tables loaded (filtered)
- [ ] ITA 300A and case detail loaded
- [ ] OFLC H-2A, H-2B, LCA and recruiter files loaded
- [ ] ETA 539, ETA 227 and BAM loaded
- [ ] Policy PDFs staged and parsed
- [ ] Field mappings verified against each data dictionary (including whether FEIN/EIN exists)
- [ ] Weekly and daily refresh tasks scheduled

**Entity resolution and risk**
- [ ] EMPLOYER_MASTER and EMPLOYER_XREF built, match rates documented
- [ ] Patterns P1 to P10 computed and spot-checked

**Synthetic data**
- [ ] Generators calibrated to ETA 539, BAM and QCEW
- [ ] F1 to F6 and W1 seeded and validated
- [ ] Hero employer and its predecessor inserted with `is_synthetic = TRUE`

**Platform**
- [ ] Dynamic Tables refreshing
- [ ] Models trained (anomaly, forecast, employer risk, claim classifier)
- [ ] Cortex enrichment tables and 3 Search services built
- [ ] 4 semantic views with VQRs, evaluated
- [ ] 4 CoWork agents tested with the Section 11 prompts
- [ ] Streamlit app deployed with role switching and source badges
- [ ] 5 dashboards built
- [ ] Tags, masking (including employer name pseudonymization) and row access tested per role
- [ ] Alerts configured
- [ ] End-to-end dry run, including a check that **no real employer appears with a synthetic flag**

---

## 18. Assumptions, Risks and Open Questions

**Assumptions**
- The build happens in a Snowflake commercial demo account. The FedRAMP / GovCloud story is for discussion only.
- Public data is used under DOL's open data terms. Cite the sources in the app.

**Known data limitations (say them out loud if asked)**
- WHD data includes **concluded cases only**, so recent months are sparse.
- ITA covers only certain establishments (250 or more employees, or 20 to 249 in listed industries). OSHA warns against ranking establishments as "most dangerous" from these rates alone, so present underreporting as a targeting signal.
- There is no public record-level UI data, so the claim-level fraud work is synthetic by necessity.
- The DOL Open Data Portal is new (February 2026). Endpoints, dataset IDs and field names may change.
- Not verified: which public datasets include FEIN or EIN. This affects the match rates.

---

## 19. Public Source References

- DOL Open Data Portal: https://dataportal.dol.gov
- DOL API User Guide: https://www.dataportal.dol.gov/pdf/dol-api-user-guide.pdf
- Portal launch announcement: https://www.dol.gov/newsroom/releases/oasam/oasam20260218
- OSHA ITA data: http://www.osha.gov/Establishment-Specific-Injury-and-Illness-Data
- ITA Data Users Guide: https://www.osha.gov/sites/default/files/ITA_data_users_guide.pdf
- ITA 300A Data Dictionary: https://www.osha.gov/sites/default/files/ITA_Data_Dictionary.pdf
- OSHA Inspection dataset (data.gov): https://catalog.data.gov/dataset/dol-enforcement-data-inspection
- OFLC Performance Data: https://www.dol.gov/agencies/eta/foreign-labor/performance
- OFLC Disclosure (data.gov): https://catalog.data.gov/dataset/office-of-foreign-labor-certification-oflc-case-disclosure-data
- OUI Data Downloads: https://oui.doleta.gov/unemploy/DataDownloads.asp
- OUI Data Map: https://oui.doleta.gov/dmstree/handbooks/402/402_4/4024c6/4024c6.pdf
- ETA 539 (data.gov): https://catalog.data.gov/dataset/unemployment-insurance-weekly-claims-extended-benefits-trigger-data-eta-539
- UI Improper Payments / BAM: https://oui.doleta.gov/unemploy/improp_pay.asp
- BAM PIIA 2024 Annual Report: https://oui.doleta.gov/unemploy//bam/2024/PIIA_2024_Benefit_Accuracy_Measurement_Annual_Report.pdf
