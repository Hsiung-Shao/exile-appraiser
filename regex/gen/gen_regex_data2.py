#!/usr/bin/env python3
"""Build the regex tool's PoE2 data file: host/data/regex_poe2.json.

Same output schema as gen_regex_data.py, same three rules (numbers are not part
of the text, the unit is the printed LINE, aggregated properties are not lines),
and the same machinery -- regex_common.py holds the statdescription matcher,
the page builder and the checks, shared rather than copied, because two
readers of one byte layout that drift apart are a silent data bug.

Pages (PAGES below):

    Waystones  換界石   Domain 6,  tags map_key_*
    Tablets    碑牌     Domain 34, tags tower_augment_*
    Relics     聖物     Domain 8,  tags *_sanctum_relic
    Remnants   探險遺物 Domain 29, tags expedition_*
    Flasks / charms     Domain 2                        (schema 2)
    Gems       寶石名稱  SkillGems -> BaseItemTypes       (schema 2, names)
    Bases      物品基底  BaseItemTypes by item class      (schema 2, names)

Two things PoE1 does not have:

  * GGG markup. PoE2 statdescriptions carry [Key|Display] / [Key] spans
    ("增加#%此區域找到的物品[Rarity|稀有度]"). The game prints the display half,
    and the search box matches what is printed, so the markup is stripped HERE
    rather than at display time.

  * the aggregate list is per page, not global. On a waystone
    map_monster_potency_+% is part of the summed property block the base item
    prints once; on a tablet the very same stat is a whole modifier line
    (TowerMonsterEffectiveness1, 繁中「挑戰者的」). One global name list of the
    PoE1 kind would empty the tablet page.

Sources, in the order the project's data rules put them:

  * Mods / Stats / Tags / Words .datc64 out of tools/ggpk2_zh/cache (the PoE2
    GGPK); Mods through the hand-derived offsets below, every other table
    through the community schema with its row size checked first
  * tools/ggpk2_zh/out/poe2/stats.json for the wording -- the audited English /
    Chinese statdescription pairing produced by extract_poe2.py.

Run:  python tools/gen_regex_data2.py              writes host/data/regex_poe2.json (schema 2)
      python tools/gen_regex_data2.py --schema 1   the old four-page file
      python tools/gen_regex_data2.py --report     prints a sample, writes nothing
      python tools/gen_regex_data2.py --diag       prints what was dropped and why
"""
from __future__ import annotations

import argparse
import os
import json
import sys
import time
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent.parent   # exile-appraiser: repo 根目錄(本檔在 regex/gen/)
# exile-appraiser: GGPK 抽取資料(cache / schema / out)仍在 pob-zh-engine 的 tools/,由環境變數 POB_ZH_ENGINE 指定
TOOLS = Path(os.environ.get("POB_ZH_ENGINE") or ROOT.parent / "Pob2" / "pob-zh-engine") / "tools"
sys.path.insert(0, str(HERE))
import datzh              # noqa: E402
from regex_common import (   # noqa: E402  (shared, deliberately)
    GEN_PREFIX, GEN_SUFFIX, SchemaTables, VENDOR_FOLDERS, add_unique, build_mod_page,
    build_vendor_bases, clean_desc, client_lines, diagnose_pages, get_bases,
    group_by_generation, joined_tags, labels_doc, load_table, names_entries, page_doc,
    page_summary, read_fkey, read_fkey_array, read_i32, read_i32_array, roll_digits,
    scrub_hidden_against_printed, seam_words, self_check, self_check_v2, strip_markup,
    unwrap_style, usable_name, write_doc,
    Wording, get_wording, split_lines,   # tablet_ambient: the implicit wordings
    add_item_texts, check_no_markup, item_texts, strip_page_markup)

SCHEMA_PATH = TOOLS / "ggpk2_zh" / "schema" / "poe2_schema.json"   # PoE2-only copy; PoE1 keeps ggpk_zh's
DATA_EN = TOOLS / "ggpk2_zh" / "cache" / "data" / "balance"
DATA_TC = DATA_EN / "traditional chinese"
STATS_JSON = TOOLS / "ggpk2_zh" / "out" / "poe2" / "stats.json"
TABLES_DIR = TOOLS / "ggpk2_zh" / "out" / "poe2" / "tables"
OUT_PATH = ROOT / "data" / "regex" / "regex_poe2.json"

# Client strings every item of a page prints; see gen_regex_data.py for why
# they matter. PoE2's carry [Key|Display] markup, stripped like the lines are.
# There is no reminder text in PoE2 (the table ships two dummy rows), so the
# hidden text here is the advanced description, the tags and the name seam.
AMBIENT_COMMON_IDS = [
    "ItemLevelPopup", "ItemPopupCorrupted", "ItemPopupUnidentified", "ItemPopupMirrored",
    "ModDescriptionLineTier", "ModDescriptionLineImplicit", "ModDescriptionLineUnique",
    "UnifiedCraftingCategoryPrefix", "UnifiedCraftingCategorySuffix",
    "ItemDisplayStringRarity", "ItemPopupRequirements",
]
AMBIENT_WAYSTONE_IDS = AMBIENT_COMMON_IDS + [
    "ItemDisplayMapTier", "ItemDisplayMapItemRarity", "ItemDisplayMapPack",
    "ItemDisplayMapMonsterRarity", "ItemDisplayMapWaystoneDropChance",
    "ItemDisplayMapExperienceGained", "ItemDisplayMapMagicMonsterQuantityBonus",
    "ItemDisplayMapRareMonsterQuantityBonus", "ItemDisplayMapMonsterEffectiveness",
    "ItemDescriptionMap", "Quality",
]
# A tablet also prints its class line (物品種類: 碑牌) and its rarity value
# (稀有度: 稀有); the class NAME comes from ItemClasses in tablet_ambient().
AMBIENT_TABLET_IDS = AMBIENT_COMMON_IDS + [
    "ItemDescriptionPrecursorTablet", "ItemDisplayStringClass",
    "ItemDisplayStringNormal", "ItemDisplayStringMagic",
    "ItemDisplayStringRare", "ItemDisplayStringUnique",
]
AMBIENT_RELIC_IDS = AMBIENT_COMMON_IDS + ["ItemDescriptionSanctumRelic",
                                          "ItemDescriptionSanctumSpecialRelic"]
