import type { CaseChapter, RubricItem } from "../../contracts/types";
import { evaluateRubricCoverage, runReview } from "./review";

const FACT_PATTERN = /\d[\d,]*(?:\.\d+)?\s*(?:%|％|萬元|億元|萬|元|人次|人|場次|場|案|家|年|月|小時)/g;

function normalizeFact(value: string) {
  return value
    .toLowerCase()
    .replace(/\bpercent(?:age)?\b/g, "%")
    .replace(/\b(\d{4})-\d{2}-\d{2}\b/g, "$1年$&")
    .replace(/[\s,，]/g, "")
    .replace("％", "%");
}

/**
 * 對 AI 或人工草稿執行送審前品質閘門。
 * 數字若沒有出現在客戶問卷、組織資料或官方公告中，一律標示待人工查證；
 * 這是保守規則，寧可多提醒，也不能讓杜撰數據直接進入送件稿。
 */
export function evaluateProposalQuality(
  chapters: CaseChapter[],
  rubric: RubricItem[],
  sourceMaterials: string[],
) {
  const review = runReview(chapters, rubric, 0);
  const source = normalizeFact(sourceMaterials.join("\n"));
  const unsupportedClaims = chapters.flatMap((chapter) => {
    const claims = chapter.content.match(FACT_PATTERN) ?? [];
    return [...new Set(claims)]
      .filter((claim) => !source.includes(normalizeFact(claim)))
      .map((claim) => ({ chapterKey: chapter.key, chapterTitle: chapter.title, claim }));
  });
  const pendingCount = chapters.reduce(
    (total, chapter) => total + (chapter.content.match(/【待補】/g)?.length ?? 0),
    0,
  );
  const missingRequired = chapters
    .filter((chapter) => chapter.required && chapter.content.trim().length < 120)
    .map((chapter) => chapter.title);
  const highIssues = review.issues.filter((issue) => issue.severity === "high");
  const uncoveredRubric = evaluateRubricCoverage(chapters, rubric)
    .filter((item) => !item.covered)
    .map(({ item, points }) => ({ item, points }));

  return {
    score: review.totalScore,
    dimensions: review.dimensions,
    issues: review.issues,
    unsupportedClaims,
    pendingCount,
    missingRequired,
    uncoveredRubric,
    canAdvanceToHumanReview:
      review.totalScore >= 75 &&
      highIssues.length === 0 &&
      unsupportedClaims.length === 0 &&
      pendingCount === 0 &&
      missingRequired.length === 0 &&
      uncoveredRubric.length === 0,
  };
}
