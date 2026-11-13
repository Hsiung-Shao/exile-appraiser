#!/usr/bin/env python3
"""What gen_regex_data.py (PoE1) and gen_regex_data2.py (PoE2) share.

Both generators produce the same file shape for the regex tool, from the same
kind of source (Mods / Stats / Tags / Words .datc64 plus the audited
statdescription pairing), under the same three rules -- numbers are not part of
the text, the unit is the printed LINE, aggregated properties are not lines.
See gen_regex_data.py's docstring for why each rule exists.

Everything that is the SAME in both games lives here: the dat readers, the text
helpers, the statdescription matcher (`Wording`), the generic modifier page
builder (`build_mod_page`), the names page helpers, the page/document writers
and the checks. What differs -- where a column is, which markup the game uses,
which reminder texts exist -- is supplied by each game's `ModReader` and
`Extras`, which expose the same methods:

    ModReader.affix_rows(domains, gens, need_live) -> (row, gen, live tags)
    ModReader.stats_of(row) / mod_id(row) / affix_name(row) / implicit_tags(row)
    ModReader.words(tag)
    Extras.clean_name(s) / clean_line(s) / advanced_line(gen, zh, en)
    Extras.reminder_lines(ids) / ambient(ids) / cs

A page is declared, not coded: a dict in the generator's PAGES list names the
domain, the spawn-tag filter, the statdescription file priority, the grouping,
the ambient client strings and the rare-name word list. `build_mod_page` turns
that into entries; `page_doc` into the page object the C++ side and
exile-appraiser read.

Schema 2 (both games) adds, on top of schema 1:
  * top level `labels: {zh: {key: text}, en: {key: text}}` -- client strings the
    algorithmic pages (map numbers, item level, quality, sockets, influence
    badges) build their terms from, `{0}` rolled to `#`;
  * per page `kind: "mods" | "names"`.
Readers that do not know the new keys ignore them (host/regex_data.cpp reads
by name and never iterates unknown keys). `--schema 1` still writes the old
shape, byte for byte, for the pages each game has always had.
"""
from __future__ import annotations

import json
import re
import struct
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Callable

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))   # exile-appraiser: datzh.py 與本檔同目錄
import datzh  # noqa: E402

GEN_PREFIX, GEN_SUFFIX = 1, 2


# --- dat plumbing -------------------------------------------------------------
# datzh reads strings; the numeric and reference columns live below. Same shape
# as tools/ggpk_zh/gen_scarabs.py on purpose: two readers of one byte layout that
# drifted apart would be a silent data bug.

def col_map(idx: dict, table: str) -> dict[str, dict]:
    """column name -> {off, type, array}. Unnamed columns are skipped; their
    byte offsets still count towards the ones that follow."""
    out, pos = {}, 0
    for c in idx[table.lower()]:
        if c.get("name") and c["name"] not in out:
            out[c["name"]] = {"off": pos, "type": c["type"], "array": bool(c.get("array"))}
        pos += datzh.col_size(c)
    return out


def read_fkey(t: datzh.Table, row: int, off: int):
    v, _ = struct.unpack_from("<QQ", t.data, t.cell_offset(row, off))
    return None if v == datzh.NULL_ROW else v


def read_rowref(t: datzh.Table, row: int, off: int):
    """A `row` column (8 bytes, self-reference or untyped row index)."""
    v = struct.unpack_from("<Q", t.data, t.cell_offset(row, off))[0]
    return None if v == datzh.NULL_ROW else v


def read_i32(t: datzh.Table, row: int, off: int) -> int:
    return struct.unpack_from("<i", t.data, t.cell_offset(row, off))[0]


def read_bool(t: datzh.Table, row: int, off: int) -> bool:
    return t.data[t.cell_offset(row, off)] != 0


def read_fkey_array(t: datzh.Table, row: int, off: int, keep_null: bool = False) -> list[int]:
    """`keep_null` writes -1 for a null reference instead of dropping it, so the
    result can be zipped against a parallel value array without mis-pairing."""
    cnt, ptr = struct.unpack_from("<QQ", t.data, t.cell_offset(row, off))
    if cnt == 0 or cnt > 100_000:
        return []
    out = []
    for i in range(cnt):
        v, _ = struct.unpack_from("<QQ", t.var, ptr + i * 16)
        if v != datzh.NULL_ROW:
            out.append(v)
        elif keep_null:
            out.append(-1)
    return out


def read_i32_array(t: datzh.Table, row: int, off: int) -> list[int]:
    cnt, ptr = struct.unpack_from("<QQ", t.data, t.cell_offset(row, off))
    if cnt == 0 or cnt > 100_000:
        return []
    return [struct.unpack_from("<i", t.var, ptr + i * 4)[0] for i in range(cnt)]


class SchemaTables:
    """Tables read through the community schema, with the row size checked
    before any numeric column is trusted (agent-data
    error_poe2_ggpk_layout_and_addressing.md section 6: a schema of another
    generation still decodes strings, and silently misreads everything else)."""

    def __init__(self, schema_path: Path, game: int, data_en: Path, data_tc: Path):
        self.idx = datzh.schema_index(datzh.load_schema(schema_path), game)
        self.data_en, self.data_tc = data_en, data_tc
        self._cache: dict[tuple[str, bool], datzh.Table] = {}

    def cols(self, table: str) -> dict[str, dict]:
        return col_map(self.idx, table)

    def table(self, name: str, tc: bool = False, strict: bool = True) -> datzh.Table:
        key = (name.lower(), tc)
        if key not in self._cache:
            t = datzh.Table((self.data_tc if tc else self.data_en) / f"{name.lower()}.datc64")
            want = datzh.schema_row_size(self.idx[name.lower()])
            if strict and t.row_size != want:
                raise SystemExit(f"{name}: row size {t.row_size} != schema {want} "
                                 "(schema drift; numeric columns past the drift point are wrong)")
            self._cache[key] = t
        return self._cache[key]

    def pair(self, name: str, strict: bool = True) -> tuple[datzh.Table, datzh.Table]:
        en, tc = self.table(name, False, strict), self.table(name, True, strict)
        if en.rows != tc.rows:
            raise SystemExit(f"{name} row count differs: en={en.rows} tc={tc.rows}")
        return en, tc


# --- text helpers ---------------------------------------------------------------

STYLE_SPAN = re.compile(r"<[^<>]{1,40}>\{([^{}]*)\}")


