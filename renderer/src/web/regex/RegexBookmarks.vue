<!--
  Poe Regex 書籤(WP5):存成書籤 / 載入 / 更新 / 改名 / 刪除(確認);孤兒書籤明說。
  移植自 PobTools `host/regex_tool_ui.cpp` drawBookmarks :737、drawOrphanNote :817、drawModals :886。
  狀態經 store.ts → Host.regexStateSave(main 原子寫入 userData/regex_state.json)。
  第 33 步:每個書籤可設個別熱鍵(HotkeyInput,存在書籤 `hotkey`;遊戲裡按下 = 複製並貼進搜尋列),衝突 / 保留鍵 / 被佔用同其他熱鍵(`useHotkeyIssues`)。
  第 36 步(2026-10-04)資料夾 + PoE1 / PoE2 分頁:
  - 上方分頁切換要管理哪一代的書籤(預設 = 正則清單目前的遊戲 `selGame`,它跟著清單換遊戲走);另一代的書籤可改名、刪除、設熱鍵、
    移資料夾、排序,不必切遊戲。「載入」= 把正則清單切到那一代並載入(store `loadBookmark` 本來就會切 `selGame`);
    「更新」用的是目前清單頁的勾選 → 只有書籤的遊戲 = 清單目前的遊戲才能按。
  - 依資料夾分組(資料夾順序 → 未分類最後;`bookmarkGroupsOf`),標題可收合(收合狀態與書籤列 / 快速面板共用);
    沒有資料夾時不畫標題(= 第 36 步前的外觀)。新增 / 改名 / 刪除資料夾(刪除 → 書籤移回未分類,`.modal` 確認)。
  - 書籤移到資料夾:每列下拉選單 + 拖曳(握把 ⠿,pointer events + setPointerCapture;放在書籤上 = 插到它前 / 後並進它的資料夾,
    放在資料夾標題 / 空資料夾 = 移到該資料夾最後)。資料夾排序:拖曳標題的握把。鍵盤替代:書籤與資料夾都有上移 / 下移按鈕。
  - 熱鍵衝突提示(`rxbm:<索引>`)只算目前遊戲(main 只註冊目前遊戲的書籤熱鍵),另一代的書籤不顯示衝突。
  第 40 步:PobTools 送來的書籤加入後(store `bookmarkReveal`)→ 分頁切到那一代、捲到這張卡片、新書籤短暫醒目(`.revealed`)。