AMBIENT_REMNANT_IDS = AMBIENT_COMMON_IDS + ["ExpeditionModsTitle"]
AMBIENT_ITEM_IDS = AMBIENT_COMMON_IDS + ["Quality", "Level", "ItemDisplayStringSockets",
                                         "ItemDisplayStringClass"]

# Labels the exile-appraiser algorithmic pages build terms from (schema 2).
LABEL_IDS = [
    "ItemDisplayMapTier", "ItemDisplayMapItemRarity", "ItemDisplayMapPack",
    "ItemDisplayMapMonsterRarity", "ItemDisplayMapWaystoneDropChance",
    "ItemDisplayMapMagicMonsterQuantityBonus", "ItemDisplayMapRareMonsterQuantityBonus",
    "ItemDisplayMapExperienceGained", "ItemDisplayMapMonsterEffectiveness",
    "ItemLevelPopup", "Quality", "ItemDisplayStringSockets", "Level", "ItemPopupCorrupted",
    # rarity row of the numeric section (exile-appraiser step 35; was labels.<game>.json there)
    "ItemDisplayStringRarity", "ItemDisplayStringNormal", "ItemDisplayStringMagic",
    "ItemDisplayStringRare", "ItemDisplayStringUnique",
]

# Tags (row 44 bytes) and Words (row 64 bytes) follow the community schema in
# PoE2; only Mods does not. Asserted in check_layout() all the same.
TAGS_ROW_SIZE = 44
O_TAG_DISPLAY = 12                   # DisplayString: what PoE1 keeps in Name
WORDS_ROW_SIZE = 64
O_WORD_LIST = 0
O_WORD_TEXT = 4                      # English in both language files
O_WORD_SPAWN_TAGS = 12
O_WORD_SPAWN_VALS = 28
O_WORD_TEXT2 = 48                    # the translation, in the language file

# --- the Mods row layout ------------------------------------------------------
# The community dat-schema does NOT describe this table correctly for the shipped
# PoE2 build: it computes a 645-byte row where the file has 693 (677 before the
# 4.5.5 cache refresh). Blocks are missing, and every offset after the first one
# is wrong -- reading SpawnWeight at the schema's offset silently yields empty
# tag lists, which reads exactly like "this modifier can no longer roll".
#
# These offsets were recovered by anchoring on columns that can be checked from
# the outside (Id and Name decode as text; Domain lands in 1..40; the spawn tag
# and weight arrays must have equal length on all rows) and are asserted in
# check_layout() below, so the day GGG moves the layout this fails loudly.
#
#   126..157  Stat1Min/Max .. Stat4Min/Max  (schema calls these four Stat*Value,
#             i.e. it is 16 bytes short here -- that is the first missing block)
#   2026-09-29: the row grew 677 -> 693 somewhere between SpawnWeight_Tags (158,
#             unchanged) and ImplicitTags; ImplicitTags 507 -> 523 and
#             SpawnWeight_Values 661 -> 677, found by the same equal-length
#             anchor (the only array pair of equal length on all 16784 rows is
#             158/677) and the ImplicitTags assertion below.
ROW_SIZE      = 693
O_ID          = 0
O_STAT        = (30, 46, 62, 78)     # foreignrow -> Stats
O_DOMAIN      = 94
O_NAME        = 98
O_GENTYPE     = 106
O_STAT_MIN    = 126                  # min at O_STAT_MIN + i*8, max 4 bytes later
O_SPAWN_TAGS  = 158                  # foreignrow[] -> Tags
# ImplicitTags: the schema says 475; that is before the missing blocks, and
# reading there yields no arrays at all. Checked the same way as the spawn
# arrays: every reference in range, most rows non-empty.
O_IMPLICIT_TAGS = 523                # foreignrow[] -> Tags
O_SPAWN_VALS  = 677                  # i32[], same length as the tag array


# --- readers ------------------------------------------------------------------

def _fkeys(t: datzh.Table, row: int, off: int) -> list[int]:
    """Null references kept as -1 so the array zips against its weights."""
    return read_fkey_array(t, row, off, keep_null=True)


