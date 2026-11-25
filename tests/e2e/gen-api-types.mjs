import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * 从 backend/openapi.json 生成前端类型。
 *
 *   node gen-api-types.mjs           写入 view/src/app/core/api-types.ts
 *   node gen-api-types.mjs --check   只校验是否最新
 */
const root = resolve(import.meta.dirname, '../..');
const input = join(root, 'backend/openapi.json');
const output = join(root, 'view/src/app/core/api-types.ts');
const cli = join(import.meta.dirname, '../node_modules/openapi-typescript/bin/cli.js');
const check = process.argv.includes('--check');
const tmp = mkdtempSync(join(tmpdir(), 'api-types-'));

try {
  const generated = join(tmp, 'api-types.ts');
  execFileSync(process.execPath, [cli, input, '-o', generated], { stdio: 'inherit' });
  const body = readFileSync(generated, 'utf8');
  const text = `// AUTO-GENERATED from backend/openapi.json. Do not edit by hand.\n// run: cd tests && npm run api:types\n${body}`;

  if (check) {
    if (!existsSync(output) || readFileSync(output, 'utf8') !== text) {
      console.error('前端 API 类型已过期，运行：cd tests && npm run api:types');
      process.exit(1);
    }
    console.log('API 类型与 openapi.json 一致。');
  } else {
    writeFileSync(output, text, 'utf8');
    console.log(`已生成 ${output}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