def unwrap_style(s: str) -> str:
    """<rgb(...)>{text} -> text. Client strings and tag display strings carry
    colour spans; the item prints only what is inside the braces."""
    prev = None
    while prev != s:
        prev, s = s, STYLE_SPAN.sub(r"\1", s)
    return s


MARKUP = re.compile(r"\[([^\[\]|]+)(?:\|([^\[\]]*))?\]")
# <nemesismod>{{...}} / <enchanted>{{...}} -- and <附魔>{{...}}, because GGG
# translates the tag name too. The tag picks a text style and the braces mark
# what it applies to; only the inner text reaches the screen.
STYLE_TAG = re.compile(r"<[^<>]{1,24}>(?=\{\{)")


def strip_markup(s: str) -> str:
    """Turn a statdescription template into the text the game prints.

    [Key|Display] -> Display, [Key] -> Key, <style>{{text}} -> text.

    What the item prints is the display half; the key half is the client's
    hyperlink target and the style tag is a colour. A token cut from the
    un-stripped text would contain characters that are never on screen and could
    never match. The braces are removed separately from the tag so a nested span
    unwraps correctly instead of the outer one swallowing the inner.
    """
    s = STYLE_TAG.sub("", s).replace("{{", "").replace("}}", "")
    return MARKUP.sub(lambda m: m.group(2) if m.group(2) is not None else m.group(1), s)


# --- page post-processing shared by both generators ---------------------------------
# Strings of a page that the game prints or matches; the markup must be resolved in
# all of them. Wording.lines_alt and stat_lines hand statdescription lines back
# un-stripped, e.g. "Rare Monsters have [ElementalThorns|Elemental Thorns] reflecting #"
# (PoE1) or "# to [Armour]" (PoE2 base implicits).
ENTRY_TEXT_KEYS = ("zh", "en", "hiddenZh", "hiddenEn", "altZh", "altEn")
PAGE_TEXT_KEYS = ("ambientZh", "ambientEn")


def _strings(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, list):
        for v in x:
            yield from _strings(v)
    elif isinstance(x, dict):
        for v in x.values():
            yield from _strings(v)


def _fix(x):
    """strip_markup on every string of a (nested) value: [Key|Display], bare [Key]
    (PoE1 English has a few too, e.g. "[Toughness]") and <style>{{..}} spans."""
    if isinstance(x, str):
        return strip_markup(x)
    if isinstance(x, list):
        return [_fix(v) for v in x]
    if isinstance(x, dict):
        return {k: _fix(v) for k, v in x.items()}
    return x


def _page_texts(p: dict):
    yield from ((p, k) for k in PAGE_TEXT_KEYS + ("nameWordsZh", "nameWordsEn") if k in p)
    yield from ((e, k) for e in p["entries"] for k in ENTRY_TEXT_KEYS if k in e)


def strip_page_markup(pages: list[dict]) -> int:
    """Strip markup from the printed text of every page; returns how many strings changed."""
    changed = 0
    for p in pages:
        for obj, k in list(_page_texts(p)):
            new = _fix(obj[k])
            changed += sum(a != b for a, b in zip(_strings(obj[k]), _strings(new)))
            obj[k] = new
    return changed


def check_no_markup(pages: list[dict]) -> None:
    """No markup span or style tag is left in any printed text."""
    for p in pages:
        for obj, k in _page_texts(p):
            for s in _strings(obj[k]):
                assert not (MARKUP.search(s) or STYLE_TAG.search(s) or "{{" in s), \
                    f"{p['id']} {obj.get('id', '')} {k}: markup left: {s}"


def item_texts(st, flavour_key: str, currency_base_key: str) -> dict[str, tuple[list[str], list[str]]]:
    """BaseItemTypes.Id -> (zh lines, en lines) the item prints besides its name and effect:
    its FlavourText and CurrencyItems Description / Directions. The search reads them like
    any other line (found 2026-10-31: a scarab's 「生前犯下的罪行…」 lit other scarabs whose
    fragment it contained). The two foreign keys are named differently per game (PoE1
    FlavourTextKey / BaseItemTypesKey, PoE2 FlavourText / BaseItemType). An untranslated
    cell comes back in English on both sides, which is what the client shows."""
    bt = st.table("BaseItemTypes"); cb = st.cols("BaseItemTypes")
    ft_en, ft_tc = st.pair("FlavourText"); cf = st.cols("FlavourText")
    ci_en, ci_tc = st.pair("CurrencyItems"); cc = st.cols("CurrencyItems")
    out: dict[str, tuple[list[str], list[str]]] = {}

    def add(r: int, zh: list[str], en: list[str]) -> None:
        if not en:
            return
        z, e = out.setdefault(bt.read_string(r, cb["Id"]["off"]), ([], []))
        add_unique(z, zh or en)
        add_unique(e, en)

    for r in range(bt.rows):
        k = read_fkey(bt, r, cb[flavour_key]["off"])
        if k is not None:
            add(r, clean_desc(ft_tc.read_string(k, cf["Text"]["off"])), clean_desc(ft_en.read_string(k, cf["Text"]["off"])))
    for r in range(ci_en.rows):
        b = read_fkey(ci_en, r, cc[currency_base_key]["off"])
        if b is None:
            continue
        for col in ("Description", "Directions"):
            add(b, clean_desc(ci_tc.read_string(r, cc[col]["off"])), clean_desc(ci_en.read_string(r, cc[col]["off"])))
    return out


def add_item_texts(pages: list[dict], texts: dict[str, tuple[list[str], list[str]]]) -> int:
    """Put each listed item's flavour / usage text (item_texts) where Verify can see it:
    a line every entry of the page prints goes to the page's ambient text, the rest to the
    entry's hidden text. Only pages whose entry ids are BaseItemTypes ids (scarabs, gems,
    tattoos, bases) get anything. Returns how many lines were added."""
    added = 0
    for p in pages:
        per = [(e, texts.get(e["id"].split("#")[0])) for e in p["entries"]]
        if not any(t for _e, t in per):
            continue
        for k, side in ((0, "Zh"), (1, "En")):
            lang = side.lower()
            own = [[l for l in (t[k] if t else []) if l not in e[lang]] for e, t in per]
            common = set(own[0]).intersection(*own[1:]) if own and all(own) else set()
            amb = p.setdefault("ambient" + side, [])
            for l in sorted(common):
                if l not in amb:
                    amb.append(l)
                    added += 1
            for (e, _t), lines in zip(per, own):
                rest = [l for l in lines if l not in common]
                if rest:
                    hid = e.setdefault("hidden" + side, [])
                    before = len(hid)
                    add_unique(hid, rest)
                    added += len(hid) - before
    return added