class ModReader:
    """The PoE2 modifier rows in both languages, with their spawn tags."""

    def __init__(self):
        self.en = datzh.Table(DATA_EN / "mods.datc64")
        self.tc = datzh.Table(DATA_TC / "mods.datc64")
        st = datzh.Table(DATA_EN / "stats.datc64")
        tg = datzh.Table(DATA_EN / "tags.datc64")
        tg_tc = datzh.Table(DATA_TC / "tags.datc64")
        self.stat_id = [st.read_string(r, 0) for r in range(st.rows)]
        self.tag_id = [tg.read_string(r, 0) for r in range(tg.rows)]
        self.tags_en, self.tags_tc = tg, tg_tc
        self.words_en = datzh.Table(DATA_EN / "words.datc64")
        self.words_tc = datzh.Table(DATA_TC / "words.datc64")
        self.check_layout()
        self.tag_name = [(unwrap_style(strip_markup(tg_tc.read_string(r, O_TAG_DISPLAY))),
                          unwrap_style(strip_markup(tg.read_string(r, O_TAG_DISPLAY))))
                         for r in range(tg.rows)]

    def check_layout(self) -> None:
        """Refuse to run on a table this file's offsets do not describe.

        Every check here is something that cannot be true by accident: a wrong
        offset produces out-of-range domains or ragged spawn arrays long before
        it produces a plausible-looking data file.
        """
        t = self.en
        if t.row_size != ROW_SIZE:
            raise SystemExit(
                f"Mods row is {t.row_size} bytes, this script describes {ROW_SIZE}. "
                "The PoE2 table layout moved; re-derive the offsets before trusting "
                "anything below (see the comment above ROW_SIZE).")
        if self.tc.rows != t.rows:
            raise SystemExit(f"mods row count differs: en={t.rows} tc={self.tc.rows}")
        ragged = bad_domain = 0
        implicit_rows = bad_implicit = 0
        for r in range(t.rows):
            if not 1 <= read_i32(t, r, O_DOMAIN) <= 40:
                bad_domain += 1
            if len(_fkeys(t, r, O_SPAWN_TAGS)) != len(read_i32_array(t, r, O_SPAWN_VALS)):
                ragged += 1
            imp = _fkeys(t, r, O_IMPLICIT_TAGS)
            if imp:
                implicit_rows += 1
            if any(k >= len(self.tag_id) for k in imp):
                bad_implicit += 1
        if bad_domain or ragged:
            raise SystemExit(
                f"Mods layout check failed: {bad_domain} rows with an out-of-range "
                f"Domain, {ragged} rows whose spawn tag and weight arrays differ in "
                "length. The offsets in this file no longer match the shipped table.")
        # A wrong ImplicitTags offset reads as "no tags anywhere" or as
        # references past the end of Tags; neither is what a live table does
        # (10,310 of 16,679 rows carried tags when this was derived).
        if bad_implicit or implicit_rows < 1000:
            raise SystemExit(
                f"Mods ImplicitTags check failed at offset {O_IMPLICIT_TAGS}: "
                f"{implicit_rows} rows with tags, {bad_implicit} rows referencing past "
                "the end of Tags. Re-derive the offset before trusting the hidden text.")
        if self.tags_en.row_size != TAGS_ROW_SIZE or self.tags_tc.rows != self.tags_en.rows:
            raise SystemExit(
                f"Tags row is {self.tags_en.row_size} bytes (expected {TAGS_ROW_SIZE}) or "
                "the language files differ in length; DisplayString offset unverified.")
        w = self.words_en
        if w.row_size != WORDS_ROW_SIZE or self.words_tc.rows != w.rows:
            raise SystemExit(
                f"Words row is {w.row_size} bytes (expected {WORDS_ROW_SIZE}) or the "
                "language files differ in length; the name words cannot be read.")
        for r in range(w.rows):
            if len(_fkeys(w, r, O_WORD_SPAWN_TAGS)) != len(read_i32_array(w, r, O_WORD_SPAWN_VALS)):
                raise SystemExit(f"Words row {r}: spawn tag and weight arrays differ in length")

    def affix_rows(self, domains: set[int], gens: set[int], need_live: bool = True):
        """(row, generation type, live spawn tags) for the domains' modifiers."""
        t = self.en
        for r in range(t.rows):
            if read_i32(t, r, O_DOMAIN) not in domains:
                continue
            gen = read_i32(t, r, O_GENTYPE)
            if gen not in gens:
                continue
            tags = _fkeys(t, r, O_SPAWN_TAGS)
            weights = read_i32_array(t, r, O_SPAWN_VALS)
            live = {self.tag_id[k] for k, w in zip(tags, weights)
                    if w > 0 and 0 <= k < len(self.tag_id)}
            if live or not need_live:
                yield r, gen, live

    def domain(self, r: int) -> int:
        return read_i32(self.en, r, O_DOMAIN)

    def stats_of(self, r: int, n: int = 4) -> list[tuple[str, int, int]]:
        out = []
        for i, off in enumerate(O_STAT[:n]):
            k = read_fkey(self.en, r, off)
            if k is None or k >= len(self.stat_id):
                continue
            out.append((self.stat_id[k],
                        read_i32(self.en, r, O_STAT_MIN + i * 8),
                        read_i32(self.en, r, O_STAT_MIN + i * 8 + 4)))
        return out

    def mod_id(self, r: int) -> str:
        return self.en.read_string(r, O_ID)

    def affix_name(self, r: int) -> tuple[str, str]:
        return (self.tc.read_string(r, O_NAME), self.en.read_string(r, O_NAME))

    def implicit_tags(self, r: int) -> list[tuple[str, str]]:
        """(chinese, english) display names of the modifier's implicit tags;
        nameless tags (most of them) skipped."""
        out = []
        for k in _fkeys(self.en, r, O_IMPLICIT_TAGS):
            if 0 <= k < len(self.tag_name):
                zh, en = self.tag_name[k]
                if zh or en:
                    out.append((zh, en))
        return out

    def words(self, tag: str) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
        """The random words a rare item of this kind is named from, as in
        gen_regex_data.ModReader.words: (prefix, suffix) of (chinese, english),
        suffixes keeping their leading space."""
        prefix, suffix = [], []
        en, tc = self.words_en, self.words_tc
        for r in range(en.rows):
            wl = read_i32(en, r, O_WORD_LIST)
            if wl not in (1, 2):
                continue
            tags = _fkeys(en, r, O_WORD_SPAWN_TAGS)
            weights = read_i32_array(en, r, O_WORD_SPAWN_VALS)
            if not any(0 <= k < len(self.tag_id) and self.tag_id[k] == tag and w > 0
                       for k, w in zip(tags, weights)):
                continue
            pair = (tc.read_string(r, O_WORD_TEXT2), en.read_string(r, O_WORD_TEXT))
            (prefix if wl == 1 else suffix).append(pair)
        return prefix, suffix


