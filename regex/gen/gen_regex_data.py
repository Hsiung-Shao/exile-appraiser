#!/usr/bin/env python3
"""Build the regex tool's data file: host/data/regex_poe1.json.

The regex tool needs, per searchable thing, the text the GAME PRINTS -- that is
what the player's search box matches against. Three rules follow from that, and
they shape everything here:

  * numbers are not part of the text. "Monsters deal 32% extra Damage as Fire"
    is one modifier with one wording; the 32 is a roll. Every line is stored with
    its placeholders collapsed to `#`, and the C++ side never lets a search token
    straddle one -- a token that did would match one roll and miss the rest.

  * the unit is the LINE, not the modifier. Several modifiers print the same
    line (a tier-17 variant of a suffix prints what the ordinary suffix prints),
    and one modifier prints several lines. The search box sees lines, so the
    tool offers lines and records which affixes produce each.

  * aggregated properties are not lines. A map's "Item Quantity: +86%" is the
    SUM of every modifier's contribution, printed once by the base item -- there
    is no "#% increased Quantity of Items found in this Area" on a map item even
    though the stat has that wording elsewhere. Those three stats are dropped by
    name; see AGGREGATE_STATS.

  * the search reads more than the lines (found in-game 2026-09: a map whose
    only line is 怪物傷害必定造成點燃 answers to "常" through its tag 異常狀態,
    and 玩家被時空鎖鏈詛咒 answers to it through the reminder text 比平常慢).
    So every entry also carries `hiddenZh` / `hiddenEn` -- the advanced
    description (前綴 "名"(階層：#) and the implicit tags), the reminder texts,
    the magic-name pieces (名地圖) -- and every page carries `ambientZh` /
    `ambientEn`, the text EVERY item of the page prints (property labels, the
    base name, the flavour paragraph, the random words rare names are made of;
    those words also go in `nameWordsZh` / `nameWordsEn` split into the two
    halves so the C++ side can check the seam between them). The C++ side
    only ever uses these to REJECT a token; it never cuts one from them.

Pages are declared in PAGES (same shape as gen_regex_data2.py); the shared
machinery is in regex_common.py. `kind: "mods"` pages list printed modifier
lines; `kind: "names"` pages list item names (the name is what is searched,
and whatever else the item prints is that entry's hidden text).

Sources, in the order the project's data rules put them:

  * Mods / Stats / Tags / Words and the page-specific .datc64 tables out of
    tools/ggpk_zh/cache (the GGPK), read through the community schema with the
    row size checked first
  * tools/ggpk_zh/out/poe1/stats.json for the wording -- the audited English /
    Chinese statdescription pairing, already cross-checked against repoe and
    render tests. Re-parsing the .txt here would be a second, worse copy. Its
    variants also carry the reminder-text ids the game attaches to the line.
  * tools/ggpk_zh/out/poe1/tables/{remindertext,clientstrings,baseitemtypes,
    expeditionfactions,worldareas}.json for the hidden and ambient text.
  * host/data/scarabs_poe1.json (gen_scarabs.py) for the scarab page.

Run:  python tools/gen_regex_data.py              writes host/data/regex_poe1.json (schema 2)
      python tools/gen_regex_data.py --schema 1   the old two-page file, byte for byte
      python tools/gen_regex_data.py --report     prints a sample, writes nothing
      python tools/gen_regex_data.py --diag       prints what was dropped and why
      python tools/gen_regex_data.py --out PATH   write somewhere else
"""
from __future__ import annotations

import argparse
import os
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent.parent   # exile-appraiser: repo 根目錄(本檔在 regex/gen/)
# exile-appraiser: GGPK 抽取資料(cache / schema / out)仍在 pob-zh-engine 的 tools/,由環境變數 POB_ZH_ENGINE 指定
TOOLS = Path(os.environ.get("POB_ZH_ENGINE") or ROOT.parent / "Pob2" / "pob-zh-engine") / "tools"
sys.path.insert(0, str(HERE))
import datzh  # noqa: E402
from regex_common import (  # noqa: E402
    GEN_PREFIX, GEN_SUFFIX, SchemaTables, Wording, add_unique, build_mod_page,
    client_lines, dedupe_first_lines, diagnose_pages, get_wording, group_by_generation,
    seam_words, Bases, JUNK_NAME, VENDOR_FOLDERS, build_vendor_bases, clean_desc,
    get_bases, joined_tags, stat_lines, usable_name,
    labels_doc, load_table, names_entries, page_doc, page_summary, read_bool,
    read_fkey, read_fkey_array, read_i32, read_i32_array, roll_digits,
    scrub_hidden_against_printed, self_check, self_check_v2, split_lines,
    strip_markup, unwrap_style, write_doc,
    add_item_texts, check_no_markup, item_texts, strip_page_markup)
from regex_common import usable_name as _usable_name  # noqa: E402


def usable_name(zh: str, en: str) -> bool:
    """regex_common's test, plus: a name must have a word character. The GGPK
    names an unreleased gem "..." in both languages (SkillGemComboStrike)."""
    return _usable_name(zh, en) and bool(re.search(r"\w", zh)) and bool(re.search(r"\w", en))


def self_check_poe1(pages: list[dict]) -> None:
    """No link markup left in any printed text, no entry named without a word character."""
    check_no_markup(pages)
    for p in pages:
        for e in p["entries"]:
            assert re.search(r"\w", e["zh"][0]) and re.search(r"\w", e["en"][0]), \
                f"{p['id']} {e['id']}: name without a word character"

# Re-exported for anything that still imports them from here (older probes,
# the pre-2026-09-29 gen_regex_data2.py).
__all__ = ["Wording", "add_unique", "client_lines", "roll_digits", "self_check",
           "unwrap_style", "split_lines"]

SCHEMA_PATH = TOOLS / "ggpk_zh" / "schema" / "schema.min.json"
DATA_EN = TOOLS / "ggpk_zh" / "cache" / "data_all" / "data"
DATA_TC = DATA_EN / "traditional chinese"
STATS_JSON = TOOLS / "ggpk_zh" / "out" / "poe1" / "stats.json"
TABLES_DIR = TOOLS / "ggpk_zh" / "out" / "poe1" / "tables"
SCARABS_JSON = HERE / "input" / "scarabs_poe1.json"   # exile-appraiser: 輸入快照收在本專案
OUT_PATH = ROOT / "data" / "regex" / "regex_poe1.json"

# Client strings every map item prints (property labels, popup badges, the
# flavour paragraph, the advanced-description scaffolding). {0} becomes '#'.
# A token that hits any of these hits every map, so none may be emitted.
AMBIENT_MAP_IDS = [
    "ItemDisplayMapTier", "ItemDisplayMapQuantityIncrease", "ItemDisplayMapRarityIncrease",
    "ItemDisplayMapPackSizeIncrease", "ItemDisplayMapMapItemDropChanceIncrease",
    "ItemDisplayMapGoldIncrease", "ItemDisplayMapScarabDropBonus",
    "ItemDisplayMapCurrencyDropBonus", "ItemDisplayMapDivinationCardDropBonus",
    "ItemDisplayMapMapDropBonus", "ItemDisplayMapItemsDropCorruptedChance",
    "MonsterLevelPopup", "ItemLevelPopup", "ItemDescriptionMap",
    "ItemPopupCorrupted", "ItemPopupUnidentified", "ItemPopupMirrored", "ItemPopupSplit",
    "ItemPopupFracturedItem", "ItemPopupSynthesisedItem", "ItemPopupShaperItem",
    "ItemPopupElderItem", "ItemPopupCrusaderItem", "ItemPopupRedeemerItem",
    "ItemPopupHunterItem", "ItemPopupWarlordItem", "ItemPopupSearingExarchItem",
    "ItemPopupEaterofWorldsItem", "ItemPopupHellscaped",
    "ModDescriptionLineTier", "ModDescriptionLineImplicit", "ModDescriptionLineUnique",
    "UnifiedCraftingCategoryPrefix", "UnifiedCraftingCategorySuffix",
    "ItemDisplayStringRarity", "Quality",
]
AMBIENT_LOGBOOK_IDS = [
    "ExpeditionWindowTitle", "HeistAreaText", "ItemDisplayItemisedAreaLevel",
    "ItemLevelPopup", "ItemDescriptionExpeditionLogbook",
    "ItemPopupCorrupted", "ItemPopupUnidentified", "ItemPopupMirrored", "ItemPopupSplit",
    "ModDescriptionLineTier", "ModDescriptionLineImplicit",
    "UnifiedCraftingCategoryPrefix", "UnifiedCraftingCategorySuffix",
    "ItemDisplayStringRarity",
]
# What (nearly) every item prints, whatever it is: the badges, the advanced
# description scaffolding, the level/quality/requirement labels.
AMBIENT_ITEM_IDS = [
    "ItemLevelPopup", "ItemPopupCorrupted", "ItemPopupUnidentified", "ItemPopupMirrored",
    "ItemPopupSplit", "ItemPopupFracturedItem", "ItemPopupSynthesisedItem",
    "ItemPopupShaperItem", "ItemPopupElderItem", "ItemPopupCrusaderItem",
    "ItemPopupRedeemerItem", "ItemPopupHunterItem", "ItemPopupWarlordItem",
    "ItemPopupSearingExarchItem", "ItemPopupEaterofWorldsItem",
    "ModDescriptionLineTier", "ModDescriptionLineImplicit", "ModDescriptionLineUnique",
    "UnifiedCraftingCategoryPrefix", "UnifiedCraftingCategorySuffix",
    "ItemDisplayStringRarity", "ItemPopupRequirements", "Quality", "Level",
    "ItemDisplayStringSockets",
]

