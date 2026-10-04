// numeric.ts 全域窮舉:產生的片段逐值 RegExp.test 必須與條件完全一致,且不長於樸素寫法。
// 涵蓋:digits 1/2/3 × 每個 N 的 ≥N、≤N(共 2×(10+100+1000) = 2220 組)、digits=2 全部 5050 個區間、
// digits=3 常見區間 + 3000 組 LCG 抽樣區間;每組都對 0–999 逐值比對(整段比對 String(N))。
import { describe, expect, it } from 'vitest'
import { domainMax, naiveRangeRegex, rangeRegex, readableRangeRegex, type NumOptions, type NumRange } from '../src/numeric'

const ALL = Array.from({ length: 1000 }, (_, n) => n)

function inRange (n: number, r: NumRange, o: NumOptions): boolean {
  const top = domainMax(o.digits)
  return n <= top && n >= (r.min ?? 0) && n <= (r.max ?? top)
}

/** 對 0–999 每個 N 檢查;回傳第一個不一致的 N(沒有就 -1) */
function firstMismatch (r: NumRange, o: NumOptions): number {
  const src = rangeRegex(r, o)
  const re = new RegExp(`^(?:${src})$`)
  for (const n of ALL) if (re.test(String(n)) !== inRange(n, r, o)) return n
  return -1
}

function check (r: NumRange, o: NumOptions): void {
  const bad = firstMismatch(r, o)
  if (bad !== -1) throw new Error(`${JSON.stringify(r)} digits=${o.digits}:N=${bad} 不一致(片段 ${rangeRegex(r, o)})`)
  expect(rangeRegex(r, o).length).toBeLessThanOrEqual(naiveRangeRegex(r, o).length)
}

describe('rangeRegex:例子', () => {
  it('≥16(兩位數)= (1[6-9]|[2-9]\\d)', () => {
    expect(rangeRegex({ min: 16 }, { digits: 2 })).toBe('(1[6-9]|[2-9]\\d)')
  })
  it('≤5(一位數)= [0-5]', () => {
    expect(rangeRegex({ max: 5 }, { digits: 1 })).toBe('[0-5]')
  })
  it('0–50(三位數)用 ? 合併', () => {
    expect(rangeRegex({ min: 0, max: 50 }, { digits: 3 })).toBe('([1-4]?\\d|50)')
  })
  it('≥80(三位數)', () => {
    expect(rangeRegex({ min: 80 }, { digits: 3 })).toBe('([89]\\d|\\d\\d\\d)')
  })
  it('空集合回空字串', () => {
    expect(rangeRegex({ min: 50, max: 10 }, { digits: 2 })).toBe('')
    expect(rangeRegex({ min: 100 }, { digits: 2 })).toBe('')
  })
})

describe('rangeRegex:0–999 全域窮舉', () => {
  for (const digits of [1, 2, 3] as const) {
    const top = domainMax(digits)
    it(`digits=${digits}:≥N 與 ≤N,N = 0…${top},各對 0–999 逐值比對`, () => {
      let checked = 0
      for (let n = 0; n <= top; n++) {
        check({ min: n }, { digits })
        check({ max: n }, { digits })
        checked += 2
      }
      expect(checked).toBe(2 * (top + 1))
    })
  }

  it('digits=2:全部區間 [a,b](0 ≤ a ≤ b ≤ 99,5050 組)對 0–999 逐值比對', () => {
    let checked = 0
    for (let a = 0; a <= 99; a++) {
      for (let b = a; b <= 99; b++) {
        check({ min: a, max: b }, { digits: 2 })
        checked++
      }
    }
    expect(checked).toBe(5050)
  })

  it('digits=3:常見區間 + 3000 組 LCG 抽樣區間', () => {
    const list: Array<[number, number]> = [[0, 0], [0, 999], [1, 100], [60, 86], [68, 83], [75, 100], [80, 120], [100, 999], [83, 86], [50, 150], [99, 101], [9, 10], [199, 200], [0, 9], [10, 99]]
    let seed = 12345
    const rnd = (): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % 1000 }
    for (let i = 0; i < 3000; i++) {
      const a = rnd(); const b = rnd()
      list.push([Math.min(a, b), Math.max(a, b)])
    }
    for (const [a, b] of list) check({ min: a, max: b }, { digits: 3 })
    expect(list.length).toBe(3015)
  })

  it('片段只用 \\d、[]、?、|、() 與數字(不用 {n}、不用大寫跳脫)', () => {
    for (let n = 0; n <= 999; n += 7) {
      for (const r of [{ min: n }, { max: n }, { min: n, max: Math.min(999, n + 37) }]) {
        const s = rangeRegex(r, { digits: 3 })
        expect(s).toMatch(/^[0-9d\\[\]\-?|()]*$/)
        expect(s).not.toMatch(/[{}]|\\D/)
      }
    }
  })
})