def client_lines2(text: str) -> list[str]:
    """PoE2 client strings carry [Key|Display] markup on top of everything the
    PoE1 ones do."""
    return client_lines(strip_markup(text))


class Extras:
    def __init__(self):
        self.cs = load_table(TABLES_DIR, "clientstrings", "Text")
        bases = load_table(TABLES_DIR, "baseitemtypes", "Name")
        pick = lambda pred: sorted({(t, e) for k, (e, t) in bases.items() if pred(k)})
        self.bases = {
            "waystone_mods": sorted({(roll_digits(t), roll_digits(e)) for t, e in
                                     pick(lambda k: k.startswith("Metadata/Items/Maps/MapKeyTier"))}),
            "tablet_mods": pick(lambda k: k.startswith("Metadata/Items/TowerAugment/")),
            "relic_mods": pick(lambda k: k.startswith("Metadata/Items/Relics/SanctumRelic")),
            "expedition_relic_mods": [],
        }
        for page, names in self.bases.items():
            if page != "expedition_relic_mods" and not names:
                raise SystemExit(f"no base item names found for {page}")
        for key in ("ModDescriptionLinePrefix", "ModDescriptionLineSuffix",
                    "ModDescriptionLineTier"):
            if key not in self.cs:
                raise SystemExit(f"client string {key} missing; cannot build the advanced line")

    @staticmethod
    def clean_name(s: str) -> str:
        return strip_markup(s).strip()

    @staticmethod
    def clean_line(s: str) -> str:
        return strip_markup(s).strip()

    def advanced_line(self, gen: int, zh_affix: str, en_affix: str) -> tuple[str, str]:
        key = "ModDescriptionLinePrefix" if gen == GEN_PREFIX else "ModDescriptionLineSuffix"
        en_head, zh_head = self.cs[key]
        en_tier, zh_tier = self.cs["ModDescriptionLineTier"]
        zh = strip_markup(zh_head.replace("{0}", zh_affix) + zh_tier.replace("{0}", "#"))
        en = strip_markup(en_head.replace("{0}", en_affix) + en_tier.replace("{0}", "#"))
        return zh.strip(), en.strip()

    @staticmethod
    def reminder_lines(_ids: list[str]) -> tuple[list[str], list[str]]:
        # PoE2 ships no reminder text (two dummy rows); nothing to add.
        return [], []

    def ambient(self, ids: list[str]) -> tuple[list[str], list[str]]:
        zh, en = [], []
        for i in ids:
            if i not in self.cs:
                print(f"warning: client string {i} not found; ambient text is short by one line")
                continue
            e, t = self.cs[i]
            add_unique(en, client_lines2(e))
            add_unique(zh, client_lines2(t))
        return zh, en


# --- grouping -------------------------------------------------------------------

TABLET_TAG_GROUP = {
    "tower_augment_breach": 1,
    "tower_augment_expedition": 2,
    "tower_augment_delirium": 3,
    "tower_augment_ritual": 4,
    "tower_augment_abyss": 5,
    "tower_augment_map_boss": 6,
    "tower_augment_incursion": 7,
}


def group_by_tablet(_gens: set[int], tags: set[str], _mod_ids: list[str]) -> int:
    """Which tablet the line can appear on.

    A breach tablet only rolls breach modifiers, so knowing the tablet is most of
    knowing where to look. A line reachable from more than one tablet is filed
    under 通用 -- that is what it is, not a failure to classify. So is a line
    one of whose modifiers is `default`-tagged: the Overseer tablet's suffix
    「地圖內含有額外的一個精髓」 prints the same line as the any-tablet prefix
    (TowerAdditionalEssence1), and filing it under 總督 would hide it from
    every other tablet (poe2db lists it under 基礎 on all eight).
    """
    if "default" in tags:
        return 0
    groups = {TABLET_TAG_GROUP[t] for t in tags if t in TABLET_TAG_GROUP}
    return groups.pop() if len(groups) == 1 else 0


def group_by_remnant(_gens: set[int], _tags: set[str], mod_ids: list[str]) -> int:
    """Expedition remnants are picked for their upside despite their downside,
    and the modifier ids are the only place that distinction is recorded."""
    kinds = {("Upside" in m) for m in mod_ids if "Upside" in m or "Downside" in m}
    if kinds == {True}:
        return 0
    if kinds == {False}:
        return 1
    return 2


CHARM_TAGS = {"utility_flask", "charm"}
FLASK_TAGS = {"flask", "life_flask", "mana_flask"}


