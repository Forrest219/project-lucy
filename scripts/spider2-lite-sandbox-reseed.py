#!/usr/bin/env python3
"""ETL Spider2-lite Pilot SQLite DBs -> StarRocks sandbox.s2_* tables.

Usage:
  STARROCKS_PASSWORD=$(cat .ktx/secrets/starrocks-r1-password) \\
    python3 inbox/spider2-lite-sqlite/etl/load_pilot_to_sandbox.py
"""
from __future__ import annotations

import csv
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_DIR = ROOT / "databases"
OUT_DIR = ROOT / "etl"
HOST = os.environ.get("STARROCKS_HOST", "10.69.65.62")
PORT = int(os.environ.get("STARROCKS_PORT", "8090"))
USER = os.environ.get("STARROCKS_USER", "admin")
PASSWORD = os.environ.get("STARROCKS_PASSWORD") or ""
DATABASE = "sandbox"
MYSQL = os.environ.get("MYSQL_CLIENT", "/opt/homebrew/opt/mysql-client/bin/mysql")
BATCH = int(os.environ.get("ETL_BATCH", "800"))

PILOT = {
    "sakila": "sqlite-sakila.sqlite",
    "chinook": "chinook.sqlite",
    "northwind": "northwind.sqlite",
    "pagila": "Pagila.sqlite",
    "ecommerce": "E_commerce.sqlite",
}

# Skip binary / useless columns for analytics pilot
SKIP_COLUMNS = {
    ("sakila", "staff"): {"picture"},
    ("pagila", "staff"): {"picture"},
    ("northwind", "categories"): {"picture"},
    ("northwind", "employees"): {"photo"},
}

RESERVED = {
    "order", "group", "rank", "select", "from", "where", "table", "column",
    "user", "key", "keys", "index", "schema", "database", "default",
}


def qident(name: str) -> str:
    return f"`{name}`"


def map_type(sqlite_type: str | None, col_name: str) -> str:
    t = (sqlite_type or "").upper().strip()
    if not t or t in {"NONE", "NULL"}:
        return "VARCHAR(65533)"
    if "BLOB" in t and "TEXT" not in t:
        return "VARCHAR(65533)"  # should be skipped; fallback
    if any(x in t for x in ("INT", "NUMERIC", "SMALLINT", "TINYINT", "BIGINT", "INTEGER")):
        if "DECIMAL" in t or "NUMERIC(" in t:
            m = re.search(r"\((\d+)\s*,\s*(\d+)\)", t)
            if m:
                return f"DECIMAL({m.group(1)},{m.group(2)})"
            return "DOUBLE"
        return "BIGINT"
    if any(x in t for x in ("REAL", "DOUBLE", "FLOAT")):
        return "DOUBLE"
    if "DECIMAL" in t or "NUMERIC(" in t:
        m = re.search(r"\((\d+)\s*,\s*(\d+)\)", t)
        if m:
            return f"DECIMAL({m.group(1)},{m.group(2)})"
        return "DOUBLE"
    if any(x in t for x in ("TIMESTAMP", "DATETIME", "DATE")):
        if "DATE" in t and "TIME" not in t and "TIMESTAMP" not in t:
            return "DATE"
        return "DATETIME"
    if "BOOL" in t:
        return "BOOLEAN"
    # VARCHAR / CHAR / TEXT / NVARCHAR
    m = re.search(r"\((\d+)\)", t)
    if m and ("CHAR" in t or "VARCHAR" in t or "NVARCHAR" in t):
        n = min(int(m.group(1)), 65533)
        n = max(n, 1)
        return f"VARCHAR({n})"
    if "TEXT" in t or "CLOB" in t or "CHAR" in t or "VARCHAR" in t or "NVARCHAR" in t:
        return "VARCHAR(65533)"
    return "VARCHAR(65533)"


def safe_col(name: str) -> str:
    n = name.strip()
    if n.lower() in RESERVED:
        return f"{n}_col"
    # StarRocks identifiers: keep alnum underscore
    n2 = re.sub(r"[^A-Za-z0-9_]", "_", n)
    if re.match(r"^\d", n2):
        n2 = f"c_{n2}"
    return n2


