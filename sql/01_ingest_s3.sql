-- =============================================================================
-- DOL Fraud Detection Demo - 01 Ingest from S3
-- Source: public files you download and upload to s3://YOUR-BUCKET/dol-fraud-demo/
-- (replace YOUR-BUCKET below; file list and links are in README "Data preparation")
--   oui/       ETA 539, 227, 5159, 902P CSVs; BAM integrity-rate XLSX
--   employer/  OSHA ITA 300A + case detail, OSHA accident abstracts (ZIP),
--              EBSA Form 5500 (ZIP), OFLC H-2A/H-2B + recruiter list (XLSX),
--              BLS QCEW 2024 annual singlefile (ZIP)
--   docs/      OIG, BAM and UIPL PDFs (parsed in 08_cortex_ai.sql)
-- Pattern: RAW tables are all-VARCHAR (types are applied in CURATED), and every
-- row carries _SOURCE_FILE and _LOADED_AT for lineage.
-- =============================================================================

USE ROLE DOL_FRAUD_DEMO_ROLE;
USE WAREHOUSE DOL_FRAUD_WH;
USE SCHEMA DOL_FRAUD_DEMO.RAW_PUBLIC;

-- Stages ----------------------------------------------------------------------
-- External stage on the DOL_S3_INT storage integration (00_setup.sql).
-- Replace YOUR-BUCKET with your bucket name.
CREATE STAGE IF NOT EXISTS S3_DOL
  URL = 's3://YOUR-BUCKET/dol-fraud-demo/'
  STORAGE_INTEGRATION = DOL_S3_INT
  DIRECTORY = (ENABLE = TRUE)
  COMMENT = 'Public DOL/BLS downloads staged by operator';

-- Internal stage for files extracted from ZIPs (gzip CSV)
CREATE STAGE IF NOT EXISTS EXTRACTED
  ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE')
  DIRECTORY = (ENABLE = TRUE)
  COMMENT = 'CSV members extracted from public ZIP downloads';

-- File formats ------------------------------------------------------------------
CREATE FILE FORMAT IF NOT EXISTS FF_CSV_HEADER
  TYPE = CSV PARSE_HEADER = TRUE FIELD_OPTIONALLY_ENCLOSED_BY = '"'
  NULL_IF = ('', 'NULL') EMPTY_FIELD_AS_NULL = TRUE ENCODING = 'UTF8'
  ERROR_ON_COLUMN_COUNT_MISMATCH = FALSE;

-- OSHA/osha.gov files contain Windows-1252 smart quotes
CREATE FILE FORMAT IF NOT EXISTS FF_CSV_HEADER_1252
  TYPE = CSV PARSE_HEADER = TRUE FIELD_OPTIONALLY_ENCLOSED_BY = '"'
  NULL_IF = ('', 'NULL') EMPTY_FIELD_AS_NULL = TRUE ENCODING = 'WINDOWS1252'
  ERROR_ON_COLUMN_COUNT_MISMATCH = FALSE;

-- Procedure: unzip a staged ZIP into the EXTRACTED stage ------------------------
CREATE OR REPLACE PROCEDURE SP_UNZIP_TO_STAGE(SRC_FILE STRING, TARGET_PREFIX STRING)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.11'
  PACKAGES = ('snowflake-snowpark-python')
  HANDLER = 'run'
  COMMENT = 'Extracts every CSV member of a staged ZIP to @EXTRACTED/<prefix>/ as .gz'
  EXECUTE AS CALLER
AS
$$
import gzip, io, zipfile
from snowflake.snowpark.files import SnowflakeFile

def run(session, src_file, target_prefix):
    with SnowflakeFile.open(src_file, 'rb', require_scoped_url=False) as f:
        zbytes = f.read()
    written = []
    with zipfile.ZipFile(io.BytesIO(zbytes)) as z:
        for info in z.infolist():
            name = info.filename.rsplit('/', 1)[-1]
            if info.is_dir() or not name.lower().endswith('.csv'):
                continue
            gz = io.BytesIO()
            with z.open(info) as src, gzip.GzipFile(fileobj=gz, mode='wb') as dst:
                while True:
                    chunk = src.read(8 * 1024 * 1024)
                    if not chunk:
                        break
                    dst.write(chunk)
            gz.seek(0)
            target = f"@DOL_FRAUD_DEMO.RAW_PUBLIC.EXTRACTED/{target_prefix}/{name}.gz"
            session.file.put_stream(gz, target, auto_compress=False, overwrite=True)
            written.append({'member': info.filename, 'bytes': info.file_size})
    return {'source': src_file, 'files': written}
