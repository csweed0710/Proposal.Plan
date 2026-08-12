import { describe, expect, it } from "vitest";
import type { CaseChapter } from "../../contracts/types";
import { extractNumericFacts } from "./proposal-quality";
import { chapterTableContext } from "./table-context";

describe("結構化表格事實摘要", () => {
  it("包含預算逐列金額與總額", () => {
    const chapter: CaseChapter = {
      key: "budget",
      title: "經費預算",
      required: true,
      guidance: "說明經費",
      content: "",
      status: "draft",
      tableType: "budget",
      table: {
        type: "budget",
        budget: {
          rows: [{
            id: "r1", item: "講師費", detail: "辦理課程", unit: "小時", qty: 10,
            unitPrice: 2000, grantShare: 15000, selfShare: 5000, note: "依行情估算",
          }],
        },
      },
    };
    const context = chapterTableContext(chapter);
    expect(context).toContain("數量 10 小時");
    expect(context).toContain("單價 2000 元");
    expect(context).toContain("總經費 20000 元");
    const facts = extractNumericFacts([context]);
    expect(facts.has("10小時")).toBe(true);
    expect(facts.has("20000元")).toBe(true);
  });

  it("沒有表格時不產生假資料", () => {
    const chapter: CaseChapter = {
      key: "summary", title: "摘要", required: true, guidance: "", content: "", status: "empty",
    };
    expect(chapterTableContext(chapter)).toBe("");
  });
});
