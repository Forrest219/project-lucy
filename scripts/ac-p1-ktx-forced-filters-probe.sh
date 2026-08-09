#!/usr/bin/env bash
# Reproduce AC-P1 Gate C item 1: KTX forced_filters outer-AND + DuckDB row ⊆ domain.
# Requires sibling checkout: ../ktx (or KTX_ROOT).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KTX_ROOT="${KTX_ROOT:-$(cd "$ROOT/../ktx" && pwd)}"
SL="$KTX_ROOT/python/ktx-sl"
OUT="$ROOT/inbox/20260809-ac-p1-ktx-forced-filters"
mkdir -p "$OUT"

echo "[probe] KTX_ROOT=$KTX_ROOT"
git -C "$KTX_ROOT" rev-parse HEAD | tee "$OUT/00-ktx-commit.txt"
git -C "$KTX_ROOT" status -sb | head -40 | tee "$OUT/00-ktx-status.txt"

cd "$SL"
uv run pytest tests/test_forced_filters.py -q --no-cov | tee "$OUT/01-ktx-sl-pytest.txt"

uv run --with duckdb python - <<'PY' | tee "$OUT/03-field-injection-neg.txt"
from semantic_layer.engine import SemanticEngine
from semantic_layer.forced_filters import compile_forced_filters_sql, resolve_forced_field
from semantic_layer.models import SourceDefinition, SourceColumn, MeasureDefinition

orders = SourceDefinition(
    name="orders",
    table="orders",
    grain=["orders.id"],
    columns=[
        SourceColumn(name="id", type="number"),
        SourceColumn(name="status", type="string"),
        SourceColumn(name="amount", type="number"),
    ],
    measures=[MeasureDefinition(name="revenue", expr="sum(orders.amount)")],
)
sources = {"orders": orders}
engine = SemanticEngine.from_sources(sources, dialect="duckdb")
try:
    compile_forced_filters_sql(
        {"or": [{"and": [{"field": "orders.status) OR 1=1 --", "op": "eq", "value": "East"}]}]},
        sources,
    )
    raise SystemExit("FAIL: injection field accepted")
except Exception as e:
    print("REJECT injection field:", e)
try:
    resolve_forced_field("orders.revenue", sources)
    raise SystemExit("FAIL: measure accepted")
except ValueError as e:
    print("REJECT measure field:", e)
try:
    engine.query(
        {
            "measures": ["sum(orders.amount)"],
            "dimensions": ["orders.status"],
            "forced_filters": {
                "or": [{"and": [{"field": "orders.status) OR 1=1 --", "op": "eq", "value": "East"}]}]
            },
        }
    )
    raise SystemExit("FAIL: engine accepted injection")
except Exception as e:
    print("ENGINE REJECT:", e)
print("field-injection negatives: PASS")
PY

uv run --with duckdb python - <<'PY' | tee "$OUT/02-duckdb-by01-rowset.txt"
from semantic_layer.engine import SemanticEngine
from semantic_layer.models import SourceDefinition, SourceColumn, MeasureDefinition
import duckdb

orders = SourceDefinition(
    name="orders",
    table="orders",
    grain=["orders.id"],
    columns=[
        SourceColumn(name="id", type="number"),
        SourceColumn(name="status", type="string"),
        SourceColumn(name="amount", type="number"),
    ],
    measures=[MeasureDefinition(name="revenue", expr="sum(orders.amount)")],
)
engine = SemanticEngine.from_sources({"orders": orders}, dialect="duckdb")
result = engine.query(
    {
        "measures": ["sum(orders.amount)"],
        "dimensions": ["orders.status"],
        "filters": ["1 = 1 OR orders.status = 'West'"],
        "forced_filters": {
            "or": [{"and": [{"field": "orders.status", "op": "eq", "value": "East"}]}]
        },
    }
)
print("SQL:", result.sql)
con = duckdb.connect()
con.execute(
    "CREATE TABLE orders AS SELECT * FROM (VALUES (1,'East',10),(2,'West',20),(3,'East',30)) t(id,status,amount)"
)
rows = con.execute(result.sql).fetchall()
print("ROWS:", rows)
assert rows == [("East", 40)], rows
print("BY-01 anti-widen row ⊆ domain: PASS")
PY

echo "[probe] OK — see $OUT and docs/access-control/evidence-ktx-forced-filters.md"
