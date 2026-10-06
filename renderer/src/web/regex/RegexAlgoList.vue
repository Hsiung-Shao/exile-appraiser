<!--
  Poe Regex 演算法頁清單(WP-C):數值頁(地圖 / 換界石)與商店頁。項目少,不用虛擬捲動。
  每列:勾選 + 名稱(待實測標記)+ 輸入(range:.seg ≥/≤/區間 + .input.sm 數字;select / count:.seg 選項;colors:R/G/B 數量)
  + 這一列產生的片段預覽。改值會順手勾起該列(store.setValue)。片段由 regex/src/pages/ 產生,不經 Corpus。
  第 32 步:`embedded` = 嵌在宿主詞綴頁頂端的數值區(RegexNumericSection.vue 包一層可收合的卡片),勾選 / 清除都以 `page.id` 指定頁,
  不依賴「目前頁」。
  第 40 步:稀有度 | 汙染條件列(input kind `rarity`):兩組 .seg —— 稀有度可多選、汙染二選一(再點同一個 = 取消),中間一條分隔線;
  條件區(物品基底 / 碑牌 / 物品詞綴數值頂端,只有這一列)的工具列說明用 `section_hint_cond`。
  第 37 步:`rowsOnly` = 只畫這些列(物品詞綴數值頁 RegexItemModList.vue 先篩選 / 限量,幾千條不全部畫);`hint` 覆寫工具列說明。
-->
<template>
  <component :is="embedded ? 'div' : 'section'" class="rx-algo" :class="{ card: !embedded, embedded }"
    :data-regex="embedded ? 'section-list' : 'algo-list'" :data-page="page.id">
    <div class="rx-toolbar">
      <span class="dim rx-algo-hint">{{ hint || t(embedded ? (condSection ? 'ppz.regex.section_hint_cond' : 'ppz.regex.section_hint') : 'ppz.regex.algo_hint') }}</span>
      <span class="grow" />
      <button class="btn sm" :data-regex="embedded ? 'section-clear' : 'clear'" :disabled="!picked.length" :title="t('ppz.regex.clear_tip')"
        @click="clearPicksOn(page.id)">{{ t('ppz.regex.clear') }}</button>
    </div>
    <template v-for="(g, gi) in groups" :key="gi">
      <div v-if="rowsOf(gi).length" class="rx-algo-group">
        <div v-if="groups.length > 1" class="label rx-algo-glabel">{{ g }}</div>
        <div v-for="r in rowsOf(gi)" :key="r.e.id" class="rx-algo-row" :class="{ on: pickedSet.has(r.i) }"
          :data-id="r.e.id">
          <label class="chk rx-algo-name">
            <input type="checkbox" :checked="pickedSet.has(r.i)" :data-regex="`algo-check-${r.e.id}`"
              @change="togglePickOn(page.id, r.i, ($event.target as HTMLInputElement).checked)">
            <span>{{ nameOf(r.e) }}</span>
            <span v-if="r.e.untested" class="chip soft rx-untested" :title="t('ppz.regex.untested_tip')"
              data-regex="untested">{{ t('ppz.regex.untested') }}</span>
          </label>

          <div class="rx-algo-input">
            <!-- 範圍 -->
            <template v-if="r.e.input.kind === 'range'">
              <div v-if="r.e.input.ops.length > 1" class="seg" :data-regex="`algo-op-${r.e.id}`">
                <button v-for="op in r.e.input.ops" :key="op" :class="{ on: opOf(r.e) === op }" :data-value="op"
                  @click="setOp(r.e, op)">{{ t(`ppz.regex.op_${op}`) }}</button>
              </div>
              <span v-else class="dim">≥</span>
              <input v-if="opOf(r.e) !== 'le'" class="input sm num rx-num" type="number" :min="r.e.input.lo"
                :max="r.e.input.hi" :value="valueOf(page.id, r.e).min" :data-regex="`algo-min-${r.e.id}`"
                @input="setNum(r.e, 'min', $event)">
              <span v-if="opOf(r.e) === 'range'" class="dim">–</span>
              <input v-if="opOf(r.e) !== 'ge'" class="input sm num rx-num" type="number" :min="r.e.input.lo"
                :max="r.e.input.hi" :value="valueOf(page.id, r.e).max" :data-regex="`algo-max-${r.e.id}`"
                @input="setNum(r.e, 'max', $event)">
              <span v-if="r.e.input.percent" class="dim">%</span>
            </template>
            <!-- 選項:少的用 .seg,多的(勢力 9 項)用下拉,免得撐破列寬 -->
            <select v-else-if="r.e.input.kind === 'select' && r.e.input.options.length > 5" class="select sm"
              :value="valueOf(page.id, r.e).choice" :data-regex="`algo-choice-${r.e.id}`"
              @change="setChoice(r.e, ($event.target as HTMLSelectElement).value)">
              <option v-for="o in r.e.input.options" :key="o.id" :value="o.id">{{ uiEn ? o.en : o.zh }}</option>
            </select>
            <div v-else-if="r.e.input.kind === 'select' && r.e.input.options.length" class="seg rx-algo-seg"
              :data-regex="`algo-choice-${r.e.id}`">
              <button v-for="o in r.e.input.options" :key="o.id" :class="{ on: valueOf(page.id, r.e).choice === o.id }"
                :data-value="o.id" @click="setChoice(r.e, o.id)">{{ uiEn ? o.en : o.zh }}</button>
            </div>
            <!-- 稀有度 | 汙染(第 40 步):稀有度多選、汙染二選一可取消 -->
            <template v-else-if="r.e.input.kind === 'rarity'">
              <div class="seg rx-algo-seg" :data-regex="`algo-rarity-${r.e.id}`">
                <button v-for="o in r.e.input.options" :key="o.id" :class="{ on: rarityOf(r.e).rarity.includes(o.id) }"
                  :data-value="o.id" :aria-pressed="rarityOf(r.e).rarity.includes(o.id)"
                  @click="setChoice(r.e, toggleRarityIn(valueOf(page.id, r.e).choice, o.id))">{{ uiEn ? o.en : o.zh }}</button>
              </div>
              <span class="rx-algo-sep" aria-hidden="true" />
              <div class="seg rx-algo-seg" :data-regex="`algo-corruption-${r.e.id}`">
                <button v-for="o in r.e.input.corruption" :key="o.id" :class="{ on: rarityOf(r.e).corruption === o.id }"
                  :data-value="o.id" :aria-pressed="rarityOf(r.e).corruption === o.id"
                  @click="setChoice(r.e, toggleCorruptionIn(valueOf(page.id, r.e).choice, o.id as 'uncorrupted' | 'corrupted'))">{{ uiEn ? o.en : o.zh }}</button>
              </div>
            </template>
            <!-- 顏色數 -->
            <template v-else-if="r.e.input.kind === 'count'">
              <div class="seg" :data-regex="`algo-choice-${r.e.id}`">
                <button v-for="o in r.e.input.options" :key="o.id" :class="{ on: valueOf(page.id, r.e).choice === o.id }"
                  :data-value="o.id" @click="setChoice(r.e, o.id)">{{ uiEn ? o.en : o.zh }}</button>
              </div>
              <span class="dim">≥</span>
              <input class="input sm num rx-num" type="number" :min="r.e.input.lo" :max="r.e.input.hi"
                :value="valueOf(page.id, r.e).min" :data-regex="`algo-min-${r.e.id}`" @input="setNum(r.e, 'min', $event)">
            </template>
            <!-- 鏈接顏色 -->
            <template v-else-if="r.e.input.kind === 'colors'">
              <label v-for="c in ['r', 'g', 'b']" :key="c" class="rx-color">
                <span class="rx-color-dot" :class="c">{{ c.toUpperCase() }}</span>
                <input class="input sm num rx-num" type="number" min="0" :max="r.e.input.maxTotal"
                  :value="colorCount(r.e, c)" :data-regex="`algo-color-${r.e.id}-${c}`" @input="setColor(r.e, c, $event)">
              </label>
            </template>
          </div>

          <code class="rx-algo-frag" :class="{ bad: !fragOf(r.e) }" data-regex="algo-frag">{{ fragOf(r.e) ?? t('ppz.regex.algo_invalid') }}</code>
        </div>
      </div>
    </template>
  </component>
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  isConditionSectionId, parseRarityChoice, rangeOp, toggleCorruptionIn, toggleRarityIn, type AlgoEntry, type AlgoPage, type AlgoValue, type RangeOp
} from '@exile-appraiser/regex'
import { AppConfig } from '@/web/Config'
import { clearPicksOn, picksOf, setValue, togglePickOn, useRegexStore, valueOf } from './store'

