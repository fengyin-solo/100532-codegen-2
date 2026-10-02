import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// ─────────────────────────────────────────────
// 借展调拨：规则全部落在本层，页面只负责渲染与触发
// ─────────────────────────────────────────────

export const LOAN_KEY = 'loan'
export const FIND_KEY = 'find'
export const LOAN_STATUS_SHIPPING = '待运'
export const LOAN_STATUS_BLOCKED = '出库受阻'
export const LOAN_STATUS_ON_SHOW = '在展'
export const LOAN_STATUS_RETURNED = '已回运'

// 每个借入单位允许送达的展陈目标；出库时目标和借入单位对不上就挡下。
export const UNIT_TARGETS: Record<string, string[]> = {
  省博物馆: ['省博物馆第一展厅', '省博物馆第二展厅', '省博物馆文物库房'],
  市考古陈列馆: ['市考古陈列馆基本陈列', '市考古陈列馆临时展厅'],
  临展交流中心: ['临展交流中心恒温展柜', '临展交流中心巡展线'],
}

export type LoanGroup = {
  unit: string
  onShow: EntryRow[]
  shipping: EntryRow[]
}

export type LoanBoard = {
  groups: LoanGroup[]
  undirected: EntryRow[]
  returns: EntryRow[]
  review: { 器物编号: string; 器物类别: string; 待复核件数: number; 来源单号: string }[]
  stats: { label: string; value: number }[]
}

function todayText(): string {
  return new Date().toISOString().slice(0, 10)
}

function appendNote(row: EntryRow, note: string): string {
  const stamped = `${todayText()} ${note}`
  const old = String(row['备注'] ?? '').trim()
  return old ? `${old}；${stamped}` : stamped
}

