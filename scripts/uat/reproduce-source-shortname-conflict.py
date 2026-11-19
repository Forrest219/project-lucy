#!/usr/bin/env python3
"""Real Docker/API/MCP reproducer; no product source changes, no production data."""
import datetime, hashlib, http.cookiejar, json, os, pathlib, secrets, shutil, subprocess, tempfile, time, urllib.error, urllib.request

REPO = pathlib.Path(__file__).resolve().parents[2]
OUT = REPO / 'inbox/source-shortname-conflict/evidence' / datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S')
OUT.mkdir(parents=True, exist_ok=True)
TAG = 'lucy-snc-' + secrets.token_hex(3)
NETWORK, DB, APP = TAG, TAG + '-db', TAG + '-app'
PRIVATE = pathlib.Path(tempfile.mkdtemp(prefix=TAG + '-'))
os.chmod(PRIVATE, 0o700)
PROJECT = PRIVATE / 'project'
PROJECT.mkdir()
TOKEN, BOOT, PASSWORD, DBPASS, ROOTPASS = [secrets.token_urlsafe(32) for _ in range(5)]
IMAGE = os.environ.get('SNC_IMAGE', 'project-lucy:demo')
jar = http.cookiejar.CookieJar()
http = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
summary = {'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'containers': [APP, DB], 'network': NETWORK, 'imageTag': IMAGE, 'steps': []}


def run(args, stdin=None, check=True):
    r = subprocess.run(args, input=stdin, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and r.returncode:
        raise RuntimeError('Command failed: ' + ' '.join(args[:3]) + ': ' + redact(r.stderr[-2000:]))
    return r.stdout.strip()


def redact(value):
    for s in (TOKEN, BOOT, PASSWORD, DBPASS, ROOTPASS):
        value = value.replace(s, '[REDACTED]')
    return value


def save(name, data):
    text = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False, indent=2)
    (OUT / name).write_text(redact(text) + '\n')


def step(name, data):
    summary['steps'].append({'step': name, **data})
    save('summary.json', summary)
    print(json.dumps({'step': name, **data}, ensure_ascii=False), flush=True)


def request(base, route, method='GET', body=None, headers=None, timeout=180):
    h = {'Content-Type': 'application/json', 'Origin': base, **(headers or {})}
    req = urllib.request.Request(base + route, data=None if body is None else json.dumps(body).encode(), headers=h, method=method)
    started = time.monotonic()
    try:
        res = http.open(req, timeout=timeout)
    except urllib.error.HTTPError as err:
        res = err
    text = res.read().decode()
    try:
        value = json.loads(text)
    except ValueError:
        # Accept streamable MCP SSE as well as JSON.
        lines = [line[6:] for line in text.splitlines() if line.startswith('data: ')]
        value = json.loads(lines[-1]) if lines else {'raw': text[:4000]}
    return {'httpStatus': res.status, 'elapsedMs': round((time.monotonic() - started) * 1000), 'body': value}


def api(name, route, body=None, method='POST', must=True):
    result = request(WEB, route, method, body)
    save(name + '.json', result)
    if must and (result['httpStatus'] >= 400 or result['body'].get('ok') is False):
        raise RuntimeError(name + ' failed: ' + json.dumps(result, ensure_ascii=False)[:1800])
    return result


rpc_id = 0

def mcp(name, tool=None, args=None, method='tools/call'):
    global rpc_id
    rpc_id += 1
    body = {'jsonrpc': '2.0', 'id': rpc_id, 'method': method}
    if method == 'tools/call':
        body['params'] = {'name': tool, 'arguments': args or {}}
    elif method == 'initialize':
        body['params'] = {'protocolVersion': '2024-11-05', 'capabilities': {}, 'clientInfo': {'name': 'shortname-repro', 'version': '1'}}
    result = request(MCP, '/mcp', 'POST', body, {'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/json, text/event-stream'})
    save(name + '.json', result)
    return result


def inner(result):
    body = result['body']
    value = body.get('result', body)
    for c in value.get('content', []):
        if c.get('type') == 'text':
            try:
                return json.loads(c['text'])
            except ValueError:
                return c['text']
    return value


def scan(schema):
    res = api('scan-' + schema, '/api/connections/hive-1/schema-structure', {'schema': schema, 'tables': ['city']})
    data = res['body']['data']
    yaml = data['yaml']
    save(schema + '-generated.yaml', yaml)
    step('scan-' + schema, {'httpStatus': res['httpStatus'], 'tableCount': data['tableCount'], 'columnCount': data['columnCount'], 'yaml': yaml})
    return yaml


def upload(schema, yaml, prefix):
    payload = {'connectionId': 'hive-1', 'schema': schema, 'assetKind': 'schema_manifest', 'filename': schema + '.yaml', 'content': yaml, 'confirmOverwrite': True}
    validation = api(prefix + '-validate', '/api/catalog/assets/validate', payload)
    res = api(prefix + '-upload', '/api/catalog/assets/upload', payload, must=False)
    step(prefix + '-upload', {'httpStatus': res['httpStatus'], 'valid': validation['body'].get('data', {}).get('valid'), 'ok': res['body'].get('ok'), 'uploaded': res['body'].get('data', {}).get('uploaded')})
    return res


def enabled(names, prefix):
    res = api(prefix + '-enabled', '/api/connections/hive-1/enabled-tables', {'enabledTables': names, 'dryRun': False}, 'PUT', must=False)
    step(prefix + '-enabled', {'httpStatus': res['httpStatus'], 'ok': res['body'].get('ok'), 'data': res['body'].get('data')})
    return res


def probe(prefix):
    results = {}
    calls = [
        ('tools-list', None, None, 'tools/list'),
        ('catalog', 'lucy_catalog', {}, 'tools/call'),
        ('begin', 'lucy_begin_question', {'question': '查询测试城市表的记录数', 'intentSummary': '合成城市表短名冲突复现，指定 hive-1 weather.city', 'entities': ['hive-1.weather.city']}, 'tools/call'),
        ('read', 'lucy_read_source', {'connectionId': 'hive-1', 'sourceName': 'city'}, 'tools/call'),
        ('query', 'lucy_query', {'connectionId': 'hive-1', 'measures': [{'expr': 'COUNT(city.id)', 'name': 'row_count'}], 'limit': 1}, 'tools/call')]
    for label, tool, args, method in calls:
        result = mcp(prefix + '-' + label, tool, args, method)
        results[label] = result
        # Do not print tools schemas / full initialize instructions.
        v = inner(result)
        short = {'httpStatus': result['httpStatus'], 'error': result['body'].get('error'), 'isError': result['body'].get('result', {}).get('isError')}
        if label == 'query':
            short['result'] = v
        step(prefix + '-' + label, short)
    return results

try:
    for name in ['webui/config', 'config/semantic-layer/hive-1/_schema', 'config/wiki', 'config/skills', 'config/evals']:
        (PROJECT / name).mkdir(parents=True, exist_ok=True)
    (PROJECT / 'config/semantic-layer/hive-1/_schema/weather.yaml').write_text('tables:\n  city:\n    table: weather.city\n    columns:\n      - name: id\n        type: number\n      - name: name\n        type: string\n')
    (PROJECT / 'ktx.yaml').write_text(f'''connections:
  hive-1:
    driver: mysql
    host: {DB}
    port: 3306
    database: weather
    username: lucy
    password: {DBPASS}
    schemas: [weather, ods]
    enabled_tables: [weather.city]
storage:
  state: sqlite
  search: sqlite-fts5
  git:
    author: ktx <ktx@example.com>
''')
    tools = ['lucy_catalog', 'lucy_query', 'lucy_read_source', 'lucy_explain_query', 'lucy_begin_question', 'lucy_continue_question', 'connection_list']
    (PROJECT / 'webui/config/access.yaml').write_text('''roles:
  repro_reader:
    permission_model_version: 2
    allow:
      connections: [hive-1]
      source_scope: catalog_bound
      tools:
''' + ''.join('        - ' + t + '\n' for t in tools) + '''users:
  - id: repro_reader
    name: Shortname Repro Reader
    enabled: true
    role: repro_reader
    tokens:
      - hash: "sha256:''' + hashlib.sha256(TOKEN.encode()).hexdigest() + '''"
        label: isolated-repro
        created: 2026-11-19
defaults:
  deny_tools: [sl_query, sl_read_source, sql_execution, memory_ingest, memory_ingest_status]
''')
    bootfile = PRIVATE / 'bootstrap-token'
    bootfile.write_text(BOOT)
    os.chmod(bootfile, 0o600)
    envfile = PRIVATE / 'db.env'
    envfile.write_text('MYSQL_ROOT_PASSWORD=' + ROOTPASS + '\n')
    os.chmod(envfile, 0o600)
    info = run(['docker', 'image', 'inspect', IMAGE, '--format', '{{.Id}} {{.Os}}/{{.Architecture}}'])
    code = run(['docker', 'run', '--rm', '--entrypoint', '/bin/sh', IMAGE, '-c', 'cat /app/BUILD_REVISION; sha256sum /app/webui/server/schema-structure.ts /app/webui/server/proxy/acl.ts'])
    matches = {}
    for file in ['webui/server/schema-structure.ts', 'webui/server/proxy/acl.ts']:
        sha = hashlib.sha256((REPO / file).read_bytes()).hexdigest()
        matches[file] = {'hostSha256': sha, 'imageMatchesHost': sha in code}
    summary.update({'image': info, 'buildRevisionAndHashes': code, 'sourceComparison': matches, 'hostGitHead': run(['git', 'rev-parse', 'HEAD']), 'hostGitDirty': bool(run(['git', 'status', '--porcelain'])), 'database': 'MySQL 8.4; synthetic schemas weather/ods; connection label hive-1'})
    save('summary.json', summary)
    assert all(v['imageMatchesHost'] for v in matches.values()), 'target source files differ from image'
    run(['docker', 'network', 'create', NETWORK])
    run(['docker', 'run', '-d', '--name', DB, '--network', NETWORK, '--env-file', str(envfile), 'mysql:8.4'])
    for _ in range(90):
        r = subprocess.run(['docker', 'exec', DB, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "SELECT 1"'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if r.returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError('DB did not become ready')
    sql = f'''CREATE DATABASE weather; CREATE DATABASE ods;
CREATE TABLE weather.city(id INT PRIMARY KEY, name VARCHAR(50));
CREATE TABLE ods.city(id INT PRIMARY KEY, name VARCHAR(50));
INSERT INTO weather.city VALUES(1,'weather-city');
INSERT INTO ods.city VALUES(2,'ods-city');
CREATE USER 'lucy'@'%' IDENTIFIED BY '{DBPASS}';
GRANT SELECT, SHOW VIEW ON weather.* TO 'lucy'@'%';
GRANT SELECT, SHOW VIEW ON ods.* TO 'lucy'@'%';
'''
    run(['docker', 'exec', '-i', DB, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'], sql)
    run(['docker', 'run', '--rm', '--user', '0', '--entrypoint', '/bin/sh', '-v', str(PROJECT) + ':/data/lucy', '-v', str(bootfile) + ':/bootstrap-token', IMAGE, '-c', 'chown -R 10001:10001 /data/lucy; chown 10001:10001 /bootstrap-token'])
    run(['docker', 'run', '-d', '--name', APP, '--network', NETWORK, '-p', '127.0.0.1::5174', '-p', '127.0.0.1::7879', '-v', str(PROJECT) + ':/data/lucy', '-v', str(bootfile) + ':/run/secrets/bootstrap-token:ro', '-e', 'KTX_PROJECT_ROOT=/data/lucy', '-e', 'LUCY_CONTENT_ROOT=/data/lucy/config', '-e', 'LUCY_DISABLE_TEMPLATE_SYNC=1', '-e', 'LUCY_DEPLOYMENT_MODE=customer', '-e', 'LUCY_WEBUI_TEST_PROFILE=1', '-e', 'LUCY_WEBUI_COOKIE_SECURE=0', '-e', 'LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE=/run/secrets/bootstrap-token', '-e', 'POSTHOG_DISABLED=1', IMAGE])
    WEB = 'http://' + run(['docker', 'port', APP, '5174/tcp'])
    MCP = 'http://' + run(['docker', 'port', APP, '7879/tcp'])
    summary.update({'webui': WEB, 'mcp': MCP + '/mcp'})
    for _ in range(120):
        state = run(['docker', 'inspect', APP, '--format', '{{.State.Running}}'], check=False)
        if state == 'false':
            raise RuntimeError('Lucy exited before readiness')
        try:
            health = request(WEB, '/api/health', timeout=2)
            if health['httpStatus'] == 200:
                break
        except Exception:
            pass
        time.sleep(1)
    else:
        raise RuntimeError('Lucy did not become ready')
    save('health.json', health)
    auth = request(WEB, '/api/auth/bootstrap', 'POST', {'adminId': 'repro_owner', 'displayName': 'Repro Owner', 'password': PASSWORD}, {'x-lucy-bootstrap-token': BOOT})
    if auth['httpStatus'] != 200:
        raise RuntimeError('bootstrap failed: ' + json.dumps(auth))
    step('bootstrap', {'httpStatus': auth['httpStatus'], 'cookieIssued': bool(list(jar))})
    weather = scan('weather')
    upload('weather', weather, 'baseline-weather')
    enabled(['weather.city'], 'baseline')
    mcp('baseline-initialize', method='initialize')
    api('baseline-permissions', '/api/admin/agents/repro_reader/effective-permissions', method='GET')
    baseline = probe('baseline')
    assert baseline['tools-list']['httpStatus'] == 200, 'baseline tools/list is not usable'
    assert not baseline['query']['body'].get('result', {}).get('isError'), 'baseline query failed'
    ods = scan('ods')
    assert '  city:' in ods and '  city:' in weather
    upload('ods', ods, 'collision-ods')
    enabled(['weather.city', 'ods.city'], 'collision')
    collision = probe('collision')
    # Temporary fixture workaround from the report, preserving physical table.
    repaired_ods = ods.replace('  city:\n', '  ods_city:\n', 1)
    assert repaired_ods != ods and 'table: ods.city' in repaired_ods
    save('ods-workaround.yaml', repaired_ods)
    upload('ods', repaired_ods, 'workaround-ods')
    enabled(['weather.city', 'ods.city'], 'workaround')
    api('restored-permissions', '/api/admin/agents/repro_reader/effective-permissions', method='GET')
    restored = probe('restored')
    assert restored['tools-list']['httpStatus'] == 200, 'restored tools/list failed'
    assert not restored['query']['body'].get('result', {}).get('isError'), 'restored query failed'
    extra = mcp('restored-ods-query', 'lucy_query', {'connectionId': 'hive-1', 'measures': [{'expr': 'COUNT(ods_city.id)', 'name': 'row_count'}], 'limit': 1})
    step('restored-ods-query', {'httpStatus': extra['httpStatus'], 'result': inner(extra)})
    summary['reproduced'] = all('source_map_compile_failed:duplicate_source_name:hive-1:city' in json.dumps(v) for v in collision.values())
    assert summary['reproduced'], 'not all target MCP paths reproduced the exact error'
    assert inner(baseline['query'])['rows'] == [[1]]
    assert inner(restored['query'])['rows'] == [[1]]
    assert inner(extra)['rows'] == [[1]]
    summary['baselineQuery'] = inner(baseline['query'])
    summary['restoredQuery'] = inner(restored['query'])
    summary['restoredOdsQuery'] = inner(extra)
    step('completed', {'reproduced': summary['reproduced']})
except Exception as exc:
    summary['error'] = redact(str(exc))
    save('summary.json', summary)
    print('ERROR: ' + redact(str(exc)), flush=True)
    raise
finally:
    for label, name in [('lucy', APP), ('mysql', DB)]:
        logs = subprocess.run(['docker', 'logs', '--tail', '160', name], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT).stdout
        save(label + '.log', logs)
        run(['docker', 'rm', '-f', name], check=False)
    run(['docker', 'network', 'rm', NETWORK], check=False)
    # Restore host ownership before deleting the private fixture, including credentials.
    if PROJECT.exists():
        run(['docker', 'run', '--rm', '--user', '0', '--entrypoint', '/bin/sh', '-v', str(PROJECT) + ':/data/lucy', IMAGE, '-c', 'chown -R ' + str(os.getuid()) + ':' + str(os.getgid()) + ' /data/lucy'], check=False)
    shutil.rmtree(PRIVATE, ignore_errors=True)
    summary['cleanedUp'] = not PRIVATE.exists()
    summary['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save('summary.json', summary)
    print('Evidence: ' + str(OUT), flush=True)
