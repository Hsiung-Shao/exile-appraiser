// regex_selftest.cpp:55 `Rng`:可重現的 LCG(刻意不用平台亂數,失敗可從種子重現)。
//   next():s = s * 1664525 + 1013904223(mod 2^32),回傳 s >> 8
//   below(n):n <= 0 → 0,否則 next() % n
export class Rng {
  s: number
  constructor (seed: number) { this.s = seed >>> 0 }
  next (): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0
    return this.s >>> 8
  }

  below (n: number): number {
    return n <= 0 ? 0 : this.next() % n
  }
}

/** regex_selftest.cpp:715–723 的抽樣:不重複的 `count` 個索引(不足就全取),依抽中順序 */
export function samplePicks (seed: number, size: number, count: number): number[] {
  const rng = new Rng(seed)
  const want = Math.min(size, count)
  const sel: number[] = []
  while (sel.length < want) {
    const i = rng.below(size)
    if (!sel.includes(i)) sel.push(i)
  }
  return sel
}