$$;

-- Procedure: load CSV(s) into an all-VARCHAR table -----------------------------
-- Infers column names from the header, creates the table with TEXT columns plus
-- lineage columns, then COPYs by column name.
CREATE OR REPLACE PROCEDURE SP_LOAD_CSV(LOCATION STRING, TARGET_TABLE STRING, FILE_FORMAT STRING)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.11'
  PACKAGES = ('snowflake-snowpark-python')
  HANDLER = 'run'
  COMMENT = 'Creates an all-VARCHAR RAW table from CSV headers and loads it'
  EXECUTE AS CALLER
AS
$$
import re

def run(session, location, target_table, file_format):
    cols = session.sql(f"""
        SELECT column_name FROM TABLE(INFER_SCHEMA(
          LOCATION => '{location}', FILE_FORMAT => '{file_format}',
          MAX_RECORDS_PER_FILE => 100))
        ORDER BY order_id""").collect()
    names, seen = [], set()
    for r in cols:
        n = re.sub(r'[^A-Za-z0-9_]', '_', r['COLUMN_NAME'].strip()).upper().strip('_') or 'COL'
        if n[0].isdigit():
            n = 'C_' + n
        while n in seen:
            n += '_X'
        seen.add(n)
        names.append((r['COLUMN_NAME'], n))
    col_ddl = ',\n'.join(f'"{n}" VARCHAR' for _, n in names)
    session.sql(f"""CREATE OR REPLACE TABLE {target_table} (
        {col_ddl},
        _SOURCE_FILE VARCHAR, _LOADED_AT TIMESTAMP_LTZ)""").collect()
    # Positional COPY with a transform keeps the cleaned names and adds lineage
    sel = ', '.join(f'${i + 1}' for i in range(len(names)))
    # PARSE_HEADER formats cannot be used with positional transforms, so build a
    # temporary SKIP_HEADER format with the same encoding
    ff = file_format.replace("'", "")
    tmp_ff = f"{target_table}_FF_TMP"
    enc = session.sql(f"DESC FILE FORMAT {ff}").collect()
    enc_val = [r for r in enc if r['property'] == 'ENCODING'][0]['property_value']
    session.sql(f"""CREATE OR REPLACE TEMPORARY FILE FORMAT {tmp_ff}
        TYPE = CSV SKIP_HEADER = 1 FIELD_OPTIONALLY_ENCLOSED_BY = '"'
        NULL_IF = ('', 'NULL') EMPTY_FIELD_AS_NULL = TRUE ENCODING = '{enc_val}'
        ERROR_ON_COLUMN_COUNT_MISMATCH = FALSE""").collect()
    res = session.sql(f"""COPY INTO {target_table}
        FROM (SELECT {sel}, METADATA$FILENAME, CURRENT_TIMESTAMP() FROM {location})
        FILE_FORMAT = (FORMAT_NAME = '{tmp_ff}')
        ON_ERROR = CONTINUE""").collect()
    loaded = sum(int(r.as_dict().get('rows_loaded') or 0) for r in res)
    errors = sum(int(r.as_dict().get('errors_seen') or 0) for r in res)
    return {'table': target_table, 'columns': len(names), 'rows_loaded': loaded, 'errors_seen': errors}
$$;

-- Procedure: load an XLSX sheet into an all-VARCHAR table ----------------------
CREATE OR REPLACE PROCEDURE SP_LOAD_XLSX(SRC_FILE STRING, TARGET_TABLE STRING, SHEET STRING, SKIP_ROWS INTEGER)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.11'
  PACKAGES = ('snowflake-snowpark-python', 'pandas', 'openpyxl')
  HANDLER = 'run'
  COMMENT = 'Loads one XLSX sheet (as text) into a RAW table'
  EXECUTE AS CALLER
AS
$$
import io, re
import pandas as pd
from snowflake.snowpark.files import SnowflakeFile

