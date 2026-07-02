#!/usr/bin/env python3
"""Convert the CEO one-page report DOCX into AI-readable Markdown and data files."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from docx import Document
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph


SQL_START_RE = re.compile(
    r"^\s*(select|with|create\s+table|insert|update|delete|from|where|group\s+by|order\s+by|union|case|when|left\s+join|inner\s+join|join|and\b|or\b|limit\b|--|,|\)|\*)",
    re.IGNORECASE,
)
DDL_TABLE_RE = re.compile(r"CREATE\s+TABLE\s+`?([^`\s(]+)`?", re.IGNORECASE)
DDL_COLUMN_RE = re.compile(
    r"^\s*`(?P<name>[^`]+)`\s+(?P<type>[A-Za-z0-9(),]+)(?P<rest>.*?)(?:COMMENT\s+'(?P<comment>[^']*)')?\s*,?\s*$",
    re.IGNORECASE,
)
SECRET_PATTERNS = [
    (re.compile(r"(?i)(client_secret=)[^&\s|]+"), r"\1<REDACTED>"),
    (re.compile(r"(?i)(password=)[^&\s|]+"), r"\1<REDACTED>"),
    (re.compile(r"(?i)(access_token=)[^&\s|]+"), r"\1<REDACTED>"),
    (re.compile(r"(?i)(refresh_token=)[^&\s|]+"), r"\1<REDACTED>"),
    (re.compile(r"(?i)(authorization[:=]\s*bearer\s+)[A-Za-z0-9._~+/-]+"), r"\1<REDACTED>"),
]


@dataclass
class Block:
    kind: str
    text: str = ""
    style: str = ""
    table_id: int | None = None
    rows: list[list[str]] = field(default_factory=list)
    images: int = 0


@dataclass
class TableRecord:
    table_id: int
    page_title: str
    subsection_title: str
    headers: list[str]
    rows: list[dict[str, str]]
    raw_rows: list[list[str]]


def normalize_text(value: str | None) -> str:
    return " ".join((value or "").replace("\xa0", " ").split())


def redact(value: str) -> str:
    redacted = value
    for pattern, replacement in SECRET_PATTERNS:
        redacted = pattern.sub(replacement, redacted)
    return redacted


def markdown_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("|", "\\|").replace("\n", "<br>")


def iter_blocks(document: Document):
    for child in document.element.body.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, document)
        elif isinstance(child, CT_Tbl):
            yield Table(child, document)


def extract_blocks(document: Document) -> list[Block]:
    blocks: list[Block] = []
    table_id = 0
    for item in iter_blocks(document):
        if isinstance(item, Paragraph):
            text = redact(normalize_text(item.text))
            if text:
                blocks.append(Block(kind="paragraph", text=text, style=item.style.name if item.style else ""))
            else:
                images = len(item._element.xpath(".//w:drawing")) or len(item._element.xpath(".//pic:pic"))
                if images:
                    blocks.append(Block(kind="image", images=images, style=item.style.name if item.style else ""))
        else:
            table_id += 1
            rows: list[list[str]] = []
            for row in item.rows:
                rows.append([redact(normalize_text(cell.text)) for cell in row.cells])
            blocks.append(Block(kind="table", table_id=table_id, rows=rows))
    return blocks


def heading_level(style: str) -> int | None:
    match = re.match(r"Heading\s+(\d+)", style or "")
    return int(match.group(1)) if match else None


def table_to_markdown(table_id: int, rows: list[list[str]]) -> list[str]:
    if not rows:
        return [f"<!-- table-{table_id}: empty -->"]

    col_count = max(len(row) for row in rows)
    padded = [row + [""] * (col_count - len(row)) for row in rows]
    header = padded[0]
    body = padded[1:]
    longest_cell = max((len(cell) for row in padded for cell in row), default=0)
    dense = col_count > 6 or longest_cell > 600

    lines = [f"<!-- table-{table_id} -->"]
    if dense:
        lines.append(f"**表格 {table_id}**")
        if header and any(header):
            lines.append("")
            lines.append("字段：" + " / ".join(header))
        for idx, row in enumerate(body if body else padded, 1):
            pairs = []
            keys = header if body else [f"列{i + 1}" for i in range(col_count)]
            for key, value in zip(keys, row):
                if value:
                    pairs.append(f"{key or '列'}: {value}")
            if pairs:
                lines.append("")
                lines.append(f"- 记录 {idx}")
                for pair in pairs:
                    if len(pair) > 900 or SQL_START_RE.search(pair.split(": ", 1)[-1]):
                        key, value = pair.split(": ", 1)
                        lines.append(f"  - {key}:")
                        lines.append("")
                        lines.append("```sql")
                        lines.extend(split_long_sql(value))
                        lines.append("```")
                    else:
                        lines.append(f"  - {pair}")
        return lines

    lines.append("| " + " | ".join(markdown_escape(cell) for cell in header) + " |")
    lines.append("| " + " | ".join("---" for _ in header) + " |")
    for row in body:
        lines.append("| " + " | ".join(markdown_escape(cell) for cell in row) + " |")
    return lines


def split_long_sql(value: str) -> list[str]:
    if "\n" in value:
        return value.splitlines()
    chunks = re.split(r"\s+(?=(select|from|where|group by|order by|union all|union|left join|inner join|join|case|when|and\b|or\b))", value, flags=re.IGNORECASE)
    if len(chunks) > 1:
        rebuilt: list[str] = []
        i = 0
        while i < len(chunks):
            if i + 1 < len(chunks) and re.match(r"^(select|from|where|group by|order by|union all|union|left join|inner join|join|case|when|and|or)$", chunks[i], re.I):
                rebuilt.append((chunks[i] + " " + chunks[i + 1]).strip())
                i += 2
            else:
                if chunks[i].strip():
                    rebuilt.append(chunks[i].strip())
                i += 1
        return rebuilt
    return [value]


def write_markdown(blocks: list[Block], source_path: Path, out_path: Path) -> None:
    lines = [
        "# CEO一眼报数据溯源及验证报告 V1.3",
        "",
        f"- 来源文件：`{source_path}`",
        "- 转换说明：本文件由 DOCX 自动抽取生成，已对 URL 参数中的口令/token 类字段做脱敏。",
        "",
    ]
    in_code = False
    code_buffer: list[str] = []

    def flush_code() -> None:
        nonlocal in_code, code_buffer
        if in_code and code_buffer:
            lines.append("")
            lines.append("```sql")
            lines.extend(code_buffer)
            lines.append("```")
            code_buffer = []
            in_code = False

    for block in blocks:
        if block.kind == "paragraph":
            level = heading_level(block.style)
            if level:
                flush_code()
                lines.append("")
                lines.append("#" * min(level + 1, 6) + " " + block.text)
                lines.append("")
            elif SQL_START_RE.search(block.text):
                in_code = True
                code_buffer.append(block.text)
            else:
                flush_code()
                lines.append(block.text)
                lines.append("")
        elif block.kind == "table":
            flush_code()
            lines.extend(table_to_markdown(block.table_id or 0, block.rows))
            lines.append("")
        elif block.kind == "image":
            flush_code()
            lines.append(f"[图片占位：{block.images} 张，原 DOCX 内嵌图片未 OCR]")
            lines.append("")
    flush_code()
    out_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def make_unique_headers(headers: list[str], width: int) -> list[str]:
    result: list[str] = []
    seen: dict[str, int] = {}
    for idx in range(width):
        raw = headers[idx] if idx < len(headers) and headers[idx] else f"列{idx + 1}"
        count = seen.get(raw, 0) + 1
        seen[raw] = count
        result.append(raw if count == 1 else f"{raw}_{count}")
    return result


def records_from_table(rows: list[list[str]]) -> tuple[list[str], list[dict[str, str]]]:
    if not rows:
        return [], []
    width = max(len(row) for row in rows)
    padded = [row + [""] * (width - len(row)) for row in rows]
    headers = make_unique_headers(padded[0], width)
    records = []
    for row in padded[1:]:
        if any(cell for cell in row):
            records.append({header: value for header, value in zip(headers, row)})
    return headers, records


def add_context(record: dict[str, str], page: str, subsection: str, table_id: int) -> dict[str, str]:
    return {
        "page_title": page,
        "subsection_title": subsection,
        "source_table_id": str(table_id),
        **record,
    }


def infer_layer(table_name: str) -> str:
    lower = table_name.lower().strip("` ")
    for prefix in ("odm_", "idm_", "sdm_", "app_", "dim_", "stg_", "rpt_", "dw_"):
        if lower.startswith(prefix):
            return prefix.rstrip("_").upper()
    if "." in lower:
        suffix = lower.rsplit(".", 1)[-1]
        return infer_layer(suffix)
    return ""


def split_table_names(value: str) -> list[str]:
    sql_keywords = {
        "and",
        "as",
        "by",
        "case",
        "day",
        "else",
        "end",
        "from",
        "if",
        "in",
        "interval",
        "is",
        "join",
        "left",
        "not",
        "null",
        "on",
        "or",
        "order",
        "select",
        "then",
        "union",
        "when",
        "where",
    }
    sql_functions = {
        "cast",
        "concat",
        "date_format",
        "date_sub",
        "datediff",
        "from_unixtime",
        "ifnull",
        "length",
        "replace",
        "round",
        "str_to_date",
        "substr",
        "substring",
        "substring_index",
        "sum",
    }
    table_prefixes = (
        "ad_",
        "app_",
        "dim_",
        "dwd_",
        "dw_",
        "idm_",
        "ods_",
        "odm_",
        "rpt_",
        "sdm_",
        "stg_",
    )
    found = re.findall(r"`?([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?)`?", value)
    names: list[str] = []
    for name in found:
        lowered = name.lower()
        if lowered in sql_keywords or lowered in sql_functions or lowered.startswith(("f_", "v_")):
            continue
        if "." in name:
            left, right = name.split(".", 1)
            if len(left) <= 2 and left not in {"ad", "dm", "dw"}:
                continue
            if "_" not in right:
                continue
        if "." not in name:
            if not lowered.startswith(table_prefixes) and lowered not in {"baidu_search_index"}:
                continue
        if name not in names:
            names.append(name)
    return names


def is_natural_note(text: str) -> bool:
    if not text or SQL_START_RE.search(text):
        return False
    if text.startswith(("`", "--", "+", ",")):
        return False
    if re.match(r"^[A-Za-z0-9_.*()/%<>= '\"-]+$", text) and len(text) < 80:
        return False
    return True


CEO_PAGE_TITLES = {
    "1.首页",
    "2.净现金流",
    "3.营业收入",
    "4.营业收入-广告",
    "5.营业收入-会员",
    "6.营业收入-国际化广告",
    "7.营业收入-国际化会员",
    "8.净利润",
    "9.M-ROE",
    "10.负反馈率",
    "11.CLV",
    "12.CLV-国内",
    "13.CLV-国际",
    "14.DAU",
    "15.业务总览-国际化",
    "16.业务总览-会员",
    "17.业务总览-TOB",
    "18.业务总览-广告",
}


def is_ceo_page(title: str) -> bool:
    return title in CEO_PAGE_TITLES


def is_validation_note(text: str) -> bool:
    if not text:
        return False
    if SQL_START_RE.search(text):
        return False
    if text.startswith(("`", "--", "+", ",", ")", "*")):
        return False
    if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", text) and "_" in text:
        return False
    if re.search(r"\b(select|from|where|union\s+all|group\s+by|order\s+by|limit|join)\b", text, re.I):
        return False
    if re.search(r"\bas\b", text, re.I) and (re.search(r"[_()]", text) or text.startswith("'")):
        return False
    return True


def is_freshness_note(text: str) -> bool:
    return any(word in text for word in ("数据更新", "更新时间", "更新时点", "可查看", "T+", "每日", "每天"))


def is_page_risk_note(text: str) -> bool:
    strong_terms = ("无法回溯", "不一致", "差异", "异常", "未修复", "暂不能", "特殊场景", "无页面数据验证")
    return any(term in text for term in strong_terms) or "历史数据动态变化" in text


def is_risk_candidate(text: str) -> bool:
    candidate_terms = (
        "无法",
        "不一致",
        "暂不能",
        "特殊说明",
        "差异",
        "暂未",
        "动态",
        "历史",
        "特殊场景",
        "无法回溯",
        "未修复",
        "无页面数据验证",
    )
    return any(term in text for term in candidate_terms)


def referenced_page_title(reference: str, pages: list[dict[str, Any]]) -> str:
    for page in pages:
        title = page["title"]
        if title.split(".", 1)[-1] == reference:
            return title
    return reference


def extract_ddl_fields(blocks: list[Block]) -> list[dict[str, str]]:
    fields: list[dict[str, str]] = []
    page = ""
    subsection = ""
    current_table = ""
    in_ddl = False

    for block in blocks:
        if block.kind != "paragraph":
            continue
        level = heading_level(block.style)
        if level == 2:
            page = block.text
        elif level == 3:
            subsection = block.text

        text = block.text
        table_match = DDL_TABLE_RE.search(text)
        if table_match:
            current_table = table_match.group(1)
            in_ddl = True
            continue
        if in_ddl:
            col_match = DDL_COLUMN_RE.match(text)
            if col_match and current_table:
                fields.append(
                    {
                        "page_title": page,
                        "subsection_title": subsection,
                        "table_name": current_table,
                        "layer": infer_layer(current_table),
                        "field_name": col_match.group("name"),
                        "field_type": col_match.group("type"),
                        "comment": col_match.group("comment") or "",
                    }
                )
            if text.startswith(")") or "ENGINE=" in text:
                in_ddl = False
                current_table = ""
    return fields


def extract_structured(blocks: list[Block], source_path: Path) -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    tables: list[TableRecord] = []
    indicators: list[dict[str, str]] = []
    source_sql: list[dict[str, str]] = []
    warehouse_tables: list[dict[str, str]] = []
    rules: list[dict[str, str]] = []
    validation_notes: list[dict[str, str]] = []
    risk_notes: list[dict[str, str]] = []
    risk_candidates: list[dict[str, str]] = []
    freshness_notes: list[dict[str, str]] = []
    document_notes: list[dict[str, str]] = []
    page_inheritance: list[dict[str, str]] = []

    current_page: dict[str, Any] | None = None
    current_subsection = ""
    current_subsection_obj: dict[str, Any] | None = None

    def current_page_title() -> str:
        return current_page["title"] if current_page is not None else ""

    def add_text_to_context(text: str) -> None:
        if current_page is None:
            return
        current_page["text"].append(text)
        if current_subsection_obj is not None:
            current_subsection_obj["text"].append(text)

    for block in blocks:
        if block.kind == "paragraph":
            level = heading_level(block.style)
            if level == 1:
                current_page = None
                current_subsection = ""
                current_subsection_obj = None
            elif level == 2:
                current_page = {"title": block.text, "subsections": [], "text": [], "table_ids": [], "images": 0}
                pages.append(current_page)
                current_subsection = ""
                current_subsection_obj = None
            elif level == 3:
                current_subsection = block.text
                if current_page is not None:
                    current_subsection_obj = {"title": current_subsection, "text": [], "table_ids": [], "images": 0}
                    current_page["subsections"].append(current_subsection_obj)
            elif current_page is not None:
                text = block.text
                add_text_to_context(text)
                page_title = current_page_title()

                if not is_ceo_page(page_title):
                    document_notes.append({"section_title": page_title, "subsection_title": current_subsection, "text": text})
                    continue

                if "指标口径" in current_subsection or "计算规则" in current_subsection:
                    rules.append({"page_title": page_title, "subsection_title": current_subsection, "text": text})

                if "数据验证结论" in current_subsection and is_validation_note(text):
                    validation_notes.append({"page_title": page_title, "subsection_title": current_subsection, "text": text, "source_type": "text"})

                if is_freshness_note(text):
                    freshness_notes.append({"page_title": page_title, "subsection_title": current_subsection, "text": text})

                if is_page_risk_note(text):
                    risk_notes.append({"page_title": page_title, "subsection_title": current_subsection, "text": text})

                if is_risk_candidate(text):
                    risk_candidates.append({"page_title": page_title, "subsection_title": current_subsection, "text": text})

                for reference in re.findall(r"同【([^】]+)】一致", text):
                    page_inheritance.append(
                        {
                            "page_title": page_title,
                            "subsection_title": current_subsection,
                            "referenced_label": reference,
                            "referenced_page_title": referenced_page_title(reference, pages),
                            "text": text,
                        }
                    )
            continue

        if block.kind == "image":
            if current_page is not None:
                current_page["images"] += block.images
                if current_subsection_obj is not None:
                    current_subsection_obj["images"] += block.images
            continue

        if block.kind != "table":
            continue

        if current_page is None:
            page_title = ""
        else:
            page_title = current_page["title"]
            current_page["table_ids"].append(block.table_id)
            if current_subsection_obj is not None:
                current_subsection_obj["table_ids"].append(block.table_id)

        headers, rows = records_from_table(block.rows)
        table_record = TableRecord(
            table_id=block.table_id or 0,
            page_title=page_title,
            subsection_title=current_subsection,
            headers=headers,
            rows=rows,
            raw_rows=block.rows,
        )
        tables.append(table_record)
        header_text = " ".join(headers)

        if "指标清单" in current_subsection or "指标名称" in header_text:
            for row in rows:
                indicators.append(add_context(row, page_title, current_subsection, block.table_id or 0))
        if "溯源SQL" in header_text or ("系统表名" in header_text and "数据溯源" in current_subsection):
            for row in rows:
                source_sql.append(add_context(row, page_title, current_subsection, block.table_id or 0))
        if any(h in header_text for h in ("表名", "数仓库表", "系统表名")) and any(
            key in current_subsection for key in ("FineDataLink", "数据溯源")
        ):
            for row in rows:
                enriched = add_context(row, page_title, current_subsection, block.table_id or 0)
                table_name_value = ""
                for key in ("表名", "数仓库表", "系统表名"):
                    if row.get(key):
                        table_name_value = row[key]
                        break
                for name in split_table_names(table_name_value):
                    if re.search(r"[A-Za-z_]", name):
                        warehouse_tables.append({**enriched, "normalized_table_name": name, "layer": infer_layer(name)})

    validation_keys = {(row["page_title"], row["subsection_title"]) for row in validation_notes}
    for page in pages:
        if not is_ceo_page(page["title"]):
            continue
        for subsection in page["subsections"]:
            if "数据验证结论" in subsection["title"] and subsection["images"] and (page["title"], subsection["title"]) not in validation_keys:
                validation_notes.append(
                    {
                        "page_title": page["title"],
                        "subsection_title": subsection["title"],
                        "text": f"[图像型验证结论占位：原 DOCX 此节包含 {subsection['images']} 张图片，未 OCR]",
                        "source_type": "image-placeholder",
                        "image_count": str(subsection["images"]),
                    }
                )

    section_inventory = build_section_inventory(pages, tables)

    ddl_fields = extract_ddl_fields(blocks)
    table_catalog = build_table_catalog(indicators, source_sql, warehouse_tables, ddl_fields)
    with source_path.open("rb") as fh:
        sha256 = hashlib.sha256(fh.read()).hexdigest()

    return {
        "metadata": {
            "source_file": str(source_path),
            "source_sha256": sha256,
            "paragraph_blocks": sum(1 for block in blocks if block.kind == "paragraph"),
            "table_blocks": sum(1 for block in blocks if block.kind == "table"),
            "redaction": "URL/query credential parameters are replaced with <REDACTED>.",
        },
        "pages": pages,
        "section_inventory_records": section_inventory,
        "tables": [
            {
                "table_id": table.table_id,
                "page_title": table.page_title,
                "subsection_title": table.subsection_title,
                "headers": table.headers,
                "rows": table.rows,
            }
            for table in tables
        ],
        "indicator_records": indicators,
        "metric_rules": rules,
        "source_sql_records": source_sql,
        "warehouse_table_records": warehouse_tables,
        "table_catalog_records": table_catalog,
        "ddl_field_records": ddl_fields,
        "validation_notes": validation_notes,
        "risk_notes": risk_notes,
        "risk_candidates": risk_candidates,
        "freshness_notes": freshness_notes,
        "document_notes": document_notes,
        "page_inheritance_records": page_inheritance,
    }


def build_section_inventory(pages: list[dict[str, Any]], tables: list[TableRecord]) -> list[dict[str, str]]:
    table_lookup = {table.table_id: table for table in tables}
    records: list[dict[str, str]] = []

    def flags(table_ids: list[int | None]) -> tuple[bool, bool]:
        has_indicator = False
        has_source_sql = False
        for table_id in table_ids:
            if table_id is None:
                continue
            table = table_lookup.get(table_id)
            if not table:
                continue
            header_text = " ".join(table.headers)
            has_indicator = has_indicator or "指标名称" in header_text
            has_source_sql = has_source_sql or "溯源SQL" in header_text
        return has_indicator, has_source_sql

    for page in pages:
        if not is_ceo_page(page["title"]):
            continue
        if not page["subsections"]:
            has_indicator, has_source_sql = flags(page["table_ids"])
            records.append(
                {
                    "page_title": page["title"],
                    "subsection_title": "",
                    "text_count": str(len(page["text"])),
                    "table_count": str(len(page["table_ids"])),
                    "image_count": str(page["images"]),
                    "table_ids": ";".join(str(table_id) for table_id in page["table_ids"] if table_id),
                    "has_indicator_table": str(has_indicator).lower(),
                    "has_source_sql_table": str(has_source_sql).lower(),
                    "has_validation_section": "false",
                }
            )
            continue

        for subsection in page["subsections"]:
            has_indicator, has_source_sql = flags(subsection["table_ids"])
            records.append(
                {
                    "page_title": page["title"],
                    "subsection_title": subsection["title"],
                    "text_count": str(len(subsection["text"])),
                    "table_count": str(len(subsection["table_ids"])),
                    "image_count": str(subsection["images"]),
                    "table_ids": ";".join(str(table_id) for table_id in subsection["table_ids"] if table_id),
                    "has_indicator_table": str(has_indicator).lower(),
                    "has_source_sql_table": str(has_source_sql).lower(),
                    "has_validation_section": str("数据验证结论" in subsection["title"]).lower(),
                }
            )
    return records


def build_table_catalog(
    indicators: list[dict[str, str]],
    source_sql: list[dict[str, str]],
    warehouse_tables: list[dict[str, str]],
    ddl_fields: list[dict[str, str]],
) -> list[dict[str, str]]:
    catalog: dict[str, dict[str, Any]] = {}

    def add(name: str, source: str, page: str = "", subsection: str = "") -> None:
        for table_name in split_table_names(name):
            if not re.search(r"[A-Za-z_]", table_name):
                continue
            key = table_name.lower()
            item = catalog.setdefault(
                key,
                {
                    "normalized_table_name": table_name,
                    "layer": infer_layer(table_name),
                    "sources": set(),
                    "pages": set(),
                    "subsections": set(),
                    "occurrences": 0,
                },
            )
            item["sources"].add(source)
            if page:
                item["pages"].add(page)
            if subsection:
                item["subsections"].add(subsection)
            item["occurrences"] += 1

    for row in indicators:
        add(row.get("系统表名", ""), "indicator_records", row.get("page_title", ""), row.get("subsection_title", ""))
    for row in source_sql:
        add(row.get("系统表名", ""), "source_sql_records", row.get("page_title", ""), row.get("subsection_title", ""))
    for row in warehouse_tables:
        add(row.get("normalized_table_name", ""), "warehouse_table_records", row.get("page_title", ""), row.get("subsection_title", ""))
    for row in ddl_fields:
        add(row.get("table_name", ""), "ddl_field_records", row.get("page_title", ""), row.get("subsection_title", ""))

    records: list[dict[str, str]] = []
    for item in catalog.values():
        records.append(
            {
                "normalized_table_name": item["normalized_table_name"],
                "layer": item["layer"],
                "sources": ";".join(sorted(item["sources"])),
                "pages": ";".join(sorted(item["pages"])),
                "subsections": ";".join(sorted(item["subsections"])),
                "occurrences": str(item["occurrences"]),
            }
        )
    records.sort(key=lambda row: (row["layer"], row["normalized_table_name"]))
    return records


def write_csv(path: Path, records: list[dict[str, str]]) -> None:
    keys: list[str] = []
    for record in records:
        for key in record:
            if key not in keys:
                keys.append(key)
    with path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=keys or ["empty"])
        writer.writeheader()
        for record in records:
            writer.writerow(record)


def write_xlsx(path: Path, structured: dict[str, Any]) -> None:
    import pandas as pd

    sheets = {
        "section_inventory": structured["section_inventory_records"],
        "page_inheritance": structured["page_inheritance_records"],
        "indicators": structured["indicator_records"],
        "metric_rules": structured["metric_rules"],
        "source_sql": structured["source_sql_records"],
        "warehouse_tables": structured["warehouse_table_records"],
        "table_catalog": structured["table_catalog_records"],
        "ddl_fields": structured["ddl_field_records"],
        "validation_notes": structured["validation_notes"],
        "risk_notes": structured["risk_notes"],
        "risk_candidates": structured["risk_candidates"],
        "freshness_notes": structured["freshness_notes"],
        "document_notes": structured["document_notes"],
    }
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        for sheet_name, records in sheets.items():
            frame = pd.DataFrame(records)
            frame.to_excel(writer, sheet_name=sheet_name[:31], index=False)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("docx", type=Path, help="Path to the source DOCX file")
    parser.add_argument("--out-dir", type=Path, required=True, help="Directory for generated outputs")
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    document = Document(args.docx)
    blocks = extract_blocks(document)
    structured = extract_structured(blocks, args.docx)

    markdown_path = args.out_dir / "ceo-report-v13.ai-readable.md"
    json_path = args.out_dir / "ceo-report-v13.structured.json"
    xlsx_path = args.out_dir / "ceo-report-v13.structured.xlsx"
    manifest_path = args.out_dir / "manifest.json"

    write_markdown(blocks, args.docx, markdown_path)
    json_path.write_text(json.dumps(structured, ensure_ascii=False, indent=2), encoding="utf-8")
    write_csv(args.out_dir / "ceo-report-v13.section-inventory.csv", structured["section_inventory_records"])
    write_csv(args.out_dir / "ceo-report-v13.page-inheritance.csv", structured["page_inheritance_records"])
    write_csv(args.out_dir / "ceo-report-v13.indicators.csv", structured["indicator_records"])
    write_csv(args.out_dir / "ceo-report-v13.metric-rules.csv", structured["metric_rules"])
    write_csv(args.out_dir / "ceo-report-v13.source-sql.csv", structured["source_sql_records"])
    write_csv(args.out_dir / "ceo-report-v13.warehouse-tables.csv", structured["warehouse_table_records"])
    write_csv(args.out_dir / "ceo-report-v13.table-catalog.csv", structured["table_catalog_records"])
    write_csv(args.out_dir / "ceo-report-v13.ddl-fields.csv", structured["ddl_field_records"])
    write_csv(args.out_dir / "ceo-report-v13.validation-notes.csv", structured["validation_notes"])
    write_csv(args.out_dir / "ceo-report-v13.risk-notes.csv", structured["risk_notes"])
    write_csv(args.out_dir / "ceo-report-v13.risk-candidates.csv", structured["risk_candidates"])
    write_csv(args.out_dir / "ceo-report-v13.freshness-notes.csv", structured["freshness_notes"])
    write_csv(args.out_dir / "ceo-report-v13.document-notes.csv", structured["document_notes"])
    write_xlsx(xlsx_path, structured)

    manifest = {
        "source_file": str(args.docx),
        "outputs": {
            "markdown": str(markdown_path),
            "structured_json": str(json_path),
            "structured_xlsx": str(xlsx_path),
            "csv_files": sorted(str(path) for path in args.out_dir.glob("*.csv")),
        },
        "counts": {
            "pages": len(structured["pages"]),
            "section_inventory_records": len(structured["section_inventory_records"]),
            "page_inheritance_records": len(structured["page_inheritance_records"]),
            "tables": len(structured["tables"]),
            "indicator_records": len(structured["indicator_records"]),
            "metric_rules": len(structured["metric_rules"]),
            "source_sql_records": len(structured["source_sql_records"]),
            "warehouse_table_records": len(structured["warehouse_table_records"]),
            "table_catalog_records": len(structured["table_catalog_records"]),
            "ddl_field_records": len(structured["ddl_field_records"]),
            "validation_notes": len(structured["validation_notes"]),
            "risk_notes": len(structured["risk_notes"]),
            "risk_candidates": len(structured["risk_candidates"]),
            "freshness_notes": len(structured["freshness_notes"]),
            "document_notes": len(structured["document_notes"]),
        },
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