function asCount(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function loanRows(): EntryRow[] {
  return listRows(LOAN_KEY)
}

function stockOf(code: string): { row: EntryRow | null; qty: number } {
  const row = listRows(FIND_KEY).find((item) => String(item['器物编号']) === code) ?? null
  return { row, qty: row ? asCount(row['在库件数']) : 0 }
}

function findLoan(id: number): { rows: EntryRow[]; index: number } {
  const rows = loanRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  return { rows, index }
}

/** 借展调拨册：按借入单位分组，组内分列在展/待运，方向待定与回运记录单独成区。 */
export function loadLoanBoard(): LoanBoard {
  const rows = loanRows()
  const undirected = rows.filter(
    (row) => String(row['调拨方向'] ?? '').trim() === '' && row.status !== LOAN_STATUS_RETURNED,
  )
  const returns = rows.filter((row) => row.status === LOAN_STATUS_RETURNED)

  const active = rows.filter(
    (row) => row.status !== LOAN_STATUS_RETURNED && String(row['调拨方向'] ?? '').trim() !== '',
  )
  const unitOrder: string[] = []
  for (const row of active) {
    const unit = String(row['借入单位'])
    if (!unitOrder.includes(unit)) {
      unitOrder.push(unit)
    }
  }
  const groups: LoanGroup[] = unitOrder.map((unit) => ({
    unit,
    onShow: active.filter(
      (row) => String(row['借入单位']) === unit && row.status === LOAN_STATUS_ON_SHOW,
    ),
    shipping: active.filter(
      (row) =>
        String(row['借入单位']) === unit &&
        (row.status === LOAN_STATUS_SHIPPING || row.status === LOAN_STATUS_BLOCKED),
    ),
  }))

  const returnedByCode = new Map<string, { qty: number; orders: string[] }>()
  for (const row of returns) {
    const code = String(row['展品编号'])
    const prev = returnedByCode.get(code) ?? { qty: 0, orders: [] }
    prev.qty += asCount(row['回运件数'])
    prev.orders.push(String(row['借展单号']))
    returnedByCode.set(code, prev)
  }
  const reviewRows = listRows(FIND_KEY).filter((row) => row.status === '待复检')
  const review = reviewRows.map((row) => {
    const back = returnedByCode.get(String(row['器物编号']))
    return {
      器物编号: String(row['器物编号']),
      器物类别: String(row['器物类别'] ?? ''),
      待复核件数: back ? back.qty : asCount(row['待复核件数']),
      来源单号: back ? back.orders.join('、') : '—',
    }
  })

  const stats = [
    { label: '在展条目', value: rows.filter((row) => row.status === LOAN_STATUS_ON_SHOW).length },
    {
      label: '待运条目',
      value: rows.filter(
        (row) => row.status === LOAN_STATUS_SHIPPING || row.status === LOAN_STATUS_BLOCKED,
      ).length,
    },
    { label: '方向待定条目', value: undirected.length },
    {
      label: '出土物待复核件数',
      value: review.reduce((sum, item) => sum + item.待复核件数, 0),
    },
    {
      label: '在展品总件数',
      value: rows
        .filter((row) => row.status === LOAN_STATUS_ON_SHOW)
        .reduce((sum, row) => sum + asCount(row['实物出库件数']), 0),
    },
    { label: '已回运条目', value: returns.length },
  ]

  return { groups, undirected, returns, review, stats }
}

/** 方向待定的条目先补方向，补完回到待运队列等出库。 */
export function setLoanDirection(id: number, direction: string): ActionResult {
  const target = direction.trim()
  if (!target) {
    return { ok: false, message: '请先选定调拨方向' }
  }
  const { rows, index } = findLoan(id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的借展调拨单` }
  }
  const row = rows[index]
  if (row.status === LOAN_STATUS_ON_SHOW || row.status === LOAN_STATUS_RETURNED) {
    return { ok: false, message: '该条目已出库，调拨方向不能再改' }
  }
  const unit = String(row['借入单位'])
  const allowed = UNIT_TARGETS[unit] ?? []
  if (allowed.length > 0 && !allowed.includes(target)) {
    return {
      ok: false,
      message: `「${target}」不在${unit}的允许目标内，目标与借入单位打架，不能定这个方向`,
    }
  }
  const next = [...rows]
  next[index] = {
    ...row,
    调拨方向: target,
    status: LOAN_STATUS_SHIPPING,
    pending: true,
    abnormal: false,
    备注: appendNote(row, `调拨方向定为${target}`),
  }
  saveRows(LOAN_KEY, next)
  return { ok: true, message: `调拨方向已定为「${target}」，条目回到待运队列` }
}

/**
 * 办理出库，按顺序挡：
 * 1) 没定方向；2) 目标与借入单位打架；3) 同一件展品跨单位重复借出；
 * 4) 库存不足——不报错，按实物在库数出库并写明。
 * 出库失败的记录只允许再试一次（共两次尝试），失败原因写进备注。
 */
export function shipLoan(id: number): ActionResult {
  const { rows, index } = findLoan(id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的借展调拨单` }
  }
  const row = rows[index]

  if (row.status === LOAN_STATUS_ON_SHOW) {
    return { ok: false, message: '该条目已出库在展，不用重复操作' }
  }
  if (row.status === LOAN_STATUS_RETURNED) {
    return { ok: false, message: '该条目已回运收尾，不能再出库' }
  }

  const attempts = asCount(row['出库尝试次数'])

  // 出库失败的记录只允许再试一次：两次尝试都失败就只能人工核查。
  if (attempts >= 2) {
    return { ok: false, message: '该条目已两次出库失败，不允许再试，请走人工核查' }
  }

  const block = (reason: string): ActionResult => {
    const next = [...rows]
    next[index] = {
      ...row,
      status: LOAN_STATUS_BLOCKED,
      pending: true,
      abnormal: true,
      出库尝试次数: attempts + 1,
      备注: appendNote(row, `出库受阻：${reason}${attempts === 0 ? '，可再试一次' : '，两次尝试均失败，转人工核查'}`),
    }
    saveRows(LOAN_KEY, next)
    return { ok: false, message: `出库被挡下：${reason}` }
  }

  const direction = String(row['调拨方向'] ?? '').trim()
  if (!direction) {
    return { ok: false, message: '调拨方向还没定，请先选定方向再出库' }
  }

  const unit = String(row['借入单位'])
  const allowed = UNIT_TARGETS[unit] ?? []
  if (allowed.length > 0 && !allowed.includes(direction)) {
    return block(`调拨目标「${direction}」不属于${unit}，目标与借入单位打架`)
  }

  const code = String(row['展品编号'])
  const cross = rows.find(
    (other) =>
      Number(other.id) !== Number(row.id) &&
      String(other['展品编号']) === code &&
      other.status === LOAN_STATUS_ON_SHOW &&
      String(other['借入单位']) !== unit,
  )
  if (cross) {
    return block(
      `同一件展品已借给${String(cross['借入单位'])}（单号${String(cross['借展单号'])}）在展，不许跨借入单位重复借出`,
    )
  }

  const requested = asCount(row['申报件数'])
  if (requested <= 0) {
    return block('申报件数不是有效数量，无法出库')
  }

  const { row: findRow, qty: stock } = stockOf(code)
  if (stock <= 0) {
    return block(`展品${code}在库件数为0，无实物可出`)
  }

  const shipped = Math.min(requested, stock)
  const clamped = shipped < requested
  const next = [...rows]
  next[index] = {
    ...row,
    status: LOAN_STATUS_ON_SHOW,
    pending: false,
    abnormal: clamped,
    实物出库件数: shipped,
    出库尝试次数: attempts + 1,
    // 展陈清单与借出台账关联：件数对不上时以已出库实物数为准。
    展陈登记件数: shipped,
    回运件数: 0,
    备注: appendNote(
      row,
      clamped
        ? `申报${requested}件、在库仅${stock}件，按实物数${shipped}件出库，展陈登记以实物数为准`
        : `按实物数${shipped}件点交出库`,
    ),
  }
  saveRows(LOAN_KEY, next)

  if (findRow) {
    const finds = listRows(FIND_KEY)
    const findIndex = finds.findIndex((item) => Number(item.id) === Number(findRow.id))
    if (findIndex >= 0) {
      const updated: EntryRow = {
        ...finds[findIndex],
        在库件数: Math.max(0, stock - shipped),
      }
      const nextFinds = [...finds]
      nextFinds[findIndex] = updated
      saveRows(FIND_KEY, nextFinds)
    }
  }

  return {
    ok: true,
    message: clamped
      ? `已按实物数出库${shipped}件（申报${requested}件、在库仅${stock}件），差额原因已写入备注`
      : `已按实物数出库${shipped}件，条目转入在展`,
  }
}

