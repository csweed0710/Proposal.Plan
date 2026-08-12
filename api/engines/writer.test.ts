import { describe, expect, it } from "vitest";
import type { CaseChapter } from "../../contracts/types";
import { draftLengthInstruction } from "./writer";

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