# Labels the exile-appraiser algorithmic pages build terms from (schema 2).
LABEL_IDS = [
    # map properties
    "ItemDisplayMapTier", "ItemDisplayMapQuantityIncrease", "ItemDisplayMapRarityIncrease",
    "ItemDisplayMapPackSizeIncrease", "ItemDisplayMapScarabDropBonus",
    "ItemDisplayMapCurrencyDropBonus", "ItemDisplayMapMapDropBonus",
    "ItemDisplayMapDivinationCardDropBonus", "ItemDisplayMapGoldIncrease",
    # any item
    "ItemLevelPopup", "ItemDisplayStringItemLevel", "Quality", "ItemDisplayStringSockets",
    "Level", "ItemPopupCorrupted",
    # influence badges
    "ItemPopupShaperItem", "ItemPopupElderItem", "ItemPopupCrusaderItem",
    "ItemPopupRedeemerItem", "ItemPopupHunterItem", "ItemPopupWarlordItem",
    "ItemPopupSearingExarchItem", "ItemPopupEaterofWorldsItem",
    # heist
    "HeistRequiresText",
    # rarity row of the numeric section (exile-appraiser step 35; was labels.<game>.json there)
    "ItemDisplayStringRarity", "ItemDisplayStringNormal", "ItemDisplayStringMagic",
    "ItemDisplayStringRare", "ItemDisplayStringUnique",
]

# ModDomains: the column stores the enumerator index + 1.
DOMAIN_ITEM, DOMAIN_FLASK, DOMAIN_AREA = 1, 2, 5
DOMAIN_TINCTURE = 34   # exile-appraiser 2026-11-13: 萃取物
DOMAIN_AFFLICTION_JEWEL, DOMAIN_HEIST_AREA, DOMAIN_HEIST_NPC, DOMAIN_HEIST_TRINKET = 21, 22, 23, 24
# ModGenerationType, same +1 convention.
GEN_ENCHANT, GEN_ENKINDLING, GEN_INSTILLING = 10, 21, 22

# Which statdescription file's wording a map item uses.
FILE_PRIORITY = ["map_stat_descriptions.txt", "stat_descriptions.txt"]

# Domain AREA covers more than maps. The spawn-weight tags are what separate
# them, and they are also the only thing that says "tier 17 only".
MAP_TAGS = {"low_tier_map", "mid_tier_map", "top_tier_map",
            "maven_map", "primordial_map", "default"}
# NOTE the trailing space in has_uber_map_prefix -- it is in the GGPK data.
T17_TAGS = {"uber_tier_map", "has_uber_map_prefix ", "has_uber_map_prefix",
            "has_uber_map_suffix"}
LOGBOOK_TAGS = {"expedition_logbook"}

# Summed by the base item and printed once as a property, never as a modifier
# line. Keeping them would offer the player a string that is not on the item.
AGGREGATE_STATS = {
    "map_item_drop_quantity_+%",
    "map_item_drop_rarity_+%",
    "map_pack_size_+%",
    # The tier-17 drop bonuses print as 更多地圖 / 聖甲蟲 / 更多通貨: +N% on the
    # map (pasted maps in tests/regex_samples/poe1_maps_zh.txt; poe.re treats
    # them as properties too), never as 區域內掉落的…增加 #%. Found 2026-10-30.
    "map_map_item_drop_chance_+%_final_from_uber_mod",
    "map_scarab_drop_chance_+%_final_from_uber_mod",
    "map_currency_drop_chance_+%_final_from_uber_mod",
}
HEIST_CONTRACT_AGGREGATE = {
    "map_item_drop_quantity_+%", "map_item_drop_rarity_+%",
    "heist_monster_spawner_alive_limit_+%", "heist_contract_alert_level_+%_final",
    "heist_contract_lockdown_timer_+%",
}


# --- readers ------------------------------------------------------------------

class ModReader:
    """The modifier rows, in both languages, with their spawn tags."""

    def __init__(self, st: SchemaTables):
        self.st = st
        self.cm = st.cols("Mods")
        self.en, self.tc = st.pair("Mods")
        cm_stats, cm_tags = st.cols("Stats"), st.cols("Tags")
        stt = st.table("Stats")
        tg, tg_tc = st.pair("Tags")
        self.stat_id = [stt.read_string(r, cm_stats["Id"]["off"]) for r in range(stt.rows)]
        self.tag_id = [tg.read_string(r, cm_tags["Id"]["off"]) for r in range(tg.rows)]
        # The name the advanced description prints after the tier -- 異常狀態
        # for `ailment`. Empty for all but a couple of dozen tags.
        self.tag_name = [(unwrap_style(tg_tc.read_string(r, cm_tags["Name"]["off"])),
                          unwrap_style(tg.read_string(r, cm_tags["Name"]["off"])))
                         for r in range(tg.rows)]

    def implicit_tags(self, r: int) -> list[tuple[str, str]]:
        """(chinese, english) display names of the modifier's implicit tags, in
        the order the advanced description lists them; nameless tags skipped."""
        out = []
        for t in read_fkey_array(self.en, r, self.cm["ImplicitTagsKeys"]["off"]):
            if t < len(self.tag_name):
                zh, en = self.tag_name[t]
                if zh or en:
                    out.append((zh, en))
        return out

    def words(self, tag: str) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
        """The random words a rare item of this kind is named from:
        (prefix words, suffix words) as (chinese, english). A word belongs to
        the kind when its spawn weight for `tag` is positive; the wordlist
        column says which half of the name it is. Suffixes keep their leading
        space -- the game prints "汙濁 遺地" with it."""
        cm = self.st.cols("Words")
        en, tc = self.st.pair("Words")
        prefix, suffix = [], []
        for r in range(en.rows):
            wl = read_i32(en, r, cm["Wordlist"]["off"])
            if wl not in (1, 2):   # ITEM_PREFIX / ITEM_SUFFIX
                continue
            tags = read_fkey_array(en, r, cm["SpawnWeight_Tags"]["off"], keep_null=True)
            weights = read_i32_array(en, r, cm["SpawnWeight_Values"]["off"])
            if len(tags) != len(weights):
                raise SystemExit(f"words row {r}: spawn tag/weight arrays differ in length")
            if not any(0 <= t < len(self.tag_id) and self.tag_id[t] == tag and w > 0
                       for t, w in zip(tags, weights)):
                continue
            pair = (tc.read_string(r, cm["Text2"]["off"]), en.read_string(r, cm["Text"]["off"]))
            (prefix if wl == 1 else suffix).append(pair)
        return prefix, suffix

    def affix_rows(self, domains: set[int], gens: set[int], need_live: bool = True):
        for r in range(self.en.rows):
            if read_i32(self.en, r, self.cm["Domain"]["off"]) not in domains:
                continue
            gen = read_i32(self.en, r, self.cm["GenerationType"]["off"])
            if gen not in gens:
                continue
            live = self.live_tags(r)
            if need_live and not live:
                continue
            yield r, gen, live

    def live_tags(self, r: int) -> set[str]:
        weights = read_i32_array(self.en, r, self.cm["SpawnWeight_Values"]["off"])
        tags = read_fkey_array(self.en, r, self.cm["SpawnWeight_TagsKeys"]["off"])
        return {self.tag_id[t] for t, w in zip(tags, weights)
                if w > 0 and t < len(self.tag_id)}

    def stats_of(self, r: int, n: int = 8) -> list[tuple[str, int, int]]:
        out = []
        for i in range(1, n + 1):
            key = read_fkey(self.en, r, self.cm[f"StatsKey{i}"]["off"])
            if key is None or key >= len(self.stat_id):
                continue
            out.append((self.stat_id[key],
                        read_i32(self.en, r, self.cm[f"Stat{i}Min"]["off"]),
                        read_i32(self.en, r, self.cm[f"Stat{i}Max"]["off"])))
        return out

    def mod_id(self, r: int) -> str:
        return self.en.read_string(r, self.cm["Id"]["off"])

    def domain(self, r: int) -> int:
        return read_i32(self.en, r, self.cm["Domain"]["off"])

    def affix_name(self, r: int) -> tuple[str, str]:
        return (self.tc.read_string(r, self.cm["Name"]["off"]),
                self.en.read_string(r, self.cm["Name"]["off"]))


