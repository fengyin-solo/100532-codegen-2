<template>
  <section class="page" data-module="loan">
    <header class="page-head">
      <div>
        <h2>借展调拨册</h2>
        <p class="page-desc">按借入单位分组管理借展调拨，卡住跨单位重复借出与目标冲突；出库按实物数核账，回运结果联动出土物待复核清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出借展调拨册</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in board.stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p v-if="flash" class="flash" :class="flashOk ? 'flash-ok' : 'flash-err'">{{ flash }}</p>

    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 借展调拨册：方向待定单独挑出，其余按借入单位分组，组内在展/待运分列 -->
    <div v-if="activeTab === 'board'">
      <section v-if="board.undirected.length" class="warn-block">
        <h3 class="block-title">调拨方向待定（{{ board.undirected.length }} 条）</h3>
        <p class="block-tip">下列条目还没定调拨方向，先定方向才能办理出库。</p>
        <table class="data-table">
          <thead>
            <tr>
              <th>借展单号</th><th>借入单位</th><th>展品编号</th><th>展品名称</th>
              <th>展品件数</th><th>调拨方向</th><th>预计回运日</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in board.undirected" :key="String(row.id)">
              <td>{{ row['借展单号'] }}</td>
              <td>{{ row['借入单位'] }}</td>
              <td>{{ row['展品编号'] }}</td>
              <td>{{ row['展品名称'] }}</td>
              <td>{{ row['申报件数'] }}</td>
              <td>
                <select :value="''" @change="changeDirection(row, selectValue($event))">
                  <option value="" disabled>待选定方向…</option>
                  <option v-for="target in targetOptions(row)" :key="target" :value="target">{{ target }}</option>
                </select>
              </td>
              <td>{{ row['预计回运日'] }}</td>
              <td class="row-actions"><span class="tag tag-pending">待定向</span></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-for="group in board.groups" :key="group.unit" class="unit-group">
        <header class="group-head">
          <h3>{{ group.unit }}</h3>
          <span class="group-count">在展 {{ group.onShow.length }} 条 · 待运 {{ group.shipping.length }} 条</span>
        </header>

        <h4 class="subhead">在展（{{ group.onShow.length }}）</h4>
        <table class="data-table">
          <thead>
            <tr>
              <th>借展单号</th><th>展品编号</th><th>展品名称</th><th>展品件数</th>
              <th>调拨方向</th><th>预计回运日</th><th>备注</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in group.onShow" :key="String(row.id)" :class="{ 'row-abnormal': row.abnormal }">
              <td>{{ row['借展单号'] }}</td>
              <td>{{ row['展品编号'] }}</td>
              <td>{{ row['展品名称'] }}</td>
              <td>{{ row['实物出库件数'] }}</td>
              <td>{{ row['调拨方向'] }}</td>
              <td>{{ row['预计回运日'] }}</td>
              <td class="note-cell">{{ row['备注'] || '—' }}</td>
              <td class="row-actions">
                <button class="link" type="button" @click="finishReturn(row)">确认回运</button>
              </td>
            </tr>
            <tr v-if="!group.onShow.length">
              <td colspan="8" class="empty-state">该单位暂无在展条目</td>
            </tr>
          </tbody>
        </table>

        <h4 class="subhead">待运（{{ group.shipping.length }}）</h4>
        <table class="data-table">
          <thead>
            <tr>
              <th>借展单号</th><th>展品编号</th><th>展品名称</th><th>申报件数</th>
              <th>在库可用</th><th>调拨方向</th><th>预计回运日</th><th>备注</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in group.shipping" :key="String(row.id)" :class="{ 'row-abnormal': row.abnormal }">
              <td>{{ row['借展单号'] }}</td>
              <td>{{ row['展品编号'] }}</td>
              <td>{{ row['展品名称'] }}</td>
              <td>{{ row['申报件数'] }}</td>
              <td>{{ stockMap[String(row['展品编号'])] ?? 0 }}</td>
              <td>
                <select :value="String(row['调拨方向'] ?? '')" @change="changeDirection(row, selectValue($event))">
                  <option v-for="target in targetOptions(row)" :key="target" :value="target">{{ target }}</option>
                </select>
              </td>
              <td>{{ row['预计回运日'] }}</td>
              <td class="note-cell">{{ row['备注'] || '—' }}</td>
              <td class="row-actions">
                <template v-if="Number(row['出库尝试次数']) < 2">
                  <button class="link" type="button" @click="ship(row)">
                    {{ Number(row['出库尝试次数']) === 1 ? '再试出库（仅此一次）' : '办理出库' }}
                  </button>
                </template>
                <span v-else class="tag tag-blocked">两次失败·转人工核查</span>
              </td>
            </tr>
            <tr v-if="!group.shipping.length">
              <td colspan="9" class="empty-state">该单位暂无待运条目</td>
            </tr>
          </tbody>
        </table>
      </section>

      <p v-if="!board.groups.length && !board.undirected.length" class="empty-state page-empty">册中暂无借展调拨记录</p>
    </div>

    <!-- 展陈清单：与借出台账按单号关联，件数对不上时按已出库实物数核账 -->
    <div v-if="activeTab === 'display'">
      <table class="data-table">
        <thead>
          <tr>
            <th>借展单号</th><th>借入单位</th><th>展品编号</th><th>展品名称</th>
            <th>台账实物出库件数</th><th>展陈登记件数</th><th>核对结果</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in displayRows" :key="String(row.id)" :class="{ 'row-mismatch': isMismatch(row) }">
            <td>{{ row['借展单号'] }}</td>
            <td>{{ row['借入单位'] }}</td>
            <td>{{ row['展品编号'] }}</td>
            <td>{{ row['展品名称'] }}</td>
            <td>{{ row['实物出库件数'] }}</td>
            <td>{{ row['展陈登记件数'] }}</td>
            <td>
              <span v-if="isMismatch(row)" class="tag tag-warn">
                件数不符，按已出库实物数 {{ row['实物出库件数'] }} 件核账
              </span>
              <span v-else class="tag tag-ok">账实一致</span>
            </td>
          </tr>
          <tr v-if="!displayRows.length">
            <td colspan="7" class="empty-state">暂无已出库展品，办理出库后会自动进入展陈清单</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 回运收尾：回运结果反映到出土物清单，待复核件数跟着变 -->
    <div v-if="activeTab === 'return'">
      <h3 class="subhead">回运记录（{{ board.returns.length }}）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>借展单号</th><th>借入单位</th><th>展品编号</th><th>展品名称</th>
            <th>出库件数</th><th>回运件数</th><th>预计回运日</th><th>实际回运日</th><th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in board.returns" :key="String(row.id)">
            <td>{{ row['借展单号'] }}</td>
            <td>{{ row['借入单位'] }}</td>
            <td>{{ row['展品编号'] }}</td>
            <td>{{ row['展品名称'] }}</td>
            <td>{{ row['实物出库件数'] }}</td>
            <td>{{ row['回运件数'] }}</td>
            <td>{{ row['预计回运日'] }}</td>
            <td>{{ row['实际回运日'] }}</td>
            <td class="note-cell">{{ row['备注'] || '—' }}</td>
          </tr>
          <tr v-if="!board.returns.length">
            <td colspan="9" class="empty-state">暂无回运记录</td>
          </tr>
        </tbody>
      </table>

      <h3 class="subhead">出土物待复核清单（合计 {{ reviewTotal }} 件）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>器物编号</th><th>器物类别</th><th>待复核件数</th><th>关联借展单号</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in board.review" :key="item.器物编号">
            <td>{{ item.器物编号 }}</td>
            <td>{{ item.器物类别 }}</td>
            <td><strong>{{ item.待复核件数 }}</strong></td>
            <td>{{ item.来源单号 }}</td>
          </tr>
          <tr v-if="!board.review.length">
            <td colspan="4" class="empty-state">暂无回运待复核的出土物</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>同一件展品禁止跨借入单位重复借出 · 库存不足按实物数出库 · 出库失败仅允许再试一次</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  loadLoanBoard,
  returnLoan,
  setLoanDirection,
  shipLoan,
  UNIT_TARGETS,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