def group_flask_charm(gens: set[int], tags: set[str], _mod_ids: list[str]) -> int:
    """藥劑前綴 / 藥劑後綴 / 護符前綴 / 護符後綴 / 共用. A line whose modifiers
    spawn only on charms (tag utility_flask / charm) or only on life/mana
    flasks goes to that side; `default`-only lines roll on both."""
    charm, flask = bool(tags & CHARM_TAGS), bool(tags & FLASK_TAGS)
    gen = group_by_generation(gens, tags, _mod_ids)
    if charm and not flask:
        return 2 + gen if gen < 2 else 4
    if flask and not charm:
        return gen if gen < 2 else 4
    return 4


GEN_IMPLICIT = 3


def tablet_ambient(ctx) -> tuple[list[str], list[str]]:
    """Printed text every tablet carries besides its rolled modifiers, as
    (zh lines, en lines) for the tablet page's ambient text.

      * the implicit of each tablet kind (TowerAdd<X>ToMapsImplicit, Domain 34,
        GenerationType 3): 「在地圖內加入一個卡爾葛墓地」 + 「剩餘#次使用次數」.
        The uses count goes down to 1 as the tablet is used, so every wording
        the 1..N range can print is taken -- every fitting variant of the
        block, whatever its line count (the Overseer one prints a single
        line at 1 and two lines above it, which lines_alt alone would drop).
        The *Unique rows (unique tablets) are a separate matter and skipped.
      * the item class name (物品種類: 碑牌), from ItemClasses.
    """
    mr, ex = ctx.mr, ctx.ex
    spec = next(p for p in PAGES if p["id"] == "tablet_mods")
    w = get_wording(ctx.blocks, spec["files"], ctx.wording)
    zh: list[str] = []
    en: list[str] = []

    def take(z_lines, e_lines):
        add_unique(zh, [s for s in (ex.clean_line(x) for x in z_lines) if s])
        add_unique(en, [s for s in (ex.clean_line(x) for x in e_lines) if s])

    kinds = 0
    for r in range(mr.en.rows):
        mid = mr.mod_id(r)
        if (mr.domain(r) != 34 or read_i32(mr.en, r, O_GENTYPE) != GEN_IMPLICIT
                or not mid.startswith("Tower") or "ToMapsImplicit" not in mid
                or mid.endswith("Unique")):
            continue
        kinds += 1
        stats = [(sid, 1, max(1, hi)) for sid, _lo, hi in mr.stats_of(r)]
        # The Overseer variant at 1 splits into two English lines and one
        # Chinese line, so lines_alt reports line_split_mismatch for the
        # 1..N range; the per-variant pass below still takes both languages,
        # and ambient zh / en are independent lists (no line pairing needed).
        e_lines, z_lines, notes, _rem, alts = w.lines_alt(stats)
        if any(not n.startswith("line_split_mismatch:") for n in notes):
            raise SystemExit(f"tablet implicit {mid}: no wording ({notes})")
        if len(e_lines) == len(z_lines):
            take(z_lines, e_lines)
            for alt in alts:
                take([a_zh for _a_en, a_zh in alt], [a_en for a_en, _a_zh in alt])
        before = len(zh)
        have = {sid: (lo, hi) for sid, lo, hi in stats}
        for sid, _lo, _hi in stats:
            cands = [(rank, -len([i for i in ids if i in have]), ids, variants)
                     for rank, ids, variants in w.by_id.get(sid, [])
                     if Wording._pick(variants, ids, have) is not None]
            if not cands:
                continue
            _rank, _n, ids, variants = min(cands, key=lambda c: (c[0], c[1]))
            vals = [have.get(i, (0, 0)) for i in ids]
            for v in variants:
                if not Wording._fits(v, ids, vals):
                    continue
                pe, pz = split_lines(v["en_norm"]), split_lines(v["tc_norm"])
                take(pz, pe)
        if not e_lines and len(zh) == before:
            raise SystemExit(f"tablet implicit {mid}: no wording found")
    if kinds == 0:
        raise SystemExit("no TowerAdd*ToMapsImplicit rows in Domain 34; tablet ambient short")

    b = get_bases(ctx)
    classes = []
    for r in range(b.en.rows):
        if not b.id(r).startswith("Metadata/Items/TowerAugment/"):
            continue
        c = b.item_class(r)
        if c is not None and c not in classes:
            classes.append(c)
    if not classes:
        raise SystemExit("no item class found for Metadata/Items/TowerAugment/ bases")
    for c in classes:
        cz, ce = b.class_name(c)
        take([cz], [ce])
    return zh, en


# --- pages --------------------------------------------------------------------
# A page is: which modifiers, which wording, which stats are really properties,
# and how the rows are grouped in the list. Everything else is shared.

