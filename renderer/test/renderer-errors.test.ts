// renderer 錯誤寫進 main log 的格式與去重(src/web/renderer-errors.ts;2026-10-03 修空白面板時補的觀測)
import { describe, expect, it } from 'vitest'
import {
  createErrorLogger, describeVueInfo, formatRendererError, installVueErrorHandler, installWindowErrorLogging, isEventHandlerError
} from '../src/web/renderer-errors'

describe('formatRendererError', () => {
  it('一個字串:前綴 + 位置 + Vue 來源 + 錯誤 + 縮排堆疊(去掉重複的首行)', () => {
    const err = new TypeError('x is undefined')
    err.stack = 'TypeError: x is undefined\n    at a (app.js:1:2)\n    at b (app.js:3:4)'
    expect(formatRendererError(err, 'price-check CheckedItem', 'https://vuejs.org/error-reference/#runtime-1'))
      .toBe('[renderer-error] price-check CheckedItem(render) TypeError: x is undefined\n    at a (app.js:1:2)\n    at b (app.js:3:4)')
  })
  it('堆疊最多 12 行,其餘標行數', () => {
    const err = new Error('long')
    err.stack = ['Error: long', ...Array.from({ length: 20 }, (_, i) => `    at f${i} (x.js:${i}:1)`)].join('\n')
    const out = formatRendererError(err, 'w')
    expect(out.split('\n')).toHaveLength(1 + 12 + 1)
    expect(out).toContain('…(另 8 行)')
  })
  it('非 Error(Promise reject 字串 / 物件)也印得出來', () => {
    expect(formatRendererError('nope', 'unhandledrejection')).toBe('[renderer-error] unhandledrejection nope')
    expect(formatRendererError({ code: 1 }, 'unhandledrejection')).toBe('[renderer-error] unhandledrejection {"code":1}')
  })
})

describe('Vue 錯誤來源', () => {
  it('正式版錯誤碼 → 名稱;開發版文字原樣', () => {
    expect(describeVueInfo('https://vuejs.org/error-reference/#runtime-0')).toBe('setup')
    expect(describeVueInfo('https://vuejs.org/error-reference/#runtime-3')).toBe('watcher callback')
    expect(describeVueInfo('https://vuejs.org/error-reference/#runtime-m')).toBe('mounted')
    expect(describeVueInfo('render function')).toBe('render function')
  })
  it('只有事件處理算「不換錯誤框」', () => {
    expect(isEventHandlerError('https://vuejs.org/error-reference/#runtime-5')).toBe(true)
    expect(isEventHandlerError('https://vuejs.org/error-reference/#runtime-6')).toBe(true)
    expect(isEventHandlerError('component event handler')).toBe(true)
    expect(isEventHandlerError('https://vuejs.org/error-reference/#runtime-1')).toBe(false)
    expect(isEventHandlerError('https://vuejs.org/error-reference/#runtime-15')).toBe(false)
    expect(isEventHandlerError(undefined)).toBe(false)
  })
})

describe('記錄器', () => {
  it('同一則 2 秒內只記一次,過了再記', () => {
    const lines: string[] = []
    let t = 1000
    const log = createErrorLogger(l => lines.push(l), () => t)
    const e = new Error('same'); e.stack = 'Error: same'
    log(e, 'w'); log(e, 'w'); t += 1500; log(e, 'w')
    expect(lines).toHaveLength(1)
    t += 2500; log(e, 'w')
    expect(lines).toHaveLength(2)
    log(e, 'other place')
    expect(lines).toHaveLength(3)
  })
  it('Vue errorHandler 帶元件名稱', () => {
    const lines: string[] = []
    const app = { config: {} as { errorHandler?: (err: unknown, instance: unknown, info: string) => void } }
    installVueErrorHandler(app as never, createErrorLogger(l => lines.push(l)))
    const instance = { $: { type: { name: 'TradeListing' }, parent: { type: { __name: 'CheckedItem' }, parent: null } } }
    const err = new Error('bad'); err.stack = 'Error: bad'
    app.config.errorHandler!(err, instance, 'https://vuejs.org/error-reference/#runtime-1')
    expect(lines).toEqual(['[renderer-error] vue TradeListing < CheckedItem(render) Error: bad'])
  })
  it('window error / unhandledrejection 都會記', () => {
    const lines: string[] = []
    const handlers: Record<string, (e: unknown) => void> = {}
    installWindowErrorLogging({ addEventListener: (type, cb) => { handlers[type] = cb } }, createErrorLogger(l => lines.push(l)))
    const err = new Error('thrown'); err.stack = 'Error: thrown\n    at z (index.js:9:9)'
    handlers.error({ error: err, filename: 'http://x/assets/index.js', lineno: 9 })
    handlers.unhandledrejection({ reason: 'rejected' })
    expect(lines).toEqual([
      '[renderer-error] uncaught index.js:9 Error: thrown\n    at z (index.js:9:9)',
      '[renderer-error] unhandledrejection rejected'
    ])
  })
})
