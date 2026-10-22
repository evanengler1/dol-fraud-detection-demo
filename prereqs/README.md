# Prerequisites: WHD and OSHA enforcement data

The fraud demo reads two databases that hold public DOL enforcement data:

| Database | Tables the fraud demo reads | Built by |
|---|---|---|
| `DOL_OSHA_DEMO.TRANSFORMED` | `INSPECTION`, `VIOLATION`, `VIOLATION_EVENT`, `ACCIDENT`, `ACCIDENT_INJURY` | `osha/` |
| `DOL_WHD_DEMO.TRANSFORMED` | `WHD_CASE`, `WHD_CASE_PROGRAM`, `PROGRAM_REF`, `EMPLOYER_XREF` | `whd/` |

Only the scripts needed for those tables are included. Build both before running `sql/00_setup.sql` at the repo root.

Both use the `DOL_S3_INT` storage integration. Create it once (template in `sql/00_setup.sql` at the repo root) and replace `YOUR-BUCKET` in the stage URLs below.

## 1. OSHA (`DOL_OSHA_DEMO`)

Source: [DOL enforcement data](https://enforcedata.dol.gov/views/data_summary.php), OSHA datasets. Download these five ZIPs into `osha/data/`: `OSHA_inspection.zip`, `OSHA_violation.zip`, `OSHA_violation_event.zip`, `OSHA_accident.zip`, `OSHA_accident_injury.zip`.

```bash
cd prereqs/osha
pip install boto3
export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... S3_BUCKET=YOUR-BUCKET
python3 process_osha_data.py          # filters to 2016+ and uploads to s3://$S3_BUCKET/osha-raw/
```

Then run, as ACCOUNTADMIN:

| File | Purpose |
|---|---|
| `sql/00_setup.sql` | Role `DOL_OSHA_DEMO_ROLE`, warehouse `DOL_OSHA_WH`, database, schemas, S3 stage, RAW tables |
| `sql/01_copy_into.sql` | Loads the RAW tables from the stage |
| `sql/02_transformed_tables.sql` | Typed `TRANSFORMED` tables |

## 2. WHD (`DOL_WHD_DEMO`)

Source: [DOL enforcement data](https://enforcedata.dol.gov/views/data_summary.php), WHD compliance actions. Download the ZIP to `whd/data/WHD_enforcement.zip`.

```bash
cd prereqs/whd
export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... S3_BUCKET=YOUR-BUCKET
python3 process_whd_data.py           # filters to 2016+ and uploads to s3://$S3_BUCKET/whd-raw/
```

Then run, in order: `sql/01_setup.sql`, `02_raw_table.sql`, `03_stage.sql`, `04_load.sql`, `05_transformed_tables.sql`, `05b_employer_resolution.sql`.

From the repo root, with the Snowflake CLI:

```bash
for f in prereqs/osha/sql/0{0,1,2}_*.sql prereqs/whd/sql/0*.sql; do
  snow sql -c "${SNOWFLAKE_CONNECTION:-default}" -f "$f" || break
done
```

These scripts come from the standalone WHD and OSHA demos and are trimmed to the steps the fraud demo depends on.