export default defineComponent({
  props: {
    page: { type: Object as PropType<AlgoPage>, required: true },
    /** 嵌在宿主詞綴頁的數值區(外層卡片由 RegexNumericSection.vue 提供) */
    embedded: { type: Boolean, default: false },
    /** 只畫這些列(項目索引);null = 全部 */
    rowsOnly: { type: Array as PropType<number[] | null>, default: null },
    /** 工具列說明(空 = 預設) */
    hint: { type: String, default: '' }
  },
  setup (props) {
    const { t } = useI18n()
    const store = useRegexStore()
    const config = AppConfig()
    const uiEn = computed(() => config.uiLanguage === 'en')

    const groups = computed(() => props.page.groups.map((g, i) => (uiEn.value ? props.page.groupsEn[i] : '') || g))
    const rows = computed(() => props.rowsOnly
      ? props.rowsOnly.map(i => ({ e: props.page.entries[i], i })).filter(r => !!r.e)
      : props.page.entries.map((e, i) => ({ e, i })))
    const rowsOf = (g: number) => rows.value.filter(r => r.e.g === g)

    /** range 項目目前的運算:值推得出就用它,否則輸入允許的第一個 */
    function opOf (e: AlgoEntry): RangeOp {
      const op = rangeOp(valueOf(props.page.id, e))
      if (op && (e.input.kind !== 'range' || e.input.ops.includes(op))) return op
      return e.input.kind === 'range' ? e.input.ops[0] : 'ge'
    }
    function setOp (e: AlgoEntry, op: RangeOp) {
      if (e.input.kind !== 'range') return
      const cur = valueOf(props.page.id, e)
      const def = e.input.def
      const min = cur.min ?? def.min ?? cur.max ?? e.input.lo
      const max = cur.max ?? def.max ?? cur.min ?? e.input.hi
      const v: AlgoValue = op === 'ge' ? { min } : op === 'le' ? { max } : { min: Math.min(min, max), max: Math.max(min, max) }
      setValue(props.page.id, e, v)
    }
    function setNum (e: AlgoEntry, key: 'min' | 'max', ev: Event) {
      const raw = (ev.target as HTMLInputElement).value
      const cur = { ...valueOf(props.page.id, e) }
      const n = Number(raw)
      if (raw === '' || !Number.isFinite(n)) delete cur[key]
      else cur[key] = Math.trunc(n)
      // range 項目:保持目前的運算(≥ 只留 min、≤ 只留 max)
      if (e.input.kind === 'range') {
        const op = opOf(e)
        if (op === 'ge') delete cur.max
        if (op === 'le') delete cur.min
      }
      setValue(props.page.id, e, cur)
    }
    function setChoice (e: AlgoEntry, id: string) {
      setValue(props.page.id, e, { ...valueOf(props.page.id, e), choice: id })
    }
    function colorCount (e: AlgoEntry, c: string): number {
      return [...(valueOf(props.page.id, e).choice ?? '')].filter(x => x === c).length
    }
    function setColor (e: AlgoEntry, c: string, ev: Event) {
      const n = Math.max(0, Math.min(6, Math.trunc(Number((ev.target as HTMLInputElement).value) || 0)))
      const counts: Record<string, number> = { r: colorCount(e, 'r'), g: colorCount(e, 'g'), b: colorCount(e, 'b') }
      counts[c] = n
      setValue(props.page.id, e, { choice: 'r'.repeat(counts.r) + 'g'.repeat(counts.g) + 'b'.repeat(counts.b) })
    }

    return {
      t,
      uiEn,
      groups,
      rowsOf,
      picked: computed(() => picksOf(props.page.id)),
      pickedSet: computed(() => new Set(picksOf(props.page.id))),
      valueOf,
      opOf,
      setOp,
      setNum,
      setChoice,
      rarityOf: (e: AlgoEntry) => parseRarityChoice(valueOf(props.page.id, e).choice),
      toggleRarityIn,
      toggleCorruptionIn,
      condSection: computed(() => isConditionSectionId(props.page.id)),
      colorCount,
      setColor,
      togglePickOn,
      clearPicksOn,
      nameOf: (e: AlgoEntry) => (uiEn.value ? e.en[0] : e.zh[0]) ?? e.id,
      fragOf: (e: AlgoEntry) => e.fragment(valueOf(props.page.id, e), store.ui.lang)
    }
  }
})
</script>

