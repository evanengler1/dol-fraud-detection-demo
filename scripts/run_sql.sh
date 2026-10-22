#!/bin/zsh
# Runs one or more demo SQL files in order with the demo connection.
# Usage: run_sql.sh 05_synthetic_data.sql 06_curated_dynamic_tables.sql ...
cd "$(dirname "$0")/../sql" || exit 1
for f in "$@"; do
  echo "=== $f"
  snow sql -c "${SNOWFLAKE_CONNECTION:-default}" --enable-templating NONE -f "$f" > "/tmp/run_${f:t:r}.out" 2>&1
  if grep -qE "[0-9]{6} \([0-9A-Z]{5}\)" "/tmp/run_${f:t:r}.out"; then
    echo "ERROR in $f:"; grep -E -A4 "[0-9]{6} \([0-9A-Z]{5}\)" "/tmp/run_${f:t:r}.out" | head -12
    exit 1
  fi
  echo "ok (log: /tmp/run_${f:t:r}.out)"
done
