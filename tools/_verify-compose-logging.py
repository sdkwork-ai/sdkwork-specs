"""Validate that every edited compose file parses and every service carries logging."""
import glob
import os
import sys

import yaml

ROOTS = [
    'sdkwork-agentstudio/deployments/docker',
    'sdkwork-audio/deployments/docker',
    'sdkwork-birdcoder/deployments/docker',
    'sdkwork-deployments/deployments/docker',
    'sdkwork-dezhou/deployments/templates',
    'sdkwork-forum/deployments/docker',
    'sdkwork-games/deployments/templates',
    'sdkwork-kernel/deployments/docker',
    'sdkwork-prompts/deployments/docker',
    'sdkwork-rtc/deployments/docker',
]
EXTRA = [
    'sdkwork-drive/deployments/docker-compose.minio-test.yml',
    'sdkwork-knowledgebase/docker-compose.yml',
    'sdkwork-local-router/docker-compose.yml',
    'sdkwork-tts/docker-compose.yml',
]

files = []
for r in ROOTS:
    files += sorted(glob.glob(f'/mnt/e/sdkwork-space/{r}/*.yml'))
files += [f'/mnt/e/sdkwork-space/{p}' for p in EXTRA]

bad = 0
for f in files:
    try:
        doc = yaml.safe_load(open(f, encoding='utf-8'))
    except Exception as exc:  # noqa: BLE001
        print(f'PARSE-FAIL {f}: {exc}')
        bad += 1
        continue
    svcs = (doc or {}).get('services') or {}
    if not svcs:
        continue
    missing = [n for n, b in svcs.items() if 'logging' not in (b or {})]
    flag = 'OK ' if not missing else 'BAD'
    if missing:
        bad += 1
    print(f'{flag} {os.path.relpath(f, "/mnt/e/sdkwork-space")} services={len(svcs)} missing={missing}')
print('failures:', bad)
sys.exit(1 if bad else 0)