def split_lines(s: str) -> list[str]:
    r"""Templates carry a literal \n; the item prints those as separate lines,
    and the search box matches one line at a time."""
    return [p.strip() for p in s.replace("\\n", "\n").split("\n") if p.strip()]


def client_lines(text: str) -> list[str]:
    """One client string as the item prints it: placeholders rolled to '#',
    colour spans unwrapped, split at line breaks, ends trimmed."""
    text = re.sub(r"\{\d+\}", "#", unwrap_style(text))
    return split_lines(text.replace("\n", "\\n"))


def add_unique(dst: list[str], items) -> None:
    for s in items:
        if s and s not in dst:
            dst.append(s)


def roll_digits(s: str) -> str:
    """'地圖（階級16）' -> '地圖（階級#）': the base name of a map carries its
    tier, which is a number the search must treat as any number."""
    return re.sub(r"\d+", "#", s)


def load_table(tables_dir: Path, name: str, column: str) -> dict[str, tuple[str, str]]:
    """id -> (english, chinese) for one column of one exported table. The export
    only carries cells whose two languages differ."""
    rows = json.loads((tables_dir / f"{name}.json").read_text(encoding="utf-8"))
    return {r["id"]: (r["en"], r["tc"]) for r in rows
            if r.get("column") == column and r.get("id")}


# --- statdescription lookup ---------------------------------------------------

def cond_ok(raw: str, lo: float, hi: float) -> bool:
    """Can a roll anywhere in [lo, hi] satisfy this variant's guard?

    Permissive on purpose. A modifier that rolls -20..20 really can print both
    the "increased" and the "reduced" wording, and a player searching for it
    wants whichever one is on the item in front of them; being strict would drop
    one of two real answers. The cost is that a two-sided roll contributes two
    lines, which is correct.
    """
    raw = raw.strip()
    if raw in ("#", ""):
        return True
    if raw.startswith("!"):
        try:
            return not (lo == hi == float(raw[1:]))
        except ValueError:
            return True
    if "|" in raw:
        a, b = raw.split("|", 1)
        try:
            clo = -float("inf") if a == "#" else float(a)
            chi = float("inf") if b == "#" else float(b)
        except ValueError:
            return True
        return not (hi < clo or lo > chi)
    try:
        v = float(raw)
    except ValueError:
        return True
    return lo <= v <= hi


class Wording:
    """Turns a modifier's stats into the lines the item prints.

    A statdescription block lists every stat it can consume, and an item that
    has only some of them still uses the block -- the missing stats count as
    zero, which is exactly what the `# 0` / `0 #` variant guards are for. So the
    lookup cannot demand that a block's id list be present in full; it matches on
    the intersection and defaults the rest to zero.

    `file_priority` says which statdescription files' wording the item uses, in
    order. Anything else is a different context -- an atlas passive, an
    expedition relic, a leaguestone -- wording the same stat differently, and
    taking that wording would produce a string that never appears on the item
    being searched.
    """

    def __init__(self, blocks: list[dict], file_priority: list[str]):
        priority = list(file_priority)
        merged: dict[tuple[tuple[str, ...], str], list[dict]] = {}
        for b in blocks:
            if b["file"] not in priority:
                continue
            merged.setdefault((tuple(b["ids"]), b["file"]), []).extend(b["variants"])
        self.by_id: dict[str, list[tuple[int, tuple[str, ...], list[dict]]]] = defaultdict(list)
        for (ids, file), variants in merged.items():
            rank = priority.index(file)
            for i in ids:
                self.by_id[i].append((rank, ids, variants))

    @staticmethod
    def _fits(v: dict, ids: tuple[str, ...], vals: list[tuple[int, int]]) -> bool:
        conds = v.get("cond", "").split()
        if not conds:
            return True
        if len(conds) != len(ids):
            # Guard count and id count disagree: this is not the pairing the
            # game uses. Skipping beats guessing which guard goes with which.
            return False
        return all(cond_ok(c, lo, hi) for c, (lo, hi) in zip(conds, vals))

    @staticmethod
    def _pick(variants: list[dict], ids: tuple[str, ...],
              have: dict[str, tuple[int, int]]) -> dict | None:
        vals = [have.get(i, (0, 0)) for i in ids]
        for v in variants:
            if Wording._fits(v, ids, vals):
                return v
        return None

    @staticmethod
    def _others(variants: list[dict], ids: tuple[str, ...],
                have: dict[str, tuple[int, int]], chosen: dict) -> list[dict]:
        """The variants after `chosen` that the roll range can also print.

        A modifier rolling 1..2 prints 「…額外的一個保險箱」 at 1 and
        「…額外的2個保險箱」 at 2; _pick hands back the first, and this is the
        rest. A variant with no guard is the fallback: the game reaches it only
        for a roll no earlier guard took, so it counts only while the variants
        before it leave part of the range uncovered (「增加#%…」 guarded 1|#
        covers a 5..7 roll whole; the unguarded 「減少#%…」 after it never
        prints)."""
        vals = [have.get(i, (0, 0)) for i in ids]
        out, seen, covered = [], False, False
        for v in variants:
            fallback = all(c.strip() == "#" for c in v.get("cond", "").split())
            if fallback:
                # No guard at all, or every guard the bare "#" (stats.json
                # writes GGG's unguarded fallback that way).
                if seen and v is not chosen and not covered:
                    out.append(v)
                break
            if Wording._covers(v, ids, vals):
                covered = True
            if v is chosen:
                seen = True
                continue
            if seen and Wording._fits(v, ids, vals):
                out.append(v)
        return out

    @staticmethod
    def _covers(v: dict, ids: tuple[str, ...], vals: list[tuple[int, int]]) -> bool:
        """Does this variant's guard take every roll in the range? Strict --
        anything it cannot read counts as not covering, which only keeps a
        fallback wording that might print."""
        conds = v.get("cond", "").split()
        if not conds or len(conds) != len(ids):
            return False
        for raw, (lo, hi) in zip(conds, vals):
            raw = raw.strip()
            if raw == "#":
                continue
            try:
                if "|" in raw:
                    a, b = raw.split("|", 1)
                    clo = -float("inf") if a == "#" else float(a)
                    chi = float("inf") if b == "#" else float(b)
                elif raw.startswith("!"):
                    x = float(raw[1:])
                    if lo <= x <= hi:
                        return False
                    continue
                else:
                    clo = chi = float(raw)
            except ValueError:
                return False
            if not (clo <= lo and hi <= chi):
                return False
        return True

    def lines(self, stats: list[tuple[str, int, int]]) -> tuple[list[str], list[str], list[str]]:
        """(english lines, chinese lines, notes). `stats` is (id, min, max)."""
        en_out, tc_out, notes, _reminders = self.lines_ex(stats)
        return en_out, tc_out, notes

    def lines_ex(self, stats: list[tuple[str, int, int]]
                 ) -> tuple[list[str], list[str], list[str], list[str]]:
        """lines() plus the reminder-text ids the game attaches to those lines.

        The ids belong to the variant, not to a particular line of it, so a
        two-line variant hands its reminders to both lines. That can only make
        the C++ side refuse a token it might have used, never accept a bad one.
        """
        en_out, tc_out, notes, reminders, _alts = self.lines_alt(stats)
        return en_out, tc_out, notes, reminders

    def lines_alt(self, stats: list[tuple[str, int, int]]
                  ) -> tuple[list[str], list[str], list[str], list[str],
                             list[list[tuple[str, str]]]]:
        """lines_ex() plus, for each printed line, the other wordings the same
        roll range can print in its place, as (english, chinese) pairs. Only a
        variant that splits into as many lines as the chosen one contributes;
        line i of it is an alternative to line i."""
        have = {sid: (lo, hi) for sid, lo, hi in stats}
        remaining = [s[0] for s in stats]
        en_out: list[str] = []
        tc_out: list[str] = []
        notes: list[str] = []
        reminders: list[str] = []
        alts: list[list[tuple[str, str]]] = []
        while remaining:
            sid = remaining[0]
            best = None
            for rank, ids, variants in self.by_id.get(sid, []):
                matched = [i for i in ids if i in remaining]
                if sid not in matched:
                    continue
                v = self._pick(variants, ids, have)
                if v is None:
                    continue
                # Most specific wins: the file the item actually uses first, then
                # the block that consumes the most of this modifier's stats --
                # otherwise a two-stat line prints as two unrelated half-lines.
                score = (rank, -len(matched))
                if best is None or score < best[0]:
                    best = (score, matched, v, ids, variants)
            if best is None:
                notes.append("no_wording:" + sid)
                remaining.pop(0)
                continue
            _score, matched, v, ids, variants = best
            en_parts, tc_parts = split_lines(v["en_norm"]), split_lines(v["tc_norm"])
            if len(en_parts) != len(tc_parts):
                # stats.json pairs the languages variant by variant, so this
                # should not happen -- but pairing line 1 of one language with
                # line 2 of the other would be worse than refusing.
                notes.append("line_split_mismatch:" + sid)
            else:
                en_out += en_parts
                tc_out += tc_parts
                add_unique(reminders, v.get("reminders") or [])
                per_line: list[list[tuple[str, str]]] = [[] for _ in en_parts]
                for o in self._others(variants, ids, have, v):
                    oe, ot = split_lines(o["en_norm"]), split_lines(o["tc_norm"])
                    if len(oe) != len(en_parts) or len(ot) != len(en_parts):
                        continue
                    for k in range(len(en_parts)):
                        if (oe[k], ot[k]) != (en_parts[k], tc_parts[k]):
                            per_line[k].append((oe[k], ot[k]))
                alts += per_line
            remaining = [i for i in remaining if i not in matched]
        return en_out, tc_out, notes, reminders, alts


