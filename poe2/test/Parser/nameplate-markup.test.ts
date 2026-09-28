import { describe, expect, it } from "vitest";
import { stripBracketMarkup } from "@/parser/Parser";

/**
 * `[tag|display]` wrapper seen on the name line of the Traditional Chinese
 * client (Cracklecreep copied as `[1.00E|裂紋怪客]`). The parser must look the
 * item up by the display text only.
 */
describe("stripBracketMarkup", () => {
  it("keeps the display half of [tag|display]", () => {
    expect(stripBracketMarkup("[1.00E|裂紋怪客]")).toBe("裂紋怪客");
    expect(stripBracketMarkup("[Cracklecreep|Cracklecreep]")).toBe(
      "Cracklecreep",
    );
  });

  it("unwraps a bare [display]", () => {
    expect(stripBracketMarkup("[裂紋怪客]")).toBe("裂紋怪客");
  });

  it("leaves ordinary names untouched", () => {
    expect(stripBracketMarkup("裂紋怪客")).toBe("裂紋怪客");
    expect(stripBracketMarkup("活屍 聖曲")).toBe("活屍 聖曲");
    expect(stripBracketMarkup("Dueling Wand")).toBe("Dueling Wand");
    expect(stripBracketMarkup("")).toBe("");
  });

  it("does not touch malformed or empty brackets", () => {
    expect(stripBracketMarkup("[]")).toBe("[]");
    expect(stripBracketMarkup("[a|]")).toBe("[a|]");
    expect(stripBracketMarkup("[a|b|c]")).toBe("[a|b|c]");
  });

  it("strips every wrapper when several appear in one line", () => {
    expect(stripBracketMarkup("[x|甲] [y|乙]")).toBe("甲 乙");
  });
});