def table_name(db_short: str, src_table: str) -> str:
    t = safe_col(src_table).lower()
    return f"s2_{db_short}_{t}"


def mysql_exec(sql: str, *, database: str | None = DATABASE) -> str:
    cmd = [
        MYSQL,
        "-h", HOST,
        "-P", str(PORT),
        "-u", USER,
        f"-p{PASSWORD}",
        "--batch",
        "--raw",
        "--connect-timeout=20",
    ]
    if database:
        cmd += ["-D", database]
    cmd += ["-e", sql]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"mysql failed:\n{r.stderr}\nSQL head:\n{sql[:500]}")
    return r.stdout


def fetch_schema(sqlite_path: Path, db_short: str):
    con = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    tables = [
        r[0]
        for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY 1"
        )
    ]
    schemas = []
    for t in tables:
        info = con.execute(f'PRAGMA table_info("{t}")').fetchall()
        skip = SKIP_COLUMNS.get((db_short, t), set()) | SKIP_COLUMNS.get((db_short, t.lower()), set())
        cols = []
        for c in info:
            cname = c[1]
            if cname in skip or cname.lower() in {s.lower() for s in skip}:
                continue
            cols.append(
                {
                    "src": cname,
                    "dst": safe_col(cname),
                    "sr_type": map_type(c[2], cname),
                    "notnull": bool(c[3]),
                    "pk": bool(c[5]),
                }
            )
        if not cols:
            continue
        n = con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        schemas.append({"src": t, "dst": table_name(db_short, t), "cols": cols, "rows": n})
    con.close()
    return schemas


def create_ddl(tbl: dict) -> str:
    cols = tbl["cols"]
    # pick key: pk cols else first col
    pk = [c["dst"] for c in cols if c["pk"]]
    key_cols = pk[:3] if pk else [cols[0]["dst"]]
    # StarRocks key columns must be listed first
    key_set = set(key_cols)
    ordered = [c for c in cols if c["dst"] in key_set] + [c for c in cols if c["dst"] not in key_set]
    col_defs = []
    for c in ordered:
        # keep nullable for ETL simplicity
        col_defs.append(f"  {qident(c['dst'])} {c['sr_type']}")
    key_list = ", ".join(qident(k) for k in key_cols)
    dist = qident(key_cols[0])
    cols_body = ",\n".join(col_defs)
    return (
        f"DROP TABLE IF EXISTS {qident(DATABASE)}.{qident(tbl['dst'])};\n"
        f"CREATE TABLE {qident(DATABASE)}.{qident(tbl['dst'])} (\n"
        f"{cols_body}\n"
        f")\n"
        f"ENGINE=OLAP\n"
        f"DUPLICATE KEY({key_list})\n"
        f"DISTRIBUTED BY HASH({dist}) BUCKETS 4\n"
        f"PROPERTIES (\n"
        f'  "replication_num" = "1"\n'
        f");"
    )


def export_csv(sqlite_path: Path, tbl: dict, csv_path: Path) -> int:
    con = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    src_cols = [c["src"] for c in tbl["cols"]]
    select = ", ".join(f'"{c}"' for c in src_cols)
    cur = con.execute(f'SELECT {select} FROM "{tbl["src"]}"')
    n = 0
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
        for row in cur:
            out = []
            for v in row:
                if v is None:
                    out.append("\\N")
                elif isinstance(v, bytes):
                    out.append("")
                else:
                    s = str(v)
                    # normalize newlines in text fields
                    s = s.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
                    out.append(s)
            w.writerow(out)
            n += 1
    con.close()
    return n