class Extras:
    """The tables the hidden and ambient text are assembled from."""

    def __init__(self):
        self.cs = load_table(TABLES_DIR, "clientstrings", "Text")
        self.remind = load_table(TABLES_DIR, "remindertext", "Text")
        self.bases = load_table(TABLES_DIR, "baseitemtypes", "Name")
        bases = self.bases
        # Every map base is "Map (Tier N)" / "地圖（階級N）" since the generic
        # bases arrived; the 165 named ones (禁魂炎獄...) still exist as items
        # and go into the ambient text as lines of their own.
        tiers = {(roll_digits(t), roll_digits(e)) for k, (e, t) in bases.items()
                 if k.startswith("Metadata/Items/Maps/MapKeyTier")}
        self.map_bases = sorted(tiers)                              # [(zh, en)]
        self.map_named = sorted({(t, e) for k, (e, t) in bases.items()
                                 if k.startswith("Metadata/Items/Maps/MapWorlds")})
        self.logbook_bases = [(bases["Metadata/Items/Expedition/ExpeditionLogbook"][1],
                               bases["Metadata/Items/Expedition/ExpeditionLogbook"][0])]
        self.factions = [(t, e) for _k, (e, t) in
                         sorted(load_table(TABLES_DIR, "expeditionfactions", "Name").items())]
        self.areas = [(t, e) for k, (e, t) in
                      sorted(load_table(TABLES_DIR, "worldareas", "Name").items())
                      if k.startswith("Expedition")]
        for key in ("ModDescriptionLinePrefix", "ModDescriptionLineSuffix",
                    "ModDescriptionLineTier"):
            if key not in self.cs:
                raise SystemExit(f"client string {key} missing; cannot build the advanced line")

    # PoE1 text carries no [Key|Display] markup, so the names and lines are
    # taken as they are; PoE2's Extras strips it here.
    @staticmethod
    def clean_name(s: str) -> str:
        return s

    @staticmethod
    def clean_line(s: str) -> str:
        return s

    def advanced_line(self, gen: int, zh_affix: str, en_affix: str) -> tuple[str, str]:
        """前綴 "燃燒的"(階層：#)  /  Prefix Modifier "Conflagrating" (Tier: #)"""
        key = "ModDescriptionLinePrefix" if gen == GEN_PREFIX else "ModDescriptionLineSuffix"
        en_head, zh_head = self.cs[key]
        en_tier, zh_tier = self.cs["ModDescriptionLineTier"]
        zh = zh_head.replace("{0}", zh_affix) + zh_tier.replace("{0}", "#")
        en = en_head.replace("{0}", en_affix) + en_tier.replace("{0}", "#")
        return zh.strip(), en.strip()

    def reminder_lines(self, ids: list[str]) -> tuple[list[str], list[str]]:
        zh, en = [], []
        for rid in ids:
            if rid not in self.remind:
                print(f"warning: reminder text {rid} not in remindertext.json")
                continue
            e, t = self.remind[rid]
            add_unique(en, client_lines(e))
            add_unique(zh, client_lines(t))
        return zh, en

    def ambient(self, ids: list[str]) -> tuple[list[str], list[str]]:
        zh, en = [], []
        for i in ids:
            if i not in self.cs:
                print(f"warning: client string {i} not found; ambient text is short by one line")
                continue
            e, t = self.cs[i]
            add_unique(en, client_lines(e))
            add_unique(zh, client_lines(t))
        return zh, en


# --- new pages (schema 2) -----------------------------------------------------
# Everything below is read through SchemaTables, whose row-size check refuses a
# table the schema does not describe. Names are taken from the GGPK in both
# languages; a row whose name is a GGG placeholder ([DNT], UNUSED, empty) is
# not an item a player can hold and is dropped.

def mod_page_with_seam(ctx, page_id: str, bases: list[tuple[str, str]], **over) -> list[dict]:
    """build_mod_page for a page whose magic-name seam goes to name words
    (seam_words) instead of hidden lines; the seam is left in ctx.seam for
    build_one to attach."""
    page = dict(PAGE_BY_ID[page_id], **over)
    page["name_bases"] = []
    page["affix_sink"] = []
    entries = build_mod_page(ctx.mr, ctx.blocks, page, ctx.counts, ctx.ex, ctx.wording)
    ctx.seam[page_id] = seam_words(page["affix_sink"], bases)
    return entries


# ---- scarabs -----------------------------------------------------------------

def build_scarabs(ctx):
    """Scarab names + their effect text, from host/data/scarabs_poe1.json
    (gen_scarabs.py: Scarabs.dat is the list, CurrencyItems.Description the
    text). The effect lines are printed on the item and are what a player
    usually remembers, so they are part of the entry's own text, not hidden.

    descZh / descEn are independent lists (their line counts can differ --
    see gen_scarabs.py), so they are never zipped: each language keeps its
    own lines."""
    data = json.loads(SCARABS_JSON.read_text(encoding="utf-8"))["scarabs"]
    types: dict[str, list[dict]] = {}
    for s in data:
        types.setdefault(s["type"], []).append(s)
    groups_zh, groups_en, gidx = [], [], {}
    for t, members in types.items():
        # The type's label: the shortest Chinese name with the 聖甲蟲： head
        # removed (聖甲蟲：深淵 -> 深淵); English keeps the type id. A label,
        # not an identity -- the entries carry the real names.
        shortest = min(members, key=lambda m: (m["tier"], len(m["zh"])))
        label = shortest["zh"].split("：", 1)[-1] if "：" in shortest["zh"] else shortest["zh"]
        gidx[t] = len(groups_zh)
        groups_zh.append(label)
        groups_en.append(re.sub(r"(?<=[a-z])(?=[A-Z])", " ", t))
    entries = []
    seen_zh, seen_en = set(), set()
    for s in data:
        zh_lines = [s["zh"]] + [l for d in s.get("descZh", []) for l in clean_desc(d)]
        en_lines = [s["en"]] + [l for d in s.get("descEn", []) for l in clean_desc(d)]
        if s["zh"] in seen_zh or s["en"] in seen_en:
            continue
        seen_zh.add(s["zh"])
        seen_en.add(s["en"])
        e = {"id": s["id"], "zh": [], "en": [], "g": gidx[s["type"]]}
        add_unique(e["zh"], zh_lines)
        add_unique(e["en"], en_lines)
        entries.append(e)
    entries.sort(key=lambda e: (e["g"], e["zh"][0]))
    return entries, [], (groups_zh, groups_en)


# ---- cluster jewels ------------------------------------------------------------

def cluster_size_of_tags(ctx) -> dict[str, set[int]]:
    """affliction_* spawn tag -> jewel sizes (0 large, 1 medium, 2 small)
    whose small-passive type carries that tag, read from
    PassiveTreeExpansionSkills (the enchantment a cluster jewel base rolls)."""
    if hasattr(ctx, "_cluster_tags"):
        return ctx._cluster_tags
    st = ctx.st
    sk = st.table("PassiveTreeExpansionSkills")
    cs = st.cols("PassiveTreeExpansionSkills")
    sizes = st.table("PassiveTreeExpansionJewelSizes")
    size_name = [sizes.read_string(r, 0) for r in range(sizes.rows)]
    order = {"Large": 0, "Medium": 1, "Small": 2}
    out: dict[str, set[int]] = {}
    for r in range(sk.rows):
        t = read_fkey(sk, r, cs["TagsKey"]["off"])
        z = read_fkey(sk, r, cs["PassiveTreeExpansionJewelSizesKey"]["off"])
        if t is None or z is None or z >= len(size_name):
            continue
        out.setdefault(ctx.mr.tag_id[t], set()).add(order.get(size_name[z], 3))
    ctx._cluster_tags = out
    return out


def group_cluster(ctx):
    size_tags = {"expansion_jewel_large": 0, "expansion_jewel_medium": 1,
                 "expansion_jewel_small": 2}

    def group(_gens, tags, _mods):
        by_tag = cluster_size_of_tags(ctx)
        sizes = {size_tags[t] for t in tags if t in size_tags}
        for t in tags:
            sizes |= by_tag.get(t, set())
        sizes.discard(3)
        return sizes.pop() if len(sizes) == 1 else 3
    return group


