#!/usr/bin/env python3
"""Self-contained .datc64 reader for locale extraction.

Deliberately separate from tools/ggpk/datc64.py: that module decodes only
*named scalar* columns, which is enough for the 16 tables the older pipeline
knows about but loses translated text in two other shapes the game actually
uses --

  * `string[]` columns  -- returned there as a raw (count, offset) pair and
    never followed;
  * columns the community dat-schema knows the type of but has not named yet --
    skipped there entirely, yet e.g. Acts hides "The Atlas of Worlds" ->
    「異界輿圖」 in exactly such a column.

A "complete" locale extraction has to read all three, so this reader walks the
schema by position and decodes every string-bearing cell regardless of whether
the column carries a name.

Binary layout (64-bit variant used by current PoE1/PoE2 clients):

    [u32 rowCount][rowCount x rowSize][8 x 0xBB][variable data]

String cell   : u64 offset, measured from the first 0xBB byte; UTF-16LE,
                terminated by a 2-byte NUL.
Array cell    : [u64 count][u64 offset]; `offset` points at `count` packed
                elements, each of the element type's width (string -> u64
                offsets, again relative to the magic).
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

MAGIC = b"\xbb" * 8
NULL_ROW = 0xFEFEFEFEFEFEFEFE

TYPE_SIZE = {
    "bool": 1, "i16": 2, "u16": 2, "i32": 4, "u32": 4, "f32": 4,
    "enumrow": 4, "i64": 8, "u64": 8, "string": 8, "row": 8, "foreignrow": 16,
}
ARRAY_SIZE = 16


class DatError(RuntimeError):
    pass


def load_schema(path: str | Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def schema_index(schema: dict, game: int = 1) -> dict[str, list[dict]]:
    """table name (lowercase) -> columns, for the given game."""
    out: dict[str, list[dict]] = {}
    for t in schema["tables"]:
        if not (t.get("validFor", 3) & game):
            continue
        out.setdefault(t["name"].lower(), t["columns"])
    return out


def col_size(col: dict) -> int:
    if col.get("array"):
        return ARRAY_SIZE
    t = col["type"]
    if t not in TYPE_SIZE:
        raise DatError(f"unknown column type {t!r}")
    return TYPE_SIZE[t]


class Table:
    """One parsed .datc64 file."""

    def __init__(self, path: Path):
        self.path = path
        self.data = path.read_bytes()
        if len(self.data) < 12:
            raise DatError(f"{path.name}: truncated")
        (self.rows,) = struct.unpack_from("<I", self.data, 0)
        self.boundary = self._find_boundary()
        self.row_size = (self.boundary - 4) // self.rows if self.rows else 0
        self.var = memoryview(self.data)[self.boundary:]

    def _find_boundary(self) -> int:
        """First 0xBB run that yields a whole-number row size.

        A plain `find` can land on eight 0xBB bytes that happen to occur inside
        row data; requiring (pos-4) to divide evenly by the row count rejects
        those without needing the schema."""
        pos = self.data.find(MAGIC)
        while pos >= 4:
            if not self.rows or (pos - 4) % self.rows == 0:
                return pos
            pos = self.data.find(MAGIC, pos + 1)
        raise DatError(f"{self.path.name}: no usable variable-data magic")

    def string_at(self, off: int) -> str:
        if off < 0 or off >= len(self.var):
            raise DatError(f"string offset {off} outside variable section")
        if off < len(MAGIC):
            # offsets count from the first magic byte, so anything below 8
            # points *into* the magic itself -- a mis-laid-out column, not text
            raise DatError(f"string offset {off} points into the 0xBB magic")
        p = off
        while p + 1 < len(self.var) and not (self.var[p] == 0 and self.var[p + 1] == 0):
            p += 2
        return bytes(self.var[off:p]).decode("utf-16-le", errors="replace")

    def cell_offset(self, row: int, col_off: int) -> int:
        return 4 + row * self.row_size + col_off

    def read_string(self, row: int, col_off: int) -> str:
        (off,) = struct.unpack_from("<Q", self.data, self.cell_offset(row, col_off))
        return self.string_at(off)

    def read_string_array(self, row: int, col_off: int) -> list[str]:
        cnt, off = struct.unpack_from("<QQ", self.data, self.cell_offset(row, col_off))
        if cnt == 0:
            return []
        if cnt > 1_000_000 or off + cnt * 8 > len(self.var):
            raise DatError(f"implausible string[] cell count={cnt} off={off}")
        out = []
        for i in range(cnt):
            (soff,) = struct.unpack_from("<Q", self.var, off + i * 8)
            out.append(self.string_at(soff))
        return out


def string_columns(columns: list[dict], row_size: int) -> tuple[list[dict], int]:
    """Every string-bearing column that fits inside the real row.

    Returns dicts with: name (may be None), offset, array, key. `key` is what
    the output is keyed by -- the schema name when there is one, otherwise
    `col@<byte offset>` so an unnamed column still has a stable identity across
    runs (offsets only move when the table layout itself changes, which is
    exactly when the mapping should be re-derived anyway).

    A column dict may carry an explicit "offset" (layout override, see
    ggpk2_zh/layout_poe2.py): that column is then read there instead of at the
    running position; the running position and the returned schema width are
    unaffected. If it also carries "row_size" and that differs from the real
    `row_size`, the override is stale and the column is left out.

    Columns past `row_size` are dropped rather than read: that is schema drift
    (the shipped table is older or newer than the schema), and reading past the
    row would return another row's bytes.
    """
    out, pos = [], 0
    for i, c in enumerate(columns):
        size = col_size(c)
        is_str = c["type"] == "string"
        at = c["offset"] if "offset" in c else pos
        stale = "row_size" in c and c["row_size"] != row_size
        if is_str and not stale and at + size <= row_size:
            out.append({
                "name": c.get("name"),
                "key": c.get("name") or f"col@{at}",
                "offset": at,
                "array": bool(c.get("array")),
                "index": i,
            })
        pos += size
    return out, pos


def schema_row_size(columns: list[dict]) -> int:
    return sum(col_size(c) for c in columns)
