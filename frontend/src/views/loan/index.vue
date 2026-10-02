<template>
  <section class="page" data-module="loan">
    <header class="page-head">
      <div>
        <h2>借展调拨册</h2>
        <p class="page-desc">按借入单位分组，在展与待运分栏核对借展单号、展品件数、调拨方向与预计回运日；方向未定单独挑出，出库前做跨单位重复、目标打架与库存冲突拦截。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出借展调拨册</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in view.stats" :key="item.label" class="stat-card" :class="{ warn: item.label === '出库失败' || item.label === '方向未定' }">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p v-if="message" class="banner" :class="messageOk ? 'ok' : 'err'">{{ message }}</p>

    <section class="reconcile">
      <h3>借出台账 × 展陈清单对账（在展）</h3>
      <p class="hint">两处关联同一借展单号；件数对不上时一律以<b>已出库实物数</b>为准。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>借展单号</th><th>借入单位</th><th>展品编号</th><th>展陈编号</th>
            <th>台账实物数</th><th>清单册录件数</th><th>对账</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="link in view.links" :key="String(link.loan.id)" :class="{ mismatch: link.mismatch }">
            <td>{{ link.loan['借展单号'] }}</td>
            <td>{{ link.loan['借入单位'] }}</td>
            <td>{{ link.loan['展品编号'] }}</td>
            <td>{{ link.exhibit ? link.exhibit['展陈编号'] : '清单缺记' }}</td>
            <td>{{ link.physicalCount }}</td>
            <td>{{ link.exhibit ? link.catalogCount : '—' }}</td>
            <td>
              <span v-if="!link.mismatch" class="tag ok">一致</span>
              <span v-else class="tag err">对不上，按实物 {{ link.physicalCount }} 件计</span>
            </td>
          </tr>
          <tr v-if="!view.links.length">
            <td colspan="7" class="empty-state">暂无在展条目</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="view.undecided.length" class="undecided">
      <h3>调拨方向未定（{{ view.undecided.length }} 条，先补定方向再出库）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>借展单号</th><th>借入单位</th><th>展品编号</th><th>展品名称</th>
            <th>申请件数</th><th>调拨方向</th><th>预计回运日</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in view.undecided" :key="String(row.id)">
            <td>{{ row['借展单号'] }}</td>
            <td>{{ row['借入单位'] }}</td>
            <td>{{ row['展品编号'] }}</td>
            <td>{{ row['展品名称'] }}</td>
            <td>{{ row['申请件数'] }}</td>
            <td>
              <select v-model="directionDraft[row.id]">
                <option value="" disabled>请选择方向</option>
                <option v-for="d in DIRECTIONS" :key="d" :value="d">{{ d }}</option>
              </select>
            </td>
            <td>{{ row['预计回运日'] || '—' }}</td>
            <td><button class="link" type="button" @click="saveDirection(row)">补定方向</button></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-for="group in view.groups" :key="group.unit" class="unit-group">
      <header class="group-head">
        <h3>{{ group.unit }}</h3>
        <span class="group-summary">
          在展 {{ group.displayCount }} 件 · 待运 {{ group.pending.length }} 单 ·
          出库失败 {{ group.failed.length }} 单 · 已回运 {{ group.returned.length }} 单
        </span>
      </header>

      <h4 class="sub-title on">在展（{{ group.onDisplay.length }} 单）</h4>
      <table class="data-table">
        <thead>
          <tr>
            <th>借展单号</th><th>展品编号/名称</th><th>展品件数</th><th>调拨方向</th>
            <th>目标场馆</th><th>预计回运日</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in group.onDisplay" :key="String(row.id)">
            <td>{{ row['借展单号'] }}</td>
            <td>{{ row['展品编号'] }} {{ row['展品名称'] }}</td>
            <td>{{ row['已出库实物数'] }}</td>
            <td>{{ row['调拨方向'] }}</td>
            <td>{{ row['目标场馆'] }}</td>
            <td>{{ row['预计回运日'] }}</td>
            <td><button class="link" type="button" @click="doReturn(row)">登记回运</button></td>
          </tr>
          <tr v-if="!group.onDisplay.length"><td colspan="7" class="empty-state">暂无在展条目</td></tr>
        </tbody>
      </table>

      <h4 class="sub-title pending">待运（{{ group.pending.length }} 单）</h4>
      <table class="data-table">
        <thead>
          <tr>
            <th>借展单号</th><th>展品编号/名称</th><th>申请件数</th><th>已出库实物数</th>
            <th>调拨方向</th><th>目标场馆</th><th>预计回运日</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in group.pending" :key="String(row.id)">
            <td>{{ row['借展单号'] }}</td>
            <td>{{ row['展品编号'] }} {{ row['展品名称'] }}</td>
            <td>{{ row['申请件数'] }}</td>
            <td>{{ row['已出库实物数'] }}</td>
            <td>{{ row['调拨方向'] }}</td>
            <td>{{ row['目标场馆'] }}</td>
            <td>{{ row['预计回运日'] || '—' }}</td>
            <td><button class="link" type="button" @click="ship(row)">办理出库</button></td>
          </tr>
          <tr v-if="!group.pending.length"><td colspan="8" class="empty-state">暂无待运条目</td></tr>
        </tbody>
      </table>

      <template v-if="group.failed.length">
        <h4 class="sub-title failed">出库失败（{{ group.failed.length }} 单，可再试一次）</h4>
        <table class="data-table">
          <thead>
            <tr>
              <th>借展单号</th><th>展品编号/名称</th><th>申请件数</th><th>调拨方向</th>
              <th>失败原因（备注）</th><th>已再试</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in group.failed" :key="String(row.id)" class="failed-row">
              <td>{{ row['借展单号'] }}</td>
              <td>{{ row['展品编号'] }} {{ row['展品名称'] }}</td>
              <td>{{ row['申请件数'] }}</td>
              <td>{{ row['调拨方向'] }}</td>
              <td class="remark">{{ row['备注'] || '—' }}</td>
              <td>{{ Number(row['出库失败次数']) >= 1 ? '已再试过' : '未再试' }}</td>
              <td>
                <button v-if="Number(row['出库失败次数']) < 1" class="link" type="button" @click="retry(row)">再试出库</button>
                <span v-else class="tag err">重试已用尽</span>
              </td>
            </tr>
          </tbody>
        </table>
      </template>

      <template v-if="group.returned.length">
        <h4 class="sub-title returned">已回运（{{ group.returned.length }} 单）</h4>
        <table class="data-table">
          <thead>
            <tr><th>借展单号</th><th>展品编号/名称</th><th>回运件数</th><th>调拨方向</th><th>预计回运日</th><th>备注</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in group.returned" :key="String(row.id)">
              <td>{{ row['借展单号'] }}</td>
              <td>{{ row['展品编号'] }} {{ row['展品名称'] }}</td>
              <td>{{ row['已出库实物数'] }}</td>
              <td>{{ row['调拨方向'] }}</td>
              <td>{{ row['预计回运日'] }}</td>
              <td class="remark">{{ row['备注'] || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>

    <footer class="page-foot">
      <span>回运结果同步到出土物登记清单，待复核件数随之增加</span>
      <span v-if="!view.groups.length && !view.undecided.length" class="error-text">暂无借展调拨记录</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'

import {
  DIRECTIONS,
  downloadLoans,
  loadRegister,
  retryLoan,
  returnLoan,
  setLoanDirection,
  shipLoan,
} from '@/api/loan-service'
import type { LoanRegisterView } from '@/api/loan-service'
import type { EntryRow } from '@/data/types'

const view = ref<LoanRegisterView>({ groups: [], undecided: [], links: [], stats: [] })
const message = ref('')
const messageOk = ref(true)
const directionDraft = reactive<Record<number, string>>({})

function flash(result: { ok: boolean; message: string }) {
  message.value = result.message
  messageOk.value = result.ok
}

function reload() {
  view.value = loadRegister()
  for (const row of view.value.undecided) {
    if (directionDraft[row.id as number] === undefined) {
      directionDraft[row.id as number] = ''
    }
  }
}

function exportRows() {
  downloadLoans()
}

function ship(row: EntryRow) {
  flash(shipLoan(Number(row.id)))
  reload()
}

function retry(row: EntryRow) {
  flash(retryLoan(Number(row.id)))
  reload()
}

function doReturn(row: EntryRow) {
  flash(returnLoan(Number(row.id)))
  reload()
}

function saveDirection(row: EntryRow) {
  const direction = directionDraft[Number(row.id)] ?? ''
  if (!direction) {
    flash({ ok: false, message: '请先选择调拨方向' })
    return
  }
  flash(setLoanDirection(Number(row.id), direction))
  reload()
}

onMounted(reload)
</script>

<style scoped>
.banner { margin: 8px 0 12px; padding: 8px 12px; border-radius: 6px; font-size: 13px; }
.banner.ok { background: #ecfdf3; color: #027a48; border: 1px solid #abefc6; }
.banner.err { background: #fef3f2; color: #b42318; border: 1px solid #fda29b; }
.stat-card.warn { border-color: #fda29b; }
.reconcile, .undecided, .unit-group {
  background: #fff; border: 1px solid var(--border); border-radius: 8px;
  padding: 10px 12px; margin-bottom: 14px;
}
.reconcile h3, .undecided h3 { margin: 0 0 6px; font-size: 15px; }
.hint { margin: 0 0 8px; font-size: 12px; color: var(--muted); }
tr.mismatch td { background: #fffaeb; }
.tag { border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.tag.ok { background: #ecfdf3; color: #027a48; }
.tag.err { background: #fef3f2; color: #b42318; }
.undecided h3 { color: #b54708; }
.undecided select { padding: 4px 6px; }
.unit-group { padding: 12px 14px; }
.group-head { display: flex; justify-content: space-between; align-items: baseline; }
.group-head h3 { margin: 0; font-size: 16px; }
.group-summary { font-size: 12px; color: var(--muted); }
.sub-title { margin: 12px 0 6px; font-size: 13px; }
.sub-title.on { color: #027a48; }
.sub-title.pending { color: #b54708; }
.sub-title.failed { color: #b42318; }
.sub-title.returned { color: var(--muted); }
tr.failed-row td { background: #fef3f2; }
.remark { color: var(--muted); max-width: 320px; }
</style>