def build_cluster_small_passives(ctx):
    """The 小天賦 group: what a cluster jewel's enchantment prints --
    "附加的小型天賦給予：增加 #% 火焰傷害" -- one entry per small-passive type,
    from PassiveTreeExpansionSkills -> PassiveSkills.Stats. The value is fixed
    per type but written as '#', like every other number here."""
    st = ctx.st
    sk = st.table("PassiveTreeExpansionSkills")
    cs = st.cols("PassiveTreeExpansionSkills")
    ps = st.table("PassiveSkills")
    cp = st.cols("PassiveSkills")
    head = ctx.ex.cs.get("StatDescripotionTreeExpansionJewelGrantedSmallStat")
    if head is None:
        raise SystemExit("client string StatDescripotionTreeExpansionJewelGrantedSmallStat missing")
    head_en, head_zh = head
    files = ["passive_skill_stat_descriptions.txt", "stat_descriptions.txt"]
    items = []
    for r in range(sk.rows):
        p = read_fkey(sk, r, cs["PassiveSkillsKey"]["off"])
        if p is None:
            continue
        sids = read_fkey_array(ps, p, cp["Stats"]["off"])
        vals = [read_i32(ps, p, cp[f"Stat{i}Value"]["off"]) for i in range(1, 6)]
        stats = [(ctx.mr.stat_id[k], v, v) for k, v in zip(sids, vals) if k < len(ctx.mr.stat_id)]
        zh, en = stat_lines(ctx, stats, files)
        if not zh:
            ctx.counts["cluster_jewel.small_passive_no_wording"] += 1
            continue
        zl = [head_zh.replace("{0}", l).strip() for l in zh]
        el = [head_en.replace("{0}", l).strip() for l in en]
        items.append({"id": ps.read_string(p, cp["Id"]["off"]), "zh": zl, "en": el})
    return items


def build_cluster(ctx):
    bases = get_bases(ctx).names_with_prefix("Metadata/Items/Jewels/JewelPassiveTreeExpansion")
    entries = mod_page_with_seam(ctx, "cluster_jewel", bases, group=group_cluster(ctx))
    have = {e["zh"][0] for e in entries} | {e["en"][0] for e in entries}
    for it in build_cluster_small_passives(ctx):
        if it["zh"][0] in have or it["en"][0] in have:
            continue
        have |= {it["zh"][0], it["en"][0]}
        entries.append({"id": it["id"], "zh": it["zh"], "en": it["en"], "g": 4})
    entries.sort(key=lambda e: (e["g"], e["zh"][0]))
    return entries, bases + small_passive_names(ctx), None


def small_passive_names(ctx) -> list[tuple[str, str]]:
    """Names of the passives a cluster jewel adds (the notables are named in
    their line already; the small ones are named on the tree, not the item,
    but the item's advanced popup lists them) -- ambient, to be safe."""
    st = ctx.st
    sk = st.table("PassiveTreeExpansionSkills")
    cs = st.cols("PassiveTreeExpansionSkills")
    ps, ps_tc = st.pair("PassiveSkills")
    cp = st.cols("PassiveSkills")
    out = []
    for r in range(sk.rows):
        for col in ("PassiveSkillsKey", "Mastery_PassiveSkillsKey"):
            p = read_fkey(sk, r, cs[col]["off"])
            if p is None:
                continue
            zh, en = ps_tc.read_string(p, cp["Name"]["off"]), ps.read_string(p, cp["Name"]["off"])
            if usable_name(zh, en) and (zh, en) not in out:
                out.append((zh, en))
    return out


# ---- gems ----------------------------------------------------------------------

def build_gem_names(ctx):
    """Every skill and support gem by name, plus each transfigured variant
    (GemEffects.Name) as its own row -- the transfigured gem is its own item
    with its own name. Groups: 主動 / 輔助 / 轉化 / 瓦爾.

    Hidden text is what the gem prints besides its name: the tag line
    (GemEffects.GemTags) and the description (the active skill's, or the
    support text)."""
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

    def tag_line(v: int) -> tuple[list[str], list[str]]:
        tags = []
        for t in read_fkey_array(ge, v, ce["GemTags"]["off"]):
            zh, en = gt_tc.read_string(t, ct["Tag"]["off"]), gt.read_string(t, ct["Tag"]["off"])
            if zh and en:
                tags.append((zh, en))
        return joined_tags(tags)

    def description(v: int) -> tuple[list[str], list[str]]:
        zh = clean_desc(ge_tc.read_string(v, ce["SupportText"]["off"]))
        en = clean_desc(ge.read_string(v, ce["SupportText"]["off"]))
        g = read_fkey(ge, v, ce["GrantedEffect"]["off"])
        if g is not None:
            a = read_fkey(gr, g, cgr["ActiveSkill"]["off"])
            if a is not None:
                add_unique(zh, clean_desc(ask_tc.read_string(a, ca["Description"]["off"])))
                add_unique(en, clean_desc(ask.read_string(a, ca["Description"]["off"])))
        return zh, en

    items = []
    for r in range(sg.rows):
        base = read_fkey(sg, r, cg["BaseItemTypesKey"]["off"])
        if base is None:
            continue
        zh, en = b.name(base)
        if not usable_name(zh, en):
            continue
        support = read_bool(sg, r, cg["IsSupport"]["off"])
        vaal = read_bool(sg, r, cg["IsVaalVariant"]["off"])
        group = 1 if support else (3 if vaal else 0)
        variants = read_fkey_array(sg, r, cg["GemVariants"]["off"])
        hz, he = [], []
        if variants:
            tz, te = tag_line(variants[0])
            dz, de = description(variants[0])
            hz, he = tz + dz, te + de
        items.append({"id": b.id(base), "zh": zh, "en": en, "g": group,
                      "hiddenZh": hz, "hiddenEn": he})
        for v in variants[1:]:
            vz, ve = ge_tc.read_string(v, ce["Name"]["off"]), ge.read_string(v, ce["Name"]["off"])
            if not usable_name(vz, ve) or vz == zh or ve == en:
                continue
            tz, te = tag_line(v)
            dz, de = description(v)
            items.append({"id": b.id(base) + "#" + ge.read_string(v, ce["Id"]["off"]),
                          "zh": vz, "en": ve, "g": 2,
                          "hiddenZh": tz + dz, "hiddenEn": te + de})
    entries = names_entries(items)
    dropped = scrub_hidden_against_printed(entries)
    ctx.counts["gem_names.hidden_equal_to_a_name"] += dropped
    return entries, [], None


# ---- tattoos -------------------------------------------------------------------

def build_tattoos(ctx):
    """Tattoos and runegrafts (both live in PassiveSkillTattoos): the item
    name and the effect it grants (Override -> PassiveSkillOverrides.Stats),
    grouped by the passive they replace (PassiveSkillTattooTargetSets).
    The "取代一個 X 天賦" line is hidden text: every tattoo of the group prints
    it, so it can never single one out."""
    st = ctx.st
    b = get_bases(ctx)
    tt = st.table("PassiveSkillTattoos")
    ct = st.cols("PassiveSkillTattoos")
    ov = st.table("PassiveSkillOverrides")
    co = st.cols("PassiveSkillOverrides")
    ts, ts_tc = st.pair("PassiveSkillTattooTargetSets")
    cs = st.cols("PassiveSkillTattooTargetSets")
    rep_en, rep_zh = ctx.ex.cs["TattooDisplayReplaces"]
    files = ["passive_skill_stat_descriptions.txt", "stat_descriptions.txt"]
    groups_zh, groups_en, gidx = [], [], {}
    items = []
    for r in range(tt.rows):
        base = read_fkey(tt, r, ct["Tattoo"]["off"])
        o = read_fkey(tt, r, ct["Override"]["off"])
        s = read_fkey(tt, r, ct["Set"]["off"])
        if base is None or o is None or s is None:
            continue
        zh, en = b.name(base)
        if not usable_name(zh, en):
            continue
        # Grouped by the target set's printed name: the three "Big" sets are
        # all 核心天賦 / Notable and one group reads better than three.
        sid = ts_tc.read_string(s, cs["Name"]["off"]) or ts.read_string(s, cs["Id"]["off"])
        if sid not in gidx:
            gidx[sid] = len(groups_zh)
            groups_zh.append(sid)
            groups_en.append(ts.read_string(s, cs["Name"]["off"]) or sid)
        keys = read_fkey_array(ov, o, co["Stats"]["off"])
        vals = read_i32_array(ov, o, co["StatValues"]["off"])
        stats = [(ctx.mr.stat_id[k], v, v) for k, v in zip(keys, vals) if k < len(ctx.mr.stat_id)]
        lz, le = stat_lines(ctx, stats, files)
        if not lz:
            ctx.counts["tattoos.no_wording"] += 1
        tz = rep_zh.replace("{0}", ts_tc.read_string(s, cs["Name"]["off"]))
        te = rep_en.replace("{0}", ts.read_string(s, cs["Name"]["off"]))
        items.append({"id": b.id(base), "zh": [zh] + lz, "en": [en] + le, "g": gidx[sid],
                      "hiddenZh": [tz], "hiddenEn": [te]})
    entries = []
    seen = set()
    for it in items:
        if it["zh"][0] in seen:
            continue
        seen.add(it["zh"][0])
        e = {"id": it["id"], "zh": [], "en": [], "g": it["g"]}
        add_unique(e["zh"], it["zh"])
        add_unique(e["en"], it["en"])
        e["hiddenZh"], e["hiddenEn"] = it["hiddenZh"], it["hiddenEn"]
        entries.append(e)
    entries.sort(key=lambda e: (e["g"], e["zh"][0]))
    ctx.counts["tattoos.hidden_equal_to_a_line"] += scrub_hidden_against_printed(entries)
    ctx.counts["tattoos.folded"] += dedupe_first_lines(entries)
    return entries, [], (groups_zh, groups_en)


