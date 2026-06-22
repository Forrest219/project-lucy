#!/usr/bin/env python3
"""Generate a repeatable KTX MCP usage report from Claude Code JSONL logs."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


DEFAULT_LOG_ROOT = Path.home() / ".claude" / "projects"
DEFAULT_PROJECT_ROOT = Path("/Users/forrest/Projects/project-lucy")
DEFAULT_KTX_CLONE = Path("/Users/forrest/Projects/ktx/ktx")
AGGREGATE_RE = re.compile(
    r"\b(count|sum|avg|min|max|group_concat|json_arrayagg|json_objectagg)\s*\(",
    re.IGNORECASE,
)


@dataclass
class JsonlRecord:
    path: str
    session_id: str
    timestamp: str | None
    type: str | None
    message: dict[str, Any]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=7, help="Rolling log mtime window. Default: 7.")
    parser.add_argument("--log-root", type=Path, default=DEFAULT_LOG_ROOT)
    parser.add_argument("--project-root", type=Path, default=DEFAULT_PROJECT_ROOT)
    parser.add_argument("--ktx-clone", type=Path, default=DEFAULT_KTX_CLONE)
    parser.add_argument("--timezone", default="Asia/Shanghai")
    parser.add_argument("--output-md", type=Path)
    parser.add_argument("--output-json", type=Path)
    return parser.parse_args()


def run_text(argv: list[str], cwd: Path | None = None) -> str | None:
    try:
        proc = subprocess.run(argv, cwd=cwd, check=False, text=True, capture_output=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    text = (proc.stdout or proc.stderr or "").strip()
    return text if proc.returncode == 0 and text else None


def read_json(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def iter_jsonl_files(root: Path, cutoff_ts: float) -> list[tuple[Path, os.stat_result]]:
    files: list[tuple[Path, os.stat_result]] = []
    try:
        paths = root.rglob("*.jsonl")
    except OSError:
        return files
    for path in paths:
        try:
            stat = path.stat()
        except OSError:
            continue
        if stat.st_mtime >= cutoff_ts:
            files.append((path, stat))
    return sorted(files, key=lambda item: str(item[0]))


def content_items(message: dict[str, Any]) -> list[Any]:
    content = (message or {}).get("content")
    return content if isinstance(content, list) else []


def json_bytes(value: Any) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def extract_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(extract_text(item) for item in value)
    if isinstance(value, dict):
        if "text" in value:
            return str(value.get("text") or "")
        if "content" in value:
            return extract_text(value.get("content"))
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def normalize_sql(sql: str) -> str:
    return re.sub(r"\s+", " ", (sql or "").strip())


def first_keyword(sql: str) -> str:
    match = re.match(r"\s*(/\*.*?\*/\s*)*(--[^\n]*\n\s*)*([a-zA-Z]+)", sql or "", re.S)
    return (match.group(3) if match else "").upper()


def has_limit(sql: str) -> bool:
    return bool(re.search(r"\blimit\b", normalize_sql(sql), re.IGNORECASE))


def is_aggregate_select(sql: str) -> bool:
    normalized = normalize_sql(sql)
    return bool(AGGREGATE_RE.search(normalized) or re.search(r"\bgroup\s+by\b", normalized, re.IGNORECASE))


def timestamp_day(timestamp: str | None, tz: ZoneInfo) -> str:
    if not timestamp:
        return "unknown"
    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        return "invalid"
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(tz).date().isoformat()


def collect_records(files: list[tuple[Path, os.stat_result]]) -> tuple[list[JsonlRecord], int]:
    records: list[JsonlRecord] = []
    parse_errors = 0
    for path, _stat in files:
        try:
            with path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    try:
                        raw = json.loads(line)
                    except json.JSONDecodeError:
                        parse_errors += 1
                        continue
                    records.append(
                        JsonlRecord(
                            path=str(path),
                            session_id=str(raw.get("sessionId") or path.stem),
                            timestamp=raw.get("timestamp"),
                            type=raw.get("type"),
                            message=raw.get("message") or {},
                        )
                    )
        except OSError:
            continue
    return records, parse_errors


def route_metadata(project_root: Path, ktx_clone: Path) -> dict[str, Any]:
    mcp_config = read_json(project_root / ".mcp.json")
    ktx_url = None
    if isinstance(mcp_config, dict):
        ktx_url = (((mcp_config.get("mcpServers") or {}).get("ktx") or {}).get("url"))

    return {
        "project_root": str(project_root),
        "mcp_config_ktx_url": ktx_url,
        "proxy_route_status": "direct_ktx_7878" if ktx_url == "http://localhost:7878/mcp" else "review_required",
        "ktx_cli_path": run_text(["which", "ktx"]),
        "ktx_cli_version": run_text(["ktx", "--version"]),
        "claude_cli_path": run_text(["which", "claude"]),
        "claude_cli_version": run_text(["claude", "--version"]),
        "ktx_clone": str(ktx_clone),
        "ktx_clone_branch": run_text(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=ktx_clone),
        "ktx_clone_commit": run_text(["git", "rev-parse", "HEAD"], cwd=ktx_clone),
        "ktx_clone_remote": run_text(["git", "config", "--get", "remote.origin.url"], cwd=ktx_clone),
        "schema_basis": "source_read; live tools/list probe requires a valid KTX MCP bearer token",
    }


def analyze(args: argparse.Namespace) -> dict[str, Any]:
    tz = ZoneInfo(args.timezone)
    generated_at = datetime.now(tz)
    cutoff = datetime.now().timestamp() - args.days * 24 * 60 * 60
    files = iter_jsonl_files(args.log_root, cutoff)
    records, parse_errors = collect_records(files)

    uses: dict[str, dict[str, Any]] = {}
    results_by_id: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for record in records:
        if record.type == "assistant":
            for item in content_items(record.message):
                if isinstance(item, dict) and item.get("type") == "tool_use":
                    name = str(item.get("name") or "")
                    tool_use_id = item.get("id")
                    if tool_use_id and name.startswith("mcp__ktx__"):
                        uses[str(tool_use_id)] = {
                            "id": str(tool_use_id),
                            "name": name,
                            "input": item.get("input") or {},
                            "path": record.path,
                            "session_id": record.session_id,
                            "timestamp": record.timestamp,
                            "day": timestamp_day(record.timestamp, tz),
                        }
        elif record.type == "user":
            for item in content_items(record.message):
                if isinstance(item, dict) and item.get("type") == "tool_result":
                    tool_use_id = item.get("tool_use_id")
                    if tool_use_id:
                        results_by_id[str(tool_use_id)].append(item)

    tool_counts: Counter[str] = Counter()
    by_tool_bytes: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    daily_counts: Counter[str] = Counter()
    daily_by_tool: Counter[tuple[str, str]] = Counter()
    connection_counts: Counter[str] = Counter()
    sl_sources: Counter[str] = Counter()
    sl_connections: Counter[str] = Counter()
    sl_source_results: dict[str, Counter[str]] = defaultdict(Counter)
    session_source_reads: dict[str, Counter[str]] = defaultdict(Counter)
    connection_list_results: Counter[str] = Counter()
    entity_batch_sizes: Counter[str] = Counter()
    largest_results: list[dict[str, Any]] = []

    sql_keywords: Counter[str] = Counter()
    sql_select = 0
    sql_select_star = 0
    sql_select_without_limit = 0
    sql_select_without_limit_non_agg = 0
    sql_maxrows_set = 0
    sql_result_bytes: list[int] = []

    result_items = []
    total_input_bytes = 0
    total_result_bytes = 0

    for tool_use_id, use in uses.items():
        name = use["name"]
        short_name = name.removeprefix("mcp__ktx__")
        input_value = use["input"]
        result_list = results_by_id.get(tool_use_id, [])
        input_size = json_bytes(input_value)
        result_size = sum(json_bytes(result.get("content")) for result in result_list)

        tool_counts[short_name] += 1
        by_tool_bytes[short_name][0] += 1
        by_tool_bytes[short_name][1] += input_size
        by_tool_bytes[short_name][2] += result_size
        total_input_bytes += input_size
        total_result_bytes += result_size
        result_items.extend(result_list)
        daily_counts[use["day"]] += 1
        daily_by_tool[(use["day"], short_name)] += 1

        connection_id = input_value.get("connectionId")
        if connection_id is not None:
            connection_counts[str(connection_id)] += 1

        if result_size:
            largest_results.append(
                {
                    "tool": short_name,
                    "result_bytes": result_size,
                    "input": input_value,
                    "session_id": use["session_id"],
                    "timestamp": use["timestamp"],
                }
            )

        if short_name == "sl_read_source":
            source = str(input_value.get("sourceName") or "")
            sl_sources[source] += 1
            if connection_id is not None:
                sl_connections[str(connection_id)] += 1
            session_source_reads[use["session_id"]][source] += 1
            text = "\n".join(extract_text(result.get("content")) for result in result_list)
            sl_source_results[source][text] += 1
        elif short_name == "connection_list":
            text = "\n".join(extract_text(result.get("content")) for result in result_list)
            connection_list_results[text] += 1
        elif short_name == "entity_details":
            entities = input_value.get("entities")
            entity_batch_sizes[str(len(entities) if isinstance(entities, list) else "unknown")] += 1
        elif short_name == "sql_execution":
            sql = str(input_value.get("sql") or "")
            keyword = first_keyword(sql)
            sql_keywords[keyword] += 1
            sql_result_bytes.append(result_size)
            if input_value.get("maxRows") is not None:
                sql_maxrows_set += 1
            if keyword == "SELECT":
                sql_select += 1
                normalized = normalize_sql(sql)
                if re.search(r"\bselect\s+\*", normalized, re.IGNORECASE):
                    sql_select_star += 1
                if not has_limit(sql):
                    sql_select_without_limit += 1
                    if not is_aggregate_select(sql):
                        sql_select_without_limit_non_agg += 1

    repeated_source_sessions = []
    for session_id, counter in session_source_reads.items():
        for source, count in counter.items():
            if count > 1:
                repeated_source_sessions.append({"session_id": session_id, "sourceName": source, "count": count})

    largest_results.sort(key=lambda row: row["result_bytes"], reverse=True)
    result_input_ratio = (total_result_bytes / total_input_bytes) if total_input_bytes else None

    by_tool = []
    for tool, count in tool_counts.most_common():
        byte_row = by_tool_bytes[tool]
        by_tool.append(
            {
                "tool": tool,
                "count": count,
                "share": count / len(uses) if uses else 0,
                "input_bytes": byte_row[1],
                "result_bytes": byte_row[2],
                "avg_input_bytes": byte_row[1] / byte_row[0] if byte_row[0] else 0,
                "avg_result_bytes": byte_row[2] / byte_row[0] if byte_row[0] else 0,
            }
        )

    sql_summary = {
        "total": tool_counts.get("sql_execution", 0),
        "keywords": dict(sql_keywords.most_common()),
        "select": sql_select,
        "select_star": sql_select_star,
        "select_without_limit": sql_select_without_limit,
        "select_without_limit_non_aggregate": sql_select_without_limit_non_agg,
        "select_without_limit_non_aggregate_share_of_select": (
            sql_select_without_limit_non_agg / sql_select if sql_select else None
        ),
        "maxRows_set": sql_maxrows_set,
        "avg_result_bytes": sum(sql_result_bytes) / len(sql_result_bytes) if sql_result_bytes else 0,
        "max_result_bytes": max(sql_result_bytes) if sql_result_bytes else 0,
        "aggregate_detection": "count/sum/avg/min/max/group_concat/json_arrayagg/json_objectagg/GROUP BY",
    }

    return {
        "generated_at": generated_at.isoformat(timespec="seconds"),
        "window": {
            "days": args.days,
            "log_root": str(args.log_root),
            "file_mtime_cutoff": datetime.fromtimestamp(cutoff, tz).isoformat(timespec="seconds"),
            "timezone": args.timezone,
        },
        "metadata": route_metadata(args.project_root, args.ktx_clone),
        "files": {"count": len(files), "parse_errors": parse_errors},
        "totals": {
            "ktx_tool_use": len(uses),
            "ktx_tool_result_items": len(result_items),
            "unmatched_uses": sum(1 for tool_use_id in uses if tool_use_id not in results_by_id),
            "input_bytes_json": total_input_bytes,
            "result_bytes_json": total_result_bytes,
            "result_input_ratio": result_input_ratio,
        },
        "by_tool": by_tool,
        "daily_counts": dict(sorted(daily_counts.items())),
        "daily_by_tool": [
            {"day": day, "tool": tool, "count": count}
            for (day, tool), count in sorted(daily_by_tool.items())
        ],
        "connections": dict(connection_counts.most_common()),
        "sl_read_source": {
            "top_sources": [{"sourceName": source, "count": count} for source, count in sl_sources.most_common(20)],
            "connections": dict(sl_connections.most_common()),
            "distinct_result_counts": [
                {
                    "sourceName": source,
                    "calls": sl_sources[source],
                    "distinct_results": len(counter),
                    "largest_text_bytes": max((len(text.encode("utf-8")) for text in counter), default=0),
                }
                for source, counter in sorted(
                    sl_source_results.items(), key=lambda item: sl_sources[item[0]], reverse=True
                )[:20]
            ],
            "repeated_source_sessions": sorted(
                repeated_source_sessions, key=lambda row: row["count"], reverse=True
            )[:50],
        },
        "connection_list": {
            "distinct_results": len(connection_list_results),
            "top_result_counts": [count for _text, count in connection_list_results.most_common(5)],
        },
        "entity_details": {"entities_per_call": dict(entity_batch_sizes.most_common())},
        "sql_execution": sql_summary,
        "largest_results": largest_results[:10],
    }


def pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.1%}"


def mib(value: int | float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value / 1024 / 1024:.2f} MiB"


def render_markdown(report: dict[str, Any]) -> str:
    metadata = report["metadata"]
    totals = report["totals"]
    lines = [
        "# KTX MCP Usage Weekly Report",
        "",
        f"- Generated at: `{report['generated_at']}`",
        f"- Window: last `{report['window']['days']}` days by JSONL file mtime; daily buckets use record timestamp in `{report['window']['timezone']}`",
        f"- Log root: `{report['window']['log_root']}`",
        f"- Files scanned: `{report['files']['count']}`; parse errors: `{report['files']['parse_errors']}`",
        "",
        "## Route And Version Baseline",
        "",
        f"- Project MCP KTX URL: `{metadata.get('mcp_config_ktx_url')}`",
        f"- Route status: `{metadata.get('proxy_route_status')}`",
        f"- KTX CLI: `{metadata.get('ktx_cli_path')}` / `{metadata.get('ktx_cli_version')}`",
        f"- Claude Code: `{metadata.get('claude_cli_path')}` / `{metadata.get('claude_cli_version')}`",
        f"- KTX clone: `{metadata.get('ktx_clone')}`",
        f"- KTX clone branch/commit: `{metadata.get('ktx_clone_branch')}` / `{metadata.get('ktx_clone_commit')}`",
        f"- KTX remote: `{metadata.get('ktx_clone_remote')}`",
        f"- Schema basis: `{metadata.get('schema_basis')}`",
        "",
        "## Totals",
        "",
        f"- KTX tool_use: `{totals['ktx_tool_use']}`",
        f"- KTX tool_result items matched by tool_use_id: `{totals['ktx_tool_result_items']}`",
        f"- Unmatched KTX tool_use: `{totals['unmatched_uses']}`",
        f"- Input bytes, JSON-encoded: `{totals['input_bytes_json']}` ({mib(totals['input_bytes_json'])})",
        f"- Result bytes, JSON-encoded content: `{totals['result_bytes_json']}` ({mib(totals['result_bytes_json'])})",
        f"- Result/input ratio: `{totals['result_input_ratio']:.2f}`" if totals["result_input_ratio"] is not None else "- Result/input ratio: `n/a`",
        "",
        "## Tool Distribution",
        "",
        "| Tool | Count | Share | Avg input bytes | Avg result bytes |",
        "|---|---:|---:|---:|---:|",
    ]

    for row in report["by_tool"]:
        lines.append(
            f"| `{row['tool']}` | {row['count']} | {pct(row['share'])} | "
            f"{row['avg_input_bytes']:.0f} | {row['avg_result_bytes']:.0f} |"
        )

    lines.extend(
        [
            "",
            "## Daily Distribution",
            "",
            "| Day | KTX tool_use |",
            "|---|---:|",
        ]
    )
    for day, count in report["daily_counts"].items():
        lines.append(f"| `{day}` | {count} |")

    lines.extend(
        [
            "",
            "## sl_read_source",
            "",
            "| Source | Calls |",
            "|---|---:|",
        ]
    )
    for row in report["sl_read_source"]["top_sources"][:15]:
        lines.append(f"| `{row['sourceName']}` | {row['count']} |")

    lines.extend(
        [
            "",
            "### Repeated Reads In Same Session",
            "",
            "| Session | Source | Calls |",
            "|---|---|---:|",
        ]
    )
    repeated = report["sl_read_source"]["repeated_source_sessions"][:20]
    if repeated:
        for row in repeated:
            lines.append(f"| `{row['session_id']}` | `{row['sourceName']}` | {row['count']} |")
    else:
        lines.append("| n/a | n/a | 0 |")

    sql = report["sql_execution"]
    lines.extend(
        [
            "",
            "## sql_execution",
            "",
            f"- Total calls: `{sql['total']}`",
            f"- SELECT calls: `{sql['select']}`",
            f"- SELECT * calls: `{sql['select_star']}`",
            f"- SELECT without LIMIT: `{sql['select_without_limit']}`",
            f"- SELECT without LIMIT and not aggregate: `{sql['select_without_limit_non_aggregate']}` ({pct(sql['select_without_limit_non_aggregate_share_of_select'])} of SELECT)",
            f"- Explicit maxRows set: `{sql['maxRows_set']}`",
            f"- Aggregate recognition: `{sql['aggregate_detection']}`",
            "",
            "### SQL First Keyword",
            "",
            "| Keyword | Count |",
            "|---|---:|",
        ]
    )
    for keyword, count in sql["keywords"].items():
        lines.append(f"| `{keyword or 'unknown'}` | {count} |")

    connection_list = report["connection_list"]
    lines.extend(
        [
            "",
            "## connection_list",
            "",
            f"- Distinct result payloads: `{connection_list['distinct_results']}`",
            f"- Top identical-result counts: `{connection_list['top_result_counts']}`",
            "",
            "## Notes",
            "",
            "- Byte counts use compact JSON encoding (`ensure_ascii=false`, no spaces). They are stable for before/after comparison, not wire-level packet sizes.",
            "- KTX result matching is restricted to `tool_result.tool_use_id` values produced by `mcp__ktx__*` tool_use records.",
            "- The rolling window selects JSONL files by file mtime; the daily distribution itself uses each record's embedded timestamp.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> int:
    args = parse_args()
    report = analyze(args)

    if args.output_json:
        args.output_json.parent.mkdir(parents=True, exist_ok=True)
        args.output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    rendered = render_markdown(report)
    if args.output_md:
        args.output_md.parent.mkdir(parents=True, exist_ok=True)
        args.output_md.write_text(rendered, encoding="utf-8")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
