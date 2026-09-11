"""Insert `logging: *default-logging` directly after each service header that lacks it.

Keys are order-independent in YAML, so placing the key immediately after the
service header is safe and avoids block-boundary arithmetic. Processing runs
bottom-up so insertions never shift the indices still to be handled.
"""
import re
import sys

FILES = [
    '/mnt/e/sdkwork-space/sdkwork-birdcoder/deployments/docker/docker-compose.yml',
    '/mnt/e/sdkwork-space/sdkwork-forum/deployments/docker/docker-compose.yml',
    '/mnt/e/sdkwork-space/sdkwork-knowledgebase/docker-compose.yml',
]


def has_logging_after(lines, header_idx):
    for i in range(header_idx + 1, len(lines)):
        if re.match(r'^    \S', lines[i]):
            return bool(re.match(r'^    logging:', lines[i]))
        return False
    return False


for path in FILES:
    with open(path, encoding='utf-8', newline='') as fh:
        raw = fh.read()
    nl = '\r\n' if '\r\n' in raw else '\n'
    lines = raw.replace('\r\n', '\n').split('\n')
    try:
        start = next(i for i, l in enumerate(lines) if l.rstrip() == 'services:')
    except StopIteration:
        print(f'{path}: no services block'); continue
    headers = [i for i in range(start + 1, len(lines)) if re.match(r'^  [A-Za-z0-9_.-]+:\s*$', lines[i])]
    added = []
    for h in reversed(headers):
        if has_logging_after(lines, h):
            continue
        lines.insert(h + 1, '    logging: *default-logging')
        added.append(lines[h])
    out = '\n'.join(lines)
    if nl == '\r\n':
        out = out.replace('\n', '\r\n')
    with open(path, 'w', encoding='utf-8', newline='') as fh:
        fh.write(out)
    print(f'{path.split("sdkwork-space/")[-1]}: added to {[a.strip() for a in added]}')

sys.exit(0)