def run(session, src_file, target_table, sheet, skip_rows):
    with SnowflakeFile.open(src_file, 'rb', require_scoped_url=False) as f:
        data = f.read()
    sheet_arg = sheet if sheet else 0
    df = pd.read_excel(io.BytesIO(data), sheet_name=sheet_arg, skiprows=skip_rows or 0,
                       dtype=str, engine='openpyxl')
    # Drop blank / "Unnamed: N" header columns (write_pandas fails on empty names)
    df = df.loc[:, [c for c in df.columns if str(c).strip() and not str(c).startswith('Unnamed')]]
    df = df.dropna(how='all')
    names, seen = [], set()
    for c in df.columns:
        n = re.sub(r'[^A-Za-z0-9_]', '_', str(c).strip()).upper().strip('_') or 'COL'
        n = re.sub(r'_+', '_', n)
        if n[0].isdigit():
            n = 'C_' + n
        while n in seen:
            n += '_X'
        seen.add(n)
        names.append(n)
    df.columns = names
    df = df.where(pd.notnull(df), None)
    df['_SOURCE_FILE'] = src_file
    df['_LOADED_AT'] = pd.Timestamp.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    db, sch, tbl = target_table.split('.')
    session.write_pandas(df, tbl, database=db, schema=sch, auto_create_table=True,
                         overwrite=True, quote_identifiers=True)
    return {'table': target_table, 'rows': len(df), 'columns': len(names)}
$$;

-- List available sheet names (used to pick the right sheet/skip rows)
CREATE OR REPLACE PROCEDURE SP_XLSX_SHEETS(SRC_FILE STRING)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.11'
  PACKAGES = ('snowflake-snowpark-python', 'openpyxl')
  HANDLER = 'run'
  EXECUTE AS CALLER
AS
$$
import io
import openpyxl
from snowflake.snowpark.files import SnowflakeFile

def run(session, src_file):
    with SnowflakeFile.open(src_file, 'rb', require_scoped_url=False) as f:
        wb = openpyxl.load_workbook(io.BytesIO(f.read()), read_only=True)
    out = {}
    for ws in wb.worksheets:
        rows = []
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            rows.append([str(v)[:40] if v is not None else None for v in row[:25]])
            if i >= 14:
                break
        out[ws.title] = rows
    return out
$$;

-- =============================================================================
-- Loads (re-runnable; each call replaces its RAW table)
-- Note for snow CLI users: run with --enable-templating NONE (file names contain &)
-- =============================================================================

-- OUI: ETA reports (columns st, rptdate, c1..cN; meanings in ET Handbook 402)
CALL SP_LOAD_CSV('@S3_DOL/oui/ar539.csv',  'DOL_FRAUD_DEMO.RAW_PUBLIC.ETA_539',  'FF_CSV_HEADER');
CALL SP_LOAD_CSV('@S3_DOL/oui/ar227.csv',  'DOL_FRAUD_DEMO.RAW_PUBLIC.ETA_227',  'FF_CSV_HEADER');
CALL SP_LOAD_CSV('@S3_DOL/oui/ar5159.csv', 'DOL_FRAUD_DEMO.RAW_PUBLIC.ETA_5159', 'FF_CSV_HEADER');
CALL SP_LOAD_CSV('@S3_DOL/oui/ap902.csv',  'DOL_FRAUD_DEMO.RAW_PUBLIC.ETA_902P', 'FF_CSV_HEADER');

-- OUI: BAM / PIIA integrity rates (multi-row headers; header row = skip_rows)
CALL SP_LOAD_XLSX('@DOL_FRAUD_DEMO.RAW_PUBLIC.S3_DOL/oui/IPIA_2020_Thru_PIIA_2024_Integrity_Rates_by_Quarter_&_State.xlsx',
                  'DOL_FRAUD_DEMO.RAW_PUBLIC.BAM_RATES_BY_QTR_STATE', 'PIIA20~24 Integrity rates x QTR', 9);
CALL SP_LOAD_XLSX('@DOL_FRAUD_DEMO.RAW_PUBLIC.S3_DOL/oui/PIIA_2024_Integrity_Rates_By_Cause.xlsx',
                  'DOL_FRAUD_DEMO.RAW_PUBLIC.BAM_FRAUD_BY_CAUSE', 'Fraud Overpayments by Cause', 2);
