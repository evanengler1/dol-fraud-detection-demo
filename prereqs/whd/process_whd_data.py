#!/usr/bin/env python3
"""
Process the downloaded DOL WHD enforcement bulk CSV ZIP:
  1. Read all CSV chunks inside data/WHD_enforcement.zip
  2. Filter rows to FINDINGS_START_DATE >= 2016-01-01
  3. Lowercase column keys and upload one filtered CSV to S3 for Snowflake ingestion

Values are written exactly as read (raw layer, no transformation).

Usage:
    1. Place WHD_enforcement.zip in data/
    2. export AWS credentials and S3_BUCKET=<your bucket>
    3. python3 process_whd_data.py
"""

import os
import sys
import csv
import io
import zipfile
import logging
import boto3

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

S3_BUCKET = os.environ.get("S3_BUCKET", "YOUR-BUCKET")
S3_PREFIX = "whd-raw"
DATA_DIR = "data"
ZIP_NAME = "WHD_enforcement.zip"
DATASET = "whd_enforcement"
DATE_FIELD = "FINDINGS_START_DATE"
# Source dates are ISO strings ("2016-01-01 00:00:00+00:00"), so string comparison is valid
DATE_CUTOFF = "2016-01-01"


def find_csv_in_zip(zip_path: str) -> list[str]:
    """List CSV files inside a ZIP archive."""
    with zipfile.ZipFile(zip_path, "r") as zf:
        return [n for n in zf.namelist() if n.lower().endswith(".csv")]


def process_dataset(zip_path: str) -> tuple[io.StringIO, int, int]:
    log.info("=== Processing %s ===", zip_path)

    csv_files = sorted(find_csv_in_zip(zip_path))
    if not csv_files:
        log.error("  No CSV files found in ZIP")
        return None, 0, 0

    log.info("  Found %d CSV part(s) in ZIP", len(csv_files))

    buf = io.StringIO()
    writer = None
    total_read = 0
    total_kept = 0

    with zipfile.ZipFile(zip_path, "r") as zf:
        for csv_name in csv_files:
            log.info("  Reading %s ...", csv_name)
            with zf.open(csv_name) as f:
                text = io.TextIOWrapper(f, encoding="utf-8", errors="replace")
                reader = csv.DictReader(text)
                if writer is None:
                    # derive columns from the header; lowercase to match Snowflake table columns
                    columns = [c.lower() for c in reader.fieldnames]
                    writer = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore")
                    writer.writeheader()
                    log.info("  %d columns detected", len(columns))
                for row in reader:
                    total_read += 1
                    date_val = (row.get(DATE_FIELD) or "").strip()
                    if date_val < DATE_CUTOFF:
                        continue
                    writer.writerow({k.lower(): v for k, v in row.items()})
                    total_kept += 1

                    if total_read % 100000 == 0:
                        log.info("    ... %d read, %d kept so far", total_read, total_kept)

    log.info("  DONE — %d read, %d kept (after date filter)", total_read, total_kept)
    buf.seek(0)
    return buf, total_read, total_kept


def upload_to_s3(s3_client, buf: io.StringIO):
    key = f"{S3_PREFIX}/{DATASET}/{DATASET}.csv"
    log.info("  Uploading to s3://%s/%s ...", S3_BUCKET, key)
    s3_client.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=buf.getvalue().encode("utf-8"),
        ContentType="text/csv",
    )
    log.info("  Upload complete: s3://%s/%s", S3_BUCKET, key)


def main():
    zip_path = os.path.join(DATA_DIR, ZIP_NAME)
    if not os.path.exists(zip_path):
        log.error("ZIP not found at %s — download it into %s/ first.", zip_path, DATA_DIR)
        sys.exit(1)

    buf, total_read, total_kept = process_dataset(zip_path)
    if buf is None:
        sys.exit(1)

    upload_to_s3(boto3.client("s3"), buf)

    log.info("=" * 60)
    log.info("PROCESSING COMPLETE — %s: %d read, %d kept", DATASET, total_read, total_kept)
    log.info("=" * 60)


if __name__ == "__main__":
    main()