-->
<template>
  <section ref="rootEl" class="card rx-bm" data-regex="bookmarks" :data-tab="tab">
    <div class="rx-bm-head">
      <span class="label">{{ t('ppz.regex.bm_title') }}</span>
      <div class="seg rx-bm-tabs" role="tablist" data-regex="bm-tabs">
        <button v-for="g in games" :key="g" type="button" role="tab" :class="{ on: tab === g }" :aria-selected="tab === g"
          data-regex="bm-tab" :data-value="g" @click="tab = g">
          {{ gameLabel(g) }} <span class="num rx-bm-tabn">{{ counts[g] }}</span>
        </button>
      </div>
      <span class="grow" />
      <button class="btn sm ghost" data-regex="bm-folder-add" @click="openFolderAdd">{{ t('ppz.regex.fd_add') }}</button>
      <button class="btn sm" data-regex="bm-save" :disabled="!pickedTotal"
        :title="pickedTotal ? t('ppz.regex.bm_save_tip', { game: gameLabel(selGame) }) : t('ppz.regex.bm_save_need')" @click="openSave">{{ t('ppz.regex.bm_save') }}</button>
    </div>
    <p v-if="tab !== selGame" class="rx-bm-other" data-regex="bm-other-note">{{ t('ppz.regex.bm_other_note', { game: gameLabel(tab), cur: gameLabel(selGame) }) }}</p>
    <p v-if="!counts[tab] && !folderTotal" class="rx-bm-empty">{{ t('ppz.regex.bm_empty', { game: gameLabel(tab) }) }}</p>
    <div v-else ref="groupsEl" class="rx-bm-groups" :class="{ dragging: !!drag?.active }" data-regex="bm-groups">
      <div v-for="(g, gi) in grouped.groups" :key="`g:${g.folder}`" class="rx-bm-group"
        :class="{ 'drop-into': isDrop('into', g.folder), 'drop-before': isDrop('fbefore', g.folder), 'drop-after': isDrop('fafter', g.folder) }"
        data-drop-group="1" :data-folder="g.folder">
        <div v-if="grouped.headers" class="rx-bm-ghead" data-regex="bm-folder" :data-folder="g.folder">
          <button type="button" class="rx-bm-gtoggle" :aria-expanded="!g.collapsed" data-regex="bm-folder-toggle"
            :title="t(g.collapsed ? 'ppz.regex.fd_expand' : 'ppz.regex.fd_collapse')" @click="toggle(g.folder, !g.collapsed)">
            <span class="rx-bm-caret" aria-hidden="true">{{ g.collapsed ? '▸' : '▾' }}</span>
            <span class="rx-bm-gname">{{ g.folder || t('ppz.regex.fd_uncategorized') }}</span>
            <span class="rx-bm-gcount num">{{ g.items.length }}</span>
          </button>
          <span class="grow" />
          <template v-if="g.folder">
            <span class="rx-bm-grip" role="button" tabindex="-1" :aria-label="t('ppz.regex.fd_drag')" :title="t('ppz.regex.fd_drag')"
              data-regex="bm-folder-grip" @pointerdown="onGripDown($event, { kind: 'folder', name: g.folder })">⠿</span>
            <button class="btn sm ghost rx-bm-icon" data-regex="bm-folder-up" :disabled="gi === 0" :aria-label="t('ppz.regex.fd_up')"
              :title="t('ppz.regex.fd_up')" @click="moveFolder(g.folder, -1)">↑</button>
            <button class="btn sm ghost rx-bm-icon" data-regex="bm-folder-down" :disabled="gi >= folderTotal - 1" :aria-label="t('ppz.regex.fd_down')"
              :title="t('ppz.regex.fd_down')" @click="moveFolder(g.folder, 1)">↓</button>
            <button class="btn sm ghost" data-regex="bm-folder-rename" @click="openFolderRename(g.folder)">{{ t('ppz.regex.bm_rename') }}</button>
            <button class="btn sm ghost danger" data-regex="bm-folder-delete" @click="folderDel = { game: tab, name: g.folder }">{{ t('ppz.regex.bm_delete') }}</button>
          </template>
        </div>
        <ul v-if="!g.collapsed" class="rx-bm-list" :class="{ nested: grouped.headers }">
          <li v-for="(x, k) in g.items" :key="x.index" class="rx-bm-item" :data-bm="x.b.name" :data-bm-index="x.index" data-drop-bm="1"
            :class="{ 'drop-before': isDrop('before', x.index), 'drop-after': isDrop('after', x.index), dragged: drag?.active && drag.src.kind === 'bm' && drag.src.index === x.index, revealed: isRevealed(x.b) }">
            <span class="rx-bm-grip" role="button" tabindex="-1" :aria-label="t('ppz.regex.bm_drag')" :title="t('ppz.regex.bm_drag')"
              data-regex="bm-grip" @pointerdown="onGripDown($event, { kind: 'bm', index: x.index })">⠿</span>
            <div class="rx-bm-text">
              <div class="rx-bm-name">{{ x.b.name }}</div>
              <div class="rx-bm-meta">{{ t('ppz.regex.bm_meta', {
                page: pageTitle(x.b.page), mode: t(`ppz.regex.mode_${x.b.mode}`),
                lang: x.b.lang === 'en' ? 'English' : t('ppz.regex.lang_zh_short'), n: x.b.keys.length + (x.b.num?.length ?? 0)
              }) }}</div>
            </div>
            <div class="rx-bm-actions">
              <hotkey-input :model-value="x.b.hotkey ?? ''" optional class="rx-bm-hotkey" :title="t('ppz.regex.bm_hotkey_tip')"
                data-regex="bm-hotkey" @update:model-value="(v: string) => setBookmarkHotkey(x.index, v)" />
              <select v-if="folderTotal" class="select sm rx-bm-move" :value="x.b.folder ?? ''" :aria-label="t('ppz.regex.fd_move_to')"
                :title="t('ppz.regex.fd_move_to')" data-regex="bm-folder-select" @change="onFolderSelect(x.index, $event)">
                <option value="">{{ t('ppz.regex.fd_uncategorized') }}</option>
                <option v-for="f in folders" :key="f.name" :value="f.name">{{ f.name }}</option>
              </select>
              <button class="btn sm ghost rx-bm-icon" data-regex="bm-up" :disabled="k === 0" :aria-label="t('ppz.regex.bm_up')"
                :title="t('ppz.regex.bm_up')" @click="moveBookmarkStep(x.index, -1)">↑</button>
              <button class="btn sm ghost rx-bm-icon" data-regex="bm-down" :disabled="k >= g.items.length - 1" :aria-label="t('ppz.regex.bm_down')"
                :title="t('ppz.regex.bm_down')" @click="moveBookmarkStep(x.index, 1)">↓</button>
              <button class="btn sm" data-regex="bm-load" :title="x.b.game !== selGame ? t('ppz.regex.bm_load_other', { game: gameLabel(x.b.game) }) : ''"
                @click="loadBookmark(x.index)">{{ t('ppz.regex.bm_load') }}</button>
              <button class="btn sm" data-regex="bm-update" :disabled="x.b.game !== selGame"
                :title="x.b.game !== selGame ? t('ppz.regex.bm_update_other', { game: gameLabel(x.b.game) }) : t('ppz.regex.bm_update_tip')"
                @click="updateBookmark(x.index)">{{ t('ppz.regex.bm_update') }}</button>
              <button class="btn sm" data-regex="bm-rename" @click="openRename(x.index)">{{ t('ppz.regex.bm_rename') }}</button>
              <button class="btn sm danger" data-regex="bm-delete" @click="delIdx = x.index">{{ t('ppz.regex.bm_delete') }}</button>
            </div>
            <span v-if="x.b.game === currentGame && x.b.hotkey && issueText(`rxbm:${x.index}`, x.b.hotkey)" class="rx-bm-issue" :data-issue="`rxbm:${x.index}`">
              {{ issueText(`rxbm:${x.index}`, x.b.hotkey) }}
            </span>
          </li>
          <li v-if="!g.items.length" class="rx-bm-gempty" data-regex="bm-folder-empty">{{ t('ppz.regex.fd_empty') }}</li>
        </ul>
      </div>
    </div>
    <p v-if="counts.orphans" class="rx-bm-empty">{{ t('ppz.regex.bm_orphans', { n: counts.orphans }) }}</p>

    <Teleport to="body">
      <div v-if="nameModal" class="modal rx-modal" :class="fsClass" :style="fsStyle" @mousedown.self="nameModal = null">
        <div class="rx-dialog" role="dialog" aria-modal="true" data-regex="bm-name-dialog">
          <div class="rx-dialog-title">{{ t(nameModal.index < 0 ? 'ppz.regex.bm_save' : 'ppz.regex.bm_rename_title') }}</div>
          <label class="rx-dialog-field">
            <span class="dim">{{ t('ppz.regex.bm_name') }}</span>
            <input ref="nameInput" v-model="nameModal.name" class="input" data-regex="bm-name"
              @keydown.enter="commitName" @keydown.esc="nameModal = null">
          </label>
          <div class="rx-dialog-btns">
            <button class="btn primary" data-regex="bm-name-ok" :disabled="!nameModal.name.trim()" @click="commitName">{{ t('ppz.regex.ok') }}</button>
            <button class="btn" @click="nameModal = null">{{ t('ppz.regex.cancel') }}</button>
          </div>
        </div>
      </div>
      <div v-if="folderModal" class="modal rx-modal" :class="fsClass" :style="fsStyle" @mousedown.self="folderModal = null">
        <div class="rx-dialog" role="dialog" aria-modal="true" data-regex="bm-folder-dialog">
          <div class="rx-dialog-title">{{ t(folderModal.from === null ? 'ppz.regex.fd_add_title' : 'ppz.regex.fd_rename_title', { game: gameLabel(folderModal.game) }) }}</div>
          <label class="rx-dialog-field">
            <span class="dim">{{ t('ppz.regex.fd_name') }}</span>
            <input ref="folderInput" v-model="folderModal.name" class="input" data-regex="bm-folder-name" :maxlength="FOLDER_NAME_MAX"
              @keydown.enter="commitFolder" @keydown.esc="folderModal = null" @input="folderModal.error = ''">
          </label>
          <p v-if="folderModal.error" class="rx-dialog-err" data-regex="bm-folder-error">{{ folderModal.error }}</p>
          <div class="rx-dialog-btns">
            <button class="btn primary" data-regex="bm-folder-ok" :disabled="!folderModal.name.trim()" @click="commitFolder">{{ t('ppz.regex.ok') }}</button>
            <button class="btn" @click="folderModal = null">{{ t('ppz.regex.cancel') }}</button>
          </div>
        </div>
      </div>
      <div v-if="delIdx >= 0" class="modal rx-modal" :class="fsClass" :style="fsStyle" @mousedown.self="delIdx = -1">
        <div class="rx-dialog" role="dialog" aria-modal="true" data-regex="bm-delete-dialog">
          <div class="rx-dialog-title">{{ t('ppz.regex.bm_delete_title') }}</div>
          <p>{{ ui.bookmarks[delIdx] ? t('ppz.regex.bm_delete_confirm', { name: ui.bookmarks[delIdx].name }) : t('ppz.regex.bm_gone') }}</p>
          <p class="dim">{{ t('ppz.regex.bm_delete_warn') }}</p>
          <div class="rx-dialog-btns">
            <button class="btn danger" data-regex="bm-delete-ok" @click="confirmDelete">{{ t('ppz.regex.bm_delete') }}</button>
            <button class="btn" @click="delIdx = -1">{{ t('ppz.regex.cancel') }}</button>
          </div>
        </div>
      </div>
      <div v-if="folderDel" class="modal rx-modal" :class="fsClass" :style="fsStyle" @mousedown.self="folderDel = null">
        <div class="rx-dialog" role="dialog" aria-modal="true" data-regex="bm-folder-delete-dialog">
          <div class="rx-dialog-title">{{ t('ppz.regex.fd_delete_title') }}</div>
          <p>{{ t('ppz.regex.fd_delete_confirm', { name: folderDel.name }) }}</p>
          <p class="dim">{{ t('ppz.regex.fd_delete_warn', { n: folderCount(folderDel.game, folderDel.name) }) }}</p>
          <div class="rx-dialog-btns">
            <button class="btn danger" data-regex="bm-folder-delete-ok" @click="confirmFolderDelete">{{ t('ppz.regex.bm_delete') }}</button>
            <button class="btn" @click="folderDel = null">{{ t('ppz.regex.cancel') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FOLDER_NAME_MAX, folderCounts, type RegexGame } from '@exile-appraiser/regex'
import { AppConfig } from '@/web/Config'
import { useSettingsFs } from '@/web/settings/settings-fs'
import HotkeyInput from '@/web/settings/HotkeyInput.vue'
import { useHotkeyIssues } from '@/web/settings/useHotkeyIssues'
import {
  GAMES, addBookmarkFolder, bookmarkGroupsOf, deleteBookmark, deleteBookmarkFolder, gameLabel, loadBookmark, moveBookmarkFolder,
  moveBookmarkStep, moveBookmarkToFolder, pagePickCount, renameBookmark, renameBookmarkFolder, saveBookmark, setBookmarkFolderCollapsed,
  setBookmarkHotkey, updateBookmark, useRegexStore, bookmarkReveal
} from './store'
import type { RegexBookmark } from '@exile-appraiser/regex'

/** 拖曳來源 */
type DragSrc = { kind: 'bm', index: number } | { kind: 'folder', name: string }
/** 放下位置:書籤前 / 後、資料夾(移到最後)、資料夾前 / 後(資料夾排序) */
type DropAt =
  | { kind: 'before' | 'after', index: number }
  | { kind: 'into', folder: string }
  | { kind: 'fbefore' | 'fafter', folder: string }

/** 移動超過幾 px 才算開始拖曳(點一下握把不動任何東西) */
const DRAG_START_PX = 4

export default defineComponent({
  components: { HotkeyInput },
  setup () {
    const { t } = useI18n()
    const store = useRegexStore()
    const config = AppConfig()
    const nameModal = ref<{ index: number, name: string } | null>(null)
    const nameInput = ref<HTMLInputElement | null>(null)
    const folderModal = ref<{ game: RegexGame, from: string | null, name: string, error: string } | null>(null)
    const folderInput = ref<HTMLInputElement | null>(null)
    const delIdx = shallowRef(-1)
    const folderDel = shallowRef<{ game: RegexGame, name: string } | null>(null)

    // 管理哪一代:預設 = 正則清單目前的遊戲,清單換遊戲(含載入另一代書籤)時跟著換
    const tab = shallowRef<RegexGame>(store.selGame.value)
    watch(store.selGame, (g) => { tab.value = g })

    const grouped = computed(() => bookmarkGroupsOf(tab.value))
    const folders = computed(() => store.ui.folders[tab.value])
    const folderTotal = computed(() => folders.value.length)

    function pageTitle (id: string): string {
      const p = store.pageById(id)
      if (!p) return id
      return (config.uiLanguage === 'en' ? p.titleEn : '') || p.title
    }

    async function focusInput (el: typeof nameInput) {
      await nextTick()
      el.value?.focus()
      el.value?.select()
    }

    // ---- 拖曳(pointer events;只有握把能開始)----
    const drag = shallowRef<{ src: DragSrc, x: number, y: number, active: boolean, pointerId: number, el: Element } | null>(null)
    const dropAt = shallowRef<DropAt | null>(null)
    const groupsEl = ref<HTMLElement | null>(null)

    function isDrop (kind: DropAt['kind'], key: number | string): boolean {
      const d = dropAt.value
      if (!d || d.kind !== kind) return false
      return 'index' in d ? d.index === key : d.folder === key
    }

    /** 指標下的放置位置(上半 = 前、下半 = 後) */
    function dropOf (src: DragSrc, x: number, y: number): DropAt | null {
      const el = document.elementFromPoint(x, y)
      if (!el) return null
      const lowerHalf = (node: Element) => { const r = node.getBoundingClientRect(); return y > r.top + r.height / 2 }
      if (src.kind === 'bm') {
        const li = el.closest<HTMLElement>('[data-drop-bm]')
        if (li) {
          const index = Number(li.dataset.bmIndex)
          if (!Number.isInteger(index)) return null
          return { kind: lowerHalf(li) ? 'after' : 'before', index }
        }
        const grp = el.closest<HTMLElement>('[data-drop-group]')
        return grp ? { kind: 'into', folder: grp.dataset.folder ?? '' } : null
      }
      const grp = el.closest<HTMLElement>('[data-drop-group]')
      if (!grp) return null
      const folder = grp.dataset.folder ?? ''
      // 放在未分類上 = 移到最後一個資料夾之後
      if (!folder) return { kind: 'fafter', folder: folders.value[folders.value.length - 1]?.name ?? '' }
      return { kind: lowerHalf(grp) ? 'fafter' : 'fbefore', folder }
    }

    function applyDrop (src: DragSrc, d: DropAt) {
      if (src.kind === 'bm') {
        const b = store.ui.bookmarks[src.index]
        if (!b) return
        if (d.kind === 'before') { moveBookmarkToFolder(src.index, '', d.index); return }
        if (d.kind === 'after') {
          // 「放在 X 後面」= 放在同組下一筆前面;X 是組內最後一筆 = 移到 X 所在資料夾最後
          const g = grouped.value.groups.find(gr => gr.items.some(it => it.index === d.index))
          if (!g) return
          const k = g.items.findIndex(it => it.index === d.index)
          const next = g.items[k + 1]
          if (next) moveBookmarkToFolder(src.index, '', next.index)
          else moveBookmarkToFolder(src.index, g.folder)
          return
        }
        if (d.kind === 'into') moveBookmarkToFolder(src.index, d.folder)
        return
      }
      if (d.kind !== 'fbefore' && d.kind !== 'fafter') return
      const list = folders.value.map(f => f.name)
      const si = list.indexOf(src.name)
      const ti = list.indexOf(d.folder)
      if (si < 0 || ti < 0) return
      const to = d.kind === 'fbefore' ? (si < ti ? ti - 1 : ti) : (si < ti ? ti : ti + 1)
      moveBookmarkFolder(tab.value, src.name, { to })
    }

    function onMove (e: PointerEvent) {
      const d = drag.value
      if (!d || e.pointerId !== d.pointerId) return
      if (!d.active) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_START_PX) return
        drag.value = { ...d, active: true }
      }
      // 清單有高度上限(會捲動):拖到上 / 下緣附近就往那邊捲,才放得到看不見的位置
      const box = groupsEl.value
      if (box) {
        const r = box.getBoundingClientRect()
        const edge = Math.min(32, r.height / 4)
        if (e.clientY < r.top + edge) box.scrollTop -= Math.ceil((r.top + edge - e.clientY) / 2)
        else if (e.clientY > r.bottom - edge) box.scrollTop += Math.ceil((e.clientY - (r.bottom - edge)) / 2)
      }
      dropAt.value = dropOf(d.src, e.clientX, e.clientY)
    }
    function endDrag (e: PointerEvent | null, commit: boolean) {
      const d = drag.value
      if (!d || (e && e.pointerId !== d.pointerId)) return
      const at = dropAt.value
      drag.value = null
      dropAt.value = null
      try { d.el.releasePointerCapture(d.pointerId) } catch {}
      d.el.removeEventListener('pointermove', onMove as EventListener)
      d.el.removeEventListener('pointerup', onUp as EventListener)
      d.el.removeEventListener('pointercancel', onCancel as EventListener)
      window.removeEventListener('keydown', onDragKey, true)
      if (commit && d.active && at) applyDrop(d.src, at)
    }
    const onUp = (e: PointerEvent) => endDrag(e, true)
    const onCancel = (e: PointerEvent) => endDrag(e, false)
    function onDragKey (e: KeyboardEvent) {
      if (e.key !== 'Escape' || !drag.value) return
      e.preventDefault()
      e.stopPropagation()
      endDrag(null, false)
    }
    function onGripDown (e: PointerEvent, src: DragSrc) {
      if (e.button !== 0 || drag.value) return
      const el = e.currentTarget as Element
      e.preventDefault()
      try { el.setPointerCapture(e.pointerId) } catch {}
      drag.value = { src, x: e.clientX, y: e.clientY, active: false, pointerId: e.pointerId, el }
      el.addEventListener('pointermove', onMove as EventListener)
      el.addEventListener('pointerup', onUp as EventListener)
      el.addEventListener('pointercancel', onCancel as EventListener)
      window.addEventListener('keydown', onDragKey, true)
    }
    onUnmounted(() => endDrag(null, false))

    // 第 40 步:PobTools 送來的書籤剛加入 → 切到那一代、捲到卡片、新書籤醒目約 4 秒
    const rootEl = ref<HTMLElement | null>(null)
    const revealed = shallowRef<Set<string>>(new Set())
    let revealTimer: ReturnType<typeof setTimeout> | undefined
    watch(bookmarkReveal, (r) => {
      if (!r) return
      tab.value = r.game
      revealed.value = new Set(r.keys)
      clearTimeout(revealTimer)
      revealTimer = setTimeout(() => { revealed.value = new Set() }, 4000)
      void nextTick(() => { rootEl.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) })
    })
    onUnmounted(() => { clearTimeout(revealTimer) })
    const isRevealed = (b: RegexBookmark) => revealed.value.size > 0 && b.game === tab.value && revealed.value.has(`${b.folder ?? ''}\u0000${b.name}`)

    const settingsFs = useSettingsFs()
    // 第 33 步:書籤熱鍵的衝突 / 保留鍵 / 被佔用(與熱鍵總表同一套;只算目前遊戲)
    const { issueText } = useHotkeyIssues()
    return {
      rootEl,
      isRevealed,
      issueText,
      setBookmarkHotkey,
      /** 對話框 Teleport 到 body,綁設定視窗獨立字級變數(第 21 步)+ `fs-own`(控制項補高,code review 第 C 批) */
      fsStyle: settingsFs.style,
      fsClass: settingsFs.cls,
      t,
      gameLabel,
      games: GAMES,
      FOLDER_NAME_MAX,
      ui: store.ui,
      selGame: store.selGame,
      currentGame: computed(() => config.game),
      tab,
      grouped,
      folders,
      folderTotal,
      /** 目前頁(含數值區)勾了幾項;宿主詞綴頁只勾數值也能存書籤 */
      pickedTotal: computed(() => store.page.value ? pagePickCount(store.page.value) : 0),
      counts: store.bookmarkCounts,
      nameModal,
      nameInput,
      folderModal,
      folderInput,
      delIdx,
      folderDel,
      drag,
      groupsEl,
      isDrop,
      onGripDown,
      pageTitle,
      loadBookmark,
      updateBookmark,
      moveBookmarkStep,
      folderCount: (g: RegexGame, name: string) => folderCounts(store.ui, g).get(name) ?? 0,
      toggle (folder: string, collapse: boolean) { setBookmarkFolderCollapsed(tab.value, folder, collapse) },
      moveFolder (name: string, delta: number) { moveBookmarkFolder(tab.value, name, { delta }) },
      onFolderSelect (index: number, e: Event) {
        moveBookmarkToFolder(index, (e.target as HTMLSelectElement).value)
      },
      openSave () {
        const p = store.page.value
        if (!p) return
        nameModal.value = { index: -1, name: t('ppz.regex.bm_default_name', { page: pageTitle(p.id), n: pagePickCount(p) }) }
        void focusInput(nameInput)
      },
      openRename (index: number) {
        nameModal.value = { index, name: store.ui.bookmarks[index]?.name ?? '' }
        void focusInput(nameInput)
      },
      commitName () {
        const m = nameModal.value
        if (!m) return
        const name = m.name.trim()
        if (!name) return
        if (m.index < 0) {
          // 新書籤存在清單目前的遊戲(未分類)→ 分頁切過去才看得到
          if (saveBookmark(name)) tab.value = store.selGame.value
        } else renameBookmark(m.index, name)
        nameModal.value = null
      },
      openFolderAdd () {
        folderModal.value = { game: tab.value, from: null, name: '', error: '' }
        void focusInput(folderInput)
      },
      openFolderRename (name: string) {
        folderModal.value = { game: tab.value, from: name, name, error: '' }
        void focusInput(folderInput)
      },
      commitFolder () {
        const m = folderModal.value
        if (!m || !m.name.trim()) return
        const r = m.from === null ? addBookmarkFolder(m.game, m.name) : renameBookmarkFolder(m.game, m.from, m.name)
        if (r === 'ok') { folderModal.value = null; return }
        m.error = t(r === 'duplicate' ? 'ppz.regex.fd_err_duplicate' : r === 'missing' ? 'ppz.regex.fd_err_missing' : 'ppz.regex.fd_err_empty')
      },
      confirmDelete () {
        if (delIdx.value >= 0) deleteBookmark(delIdx.value)
        delIdx.value = -1
      },
      confirmFolderDelete () {
        const d = folderDel.value
        if (d) deleteBookmarkFolder(d.game, d.name)
        folderDel.value = null
      }
    }
  }
})
</script>