CALL SP_LOAD_XLSX('@DOL_FRAUD_DEMO.RAW_PUBLIC.S3_DOL/oui/PIIA_2024_Integrity_Rates_By_Cause.xlsx',
                  'DOL_FRAUD_DEMO.RAW_PUBLIC.BAM_OP_BY_CAUSE', 'Overpayments by Cause', 2);

-- Employer: OSHA ITA (EIN-bearing) - plain CSVs plus the 2024 ZIP
CALL SP_LOAD_CSV('@S3_DOL/employer/ITA_300A_Summary_Data_2025_through_08-31-2026.csv',
                 'DOL_FRAUD_DEMO.RAW_PUBLIC.ITA_300A_2025', 'FF_CSV_HEADER_1252');
CALL SP_LOAD_CSV('@S3_DOL/employer/ITA_Case_Detail_Data_2025_through_08-31-2026.csv',
                 'DOL_FRAUD_DEMO.RAW_PUBLIC.ITA_CASE_DETAIL_2025', 'FF_CSV_HEADER_1252');
CALL SP_UNZIP_TO_STAGE('@DOL_FRAUD_DEMO.RAW_PUBLIC.S3_DOL/employer/ITA_300A_Summary_Data_2024_through_12-31-2025.zip', 'ita_300a_2024');
CALL SP_LOAD_CSV('@EXTRACTED/ita_300a_2024/', 'DOL_FRAUD_DEMO.RAW_PUBLIC.ITA_300A_2024', 'FF_CSV_HEADER_1252');

-- Employer: OSHA accident abstracts (narrative lines; existing ABSTRACT_TEXT is empty)
CALL SP_UNZIP_TO_STAGE('@DOL_FRAUD_DEMO.RAW_PUBLIC.S3_DOL/employer/OSHA_accident_abstract.zip', 'osha_accident_abstract');
CALL SP_LOAD_CSV('@EXTRACTED/osha_accident_abstract/', 'DOL_FRAUD_DEMO.RAW_PUBLIC.OSHA_ACCIDENT_ABSTRACT', 'FF_CSV_HEADER_1252');

-- Employer: EBSA Form 5500 (EIN anchor)
CALL SP_UNZIP_TO_STAGE('@DOL_FRAUD_DEMO.RAW_PUBLIC.S3_DOL/employer/F_5500_2024_Latest.zip', 'form5500_2024');
CALL SP_LOAD_CSV('@EXTRACTED/form5500_2024/', 'DOL_FRAUD_DEMO.RAW_PUBLIC.FORM_5500_2024', 'FF_CSV_HEADER_1252');

-- Employer: BLS QCEW 2024 annual (single file)
CALL SP_UNZIP_TO_STAGE('@DOL_FRAUD_DEMO.RAW_PUBLIC.S3_DOL/employer/2024_annual_singlefile.zip', 'qcew_2024');
CALL SP_LOAD_CSV('@EXTRACTED/qcew_2024/', 'DOL_FRAUD_DEMO.RAW_PUBLIC.QCEW_2024_ANNUAL', 'FF_CSV_HEADER');

-- Employer: OFLC H-2A / H-2B disclosure and H-2B recruiter list (first sheet)
CALL SP_LOAD_XLSX('@DOL_FRAUD_DEMO.RAW_PUBLIC.S3_DOL/employer/H-2A_Disclosure_Data_FY2025_Q4.xlsx',
                  'DOL_FRAUD_DEMO.RAW_PUBLIC.OFLC_H2A_FY2025', NULL, 0);
CALL SP_LOAD_XLSX('@DOL_FRAUD_DEMO.RAW_PUBLIC.S3_DOL/employer/H-2B_Disclosure_Data_FY2025_Q4.xlsx',
                  'DOL_FRAUD_DEMO.RAW_PUBLIC.OFLC_H2B_FY2025', NULL, 0);
CALL SP_LOAD_XLSX('@DOL_FRAUD_DEMO.RAW_PUBLIC.S3_DOL/employer/H-2B_Foreign_Labor_Recruiter_List_FY2026_Q3.xlsx',
                  'DOL_FRAUD_DEMO.RAW_PUBLIC.OFLC_H2B_RECRUITERS', NULL, 0);

-- Load summary
SELECT table_name, row_count, ROUND(bytes/1e6,1) AS mb
FROM DOL_FRAUD_DEMO.INFORMATION_SCHEMA.TABLES
WHERE table_schema = 'RAW_PUBLIC' ORDER BY table_name;