# ---- beasts and magic affix names (pages poe.re has, 2026-11-04) -------------------

MONSTER_DOMAIN = 3   # Mods.Domain of monster modifiers (a captured rare beast keeps its own)


def _pairs(zs: list[str], es: list[str]) -> list[tuple[str, str]]:
    """Ambient pairs from two lists that need not line up (add_unique dedups each side).
    One side empty: the other side's lines go to both -- a Chinese line refuses no
    English token and the other way round."""
    if not zs or not es:
        return [(x, x) for x in zs or es]
    n = max(len(zs), len(es))
    return [(zs[min(i, len(zs) - 1)], es[min(i, len(es) - 1)]) for i in range(n)]


def build_beasts(ctx):
    """Capturable beasts by name (BestiaryCapturableMonsters -> MonsterVarieties.Name),
    grouped by family (BestiaryGroups -> BestiaryFamilies). A disabled row is not in the
    game. The beast is searched in the bestiary list and as an Imprinted Bestiary Orb in
    a stash, so its genus / group / family names are hidden text and the monster
    modifier names (a rare beast keeps its mods) are ambient."""
    st = ctx.st
    bc = st.table("BestiaryCapturableMonsters"); cc = st.cols("BestiaryCapturableMonsters")
    mv, mv_tc = st.pair("MonsterVarieties"); cm = st.cols("MonsterVarieties")
    gr, gr_tc = st.pair("BestiaryGroups"); cg = st.cols("BestiaryGroups")
    ge, ge_tc = st.pair("BestiaryGenus"); cge = st.cols("BestiaryGenus")
    fa, fa_tc = st.pair("BestiaryFamilies"); cf = st.cols("BestiaryFamilies")
    groups_zh, groups_en, gidx = [], [], {}
    items = []
    for r in range(bc.rows):
        if read_bool(bc, r, cc["IsDisabled"]["off"]):
            continue
        m = read_fkey(bc, r, cc["MonsterVarietiesKey"]["off"])
        g = read_fkey(bc, r, cc["BestiaryGroupsKey"]["off"])
        n = read_fkey(bc, r, cc["BestiaryGenusKey"]["off"])
        if m is None or g is None:
            continue
        zh, en = mv_tc.read_string(m, cm["Name"]["off"]), mv.read_string(m, cm["Name"]["off"])
        if not usable_name(zh, en):
            continue
        f = read_fkey(gr, g, cg["BestiaryFamiliesKey"]["off"])
        hz, he = [gr_tc.read_string(g, cg["Name"]["off"])], [gr.read_string(g, cg["Name"]["off"])]
        if n is not None:
            hz.insert(0, ge_tc.read_string(n, cge["Name"]["off"]))
            he.insert(0, ge.read_string(n, cge["Name"]["off"]))
        if f is not None:
            hz.append(fa_tc.read_string(f, cf["Name"]["off"]))
            he.append(fa.read_string(f, cf["Name"]["off"]))
            if f not in gidx:
                gidx[f] = len(groups_zh)
                groups_zh.append(fa_tc.read_string(f, cf["Name"]["off"]))
                groups_en.append(fa.read_string(f, cf["Name"]["off"]))
        items.append({"id": mv.read_string(m, cm["Id"]["off"]), "zh": zh, "en": en,
                      "g": gidx.get(f, 0), "hiddenZh": [h for h in hz if h], "hiddenEn": [h for h in he if h]})
    entries = names_entries(items)
    ctx.counts["beasts.hidden_equal_to_a_name"] += scrub_hidden_against_printed(entries)
    # The orb the beast is imprinted on, and every monster modifier name.
    amb = []
    b = get_bases(ctx)
    orb = b.by_id.get("Metadata/Items/Currency/CurrencyItemisedCapturedMonster")
    if orb is not None:
        amb.append(b.name(orb))
    en_m, tc_m = st.pair("Mods"); cmod = st.cols("Mods")
    for r in range(en_m.rows):
        if read_i32(en_m, r, cmod["Domain"]["off"]) != MONSTER_DOMAIN:
            continue
        zh, en = tc_m.read_string(r, cmod["Name"]["off"]), en_m.read_string(r, cmod["Name"]["off"])
        if zh and en and (zh, en) not in amb:
            amb.append((zh, en))
    return entries, amb, (groups_zh, groups_en)


# Mods.Domain of the items a magic name can be on: equipment, flasks, jewels, abyss
# jewels, tinctures (the vendor_bases folders hold all of them).
MAGIC_DOMAINS = {1, 2, 10, 13, 34}


def build_magic_affixes(ctx):
    """Magic item affix names (the item's name line), one row per Chinese name, in two
    groups: prefix / suffix. Mods of a MAGIC_DOMAINS domain with a spawn weight above 0.
    The Chinese client joins them without spaces -- prefix + suffix + base
    (clientstrings MagicNamePrefixSuffix "{1}{2}{0}") -- so the names and the base names
    go to the page's name words (seam_words: the generator refuses a token across any
    seam), the base names, item classes and base implicit lines (the vendor_bases page)
    are ambient, and each name's modifier lines are its hidden text.

    Two Chinese names under one English name (Humming = 低鳴的 / 雷電之, two mods) stay
    two rows: told apart in Chinese, "cannot single out" in English like any two items
    that print the same text. Their English first line cannot be the row key, so those
    rows carry their own `key` (English name#mod id; KeyOf / keyOf prefer it)."""
    st = ctx.st
    en_m, tc_m = st.pair("Mods"); cm = st.cols("Mods")
    files = ["stat_descriptions.txt"]
    items = []
    for r in range(en_m.rows):
        if read_i32(en_m, r, cm["Domain"]["off"]) not in MAGIC_DOMAINS:
            continue
        gt = read_i32(en_m, r, cm["GenerationType"]["off"])
        if gt not in (1, 2) or not any(w > 0 for w in read_i32_array(en_m, r, cm["SpawnWeight_Values"]["off"])):
            continue
        zh, en = tc_m.read_string(r, cm["Name"]["off"]), en_m.read_string(r, cm["Name"]["off"])
        if not usable_name(zh, en):
            continue
        lz, le = stat_lines(ctx, ctx.mr.stats_of(r), files)
        if not lz:
            ctx.counts["magic_affixes.no_wording"] += 1
        items.append({"id": en_m.read_string(r, cm["Id"]["off"]), "zh": zh, "en": en, "g": gt - 1,
                      "hiddenZh": lz, "hiddenEn": le})
    entries = names_entries(items)
    ctx.counts["magic_affixes.hidden_equal_to_a_name"] += scrub_hidden_against_printed(entries)
    # A shared English first line cannot be the row's key (share codes carry the key
    # alone): such rows get their own, English name + mod id.
    shared = Counter(e["en"][0] for e in entries)
    for e in entries:
        if shared[e["en"][0]] > 1:
            e["key"] = f"{e['en'][0]}#{e['id']}"
    bases, class_lines, _groups = build_vendor_bases(ctx, POE1_BASE_FOLDERS, files)
    amb = list(class_lines)
    for e in bases:
        amb += _pairs(e["zh"], e["en"]) + _pairs(e.get("hiddenZh", []), e.get("hiddenEn", []))
    ctx.seam["magic_affixes"] = seam_words(
        [(it["g"] + 1, it["zh"], it["en"]) for it in items],
        [(z, e) for b in bases for z, e in _pairs(b["zh"], b["en"])])
    return entries, amb, (["前綴", "後綴"], ["Prefix", "Suffix"])


# ---- heist ---------------------------------------------------------------------

HEIST_SLOT_TAGS = {
    "heist_equipment_weapon": 0,    # 裝備（武器）
    "heist_equipment_tool": 1,      # 工具
    "heist_equipment_utility": 2,   # 披風
    "heist_equipment_reward": 3,    # 胸針
}