<style>
.rx-bm-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  margin-bottom: 6px;
}
.rx-bm-head .label {
  margin: 0;
}
.rx-bm-head .grow,
.rx-bm-ghead .grow {
  flex: 1;
}
.rx-bm-tabn {
  margin-left: 0.25em;
  color: var(--ink-3);
}
.rx-bm-tabs button.on .rx-bm-tabn {
  color: inherit;
  opacity: 0.8;
}
.rx-bm-other {
  margin: 0 0 6px;
  padding: 0.35em 0.6em;
  border-left: 2px solid var(--edge-1);
  font-size: var(--fs-xs);
  color: var(--ink-2);
}
.rx-bm-empty {
  margin: 4px 0 0;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}
.rx-bm-groups {
  max-height: 32em;
  overflow-y: auto;
}
.rx-bm-groups.dragging {
  cursor: grabbing;
  user-select: none;
}
.rx-bm-group {
  position: relative;
  border-radius: var(--radius-s);
}
.rx-bm-group + .rx-bm-group {
  margin-top: 4px;
}
.rx-bm-group.drop-into {
  outline: 1px dashed var(--gold);
  outline-offset: -1px;
  background: var(--gold-soft);
}
.rx-bm-group.drop-before {
  box-shadow: inset 0 2px 0 var(--gold);
}
.rx-bm-group.drop-after {
  box-shadow: inset 0 -2px 0 var(--gold);
}
.rx-bm-ghead {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 2em;
  padding: 0 2px;
  border-bottom: 1px solid var(--edge-0);
}
.rx-bm-gtoggle {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 0.45em;
  min-width: 0;
  padding: 0.15em 0.3em;
  border: 0;
  border-radius: var(--radius-s);
  background: none;
  color: var(--ink-1);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.rx-bm-gtoggle:hover {
  color: var(--ink-0);
  background: var(--surface-hover);
}
.rx-bm-gtoggle:focus-visible {
  outline: 1px solid var(--gold);
}
.rx-bm-caret {
  color: var(--gold);
}
.rx-bm-gname {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.rx-bm-gcount {
  font-size: var(--fs-2xs);
  color: var(--ink-3);
}
.rx-bm-icon {
  min-width: 1.9em;
  padding: 0 0.35em;
}
.rx-bm-grip {
  flex: 0 0 auto;
  padding: 0 0.25em;
  color: var(--ink-3);
  font-size: var(--fs-sm);
  line-height: 1;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.rx-bm-grip:hover {
  color: var(--gold);
}
.rx-bm-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.rx-bm-list.nested {
  padding-left: 0.9em;
}
.rx-bm-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  padding: 6px 0;
  border-top: 1px solid var(--edge-0);
}
.rx-bm-item.revealed {
  background: var(--gold-soft);
  transition: background 0.4s;
}
.rx-bm-item:first-child {
  border-top: 0;
}
.rx-bm-item.dragged {
  opacity: 0.45;
}
.rx-bm-item.drop-before {
  box-shadow: inset 0 2px 0 var(--gold);
}
.rx-bm-item.drop-after {
  box-shadow: inset 0 -2px 0 var(--gold);
}
.rx-bm-gempty {
  padding: 0.5em 0.2em;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}
.rx-bm-text {
  flex: 1 1 160px;
  min-width: 0;
}
.rx-bm-name {
  font-size: var(--fs-sm);
  color: var(--ink-0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rx-bm-meta {
  font-size: var(--fs-2xs);
  color: var(--ink-3);
}
.rx-bm-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.rx-bm-actions .rx-bm-hotkey {
  width: 11.5em;
  flex: 0 0 auto;
  font-size: var(--fs-xs);
}
.rx-bm-actions .rx-bm-move {
  width: 8.5em;
  flex: 0 0 auto;
}
.rx-bm-issue {
  flex: 1 0 100%;
  font-size: var(--fs-2xs);
  color: var(--bad);
}
.rx-modal {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--backdrop);
}
.rx-dialog {
  width: min(360px, calc(100vw - 32px));
  padding: 14px 16px;
  border: 1px solid var(--edge-1);
  border-left: 3px solid var(--gold);
  border-radius: var(--radius-m);
  background: var(--surface-1);
  box-shadow: var(--shadow-float);
  color: var(--ink-0);
  font-size: var(--fs-sm);
}
.rx-dialog p {
  margin: 0 0 6px;
}
.rx-dialog .dim {
  color: var(--ink-3);
  font-size: var(--fs-xs);
}
.rx-dialog-err {
  margin: 6px 0 0 !important;
  font-size: var(--fs-xs);
  color: var(--bad);
}
.rx-dialog-title {
  margin-bottom: 10px;
  font-weight: 600;
}
.rx-dialog-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rx-dialog-btns {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 12px;
}
</style>
