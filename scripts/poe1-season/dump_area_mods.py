# PoE1 賽季資料更新:從本機 GGPK 抽取的 Mods.dat 列出地圖區域詞綴(規則 24,給地圖詞綴檢查清單補 fromAreaMods)。
#
#   python dump_area_mods.py <pob-zh-engine/tools/ggpk_zh> <out.json>
#
# 讀 <ggpk_zh>/cache/data_all/data/{mods,stats}.datc64 + <ggpk_zh>/schema/schema.min.json,用同目錄的 datzh.py 解析(不另寫一份 dat 讀取器)。
# 輸出 {"gameVersion": ..., "mods": [{"id", "stats": [stat id...], "heist": bool}]}:domain AREA / HEIST_AREA、generation type 前綴 / 後綴。
import json
import struct
import sys
from pathlib import Path

root = Path(sys.argv[1])
sys.path.insert(0, str(root))
import datzh  # noqa: E402

DATA = root / 'cache' / 'data_all' / 'data'
schema = datzh.load_schema(root / 'schema' / 'schema.min.json')
cols = datzh.schema_index(schema, 1)['mods']
enums = {e['name']: e for e in schema['enumerations']}


def enum_value(name: str, label: str) -> int:
    e = enums[name]
    return e['enumerators'].index(label) + e.get('indexing', 0)


offset, pos = {}, 0
for c in cols:
    offset[c.get('name')] = pos
    pos += datzh.col_size(c)

AREA, HEIST = enum_value('ModDomains', 'AREA'), enum_value('ModDomains', 'HEIST_AREA')
AFFIX = {enum_value('ModGenerationType', 'PREFIX'), enum_value('ModGenerationType', 'SUFFIX')}
STAT_COLS = [v for k, v in offset.items() if k and k.startswith('StatsKey')]

mods = datzh.Table(DATA / 'mods.datc64')
stats = datzh.Table(DATA / 'stats.datc64')
if datzh.schema_row_size(cols) > mods.row_size:
    sys.exit(f'Mods.dat 列寬 {mods.row_size} 比 schema {datzh.schema_row_size(cols)} 小,schema 不符')


def u32(row: int, off: int) -> int:
    return struct.unpack_from('<I', mods.data, mods.cell_offset(row, off))[0]


out = []
for r in range(mods.rows):
    domain = u32(r, offset['Domain'])
    if domain not in (AREA, HEIST) or u32(r, offset['GenerationType']) not in AFFIX:
        continue
    ids = []
    for off in STAT_COLS:
        (i,) = struct.unpack_from('<Q', mods.data, mods.cell_offset(r, off))
        if i < stats.rows:
            ids.append(stats.read_string(i, 0))
    if ids:
        out.append({'id': mods.read_string(r, 0), 'stats': ids, 'heist': domain == HEIST})

source = json.loads((root / 'cache' / 'SOURCE.json').read_text(encoding='utf-8'))
Path(sys.argv[2]).write_text(json.dumps({'gameVersion': source.get('game_version'), 'mods': out}), encoding='utf-8')
print(f'[area-mods] {source.get("game_version")}:{len(out)} 條地圖區域詞綴')