def group_heist_equipment(_gens, tags, mod_ids):
    if all(m.startswith("HeistTrinket") for m in mod_ids):
        return 4
    slots = {HEIST_SLOT_TAGS[t] for t in tags if t in HEIST_SLOT_TAGS}
    return slots.pop() if len(slots) == 1 else 5


def heist_jobs(ctx) -> list[tuple[str, str, str]]:
    """(id, chinese name, english name) of the nine rogue jobs."""
    jb, jb_tc = ctx.st.pair("HeistJobs")
    cj = ctx.st.cols("HeistJobs")
    return [(jb.read_string(r, cj["Id"]["off"]), jb_tc.read_string(r, cj["Name"]["off"]),
             jb.read_string(r, cj["Name"]["off"])) for r in range(jb.rows)]


def heist_npc_names(ctx) -> list[tuple[str, str]]:
    nn, nn_tc = ctx.st.pair("HeistNPCs")
    cn = ctx.st.cols("HeistNPCs")
    out = []
    for r in range(nn.rows):
        zh, en = nn_tc.read_string(r, cn["Name"]["off"]), nn.read_string(r, cn["Name"]["off"])
        if usable_name(zh, en):
            out.append((zh, en))
    return out


def heist_equipment_ambient(ctx) -> list[tuple[str, str]]:
    """Every heist item prints who may equip it: 'Level # in <job>' per job
    and the NPC names; plus the bases themselves."""
    out = []
    lv_en, lv_zh = ctx.ex.cs["ItemDisplayHeistJobRequirement"]
    for _i, zh, en in heist_jobs(ctx):
        out.append((lv_zh.replace("{0}", "#").replace("{1}", zh),
                    lv_en.replace("{0}", "#").replace("{1}", en)))
        out.append((zh, en))
    out += heist_npc_names(ctx)
    out += get_bases(ctx).names_with_prefix("Metadata/Items/Heist/HeistEquipment",
                                           "Metadata/Items/Heist/HeistTrinket",
                                           "Metadata/Items/Heist/Trinket")
    return out


def build_heist_equipment(ctx):
    bases = get_bases(ctx).names_with_prefix(
        "Metadata/Items/Heist/HeistEquipment", "Metadata/Items/Heist/HeistTrinket",
        "Metadata/Items/Heist/Trinket")
    entries = mod_page_with_seam(ctx, "heist_equipment_mods", bases)
    return entries, heist_equipment_ambient(ctx), None


def build_heist_contracts(ctx):
    """Contract / blueprint modifiers (Domain HEIST_AREA) plus one row per
    rogue job for the 'Requires <job> (Level #)' line every contract prints
    -- the job a contract needs is the first thing a player filters by."""
    bases = get_bases(ctx).names_with_prefix("Metadata/Items/Heist/HeistContract",
                                             "Metadata/Items/Heist/HeistBlueprint")
    entries = mod_page_with_seam(ctx, "heist_contracts", bases)
    req_en, req_zh = ctx.ex.cs["ItemDisplayHeistContractJob"]
    for jid, zh, en in heist_jobs(ctx):
        if not usable_name(zh, en):
            continue
        entries.append({"id": "HeistJob:" + jid,
                        "zh": [req_zh.replace("{0}", "#").replace("{1}", zh).strip()],
                        "en": [req_en.replace("{0}", "#").replace("{1}", en).strip()],
                        "g": 3})
    entries.sort(key=lambda e: (e["g"], e["zh"][0]))
    # What every contract prints: its target area, the NPC it may name, the
    # objective labels. The area names come from HeistContracts -> HeistAreas.
    extra = list(bases)
    hc = ctx.st.table("HeistContracts")
    chc = ctx.st.cols("HeistContracts")
    ha = ctx.st.table("HeistAreas")
    cha = ctx.st.cols("HeistAreas")
    wa, wa_tc = ctx.st.pair("WorldAreas")
    cwa = ctx.st.cols("WorldAreas")
    for r in range(hc.rows):
        a = read_fkey(hc, r, chc["HeistAreasKey"]["off"])
        w = read_fkey(ha, a, cha["WorldAreasKeys"]["off"]) if a is not None else None
        if w is not None:
            zh, en = wa_tc.read_string(w, cwa["Name"]["off"]), wa.read_string(w, cwa["Name"]["off"])
            if usable_name(zh, en) and (zh, en) not in extra:
                extra.append((zh, en))
    npc_en, npc_zh = ctx.ex.cs["ItemDisplayHeistContractNPC"]
    for zh, en in heist_npc_names(ctx):
        extra.append((zh, en))
        extra.append((npc_zh.replace("{0}", zh), npc_en.replace("{0}", en)))
    return entries, extra, None


# ---- vendor bases ----------------------------------------------------------------

# ---- flasks ----------------------------------------------------------------------

def group_flask(gens, _tags, _mods):
    if gens <= {GEN_ENKINDLING, GEN_INSTILLING}:
        return 2
    return 0 if gens == {GEN_PREFIX} else (1 if gens == {GEN_SUFFIX} else 3)


def build_flask_mods(ctx):
    bases = get_bases(ctx).names_with_prefix("Metadata/Items/Flasks/")
    entries = mod_page_with_seam(ctx, "flask_mods", bases)
    return entries, bases, None


# ---- tinctures (exile-appraiser 2026-11-13) ----------------------------------------
# PoE1 的基底資料夾:vendor_bases 與 magic_affixes 共用。萃取物商店不賣,但使用者要在
# 物品基底頁找得到(2026-11-13 裁定),所以也收。PoE2 沒有萃取物,VENDOR_FOLDERS 不動。
# 萃取物的詞綴文字在自己的描述檔(stat_descriptions.txt 查不到 → 整頁空白)
TINCTURE_FILES = ["tincture_stat_descriptions.txt", "stat_descriptions.txt"]
POE1_BASE_FOLDERS = tuple("Metadata/Items/" + f for f in VENDOR_FOLDERS + ("Tinctures/",))


def group_tincture(gens, _tags, _mods):
    assert len(gens) == 1, f"tincture line is both prefix and suffix: {gens}"
    return 0 if gens == {GEN_PREFIX} else 1


def build_tincture_mods(ctx):
    """Tincture prefixes / suffixes (Mods.Domain 34). Ambient: the class line, every
    tincture base name and each base's implicit lines -- a token inside one of those
    would light up every tincture of that base."""
    bases, class_lines, _groups = build_vendor_bases(
        ctx, ("Metadata/Items/Tinctures/",), TINCTURE_FILES)
    names = [(z, e) for b in bases for z, e in _pairs(b["zh"], b["en"])]
    entries = mod_page_with_seam(ctx, "tincture_mods", names)
    amb = list(class_lines) + names
    for b in bases:
        amb += _pairs(b.get("hiddenZh", []), b.get("hiddenEn", []))
    return entries, amb, None


# --- page declarations --------------------------------------------------------
# A modifier page is: which modifiers (domain, generation types, spawn tags),
# which wording (statdescription file priority), which stats are really
# properties, how the rows are grouped, and what every item of the page prints
# (ambient client strings, base names, rare-name words). A names page supplies
# its own `build` instead of the modifier machinery.

