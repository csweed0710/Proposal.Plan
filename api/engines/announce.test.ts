import { describe, expect, it } from "vitest";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { analyzeAnnouncement, extractAnnouncementText, ruleParseAnnouncement, toAmount, toIsoDate } from "./announce";

const SAMPLE = `文化部114年度社區營造及村落文化補助作業要點
一、目的：為推動社區營造，鼓勵民間參與村落文化發展。
二、受理期間：自114年3月1日起至114年4月15日下午5時止，逾期不予受理。
三、補助金額：每案最高補助新臺幣150萬元，補助比例不得超過總經費80%。
四、申請資格：依法立案之社團法人、財團法人或社區發展協會。
五、計畫書內容應包含：
（一）計畫緣起與現況分析
（二）計畫目標
（三）執行內容與方法
（四）預定進度
（五）經費預算
（六）預期效益
六、評分標準：計畫完整性（30分）、執行力（30分）、預期效益（25分）、經費合理性（15分）。
七、應備文件：申請表、立案證明、計畫書一式五份。`;

describe("toIsoDate", () => {
  it("ISO 原樣通過", () => expect(toIsoDate("2025-03-01")).toBe("2025-03-01"));
  it("民國年換算", () => expect(toIsoDate("114年3月1日")).toBe("2025-03-01"));
  it("垃圾輸入給 null", () => {
    expect(toIsoDate("另行通知")).toBeNull();
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate(123)).toBeNull();
  });
});

describe("toAmount", () => {
  it("萬元字串 → 元", () => expect(toAmount("150萬元")).toBe(1500000));
  it("千分位純數字", () => expect(toAmount("1,500,000")).toBe(1500000));
  it("AI 回 150（其實是萬）→ 補正", () => expect(toAmount(150)).toBe(1500000));
  it("垃圾輸入給 null", () => expect(toAmount("面議")).toBeNull());
});

describe("ruleParseAnnouncement", () => {
  const r = ruleParseAnnouncement(SAMPLE);
  it("認出主辦機關與類別", () => {
    expect(r.agency).toBe("文化部");
    expect(r.category).toBe("文化藝術");
  });
  it("取受理起訖，不是第一個/最後一個日期", () => {
    expect(r.applyStart).toBe("2025-03-01");
    expect(r.applyEnd).toBe("2025-04-15");
  });
  it("金額取補助行的最大值（元）", () => {
    expect(r.amountMax).toBe(1500000);
  });
  it("抽出計畫書章節（六章）", () => {
    expect(r.chapterSchema.map((c) => c.title)).toEqual([
      "計畫緣起與現況分析", "計畫目標", "執行內容與方法", "預定進度", "經費預算", "預期效益",
    ]);
  });
  it("抽出評分配分，加總 100", () => {
    expect(r.rubric.length).toBe(4);
    expect(r.rubric.reduce((s, x) => s + x.points, 0)).toBe(100);
  });
  it("規則模式必標 needsVerification 且有提醒", () => {
    expect(r.needsVerification).toBe(true);
    expect(r.usedAI).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it("同行連排章節（一）（二）（三）也能抽", () => {
    const inline = ruleParseAnnouncement("教育部115年度青年創業補助計畫\n一、受理期間：自115年1月10日起至115年2月20日止。\n二、計畫書應包含：（一）創業構想（二）市場分析（三）財務規劃\n三、應備文件：申請表。");
    expect(inline.chapterSchema.map((c) => c.title)).toEqual(["創業構想", "市場分析", "財務規劃"]);
  });
});

describe("extractAnnouncementText", () => {
  it("docx 來回轉換", async () => {
    const d = new Document({
      sections: [{ children: [new Paragraph({ children: [new TextRun("教育部115年度青年創業補助計畫 受理期間自115年1月10日起")] })] }],
    });
    const buf = await Packer.toBuffer(d);
    const text = await extractAnnouncementText("公告.docx", new Uint8Array(buf));
    expect(text).toContain("青年創業補助計畫");
  });
  it("txt 直接讀 utf8", async () => {
    const text = await extractAnnouncementText("公告.txt", new TextEncoder().encode("這是一段超過二十個字的公告文字內容，用來測試純文字檔。"));
    expect(text).toContain("公告文字");
  });
  it("不支援的格式給友善錯誤", async () => {
    await expect(extractAnnouncementText("公告.xlsx", new Uint8Array([1, 2, 3]))).rejects.toThrow("只支援");
  });
  it("內容太少給掃描檔提示", async () => {
    await expect(extractAnnouncementText("公告.txt", new TextEncoder().encode("太短"))).rejects.toThrow("掃描");
  });
});

describe("analyzeAnnouncement（無 AI key → 規則路徑）", () => {
  it("完整跑通且與規則結果一致", async () => {
    const r = await analyzeAnnouncement(SAMPLE);
    expect(r.usedAI).toBe(false);
    expect(r.agency).toBe("文化部");
    expect(r.applyEnd).toBe("2025-04-15");
    expect(r.chapterSchema.length).toBe(6);
    expect(r.extractedChars).toBe(SAMPLE.length);
  });
});
