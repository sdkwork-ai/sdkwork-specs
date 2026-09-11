import assert from 'node:assert/strict';
import test from 'node:test';

import { GNU_RULES } from './check-shell-portability.mjs';

function ruleFor(fragment) {
  const rule = GNU_RULES.find((r) => r.issue.includes(fragment));
  assert.ok(rule, `no GNU rule mentions ${fragment}`);
  return rule.pattern;
}

// Regression: `--connect-timeout N` / `--retry-max-time N` are curl options that
// behave identically on macOS. The GNU `timeout` rule used to match the
// `-timeout`/`max-time` tail of those flags, so every ordinary download helper
// in the fleet reported phantom GNU-coreutils findings.
test('the GNU timeout rule ignores curl transfer options', () => {
  const pattern = ruleFor('timeout N (GNU coreutils)');
  for (const line of [
    'curl --fail --connect-timeout 10 --max-time 30 --retry-max-time 120 -o out url',
    '    --connect-timeout 10 --max-time 300 --speed-limit 1024 \\\\',
    'local timeout_ms=5000',
  ]) {
    assert.equal(pattern.test(line), false, `should not flag: ${line}`);
  }
});

test('the GNU timeout rule still catches the GNU command', () => {
  const pattern = ruleFor('timeout N (GNU coreutils)');
  for (const line of [
    'timeout 30 "$cmd"',
    '$(timeout 5 ssh -o BatchMode=yes "$host" true)',
    'timeout -k 5 30 pnpm install',
  ]) {
    assert.equal(pattern.test(line), true, `should flag: ${line}`);
  }
});

test('the sha256sum rule keeps flagging the bare GNU tool', () => {
  const pattern = ruleFor('sha256sum (GNU coreutils)');
  assert.equal(pattern.test("printf '%s  %s\\n' \"$sum\" \"$file\" | sha256sum --check -"), true);
  assert.equal(pattern.test('checksum=$(sha256sum "$file" | awk \'{print $1}\')'), true);
});
