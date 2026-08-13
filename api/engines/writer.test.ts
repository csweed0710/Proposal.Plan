import { describe, expect, it } from "vitest";
import type { CaseChapter, IntakeQuestion } from "../../contracts/types";
import { draftLengthInstruction, proposalAnswerContext } from "./writer";

function chapter(wordLimit?: number): CaseChapter {
  return {
    key: "summary",
    title: "計畫摘要",
    required: true,
    guidance: "摘要全案",
    content: "",
    status: "empty",
    wordLimit,
  };
}

describe("AI 章節篇幅指令", () => {
  it("公告有字數上限時要求 AI 保留人工補充空間", () => {
    expect(draftLengthInstruction(chapter(500))).toBe("官方上限 500 字；正文不得超過上限，建議控制在 425 字內");
  });

  it("公告沒有字數限制時沿用一般篇幅", () => {
    expect(draftLengthInstruction(chapter())).toBe("約 600–900 字");
  });
});

const question = (id: string, chapterKey: string, answer: string): IntakeQuestion => ({
  id,
  chapterKey,
  question: `${id} 的問題`,
  hint: "",
  answer,
  prefilled: false,
});

describe("AI 全案問卷事實脈絡", () => {
  it("本章優先，但同時提供其他章節已確認事實", () => {
    const context = proposalAnswerContext(chapter(), [
      question("schedule", "schedule", "五月啟動，十一月完成成果展"),
      question("profile", "__profile__", "新北市的社團法人"),
      question("summary", "summary", "協助獨居長者參與社區活動"),
      question("rubric", "__rubric__", "已有合作場地與志工名冊"),
    ]);

    expect(context).toContain("【本章素材】");
    expect(context).toContain("協助獨居長者參與社區活動");
    expect(context).toContain("【其他章節已確認事實】");
    expect(context).toContain("五月啟動，十一月完成成果展");
    expect(context.indexOf("協助獨居長者")).toBeLessThan(context.indexOf("五月啟動"));
  });

  it("排除空白與不知道類答案，避免污染草稿", () => {
    const context = proposalAnswerContext(chapter(), [
      question("empty", "summary", "  "),
      question("none", "schedule", "無"),
      question("unknown", "goal", "不知道。"),
    ]);

    expect(context).toBe("（問卷尚無可用素材）");
  });

  it("限制超長答案的上下文大小", () => {
    const context = proposalAnswerContext(chapter(), [
      question("summary", "summary", "本章".repeat(4_000)),
      ...Array.from({ length: 20 }, (_, i) => question(`other-${i}`, "other", "跨章".repeat(2_000))),
    ]);

    expect(context.length).toBeLessThanOrEqual(14_000);
    expect(context).toContain("本章");
  });
});
