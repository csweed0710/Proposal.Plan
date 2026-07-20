// 補助雷達引擎測試：民國年日期正規化、區間抽取、規則備援解析
import { describe, it, expect } from "vitest";
import { normalizeTwDate, extractDateRange, parseAnnouncements } from "./radar";

describe("民國年日期正規化", () => {
  it("民國年轉西元", () => {
    expect(normalizeTwDate("115", "3", "31")).toBe("2026-03-31");
    expect(normalizeTwDate("114", "12", "1")).toBe("2025-12-01");
  });
  it("西元年不變", () => {
    expect(normalizeTwDate("2026", "8", "5")).toBe("2026-08-05");
  });
});

describe("日期區間抽取", () => {
  it("受理期間：115年8月1日至115年9月30日", () => {
    const { start, end } = extractDateRange("受理期間：115年8月1日至115年9月30日");
    expect(start).toBe("2026-08-01");
    expect(end).toBe("2026-09-30");
  });
  it("斜線格式 115/10/15", () => {
    const { start } = extractDateRange("截止日 115/10/15");
    expect(start).toBe("2026-10-15");
  });
});

describe("規則備援解析（無 AI 金鑰時）", () => {
  it("抽得出案件、濾得掉金額行與受理行", async () => {
    const { items, usedAI } = await parseAnnouncements(
      "115年度社區營造創新實驗計畫徵件\n受理期間：115年8月1日至115年9月30日\n最高補助 150 萬元",
    );
    expect(usedAI).toBe(false);
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("社區營造創新實驗計畫");
    expect(items[0].applyEnd).toBe("2026-09-30");
  });

  it("過短或非公告行不誤判", async () => {
    const { items } = await parseAnnouncements("最新消息\n本會地址：台北市\n電話：02-1234");
    expect(items).toHaveLength(0);
  });
});