/**
 * 确认回运：按在展实物数点收入库，回运结果反映到出土物清单——
 * 对应出土物置为「待复检」并累计待复核件数；清单里没有的展品补登一条。
 */
export function returnLoan(id: number): ActionResult {
  const { rows, index } = findLoan(id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的借展调拨单` }
  }
  const row = rows[index]
  if (row.status !== LOAN_STATUS_ON_SHOW) {
    return { ok: false, message: '只有在展条目才能办理回运收尾' }
  }

  const shipped = asCount(row['实物出库件数'])
  const backQty = shipped > 0 ? shipped : asCount(row['申报件数'])
  if (backQty <= 0) {
    return { ok: false, message: '该条目没有已出库实物，无法办理回运' }
  }

  const next = [...rows]
  next[index] = {
    ...row,
    status: LOAN_STATUS_RETURNED,
    pending: false,
    abnormal: false,
    实际回运日: todayText(),
    回运件数: backQty,
    备注: appendNote(row, `回运点收入库${backQty}件，出土物已转待复检`),
  }
  saveRows(LOAN_KEY, next)

  const code = String(row['展品编号'])
  const finds = listRows(FIND_KEY)
  const findIndex = finds.findIndex((item) => String(item['器物编号']) === code)
  if (findIndex >= 0) {
    const current = finds[findIndex]
    const updated: EntryRow = {
      ...current,
      status: '待复检',
      pending: true,
      在库件数: asCount(current['在库件数']) + backQty,
      待复核件数: asCount(current['待复核件数']) + backQty,
      登记状态: '待复检',
    }
    const nextFinds = [...finds]
    nextFinds[findIndex] = updated
    saveRows(FIND_KEY, nextFinds)
  } else {
    const nextId = finds.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
    const created: EntryRow = {
      id: nextId,
      status: '待复检',
      pending: true,
      abnormal: false,
      器物编号: code,
      出土探方: '—',
      出土层位: '—',
      器物类别: String(row['展品名称'] ?? '借展回展品'),
      质地: '—',
      完残程度: '—',
      最大尺寸: '—',
      登记状态: '待复检',
      在库件数: backQty,
      待复核件数: backQty,
    }
    saveRows(FIND_KEY, [...finds, created])
  }

  return { ok: true, message: `已回运点收${backQty}件，出土物「${code}」已转待复检` }
}
