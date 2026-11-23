"""把 GGPK 版本化資料庫的兩個快照匯出成 JSON,給 update.mjs 用。只讀。

  python dump_ggpk.py <ggpk_zh.sqlite> <out.json> [--old N] [--new N]

預設取最新兩個完整快照(version.complete = 1)。鍵都是語言無關的:
  stat = stat_ids | cond | src_file | dup_ix;base = baseitemtypes 的 Metadata 路徑。
"""
import json
import sqlite3
import sys


def main():
    args = sys.argv[1:]
    db, out = args[0], args[1]
    opt = dict(zip(args[2::2], args[3::2]))
    c = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    vers = [r[0] for r in c.execute('select id from version where complete = 1 order by id')]
    new = int(opt.get('--new', vers[-1]))
    older = [v for v in vers if v < new]
    old = int(opt.get('--old', older[-1] if older else new))

    def meta(v):
        r = c.execute('select id, game_version, ggpk_build, taken_at from version where id = ?', (v,)).fetchone()
        return dict(zip(('id', 'gameVersion', 'ggpkBuild', 'takenAt'), r))

    def stats(v):
        # handlers:遊戲顯示數值前的換算([["negate", 1]] = 第 1 個 stat 取負號後顯示);規則 21 用它判斷兩句的正負是否相反
        return [{'key': f'{i}|{cond}|{f}|{d}', 'en': en, 'zh': zh, 'handlers': json.loads(h or '[]')} for i, cond, f, d, en, zh, h in c.execute(
            'select stat_ids, cond, src_file, dup_ix, en, zh_tw, handlers from stat where version_id = ? '
            'order by stat_ids, cond, src_file, dup_ix', (v,))]

    def base(v):
        return [{'path': p, 'en': en, 'zh': zh} for p, en, zh in c.execute(
            "select ident, en, zh_tw from cell where version_id = ? and tbl = 'baseitemtypes' and col = 'Name' "
            'and ident is not null order by ident, row', (v,))]

    # 傳奇名稱(words 表沒有 Id 欄,英文名就是鍵)
    words = [{'en': en, 'zh': zh} for en, zh in c.execute(
        "select distinct en, zh_tw from cell where version_id = ? and tbl = 'words' and col = 'Text2' "
        'and same_as_en = 0 order by en, zh_tw', (new,))]

    # 寶石顯示名(變異寶石的名字不在 baseitemtypes)
    gems = [{'en': en, 'zh': zh} for en, zh in c.execute(
        "select distinct en, zh_tw from cell where version_id = ? and tbl = 'gemeffects' and col = 'Name' "
        'and same_as_en = 0 order by en, zh_tw', (new,))]

    # 主動技能顯示名與「賦予等級 {1} 的 {0}」句型(3.30 起「賦予技能」詞綴由句型 + 技能名組成)
    skills = [{'en': en, 'zh': zh} for en, zh in c.execute(
        "select distinct en, zh_tw from cell where version_id = ? and tbl = 'activeskills' and col = 'DisplayedName' "
        'and same_as_en = 0 order by en, zh_tw', (new,))]
    strings = {i: {'en': en, 'zh': zh} for i, en, zh in c.execute(
        "select ident, en, zh_tw from cell where version_id = ? and tbl = 'clientstrings' and col = 'Text' "
        "and ident in ('ModGrantsEffect', 'ModGrantsEffectWithLevel', 'ModGrantsSupportEffectWithLevel')", (new,))}
    # 輔助寶石顯示名(規則 15;有些輔助不是物品,名字只在 gemeffects.SupportName)
    supports = [{'en': en, 'zh': zh} for en, zh in c.execute(
        "select distinct en, zh_tw from cell where version_id = ? and same_as_en = 0 and en like '% Support' and "
        "((tbl = 'baseitemtypes' and col = 'Name') or (tbl = 'gemeffects' and col = 'SupportName')) order by en, zh_tw", (new,))]

    # 阿茲瓦特史記的房間名(規則 17)
    rooms = [{'en': en, 'zh': zh} for en, zh in c.execute(
        "select distinct en, zh_tw from cell where version_id = ? and tbl = 'incursionrooms' and col = 'Name' "
        'and same_as_en = 0 order by en, zh_tw', (new,))]

    # 英文名也改了的房間(同一個 ident 新舊兩版的 Name 不同)
    renames = [{'from': a, 'en': en, 'zh': zh} for a, en, zh in c.execute(
        "select distinct o.en, n.en, n.zh_tw from cell o join cell n on n.tbl = o.tbl and n.col = o.col and n.ident = o.ident "
        "where o.version_id = ? and n.version_id = ? and o.tbl = 'incursionrooms' and o.col = 'Name' and o.en <> n.en "
        'order by o.en, n.en', (old, new))]

    # 傭兵流派名(規則 23;ident = 交易站契約書的 type)
    builds = [{'ident': i, 'en': en, 'zh': zh} for i, en, zh in c.execute(
        "select ident, en, zh_tw from cell where version_id = ? and tbl = 'mercenarybuilds' and col = 'Name' "
        'and ident is not null order by ident', (new,))]

    # 傭兵技能名(規則 24;有些技能只在這張表,不在 activeskills,例如 3.30 的深淵噴濺)
    merc_skills = [{'en': en, 'zh': zh} for en, zh in c.execute(
        "select distinct en, zh_tw from cell where version_id = ? and tbl = 'mercenaryskills' and col = 'Name' "
        'and zh_tw is not null order by en, zh_tw', (new,))]

    # 天賦名(規則 25 改名、規則 26 禁忌珠寶新天賦)
    passives = [{'en': en, 'zh': zh} for en, zh in c.execute(
        "select distinct en, zh_tw from cell where version_id = ? and tbl = 'passiveskills' and col = 'Name' "
        'and zh_tw is not null order by en, zh_tw', (new,))]
    passive_renames = [{'en': n_en, 'from': o_zh, 'zh': n_zh} for n_en, o_zh, n_zh in c.execute(
        "select distinct n.en, o.zh_tw, n.zh_tw from cell o join cell n on n.tbl = o.tbl and n.col = o.col and n.ident = o.ident "
        "where o.version_id = ? and n.version_id = ? and o.tbl = 'passiveskills' and o.col = 'Name' "
        'and o.en = n.en and o.zh_tw <> n.zh_tw order by n.en', (old, new))]

    # 永恆珠寶的征服者名(規則 28;句型 {2} 帶入,3.30 才進資料庫)
    conquerors = [{'en': en, 'zh': zh} for en, zh in c.execute(
        "select distinct en, zh_tw from cell where version_id = ? and tbl = 'alternatetreeversionkeystones' and col = 'Conqueror' "
        'and zh_tw is not null order by en, zh_tw', (new,))]

    # 永恆珠寶的陣營名(row = 句型條件的版本號,local_unique_jewel_alternate_tree_version)
    factions = {r: {'en': en, 'zh': zh} for r, en, zh in c.execute(
        "select row, en, zh_tw from cell where version_id = ? and tbl = 'alternatetreeversions' and col = 'Name' "
        'and zh_tw is not null order by row', (new,))}

    data = {'old': meta(old), 'new': meta(new), 'conquerors': conquerors, 'factions': factions, 'builds': builds, 'mercSkills': merc_skills, 'words': words, 'gems': gems, 'skills': skills, 'supports': supports, 'rooms': rooms, 'renames': renames, 'strings': strings, 'passives': passives, 'passiveRenames': passive_renames,
            'stats': {'old': stats(old), 'new': stats(new)},
            'base': {'old': base(old), 'new': base(new)}}
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False)


if __name__ == '__main__':
    main()