# --- modifier pages -----------------------------------------------------------

def magic_name_pieces(gen: int, zh_affix: str, en_affix: str,
                      bases: list[tuple[str, str]]) -> tuple[list[str], list[str]]:
    """The seam between an affix name and the base in a magic item's name:
    燃燒的地圖（階級#）, "Conflagrating Map (Tier #)", "Map (Tier #) of Temporal
    Chains". Chinese puts both affixes before the base; English puts the
    suffix after it."""
    zh, en = [], []
    for base_zh, base_en in bases:
        if zh_affix:
            zh.append(zh_affix + base_zh)
        if en_affix:
            en.append(en_affix + " " + base_en if gen == GEN_PREFIX
                      else base_en + " " + en_affix)
    return zh, en


def group_by_generation(gens: set[int], _tags: set[str], _mod_ids: list[str]) -> int:
    """前綴 / 後綴 / 前後綴皆有."""
    return 0 if gens == {GEN_PREFIX} else (1 if gens == {GEN_SUFFIX} else 2)


def _as_set(v) -> set:
    return set(v) if isinstance(v, (list, tuple, set)) else {v}


def page_rows(mr, page: dict):
    """(row, generation type, live spawn tags) for every modifier the page
    covers, in table order.

    Either one source -- `domain` (a number or a list), `gens`, `need_live` --
    or `sources`: a list of such dicts, each optionally with its own `accept`
    (live -> bool), for a page that gathers rows of different kinds (flask
    affixes rolled by spawn weight + flask enchantments that have none of
    their own). A row is taken once, by the first source that matches."""
    if "sources" not in page:
        doms = _as_set(page["domain"])
        gens = page.get("gens", (GEN_PREFIX, GEN_SUFFIX))
        yield from mr.affix_rows(doms, set(gens), page.get("need_live", True))
        return
    srcs = [(_as_set(s["domain"]), set(s.get("gens", (GEN_PREFIX, GEN_SUFFIX))),
             s.get("need_live", True), s.get("accept")) for s in page["sources"]]
    all_doms = set().union(*(d for d, _g, _n, _a in srcs))
    all_gens = set().union(*(g for _d, g, _n, _a in srcs))
    for r, gen, live in mr.affix_rows(all_doms, all_gens, False):
        dom = mr.domain(r)
        for d, g, need_live, acc in srcs:
            if dom in d and gen in g and (live or not need_live) and (acc is None or acc(live)):
                yield r, gen, live
                break


def get_wording(blocks: list[dict], files, cache: dict | None) -> Wording:
    key = tuple(files)
    if cache is not None and key in cache:
        return cache[key]
    w = Wording(blocks, list(key))
    if cache is not None:
        cache[key] = w
    return w


