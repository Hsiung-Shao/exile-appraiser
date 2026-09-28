<!--
  Poe Regex 書籤(WP5):存成書籤 / 載入 / 更新 / 改名 / 刪除(確認),依遊戲過濾;另一個遊戲的筆數與孤兒書籤都明說。
  移植自 PobTools `host/regex_tool_ui.cpp` drawBookmarks :737、drawOrphanNote :817、drawModals :886。
  狀態經 store.ts → Host.regexStateSave(main 原子寫入 userData/regex_state.json)。
-->
<template>
  <section class="card rx-bm" data-regex="bookmarks">
    <div class="rx-bm-head">
      <span class="label">{{ t('ppz.regex.bookmarks', { game: gameLabel(selGame) }) }}</span>
      <button class="btn sm" data-regex="bm-save" :disabled="!picked.length"
        :title="picked.length ? '' : t('ppz.regex.bm_save_need')" @click="openSave">{{ t('ppz.regex.bm_save') }}</button>
      <span class="grow" />
      <span v-if="counts.elsewhere" class="rx-bm-else" :title="t('ppz.regex.bm_elsewhere_tip')">
        {{ t('ppz.regex.bm_elsewhere', { game: gameLabel(selGame === 'poe1' ? 'poe2' : 'poe1'), n: counts.elsewhere }) }}
      </span>
    </div>
    <p v-if="!counts.mine" class="rx-bm-empty">{{ t('ppz.regex.bm_empty', { game: gameLabel(selGame) }) }}</p>
    <ul v-else class="rx-bm-list">
      <li v-for="x in mine" :key="x.index" class="rx-bm-item" :data-bm="x.b.name">
        <div class="rx-bm-text">
          <div class="rx-bm-name">{{ x.b.name }}</div>
          <div class="rx-bm-meta">{{ t('ppz.regex.bm_meta', {
            page: pageTitle(x.b.page), mode: t(`ppz.regex.mode_${x.b.mode}`),
            lang: x.b.lang === 'en' ? 'English' : t('ppz.regex.lang_zh_short'), n: x.b.keys.length
          }) }}</div>
        </div>
        <div class="rx-bm-actions">
          <button class="btn sm" data-regex="bm-load" @click="loadBookmark(x.index)">{{ t('ppz.regex.bm_load') }}</button>
          <button class="btn sm" data-regex="bm-update" :title="t('ppz.regex.bm_update_tip')"
            @click="updateBookmark(x.index)">{{ t('ppz.regex.bm_update') }}</button>
          <button class="btn sm" data-regex="bm-rename" @click="openRename(x.index)">{{ t('ppz.regex.bm_rename') }}</button>
          <button class="btn sm danger" data-regex="bm-delete" @click="delIdx = x.index">{{ t('ppz.regex.bm_delete') }}</button>
        </div>
      </li>
    </ul>
    <p v-if="counts.orphans" class="rx-bm-empty">{{ t('ppz.regex.bm_orphans', { n: counts.orphans }) }}</p>

    <Teleport to="body">
      <div v-if="nameModal" class="modal rx-modal" @mousedown.self="nameModal = null">
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
      <div v-if="delIdx >= 0" class="modal rx-modal" @mousedown.self="delIdx = -1">
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
    </Teleport>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig } from '@/web/Config'
import {
  deleteBookmark, gameLabel, loadBookmark, renameBookmark, saveBookmark, updateBookmark, useRegexStore
} from './store'

export default defineComponent({
  setup () {
    const { t } = useI18n()
    const store = useRegexStore()
    const config = AppConfig()
    const nameModal = ref<{ index: number, name: string } | null>(null)
    const nameInput = ref<HTMLInputElement | null>(null)
    const delIdx = shallowRef(-1)

    function pageTitle (id: string): string {
      const p = store.pageById(id)
      if (!p) return id
      return (config.uiLanguage === 'en' ? p.titleEn : '') || p.title
    }

    async function focusName () {
      await nextTick()
      nameInput.value?.focus()
      nameInput.value?.select()
    }

    return {
      t,
      gameLabel,
      ui: store.ui,
      selGame: store.selGame,
      picked: store.picked,
      counts: store.bookmarkCounts,
      mine: store.myBookmarks,
      nameModal,
      nameInput,
      delIdx,
      pageTitle,
      loadBookmark,
      updateBookmark,
      openSave () {
        const p = store.page.value
        if (!p) return
        nameModal.value = { index: -1, name: t('ppz.regex.bm_default_name', { page: pageTitle(p.id), n: store.picked.value.length }) }
        void focusName()
      },
      openRename (index: number) {
        nameModal.value = { index, name: store.ui.bookmarks[index]?.name ?? '' }
        void focusName()
      },
      commitName () {
        const m = nameModal.value
        if (!m) return
        const name = m.name.trim()
        if (!name) return
        if (m.index < 0) saveBookmark(name)
        else renameBookmark(m.index, name)
        nameModal.value = null
      },
      confirmDelete () {
        if (delIdx.value >= 0) deleteBookmark(delIdx.value)
        delIdx.value = -1
      }
    }
  }
})
</script>

<style>
.rx-bm-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.rx-bm-head .label {
  margin: 0;
}
.rx-bm-head .grow {
  flex: 1;
}
.rx-bm-else {
  font-size: var(--fs-2xs);
  color: var(--ink-3);
}
.rx-bm-empty {
  margin: 4px 0 0;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}
.rx-bm-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 240px;
  overflow-y: auto;
}
.rx-bm-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  padding: 6px 0;
  border-top: 1px solid var(--edge-0);
}
.rx-bm-item:first-child {
  border-top: 0;
}
.rx-bm-text {
  flex: 1 1 180px;
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
  gap: 4px;
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
