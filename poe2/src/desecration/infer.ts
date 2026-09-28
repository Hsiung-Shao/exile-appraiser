/**
 * exile-appraiser(WP-R):一般複製(沒有 `{ … (階層：N) }` 標頭)的褻瀆詞綴 → 推定 Tier。
 *
 * 規則(詳見 docs/desecration-tiers.md):
 * 1. 只處理 `info.type === Desecrated && info.tier == null` 的詞綴(進階複製的 Tier 以遊戲為準,不動)。
 * 2. 候選 = tiers.json 中「parts 的 stat hash 集合」與詞綴各 stat 的 trade id hash 一一對應的 entries(語言無關鍵)。
 * 3. profile = base_profiles[item.info.refName];查不到 → 同類別(ItemCategory → PoB 類別)的所有 profile。
 * 4. 每個候選 × profile:該 profile 有 Tier,且每個 stat 的 roll 落在 part 的 ranges 內(多個 `#` 取平均,
 *    與 parser `getRollOrMinmaxAvg` 同語意;極性翻轉的 part 比絕對值)。
 * 5. Tier 唯一 → `info.tier` + `tierInferred`;多個 → `tierCandidates`(顯示 `T2/T3`),`info.tier` 維持空。
 * 6. 一般複製把混合詞綴(hybrid)拆成多行、每行各一個 mod:先把同物品的單行褻瀆詞綴三三 / 兩兩組合去對
 *    多 part 的 entry(對得上就當混合詞綴),剩下的再逐行單獨推定。
 */
import type { ParsedItem } from "@/parser/ParsedItem";
import type { ParsedModifier } from "@/parser/advanced-mod-desc";
import type { ParsedStat } from "@/parser/stat-translations";
import { ModifierType } from "@/parser/modifiers";
import type {
  BaseProfiles,
  DesecrationCandidate,
  DesecrationEntry,
  DesecrationPool,
  DesecrationTiers,
} from "./types";

export interface DesecrationData {
  tiers: DesecrationTiers;
  baseProfiles: BaseProfiles;
}

interface Indexed {
  data: DesecrationData;
  byHash: Map<string, DesecrationEntry[]>;
  profilesByCategory: Map<string, string[]>;
}

const indexCache = new WeakMap<DesecrationData, Indexed>();

function indexed(data: DesecrationData): Indexed {
  let idx = indexCache.get(data);
  if (idx) return idx;
  const byHash = new Map<string, DesecrationEntry[]>();
  for (const entry of data.tiers.entries) {
    for (const hash of new Set(entry.parts.map((p) => p.stat_hash))) {
      let list = byHash.get(hash);
      if (!list) byHash.set(hash, (list = []));
      list.push(entry);
    }
  }
  const profilesByCategory = new Map<string, string[]>();
  for (const p of data.tiers.profiles) {
    let list = profilesByCategory.get(p.category);
    if (!list) profilesByCategory.set(p.category, (list = []));
    list.push(p.id);
  }
  idx = { data, byHash, profilesByCategory };
  indexCache.set(data, idx);
  return idx;
}

/** PoB 類別鍵(與產生器 `categoryKey` 相同):小寫、非英數 → `_` */
function categoryKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** ItemCategory 值 → PoB 類別(多數只差大小寫與空白) */
const CATEGORY_ALIASES: Record<string, string[]> = {
  warstaff: ["quarterstaff"],
  abyss_jewel: ["jewel"],
  buckler: ["shield"],
};

export function resolveProfiles(
  item: Pick<ParsedItem, "info" | "category">,
  data: DesecrationData,
): { profiles: string[]; exact: boolean } {
  const exact = data.baseProfiles.profiles[item.info.refName];
  if (exact) return { profiles: [exact], exact: true };
  const idx = indexed(data);
  if (item.category) {
    const key = categoryKey(item.category);
    const cats = CATEGORY_ALIASES[key] ?? [key];
    const out = cats.flatMap((c) => idx.profilesByCategory.get(c) ?? []);
    if (out.length) return { profiles: out, exact: false };
  }
  return { profiles: [], exact: false };
}