type TabKey = 'board' | 'display' | 'return'

const tabs: { key: TabKey; label: string }[] = [
  { key: 'board', label: '借展调拨册' },
  { key: 'display', label: '展陈清单核对' },
  { key: 'return', label: '回运与待复核' },
]

const activeTab = ref<TabKey>('board')
const board = ref(loadLoanBoard())
const flash = ref('')
const flashOk = ref(false)

const stockMap = ref<Record<string, number>>({})

const displayRows = computed(() =>
  listEntries('loan', {}).items.filter((row) => Number(row['实物出库件数']) > 0),
)

const reviewTotal = computed(() =>
  board.value.review.reduce((sum, item) => sum + item.待复核件数, 0),
)

function reload(message = '', ok = false) {
  board.value = loadLoanBoard()
  stockMap.value = {}
  for (const item of listEntries('find', {}).items) {
    stockMap.value[String(item['器物编号'])] = Number(item['在库件数'] ?? 0)
  }
  flash.value = message
  flashOk.value = ok
}

function selectValue(event: Event): string {
  return (event.target as HTMLSelectElement).value
}

function targetOptions(row: EntryRow): string[] {
  const base = UNIT_TARGETS[String(row['借入单位'])] ?? []
  const current = String(row['调拨方向'] ?? '').trim()
  return current && !base.includes(current) ? [...base, current] : base
}

function isMismatch(row: EntryRow): boolean {
  return Number(row['展陈登记件数']) !== Number(row['实物出库件数'])
}

function changeDirection(row: EntryRow, direction: string) {
  const result = setLoanDirection(Number(row.id), direction)
  reload(result.message, result.ok)
}

function ship(row: EntryRow) {
  const result = shipLoan(Number(row.id))
  reload(result.message, result.ok)
}

function finishReturn(row: EntryRow) {
  const result = returnLoan(Number(row.id))
  reload(result.message, result.ok)
}

function exportRows() {
  downloadEntries('loan')
}

onMounted(() => reload())
</script>
