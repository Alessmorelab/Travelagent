import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const check = fileURLToPath(new URL('../scripts/check-config.cjs', import.meta.url));

test('真机构建拒绝空地址、本机地址和带凭据的配置，错误信息不回显输入', () => {
  for (const value of [undefined, '  ', 'http://travel.example.org', 'https://127.0.0.1', 'https://localhost',
    'https://travel.example.org/api?key=fixture-private', 'https://fixture-private@travel.example.org', 'https://travel.example.org/#fixture-private']) {
    const env = { ...process.env };
    if (value === undefined) delete env.ROAM_API_URL;
    else env.ROAM_API_URL = value;
    const result = spawnSync(process.execPath, [check, '--require-api-url'], { env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ROAM_API_URL/);
    assert.doesNotMatch(result.stderr + result.stdout, /fixture-private/);
  }
});