/** 一個 stat 可對接的 hash(trade id 的 `stat_<hash>`,不分 desecrated / explicit / …) */
function statHashes(stat: ParsedStat): Set<string> {
  const out = new Set<string>();
  for (const ids of Object.values(stat.stat.trade.ids)) {
    for (const id of ids) {
      const m = /\.stat_(\d+)(?:$|\|)/.exec(id);
      if (m) out.add(m[1]);
    }
  }
  return out;
}

const EPS = 1e-6;

/** 一個 part 的 ranges → 與 roll.value 同語意的 [lo, hi](多個 `#` 取平均) */
function partRange(part: DesecrationEntry["parts"][number]): [number, number] | null {
  if (!part.ranges || !part.ranges.length) return null;
  const n = part.ranges.length;
  const lo = part.ranges.reduce((s, r) => s + Math.min(r[0], r[1]), 0) / n;
  const hi = part.ranges.reduce((s, r) => s + Math.max(r[0], r[1]), 0) / n;
  return [lo, hi];
}

function rollFits(
  stat: ParsedStat,
  part: DesecrationEntry["parts"][number],
): boolean {
  const range = partRange(part);
  if (!range) return true; // 資料沒有範圍 → 不以數值排除(diagnostics 已列)
  if (!stat.roll) return true; // 無數值的 stat(如「擊中時暈眩」)只能靠 hash
  const [lo, hi] = range;
  const inRange = (v: number) => v >= lo - EPS && v <= hi + EPS;
  const v = stat.roll.value;
  if (inRange(v)) return true;
  // 極性翻轉(PoB「reduced」對模板「increased」)或反向 stat:數值帶負號,比絕對值
  if ((part.direction || stat.stat.trade.inverted) && inRange(Math.abs(v)))
    return true;
  return false;
}

/**
 * stats ↔ entry.parts 的一一對應(以 hash);回傳 stats 同序的 part,對不上回 null。
 * part 數與 stat 數必須相等(多行模板在產生器已接回單一 part)。
 */
function assignParts(
  stats: ParsedStat[],
  entry: DesecrationEntry,
): Array<DesecrationEntry["parts"][number]> | null {
  if (entry.parts.length !== stats.length) return null;
  const hashes = stats.map(statHashes);
  const used = new Array<boolean>(entry.parts.length).fill(false);
  const out: Array<DesecrationEntry["parts"][number]> = [];
  const dfs = (i: number): boolean => {
    if (i === stats.length) return true;
    for (let j = 0; j < entry.parts.length; j++) {
      if (used[j] || !hashes[i].has(entry.parts[j].stat_hash)) continue;
      if (!rollFits(stats[i], entry.parts[j])) continue;
      used[j] = true;
      out[i] = entry.parts[j];
      if (dfs(i + 1)) return true;
      used[j] = false;
    }
    return false;
  };
  return dfs(0) ? out : null;
}

/** 對一組 stats 找出所有 (entry, profile) 候選 */
export function matchStats(
  stats: ParsedStat[],
  profiles: string[],
  data: DesecrationData,
): DesecrationCandidate[] {
  if (!stats.length) return [];
  const idx = indexed(data);
  const seen = new Set<DesecrationEntry>();
  const out: DesecrationCandidate[] = [];
  for (const hash of statHashes(stats[0])) {
    for (const entry of idx.byHash.get(hash) ?? []) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      const parts = assignParts(stats, entry);
      if (!parts) continue;
      const tiers = new Set<number>();
      for (const p of profiles) {
        const t = entry.profile_tiers[p];
        if (t != null) tiers.add(t);
      }
      for (const tier of tiers) {
        out.push({
          tier,
          pool: entry.pool,
          gods: entry.gods,
          modId: entry.mod_id,
          ranges: parts.map(partRange),
        });
      }
    }
  }
  return dedupe(out);
}

