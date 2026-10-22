#!/usr/bin/env python3
"""Runs DOL_FRAUD_AGENT test questions through SNOWFLAKE.CORTEX.DATA_AGENT_RUN as a given role.
Usage: agent_test.py <out_dir> <cases.json>   cases: [{"id","role","messages":[...]}]
Writes <id>.json (raw response) and summary.json (tools, sql, final text)."""
import json, subprocess, sys, os
from concurrent.futures import ThreadPoolExecutor

CONN = os.environ.get("SNOWFLAKE_CONNECTION", "default")
AGENT = "DOL_FRAUD_DEMO.ANALYTICS.DOL_FRAUD_AGENT"

def run(case, out_dir):
    body = json.dumps({"messages": case["messages"], "stream": False})
    sql = (f"USE ROLE {case['role']}; USE SECONDARY ROLES NONE; USE WAREHOUSE DOL_FRAUD_WH;\n"
           f"SELECT SNOWFLAKE.CORTEX.DATA_AGENT_RUN('{AGENT}', $${body}$$) AS R;")
    p = subprocess.run(["snow", "sql", "-c", CONN, "--format", "json", "--enable-templating", "NONE", "-i"],
                       input=sql, capture_output=True, text=True, timeout=600)
    raw = p.stdout
    res = {"id": case["id"], "role": case["role"], "tools": [], "sql": [], "errors": [], "text": ""}
    try:
        blocks = json.loads(raw)
        r = json.loads(blocks[-1][0]["R"])
        open(f"{out_dir}/{case['id']}.json", "w").write(json.dumps(r, indent=1))
        for c in r.get("content", []):
            if c.get("type") == "tool_use":
                tu = c["tool_use"]; res["tools"].append(tu.get("name"))
                if tu.get("input", {}).get("sql"): res["sql"].append(tu["input"]["sql"])
            if c.get("type") == "tool_result":
                tr = c["tool_result"]
                if tr.get("status") == "error":
                    res["errors"].append(json.dumps(tr.get("content"))[:300])
                for cc in tr.get("content", []):
                    j = cc.get("json") or {}
                    if j.get("sql"): res["sql"].append(j["sql"])
        texts = [c["text"] for c in r.get("content", []) if c.get("type") == "text"]
        res["text"] = texts[-1] if texts else ""
    except Exception as e:
        res["errors"].append(f"harness: {e}: {(raw or p.stderr)[-500:]}")
    print(f"done {case['id']} tools={res['tools']}", flush=True)
    return res

if __name__ == "__main__":
    out_dir, cases = sys.argv[1], json.load(open(sys.argv[2]))
    os.makedirs(out_dir, exist_ok=True)
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(lambda c: run(c, out_dir), cases))
    json.dump(results, open(f"{out_dir}/summary.json", "w"), indent=1)