def build_mod_page(mr, blocks: list[dict], page: dict, counts: Counter, ex,
                   wording_cache: dict | None = None) -> list[dict]:
    """One modifier page's entries: one per distinct printed Chinese line.

    `page` keys used here:
      domain      Mods.Domain value(s) (the column stores the enum index + 1)
      gens        GenerationType values kept (default prefix / suffix)
      need_live   require a positive spawn weight (default True; enchantments
                  applied by a currency have none)
      accept      live spawn tags -> bool; which of the domain's rows belong
      row_filter  optional (mr, row) -> bool, for what the tags cannot say
      t17_clear   optional live -> bool: a row that clears the page's `t17`
                  mark (only the PoE1 map page has one)
      aggregate   stat id -> bool; stats the base item sums and prints as a
                  property, never as a line of their own
      drop_zero   drop stats whose whole range is 0 before the wording lookup
      files       statdescription file priority
      group       (gens, tags, mod ids) -> group index
      name_bases  (zh, en) base names for the magic-name seam, written out
                  as hidden lines (affix + base, every base) -- the old shape
      affix_sink  optional list; (gen, zh, en) of every affix is appended, for
                  a page that expresses the magic-name seam as name words
                  instead (see seam_words) because it has too many bases
      alt_wordings  keep the other wordings a roll range can print in place of
                  a line (「一個」 at 1, 「#個」 at 2) as altZh / altEn, and
                  in the hidden text so no other line's token can hit them

    A stat whose whole range is 0 is the unused slot of a shared modifier
    shape -- TowerAdditionalEssence1 carries map_map_item_drop_chance_+% at
    0..0 -- and the item prints nothing for it, while a block whose guard
    happens to accept anything would hand back a line no item has ever shown.
    """
    wording = get_wording(blocks, page["files"], wording_cache)
    key = page["id"]
    rows: dict[str, dict] = {}
    t17_clear = page.get("t17_clear")
    aggregate = page.get("aggregate") or (lambda _sid: False)
    drop_zero = page.get("drop_zero", True)
    row_filter = page.get("row_filter")
    for r, gen, live in page_rows(mr, page):
        counts[key + ".affix_rows"] += 1
        if not page["accept"](live):
            counts[key + ".other_tags"] += 1
            continue
        if row_filter is not None and not row_filter(mr, r):
            counts[key + ".row_filter"] += 1
            continue
        stats = [s for s in mr.stats_of(r)
                 if not aggregate(s[0]) and not (drop_zero and s[1] == 0 and s[2] == 0)]
        if not stats:
            counts[key + ".aggregate_only"] += 1
            continue
        if page.get("alt_wordings"):
            en_lines, tc_lines, notes, reminders, alt_lines = wording.lines_alt(stats)
        else:
            en_lines, tc_lines, notes, reminders = wording.lines_ex(stats)
            alt_lines = [[] for _ in en_lines]
        for n in notes:
            counts[key + ".note_" + n.split(":")[0]] += 1
        if not en_lines:
            counts[key + ".no_wording"] += 1
            continue
        if len(tc_lines) != len(en_lines):
            counts[key + ".line_count_mismatch"] += 1
            continue
        zh_affix, en_affix = mr.affix_name(r)
        zh_affix, en_affix = ex.clean_name(zh_affix), ex.clean_name(en_affix)
        affixed = gen in (GEN_PREFIX, GEN_SUFFIX)
        itags = mr.implicit_tags(r)
        # What this modifier adds to the hidden text of every line it prints.
        hz, he = [], []
        if affixed and (zh_affix or en_affix):
            adv_zh, adv_en = ex.advanced_line(gen, zh_affix, en_affix)
            add_unique(hz, [adv_zh])
            add_unique(he, [adv_en])
        add_unique(hz, [t[0] for t in itags])
        add_unique(he, [t[1] for t in itags])
        if len(itags) > 1:
            # Both joiners: the exact separator the client prints is not
            # verified, and a token cut across "焰,異" is cheap to refuse.
            add_unique(hz, [",".join(t[0] for t in itags), ", ".join(t[0] for t in itags)])
            add_unique(he, [",".join(t[1] for t in itags), ", ".join(t[1] for t in itags)])
        rem_zh, rem_en = ex.reminder_lines(reminders)
        add_unique(hz, rem_zh)
        add_unique(he, rem_en)
        nz, ne = (magic_name_pieces(gen, zh_affix, en_affix, page.get("name_bases", []))
                  if affixed else ([], []))
        sink = page.get("affix_sink")
        if sink is not None and affixed and (gen, zh_affix, en_affix) not in sink:
            sink.append((gen, zh_affix, en_affix))
        for zh, en, alt in zip(tc_lines, en_lines, alt_lines):
            zh, en = ex.clean_line(zh), ex.clean_line(en)
            if not zh or not en:
                counts[key + ".blank_line"] += 1
                continue
            rec = rows.get(zh)
            if rec is None:
                rec = rows[zh] = {"id": "", "zh": [zh], "en": [en],
                                  "_gen": set(), "_tags": set(), "_t17only": True,
                                  "_affix": [], "_mods": [], "_hz": [], "_he": [],
                                  "_az": [], "_ae": []}
            for a_en, a_zh in alt:
                a_zh, a_en = ex.clean_line(a_zh), ex.clean_line(a_en)
                if a_zh and a_zh != zh:
                    add_unique(rec["_az"], [a_zh])
                if a_en and a_en != en:
                    add_unique(rec["_ae"], [a_en])
            rec["_gen"].add(gen)
            rec["_tags"] |= live
            # Only an ordinary-map roll clears the tier-17 mark. A logbook
            # roll says nothing about what maps can have.
            if t17_clear is not None and t17_clear(live):
                rec["_t17only"] = False
            if zh_affix and zh_affix not in rec["_affix"]:
                rec["_affix"].append(zh_affix)
            rec["_mods"].append(mr.mod_id(r))
            add_unique(rec["_hz"], hz)
            add_unique(rec["_he"], he)
            add_unique(rec["_hz"], nz)
            add_unique(rec["_he"], ne)

    out = []
    for _zh, rec in rows.items():
        gens, tags, t17 = rec.pop("_gen"), rec.pop("_tags"), rec.pop("_t17only")
        affix, mods = rec.pop("_affix"), rec.pop("_mods")
        hz, he = rec.pop("_hz"), rec.pop("_he")
        az, ae = rec.pop("_az"), rec.pop("_ae")
        rec["id"] = sorted(mods)[0]
        rec["g"] = page["group"](gens, tags, mods)
        if affix:
            rec["affixZh"] = "、".join(affix[:4])
        if t17_clear is not None and t17:
            rec["t17"] = True
        # After every key the file already had, so the older bytes stay where
        # they were and a diff shows only the additions.
        if hz:
            rec["hiddenZh"] = hz
        if he:
            rec["hiddenEn"] = he
        # The other wordings: on the item they are printed text, so they also
        # go into the hidden text, where only refusing a token is possible.
        if az or ae:
            add_unique(hz, az)
            add_unique(he, ae)
            rec["hiddenZh"], rec["hiddenEn"] = hz, he
            if az:
                rec["altZh"] = az
            if ae:
                rec["altEn"] = ae
        out.append(rec)
    out.sort(key=lambda e: (e["g"], e["zh"][0]))
    return out