function dedupe(list: DesecrationCandidate[]): DesecrationCandidate[] {
  const seen = new Set<string>();
  return list
    .filter((c) => {
      const k = `${c.tier}|${c.pool}|${c.gods?.join('+') ?? ''}|${JSON.stringify(c.ranges)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.tier - b.tier || a.pool.localeCompare(b.pool));
}

function apply(
  mods: ParsedModifier[],
  statsOrder: Array<{ mod: ParsedModifier; statIndex: number }>,
  candidates: DesecrationCandidate[],
  profileExact: boolean,
) {
  const tiers = [...new Set(candidates.map((c) => c.tier))].sort(
    (a, b) => a - b,
  );
  const pools = [...new Set(candidates.map((c) => c.pool))];
  for (const mod of mods) {
    const info = mod.info;
    info.tierInferred = true;
    info.inferredCandidates = candidates.map((c) => ({
      ...c,
      // 只保留屬於這個 mod 的 stat 的範圍(hybrid 拆行時每行各自一個 mod)
      ranges: statsOrder
        .map((s, i) => (s.mod === mod ? c.ranges[i] : undefined))
        .filter((r): r is [number, number] | null => r !== undefined),
    }));
    info.profileExact = profileExact;
    if (tiers.length === 1) {
      info.tier = tiers[0];
      info.tierCandidates = undefined;
    } else {
      info.tierCandidates = tiers;
    }
    info.pool = pools.length === 1 ? pools[0] : undefined;
    // ranges:所有候選範圍相同才給(tooltip 另外列出各候選)
    const own = info.inferredCandidates.map((c) => JSON.stringify(c.ranges));
    info.ranges =
      own.length && own.every((r) => r === own[0])
        ? info.inferredCandidates[0].ranges
        : undefined;
  }
}

/** 主入口:就地改寫 `item.newMods` 中褻瀆詞綴的 info;回傳推定到的 mod 數 */
export function inferDesecratedTiersWith(
  item: ParsedItem,
  data: DesecrationData,
): number {
  const targets = item.newMods.filter(
    (m) =>
      m.info.type === ModifierType.Desecrated &&
      m.info.tier == null &&
      m.stats.length > 0,
  );
  if (!targets.length) return 0;
  const { profiles, exact } = resolveProfiles(item, data);
  if (!profiles.length) return 0;

  let inferred = 0;

  // hybrid 拆行:一般複製把混合詞綴拆成每行一個 mod。先試三三 / 兩兩組合對多 part 的 entry ——
  // 否則「增加#%物理傷害」這種單行也對得到一般池的單 part 詞綴,混合詞綴就永遠組不回來。
  // 代價:兩條各自獨立的褻瀆詞綴恰好湊成某個混合詞綴(hash 與數值範圍都吻合)時會被當成混合(docs 已記)。
  const singles = targets.filter((m) => m.stats.length === 1);
  for (const size of [3, 2]) {
    for (const combo of combinations(singles, size)) {
      if (combo.some((m) => m.info.tierInferred)) continue;
      const stats = combo.map((m) => m.stats[0]);
      const cands = matchStats(stats, profiles, data);
      if (!cands.length) continue;
      apply(
        combo,
        combo.map((mod) => ({ mod, statIndex: 0 })),
        cands,
        exact,
      );
      inferred += combo.length;
    }
  }

  for (const mod of targets) {
    if (mod.info.tierInferred) continue;
    const cands = matchStats(mod.stats, profiles, data);
    if (!cands.length) continue;
    apply(
      [mod],
      mod.stats.map((_, statIndex) => ({ mod, statIndex })),
      cands,
      exact,
    );
    inferred++;
  }
  return inferred;
}

function* combinations<T>(list: T[], k: number): Generator<T[]> {
  const n = list.length;
  if (k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map((i) => list[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

export type { DesecrationPool };
