// 借展调拨业务规则冒烟测试（无第三方测试框架）。
// 运行：node scripts/run-smoke.mjs（内部用仓库自带 esbuild 即时编译 TS 并解析 @ 别名）
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { writeFileSync, rmSync } from 'node:fs'

const smokePath = new URL('./smoke-loan.ts', import.meta.url).pathname
const entry = `
import { run } from ${JSON.stringify(smokePath)}
run()
`
writeFileSync('/tmp/smoke-entry.ts', entry)

const result = await build({
  entryPoints: ['/tmp/smoke-entry.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  alias: { '@': new URL('../src/', import.meta.url).pathname },
})
const code = result.outputFiles[0].text
writeFileSync('/tmp/smoke-bundle.mjs', code)
await import(pathToFileURL('/tmp/smoke-bundle.mjs').href)
rmSync('/tmp/smoke-entry.ts', { force: true })
