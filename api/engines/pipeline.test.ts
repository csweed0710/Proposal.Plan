// Tier-1 功能測試：結構化表格合約、表格審核維度、真表格匯出
import { describe, it, expect } from "vitest";
import PizZip from "pizzip";
import {
  budgetRowTotal, budgetExpected, budgetTotals, emptyChapterTable,
} from "../../contracts/tables";
import type { BudgetRow, CaseChapter } from "../../contracts/types";
import { runReview } from "./review";
import { exportCase } from "./exporter";

const row = (patch: Partial<BudgetRow>): BudgetRow => ({
  id: "r1", item: "講師費", detail: "", unit: "場", qty: 2, unitPrice: 1000,
  grantShare: 2000, selfShare: 0, note: "行情", ...patch,
});

describe("表格合約（contracts/tables）", () => {
  it("列金額與總額計算", () => {
    const r = row({ qty: 3, unitPrice: 1500, grantShare: 3000, selfShare: 1500 });
    expect(budgetExpected(r)).toBe(4500);
    expect(budgetRowTotal(r)).toBe(4500);
    const t = budgetTotals({ rows: [r, row({ id: "r2", grantShare: 500, selfShare: 500 })] });
    expect(t).toEqual({ grant: 3500, self: 2000, total: 5500 });
  });

  it("emptyChapterTable 產生對應型別的空表", () => {
    expect(emptyChapterTable("budget").type).toBe("budget");
    expect(emptyChapterTable("schedule").type).toBe("schedule");
    expect(emptyChapterTable("kpi").type).toBe("kpi");
    const s = emptyChapterTable("schedule");
    if (s.type === "schedule") expect(s.schedule.months).toBe(12);
  });
});

const chapter = (patch: Partial<CaseChapter>): CaseChapter => ({
  key: "ch1", title: "測試章節", required: true, guidance: "", weight: 3,
  content: "", status: "draft", ...patch,
});

describe("審核引擎・表格檢核維度", () => {
  it("預算表：算術不符→高嚴重度；敏感科目→中；無單價依據→低", () => {
    const ch = chapter({
      key: "budget", title: "經費預算", tableType: "budget",
      table: {
        type: "budget",
        budget: {
          rows: [
            row({ id: "a", item: "人事費", qty: 2, unitPrice: 1000, grantShare: 5000, selfShare: 0, note: "薪資標準" }), // 2×1000≠5000
            row({ id: "b", item: "交際費", qty: 1, unitPrice: 3000, grantShare: 3000, selfShare: 0, note: "" }), // 敏感科目+無依據
          ],
        },
      },
    });
    const out = runReview([ch], [], 1);
    const dim = out.dimensions.find((d) => d.key === "tables");
    expect(dim).toBeTruthy();
    expect(dim!.score).toBeLessThan(100);
    const tIssues = out.issues.filter((i) => i.dimension === "tables");
    expect(tIssues.some((i) => i.severity === "high" && i.problem.includes("算術不符"))).toBe(true);
    expect(tIssues.some((i) => i.severity === "mid" && i.problem.includes("交際費"))).toBe(true);
    expect(tIssues.some((i) => i.severity === "low" && i.problem.includes("單價未附依據"))).toBe(true);
  });

  it("預算表：內文金額與表格總額不一致→高嚴重度", () => {
    const ch = chapter({
      key: "budget", title: "經費預算", tableType: "budget",
      content: "本計畫總經費 999 萬元，用途如附表。",
      table: { type: "budget", budget: { rows: [row({})] } },
    });
    const out = runReview([ch], [], 1);
    expect(out.issues.some((i) => i.dimension === "tables" && i.severity === "high" && i.problem.includes("不一致"))).toBe(true);
  });

  it("進度表：起訖月錯置與超出總月數→中嚴重度", () => {
    const ch = chapter({
      key: "schedule", title: "執行進度", tableType: "schedule",
      table: {
        type: "schedule",
        schedule: {
          months: 12,
          rows: [
            { id: "s1", task: "前置作業", startMonth: 5, endMonth: 2, checkpoint: "ok" },
            { id: "s2", task: "執行", startMonth: 1, endMonth: 14, checkpoint: "" },
          ],
        },
      },
    });
    const out = runReview([ch], [], 1);
    const tIssues = out.issues.filter((i) => i.dimension === "tables");
    expect(tIssues.some((i) => i.problem.includes("晚於結束月"))).toBe(true);
    expect(tIssues.some((i) => i.problem.includes("超過計畫總月數"))).toBe(true);
  });

  it("KPI 表：目標值沒有數字→高嚴重度（KPI 必須量化）", () => {
    const ch = chapter({
      key: "goal", title: "計畫目標", tableType: "kpi",
      table: {
        type: "kpi",
        kpi: { rows: [{ id: "k1", indicator: "服務滿意度", target: "大幅提升", basis: "" }] },
      },
    });
    const out = runReview([ch], [], 1);
    expect(out.issues.some((i) => i.dimension === "tables" && i.severity === "high" && i.problem.includes("量化"))).toBe(true);
  });

  it("無表格章節：表格維度不扣分", () => {
    const out = runReview([chapter({ content: "純文字內容".repeat(30) })], [], 1);
    const dim = out.dimensions.find((d) => d.key === "tables");
    expect(dim!.score).toBe(100);
  });
});

describe("匯出引擎・真表格", () => {
  it("generic 模式：預算表變成 Word 真表格（含合計列與千分位金額）", async () => {
    const ch = chapter({
      key: "budget", title: "經費預算", tableType: "budget",
      content: "經費編列說明如上表。",
      table: {
        type: "budget",
        budget: { rows: [row({ qty: 48, unitPrice: 3200, grantShare: 153600, selfShare: 0 })] },
      },
    });
    const kase = { title: "測試案件", chapters: [ch] };
    const client = { name: "測試公司", orgType: "公司" };
    const grant = { name: "測試補助", agency: "測試機關", templateData: null };
    const res = await exportCase(kase as never, client as never, grant as never);
    expect(res.mode).toBe("generic");
    const zip = new PizZip(res.data);
    const xml = zip.file("word/document.xml")!.asText();
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("合計");
    expect(xml).toContain("153,600");
    expect(xml).toContain("經費編列說明如上表。");
  });

  it("generic 模式：進度表產生甘特矩陣（■ 標記）", async () => {
    const ch = chapter({
      key: "schedule", title: "執行進度", tableType: "schedule",
      content: "",
      table: {
        type: "schedule",
        schedule: { months: 6, rows: [{ id: "s1", task: "需求訪談", startMonth: 1, endMonth: 2, checkpoint: "完成 30 人" }] },
      },
    });
    const res = await exportCase(
      { title: "t", chapters: [ch] } as never,
      { name: "c", orgType: "公司" } as never,
      { name: "g", agency: "a", templateData: null } as never,
    );
    const xml = new PizZip(res.data).file("word/document.xml")!.asText();
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("■");
    expect(xml).toContain("完成 30 人");
  });
});