PAGES: list[dict] = [
    {
        "id": "map_mods",
        "kind": "mods",
        "legacy": True,
        "title": "地圖詞綴",
        "titleEn": "Map modifiers",
        "note": "勾選要找的詞綴，把產生的字串貼進倉庫搜尋列。"
                "產生的片段會避開這份清單裡的其他詞綴，"
                "也避開遊戲同樣會比對的詞綴名稱、階層、標籤、提示說明與地圖名。",
        "groups": ["前綴", "後綴", "前後綴皆有"],
        "groupsEn": ["Prefix", "Suffix", "Both"],
        "domain": DOMAIN_AREA,
        "accept": lambda live: bool(live & (MAP_TAGS | T17_TAGS)),
        "t17_clear": lambda live: bool(live & MAP_TAGS),
        "aggregate": lambda sid: sid in AGGREGATE_STATS,
        "drop_zero": False,
        "files": FILE_PRIORITY,
        "group": group_by_generation,
        "name_bases": lambda ex: ex.map_bases,
        "ambient_ids": AMBIENT_MAP_IDS,
        "ambient_extra": lambda ex: ex.map_bases + ex.map_named,
        "words_tag": "map",
    },
    {
        "id": "logbook_mods",
        "kind": "mods",
        "legacy": True,
        "title": "探險日誌詞綴",
        "titleEn": "Expedition logbook modifiers",
        "note": "勾選要找的日誌詞綴。產生的片段會避開這份清單裡的其他詞綴，"
                "也避開遊戲同樣會比對的詞綴名稱、階層、提示說明與日誌名。",
        "groups": ["前綴", "後綴", "前後綴皆有"],
        "groupsEn": ["Prefix", "Suffix", "Both"],
        "domain": DOMAIN_AREA,
        "accept": lambda live: bool(live & LOGBOOK_TAGS),
        "aggregate": lambda sid: sid in AGGREGATE_STATS,
        "drop_zero": False,
        "files": FILE_PRIORITY,
        "group": group_by_generation,
        "name_bases": lambda ex: ex.logbook_bases,
        "ambient_ids": AMBIENT_LOGBOOK_IDS,
        "ambient_extra": lambda ex: ex.logbook_bases + ex.factions + ex.areas,
        "words_tag": "expedition_logbook",
    },
    {
        "id": "scarabs",
        "kind": "names",
        "title": "聖甲蟲",
        "titleEn": "Scarabs",
        "note": "聖甲蟲名稱與效果文字，依種類分組。"
                "產生的片段會避開清單裡其他聖甲蟲的名稱與效果。",
        "groups": [], "groupsEn": [],          # one per scarab type, from the data
        "build": build_scarabs,
        "ambient_ids": ["ItemDisplayStackSize", "ItemDisplayLimit", "ItemDescriptionMapFragment",
                        "ItemPopupCorrupted", "ItemPopupMirrored", "ItemPopupSplit",
                        "ItemDisplayStringCurrency"],
    },
    {
        "id": "flask_mods",
        "kind": "mods",
        "title": "藥劑詞綴",
        "titleEn": "Flask modifiers",
        "note": "藥劑的前綴、後綴與附魔（點燃／注入類通貨加上的效果）。"
                "產生的片段會避開這份清單裡的其他詞綴、詞綴名稱與藥劑名。",
        "groups": ["前綴", "後綴", "附魔", "前後綴皆有"],
        "groupsEn": ["Prefix", "Suffix", "Enchantment", "Both"],
        "sources": [
            {"domain": DOMAIN_FLASK, "gens": (GEN_PREFIX, GEN_SUFFIX)},
            # Enkindling / instilling enchantments: Domain ITEM, their own
            # generation types, spawn tag `flask`.
            {"domain": DOMAIN_ITEM, "gens": (GEN_ENKINDLING, GEN_INSTILLING),
             "accept": lambda live: "flask" in live},
        ],
        "accept": lambda live: True,
        "files": ["stat_descriptions.txt"],
        "group": group_flask,
        "build": build_flask_mods,
        "ambient_ids": AMBIENT_ITEM_IDS + [
            "ItemDisplayFlaskLifeRecovery1Second", "ItemDisplayFlaskLifeRecoveryNSeconds",
            "ItemDisplayFlaskManaRecovery1Second", "ItemDisplayFlaskManaRecoveryNSeconds",
            "ItemDisplayFlaskBuffDuration1Second", "ItemDisplayFlaskBuffDurationNSeconds",
            "ItemDisplayChargesConsumptionOnUse1Charge", "ItemDisplayChargesConsumptionOnUseNCharges",
            "ItemDisplayChargesNCharges", "ItemDisplayChargesCurrentOfMaxN"],
    },
    {
        # exile-appraiser 2026-11-13: 萃取物詞綴(使用者回報正則缺萃取物資料)
        "id": "tincture_mods",
        "kind": "mods",
        "title": "萃取物詞綴",
        "titleEn": "Tincture modifiers",
        "note": "萃取物的前綴與後綴。"
                "產生的片段會避開這份清單裡的其他詞綴、詞綴名稱、萃取物名稱與基底固有詞綴。"
                "只差在數字兩側文字的詞綴（增加／減少 #% 效果等）無法單獨指定，請改用「物品詞綴數值」頁。",
        "groups": ["前綴", "後綴"],
        "groupsEn": ["Prefix", "Suffix"],
        "sources": [{"domain": DOMAIN_TINCTURE, "gens": (GEN_PREFIX, GEN_SUFFIX)}],
        "accept": lambda live: True,
        "files": TINCTURE_FILES,
        "group": group_tincture,
        "build": build_tincture_mods,
        "ambient_ids": AMBIENT_ITEM_IDS + [
            "ItemDisplayTinctureToxicity1Second", "ItemDisplayTinctureToxicityNSeconds",
            "ItemDisplayTinctureCooldown1Second", "ItemDisplayTinctureCooldownNSeconds",
            "ItemDescriptionTincture"],
    },
    {
        "id": "cluster_jewel",
        "kind": "mods",
        "title": "星團珠寶詞綴",
        "titleEn": "Cluster jewel modifiers",
        "note": "大／中／小型星團珠寶的詞綴與核心天賦；「小天賦」是底座附魔印的那一行。"
                "產生的片段會避開這份清單裡的其他詞綴、詞綴名稱與珠寶名。",
        "groups": ["大型", "中型", "小型", "多種尺寸", "小天賦"],
        "groupsEn": ["Large", "Medium", "Small", "Several sizes", "Small passives"],
        "domain": DOMAIN_AFFLICTION_JEWEL,
        "accept": lambda live: True,
        "files": ["stat_descriptions.txt"],
        "group": group_by_generation,          # replaced in build_cluster
        "build": build_cluster,
        "ambient_ids": AMBIENT_ITEM_IDS + [
            "ItemDescriptionPassiveJewel", "JewelItemLimit", "JewelRadiusLabel",
            "PassiveNodeExpansionJewelRadiusWarning"],
        "words_tag": "jewel",
    },
    {
        "id": "gem_names",
        "kind": "names",
        "title": "技能寶石",
        "titleEn": "Skill gems",
        "note": "技能與輔助寶石名稱，轉化寶石各自一列。等級、品質、汙染請用數值條件。"
                "產生的片段會避開其他寶石的名稱、標籤與說明文字。",
        "groups": ["主動", "輔助", "轉化", "瓦爾"],
        "groupsEn": ["Active", "Support", "Transfigured", "Vaal"],
        "build": build_gem_names,
        "ambient_ids": ["Level", "Quality", "ItemPopupCorrupted", "ItemPopupRequirements",
                        "ItemDescriptionSkillGem", "ItemDescriptionActiveSkillGem",
                        "ItemPopupAlternateGemItem", "ItemDisplayStringGem",
                        "ItemDisplaySkillGemManaCost", "ItemDisplaySkillGemManaReserved",
                        "ItemDisplaySkillGemManaMultiplier", "ItemDisplaySkillGemCastTime",
                        "ItemDisplaySkillGemCastTimeValue", "ItemDisplaySkillGemCooldownTime",
                        "ItemDisplaySkillGemCooldownValue", "ItemDisplaySkillGemCriticalStrikeChance",
                        "ItemDisplaySkillGemDamageEffectiveness",
                        "ItemDisplaySkillGemAttackSpeedMultiplier",
                        "ItemDisplaySkillGemAttackDamageEffectiveness", "ItemDisplaySkillGemMaxLevel",
                        "ItemPopupNextLevel", "ItemDisplayStringNextLevelRequirements"],
    },
    {
        "id": "tattoos",
        "kind": "names",
        "title": "紋身與符文之結",
        "titleEn": "Tattoos and runegrafts",
        "note": "紋身／符文之結名稱與效果，依可取代的天賦分組。"
                "產生的片段會避開其他紋身的名稱與效果文字。",
        "groups": [], "groupsEn": [],          # one per target set, from the data
        "build": build_tattoos,
        "ambient_ids": ["ItemDisplayStackSize", "ItemPopupCorrupted", "PassiveSkillTattooLimitReminder",
                        "ItemDisplayTattooAdjacentAllocatedRequirement",
                        "ItemDisplayTattooAdjacentAllocatedRequirement1",
                        "ItemDisplayTattooRequirementMaximum", "PassiveSkillNodeTattooRemovalReminder",
                        "PassiveSkillNodeRunegraftRemovalReminder", "ItemDisplayLimit"],
    },
    {
        "id": "heist_equipment_mods",
        "kind": "mods",
        "title": "劫盜裝備詞綴",
        "titleEn": "Heist equipment modifiers",
        "note": "盜賊裝備（武器／工具／披風／胸針）與盜賊飾品的詞綴。"
                "產生的片段會避開這份清單裡的其他詞綴、詞綴名稱、職業需求與裝備名。",
        "groups": ["武器", "工具", "披風", "胸針", "盜賊飾品", "多種裝備"],
        "groupsEn": ["Gear", "Tool", "Cloak", "Brooch", "Thieves' Trinket", "Several"],
        "sources": [
            {"domain": DOMAIN_HEIST_NPC, "gens": (GEN_PREFIX, GEN_SUFFIX)},
            {"domain": DOMAIN_HEIST_TRINKET, "gens": (GEN_PREFIX, GEN_SUFFIX)},
        ],
        "accept": lambda live: True,
        "files": ["heist_equipment_stat_descriptions.txt", "stat_descriptions.txt"],
        "group": group_heist_equipment,
        "build": build_heist_equipment,
        "ambient_ids": AMBIENT_ITEM_IDS + ["ItemDisplayHeistEquipmentUsersAll",
                                           "ItemDisplayHeistEquipmentUsers", "HeistRequiresText",
                                           "ItemDescriptionTrinket", "ItemDisplayHeistAnyJob"],
        "words_tag": ["heist_equipment_weapon", "heist_equipment_tool",
                      "heist_equipment_utility", "heist_equipment_reward", "trinket"],
    },
    {
        "id": "heist_contracts",
        "kind": "mods",
        "title": "劫盜契約書詞綴",
        "titleEn": "Heist contract modifiers",
        "note": "契約書與藍圖的詞綴，外加「需要 職業 (等級 #)」九行。"
                "產生的片段會避開這份清單裡的其他詞綴、詞綴名稱、地點與成員名。",
        "groups": ["前綴", "後綴", "前後綴皆有", "職業需求"],
        "groupsEn": ["Prefix", "Suffix", "Both", "Job required"],
        "domain": DOMAIN_HEIST_AREA,
        "accept": lambda live: True,
        # A contract prints these summed, once, as properties (物品數量、稀有度、
        # 警戒等級減免、封鎖前的時間、最大生存支援) -- the heist counterpart of
        # a map's AGGREGATE_STATS. None has a modifier-line wording anyway.
        "aggregate": lambda sid: sid in HEIST_CONTRACT_AGGREGATE,
        # Contract lines are area lines ("區域有燃燒地面"), worded where a map's are.
        "files": FILE_PRIORITY,
        "group": group_by_generation,
        "build": build_heist_contracts,
        "ambient_ids": AMBIENT_ITEM_IDS + [
            "ItemDisplayHeistMaxReinforcements", "ItemDisplayHeistAlertLevelReduction",
            "ItemDisplayHeistLockdownTimeIncrease", "ItemDisplayMapQuantityIncrease",
            "ItemDisplayMapRarityIncrease", "ItemDisplayHeistContractLevel", "ItemDisplayHeistContractWorldArea",
            "ItemDisplayHeistContractObjective", "ItemDisplayHeistContractObjectiveWithValue",
            "ItemDescriptionHeistContract", "HeistAreaText", "HeistRequiresText",
            "ItemDisplayHeistBlueprintWings", "ItemDisplayHeistBlueprintRewardRooms",
            "ItemDisplayHeistBlueprintEscapeRooms", "ItemDisplayHeistAnyJob",
            "ItemDisplayItemisedAreaLevel"],
        "words_tag": ["heist_contract", "heist_blueprint"],
    },
    {
        "id": "vendor_bases",
        "kind": "names",
        "title": "物品基底",
        "titleEn": "Item bases",
        "note": "商店與地上物品的基底名稱，依物品種類分組；連結、插槽、物品等級、勢力請用數值條件。"
                "產生的片段會避開其他基底名、種類名與基底內建詞綴。",
        "groups": [], "groupsEn": [],          # one per item class, from the data
        "build": lambda ctx: build_vendor_bases(
            # 萃取物基底的固有詞綴只有萃取物描述檔有文字;排在後面當後援,其他基底不受影響
            ctx, POE1_BASE_FOLDERS, ["stat_descriptions.txt", "tincture_stat_descriptions.txt"]),
        "ambient_ids": AMBIENT_ITEM_IDS + ["ItemDisplayStringClass"],
    },
    {
        "id": "beasts",
        "kind": "names",
        "title": "野獸",
        "titleEn": "Beasts",
        "note": "可捕捉的野獸名稱,依家族分組;獸獵寓言清單與倉庫裡的拓印獸魂玉都適用。"
                "產生的片段會避開其他野獸的名稱、種屬 / 群組 / 家族名與怪物詞綴名。",
        "groups": [], "groupsEn": [],          # one per family, from the data
        "build": build_beasts,
        "ambient_ids": ["ItemDescriptionItemisedCapturedMonster", "ItemDisplayStackSize",
                        "ItemDisplayImprintImprinted", "BestiaryContextMenuOptionPopupLevel",
                        "ItemLevelPopup", "ItemPopupCorrupted"],
    },
    {
        "id": "magic_affixes",
        "kind": "names",
        "title": "魔法物品詞綴名",
        "titleEn": "Magic item affix names",
        "note": "魔法物品名稱裡的前綴 / 後綴名(繁中名稱是「前綴+後綴+基底」連在一起)。"
                "產生的片段會避開其他詞綴名、基底名與各詞綴的詞綴行。",
        "groups": [], "groupsEn": [],
        "build": build_magic_affixes,
        "ambient_ids": AMBIENT_ITEM_IDS + ["ItemDisplayStringClass"],
    },

]
PAGE_BY_ID = {p["id"]: p for p in PAGES}


