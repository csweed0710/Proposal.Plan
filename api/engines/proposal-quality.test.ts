import { describe, expect, it } from "vitest";
import type { CaseChapter, RubricItem } from "../../contracts/types";
import { evaluateProposalQuality } from "./proposal-quality";
import { rubricCriteria } from "./review";

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

function limitedChapter(content: string, wordLimit: number): CaseChapter {
  return { ...chapter(content), wordLimit };
}

describe("提案品質閘門", () => {
  it("不會把單一詞彙中的參與誤拆成兩個評分要求", () => {
    expect(rubricCriteria({ item: "參與程度", points: 10, description: "社區參與程度" }))
      .toEqual(["社區參與程度"]);
  });

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
      { item: "執行可行性", points: 50, missingCriteria: ["服務流程", "人力配置", "量化成果"] },
      { item: "預期效益", points: 50, missingCriteria: ["受益人數", "場次", "追蹤方式"] },
    ]);
    expect(result.canAdvanceToHumanReview).toBe(false);
  });

  it("正文直接回應評分項目後才標示為已覆蓋", () => {
    const content = "執行可行性包含服務流程、人力配置與量化成果；預期效益包含受益人數、場次與追蹤方式。".repeat(8);
    const result = evaluateProposalQuality([chapter(content)], rubric, []);
    expect(result.uncoveredRubric).toEqual([]);
  });

  it("只命中一個評分子要求時仍列出其餘缺漏", () => {
    const content = "本計畫已建立服務流程，並將依流程執行各項工作。".repeat(10);
    const result = evaluateProposalQuality([chapter(content)], rubric, []);
    expect(result.uncoveredRubric[0]).toEqual({
      item: "執行可行性",
      points: 50,
      missingCriteria: ["人力配置", "量化成果"],
    });
    expect(result.canAdvanceToHumanReview).toBe(false);
  });

  it("攔截超過官方章節字數上限的內容", () => {
    const content = "執行可行性與預期效益均有具體說明。".repeat(20);
    const result = evaluateProposalQuality([limitedChapter(content, 100)], rubric, []);
    expect(result.overWordLimit).toEqual([
      { chapterKey: "implementation", chapterTitle: "執行內容與預期效益", actual: content.length, limit: 100 },
    ]);
    expect(result.canAdvanceToHumanReview).toBe(false);
  });

  it("官方短篇欄位使用相容於字數上限的最低完整度", () => {
    const content = "執行可行性與預期效益都有明確做法與證據，內容精簡並符合官方格式要求。".repeat(2).slice(0, 60);
    const result = evaluateProposalQuality([limitedChapter(content, 100)], rubric, []);
    expect(result.missingRequired).toEqual([]);
    expect(result.overWordLimit).toEqual([]);
  });
});