PAGES = [
    {
        "id": "waystone_mods",
        "kind": "mods",
        "legacy": True,
        "domain": 6,
        "title": "換界石詞綴",
        "titleEn": "Waystone modifiers",
        "note": "勾選要找的詞綴，把產生的字串貼進倉庫搜尋列。"
                "不會誤中的保證只涵蓋這份清單裡的其他詞綴。",
        "accept": lambda live: bool(live & {"map_key_low", "map_key_medium",
                                            "map_key_high", "map_key_highest", "default"}),
        # The base item sums these and prints them once as properties (物品數量、
        # 稀有度、怪群大小、怪物威能、換界石掉落機率); no waystone has them as a
        # modifier line. The _final_from_map suffix says so literally -- it is the
        # map's contribution to a final multiplier -- and every one of the five is
        # a fixed value, not a roll.
        "aggregate": lambda sid: (sid.endswith("_final_from_map") or sid in {
            "map_item_drop_quantity_+%", "map_item_drop_rarity_+%",
            "map_pack_size_+%", "map_monster_potency_+%",
            "map_map_item_drop_chance_+%", "map_number_of_rare_packs_+%",
            "map_number_of_magic_packs_+%",
        }),
        "files": ["map_stat_descriptions.csd", "stat_descriptions.csd"],
        "groups": ["前綴", "後綴", "前後綴皆有"],
        "groupsEn": ["Prefix", "Suffix", "Both"],
        "group": group_by_generation,
        "name_bases": lambda ex: ex.bases["waystone_mods"],
        "ambient_ids": AMBIENT_WAYSTONE_IDS,
        "ambient_extra": lambda ex: ex.bases["waystone_mods"],
        "words_tag": "map",
    },
    {
        "id": "tablet_mods",
        "kind": "mods",
        "legacy": True,
        "domain": 34,
        "title": "碑牌詞綴",
        "titleEn": "Precursor tablet modifiers",
        "note": "八種碑牌共用一份清單，左欄依碑牌分組。"
                "「通用」那組每種碑牌都會出，輻照碑牌只會出那一組。"
                "不會誤中的保證只涵蓋這份清單裡的其他詞綴。",
        "accept": lambda live: True,   # every live domain-34 affix is a tablet affix
        # A tablet prints its modifiers as lines, including the ones a waystone
        # would have folded into a property. Nothing to drop here.
        "aggregate": lambda sid: False,
        "files": ["tablet_stat_descriptions.csd", "endgame_map_stat_descriptions.csd",
                  "map_stat_descriptions.csd", "stat_descriptions.csd"],
        # 通用 is where the default-tagged affixes go: every tablet can roll
        # them, and the Irradiated tablet rolls nothing else -- so naming it here
        # is the only place that tablet appears at all.
        "groups": ["通用（輻照）", "裂痕", "探險", "譫妄", "祭祀", "深淵", "總督", "神廟"],
        "groupsEn": ["Any (Irradiated)", "Breach", "Expedition", "Delirium",
                     "Ritual", "Abyss", "Overseer", "Temple"],
        "group": group_by_tablet,
        "name_bases": lambda ex: ex.bases["tablet_mods"],
        "ambient_ids": AMBIENT_TABLET_IDS,
        "ambient_extra": lambda ex: ex.bases["tablet_mods"],
        "ambient_ctx": lambda ctx: tablet_ambient(ctx),
        "words_tag": "tower_augment",
        # Overseer / Expedition rolls of 1..2 print 「一個…」 or 「2個…」;
        # poe2db lists them as (1—2), and the search has to find both.
        "alt_wordings": True,
    },
    {
        "id": "relic_mods",
        "kind": "mods",
        "legacy": True,
        "domain": 8,
        "title": "聖物詞綴",
        "titleEn": "Relic modifiers",
        "note": "聖域試煉的聖物詞綴。不會誤中的保證只涵蓋這份清單。",
        "accept": lambda live: bool(live & {"small_sanctum_relic", "medium_sanctum_relic",
                                            "large_sanctum_relic"}),
        "aggregate": lambda sid: False,
        "files": ["sanctum_relic_stat_descriptions.csd", "stat_descriptions.csd"],
        "groups": ["前綴", "後綴", "前後綴皆有"],
        "groupsEn": ["Prefix", "Suffix", "Both"],
        "group": group_by_generation,
        "name_bases": lambda ex: ex.bases["relic_mods"],
        "ambient_ids": AMBIENT_RELIC_IDS,
        "ambient_extra": lambda ex: ex.bases["relic_mods"],
        "words_tag": None,
    },
    {
        "id": "expedition_relic_mods",
        "kind": "mods",
        "legacy": True,
        "domain": 29,
        "title": "探險遺物詞綴",
        "titleEn": "Expedition remnant modifiers",
        "note": "探險遺物的增益與減益。不會誤中的保證只涵蓋這份清單。",
        "accept": lambda live: any("expedition" in t for t in live),
        "aggregate": lambda sid: False,
        "files": ["expedition_relic_stat_descriptions.csd",
                  "expedition_relic_special_stat_descriptions.csd",
                  "stat_descriptions.csd"],
        "groups": ["增益", "減益", "其他"],
        "groupsEn": ["Upside", "Downside", "Other"],
        "group": group_by_remnant,
        "name_bases": lambda ex: ex.bases["expedition_relic_mods"],
        "ambient_ids": AMBIENT_REMNANT_IDS,
        "ambient_extra": lambda ex: ex.bases["expedition_relic_mods"],
        "words_tag": None,
    },
    {
        "id": "flask_charm_mods",
        "kind": "mods",
        "domain": 2,
        "title": "藥劑與護符詞綴",
        "titleEn": "Flask and charm modifiers",
        "note": "生命／魔力藥劑與護符的前綴、後綴。"
                "產生的片段會避開這份清單裡的其他詞綴、詞綴名稱與基底名。",
        "accept": lambda live: True,
        "files": ["stat_descriptions.csd"],
        "groups": ["藥劑前綴", "藥劑後綴", "護符前綴", "護符後綴", "藥劑與護符共用"],
        "groupsEn": ["Flask prefix", "Flask suffix", "Charm prefix", "Charm suffix",
                     "Flasks and charms"],
        "group": group_flask_charm,
        "build": lambda ctx: build_flask_charm(ctx),
        "ambient_ids": AMBIENT_ITEM_IDS + [
            "ItemDisplayFlaskLifeRecovery1Second", "ItemDisplayFlaskLifeRecoveryNSeconds",
            "ItemDisplayFlaskManaRecovery1Second", "ItemDisplayFlaskManaRecoveryNSeconds",
            "ItemDisplayFlaskBuffDuration1Second", "ItemDisplayFlaskBuffDurationNSeconds",
            "ItemDisplayChargesConsumptionOnUse1Charge", "ItemDisplayChargesConsumptionOnUseNCharges",
            "ItemDisplayChargesNCharges", "ItemDisplayChargesCurrentOfMaxN"],
    },
    {
        "id": "gem_names",
        "kind": "names",
        "title": "技能寶石",
        "titleEn": "Skill gems",
        "note": "技能、輔助與精魂寶石名稱。等級、品質請用數值條件。"
                "產生的片段會避開其他寶石的名稱、標籤與說明文字。",
        "groups": ["技能", "輔助", "精魂"],
        "groupsEn": ["Skill", "Support", "Spirit"],
        "build": lambda ctx: build_gem_names2(ctx),
        "ambient_ids": ["Level", "Quality", "ItemPopupCorrupted", "ItemPopupRequirements",
                        "ItemDescriptionSkillGem", "ItemDescriptionActiveSkillGem",
                        "ItemDisplayStringGem"],
    },
    {
        "id": "vendor_bases",
        "kind": "names",
        "title": "物品基底",
        "titleEn": "Item bases",
        "note": "商店與地上物品的基底名稱，依物品種類分組；插槽、物品等級請用數值條件。"
                "產生的片段會避開其他基底名、種類名與基底內建詞綴。",
        "groups": [], "groupsEn": [],
        "build": lambda ctx: build_vendor_bases(
            ctx, tuple("Metadata/Items/" + f for f in VENDOR_FOLDERS_POE2),
            ["stat_descriptions.csd"]),
        "ambient_ids": AMBIENT_ITEM_IDS,
    },
]
PAGE_BY_ID = {p["id"]: p for p in PAGES}

