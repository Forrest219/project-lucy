#!/usr/bin/env python3
import json
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path.home() / ".claude" / "projects"


def iter_jsonl_files(cutoff_ts=None):
    for path in ROOT.rglob("*.jsonl"):
        try:
            st = path.stat()
        except OSError:
            continue
        if cutoff_ts is not None and st.st_mtime < cutoff_ts:
            continue
        yield path, st


def content_items(message):
    content = (message or {}).get("content")
    if isinstance(content, list):
        return content
    return []


def byte_len(value):
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def norm_sql(sql):
    return re.sub(r"\s+", " ", (sql or "").strip())


def is_aggregate_select(sql):
    s = norm_sql(sql).lower()
    return bool(re.search(r"\b(count|sum|avg|min|max|group_concat|json_arrayagg|json_objectagg)\s*\(", s) or " group by " in s)


def has_limit(sql):
    return bool(re.search(r"\blimit\b", norm_sql(sql).lower()))


def first_keyword(sql):
    m = re.match(r"\s*(/\*.*?\*/\s*)*(--[^\n]*\n\s*)*([a-zA-Z]+)", sql or "", re.S)
    return (m.group(3).upper() if m else "").upper()


def extract_text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(extract_text(v) for v in value)
    if isinstance(value, dict):
        if "text" in value:
            return str(value.get("text") or "")
        if "content" in value:
            return extract_text(value.get("content"))
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def analyze(cutoff_ts):
    files = list(iter_jsonl_files(cutoff_ts))
    uses = {}
    results_by_id = defaultdict(list)
    parse_errors = 0
    for path, st in files:
        try:
            with path.open("r", encoding="utf-8") as f:
                for line_no, line in enumerate(f, 1):
                    try:
                        rec = json.loads(line)
                    except Exception:
                        parse_errors += 1
                        continue
                    typ = rec.get("type")
                    msg = rec.get("message") or {}
                    if typ == "assistant":
                        for item in content_items(msg):
                            if isinstance(item, dict) and item.get("type") == "tool_use":
                                name = item.get("name") or ""
                                if name.startswith("mcp__ktx__"):
                                    uses[item.get("id")] = {
                                        "name": name,
                                        "input": item.get("input") or {},
                                        "path": str(path),
                                        "timestamp": rec.get("timestamp"),
                                    }
                    elif typ == "user":
                        for item in content_items(msg):
                            if isinstance(item, dict) and item.get("type") == "tool_result":
                                tid = item.get("tool_use_id")
                                if tid:
                                    results_by_id[tid].append(item)
        except OSError:
            continue

    tool_counts = Counter(u["name"] for u in uses.values())
    input_bytes = sum(byte_len(u["input"]) for u in uses.values())
    result_items = []
    result_bytes = 0
    for tid in uses:
        for r in results_by_id.get(tid, []):
            result_items.append(r)
            result_bytes += byte_len(r.get("content"))

    conns = Counter()
    sl_sources = Counter()
    sl_conns = Counter()
    sql_keywords = Counter()
    sql_select = sql_select_star = sql_select_no_limit_non_agg = sql_maxrows = 0
    sql_result_sizes = []
    sql_input_sizes = []
    by_tool_sizes = defaultdict(lambda: [0, 0, 0])
    largest_result = ("", 0, None)
    entity_input_counts = Counter()
    source_result_texts = defaultdict(Counter)
    connection_list_texts = Counter()
    daily_tool = Counter()

    for tid, u in uses.items():
        name = u["name"]
        inp = u["input"]
        if "connectionId" in inp:
            conns[inp.get("connectionId")] += 1
        if u.get("timestamp"):
            daily_tool[u["timestamp"][:10], name] += 1
        ib = byte_len(inp)
        rb = sum(byte_len(r.get("content")) for r in results_by_id.get(tid, []))
        by_tool_sizes[name][0] += 1
        by_tool_sizes[name][1] += ib
        by_tool_sizes[name][2] += rb
        if rb > largest_result[1]:
            largest_result = (name, rb, inp)
        if name == "mcp__ktx__sl_read_source":
            src = inp.get("sourceName")
            sl_sources[src] += 1
            sl_conns[inp.get("connectionId")] += 1
            txt = "\n".join(extract_text(r.get("content")) for r in results_by_id.get(tid, []))
            source_result_texts[src][txt] += 1
        elif name == "mcp__ktx__connection_list":
            txt = "\n".join(extract_text(r.get("content")) for r in results_by_id.get(tid, []))
            connection_list_texts[txt] += 1
        elif name == "mcp__ktx__entity_details":
            entities = inp.get("entities")
            if isinstance(entities, list):
                entity_input_counts[len(entities)] += 1
        elif name == "mcp__ktx__sql_execution":
            sql = inp.get("sql") or ""
            kw = first_keyword(sql)
            sql_keywords[kw] += 1
            if "maxRows" in inp and inp.get("maxRows") is not None:
                sql_maxrows += 1
            sql_input_sizes.append(ib)
            sql_result_sizes.append(rb)
            if kw == "SELECT":
                sql_select += 1
                if re.search(r"\bselect\s+\*", norm_sql(sql).lower()):
                    sql_select_star += 1
                if not has_limit(sql) and not is_aggregate_select(sql):
                    sql_select_no_limit_non_agg += 1

    print("files", len(files))
    print("parse_errors", parse_errors)
    print("tool_use", len(uses))
    print("tool_result_items_for_ktx", len(result_items))
    print("unmatched_uses", sum(1 for tid in uses if tid not in results_by_id))
    print("input_bytes", input_bytes, "mb", input_bytes / 1024 / 1024)
    print("result_bytes", result_bytes, "mb", result_bytes / 1024 / 1024)
    print("result_input_ratio", result_bytes / input_bytes if input_bytes else None)
    print("result_share", result_bytes / (result_bytes + input_bytes) if result_bytes + input_bytes else None)
    print("connections", conns)
    print("tool_counts")
    for k, v in tool_counts.most_common():
        c, ib, rb = by_tool_sizes[k]
        print(k, v, f"{v/len(uses):.4%}", "avg_in", ib / c if c else 0, "avg_res", rb / c if c else 0)
    print("sql_keywords", sql_keywords)
    print("sql_select", sql_select, "select_star", sql_select_star, "select_no_limit_non_agg", sql_select_no_limit_non_agg, "maxRows", sql_maxrows)
    print("sql_result_max", max(sql_result_sizes) if sql_result_sizes else 0, "sql_result_avg", sum(sql_result_sizes) / len(sql_result_sizes) if sql_result_sizes else 0)
    print("sl_sources_top", sl_sources.most_common(10))
    print("sl_connections", sl_conns)
    print("source_distinct_result_counts_top")
    for src, cnt in sl_sources.most_common(5):
        distinct = len(source_result_texts[src])
        max_len = max((len(t.encode("utf-8")) for t in source_result_texts[src]), default=0)
        print(src, cnt, "distinct_results", distinct, "max_text_bytes", max_len)
    print("connection_list_distinct_results", len(connection_list_texts), connection_list_texts.most_common(3))
    print("entity_entities_per_call", entity_input_counts)
    print("largest_result", largest_result)
    print("daily_tool")
    for (day, name), count in sorted(daily_tool.items()):
        if name in ("mcp__ktx__sl_read_source", "mcp__ktx__sql_execution", "mcp__ktx__connection_list"):
            print(day, name, count)


if __name__ == "__main__":
    now = datetime.now()
    print("=== rolling_7d ===")
    analyze((now - timedelta(days=7)).timestamp())
    print("=== calendar_from_2026_06_14 ===")
    analyze(datetime(2026, 6, 14, 0, 0, 0).timestamp())