def diagnose_pages(mr, blocks: list[dict], pages: list[dict]) -> None:
    """What each modifier page drops and why, per page: a stat with no wording
    on one page usually has one on another, and a combined list hides that."""
    for page in pages:
        if page.get("kind", "mods") != "mods" or not ("domain" in page or "sources" in page):
            continue
        wording = Wording(blocks, list(page["files"]))
        aggregate = page.get("aggregate") or (lambda _sid: False)
        drop_zero = page.get("drop_zero", True)
        note_kinds, dead, tags_seen, gens_seen = Counter(), [], Counter(), Counter()
        rejected = Counter()
        for r, gen, live in page_rows(mr, page):
            tags_seen.update(live)
            if not page["accept"](live):
                rejected.update(live)
                continue
            gens_seen[gen] += 1
            stats = [s for s in mr.stats_of(r)
                     if not aggregate(s[0]) and not (drop_zero and s[1] == 0 and s[2] == 0)]
            if not stats:
                continue
            en_lines, _tc, notes = wording.lines(stats)
            note_kinds.update(notes)
            if not en_lines:
                dead.append((mr.mod_id(r), [s[0] for s in stats]))
        print(f"=== {page['id']} (domain {page.get('domain', page.get('sources'))}, "
              f"gens {page.get('gens', (1, 2))})")
        print("   spawn tags seen:", tags_seen.most_common(25))
        print("   rejected-row tags:", rejected.most_common(10))
        print("   generation types kept:", dict(gens_seen))
        for k, n in note_kinds.most_common(15):
            print(f"   {n:4d}  {k}")
        print(f"   modifiers that printed nothing at all: {len(dead)}")
        for mid, ids in dead[:40]:
            print("       ", mid, ids)
        print()


def seam_words(affixes: list[tuple[int, str, str]], bases: list[tuple[str, str]]
               ) -> tuple[list[str], list[str], list[str], list[str]]:
    """The magic-name seam as name words: (zh left, zh right, en left, en right).

    A magic item's name is affix + base (Chinese: 前綴 後綴 基底, no spaces;
    English: Prefix Base of Suffix). Writing every affix x base pair out as a
    hidden line is what the map page does, with one base; a flask page has
    fifty bases and a heist page more, and the pairs run to megabytes. The
    C++ side already checks exactly this shape for rare names -- a token that
    splits into (tail of a left word, head of a right word) -- so the affixes
    and bases go there instead: the same refusal in a few kilobytes. Every
    left word meets every right word, which also covers prefix|suffix in
    Chinese (a seam the hidden-line form never covered) and refuses a few
    pairings no item has; both only ever refuse a token, never accept one.
    """
    zl, zr, el, er = [], [], [], []
    for gen, zh, en in affixes:
        if zh:
            add_unique(zl, [zh])
            if gen == GEN_SUFFIX:
                add_unique(zr, [zh])
        if en:
            if gen == GEN_PREFIX:
                add_unique(el, [en])
            else:
                add_unique(er, [" " + en])
    for zh, en in bases:
        add_unique(zr, [zh])
        add_unique(el, [en])
        add_unique(er, [" " + en])
    return zl, zr, el, er


# --- names pages --------------------------------------------------------------

def names_entries(items: list[dict]) -> list[dict]:
    """Entries for a `kind: "names"` page from
    {id, zh, en, g, hiddenZh?, hiddenEn?} records.

    Two items the Chinese client names identically cannot be told apart by any
    search, so they become ONE row with every English name listed (the rule the
    map page follows for lines); the row's id is the smallest source id. What
    else the item prints (description, tags) goes to the entry's hidden text:
    the search box reads it, but it is not what the player ticked.
    """
    by_zh: dict[str, dict] = {}
    for it in items:
        zh, en = it["zh"].strip(), it["en"].strip()
        if not zh or not en:
            continue
        rec = by_zh.get(zh)
        if rec is None:
            rec = by_zh[zh] = {"zh": [zh], "en": [], "g": it["g"],
                               "_hz": [], "_he": [], "_ids": []}
        rec["_ids"].append(it["id"])
        add_unique(rec["en"], [en])
        # Same printed name in two groups: file it under the lower one; which
        # list it shows under is presentation, not identity.
        rec["g"] = min(rec["g"], it["g"])
        add_unique(rec["_hz"], it.get("hiddenZh", []))
        add_unique(rec["_he"], it.get("hiddenEn", []))
    out = []
    for zh, rec in by_zh.items():
        e = {"id": sorted(rec["_ids"])[0], "zh": rec["zh"], "en": rec["en"], "g": rec["g"]}
        hz = [h for h in rec["_hz"] if h != zh]
        he = [h for h in rec["_he"] if h not in rec["en"]]
        if hz:
            e["hiddenZh"] = hz
        if he:
            e["hiddenEn"] = he
        out.append(e)
    # English names that two Chinese rows share would make the English list
    # ambiguous the same way; merge those rows too (rare: a zh-only rename).
    out.sort(key=lambda e: (e["g"], e["zh"][0]))
    return out


def scrub_hidden_against_printed(entries: list[dict]) -> int:
    """Drop hidden lines that some entry of the same page prints. Returns how
    many were dropped. A hidden line equal to a printed one would make the
    C++ side think text is hidden when the item shows it (self_check and the
    C++ selftest both reject it)."""
    printed = {l for e in entries for l in e["zh"] + e["en"]}
    dropped = 0
    for e in entries:
        for k in ("hiddenZh", "hiddenEn"):
            if k in e:
                keep = [h for h in e[k] if h not in printed]
                dropped += len(e[k]) - len(keep)
                if keep:
                    e[k] = keep
                else:
                    del e[k]
    return dropped


def dedupe_first_lines(entries: list[dict]) -> int:
    """Merge entries whose first zh OR first en line coincide (the C++
    selftest asserts no two entries print the same first line, in each
    language). Merging keeps the earlier entry and folds the later one's other
    lines and hidden text into it. Returns how many were folded."""
    folded = 0
    changed = True
    while changed:
        changed = False
        for lang in ("zh", "en"):
            seen: dict[str, dict] = {}
            keep = []
            for e in entries:
                k = e[lang][0]
                if k in seen:
                    t = seen[k]
                    add_unique(t["zh"], e["zh"])
                    add_unique(t["en"], e["en"])
                    for hk in ("hiddenZh", "hiddenEn"):
                        if hk in e:
                            t.setdefault(hk, [])
                            add_unique(t[hk], e[hk])
                    folded += 1
                    changed = True
                else:
                    seen[k] = e
                    keep.append(e)
            entries[:] = keep
    return folded