# PoE2 keeps charms under Flasks/ and adds focus / sceptre / spear ... under
# Weapons/ and Armours/ -- the same eight folders cover it.
VENDOR_FOLDERS_POE2 = VENDOR_FOLDERS


# --- new-page builders ------------------------------------------------------------

def build_flask_charm(ctx):
    spec = PAGE_BY_ID["flask_charm_mods"]
    page = dict(spec)
    bases = get_bases(ctx).names_with_prefix("Metadata/Items/Flasks/")
    page["name_bases"] = []
    page["affix_sink"] = []
    entries = build_mod_page(ctx.mr, ctx.blocks, page, ctx.counts, ctx.ex, ctx.wording)
    ctx.seam["flask_charm_mods"] = seam_words(page["affix_sink"], bases)
    return entries, bases, None


def build_gem_names2(ctx):
    """PoE2 gems by name: SkillGems -> BaseItemTypes. Group by the granted
    effect: support (GrantedEffects.IsSupport), spirit (the gem's item class
    says so), else skill. Hidden text: the tag line and the description."""
    st = ctx.st
    b = get_bases(ctx)
    sg = st.table("SkillGems")
    cg = st.cols("SkillGems")
    ge, ge_tc = st.pair("GemEffects")
    ce = st.cols("GemEffects")
    gt, gt_tc = st.pair("GemTags")
    ct = st.cols("GemTags")
    gr = st.table("GrantedEffects")
    cgr = st.cols("GrantedEffects")
    ask, ask_tc = st.pair("ActiveSkills")
    ca = st.cols("ActiveSkills")
    items = []
    for r in range(sg.rows):
        base = read_fkey(sg, r, cg["BaseItemType"]["off"])
        if base is None:
            continue
        zh, en = b.name(base)
        if not usable_name(zh, en):
            continue
        effects = read_fkey_array(sg, r, cg["GemEffects"]["off"])
        support = False
        hz, he, tags = [], [], []
        for v in effects[:1]:
            for t in read_fkey_array(ge, v, ce["GemTags"]["off"]):
                tz, te = gt_tc.read_string(t, ct["Name"]["off"]), gt.read_string(t, ct["Name"]["off"])
                if tz and te:
                    tags.append((strip_markup(tz), strip_markup(te)))
            add_unique(hz, clean_desc(ge_tc.read_string(v, ce["SupportText"]["off"])))
            add_unique(he, clean_desc(ge.read_string(v, ce["SupportText"]["off"])))
            g = read_fkey(ge, v, ce["GrantedEffect"]["off"])
            if g is not None:
                support = gr.data[gr.cell_offset(g, cgr["IsSupport"]["off"])] != 0
                a = read_fkey(gr, g, cgr["ActiveSkill"]["off"])
                if a is not None:
                    add_unique(hz, clean_desc(ask_tc.read_string(a, ca["Description"]["off"])))
                    add_unique(he, clean_desc(ask.read_string(a, ca["Description"]["off"])))
        tz, te = joined_tags(tags)
        cls = b.item_class(base)
        cls_id = b.class_id(cls) if cls is not None else ""
        spirit = any(t == "Persistent" for _z, t in tags) or "Spirit" in cls_id
        group = 1 if support else (2 if spirit else 0)
        items.append({"id": b.id(base), "zh": zh, "en": en, "g": group,
                      "hiddenZh": tz + hz, "hiddenEn": te + he})
    entries = names_entries(items)
    ctx.counts["gem_names.hidden_equal_to_a_name"] += scrub_hidden_against_printed(entries)
    return entries, [], None