// ---- 可讀模式(第 35 步)----
// open:沒有 max = 沒有上界 → 對 0–9999 逐值比對(上界之上也要成立);其餘與 rangeRegex 同定義域,對 0–9999 比對(定義域外必須不中)。
const WIDE = Array.from({ length: 10000 }, (_, n) => n)

function readableMismatch (r: NumRange, o: NumOptions & { open?: boolean }): number {
  const src = readableRangeRegex(r, o)
  const re = new RegExp(`^(?:${src})$`)
  const openTop = o.open === true && r.max === undefined
  const top = openTop ? Infinity : domainMax(o.digits)
  for (const n of WIDE) {
    const want = n <= top && n >= (r.min ?? 0) && n <= (r.max ?? top)
    if (re.test(String(n)) !== want) return n
  }
  return -1
}

function checkReadable (r: NumRange, o: NumOptions & { open?: boolean }): void {
  const bad = readableMismatch(r, o)
  if (bad !== -1) throw new Error(`readable ${JSON.stringify(r)} ${JSON.stringify(o)}:N=${bad} 不一致(片段 ${readableRangeRegex(r, o)})`)
  const s = readableRangeRegex(r, o)
  // 使用者裁定:只寫 [0-9],不寫 \d;不用大寫跳脫;{n,} 只出現在開放上界
  expect(s).not.toMatch(/\\/)
  if (!(o.open === true && r.max === undefined)) expect(s).not.toMatch(/[{}]/)
  // 多位數不以 0 開頭(前界固定後,前導零的字串必須不中)
  const re = new RegExp(`^(?:${s})$`)
  for (let n = 1; n <= 999; n += 13) if (re.test('0' + String(n))) throw new Error(`readable ${s} 中了前導零 0${n}`)
}

describe('readableRangeRegex:例子(社群寫法同型)', () => {
  it('≥30 開放上界 = ([3-9][0-9]|[1-9][0-9]{2,})', () => {
    expect(readableRangeRegex({ min: 30 }, { digits: 3, open: true })).toBe('([3-9][0-9]|[1-9][0-9]{2,})')
  })
  it('≥5 開放上界 = ([5-9]|[1-9][0-9]{1,})(社群「怪物稀有度」同型)', () => {
    expect(readableRangeRegex({ min: 5 }, { digits: 3, open: true })).toBe('([5-9]|[1-9][0-9]{1,})')
  })
  it('≥100 / ≥10 開放上界 = [1-9][0-9]{2,} / [1-9][0-9]{1,}', () => {
    expect(readableRangeRegex({ min: 100 }, { digits: 3, open: true })).toBe('[1-9][0-9]{2,}')
    expect(readableRangeRegex({ min: 10 }, { digits: 3, open: true })).toBe('[1-9][0-9]{1,}')
  })
  it('≥16 有界(digits 2)= (1[6-9]|[2-9][0-9])', () => {
    expect(readableRangeRegex({ min: 16 }, { digits: 2 })).toBe('(1[6-9]|[2-9][0-9])')
  })
  it('≤50 / 區間仍用 ? 合併,首位不出現 0', () => {
    expect(readableRangeRegex({ max: 50 }, { digits: 3, open: true })).toBe('([1-4]?[0-9]|50)')
    expect(readableRangeRegex({ min: 60, max: 150 }, { digits: 3, open: true })).toBe('([6-9][0-9]|1[0-4][0-9]|150)')
  })
  it('空集合回空字串', () => {
    expect(readableRangeRegex({ min: 50, max: 10 }, { digits: 3, open: true })).toBe('')
    expect(readableRangeRegex({ min: 100 }, { digits: 2 })).toBe('')
  })
  it('最短模式 rangeRegex 不受影響(仍是 \\d 寫法)', () => {
    expect(rangeRegex({ min: 80 }, { digits: 3 })).toBe('([89]\\d|\\d\\d\\d)')
  })
})

describe('readableRangeRegex:逐值窮舉(0–9999)', () => {
  it('open:≥N(N = 0…999)', () => {
    for (let n = 0; n <= 999; n++) checkReadable({ min: n }, { digits: 3, open: true })
  })
  it('open:≤N(N = 0…999)與 3000 組 LCG 區間', () => {
    for (let n = 0; n <= 999; n++) checkReadable({ max: n }, { digits: 3, open: true })
    let seed = 777
    const rnd = (): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % 1000 }
    for (let i = 0; i < 3000; i++) {
      const a = rnd(); const b = rnd()
      checkReadable({ min: Math.min(a, b), max: Math.max(a, b) }, { digits: 3, open: true })
    }
  })
  it('有界 digits 1/2:≥N、≤N 與 digits 2 全部 5050 區間', () => {
    for (const digits of [1, 2] as const) {
      for (let n = 0; n <= domainMax(digits); n++) {
        checkReadable({ min: n }, { digits })
        checkReadable({ max: n }, { digits })
      }
    }
    for (let a = 0; a <= 99; a++) for (let b = a; b <= 99; b++) checkReadable({ min: a, max: b }, { digits: 2 })
  })
})
