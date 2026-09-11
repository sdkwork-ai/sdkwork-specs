#!/usr/bin/env python3
"""Add the §2.3 log-rotation anchor + per-service logging to our compose files.

Idempotent: files that already define `x-default-logging` and carry a
`logging:` key in every service body are left untouched. Vendored third-party
stacks under `external/` are out of scope.
"""
import json
import os
import re
import subprocess
import sys

SPACE = 'E:/sdkwork-space'
MODS = ['agentstudio', 'aiot', 'audio', 'birdcoder', 'customerservice', 'deployments',
        'dezhou', 'drive', 'forum', 'games', 'kernel', 'knowledgebase', 'local-router',
        'prompts', 'rtc', 'tts']

ANCHOR = """# Shared log rotation policy (OPERATIONS_SPEC.md §2.3): every service rotates
# at 10MB, keeping 3 files, so container logs cannot fill the host disk.
x-default-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"

"""


def flagged(module):
    r = subprocess.run(['node', f'{SPACE}/sdkwork-specs/tools/check-operations-conformance.mjs',
                        '--root', f'{SPACE}/sdkwork-{module}', '--json'],
                       capture_output=True, text=True, timeout=120)
    d = json.loads(r.stdout)
    out = []
    for c in d['results']:
        if c['status'] != 'FAIL' or 'log rotation' not in c['check']:
            continue
        detail = re.sub(r'^services without logging:\s*', '', c['detail'])
        for part in detail.split('; '):
            mm = re.match(r'^(.+?) \((.*)\)$', part.strip())
            if mm:
                out.append((mm.group(1), mm.group(2)))
    return out


def fix(path):
    with open(path, encoding='utf-8', newline='') as fh:
        text = fh.read()
    nl = '\r\n' if '\r\n' in text else '\n'
    body = text.replace('\r\n', '\n')
    has_anchor = '&default-logging' in body
    lines = body.split('\n')
    try:
        start = next(i for i, l in enumerate(lines) if l.rstrip() == 'services:')
    except StopIteration:
        return 'no-services'
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if lines[i] and not lines[i].startswith(' ') and not lines[i].startswith('#'):
            end = i
            break
    # service headers at exactly two spaces
    headers = [i for i in range(start + 1, end) if re.match(r'^  [A-Za-z0-9_.-]+:\s*$', lines[i])]
    if not headers:
        return 'no-service-headers'
    touched = 0
    # iterate from the last service backwards so insertions never shift the
    # indices of service blocks still to be processed
    for idx in range(len(headers) - 1, -1, -1):
        h = headers[idx]
        stop = headers[idx + 1] if idx + 1 < len(headers) else end
        insert_at = stop
        while insert_at - 1 > h and lines[insert_at - 1].strip() == '':
            insert_at -= 1
        block = lines[h:insert_at]
        if any(re.match(r'^    logging:', l) for l in block):
            continue
        lines.insert(insert_at, '    logging: *default-logging')
        touched += 1
    if touched == 0:
        return 'no-service-touched'
    if not has_anchor:
        insert_at = next(i for i, l in enumerate(lines) if l.rstrip() == 'services:')
        lines[insert_at:insert_at] = ANCHOR.rstrip('\n').split('\n') + ['']
    result = '\n'.join(lines)
    if nl == '\r\n':
        result = result.replace('\n', '\r\n')
    with open(path, 'w', encoding='utf-8', newline='') as fh:
        fh.write(result)
    return f'fixed {touched} service(s)'


def main():
    applied = []
    for module in MODS:
        for rel, _svcs in flagged(module):
            if rel.startswith('external/') or '/external/' in rel:
                continue
            path = os.path.join(SPACE, f'sdkwork-{module}', rel)
            if not os.path.exists(path):
                applied.append((module, rel, 'MISSING'))
                continue
            applied.append((module, rel, fix(path)))
    for module, rel, status in applied:
        print(f'{module:16} {rel:60} {status}')


if __name__ == '__main__':
    main()
