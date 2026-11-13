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
    old = int(opt.get('--old', vers[-2] if len(vers) > 1 else new))

    def meta(v):
        r = c.execute('select id, game_version, ggpk_build, taken_at from version where id = ?', (v,)).fetchone()
        return dict(zip(('id', 'gameVersion', 'ggpkBuild', 'takenAt'), r))

    def stats(v):
        return [{'key': f'{i}|{cond}|{f}|{d}', 'en': en, 'zh': zh} for i, cond, f, d, en, zh in c.execute(
            'select stat_ids, cond, src_file, dup_ix, en, zh_tw from stat where version_id = ? '
            'order by stat_ids, cond, src_file, dup_ix', (v,))]

    def base(v):
        return [{'path': p, 'en': en, 'zh': zh} for p, en, zh in c.execute(
            "select ident, en, zh_tw from cell where version_id = ? and tbl = 'baseitemtypes' and col = 'Name' "
            'and ident is not null order by ident, row', (v,))]

    data = {'old': meta(old), 'new': meta(new),
            'stats': {'old': stats(old), 'new': stats(new)},
            'base': {'old': base(old), 'new': base(new)}}
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False)


if __name__ == '__main__':
    main()
