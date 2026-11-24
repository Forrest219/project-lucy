#!/usr/bin/env python3
"""Run or independently verify the standard Docker core availability UAT."""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys

sys.dont_write_bytecode = True

TOOLS = pathlib.Path(__file__).resolve().parent
RUNNER = TOOLS/'core-availability-1883-soak.py'
VERIFIER = TOOLS/'core-availability-verify.py'
PROFILE_FILE = TOOLS/'core-availability-profiles.json'
FROZEN_TOOLS = [PROFILE_FILE, pathlib.Path(__file__).resolve(), RUNNER, VERIFIER,
                TOOLS/'core-availability-gateway.py', TOOLS/'readyz-diagnostic-repro.py',
                TOOLS/'verify-begin-zero-binding.py']
PROFILES = json.loads(PROFILE_FILE.read_text())
PROFILE_VERSION = PROFILES.pop('version')



def command(*args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=20)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'command failed: '+args[0])
    return result.stdout.strip()


def image_identity(image):
    result = command('docker','image','inspect','--format','{{.Id}} {{.Os}} {{.Architecture}}',image)
    image_id, operating_system, architecture = result.split()
    if operating_system != 'linux':
        raise ValueError('UAT requires native Linux containers')
    return image_id, architecture


def preflight(args):
    if not re.fullmatch(r'[0-9a-f]{40}', args.git_sha):
        raise ValueError('--git-sha requires a full 40-character Git commit')
    endpoint = os.environ.get('DOCKER_HOST')
    if not endpoint:
        context = command('docker','context','show')
        endpoint = command('docker','context','inspect',context,'--format','{{.Endpoints.docker.Host}}')
    if not endpoint.startswith('unix://'):
        raise ValueError('use a local Docker Linux engine with a Unix socket and reachable localhost ports')
    image, app_arch = image_identity(args.image)
    mysql, mysql_arch = image_identity(args.mysql_image)
    cpus, memory, docker_arch = command('docker','info','--format','{{.NCPU}} {{.MemTotal}} {{.Architecture}}').split()
    docker_arch = {'aarch64':'arm64','x86_64':'amd64'}.get(docker_arch,docker_arch)
    if app_arch != docker_arch or mysql_arch != docker_arch:
        raise ValueError('Lucy and MySQL must match the native Docker architecture')
    if int(cpus) < 4 or int(memory) < 5*1024**3:
        raise ValueError('Docker needs at least 4 CPUs and 5 GiB usable memory')
    if shutil.disk_usage(pathlib.Path.cwd()).free < 4*1024**3:
        raise ValueError('keep at least 4 GiB available for local UAT evidence')
    if os.environ.get('ZB_SQLITE_DIAGNOSTIC'):
        raise ValueError('unset ZB_SQLITE_DIAGNOSTIC for the standard run')
    return {'images':{'appImageId':image,'mysqlImageId':mysql,'gitSha':args.git_sha,'gitDirty':False},
            'host':{'cpus':int(cpus),'memoryBytes':int(memory),'architecture':docker_arch}}


def runner_options(args, frozen, out):
    options = ['--image',frozen['images']['appImageId'],'--mysql-image',frozen['images']['mysqlImageId'],
               '--expected-git-sha',args.git_sha,'--out',str(out),'--mode',args.profile,'--gateway','--contract-policy','p1-69',
               '--contract-recovery-seconds','300','--audit-evidence-copy','--io-control']
    for name, value in PROFILES[args.profile].items():
        options.extend(['--'+name,str(value)])
    return options


def verify(run, verifier=VERIFIER):
    return subprocess.run([sys.executable,str(verifier),'--run',str(run),
                           '--out',str(run/'verdict.json')]).returncode


def execute(args):
    out = args.out.resolve()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    try:
        frozen = preflight(args)
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        result = {'strictAcceptanceVerdict':'BLOCKED','integrityVerdict':'INVALID','issues':[str(error)]}
        (out/'preflight-error.json').write_text(json.dumps(result,indent=2)+'\n')
        (out/'verdict.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2
    options = runner_options(args,frozen,out)
    snapshot = out/'tools/scripts/uat'
    snapshot.mkdir(parents=True)
    for path in FROZEN_TOOLS:
        shutil.copyfile(path,snapshot/path.name)
    runner_path = snapshot/RUNNER.name
    spec = importlib.util.spec_from_file_location('core_uat_runner',runner_path)
    runner = importlib.util.module_from_spec(spec)
    exec(compile(runner_path.read_bytes(),str(runner_path),'exec'),runner.__dict__)
    frozen.update(schemaVersion=1, profile=args.profile, thresholds=PROFILE_VERSION,
                  parameters=vars(runner.parse_args(options)),
                  tools={path.name:hashlib.sha256((snapshot/path.name).read_bytes()).hexdigest() for path in FROZEN_TOOLS})
    (out/'freeze.json').write_text(json.dumps(frozen,indent=2)+'\n')
    process = subprocess.Popen([sys.executable,str(runner_path),*options])
    previous = signal.signal(signal.SIGTERM, lambda *_: process.terminate())
    try:
        returncode = process.wait()
    except KeyboardInterrupt:
        returncode = process.wait()
    finally:
        signal.signal(signal.SIGTERM, previous)
    (out/'runner-exit.json').write_text(json.dumps({'exitCode':returncode})+'\n')
    with (out/'evidence-sha256.json').open('w') as manifest:
        evidence = {}
        for path in sorted(out.rglob('*')):
            if path.is_file() and path not in (out/'evidence-sha256.json', out/'verdict.json'):
                digest = hashlib.sha256()
                with path.open('rb') as stream:
                    for chunk in iter(lambda:stream.read(1024*1024), b''):
                        digest.update(chunk)
                evidence[path.relative_to(out).as_posix()] = digest.hexdigest()
        json.dump(evidence, manifest, indent=2)
    return verify(out,snapshot/VERIFIER.name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest='command',required=True)
    for name in ('preflight','run'):
        sub = subs.add_parser(name)
        sub.add_argument('--image',required=True)
        sub.add_argument('--git-sha',required=True)
        sub.add_argument('--mysql-image',default='mysql:8.4')
        if name == 'run':
            sub.add_argument('--profile',choices=PROFILES,required=True)
            sub.add_argument('--out',type=pathlib.Path,required=True,help='new, unused output directory')
    sub = subs.add_parser('verify',help='independently recount the raw results without Docker')
    sub.add_argument('--run',type=pathlib.Path,required=True)
    args = parser.parse_args()
    try:
        if args.command == 'verify':
            return verify(args.run.resolve())
        if args.command == 'run':
            return execute(args)
        print(json.dumps(preflight(args),indent=2))
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        print('BLOCKED: '+str(error),file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