# --- build --------------------------------------------------------------------

class Ctx:
    def __init__(self):
        self.st = SchemaTables(SCHEMA_PATH, 2, DATA_EN, DATA_TC)
        self.blocks = json.loads(STATS_JSON.read_text(encoding="utf-8"))
        self.mr = ModReader()
        self.ex = Extras()
        self.wording: dict = {}
        self.counts: Counter = Counter()
        self.seam: dict = {}
        self.bases_alias = {"ItemClassesKey": "ItemClass", "Implicit_ModsKeys": "Implicit_Mods"}


def resolve(spec: dict, key: str, ctx: Ctx, default=None):
    v = spec.get(key, default)
    return v(ctx.ex) if callable(v) and key in ("name_bases", "ambient_extra") else v


def build_one(spec: dict, ctx: Ctx, schema: int) -> dict:
    groups = None
    if "build" in spec:
        entries, amb_extra, groups = spec["build"](ctx)
    else:
        page = dict(spec)
        page["name_bases"] = resolve(spec, "name_bases", ctx, [])
        entries = build_mod_page(ctx.mr, ctx.blocks, page, ctx.counts, ctx.ex, ctx.wording)
        amb_extra = []
    print(f"{spec['id']:24s} {len(entries):4d} lines")
    zh, en = ctx.ex.ambient(spec.get("ambient_ids", []))
    for t, e in (resolve(spec, "ambient_extra", ctx, []) or []) + amb_extra:
        add_unique(zh, [t])
        add_unique(en, [e])
    if "ambient_ctx" in spec:
        cz, ce = spec["ambient_ctx"](ctx)
        add_unique(zh, cz)
        add_unique(en, ce)
    tag = spec.get("words_tag")
    prefix, suffix = ctx.mr.words(tag) if tag else ([], [])
    for t, e in prefix + suffix:
        add_unique(zh, [t.strip()])
        add_unique(en, [e.strip()])
    if groups is not None:
        spec = dict(spec, groups=groups[0], groupsEn=groups[1])
    if spec.get("kind", "mods") == "names":
        printed = {l for e in entries for l in e["zh"] + e["en"]}
        zh = [l for l in zh if l not in printed]
        en = [l for l in en if l not in printed]
    return page_doc(spec, entries, zh, en, prefix, suffix, schema, ctx.seam.get(spec["id"]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true", help="print a sample, write nothing")
    ap.add_argument("--diag", action="store_true", help="print what was dropped and why")
    ap.add_argument("--schema", type=int, default=2, choices=(1, 2))
    ap.add_argument("--out", type=Path, default=OUT_PATH)
    ap.add_argument("--only", help="comma-separated page ids (report/diag only)")
    args = ap.parse_args()
    t0 = time.perf_counter()

    ctx = Ctx()
    specs = [p for p in PAGES if args.schema >= 2 or p.get("legacy")]
    if args.only:
        want = set(args.only.split(","))
        specs = [p for p in specs if p["id"] in want]
    if args.diag:
        diag = []
        for p in specs:
            if p.get("kind") == "names":
                continue
            q = dict(p)
            q["name_bases"] = resolve(p, "name_bases", ctx, [])
            diag.append(q)
        diagnose_pages(ctx.mr, ctx.blocks, diag)
        return 0

    pages = [build_one(p, ctx, args.schema) for p in specs]
    # Same post-processing as PoE1 (regex_common): flavour text where Verify sees it,
    # then every markup span resolved -- base implicits come back as "# to [Armour]".
    ctx.counts["item_text_lines"] = add_item_texts(pages, item_texts(ctx.st, "FlavourText", "BaseItemType"))
    ctx.counts["markup_stripped"] = strip_page_markup(pages)
    check_no_markup(pages)
    print("counts:", dict(ctx.counts))
    self_check(pages)
    if args.schema >= 2:
        self_check_v2(pages)
    for p in pages:
        print(page_summary(p))

    if args.report:
        for p in pages:
            print(f"\n=== {p['title']} / {p['titleEn']}")
            for e in p["entries"][:40]:
                print(f"  [{p['groups'][e['g']]:4s}] {e.get('affixZh', '-'):14s} "
                      f"{e['zh'][0]}  |  {e['en'][0]}")
            if len(p["entries"]) > 40:
                print(f"  ... {len(p['entries']) - 40} more")
            for e in p["entries"][:2]:
                print(f"  hidden of {e['zh'][0]}:")
                for h in e.get("hiddenZh", [])[:6]:
                    print(f"      zh| {h}")
                for h in e.get("hiddenEn", [])[:6]:
                    print(f"      en| {h}")
            print("  ambient zh sample:", p["ambientZh"][:8])
        print(f"\nelapsed {time.perf_counter() - t0:.2f}s")
        return 0

    doc: dict = {
        "schema": args.schema,
        "game": "poe2",
        "source": "PoE2 GGPK Mods/Stats/Tags/Words + tools/ggpk2_zh/out/poe2/{stats,tables}",
    }
    if args.schema >= 2:
        doc["source"] = ("PoE2 GGPK Mods/Stats/Tags/Words/BaseItemTypes/SkillGems/... + "
                         "tools/ggpk2_zh/out/poe2/{stats,tables}")
        doc["labels"] = labels_doc(ctx.ex.cs, LABEL_IDS, strip_markup)
    doc["pages"] = pages
    write_doc(args.out, doc)
    print("wrote", args.out, args.out.stat().st_size, "bytes",
          f"in {time.perf_counter() - t0:.2f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
