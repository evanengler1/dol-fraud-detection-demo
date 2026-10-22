#!/usr/bin/env bash
# Rebuild lib/server/persona-grants.json from live grants (used by persona emulation in SPCS).
set -euo pipefail
CONN="${1:-${SNOWFLAKE_CONNECTION:-default}}"
OUT="$(dirname "$0")/../lib/server/persona-grants.json"
python3 - "$CONN" "$OUT" <<'PY'
import json, subprocess, sys
conn, out = sys.argv[1], sys.argv[2]
roles = ["DOL_OUI_ANALYST", "DOL_WHD_INVESTIGATOR", "DOL_OSHA_INSPECTOR", "DOL_OIG_EXECUTIVE", "DOL_STATE_PARTNER_TX"]
grants = {}
for r in roles:
    q = (f"SHOW GRANTS TO ROLE {r}; SELECT \"name\" FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())) "
         "WHERE \"privilege\" IN ('SELECT','USAGE') AND \"granted_on\" IN "
         "('TABLE','VIEW','DYNAMIC_TABLE','CORTEX_SEARCH_SERVICE','SEMANTIC_VIEW') ORDER BY 1")
    res = json.loads(subprocess.check_output(["snow", "sql", "-c", conn, "--format", "JSON", "-q", q]))
    rows = res[-1] if isinstance(res[0], list) else res
    grants[r] = [x["name"] for x in rows]
doc = {"_comment": "Snapshot of SELECT/USAGE grants per persona role on DOL_FRAUD_DEMO objects. "
       "Regenerate with scripts/snapshot-grants.sh after changing sql/11_governance.sql.", "grants": grants}
open(out, "w").write(json.dumps(doc, indent=2) + "\n")
print({k: len(v) for k, v in grants.items()})
PY