# --- names-page helpers shared by both games ---------------------------------
# A names page lists items by name; everything else such an item prints (its
# description, tag line, implicit lines) is that entry's hidden text. These
# read through SchemaTables (row size checked) and need a `ctx` with
# st / mr / blocks / wording / counts.

JUNK_NAME = re.compile(r"\[DNT|\[UNUSED|UNUSED\]|DO NOT USE|^\s*$|\bTest\b|^\[", re.I)


def usable_name(zh: str, en: str) -> bool:
    return bool(zh.strip()) and bool(en.strip()) and not JUNK_NAME.search(en) \
        and not JUNK_NAME.search(zh)


def clean_desc(s: str) -> list[str]:
    """A description cell as printed lines: [Key|Display] markup and colour
    spans stripped, split at line breaks (both \\n and CRLF occur)."""
    s = strip_markup(unwrap_style(s)).replace("\r\n", "\n").replace("\r", "\n")
    return [x.strip() for x in s.split("\n") if x.strip()]


def joined_tags(tags: list[tuple[str, str]]) -> tuple[list[str], list[str]]:
    """A tag line as the client prints it, with both joiners (the exact one
    is not verified; refusing a token across either is cheap)."""
    zh, en = [], []
    if tags:
        add_unique(zh, [", ".join(t for t, _e in tags), ",".join(t for t, _e in tags)])
        add_unique(en, [", ".join(e for _t, e in tags), ",".join(e for _t, e in tags)])
    return zh, en


class Bases:
    """BaseItemTypes in both languages, with the item class of each row.

    The two games name two of the columns differently (ItemClassesKey /
    ItemClass, Implicit_ModsKeys / Implicit_Mods); `alias` maps them."""

    def __init__(self, st: SchemaTables, alias: dict | None = None):
        self.en, self.tc = st.pair("BaseItemTypes")
        self.cb = dict(st.cols("BaseItemTypes"))
        for ours, theirs in (alias or {}).items():
            self.cb[ours] = self.cb[theirs]
        self.ic_en, self.ic_tc = st.pair("ItemClasses")
        self.ci = st.cols("ItemClasses")
        self.by_id = {self.en.read_string(r, self.cb["Id"]["off"]): r for r in range(self.en.rows)}

    def name(self, r: int) -> tuple[str, str]:
        return (self.tc.read_string(r, self.cb["Name"]["off"]),
                self.en.read_string(r, self.cb["Name"]["off"]))

    def id(self, r: int) -> str:
        return self.en.read_string(r, self.cb["Id"]["off"])

    def item_class(self, r: int) -> int | None:
        return read_fkey(self.en, r, self.cb["ItemClassesKey"]["off"])

    def class_name(self, c: int) -> tuple[str, str]:
        return (self.ic_tc.read_string(c, self.ci["Name"]["off"]),
                self.ic_en.read_string(c, self.ci["Name"]["off"]))

    def class_id(self, c: int) -> str:
        return self.ic_en.read_string(c, self.ci["Id"]["off"])

    def names_with_prefix(self, *prefixes: str) -> list[tuple[str, str]]:
        out = []
        for r in range(self.en.rows):
            if self.id(r).startswith(prefixes):
                zh, en = self.name(r)
                if usable_name(zh, en) and (zh, en) not in out:
                    out.append((zh, en))
        return out

    def implicit_mods(self, r: int) -> list[int]:
        return read_fkey_array(self.en, r, self.cb["Implicit_ModsKeys"]["off"])


def get_bases(ctx) -> Bases:
    if not hasattr(ctx, "_bases"):
        ctx._bases = Bases(ctx.st, getattr(ctx, "bases_alias", None))
    return ctx._bases


def stat_lines(ctx, stats: list[tuple[str, int, int]], files: list[str]) -> tuple[list[str], list[str]]:
    """(zh lines, en lines) a set of fixed stat values prints."""
    w = get_wording(ctx.blocks, files, ctx.wording)
    en, zh, _notes = w.lines(stats)
    if len(en) != len(zh):
        return [], []
    return zh, en


# Classes under those folders that no vendor sells and no player holds.
VENDOR_SKIP_CLASSES = {"HiddenItem", "Hidden Item"}
VENDOR_FOLDERS = ("Armours/", "Weapons/", "Rings/", "Amulets/", "Belts/", "Quivers/",
                  "Jewels/", "Flasks/")


def build_vendor_bases(ctx, prefixes: tuple, files: list[str]):
    """Item bases a vendor (or the ground) can show, by name, grouped by item
    class. The base name is what the player searches a vendor window for; the
    class line (物品種類：雙手劍) and the base's implicit modifier lines are
    printed too and go to hidden / ambient text."""
    b = get_bases(ctx)
    classes: dict[int, int] = {}
    groups_zh, groups_en = [], []
    items = []
    class_lines: list[tuple[str, str]] = []
    for r in range(b.en.rows):
        bid = b.id(r)
        if not bid.startswith(prefixes):
            continue
        zh, en = b.name(r)
        if not usable_name(zh, en):
            continue
        c = b.item_class(r)
        if c is None or b.class_id(c) in VENDOR_SKIP_CLASSES:
            continue
        if c not in classes:
            cz, ce = b.class_name(c)
            if not usable_name(cz, ce):
                continue
            classes[c] = len(groups_zh)
            groups_zh.append(cz)
            groups_en.append(ce)
            class_lines.append((cz, ce))
        hz, he = [], []
        for m in b.implicit_mods(r):
            lz, le = stat_lines(ctx, ctx.mr.stats_of(m), files)
            add_unique(hz, lz)
            add_unique(he, le)
        items.append({"id": bid, "zh": zh, "en": en, "g": classes[c],
                      "hiddenZh": hz, "hiddenEn": he})
    # Group order: by the class's first appearance is table order, which is
    # arbitrary; sort groups by English class name and remap.
    order = sorted(range(len(groups_en)), key=lambda i: groups_en[i])
    remap = {old: new for new, old in enumerate(order)}
    for it in items:
        it["g"] = remap[it["g"]]
    groups_zh = [groups_zh[i] for i in order]
    groups_en = [groups_en[i] for i in order]
    entries = names_entries(items)
    ctx.counts["vendor_bases.hidden_equal_to_a_name"] += scrub_hidden_against_printed(entries)
    ctx.counts["vendor_bases.folded"] += dedupe_first_lines(entries)
    # The class name is printed on every item of the class (物品種類 line);
    # as ambient text a token inside it is refused, which is the safe side.
    return entries, class_lines, (groups_zh, groups_en)



