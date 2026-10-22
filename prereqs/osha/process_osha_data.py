#!/usr/bin/env python3
"""
Process downloaded DOL OSHA bulk CSV ZIPs:
  1. Unzip each dataset
  2. Filter rows to 2016-01-01 onward (DATE_CUTOFF)
  3. Upload filtered CSVs to S3 for Snowflake ingestion

Usage:
    1. Download the 5 ZIP files into a data/ directory
    2. export AWS credentials and S3_BUCKET=<your bucket>
    3. python3 process_osha_data.py
"""

import os
import sys
import csv
import io
import zipfile
import logging
import glob
import boto3

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

S3_BUCKET = os.environ.get("S3_BUCKET", "YOUR-BUCKET")
S3_PREFIX = "osha-raw"
DATA_DIR = "data"
DATE_CUTOFF = "2016-01-01"

DATASETS = {
    "inspection": {
        "zip_name": "OSHA_inspection.zip",
        "date_field": "OPEN_DATE",
        "columns": [
            "activity_nr", "reporting_id", "state_flag", "estab_name",
            "site_address", "site_city", "site_state", "site_zip",
            "owner_type", "owner_code", "adv_notice", "safety_hlth",
            "sic_code", "naics_code", "insp_type", "insp_scope",
            "why_no_insp", "union_status", "safety_manuf", "safety_const",
            "safety_marit", "health_manuf", "health_const", "health_marit",
            "migrant", "mail_street", "mail_city", "mail_state", "mail_zip",
            "host_est_key", "nr_in_estab", "open_date", "case_mod_date",
            "close_conf_date", "close_case_date", "load_dt",
        ],
    },
    "violation": {
        "zip_name": "OSHA_violation.zip",
        "date_field": "ISSUANCE_DATE",
        "columns": [
            "activity_nr", "citation_id", "delete_flag", "standard",
            "viol_type", "issuance_date", "abate_date", "abate_complete",
            "current_penalty", "initial_penalty", "contest_date",
            "final_order_date", "nr_instances", "nr_exposed", "rec",
            "gravity", "emphasis", "hazcat", "fta_insp_nr",
            "fta_issuance_date", "fta_penalty", "fta_contest_date",
            "fta_final_order_date", "hazsub1", "hazsub2", "hazsub3",
            "hazsub4", "hazsub5", "load_dt",
        ],
    },
    "violation_event": {
        "zip_name": "OSHA_violation_event.zip",
        "date_field": "HIST_DATE",
        "columns": [
            "activity_nr", "citation_id", "pen_fta", "hist_event",
            "hist_date", "hist_penalty", "hist_abate_date", "hist_vtype",
            "hist_insp_nr", "load_dt",
        ],
    },
    "accident": {
        "zip_name": "OSHA_accident.zip",
        "date_field": "EVENT_DATE",
        "columns": [
            "summary_nr", "report_id", "event_date", "event_time",
            "event_desc", "event_keyword", "const_end_use", "build_stories",
            "nonbuild_ht", "project_cost", "project_type", "sic_list",
            "fatality", "state_flag", "abstract_text", "load_dt",
        ],
    },
    "accident_injury": {
        "zip_name": "OSHA_accident_injury.zip",
        "date_field": None,
        "columns": [
            "summary_nr", "rel_insp_nr", "age", "sex", "nature_of_inj",
            "part_of_body", "src_of_injury", "event_type", "evn_factor",
            "hum_factor", "occ_code", "degree_of_inj", "task_assigned",
            "hazsub", "const_op", "const_op_cause", "fat_cause",
            "fall_distance", "fall_ht", "injury_line_nr", "load_dt",
        ],
    },
}


def find_csv_in_zip(zip_path: str) -> list[str]:
    """List CSV files inside a ZIP archive."""
    with zipfile.ZipFile(zip_path, "r") as zf:
        return [n for n in zf.namelist() if n.lower().endswith(".csv")]


def process_dataset(name: str, config: dict) -> tuple[io.StringIO, int, int]:
    zip_path = os.path.join(DATA_DIR, config["zip_name"])
    if not os.path.exists(zip_path):
        log.error("  %s: ZIP not found at %s — skipping", name, zip_path)
        return None, 0, 0

    log.info("=== Processing %s from %s ===", name, zip_path)

    csv_files = find_csv_in_zip(zip_path)
    if not csv_files:
        log.error("  %s: No CSV files found in ZIP", name)
        return None, 0, 0

    log.info("  Found %d CSV part(s) in ZIP", len(csv_files))

    columns = config["columns"]
    date_field = config["date_field"]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()

    total_read = 0
    total_kept = 0

    with zipfile.ZipFile(zip_path, "r") as zf:
        for csv_name in sorted(csv_files):
            log.info("  Reading %s ...", csv_name)
            with zf.open(csv_name) as f:
                text = io.TextIOWrapper(f, encoding="utf-8", errors="replace")
                reader = csv.DictReader(text)
                for row in reader:
                    total_read += 1
                    if date_field and date_field in row:
                        date_val = (row[date_field] or "").strip()
                        if date_val < DATE_CUTOFF:
                            continue
                    # lowercase keys to match Snowflake table columns
                    row_lower = {k.lower(): v for k, v in row.items()}
                    writer.writerow(row_lower)
                    total_kept += 1

                    if total_read % 500000 == 0:
                        log.info("    ... %d read, %d kept so far", total_read, total_kept)

    log.info("  %s: DONE — %d read, %d kept (after date filter)", name, total_read, total_kept)
    buf.seek(0)
    return buf, total_read, total_kept


def upload_to_s3(s3_client, name: str, buf: io.StringIO):
    key = f"{S3_PREFIX}/{name}/{name}.csv"
    log.info("  Uploading to s3://%s/%s ...", S3_BUCKET, key)
    s3_client.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=buf.getvalue().encode("utf-8"),
        ContentType="text/csv",
    )
    log.info("  Upload complete: s3://%s/%s", S3_BUCKET, key)


def main():
    if not os.path.isdir(DATA_DIR):
        os.makedirs(DATA_DIR)
        log.info("Created %s/ directory — download the ZIP files there first.", DATA_DIR)
        sys.exit(0)

    s3 = boto3.client("s3")
    results = {}

    for name, config in DATASETS.items():
        buf, total_read, total_kept = process_dataset(name, config)
        if buf is None:
            results[name] = (0, 0)
            continue
        upload_to_s3(s3, name, buf)
        results[name] = (total_read, total_kept)

    log.info("=" * 60)
    log.info("PROCESSING COMPLETE — Summary:")
    log.info("  %-20s %10s %10s", "DATASET", "READ", "KEPT")
    for name, (read, kept) in results.items():
        log.info("  %-20s %10d %10d", name, read, kept)
    log.info("=" * 60)


if __name__ == "__main__":
    main()
