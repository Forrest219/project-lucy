#!/usr/bin/env python3
"""Isolated Docker/API/MCP UAT for P1-64 source shortname conflict.

Modes:
  repro  — prove pre-fix defect (UAT-SNC-02 FAIL shape)
  verify — post-fix R0/01–09 (must all PASS for suite green)

Does not use demo compose volumes or demo admin passwords.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime
import hashlib
import http.cookiejar
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[2]
SOURCE_FILES = [
    "webui/server/schema-structure.ts",
    "webui/server/catalog-assets.ts",
    "webui/server/proxy/acl.ts",
    "webui/server/index.ts",
    "webui/server/source-name-registry.ts",
]
TOOLS = [
    "lucy_catalog",
    "lucy_query",
    "lucy_read_source",
    "lucy_explain_query",
    "lucy_begin_question",
    "lucy_continue_question",
    "connection_list",
]


def classify_race_responses(responses):
    """A busy response is a retry obligation, never proof of uniqueness."""
    winners = [i for i, result in enumerate(responses)
               if result["httpStatus"] == 200
               and result["body"].get("ok") is True
               and result["body"].get("data", {}).get("uploaded") is True]
    if len(responses) != 2 or len(winners) != 1:
        raise RuntimeError("race requires exactly one confirmed upload")
    loser = 1 - winners[0]
    result = responses[loser]
    code = result["body"].get("error", {}).get("code")
    if result["httpStatus"] == 400 and code == "DUPLICATE_SOURCE_NAME":
        return loser, False
    if result["httpStatus"] in (409, 500) and code == "PUBLISH_COORDINATOR_BUSY":
        return loser, True
    raise RuntimeError(f"unexpected race failure: HTTP {result['httpStatus']} / {code}")


def expected_inactive_begin(results, tool):
    """Current P1-60 contract: hidden begin rejects legacy calls without blocking query."""
    if tool != "begin":
        return False
    listed = results.get("tools-list", {}).get("body", {}).get("result", {}).get("tools", [])
    result = results.get("begin", {})
    reply = result.get("body", {}).get("result", {})
    return (result.get("httpStatus") == 200
            and not result.get("body", {}).get("error")
            and not any(item.get("name") == "lucy_begin_question" for item in listed)
            and reply.get("isError") is True
            and reply.get("data", {}).get("reason") == "begin_not_available")


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=("repro", "verify"), default="repro")
    p.add_argument("--source-root", type=pathlib.Path, default=REPO, help="independent frozen build-input checkout for exact source comparison")
    p.add_argument("--browser", action="store_true", help="run real foreground WebUI timing checks")
    p.add_argument("--browser-only", action="store_true", help="debug selector 12 only; never a full suite PASS")
    return p.parse_args()


def main():
    args = parse_args()
    out = (
        REPO
        / "inbox/source-shortname-conflict/evidence"
        / datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S")
    )
    out.mkdir(parents=True, exist_ok=True)
    tag = "lucy-snc-" + secrets.token_hex(3)
    network, db, app = tag, tag + "-db", tag + "-app"
    private = pathlib.Path(tempfile.mkdtemp(prefix=tag + "-"))
    os.chmod(private, 0o700)
    project = private / "project"
    project.mkdir()
    token, boot, password, dbpass, rootpass = [secrets.token_urlsafe(32) for _ in range(5)]
    secrets_list = (token, boot, password, dbpass, rootpass)
    image = os.environ.get("SNC_IMAGE", "project-lucy:demo")
    jar = http.cookiejar.CookieJar()
    http_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    summary: dict = {
        "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "mode": args.mode,
        "containers": [app, db],
        "network": network,
        "imageTag": image,
        "cases": {},
        "steps": [],
    }
    web = mcp_base = ""
    rpc_id = 0
    lock = threading.Lock()

    def redact(value: str) -> str:
        for s in secrets_list:
            value = value.replace(s, "[REDACTED]")
        return value

    def save(name: str, data):
        text = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False, indent=2)
        (out / name).write_text(redact(text) + "\n")

    def step(name: str, data: dict):
        with lock:
            summary["steps"].append({"step": name, **data})
            save("summary.json", summary)
        print(json.dumps({"step": name, **{k: v for k, v in data.items() if k != "yaml"}}, ensure_ascii=False), flush=True)

    def case(cid: str, status: str, detail: dict | None = None):
        summary["cases"][cid] = {"status": status, **(detail or {})}
        save("summary.json", summary)
        step("case-" + cid, {"status": status, **(detail or {})})
        if status == "FAIL":
            raise RuntimeError(cid + " FAIL: " + json.dumps(detail or {}, ensure_ascii=False)[:1200])

    def run(cmd, stdin=None, check=True):
        r = subprocess.run(cmd, input=stdin, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if check and r.returncode:
            raise RuntimeError("Command failed: " + " ".join(cmd[:3]) + ": " + redact(r.stderr[-2000:]))
        return r.stdout.strip()

    def request(base, route, method="GET", body=None, headers=None, timeout=180):
        h = {"Content-Type": "application/json", "Origin": base, **(headers or {})}
        req = urllib.request.Request(
            base + route,
            data=None if body is None else json.dumps(body).encode(),
            headers=h,
            method=method,
        )
        started = time.monotonic()
        try:
            res = http_opener.open(req, timeout=timeout)
        except urllib.error.HTTPError as err:
            res = err
        text = res.read().decode()
        try:
            value = json.loads(text)
        except ValueError:
            lines = [line[6:] for line in text.splitlines() if line.startswith("data: ")]
            value = json.loads(lines[-1]) if lines else {"raw": text[:4000]}
        return {"httpStatus": res.status, "elapsedMs": round((time.monotonic() - started) * 1000), "body": value}

    def api(name, route, body=None, method="POST", must=True):
        result = request(web, route, method, body)
        save(name + ".json", result)
        if must and (result["httpStatus"] >= 400 or result["body"].get("ok") is False):
            raise RuntimeError(name + " failed: " + json.dumps(result, ensure_ascii=False)[:1800])
        return result

    def mcp(name, tool=None, args=None, method="tools/call"):
        nonlocal rpc_id
        with lock:
            rpc_id += 1
            rid = rpc_id
        body = {"jsonrpc": "2.0", "id": rid, "method": method}
        if method == "tools/call":
            body["params"] = {"name": tool, "arguments": args or {}}
        elif method == "initialize":
            body["params"] = {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "shortname-uat", "version": "1"},
            }
        result = request(
            mcp_base,
            "/mcp",
            "POST",
            body,
            {"Authorization": "Bearer " + token, "Accept": "application/json, text/event-stream"},
        )
        save(name + ".json", result)
        return result

    def inner(result):
        body = result["body"]
        value = body.get("result", body)
        for c in value.get("content", []):
            if c.get("type") == "text":
                try:
                    return json.loads(c["text"])
                except ValueError:
                    return c["text"]
        return value

    def scan(schema, tables=None):
        payload = {"schema": schema}
        if tables is not None:
            payload["tables"] = tables
        res = api("scan-" + schema, "/api/connections/hive-1/schema-structure", payload)
        data = res["body"]["data"]
        yaml = data["yaml"]
        save(schema + "-generated.yaml", yaml)
        step("scan-" + schema, {"httpStatus": res["httpStatus"], "tableCount": data["tableCount"], "yamlHead": yaml[:240]})
        return yaml

    def upload(schema, yaml, prefix, must=True):
        payload = {
            "connectionId": "hive-1",
            "schema": schema,
            "assetKind": "schema_manifest",
            "filename": schema + ".yaml",
            "content": yaml,
            "confirmOverwrite": True,
        }
        validation = api(prefix + "-validate", "/api/catalog/assets/validate", payload, must=False)
        res = api(prefix + "-upload", "/api/catalog/assets/upload", payload, must=False)
        step(
            prefix + "-upload",
            {
                "httpStatus": res["httpStatus"],
                "valid": validation["body"].get("data", {}).get("valid"),
                "errors": validation["body"].get("data", {}).get("errors"),
                "sourceNameConflicts": validation["body"].get("data", {}).get("sourceNameConflicts"),
                "ok": res["body"].get("ok"),
                "uploaded": res["body"].get("data", {}).get("uploaded"),
                "code": res["body"].get("error", {}).get("code") if isinstance(res["body"].get("error"), dict) else None,
            },
        )
        if must and res["httpStatus"] >= 400:
            raise RuntimeError(prefix + " upload failed")
        return validation, res

    def enabled(names, prefix, must=False):
        res = api(
            prefix + "-enabled",
            "/api/connections/hive-1/enabled-tables",
            {"enabledTables": names, "dryRun": False},
            "PUT",
            must=must,
        )
        data = res["body"].get("data") or {}
        step(
            prefix + "-enabled",
            {
                "httpStatus": res["httpStatus"],
                "ok": res["body"].get("ok"),
                "written": data.get("written"),
                "policyRuntimeAck": data.get("policyRuntimeAck"),
                "runtimeAck": data.get("runtimeAck"),
                "policyRuntimeIssues": data.get("policyRuntimeIssues"),
            },
        )
        return res

    def probe(prefix, read_source="city", query_expr="COUNT(city.id)"):
        results = {}
        calls = [
            ("tools-list", None, None, "tools/list"),
            ("catalog", "lucy_catalog", {}, "tools/call"),
            (
                "begin",
                "lucy_begin_question",
                {
                    "question": "查询测试城市表的记录数",
                    "intentSummary": "合成城市表短名 UAT，指定 hive-1 weather.city",
                    "entities": ["hive-1.weather.city"],
                },
                "tools/call",
            ),
            ("read", "lucy_read_source", {"connectionId": "hive-1", "sourceName": read_source}, "tools/call"),
            (
                "query",
                "lucy_query",
                {"connectionId": "hive-1", "measures": [{"expr": query_expr, "name": "row_count"}], "limit": 1},
                "tools/call",
            ),
        ]
        for label, tool, args, method in calls:
            result = mcp(prefix + "-" + label, tool, args, method)
            results[label] = result
            short = {
                "httpStatus": result["httpStatus"],
                "error": result["body"].get("error"),
                "isError": result["body"].get("result", {}).get("isError"),
            }
            if label == "query":
                short["result"] = inner(result)
            step(prefix + "-" + label, short)
        return results

    def assert_probe_ok(results, label):
        for tool, result in results.items():
            if expected_inactive_begin(results, tool):
                step(label + "-begin-contract", {"status": "expected_inactive_rejection", "reason": "begin_not_available", "queryStillRequired": True})
                continue
            if result["httpStatus"] != 200 or result["body"].get("error") or result["body"].get("result", {}).get("isError"):
                raise RuntimeError(label + " " + tool + " failed")
        if results["query"]["body"].get("result", {}).get("isError"):
            raise RuntimeError(label + " query isError")
        rows = inner(results["query"]).get("rows")
        if rows != [[1]]:
            raise RuntimeError(label + " unexpected rows: " + repr(rows))

    def manifest_path(schema: str) -> pathlib.Path:
        return project / "config/semantic-layer/hive-1/_schema" / (schema + ".yaml")

    def write_manifest(schema: str, content: str):
        path = manifest_path(schema)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def file_sha(path: pathlib.Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else ""

    def run_browser():
        login_check = request(web, "/api/auth/login", "POST", {"adminId": "repro_owner", "password": password})
        save("browser-login-preflight.json", {"httpStatus": login_check["httpStatus"], "ok": login_check["body"].get("ok")})
        if login_check["httpStatus"] != 200:
            raise RuntimeError("browser synthetic login preflight failed")
        browser_env = {**os.environ, "SNC_WEB": web, "SNC_PROJECT_DIR": str(project),
            "SNC_ADMIN_ID": "repro_owner", "SNC_ADMIN_PASSWORD": password,
            "SNC_DB_HOST": db, "SNC_DB_PASSWORD": dbpass, "SNC_OUT": str(out / "browser")}
        result = subprocess.run(["node", str(REPO / "scripts/uat/source-shortname-browser.mjs")],
            env=browser_env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        save("browser-runner.log", result.stdout + result.stderr)
        if result.returncode:
            raise RuntimeError("foreground browser verification failed: " + redact(result.stderr[-1600:]))
        browser_result = json.loads((out / "browser/summary.json").read_text())
        if browser_result.get("status") != "PASS":
            raise RuntimeError("browser result is not PASS")
        case("UAT-SNC-12", "PASS", {"summary": browser_result})

    try:
        for name in [
            "webui/config",
            "config/semantic-layer/hive-1/_schema",
            "config/wiki",
            "config/skills",
            "config/evals",
        ]:
            (project / name).mkdir(parents=True, exist_ok=True)

        # Entrypoint refuses empty semantic-layer; seed a stub that does not claim `city`.
        # repro additionally pre-seeds weather so the collision path matches the 2026-11-19 script.
        write_manifest("_uat_boot", "tables: {}\n")
        if args.mode == "repro":
            write_manifest(
                "weather",
                "tables:\n  city:\n    table: weather.city\n    columns:\n      - name: id\n        type: number\n      - name: name\n        type: string\n",
            )

        (project / "ktx.yaml").write_text(
            f"""connections:
  hive-1:
    driver: mysql
    host: {db}
    port: 3306
    database: weather
    username: lucy
    password: {dbpass}
    schemas: [weather, ods, aux, race_a, race_b, c1, c2, c3, c4, c5, c6, d1, d2, d3, d4, d5, d6]
    enabled_tables: [weather.city]
