"""Add §2.3 log rotation to compose files — services block only.

The services region is the span from `services:` to the next top-level key
(`volumes:` / `networks:` / `secrets:` / `configs:` or end of file), so volume
and network entries can never be mistaken for services.
"""
import re
import sys

FILES = [
    '/mnt/e/sdkwork-space/sdkwork-birdcoder/deployments/docker/docker-compose.yml',
    '/mnt/e/sdkwork-space/sdkwork-forum/deployments/docker/docker-compose.yml',
    '/mnt/e/sdkwork-space/sdkwork-knowledgebase/docker-compose.yml',
]

ANCHOR = [
    '# Shared log rotation policy (OPERATIONS_SPEC.md \u00a72.3): every service rotates',
    '# at 10MB, keeping 3 files, so container logs cannot fill the host disk.',
    'x-default-logging: &default-logging',
    '  driver: json-file',
    '  options:',
    '    max-size: "10m"',
    '    max-file: "3"',
    '',
]


def services_span(lines):
    start = next((i for i, l in enumerate(lines) if l.rstrip() == 'services:'), None)
    if start is None:
        return None, None
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if lines[i] and not lines[i].startswith((' ', '#')) and not lines[i].startswith('---'):
            end = i
            break
    return start, end


for path in FILES:
    with open(path, encoding='utf-8', newline='') as fh:
        raw = fh.read()
    nl = '\r\n' if '\r\n' in raw else '\n'
    lines = raw.replace('\r\n', '\n').split('\n')
    start, end = services_span(lines)
    if start is None:
        print(f'{path}: no services block, skipped')
        continue
    has_anchor = any('&default-logging' in l for l in lines[:start])
    headers = [i for i in range(start + 1, end) if re.match(r'^  [A-Za-z0-9_.-]+:\s*$', lines[i])]
    added = []
    for idx in range(len(headers) - 1, -1, -1):
        h = headers[idx]
        stop = headers[idx + 1] if idx + 1 < len(headers) else end
        insert_at = stop
        while insert_at - 1 > h and lines[insert_at - 1].strip() == '':
            insert_at -= 1
        body = lines[h:insert_at]
        if any(re.match(r'^    logging:', l) for l in body):
            continue
        lines.insert(insert_at, '    logging: *default-logging')
        added.append(lines[h].strip())
    if not has_anchor:
        lines[start:start] = ANCHOR
    out = '\n'.join(lines)
    if nl == '\r\n':
        out = out.replace('\n', '\r\n')
    with open(path, 'w', encoding='utf-8', newline='') as fh:
        fh.write(out)
    print(f'{path.split("sdkwork-space/")[-1]}: services={len(headers)} added={added} anchor={"keep" if has_anchor else "inserted"}')

sys.exit(0)
