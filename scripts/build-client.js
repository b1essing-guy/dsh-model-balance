/**
 * client 半边构建：把 src/client.js 里的 `// <<<INLINE:path>>>` 占位行替换成该文件的源码，
 * 产出**单文件** lib/client.js。
 *
 * 为什么必须单文件：浏览器侧经 `window.__ModuleLoader__.load({ id, factory })` 装配，
 * factory 拿到的 `require` 只认平台种子模块（react / react-dom / @deepseek-ai/*），
 * **不能解析相对 import**。host 半边则相反（正常 ESM，可直接 import 源码）。
 *
 * 为什么用「占位内联」而不是上打包器：本插件零运行时依赖、零构建依赖。一个 40 行的
 * 拼接脚本就能保证「算法只有一份实现」，引入 rolldown/tsdown 只会多一条会坏的链路。
 *
 * 构建期守卫（发现问题就**直接失败**，绝不静默产出坏产物）：
 *   1. 占位行必须全部被替换（有残留 → 报错）；
 *   2. 内联后的源码不得残留行首 `export ` / `import `（单文件里它们是语法错误）；
 *   3. 不得出现未被允许的 `require(...)`（只允许平台种子模块）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'src', 'client.js');
const OUT = join(ROOT, 'lib', 'client.js');

/** 允许在 client 产物里出现的 require 目标（平台种子模块） */
const ALLOWED_REQUIRE = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-ui-primitives',
];

const PLACEHOLDER = /^[ \t]*\/\/[ \t]*<<<INLINE:([^>]+?)>>>[ \t]*$/;

/** 行首 `export ` 去掉即可（本插件不用 export default / export {} 语法） */
function stripEsmExports(source, file) {
  const stripped = source
    .split(/\r?\n/)
    .map((line) => (line.startsWith('export ') ? line.slice('export '.length) : line))
    .join('\n');
  const bad = stripped.split(/\r?\n/).find((line) => /^(export|import)\b/.test(line));
  if (bad !== undefined) {
    throw new Error(relative(ROOT, file) + ' 内联后仍残留 ESM 语法，单文件产物无法加载：' + bad.trim());
  }
  return stripped;
}

function inline(source) {
  const used = new Set();
  const out = source
    .split(/\r?\n/)
    .map((line) => {
      const match = PLACEHOLDER.exec(line);
      if (match === null) return line;
      const target = resolve(ROOT, match[1]);
      if (!target.startsWith(ROOT)) throw new Error('内联目标越界：' + match[1]);
      used.add(match[1]);
      const body = stripEsmExports(readFileSync(target, 'utf8'), target);
      return '// ---- 内联：' + match[1] + ' ----\n' + body + '\n// ---- 内联结束：' + match[1] + ' ----';
    })
    .join('\n');
  return { out, used };
}

function assertNoResidualPlaceholder(source) {
  const leftover = source.split(/\r?\n/).filter((line) => PLACEHOLDER.test(line));
  if (leftover.length > 0) {
    throw new Error('占位行未被替换：' + leftover.join(' | '));
  }
}

function assertRequiresAllowed(source) {
  const found = new Set();
  for (const match of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) found.add(match[1]);
  const illegal = [...found].filter((name) => !ALLOWED_REQUIRE.includes(name));
  if (illegal.length > 0) {
    throw new Error('client 产物出现未允许的 require 目标（单文件里解析不到）：' + illegal.join(', '));
  }
}

const entrySource = readFileSync(ENTRY, 'utf8');
const { out, used } = inline(entrySource);
assertNoResidualPlaceholder(out);
assertRequiresAllowed(out);

const banner = [
  '// 本文件由 scripts/build-client.js 自动生成 —— 不要手改。',
  '// 源：src/client.js' + [...used].map((p) => ' + ' + p).join(''),
  '// 重跑：node scripts/build-client.js',
  '',
].join('\n');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, banner + out, 'utf8');

const bytes = Buffer.byteLength(banner + out, 'utf8');
console.log('[build-client] 产出 lib/client.js（' + bytes + ' bytes；内联 ' + used.size + ' 个文件）');
for (const name of used) console.log('  - 内联 ' + name);
