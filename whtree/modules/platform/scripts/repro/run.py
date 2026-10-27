#!/usr/bin/env python3
"""Run one bounded issue reproduction locally or in a disposable official image."""
import argparse
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
BASE = 'a91a7a28cca92a67220ca22c1b715043d390c8c3'
IMAGE = 'ghcr.io/webhare/platform@sha256:49b7779032776377d4747206b16bc4fe5b434a8bb6f3585bed97e93b1de223e6'
SCRIPTS = {'142': 'main.ts', '143': 'main.whscr', '144': 'main.ts', '145': 'main.whscr'}
EXTRA_SCRIPTS = {'143-handover': 'handover.ts', '143-codec': 'codec.ts', '143-calljs': 'socket-calljs.ts'}


def resource_path(case):
    issue = case.split('-')[0]
    script = SCRIPTS[case] if case in SCRIPTS else EXTRA_SCRIPTS[case]
    return 'mod::platform/scripts/repro/issue-' + issue + '/' + script


def command(args, timeout=30):
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, errors='replace', start_new_session=True)
    try:
        output, _ = process.communicate(timeout=timeout)
        return process.returncode, output
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        output, _ = process.communicate()
        return 124, output + '\nReproduction exceeded its execution deadline.\n'


def checked(args, timeout=30):
    code, output = command(args, timeout)
    if code:
        raise RuntimeError('Command failed: ' + ' '.join(args) + '\n' + output)
    return output


def save(directory, filename, text):
    if directory:
        (directory / filename).write_text(text)


def docker_repro(issue, output, keep):
    name = 'webhare-repro-' + issue + '-' + secrets.token_hex(4)
    network = name + '-internal'
    created_network = False
    created_container = False
    try:
        checked(['docker', 'network', 'create', '--internal', '--label', 'webhare.reproduction=' + issue, network])
        created_network = True
        checked(['docker', 'create', '--platform', 'linux/amd64', '--name', name, '--network', network,
                 '--memory', '4g', '--memory-swap', '6g', '--cpus', '2',
                 '--label', 'webhare.reproduction=' + issue,
                 '-e', 'WEBHARE_ALLOWEPHEMERAL=1', '-e', 'WEBHARE_CI=1',
                 '-e', 'WEBHARE_DTAPSTAGE=development', IMAGE])
        created_container = True
        checked(['docker', 'cp', str(ROOT), name + ':/opt/wh/whtree/modules/platform/scripts/'])
        checked(['docker', 'start', name])
        state = json.loads(checked(['docker', 'inspect', name]))[0]
        since = state['State']['StartedAt']
        deadline = time.monotonic() + 180
        print('Issue #' + issue + ': waiting for this boot to complete', flush=True)
        while True:
            logs = checked(['docker', 'logs', '--since', since, name])
            if 'All post start tasks completed' in logs:
                save(output, 'issue-' + issue + '-boot.log', logs)
                break
            if time.monotonic() > deadline:
                save(output, 'issue-' + issue + '-boot.log', logs)
                raise RuntimeError('Fresh boot did not complete in 180 seconds\n' + logs[-4000:])
            time.sleep(0.5)
        code, text = command(['docker', 'exec', name, 'timeout', '--kill-after=2', '28',
                              'wh', 'run', resource_path(issue)], timeout=40)
        save(output, 'issue-' + issue + '-memory.log', checked(['docker', 'exec', name, 'cat', '/sys/fs/cgroup/memory.events']))
        return {'issue': int(issue.split('-')[0]), 'case': issue, 'exit': code, 'output': text, 'mode': 'docker',
                'image': IMAGE, 'testedBase': BASE, 'freshBootConfirmed': True}
    finally:
        if keep and created_container:
            print('Retained container: ' + name + '; network: ' + network, flush=True)
        else:
            failures = []
            if created_container:
                code, text = command(['docker', 'rm', '--force', name], timeout=30)
                if code:
                    failures.append('Container cleanup failed for ' + name + ': ' + text)
            if created_network:
                code, text = command(['docker', 'network', 'rm', network], timeout=30)
                if code:
                    failures.append('Network cleanup failed for ' + network + ': ' + text)
            if failures:
                raise RuntimeError('\n'.join(failures))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('issue', choices=[*SCRIPTS, *EXTRA_SCRIPTS, 'all'])
    parser.add_argument('--docker', action='store_true', help='Use a fresh isolated official 6.2 container for each issue')
    parser.add_argument('--output', type=Path, help='Create a new directory with logs and JSON results')
    parser.add_argument('--keep', action='store_true', help='Retain Docker containers for debugging')
    args = parser.parse_args()
    if args.keep and not args.docker:
        parser.error('--keep requires --docker')
    if args.output:
        args.output.mkdir(parents=True, exist_ok=False)
    if args.docker:
        code, _ = command(['docker', 'image', 'inspect', IMAGE])
        if code:
            print('Pulling the pinned official image', flush=True)
            checked(['docker', 'pull', '--platform', 'linux/amd64', IMAGE], timeout=900)
        metadata = json.loads(checked(['docker', 'image', 'inspect', IMAGE]))[0]
        if metadata['Config']['Labels'].get('com.webhare.webhare.git-commit-sha') != BASE:
            raise RuntimeError('Official image revision did not match the pinned base')
    results = []
    for issue in [*SCRIPTS, *EXTRA_SCRIPTS] if args.issue == 'all' else [args.issue]:
        if args.docker:
            result = docker_repro(issue, args.output, args.keep)
        else:
            code, text = command(['wh', 'run', resource_path(issue)], timeout=30)
            result = {'issue': int(issue.split('-')[0]), 'case': issue, 'exit': code, 'output': text, 'mode': 'local'}
        results.append(result)
        print(result['output'], end='' if result['output'].endswith('\n') else '\n', flush=True)
        save(args.output, 'issue-' + issue + '.log', result['output'])
        save(args.output, 'results.json', json.dumps(results, indent=2) + '\n')
        print('Issue #' + issue + ': process exit ' + str(result['exit']), flush=True)
    print(json.dumps([{'case': item['case'], 'exit': item['exit']} for item in results], indent=2))
    return int(any(item['exit'] for item in results))


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
