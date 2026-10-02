/**
 * test-vue 的全域替身(node 環境,沒有瀏覽器):renderer 的殼在 import / 呼叫時會碰 window / document / localStorage / fetch。
 * - fetch:`./data/…` 讀 repo 的 `data/`;交易站 / poe.ninja 一律走錄製檔或 404(**不連網**),全部記在 `globalThis.__requests`。
 * - 設定:localStorage 給一份國際服 PoE2 繁中設定(聯盟 Forbidden Rites)。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { vi } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')
const DATA = path.join(ROOT, 'data')
const FX = [
  ...JSON.parse(fs.readFileSync(path.join(ROOT, 'poe2/test/docs/fetchResponses.json'), 'utf8')).result,
  ...JSON.parse(fs.readFileSync(path.join(ROOT, 'poe2/test/docs/fetchResponses2.json'), 'utf8'))
].slice(0, 10)

export const TEST_LEAGUE = 'Forbidden Rites'
const CONFIG = JSON.stringify({
  configVersion: 999,
  game: 'poe2',
  realm: 'intl',
  language: 'cmn-Hant',
  uiLanguage: 'cmn-Hant',
  leagueBy: { poe1: {}, poe2: { intl: TEST_LEAGUE } }
})

interface Req { method: string, url: string, body?: string }
const requests: Req[] = []
;(globalThis as Record<string, unknown>).__requests = requests

function json (status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.startsWith('./data/') || url.startsWith('data/')) {
    const file = path.join(DATA, url.replace(/^\.?\/?data\//, ''))
    if (!fs.existsSync(file)) return new Response('', { status: 404 })
    return new Response(fs.readFileSync(file))
  }
  requests.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? init.body : undefined })
  if (/\/api\/trade2\/data\/leagues/.test(url)) return json(200, { result: [{ id: TEST_LEAGUE, realm: 'poe2', text: TEST_LEAGUE }] })
  if (/\/api\/trade2\/search\//.test(url)) return json(200, { id: 'TESTQUERY', complexity: 1, result: FX.map((x: { id: string }) => x.id), total: FX.length })
  if (/\/api\/trade2\/fetch\//.test(url)) return json(200, { result: FX })
  return json(404, { error: { message: 'test-vue: 沒有錄製回應' } })
}) as typeof fetch

const store = new Map<string, string>([['exile-appraiser.config', CONFIG]])
const localStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) }
}

const noop = () => {}
const classList = { add: noop, remove: noop, toggle: noop, contains: () => false }
const element = () => ({ style: { setProperty: noop, removeProperty: noop }, classList, setAttribute: noop, removeAttribute: noop, appendChild: noop, addEventListener: noop, removeEventListener: noop })

Object.assign(globalThis, {
  localStorage: localStorageStub,
  window: Object.assign(globalThis, {
    innerWidth: 1280, innerHeight: 900, screenX: 0, screenY: 0, devicePixelRatio: 1,
    addEventListener: noop, removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    requestAnimationFrame: (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id)
  }),
  document: {
    documentElement: Object.assign(element(), { lang: '' }),
    body: element(),
    baseURI: 'http://localhost/',
    createElement: element,
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    fonts: { ready: Promise.resolve() }
  }
})

// tippy(物品浮窗 / 提示)要真的 DOM 量位置;這裡只驗掛載與查詢,換成什麼都不做的實例
vi.mock('tippy.js', () => {
  const instance = (): unknown => new Proxy({}, { get: (_t, k) => (k === 'state' ? { isEnabled: true, isVisible: false } : () => {}) })
  const tippy = Object.assign((targets: unknown) => (Array.isArray(targets) ? targets.map(instance) : instance()), { setDefaultProps: () => {} })
  return { default: tippy }
})
