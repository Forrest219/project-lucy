#!/usr/bin/env python3
"""Lint Lucy semantic YAML packages before upload.

Hard-fails on KTX contract violations that historically escaped author skills
(e.g. joins[].relationship: many_to_many).

Usage:
  python3 lint-semantic-yaml.py <output_dir_or_yaml_file> [...]
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML required (pip install pyyaml)", file=sys.stderr)
    sys.exit(2)

ALLOWED_RELATIONSHIPS = frozenset({"many_to_one", "one_to_many", "one_to_one"})
ALLOWED_COLUMN_TYPES = frozenset({"string", "number", "time", "boolean"})
BANNED_RELATIONSHIP_HINTS = frozenset(
    {
        "many_to_many",
        "belongs_to",
        "has_many",
        "has_one",
        "多对多",
        "多对一",
        "一对多",
        "一对一",
    }
)


def iter_yaml_files(root: Path) -> list[Path]:
    if root.is_file():
        return [root] if root.suffix in {".yaml", ".yml"} else []
    files: list[Path] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix not in {".yaml", ".yml"}:
            continue
        # Skip eval packs nested under the same upload folder.
        if "/evals/" in path.as_posix() or path.as_posix().endswith("-eval-cases.yaml"):
            continue
        files.append(path)
    return files


def check_join(join: object, loc: str, errors: list[str]) -> None:
    if not isinstance(join, dict):
        errors.append(f"{loc}: join entry must be a mapping")
        return
    rel = join.get("relationship")
    if rel is None:
        errors.append(f"{loc}.relationship: required; expected one of {sorted(ALLOWED_RELATIONSHIPS)}")
        return
    if not isinstance(rel, str):
        errors.append(f"{loc}.relationship: must be a string, got {type(rel).__name__}")
        return
    if rel not in ALLOWED_RELATIONSHIPS:
        hint = " (banned token)" if rel in BANNED_RELATIONSHIP_HINTS else ""
        errors.append(
            f"{loc}.relationship: Invalid option {rel!r}{hint}; "
            f"expected one of {sorted(ALLOWED_RELATIONSHIPS)}. "
            "Fact↔fact period alignment must NOT use joins — put keys in descriptions/Wiki."
        )
    if not join.get("to"):
        errors.append(f"{loc}.to: required non-empty source name")
    if not join.get("on"):
        errors.append(f"{loc}.on: required non-empty join condition")


def check_column(col: object, loc: str, errors: list[str]) -> None:
    if not isinstance(col, dict):
        errors.append(f"{loc}: column must be a mapping")
        return
    col_type = col.get("type")
    if col_type is not None and col_type not in ALLOWED_COLUMN_TYPES:
        errors.append(
            f"{loc}.type: Invalid option {col_type!r}; expected one of {sorted(ALLOWED_COLUMN_TYPES)}"
        )


def lint_manifest_or_overlay(doc: object, path: Path, errors: list[str]) -> None:
    if not isinstance(doc, dict):
        errors.append(f"{path}: top-level must be a mapping")
        return

    # Schema Manifest shape: tables: { name: { joins, columns, ... } }
    tables = doc.get("tables")
    if isinstance(tables, dict):
        for source_name, entry in tables.items():
            if not isinstance(entry, dict):
                errors.append(f"{path}: tables.{source_name} must be a mapping")
                continue
            joins = entry.get("joins") or []
            if not isinstance(joins, list):
                errors.append(f"{path}: tables.{source_name}.joins must be a list")
                continue
            for i, join in enumerate(joins):
                check_join(join, f"{path}: tables.{source_name}.joins[{i}]", errors)
            columns = entry.get("columns") or []
            if isinstance(columns, list):
                for i, col in enumerate(columns):
                    check_column(col, f"{path}: tables.{source_name}.columns[{i}]", errors)
        return

    # Source file at top level (WebUI upload = standalone with table:).
    under_schema = "/_schema/" in path.as_posix()
    has_table = bool(doc.get("table") or doc.get("sql"))
    looks_like_source = bool(doc.get("name")) and (
        "measures" in doc or "segments" in doc or "grain" in doc or "columns" in doc
    )

    if looks_like_source and not under_schema:
        if not has_table:
            errors.append(
                f"{path}: WebUI upload source must declare table: <schema>.<table> "
                "(otherwise OVERLAY_MISSING_TABLE). "
                "With table:, include ALL physical columns — KTX will not merge Manifest."
            )
        else:
            columns = doc.get("columns") or []
            if not isinstance(columns, list) or len(columns) == 0:
                errors.append(f"{path}: standalone source with table: must declare columns")
            else:
                physical = [
                    c
                    for c in columns
                    if isinstance(c, dict) and c.get("name") and not c.get("expr")
                ]
                computed = [
                    c
                    for c in columns
                    if isinstance(c, dict) and c.get("name") and c.get("expr")
                ]
                if len(physical) == 0 and len(computed) > 0:
                    errors.append(
                        f"{path}: has table: but only computed columns (with expr). "
                        "Standalone sources must include physical columns for grain/measures, "
                        "or omit table: and use true Manifest overlay (not uploadable via WebUI)."
                    )
                grain = doc.get("grain") or []
                if isinstance(grain, list):
                    col_names = {
                        str(c.get("name")).lower()
                        for c in columns
                        if isinstance(c, dict) and c.get("name")
                    }
                    for g in grain:
                        if str(g).lower() not in col_names:
                            errors.append(
                                f"{path}: grain {g!r} not present in columns "
                                "(standalone sources do not inherit Manifest columns)"
                            )

    joins = doc.get("joins") or []
    if isinstance(joins, list):
        for i, join in enumerate(joins):
            check_join(join, f"{path}: joins[{i}]", errors)
    elif "joins" in doc:
        errors.append(f"{path}: joins must be a list")

    columns = doc.get("columns") or []
    if isinstance(columns, list):
        for i, col in enumerate(columns):
            check_column(col, f"{path}: columns[{i}]", errors)


def lint_file(path: Path) -> list[str]:
    errors: list[str] = []
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as err:
        return [f"{path}: cannot read: {err}"]
    try:
        docs = list(yaml.safe_load_all(text))
    except yaml.YAMLError as err:
        return [f"{path}: YAML parse failed: {err}"]
    for doc in docs:
        if doc is None:
            continue
        lint_manifest_or_overlay(doc, path, errors)
    return errors


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    all_errors: list[str] = []
    files: list[Path] = []
    for arg in argv[1:]:
        files.extend(iter_yaml_files(Path(arg).expanduser().resolve()))
    if not files:
        print("ERROR: no .yaml/.yml files found", file=sys.stderr)
        return 2
    for path in files:
        all_errors.extend(lint_file(path))
    if all_errors:
        print(f"lint-semantic-yaml: FAIL ({len(all_errors)} issue(s))")
        for err in all_errors:
            print(f"  - {err}")
        return 1
    print(f"lint-semantic-yaml: OK ({len(files)} file(s))")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
