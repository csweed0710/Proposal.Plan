import { describe, expect, it } from "vitest";
import type { CaseChapter, RubricItem } from "../../contracts/types";
import { evaluateProposalQuality } from "./proposal-quality";

const rubric: RubricItem[] = [
  { item: "執行可行性", points: 50, description: "服務流程、人力配置與量化成果" },
  { item: "預期效益", points: 50, description: "受益人數、場次與追蹤方式" },
];

function chapter(content: string): CaseChapter {
  return {
    key: "implementation",
    title: "執行內容與預期效益",
    required: true,
    guidance: "說明執行可行性、服務流程、人力配置、預期效益與追蹤方式",
    content,
    status: "draft",
  };
}

describe("提案品質閘門", () => {
  it("將 percent 文字與百分比符號視為同一筆來源事實", () => {
    const content = "The verified satisfaction rate is 92%. ".repeat(8);
    const result = evaluateProposalQuality(
      [chapter(content)],
      rubric,
      ["The source survey reports a 92 percent satisfaction rate."],
    );
    expect(result.unsupportedClaims).toEqual([]);
  });

  it("將中文年份與 ISO 日期視為同一筆來源事實", () => {
    const content = "計畫預定於 2026年 啟動，並依核定期程執行。".repeat(8);
    const result = evaluateProposalQuality(
      [chapter(content)],
      rubric,
      ['{"applyStart":"2026-08-01","applyEnd":"2026-09-30"}'],
    );
    expect(result.unsupportedClaims).toEqual([]);
  });

  it("接受有來源支撐的量化主張", () => {
    const content = "執行可行性將透過固定服務流程與人力配置落實。每月辦理 2 場活動，全年共 24 場，預計服務 480 人次；預期效益以簽到表及前後測追蹤。".repeat(3);
    const result = evaluateProposalQuality(
      [chapter(content)],
      rubric,
      ["客戶確認每月辦理 2 場活動，全年 24 場，服務目標為 480 人次。"],
    );
    expect(result.unsupportedClaims).toEqual([]);
    expect(result.pendingCount).toBe(0);
  });

  it("攔截來源中不存在的 AI 數字", () => {
    const content = "執行可行性將透過服務流程與人力配置落實。全年辦理 24 場活動，預計服務 900 人次；預期效益以簽到及滿意度問卷追蹤。".repeat(3);
    const result = evaluateProposalQuality(
      [chapter(content)],
      rubric,
      ["客戶確認全年辦理 24 場活動，服務目標為 480 人次。"],
    );
    expect(result.unsupportedClaims.some((item) => item.claim.includes("900 人次"))).toBe(true);
    expect(result.canAdvanceToHumanReview).toBe(false);
  });

  it("有待補標記時不得進入人工定稿", () => {
    const result = evaluateProposalQuality(
      [chapter("執行可行性與預期效益將依服務流程追蹤。【待補】確認受益人數。".repeat(5))],
      rubric,
      [],
    );
    expect(result.pendingCount).toBeGreaterThan(0);
    expect(result.canAdvanceToHumanReview).toBe(false);
  });

  it("不把只寫在章節指引、未出現在正文的評分項目誤判為已覆蓋", () => {
    const result = evaluateProposalQuality(
      [chapter("本章描述一般性的執行內容，但沒有直接回答官方評分要看的重點。".repeat(8))],
      rubric,
      [],
    );
    expect(result.uncoveredRubric).toEqual([
      { item: "執行可行性", points: 50 },
      { item: "預期效益", points: 50 },
    ]);
    expect(result.canAdvanceToHumanReview).toBe(false);
  });

  it("正文直接回應評分項目後才標示為已覆蓋", () => {
    const content = "執行可行性包含服務流程與人力配置；預期效益包含受益人數、場次與追蹤方式。".repeat(8);
    const result = evaluateProposalQuality([chapter(content)], rubric, []);
    expect(result.uncoveredRubric).toEqual([]);
  });
});
