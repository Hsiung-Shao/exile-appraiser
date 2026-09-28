import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import {
  diffSnapshots,
  fixtureLanguages,
  formatDiff,
  hasFixtures,
  listFixtures,
  readExpected,
  runFixture,
  writeExpected,
  MAINTAINED_LANGUAGES,
  UPDATE_MODE,
  type Fixture,
  type FixtureOutcome
} from './helpers/fixture-harness'

/**
 * 解析器的回歸網。
 *
 * 為什麼需要它:解析器每個賽季都得跟著 GGG 改措辭,而**改壞既有物品是靜默的** ——
 * 認不出來的詞綴會被收進 `unknownModifiers` 而不是拋錯,所以型別檢查、lint、
 * 建置全部照樣綠。唯一擋得住退步的方式是拿真實剪貼簿文字跑一遍、與人工核可過的
 * 快照逐欄比對。
 *
 * 更新快照:`UPDATE_FIXTURES=1 npm test`。
 * ⚠ **產生的快照必須人工 review 後才可 commit。** 盲目更新等於把回歸網拆掉 ——
 *   解析器壞掉時它會把錯誤的結果寫成「期望值」,測試從此永遠是綠的。
 *
 * ⚠ 兩個語系的資料集**不能同時載入**:`assets/data/index.ts` 用的是模組層級的
 *   `CLIENT_STRINGS` / `ITEM_BY_TRANSLATED` 等全域變數,載入第二個語系會蓋掉
 *   第一個。所以這裡在 beforeAll 裡逐一切換、跑完一個語系才換下一個。
 */

// 語系清單住在 harness 裡 —— 篩選器層的回歸網要用同一份。兩邊各寫一份的話,
// 補了新語系只會有一半的測試跟上,而測試依然全綠。
const MISSING_MAINTAINED = MAINTAINED_LANGUAGES.filter(l => !hasFixtures(l))
const COVERED = fixtureLanguages()

interface LanguageRun {
  fixtures: Fixture[]
  results: Array<{ fixture: Fixture, outcome: FixtureOutcome }>
}

const runs = new Map<string, LanguageRun>()

beforeAll(async () => {
  // `init` 會載入 en 的參照字典與掉落表,並驗證 `stat()` 宣告的每個 ref 都存在
  await init(COVERED[0] ?? 'en')
  for (const language of COVERED) {
    await loadForLang(language)
    const fixtures = await listFixtures(language)
    runs.set(language, {
      fixtures,
      results: fixtures.map(fixture => ({ fixture, outcome: runFixture(fixture) }))
    })
  }
}, 180_000)

describe('corpus 覆蓋範圍', () => {
  it('本專案維護的語系都有樣本', () => {
    // 全空的話下面每一項都會空轉通過 —— 那比沒有測試更危險
    expect(
      MISSING_MAINTAINED,
      MISSING_MAINTAINED.length === 0
        ? ''
        : `這些是本專案維護的語系,少了 fixture 等於沒有回歸保護:${MISSING_MAINTAINED.join(', ')}`
    ).toEqual([])
  })
})

for (const language of COVERED) {
  describe(`parser fixtures:${language}`, () => {
    const run = (): LanguageRun => {
      const value = runs.get(language)
      if (value === undefined) throw new Error(`${language} 的 corpus 尚未載入`)
      return value
    }

    it('這個語系的 corpus 非空', () => {
      // COVERED 已經篩掉沒有樣本的語系,但目錄裡若只剩 .expected.json
      // (.txt 被誤刪)也會讓下面每一項空轉通過,所以這裡再擋一次
      expect(run().fixtures.length).toBeGreaterThan(0)
    })

    it('全部 fixture 都能解析', () => {
      const failed = run().results
        .filter(r => r.outcome.kind !== 'parsed')
        .map(r => `${r.fixture.name}: ${(r.outcome as { error: string }).error}`)

      expect(
        failed,
        failed.length === 0 ? '' : `以下 ${failed.length} 件解析失敗:\n  ` + failed.join('\n  ')
      ).toEqual([])
    })

    it('快照與 *.expected.json 相符', async () => {
      const mismatches: string[] = []

      for (const { fixture, outcome } of run().results) {
        if (outcome.kind !== 'parsed') continue

        if (UPDATE_MODE) {
          await writeExpected(fixture, outcome.snapshot)
          continue
        }

        const expectedSnapshot = await readExpected(fixture)
        if (expectedSnapshot === undefined) {
          mismatches.push(`${fixture.name}: 缺少快照(用 UPDATE_FIXTURES=1 產生後人工 review)`)
          continue
        }

        const diffs = diffSnapshots(expectedSnapshot, outcome.snapshot)
        if (diffs.length > 0) {
          mismatches.push(`${fixture.name}:${diffs.length} 處欄位不符\n${formatDiff(diffs)}`)
        }
      }

      if (UPDATE_MODE) return
      expect(mismatches, mismatches.join('\n\n')).toEqual([])
    })

    it('未知詞綴被收集而非導致解析失敗', () => {
      for (const { fixture, outcome } of run().results) {
        if (outcome.kind !== 'parsed') continue
        expect(
          Array.isArray(outcome.item.unknownModifiers),
          `${fixture.name} 的 unknownModifiers 不是陣列`
        ).toBe(true)
      }
    })
  })
}