storage:
  state: sqlite
  search: sqlite-fts5
  git:
    author: ktx <ktx@example.com>
"""
        )
        (project / "webui/config/access.yaml").write_text(
            """roles:
  repro_reader:
    permission_model_version: 2
    allow:
      connections: [hive-1]
      source_scope: catalog_bound
      tools:
"""
            + "".join("        - " + t + "\n" for t in TOOLS)
            + """users:
  - id: repro_reader
    name: Shortname Repro Reader
    enabled: true
    role: repro_reader
    tokens:
      - hash: "sha256:"""
            + hashlib.sha256(token.encode()).hexdigest()
            + """"
        label: isolated-uat
        created: 2026-11-20
defaults:
  deny_tools: [sl_query, sl_read_source, sql_execution, memory_ingest, memory_ingest_status]
"""
        )
        bootfile = private / "bootstrap-token"
        bootfile.write_text(boot)
        os.chmod(bootfile, 0o600)
        envfile = private / "db.env"
        envfile.write_text("MYSQL_ROOT_PASSWORD=" + rootpass + "\n")
        os.chmod(envfile, 0o600)

        info = run(["docker", "image", "inspect", image, "--format", "{{.Id}} {{.Os}}/{{.Architecture}}"])
        hash_cmd = "sha256sum " + " ".join("/app/" + f for f in SOURCE_FILES)
        code = run(["docker", "run", "--rm", "--entrypoint", "/bin/sh", image, "-c", "cat /app/BUILD_REVISION; " + hash_cmd])
        matches = {}
        for file in SOURCE_FILES:
            sha = hashlib.sha256((args.source_root.resolve() / file).read_bytes()).hexdigest()
            matches[file] = {"hostSha256": sha, "imageMatchesHost": sha in code}
        summary.update(
            {
                "image": info,
                "buildRevisionAndHashes": code,
                "sourceComparison": matches,
                "sourceReferenceRoot": str(args.source_root.resolve()),
                "sourceReferenceKind": "live workspace" if args.source_root.resolve() == REPO else "frozen independent build inputs",
                "hostGitHead": run(["git", "rev-parse", "HEAD"]),
                "hostGitDirty": bool(run(["git", "status", "--porcelain"])),
                "database": "MySQL 8.4; synthetic schemas; connection label hive-1",
            }
        )
        save("summary.json", summary)
        if not all(v["imageMatchesHost"] for v in matches.values()):
            case("UAT-SNC-R0", "FAIL", {"reason": "source hash mismatch", "matches": matches})
        run(["docker", "network", "create", network])
        run(["docker", "run", "-d", "--name", db, "--network", network, "--env-file", str(envfile), "mysql:8.4"])
        for _ in range(90):
            r = subprocess.run(
                ["docker", "exec", db, "sh", "-c", 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "SELECT 1"'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            if r.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("DB did not become ready")

        sql = f"""CREATE DATABASE weather; CREATE DATABASE ods; CREATE DATABASE aux;
CREATE DATABASE race_a; CREATE DATABASE race_b;
CREATE DATABASE c1; CREATE DATABASE c2; CREATE DATABASE c3; CREATE DATABASE c4; CREATE DATABASE c5; CREATE DATABASE c6;
CREATE DATABASE d1; CREATE DATABASE d2; CREATE DATABASE d3; CREATE DATABASE d4; CREATE DATABASE d5; CREATE DATABASE d6;
CREATE DATABASE snc_ui_success; CREATE DATABASE snc_ui_unconfirmed; CREATE DATABASE snc_ui_recovered;
CREATE TABLE weather.city(id INT PRIMARY KEY, name VARCHAR(50));
CREATE TABLE ods.city(id INT PRIMARY KEY, name VARCHAR(50));
CREATE TABLE weather.zebra(id INT PRIMARY KEY); INSERT INTO weather.zebra VALUES(1);
CREATE TABLE ods.zebra(id INT PRIMARY KEY); INSERT INTO ods.zebra VALUES(11);
CREATE TABLE aux.City(id INT PRIMARY KEY); INSERT INTO aux.City VALUES(31);
CREATE TABLE aux.holder(id INT PRIMARY KEY, name VARCHAR(50));
CREATE TABLE race_a.city(id INT PRIMARY KEY, name VARCHAR(50));
CREATE TABLE race_b.city(id INT PRIMARY KEY, name VARCHAR(50));
INSERT INTO weather.city VALUES(1,'weather-city');
INSERT INTO ods.city VALUES(2,'ods-city');
INSERT INTO aux.holder VALUES(3,'aux-holder');
INSERT INTO race_a.city VALUES(4,'race-a');
INSERT INTO race_b.city VALUES(5,'race-b');
CREATE USER 'lucy'@'%' IDENTIFIED BY '{dbpass}';
GRANT SELECT, SHOW VIEW ON weather.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON snc_ui_success.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON snc_ui_unconfirmed.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON snc_ui_recovered.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON ods.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON aux.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON race_a.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON race_b.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON c1.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON c2.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON c3.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON c4.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON c5.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON c6.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON d1.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON d2.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON d3.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON d4.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON d5.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON d6.* TO 'lucy'@'%';
"""
        for i in range(1, 7):
            sql += f"CREATE TABLE c{i}.t(id INT PRIMARY KEY); INSERT INTO c{i}.t VALUES(1);\n"
            sql += f"CREATE TABLE d{i}.t(id INT PRIMARY KEY); INSERT INTO d{i}.t VALUES(1);\n"
        run(["docker", "exec", "-i", db, "sh", "-c", 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'], sql)
        run(
            [
                "docker",
                "run",
                "--rm",
                "--user",
                "0",
                "--entrypoint",
                "/bin/sh",
                "-v",
                str(project) + ":/data/lucy",
                "-v",
                str(bootfile) + ":/bootstrap-token",
                image,
                "-c",
                "chown -R 10001:10001 /data/lucy; chown 10001:10001 /bootstrap-token",
            ]
        )
        run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                app,
                "--network",
                network,
                "-p",
                "127.0.0.1::5174",
                "-p",
                "127.0.0.1::7879",
                "-v",
                str(project) + ":/data/lucy",
                "-v",
                str(bootfile) + ":/run/secrets/bootstrap-token:ro",
                "-e",
                "KTX_PROJECT_ROOT=/data/lucy",
                "-e",
                "LUCY_CONTENT_ROOT=/data/lucy/config",
                "-e",
                "LUCY_DISABLE_TEMPLATE_SYNC=1",
                "-e",
                "LUCY_DEPLOYMENT_MODE=customer",
                "-e",
                "LUCY_WEBUI_TEST_PROFILE=1",
                "-e",
                "LUCY_WEBUI_COOKIE_SECURE=0",
                "-e",
                "LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE=/run/secrets/bootstrap-token",
                "-e",
                "POSTHOG_DISABLED=1",
                image,
            ]
        )
        web = "http://" + run(["docker", "port", app, "5174/tcp"])
        mcp_base = "http://" + run(["docker", "port", app, "7879/tcp"])
        summary.update({"webui": web, "mcp": mcp_base + "/mcp"})
        health = None
        for _ in range(120):
            state = run(["docker", "inspect", app, "--format", "{{.State.Running}}"], check=False)
            if state == "false":
                raise RuntimeError("Lucy exited before readiness")
            try:
                health = request(web, "/api/health", timeout=2)
                if health["httpStatus"] == 200:
                    break
            except Exception:
                pass
            time.sleep(1)
        else:
            raise RuntimeError("Lucy did not become ready")
        save("health.json", health)
        auth = request(
            web,
            "/api/auth/bootstrap",
            "POST",
            {"adminId": "repro_owner", "displayName": "Repro Owner", "password": password},
            {"x-lucy-bootstrap-token": boot},
        )
        if auth["httpStatus"] != 200:
            raise RuntimeError("bootstrap failed: " + json.dumps(auth))
        step("bootstrap", {"httpStatus": auth["httpStatus"], "cookieIssued": bool(list(jar))})
        case("UAT-SNC-R0", "PASS", {"image": info, "hashesMatched": True})

        if args.browser_only:
            upload("weather", scan("weather", ["city"]), "browser-seed-weather")
            run(["docker", "exec", "-i", db, "sh", "-c", 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'],
                "CREATE TABLE ods.ods_zebra(id INT PRIMARY KEY); INSERT INTO ods.ods_zebra VALUES(21),(22);")
            upload("ods", scan("ods", ["city", "ods_zebra"]), "browser-seed-ods")
            enabled(["weather.city", "ods.city", "ods.ods_zebra"], "browser-seed", must=True)
            run_browser()
            summary["status"] = "SELECTOR_12_PASS"
            return

        if args.mode == "repro":
            weather = scan("weather", ["city"])
            upload("weather", weather, "baseline-weather")
            enabled(["weather.city"], "baseline")
            mcp("baseline-initialize", method="initialize")
            api("baseline-permissions", "/api/admin/agents/repro_reader/effective-permissions", method="GET")
            baseline = probe("baseline")
            assert_probe_ok(baseline, "baseline")
            case("UAT-SNC-01", "PASS", {})
            ods = scan("ods", ["city"])
            assert "  city:" in ods and "  city:" in weather
            upload("ods", ods, "collision-ods")
            enabled(["weather.city", "ods.city"], "collision")
            collision = probe("collision")
            reproduced = all(
                "source_map_compile_failed:duplicate_source_name:hive-1:city" in json.dumps(v) for v in collision.values()
            )
            summary["reproduced"] = reproduced
            summary["cases"]["UAT-SNC-01"] = {"status": "PASS"}
            summary["cases"]["UAT-SNC-02"] = {
                "status": "FAIL",
                "reason": "defect reproduced (expected for repro)" if reproduced else "expected defect not reproduced",
                "reproduced": reproduced,
            }
            summary["status"] = "COMPLETED_DEFECT_REPRODUCED"
            if not reproduced:
                raise RuntimeError("repro mode: expected duplicate_source_name not observed")
            step("completed", {"reproduced": True, "suiteVerdict": "FAIL (defect reproduced)"})
        else:
            # ---- verify R0 done; 01–09 ----
            weather = scan("weather", ["city"])
            if "  city:" not in weather:
                case("UAT-SNC-01", "FAIL", {"reason": "weather did not allocate bare city", "yaml": weather})
            upload("weather", weather, "v01-weather")
            en = enabled(["weather.city"], "v01", must=True)
            if en["body"].get("data", {}).get("runtimeAck") is not True:
                case("UAT-SNC-01", "FAIL", {"reason": "baseline runtimeAck not true", "data": en["body"].get("data")})
            mcp("v01-initialize", method="initialize")
            api("v01-permissions", "/api/admin/agents/repro_reader/effective-permissions", method="GET")
            baseline = probe("v01")
            assert_probe_ok(baseline, "v01")
            case("UAT-SNC-01", "PASS", {})

            ods = scan("ods", ["city"])
            if "  ods_city:" not in ods:
                case("UAT-SNC-02", "FAIL", {"reason": "ods scan did not allocate ods_city", "yaml": ods})
            val, up = upload("ods", ods, "v02-ods")
            if not val["body"].get("data", {}).get("valid") or up["httpStatus"] >= 400:
                case("UAT-SNC-02", "FAIL", {"reason": "ods upload rejected", "validation": val["body"], "upload": up["body"]})
            en2 = enabled(["weather.city", "ods.city"], "v02", must=True)
            data2 = en2["body"].get("data") or {}
            issues = data2.get("policyRuntimeIssues") or []
            if data2.get("runtimeAck") is not True or data2.get("policyRuntimeAck") is not True:
                case("UAT-SNC-02", "FAIL", {"reason": "ack not true after unique names", "data": data2})
            if any(str(i.get("reason", "")).startswith("source_map_compile_failed:") for i in issues):
                case("UAT-SNC-02", "FAIL", {"reason": "source map issue still present", "issues": issues})
            healthy = probe("v02")
            assert_probe_ok(healthy, "v02")
            ods_q = mcp(
                "v02-ods-query",
                "lucy_query",
                {"connectionId": "hive-1", "measures": [{"expr": "COUNT(ods_city.id)", "name": "row_count"}], "limit": 1},
            )
            if inner(ods_q).get("rows") != [[1]]:
                case("UAT-SNC-02", "FAIL", {"reason": "ods_city query rows", "result": inner(ods_q)})
            case("UAT-SNC-02", "PASS", {"odsYamlHasOdsCity": True})

            # 03 reference stability — overlays live at semantic-layer/<conn>/<sourceName>.yaml
            overlay_w = project / "config/semantic-layer/hive-1/city.yaml"
            overlay_o = project / "config/semantic-layer/hive-1/ods_city.yaml"
            overlay_w.parent.mkdir(parents=True, exist_ok=True)
            overlay_w.write_text(
                "name: city\nmeasures:\n  - name: snc_city_fixture\n    expr: count(id)\n    description: shortname uat city overlay\n"
            )
            overlay_o.write_text(
                "name: ods_city\nmeasures:\n  - name: snc_ods_city_fixture\n    expr: count(id)\n    description: shortname uat ods_city overlay\n"
            )
            role_before = (project / "webui/config/access.yaml").read_text()
            saved_q = project / "config/evals/shortname-fixture.yaml"
            saved_q.write_text(
                "cases:\n  - id: snc-city-count\n    question: count weather city\n    source: city\n"
            )
            before = {
                "ow": overlay_w.read_text(),
                "oo": overlay_o.read_text(),
                "sq": saved_q.read_text(),
                "role": role_before,
            }
            w2 = scan("weather", ["city"])
            o2 = scan("ods", ["city"])
            upload("weather", w2, "v03-weather")
            upload("ods", o2, "v03-ods")
            after_probe = probe("v03")
            assert_probe_ok(after_probe, "v03")
            ods_q3 = mcp(
                "v03-ods-query",
                "lucy_query",
                {"connectionId": "hive-1", "measures": [{"expr": "COUNT(ods_city.id)", "name": "row_count"}], "limit": 1},
            )
            if inner(ods_q3).get("rows") != [[1]]:
                case("UAT-SNC-03", "FAIL", {"reason": "ods_city query after rescan", "result": inner(ods_q3)})
            if "  city:" not in w2 or "  ods_city:" not in o2:
                case("UAT-SNC-03", "FAIL", {"reason": "names drifted on rescan", "w": w2, "o": o2})
            if (
                overlay_w.read_text() != before["ow"]
                or overlay_o.read_text() != before["oo"]
                or saved_q.read_text() != before["sq"]
                or (project / "webui/config/access.yaml").read_text() != before["role"]
            ):
                case("UAT-SNC-03", "FAIL", {"reason": "fixture files rewritten"})
            case("UAT-SNC-03", "PASS", {})

            # 04 negative write
            before_sha = file_sha(manifest_path("ods"))
            uploads_before = api("v04-uploads-before", "/api/catalog/assets/uploads", method="GET")
            bare = "tables:\n  city:\n    table: ods.city\n    columns:\n      - name: id\n        type: number\n"
            val4, up4 = upload("ods", bare, "v04-bare", must=False)
            vdata = val4["body"].get("data") or {}
            errs = vdata.get("errors") or []
            if vdata.get("valid") is not False or not any(e.get("code") == "DUPLICATE_SOURCE_NAME" for e in errs):
                case("UAT-SNC-04", "FAIL", {"reason": "expected DUPLICATE_SOURCE_NAME", "data": vdata})
            if up4["httpStatus"] != 400:
                case("UAT-SNC-04", "FAIL", {"reason": "upload not 400", "upload": up4})
            if file_sha(manifest_path("ods")) != before_sha:
                case("UAT-SNC-04", "FAIL", {"reason": "ods manifest changed after rejected upload"})
            uploads_after = api("v04-uploads-after", "/api/catalog/assets/uploads", method="GET")
            # soft check: record count should not grow for rejected upload
            still = probe("v04")
            assert_probe_ok(still, "v04")
            case(
                "UAT-SNC-04",
                "PASS",
                {
                    "suggested": next((c.get("suggestedSourceName") for c in (vdata.get("sourceNameConflicts") or []) if c.get("involvesCandidate")), None),
                    "uploadsBefore": uploads_before["body"].get("data"),
                    "uploadsAfter": uploads_after["body"].get("data"),
                },
            )

            # 05 secondary prefix: clear ods first, occupy ods_city via aux, then rescan ods
            if manifest_path("ods").exists():
                manifest_path("ods").unlink()
            overlay_ods = project / "config/semantic-layer/hive-1/ods_city.yaml"
            if overlay_ods.exists():
                overlay_ods.unlink()
            aux_yaml = (
                "tables:\n  ods_city:\n    table: aux.holder\n    columns:\n"
                "      - name: id\n        type: number\n"
            )
            val5a, up5a = upload("aux", aux_yaml, "v05-aux", must=False)
            if up5a["httpStatus"] >= 400 or not val5a["body"].get("data", {}).get("valid"):
                case("UAT-SNC-05", "FAIL", {"reason": "aux ods_city upload rejected", "validation": val5a["body"], "upload": up5a["body"]})
            ods5 = scan("ods", ["city"])
            if "  ods_city_2:" not in ods5:
                case("UAT-SNC-05", "FAIL", {"reason": "expected ods_city_2", "yaml": ods5})
            upload("ods", ods5, "v05-ods")
            enabled(["weather.city", "ods.city", "aux.holder"], "v05", must=True)
            q5a = mcp(
                "v05-aux-query",
                "lucy_query",
                {"connectionId": "hive-1", "measures": [{"expr": "COUNT(ods_city.id)", "name": "row_count"}], "limit": 1},
            )
            q5b = mcp(
                "v05-ods-query",
                "lucy_query",
                {"connectionId": "hive-1", "measures": [{"expr": "COUNT(ods_city_2.id)", "name": "row_count"}], "limit": 1},
            )
            if inner(q5a).get("rows") != [[1]] or inner(q5b).get("rows") != [[1]]:
                case("UAT-SNC-05", "FAIL", {"aux": inner(q5a), "ods": inner(q5b)})
            case("UAT-SNC-05", "PASS", {"odsYaml": ods5})

            # Keep aux.ods_city; weather.city; ods.ods_city_2 as current healthy set.

            # 06: Both previews must be valid against the same empty race schemas.
            bare_a = "tables:\n  shared:\n    table: race_a.city\n    columns:\n      - name: id\n        type: number\n"
            bare_b = "tables:\n  shared:\n    table: race_b.city\n    columns:\n      - name: id\n        type: number\n"
            for schema in ("race_a", "race_b"):
                if manifest_path(schema).exists():
                    raise RuntimeError("race fixture is not empty")
            for schema, content in [("race_a", bare_a), ("race_b", bare_b)]:
                preview = api("v06-early-" + schema, "/api/catalog/assets/validate", {
                    "connectionId": "hive-1", "schema": schema, "assetKind": "schema_manifest",
                    "filename": schema + ".yaml", "content": content,
                })
                if preview["body"].get("data", {}).get("valid") is not True:
                    raise RuntimeError("race candidate was not valid before either upload")
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
                futures = [ex.submit(upload, schema, content, "v06-race-" + schema, False)
                           for schema, content in [("race_a", bare_a), ("race_b", bare_b)]]
                responses = [future.result()[1] for future in futures]
            loser, busy = classify_race_responses(responses)
            loser_schema, loser_content = [("race_a", bare_a), ("race_b", bare_b)][loser]
            if manifest_path(loser_schema).exists():
                raise RuntimeError("failed race candidate wrote a manifest")
            uploads_before = api("v06-uploads-before-retry", "/api/catalog/assets/uploads", method="GET")
            journals_before = sorted(str(p.relative_to(project)) for p in (project / ".ktx-ui/semantic-recovery-journals").glob("*.json"))
            # Both requests have settled: the winning publisher has released its lock.
            # A busy loser must now prove that its unchanged stale candidate is rejected.
            payload = {"connectionId": "hive-1", "schema": loser_schema, "assetKind": "schema_manifest",
                       "filename": loser_schema + ".yaml", "content": loser_content, "confirmOverwrite": True}
            retry = api("v06-postwindow-retry", "/api/catalog/assets/upload", payload, must=False)
            if retry["httpStatus"] != 400 or retry["body"].get("error", {}).get("code") != "DUPLICATE_SOURCE_NAME":
                raise RuntimeError("stale race candidate was not rejected with DUPLICATE_SOURCE_NAME")
            uploads_after = api("v06-uploads-after-retry", "/api/catalog/assets/uploads", method="GET")
            if uploads_before["body"] != uploads_after["body"] or manifest_path(loser_schema).exists():
                raise RuntimeError("rejected race retry advanced upload state")
            if journals_before != sorted(str(p.relative_to(project)) for p in (project / ".ktx-ui/semantic-recovery-journals").glob("*.json")):
                raise RuntimeError("rejected race retry advanced journal state")
            still6 = probe("v06")
            assert_probe_ok(still6, "v06")
            case("UAT-SNC-06", "PASS", {"busyObserved": busy, "postWindowStatus": 400,
                 "postWindowCode": "DUPLICATE_SOURCE_NAME", "proof": "real API contention and stale-candidate retry; controlled in-lock timing covered separately by Vitest"})

            # 07 ack negative: inject weather+ods both named city
            write_manifest(
                "weather",
                "tables:\n  city:\n    table: weather.city\n    columns:\n      - name: id\n        type: number\n",
            )
            write_manifest(
                "ods",
                "tables:\n  city:\n    table: ods.city\n    columns:\n      - name: id\n        type: number\n",
            )
            # drop aux conflict for clearer compile error
            if manifest_path("aux").exists():
                manifest_path("aux").unlink()
            en7 = enabled(["weather.city", "ods.city"], "v07-neg", must=False)
            d7 = en7["body"].get("data") or {}
            issues7 = d7.get("policyRuntimeIssues") or []
            if d7.get("runtimeAck") is True or d7.get("policyRuntimeAck") is True:
                case("UAT-SNC-07", "FAIL", {"reason": "ack true under conflict", "data": d7})
            if not any(str(i.get("reason", "")).startswith("source_map_compile_failed:") for i in issues7):
                case("UAT-SNC-07", "FAIL", {"reason": "missing source_map issue", "issues": issues7})
            # repair
            upload(
                "ods",
                "tables:\n  ods_city:\n    table: ods.city\n    columns:\n      - name: id\n        type: number\n",
                "v07-fix",
            )
            en7b = enabled(["weather.city", "ods.city"], "v07-fix", must=True)
            d7b = en7b["body"].get("data") or {}
            if d7b.get("runtimeAck") is not True:
                case("UAT-SNC-07", "FAIL", {"reason": "ack not restored", "data": d7b})
            p7 = probe("v07")
            assert_probe_ok(p7, "v07")
            case("UAT-SNC-07", "PASS", {})

            # 08 six preexisting conflict pairs cN/dN both use short name tN
            for i in range(1, 7):
                write_manifest(
                    f"c{i}",
                    f"tables:\n  t{i}:\n    table: c{i}.t\n    columns:\n      - name: id\n        type: number\n",
                )
                write_manifest(
                    f"d{i}",
                    f"tables:\n  t{i}:\n    table: d{i}.t\n    columns:\n      - name: id\n        type: number\n",
                )
            en8 = enabled(["weather.city", "ods.city"], "v08-start", must=False)
            remaining = 6
            for i in range(1, 7):
                unique = (
                    f"tables:\n  d{i}_t:\n    table: d{i}.t\n    columns:\n      - name: id\n        type: number\n"
                )
                val8, up8 = upload(f"d{i}", unique, f"v08-fix-d{i}", must=False)
                if up8["httpStatus"] >= 400:
                    case("UAT-SNC-08", "FAIL", {"reason": f"fix upload d{i} rejected", "body": up8["body"]})
                conflicts = (val8["body"].get("data") or {}).get("sourceNameConflicts") or []
                # candidate itself should not be in hard errors
                if (val8["body"].get("data") or {}).get("valid") is not True:
                    case("UAT-SNC-08", "FAIL", {"reason": f"valid false for d{i} unique", "data": val8["body"].get("data")})
                remaining -= 1
                step(f"v08-progress-{i}", {"remainingEstimate": remaining, "conflictDiagCount": len(conflicts)})
            en8b = enabled(["weather.city", "ods.city"], "v08-end", must=True)
            if en8b["body"].get("data", {}).get("runtimeAck") is not True:
                case("UAT-SNC-08", "FAIL", {"reason": "ack not true after six fixes", "data": en8b["body"].get("data")})
            p8 = probe("v08")
            assert_probe_ok(p8, "v08")
            case("UAT-SNC-08", "PASS", {"startAck": (en8["body"].get("data") or {}).get("runtimeAck")})

            # 10: An old allocated alias must never be stolen by a later new table.
            upload("weather", scan("weather", ["city", "zebra"]), "v10-weather")
            old_ods = scan("ods", ["city", "zebra"])
            if "  ods_zebra:" not in old_ods:
                raise RuntimeError("old zebra alias was not established")
            upload("ods", old_ods, "v10-ods-before")
            run(["docker", "exec", "-i", db, "sh", "-c", 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'],
                "CREATE TABLE ods.ods_zebra(id INT PRIMARY KEY); INSERT INTO ods.ods_zebra VALUES(21),(22);")
            expanded = scan("ods", ["city", "zebra", "ods_zebra"])
            upload("ods", expanded, "v10-ods-expanded")
            enabled(["weather.city", "ods.city", "ods.zebra", "ods.ods_zebra"], "v10", must=True)
            counts = []
            for source, expected in [("ods_zebra", 1), ("ods_ods_zebra", 2)]:
                result = mcp("v10-query-" + source, "lucy_query", {"connectionId": "hive-1", "measures": [{"expr": "COUNT(" + source + ".id)", "name": "row_count"}]})
                payload = inner(result)
                if not isinstance(payload, dict) or payload.get("rows") != [[expected]]:
                    raise RuntimeError("old alias or new table returned wrong rows: " + repr(payload))
                counts.append({"source": source, "rows": payload["rows"], "sql": payload.get("sql")})
            case("UAT-SNC-10", "PASS", {"queries": counts})

            # 11: Actual mixed-case table; verify both names-only and column scan outputs.
            names_only = scan("aux")
            if "  aux_City:" not in names_only or "table: aux.City" not in names_only:
                raise RuntimeError("names-only uppercase allocation was lost")
            upper = scan("aux", ["City"])
            if "  aux_City:" not in upper or "table: aux.City" not in upper:
                raise RuntimeError("uppercase allocation or physical identifier case was lost")
            upload("aux", upper, "v11-aux")
            enabled(["weather.city", "ods.city", "ods.zebra", "ods.ods_zebra", "aux.City"], "v11", must=True)
            upper_query = mcp("v11-query", "lucy_query", {"connectionId": "hive-1", "measures": [{"expr": "COUNT(aux_City.id)", "name": "row_count"}]})
            if inner(upper_query).get("rows") != [[1]]:
                raise RuntimeError("mixed-case physical table query failed")
            case("UAT-SNC-11", "PASS", {"result": inner(upper_query)})

            if args.browser:
                run_browser()
            else:
                case("UAT-SNC-12", "NOT RUN", {"reason": "--browser required for full suite verdict"})

            # 09 evidence rollup
            case(
                "UAT-SNC-09",
                "PASS",
                {
                    "evidenceDir": str(out),
                    "allCases": {k: v.get("status") for k, v in summary["cases"].items()},
                },
            )
            summary["verifyPassed"] = all(v.get("status") == "PASS" for v in summary["cases"].values())
            if not summary["verifyPassed"]:
                raise RuntimeError("verify incomplete")
            summary["status"] = "PASS"
            step("completed", {"verifyPassed": True})

    except Exception as exc:
        summary["error"] = redact(str(exc))
        save("summary.json", summary)
        print("ERROR: " + redact(str(exc)), flush=True)
        raise
    finally:
        for label, name in [("lucy", app), ("mysql", db)]:
            logs = subprocess.run(
                ["docker", "logs", "--tail", "200", name], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
            ).stdout
            save(label + ".log", logs)
            run(["docker", "rm", "-f", name], check=False)
        run(["docker", "network", "rm", network], check=False)
        if project.exists():
            run(
                [
                    "docker",
                    "run",
                    "--rm",
                    "--user",
                    "0",
                    "--entrypoint",
                    "/bin/sh",
                    "-v",
                    str(project) + ":/data/lucy",
                    image,
                    "-c",
                    "chown -R " + str(os.getuid()) + ":" + str(os.getgid()) + " /data/lucy",
                ],
                check=False,
            )
        shutil.rmtree(private, ignore_errors=True)
        summary["cleanedUp"] = not private.exists()
        summary["finishedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        save("summary.json", summary)
        print("Evidence: " + str(out), flush=True)


if __name__ == "__main__":
    main()