def load_csv_via_insert(tbl: dict, csv_path: Path) -> int:
    """Batch INSERT from CSV (\\N = NULL)."""
    cols = [c["dst"] for c in tbl["cols"]]
    col_sql = ", ".join(qident(c) for c in cols)
    loaded = 0
    batch: list[str] = []

    def flush():
        nonlocal loaded, batch
        if not batch:
            return
        values = ",\n".join(batch)
        sql = f"INSERT INTO {qident(DATABASE)}.{qident(tbl['dst'])} ({col_sql}) VALUES\n{values};"
        mysql_exec(sql)
        loaded += len(batch)
        batch = []

    with csv_path.open("r", encoding="utf-8", newline="") as f:
        r = csv.reader(f)
        for row in r:
            vals = []
            for i, raw in enumerate(row):
                if raw == "\\N":
                    vals.append("NULL")
                    continue
                sr_t = tbl["cols"][i]["sr_type"]
                if sr_t in {"BIGINT", "DOUBLE", "BOOLEAN"} or sr_t.startswith("DECIMAL"):
                    if raw == "":
                        vals.append("NULL")
                    else:
                        vals.append(raw)
                elif sr_t in {"DATE", "DATETIME"}:
                    if raw == "":
                        vals.append("NULL")
                    else:
                        # quote dates
                        vals.append("'" + raw.replace("'", "''") + "'")
                else:
                    vals.append("'" + raw.replace("\\", "\\\\").replace("'", "''") + "'")
            batch.append("(" + ", ".join(vals) + ")")
            if len(batch) >= BATCH:
                flush()
                if loaded % (BATCH * 10) == 0:
                    print(f"    ... {tbl['dst']} loaded {loaded}", flush=True)
        flush()
    return loaded


def main() -> int:
    if not PASSWORD:
        print("STARROCKS_PASSWORD required", file=sys.stderr)
        return 2
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    mysql_exec(f"CREATE DATABASE IF NOT EXISTS {qident(DATABASE)};", database=None)

    summary = {"host": HOST, "port": PORT, "database": DATABASE, "dbs": {}}
    with tempfile.TemporaryDirectory(prefix="s2etl_") as tmp:
        tmp_path = Path(tmp)
        for db_short, fname in PILOT.items():
            sqlite_path = DB_DIR / fname
            if not sqlite_path.exists():
                raise FileNotFoundError(sqlite_path)
            print(f"\n=== {db_short} ({fname}) ===", flush=True)
            schemas = fetch_schema(sqlite_path, db_short)
            db_sum = []
            for tbl in schemas:
                print(f"  create {tbl['dst']} (src={tbl['src']} rows={tbl['rows']})", flush=True)
                ddl = create_ddl(tbl)
                (OUT_DIR / f"{tbl['dst']}.sql").write_text(ddl + "\n")
                mysql_exec(ddl)
                csv_path = tmp_path / f"{tbl['dst']}.csv"
                n_export = export_csv(sqlite_path, tbl, csv_path)
                n_load = load_csv_via_insert(tbl, csv_path)
                # verify
                out = mysql_exec(f"SELECT COUNT(*) FROM {qident(tbl['dst'])};")
                # batch output: first line header, second count
                lines = [l for l in out.strip().splitlines() if l.strip()]
                cnt = int(lines[-1]) if lines else -1
                ok = cnt == tbl["rows"]
                print(f"  verify {tbl['dst']}: sqlite={tbl['rows']} export={n_export} load={n_load} sr={cnt} {'OK' if ok else 'MISMATCH'}", flush=True)
                db_sum.append(
                    {
                        "table": tbl["dst"],
                        "src_table": tbl["src"],
                        "sqlite_rows": tbl["rows"],
                        "sr_rows": cnt,
                        "ok": ok,
                        "columns": [c["dst"] for c in tbl["cols"]],
                    }
                )
            summary["dbs"][db_short] = db_sum

    out_json = OUT_DIR / "pilot-load-summary.json"
    out_json.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    # flat enabled_tables list
    tables = []
    for db_sum in summary["dbs"].values():
        for t in db_sum:
            tables.append(f"sandbox.{t['table']}")
    (OUT_DIR / "pilot-enabled-tables.txt").write_text("\n".join(tables) + "\n")
    mismatches = [t for db in summary["dbs"].values() for t in db if not t["ok"]]
    print(f"\nWrote {out_json}")
    print(f"tables={len(tables)} mismatches={len(mismatches)}")
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(main())