# --- build --------------------------------------------------------------------

class Ctx:
    """What the page builders need: readers, sources, a wording cache."""

    def __init__(self):
        self.st = SchemaTables(SCHEMA_PATH, 1, DATA_EN, DATA_TC)
        self.blocks = json.loads(STATS_JSON.read_text(encoding="utf-8"))
        self.mr = ModReader(self.st)
        self.ex = Extras()
        self.wording: dict = {}
        self.counts: Counter = Counter()
        self.seam: dict = {}


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
    zh, en = ctx.ex.ambient(spec.get("ambient_ids", []))
    for t, e in (resolve(spec, "ambient_extra", ctx, []) or []) + amb_extra:
        add_unique(zh, [t])
        add_unique(en, [e])
    tags = spec.get("words_tag")
    prefix, suffix = [], []
    for tag in ([tags] if isinstance(tags, str) else (tags or [])):
        p, s = ctx.mr.words(tag)
        prefix += [w for w in p if w not in prefix]
        suffix += [w for w in s if w not in suffix]
    # The words themselves are lines too: a token inside one word is as bad as
    # one across the seam.
    for t, e in prefix + suffix:
        add_unique(zh, [t.strip()])
        add_unique(en, [e.strip()])
    if groups is not None:
        spec = dict(spec, groups=groups[0], groupsEn=groups[1])
    if spec.get("kind", "mods") == "names":
        # An entry's own printed line must not also be ambient: ambient text
        # refuses every token inside it, so a name that is also listed as a
        # base (a tattoo, a flask) would leave its own entry unfindable.
        printed = {l for e in entries for l in e["zh"] + e["en"]}
        zh = [l for l in zh if l not in printed]
        en = [l for l in en if l not in printed]
    return page_doc(spec, entries, zh, en, prefix, suffix, schema, ctx.seam.get(spec["id"]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true", help="print a sample, write nothing")
    ap.add_argument("--diag", action="store_true", help="print what was dropped and why")
    ap.add_argument("--schema", type=int, default=2, choices=(1, 2),
                    help="1 = the old two-page file (regression gate), 2 = current")
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
    ctx.counts["item_text_lines"] = add_item_texts(pages, item_texts(ctx.st, "FlavourTextKey", "BaseItemTypesKey"))
    ctx.counts["markup_stripped"] = strip_page_markup(pages)
    self_check_poe1(pages)
    self_check(pages)
    if args.schema >= 2:
        self_check_v2(pages)
    print("counts:", dict(ctx.counts))
    for p in pages:
        print(page_summary(p))

    if args.report:
        for p in pages:
            print(f"\n=== {p['id']} ({p['title']} / {p['titleEn']})")
            for e in p["entries"][:12]:
                g = p["groups"][e["g"]]
                print(f"  [{g}]{'[T17]' if e.get('t17') else ''} "
                      f"{e.get('affixZh', '-'):16s} {e['zh'][0]}  |  {e['en'][0]}")
            if len(p["entries"]) > 12:
                print(f"  ... {len(p['entries']) - 12} more")
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
        "game": "poe1",
        "source": "GGPK Mods/Stats/Tags/Words + tools/ggpk_zh/out/poe1/{stats,tables}",
    }
    if args.schema >= 2:
        doc["source"] = ("GGPK Mods/Stats/Tags/Words/BaseItemTypes/SkillGems/... + "
                         "tools/ggpk_zh/out/poe1/{stats,tables} + host/data/scarabs_poe1.json")
        doc["labels"] = labels_doc(ctx.ex.cs, LABEL_IDS)
    doc["pages"] = pages
    write_doc(args.out, doc)
    print("wrote", args.out, args.out.stat().st_size, "bytes",
          f"in {time.perf_counter() - t0:.2f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
