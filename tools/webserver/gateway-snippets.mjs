// Shared gateway location snippets — one copy per module, referenced by server.include.

import fs from 'node:fs';
import path from 'node:path';

export const GATEWAY_SNIPPET_PATHS = {
  production: 'snippets/gateway-locations.production.conf',
  apiProduction: 'snippets/gateway-api-locations.production.conf',
  nonproduction: 'snippets/gateway-locations.nonproduction.conf',
};

const PROXY_HEADERS = [
  'Host $host',
  'X-Real-IP $remote_addr',
  'X-Forwarded-For $proxy_add_x_forwarded_for',
  'X-Forwarded-Proto $scheme',
];

const PROXY_HEADERS_LITE = [
  'Host $host',
  'X-Forwarded-For $proxy_add_x_forwarded_for',
  'X-Forwarded-Proto $scheme',
];

export const TLS_DEFAULTS = {
  protocols: ['TLSv1.2', 'TLSv1.3'],
  preferServerCiphers: true,
  sessionCache: 'shared:SSL:10m',
};

function headerLines(environment) {
  return [
    `# Gateway location snippet (${environment}) — SDKWORK_WEBSERVER_SPEC.md §2.4`,
    '# Referenced from server.include; do not edit locations inline in environment files.',
    '',
  ];
}

function locationBlock(match, lines) {
  return [`    location ${match} {`, ...lines.map((line) => `        ${line}`), '    }', ''];
}

export function gatewayLocationSnippetContent(tier) {
  const production = tier === 'production';
  const lines = headerLines(tier);

  if (production) {
    for (const probe of ['/healthz', '/readyz']) {
      lines.push(...locationBlock(`= ${probe}`, [
        'proxy_pass http://gateway;',
        'proxy_http_version 1.1;',
        'proxy_set_header Host $host;',
      ]));
    }
  }

  lines.push(...locationBlock('/api/', [
    'proxy_pass http://gateway;',
    'proxy_http_version 1.1;',
    ...PROXY_HEADERS_LITE.map((header) => `proxy_set_header ${header};`),
  ]));

  const rootHeaders = production ? PROXY_HEADERS : PROXY_HEADERS_LITE;
  lines.push(...locationBlock('/', [
    'proxy_pass http://gateway;',
    'proxy_http_version 1.1;',
    ...rootHeaders.map((header) => `proxy_set_header ${header};`),
    'proxy_buffering off;',
    production ? 'proxy_read_timeout 120s;' : 'proxy_read_timeout 300s;',
    ...(production ? ['proxy_send_timeout 120s;'] : []),
  ]));

  return `${lines.join('\n').trimEnd()}\n`;
}

/** Production API + health probes only (Adaptive Web modules serve `/` on edge). */
export function gatewayApiLocationSnippetContent() {
  const lines = [
    ...headerLines('api-production'),
    '# Serves /healthz, /readyz, and /api/ only; location / uses Adaptive Web dispatch.',
    '',
  ];

  for (const probe of ['/healthz', '/readyz']) {
    lines.push(...locationBlock(`= ${probe}`, [
      'proxy_pass http://gateway;',
      'proxy_http_version 1.1;',
      'proxy_set_header Host $host;',
    ]));
  }

  lines.push(...locationBlock('/api/', [
    'proxy_pass http://gateway;',
    'proxy_http_version 1.1;',
    ...PROXY_HEADERS_LITE.map((header) => `proxy_set_header ${header};`),
    'proxy_buffering off;',
  ]));

  return `${lines.join('\n').trimEnd()}\n`;
}

export function gatewaySnippetInclude(environment) {
  return environment === 'production'
    ? GATEWAY_SNIPPET_PATHS.production
    : GATEWAY_SNIPPET_PATHS.nonproduction;
}

export function writeGatewaySnippets(webserverDir, { adaptiveWeb = false } = {}) {
  const snippetsDir = path.join(webserverDir, 'snippets');
  fs.mkdirSync(snippetsDir, { recursive: true });
  const files = [
    ['gateway-locations.production.conf', 'production'],
    ['gateway-locations.nonproduction.conf', 'nonproduction'],
  ];
  for (const [name, tier] of files) {
    fs.writeFileSync(path.join(snippetsDir, name), gatewayLocationSnippetContent(tier));
  }
  const apiSnippetPath = path.join(snippetsDir, 'gateway-api-locations.production.conf');
  if (adaptiveWeb) {
    fs.writeFileSync(apiSnippetPath, gatewayApiLocationSnippetContent());
  } else if (fs.existsSync(apiSnippetPath)) {
    fs.rmSync(apiSnippetPath);
  }
}
