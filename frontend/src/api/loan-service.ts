import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 借展调拨册的全部业务判断都收在这里：页面只渲染、不做判断，符合本仓库
// 「状态流转只允许在 service 里改」的约定。借展台账用 loan，展陈清单用
// exhibit，回运结果回写到出土物 find 的「待复核件数」。
const LOAN_KEY = 'loan'
const FIND_KEY = 'find'
const EXHIBIT_KEY = 'exhibit'

export const LOAN_STATUSES = ['待运', '在展', '已回运', '出库失败'] as const
export const DIRECTIONS = ['调出借展', '回运退库'] as const

export type LoanGroupView = {
  unit: string
  onDisplay: EntryRow[]
  pending: EntryRow[]
  returned: EntryRow[]
  failed: EntryRow[]
  displayCount: number
}

export type ExhibitLink = {
  loan: EntryRow
  exhibit: EntryRow | undefined
  catalogCount: number
  physicalCount: number
  mismatch: boolean
}

export type LoanRegisterView = {
  groups: LoanGroupView[]
  undecided: EntryRow[]
  links: ExhibitLink[]
  stats: { label: string; value: number }[]
}

function num(value: string | number | boolean | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function listLoans(): EntryRow[] {
  return listRows(LOAN_KEY)
}

function physicalCount(row: EntryRow): number {
  return num(row['已出库实物数'])
}

// 同一件展品当前真正被借出（已出库、且还在展）的实物总数。
function loanedOut(code: string, excludeId?: number): number {
  return listLoans()
    .filter((row) => String(row['展品编号'] ?? '') === code)
    .filter((row) => Number(row.id) !== excludeId)
    .filter((row) => String(row.status) === '在展')
    .reduce((sum, row) => sum + physicalCount(row), 0)
}

function stockOf(code: string): number {
  const hit = listRows(FIND_KEY).find((row) => String(row['器物编号'] ?? '') === code)
  return hit ? num(hit['库存件数']) : 0
}

function appendRemark(row: EntryRow, note: string): string {
  const prev = String(row['备注'] ?? '').trim()
  return prev ? `${prev}；${note}` : note
}

// 出库后在展陈清单里留一条关联记录（在展台账 ↔ 展陈清单两处对应同一借展单号）。
function upsertExhibit(loan: EntryRow): void {
  const rows = listRows(EXHIBIT_KEY)
  const code = String(loan['借展单号'] ?? '')
  const index = rows.findIndex((row) => String(row['关联借展单号'] ?? '') === code)
  const next: EntryRow = {
    id: loan.id as number,
    status: '在展',
    pending: true,
    abnormal: false,
    展陈编号: `EXH-${String(loan.id).padStart(4, '0')}`,
    关联借展单号: code,
    展品编号: loan['展品编号'] ?? '',
    展品名称: loan['展品名称'] ?? '',
    展出场馆: loan['目标场馆'] ?? '',
    借入单位: loan['借入单位'] ?? '',
    // 册录件数沿用台账；两处件数对不上时，对账一律以已出库实物数为准。
    展陈件数: physicalCount(loan),
  }
  if (index >= 0) {
    rows[index] = { ...rows[index], ...next }
  } else {
    rows.push(next)
  }
  saveRows(EXHIBIT_KEY, rows)
}

function removeExhibit(loanNo: string): void {
  const rows = listRows(EXHIBIT_KEY).filter((row) => String(row['关联借展单号'] ?? '') !== loanNo)
  saveRows(EXHIBIT_KEY, rows)
}

type Mutable = { row: EntryRow; index: number; all: EntryRow[] }

function locate(id: number): Mutable | undefined {
  const all = listLoans()
  const index = all.findIndex((row) => Number(row.id) === id)
  return index >= 0 ? { row: all[index], index, all } : undefined
}

function persist(where: Mutable): void {
  saveRows(LOAN_KEY, where.all)
}

// 出库前的三道硬关口：方向必须已定、目标场馆必须归属借入单位、同一件展品不得跨单位重复借出。
function preOutboundChecks(row: EntryRow): ActionResult | null {
  const direction = String(row['调拨方向'] ?? '').trim()
  if (!direction) {
    return { ok: false, message: `借展单 ${row['借展单号']} 调拨方向未定，先补定方向再出库` }
  }
  const unit = String(row['借入单位'] ?? '')
  const target = String(row['目标场馆'] ?? '').trim()
  if (target && !target.startsWith(unit)) {
    return {
      ok: false,
      message: `借展单 ${row['借展单号']} 已挡下：目标场馆「${target}」不归属借入单位「${unit}」，出库目标与借入单位打架`,
    }
  }
  const code = String(row['展品编号'] ?? '')
  const conflict = listLoans().find(
    (other) =>
      Number(other.id) !== Number(row.id) &&
      String(other['展品编号'] ?? '') === code &&
      String(other['借入单位'] ?? '') !== unit &&
      physicalCount(other) > 0 &&
      String(other.status) === '在展',
  )
  if (conflict) {
    return {
      ok: false,
      message: `借展单 ${row['借展单号']} 已挡下：展品 ${code} 已由「${conflict['借入单位']}」凭单 ${conflict['借展单号']} 借出 ${physicalCount(conflict)} 件，同一件展品不许跨借入单位重复借出`,
    }
  }
  return null
}

// 真正出库：数量与库存冲突时按实物数处理（能出多少出多少，一件都没有就记失败）。
function doOutbound(where: Mutable, isRetry: boolean): ActionResult {
  const { row } = where
  const blocked = preOutboundChecks(row)
  if (blocked) {
    return blocked
  }
  const code = String(row['展品编号'] ?? '')
  const available = stockOf(code) - loanedOut(code, Number(row.id))
  const apply = num(row['申请件数'])
  if (available <= 0) {
    where.all[where.index] = {
      ...row,
      status: '出库失败',
      pending: true,
      abnormal: true,
      出库失败次数: isRetry ? 1 : num(row['出库失败次数']),
      备注: appendRemark(row, `出库失败：展品 ${code} 库存为 0（已被借出 ${loanedOut(code, Number(row.id))} 件），无实物可出，按实物数 0 件处理`),
    }
    persist(where)
    return { ok: false, message: `借展单 ${row['借展单号']} 出库失败：展品 ${code} 无实物库存，失败原因已写入备注` }
  }
  const qty = Math.min(apply, available)
  const clipped = qty < apply
  where.all[where.index] = {
    ...row,
    status: '在展',
    pending: true,
    abnormal: false,
    已出库实物数: qty,
    备注: clipped
      ? appendRemark(row, `申请 ${apply} 件但库存仅可出 ${available} 件，按实物数出库 ${qty} 件`)
      : row['备注'],
  }
  persist(where)
  upsertExhibit(where.all[where.index])
  return {
    ok: true,
    message: clipped
      ? `借展单 ${row['借展单号']} 已出库 ${qty} 件（申请 ${apply} 件，库存冲突，按实物数处理）`
      : `借展单 ${row['借展单号']} 已出库 ${qty} 件，当前在展`,
  }
}

export function shipLoan(id: number): ActionResult {
  const where = locate(id)
  if (!where) {
    return { ok: false, message: `没有找到编号为 ${id} 的借展调拨单` }
  }
  if (String(where.row.status) !== '待运') {
    return { ok: false, message: `借展单 ${where.row['借展单号']} 当前为「${where.row.status}」，不是待运，不能办理出库` }
  }
  return doOutbound(where, false)
}

// 出库失败允许再试一次；第二次仍失败就不再放行。
export function retryLoan(id: number): ActionResult {
  const where = locate(id)
  if (!where) {
    return { ok: false, message: `没有找到编号为 ${id} 的借展调拨单` }
  }
  if (String(where.row.status) !== '出库失败') {
    return { ok: false, message: `借展单 ${where.row['借展单号']} 不是出库失败状态，不能再试` }
  }
  if (num(where.row['出库失败次数']) >= 1) {
    return { ok: false, message: `借展单 ${where.row['借展单号']} 已再试过一次仍失败，不再重试，请核对实物库存（见备注）` }
  }
  const tagged: Mutable = {
    ...where,
    row: { ...where.row, 出库失败次数: 1, 备注: appendRemark(where.row, '按规定再试出库一次') },
  }
  tagged.all[tagged.index] = tagged.row
  const result = doOutbound(tagged, true)
  if (result.ok) {
    const cleared = tagged.all[tagged.index]
    tagged.all[tagged.index] = { ...cleared, abnormal: false }
    saveRows(LOAN_KEY, tagged.all)
    upsertExhibit(tagged.all[tagged.index])
  }
  return result
}

export function setLoanDirection(id: number, direction: string): ActionResult {
  const where = locate(id)
  if (!where) {
    return { ok: false, message: `没有找到编号为 ${id} 的借展调拨单` }
  }
  if (String(where.row['调拨方向'] ?? '').trim()) {
    return { ok: false, message: `借展单 ${where.row['借展单号']} 调拨方向已定，不用重复登记` }
  }
  if (!DIRECTIONS.includes(direction as (typeof DIRECTIONS)[number])) {
    return { ok: false, message: `调拨方向只能是「${DIRECTIONS.join('」或「')}」` }
  }
  where.all[where.index] = { ...where.row, 调拨方向: direction }
  persist(where)
  return { ok: true, message: `借展单 ${where.row['借展单号']} 调拨方向已补定为「${direction}」` }
}

// 回运收尾：回写出土物清单（待复核件数累加、置为待复检），并撤下展陈清单里的关联条目。
export function returnLoan(id: number): ActionResult {
  const where = locate(id)
  if (!where) {
    return { ok: false, message: `没有找到编号为 ${id} 的借展调拨单` }
  }
  if (String(where.row.status) !== '在展') {
    return { ok: false, message: `借展单 ${where.row['借展单号']} 当前为「${where.row.status}」，尚未在展，不能登记回运` }
  }
  const qty = physicalCount(where.row)
  const code = String(where.row['展品编号'] ?? '')
  const finds = listRows(FIND_KEY)
  const findIndex = finds.findIndex((row) => String(row['器物编号'] ?? '') === code)
  if (findIndex >= 0) {
    const current = finds[findIndex]
    finds[findIndex] = {
      ...current,
      待复核件数: num(current['待复核件数']) + qty,
      status: '待复检',
      pending: true,
    }
    saveRows(FIND_KEY, finds)
  }
  const loanNo = String(where.row['借展单号'] ?? '')
  where.all[where.index] = {
    ...where.row,
    status: '已回运',
    pending: false,
    abnormal: false,
    备注: appendRemark(where.row, `已回运 ${qty} 件，结果同步出土物清单，待复核件数 +${qty}`),
  }
  persist(where)
  removeExhibit(loanNo)
  return { ok: true, message: `借展单 ${loanNo} 已回运 ${qty} 件，出土物清单待复核件数 +${qty}` }
}

// 借出台账（在展记录）与展陈清单的对账：两处件数对不上时按已出库实物数算。
function buildLinks(loans: EntryRow[]): ExhibitLink[] {
  const exhibits = listRows(EXHIBIT_KEY)
  return loans
    .filter((row) => String(row.status) === '在展')
    .map((loan) => {
      const exhibit = exhibits.find((row) => String(row['关联借展单号'] ?? '') === String(loan['借展单号'] ?? ''))
      const physicalQty = physicalCount(loan)
      const catalogCount = exhibit ? num(exhibit['展陈件数']) : 0
      return {
        loan,
        exhibit,
        catalogCount,
        physicalCount: physicalQty,
        mismatch: !exhibit || catalogCount !== physicalQty,
      }
    })
}

export function loadRegister(): LoanRegisterView {
  const loans = listLoans()
  const units = [...new Set(loans.map((row) => String(row['借入单位'] ?? '未填单位')))]
  const groups: LoanGroupView[] = units
    .map((unit) => {
      const own = loans.filter((row) => String(row['借入单位'] ?? '未填单位') === unit)
      const onDisplay = own.filter((row) => String(row.status) === '在展')
      // 方向未定的已单独挑出（undecided），这里不再重复计入待运。
      const pending = own.filter(
        (row) => String(row.status) === '待运' && String(row['调拨方向'] ?? '').trim(),
      )
      return {
        unit,
        onDisplay,
        pending,
        returned: own.filter((row) => String(row.status) === '已回运'),
        failed: own.filter((row) => String(row.status) === '出库失败'),
        displayCount: onDisplay.reduce((sum, row) => sum + physicalCount(row), 0),
      }
    })
    .sort((a, b) => a.unit.localeCompare(b.unit, 'zh-Hans-CN'))

  const undecided = loans.filter(
    (row) => !String(row['调拨方向'] ?? '').trim() && String(row.status) !== '已回运',
  )
  const links = buildLinks(loans)
  const pendingReview = listRows(FIND_KEY).reduce((sum, row) => sum + num(row['待复核件数']), 0)
  const stats = [
    { label: '在展件数', value: groups.reduce((sum, group) => sum + group.displayCount, 0) },
    { label: '待运条目', value: groups.reduce((sum, group) => sum + group.pending.length, 0) },
    { label: '待复核件数', value: pendingReview },
    { label: '出库失败', value: groups.reduce((sum, group) => sum + group.failed.length, 0) },
    { label: '方向未定', value: undecided.length },
  ]
  return { groups, undecided, links, stats }
}

export function exportLoans(): { filename: string; content: string } {
  const header = ['借展单号', '借入单位', '展品编号', '展品名称', '申请件数', '已出库实物数', '调拨方向', '目标场馆', '预计回运日', '册录状态', '备注']
  const lines = [header.join(',')]
  for (const row of listLoans()) {
    lines.push(
      header
        .map((field) => (field === '册录状态' ? row.status : String(row[field] ?? (field === '调拨方向' ? '未定' : ''))))
        .join(','),
    )
  }
  return { filename: '借展调拨册.csv', content: `﻿${lines.join('\n')}` }
}

export function downloadLoans(): void {
  const { filename, content } = exportLoans()
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