# --- page and document writers ------------------------------------------------

def page_doc(spec: dict, entries: list[dict], ambient_zh: list[str], ambient_en: list[str],
             prefix: list[tuple[str, str]], suffix: list[tuple[str, str]],
             schema: int, seam: tuple | None = None) -> dict:
    """The page object, keys in the order schema 1 always had them; schema 2
    adds `kind` right after `id`. `seam` = seam_words(...) appended to the
    name words (they are NOT ambient: the affix names are each entry's own
    hidden text already, the bases are ambient already)."""
    zl, zr = [t for t, _e in prefix], [t for t, _e in suffix]
    el, er = [e for _t, e in prefix], [e for _t, e in suffix]
    if seam is not None:
        add_unique(zl, seam[0])
        add_unique(zr, seam[1])
        add_unique(el, seam[2])
        add_unique(er, seam[3])
    p: dict = {"id": spec["id"]}
    if schema >= 2:
        p["kind"] = spec.get("kind", "mods")
    p.update({
        "title": spec["title"],
        "titleEn": spec["titleEn"],
        "note": spec["note"],
        # Both clients' search fields take 250 characters.
        "limit": spec.get("limit", 250),
        "groups": spec["groups"],
        "groupsEn": spec["groupsEn"],
        "entries": entries,
        "ambientZh": ambient_zh,
        "ambientEn": ambient_en,
        "nameWordsZh": {"prefix": zl, "suffix": zr},
        "nameWordsEn": {"prefix": el, "suffix": er},
    })
    return p


def labels_doc(cs: dict[str, tuple[str, str]], keys: list[str],
               clean: Callable[[str], str] = lambda s: s) -> dict:
    """{zh: {key: text}, en: {key: text}} for the algorithmic pages.

    `{0}` becomes '#' (the number the page's regex fills in); colour spans and
    markup are stripped the way every other client line is. A key the client
    does not have is an error, not a silent gap: a missing label makes a whole
    numeric condition impossible to build.
    """
    missing = [k for k in keys if k not in cs]
    if missing:
        raise SystemExit(f"labels: client strings missing: {missing}")
    zh, en = {}, {}
    for k in keys:
        e, t = cs[k]
        en[k] = re.sub(r"\{\d+\}", "#", unwrap_style(clean(e))).strip()
        zh[k] = re.sub(r"\{\d+\}", "#", unwrap_style(clean(t))).strip()
    return {"zh": zh, "en": en}


def write_doc(path: Path, doc: dict) -> None:
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")


# --- checks -------------------------------------------------------------------

def self_check(pages: list[dict]) -> None:
    """Refuse to write a file the C++ selftest would reject anyway, with the
    reason next to the line instead of in a report three steps later."""
    for p in pages:
        printed = {l for e in p["entries"] for l in e["zh"] + e["en"]}
        for e in p["entries"]:
            for h in e.get("hiddenZh", []) + e.get("hiddenEn", []):
                if h in printed:
                    raise SystemExit(f"{p['id']}: hidden line is also printed: {h!r}")
        for s in (p["ambientZh"] + p["ambientEn"] +
                  [h for e in p["entries"] for h in e.get("hiddenZh", []) + e.get("hiddenEn", [])]):
            low = s.lower()
            for key in ("階層：", "tier: "):
                at = low.find(key)
                while at >= 0:
                    at += len(key)
                    if at >= len(s) or s[at] != "#":
                        raise SystemExit(f"{p['id']}: tier written as a digit: {s!r}")
                    at = low.find(key, at)


SHARED_EN_PAGES = {"magic_affixes"}


def self_check_v2(pages: list[dict]) -> None:
    """The other promises host/regex_selftest.cpp makes about every page,
    checked here so a new page that would fail them is never written:

      * the page carries ambient text in both languages (the PoE2 remnant page
        is exempt there, by id);
      * every entry has text in both languages;
      * no two entries print the same first line, in either language -- except
        English on SHARED_EN_PAGES, where two mods share an English name but not
        a Chinese one (the key lookup falls back to the Chinese line there).
    """
    for p in pages:
        if p["id"] != "expedition_relic_mods" and (not p["ambientZh"] or not p["ambientEn"]):
            raise SystemExit(f"{p['id']}: page has no ambient text")
        if not p["entries"]:
            raise SystemExit(f"{p['id']}: page has no entries")
        for lang in ("zh", "en"):
            seen: dict[str, str] = {}
            for e in p["entries"]:
                if not e[lang]:
                    raise SystemExit(f"{p['id']}: entry {e['id']} has no {lang} text")
                k = e[lang][0]
                if lang == "en" and p["id"] in SHARED_EN_PAGES:
                    k = e.get("key", k)   # the row key, unique even where the line is not
                if k in seen:
                    raise SystemExit(f"{p['id']}: {lang} first line printed by two entries: "
                                     f"{k!r} ({seen[k]}, {e['id']})")
                seen[k] = e["id"]
            if not 0 <= min(e["g"] for e in p["entries"]) <= max(
                    e["g"] for e in p["entries"]) < len(p["groups"]):
                raise SystemExit(f"{p['id']}: an entry's group is outside the page's groups")


def page_summary(p: dict) -> str:
    hz = [len(e.get("hiddenZh", [])) for e in p["entries"]] or [0]
    he = [len(e.get("hiddenEn", [])) for e in p["entries"]] or [0]
    per_group = Counter(e["g"] for e in p["entries"])
    groups = ", ".join(f"{p['groups'][g]} {n}" for g, n in sorted(per_group.items()))
    return (f"{p['id']:22s} {p.get('kind', 'mods'):5s} {len(p['entries']):5d} entries "
            f"[{groups}]  ambient zh {len(p['ambientZh'])}/en {len(p['ambientEn'])}  "
            f"name words {len(p['nameWordsZh']['prefix'])}+{len(p['nameWordsZh']['suffix'])}  "
            f"hidden/entry zh {min(hz)}/{sum(hz) / len(hz):.1f}/{max(hz)} "
            f"en {min(he)}/{sum(he) / len(he):.1f}/{max(he)}")