<style>
.rx-algo {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rx-algo.embedded {
  padding: 0;
}
.rx-algo-hint {
  font-size: var(--fs-xs);
  color: var(--ink-3);
}
/* 稀有度 | 汙染之間的分隔線(第 40 步) */
.rx-algo-sep {
  align-self: stretch;
  width: 1px;
  margin: 0.2em 0.3em;
  background: var(--edge-1);
}
.rx-algo-group {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--edge-0);
  border-radius: var(--radius-s);
  background: var(--surface-0);
}
.rx-algo-glabel {
  margin: 0 !important;
  padding: 6px 10px 2px;
}
.rx-algo-row {
  display: grid;
  grid-template-columns: minmax(150px, 1.1fr) minmax(200px, 1.6fr) minmax(120px, 1.3fr);
  align-items: center;
  gap: 6px 12px;
  padding: 6px 10px;
  border-top: 1px solid var(--edge-0);
}
.rx-algo-group > .rx-algo-row:first-child,
.rx-algo-glabel + .rx-algo-row {
  border-top: 0;
}
.rx-algo-row.on {
  background: var(--gold-soft);
}
.rx-algo-name {
  min-width: 0;
  font-size: var(--fs-sm);
  color: var(--ink-0);
}
.rx-untested {
  margin-left: 4px;
}
.rx-algo-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  font-size: var(--fs-xs);
}
.rx-algo-input .dim {
  color: var(--ink-3);
}
.rx-num {
  width: 64px;
}
.rx-color {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.rx-color-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: var(--fs-2xs);
  font-weight: 700;
  color: var(--surface-0);
}
/* 插槽色借元素色 token(紅 = 火、藍 = 冰;綠沒有元素對應,用 ok) */
.rx-color-dot.r { background: var(--c-fire); }
.rx-color-dot.g { background: var(--ok); }
.rx-color-dot.b { background: var(--c-cold); }
.rx-algo-frag {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  color: var(--ink-2);
}
.rx-algo-frag.bad {
  color: var(--bad);
}
@media (max-width: 640px) {
  .rx-algo-row {
    grid-template-columns: 1fr;
  }
}
</style>
