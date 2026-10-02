// 借展调拨业务规则冒烟测试：在 Node 里垫片 localStorage 后直跑 loan-service，
// 不依赖浏览器与测试框架。由 scripts/run-smoke.mjs 编译后调用 run()。
type Storage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  clear(): void
  key(index: number): string | null
  readonly length: number
}

function memStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => {
      map.delete(k)
    },
    setItem: (k, v) => {
      map.set(k, v)
    },
  }
}

function resetState() {
  ;(globalThis as { localStorage?: Storage }).localStorage = memStorage()
}

let passed = 0
let failed = 0

async function test(name: string, fn: () => Promise<void> | void) {
  resetState()
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failed += 1
    console.error(`  ✗ ${name}`)
    console.error(`    ${error instanceof Error ? error.message : String(error)}`)
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

export async function run(): Promise<void> {
  // 动态导入：确保拿到的是每次重置后的 localStorage 数据（local-store 有缓存）。
  const { loadRegister, shipLoan, retryLoan, returnLoan, setLoanDirection } = await import('../src/api/loan-service')
  const { listRows } = await import('../src/data/local-store')

  console.log('借展调拨册规则冒烟测试')

  await test('按借入单位分组，在展与待运分栏，方向未定单独挑出', () => {
    const view = loadRegister()
    const units = view.groups.map((g) => g.unit)
    assert(units.includes('省博物馆') && units.includes('市博物馆') && units.includes('区县文物管理所'), '三个借入单位分组缺失')
    const prov = view.groups.find((g) => g.unit === '省博物馆')!
    assert(prov.onDisplay.length === 2, `省博在展应 2 单，实际 ${prov.onDisplay.length}`)
    assert(prov.displayCount === 3, `省博在展应 3 件，实际 ${prov.displayCount}`)
    assert(prov.pending.length === 0, '方向未定单不应混入单位待运')
    assert(!prov.pending.find((r) => r['借展单号'] === 'LOAN-2026-008'), '方向未定单出现在待运')
    assert(view.undecided.map((r) => r['借展单号']).join() === 'LOAN-2026-008', '方向未定专区内容不符')
  })

  await test('同一件展品跨借入单位重复借出被挡下并写明原因', () => {
    const target = loadRegister().groups
      .find((g) => g.unit === '市博物馆')!.pending
      .find((r) => r['借展单号'] === 'LOAN-2026-003')!
    const res = shipLoan(Number(target.id))
    assert(!res.ok, '跨单位重复借出应被挡下')
    assert(res.message.includes('跨借入单位重复借出'), '原因未写明：缺少重复借出说明')
    assert(res.message.includes('省博物馆'), '原因未写明冲突单位')
  })

  await test('出库目标与借入单位打架被挡下并写明原因', () => {
    const target = loadRegister().groups
      .find((g) => g.unit === '市博物馆')!.pending
      .find((r) => r['借展单号'] === 'LOAN-2026-004')!
    const res = shipLoan(Number(target.id))
    assert(!res.ok, '目标打架应被挡下')
    assert(res.message.includes('目标场馆') && res.message.includes('打架'), '原因未写明目标与单位冲突')
  })

  await test('申请数超库存时按实物数出库并在备注说明', () => {
    const id = Number(loadRegister().groups
      .find((g) => g.unit === '市博物馆')!.pending
      .find((r) => r['借展单号'] === 'LOAN-2026-005')!.id)
    const res = shipLoan(id)
    assert(res.ok, `本应按实物数放行：${res.message}`)
    assert(res.message.includes('按实物数'), '未提示按实物数处理')
    const after = loadRegister().groups
      .find((g) => g.unit === '市博物馆')!.onDisplay
      .find((r) => r['借展单号'] === 'LOAN-2026-005')!
    assert(Number(after['已出库实物数']) === 2, '申请 3 件、库存 2 件，实物数应为 2')
    assert(String(after['备注']).includes('按实物数出库 2 件'), '备注未记录按实物数出库')
  })

  await test('方向未定先挡，补定方向后可出库', () => {
    const id = Number(loadRegister().undecided[0].id)
    const blocked = shipLoan(id)
    assert(!blocked.ok && blocked.message.includes('调拨方向未定'), '方向未定应先挡下')
    const set = setLoanDirection(id, '调出借展')
    assert(set.ok, '补定方向应成功')
    const res = shipLoan(id)
    assert(res.ok, `补定方向、目标匹配、库存充足，应出库成功：${res.message}`)
  })

  await test('出库失败允许再试一次；仍失败写备注，且不能第二次再试', () => {
    const id = Number(loadRegister().groups.find((g) => g.unit === '市博物馆')!.failed[0].id)
    const first = retryLoan(id)
    assert(!first.ok && (first.message.includes('无实物库存') || first.message.includes('库存为 0')), '无实物库存再试仍应失败并说明')
    const row = loadRegister().groups
      .find((g) => g.unit === '市博物馆')!.failed
      .find((r) => Number(r.id) === id)!
    assert(Number(row['出库失败次数']) === 1, '再试一次后失败次数应为 1')
    assert(String(row['备注']).includes('再试出库'), '再试与失败原因未写入备注')
    const second = retryLoan(id)
    assert(!second.ok && second.message.includes('不再重试'), '第二次再试应被拒绝')
  })

  await test('展陈清单与台账件数对不上时按已出库实物数计并标差异', () => {
    const link = loadRegister().links.find((l) => l.loan['借展单号'] === 'LOAN-2026-002')!
    assert(link.mismatch, '册录 2 件与实物 1 件应标为对不上')
    assert(link.catalogCount === 2 && link.physicalCount === 1, '对账数值错误')
  })

  await test('回运收尾回写出土物清单：待复核件数增加、置待复检、撤下展陈清单', () => {
    const id = Number(loadRegister().groups
      .find((g) => g.unit === '省博物馆')!.onDisplay
      .find((r) => r['借展单号'] === 'LOAN-2026-002')!.id)
    const res = returnLoan(id)
    assert(res.ok, `回运应成功：${res.message}`)
    const view = loadRegister()
    assert(view.stats.find((s) => s.label === '待复核件数')!.value === 4, '待复核件数应为原有 3 + 回运 1 = 4')
    const find1002 = listRows('find').find((r) => r['器物编号'] === 'FIND-1002')!
    assert(Number(find1002['待复核件数']) === 1, '出土物清单待复核件数未 +1')
    assert(find1002.status === '待复检', '出土物状态未置为待复检')
    const exhibit = listRows('exhibit').find((r) => r['关联借展单号'] === 'LOAN-2026-002')
    assert(!exhibit, '回运后展陈清单关联条目应撤下')
  })

  console.log(`\n结果：通过 ${passed} 项，失败 ${failed} 项`)
  if (failed > 0) {
    process.exitCode = 1
  }
}
