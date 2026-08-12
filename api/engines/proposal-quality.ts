import type { CaseChapter, RubricItem } from "../../contracts/types";
import { evaluateRubricCoverage, requiredChapterMinimum, runReview } from "./review";

const FACT_PATTERN = /\d[\d,]*(?:\.\d+)?\s*(?:%|％|萬元|億元|萬|元|人次|人|場次|場|案|家|年|月|小時)/g;

function normalizeFact(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s,，]/g, "")
    .replace(/％/g, "%");
}

/**
 * 來源必須先拆成獨立的「數值＋單位」事實，再做完整相等比對。
 * 不能對整段來源使用 includes，否則 1,900 人次會錯誤支持 900 人次。
 */
export function extractNumericFacts(sourceMaterials: string[]): Set<string> {
  const prepared = sourceMaterials.join("\n")
    .toLowerCase()
    .replace(/\bpercent(?:age)?\b/g, "%")
    .replace(/\b(\d{4})-\d{2}-\d{2}\b/g, "$1年");
  return new Set((prepared.match(FACT_PATTERN) ?? []).map(normalizeFact));
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
  const sourceFacts = extractNumericFacts(sourceMaterials);
  const unsupportedClaims = chapters.flatMap((chapter) => {
    const claims = chapter.content.match(FACT_PATTERN) ?? [];
    const uniqueClaims = new Map<string, string>();
    for (const claim of claims) {
      const normalized = normalizeFact(claim);
      if (!uniqueClaims.has(normalized)) uniqueClaims.set(normalized, claim);
    }
    return [...uniqueClaims.entries()]
      .filter(([normalized]) => !sourceFacts.has(normalized))
      .map(([, claim]) => ({ chapterKey: chapter.key, chapterTitle: chapter.title, claim }));
  });
  const pendingCount = chapters.reduce(
    (total, chapter) => total + (chapter.content.match(/【待補】/g)?.length ?? 0),
    0,
  );
  const missingRequired = chapters
    .filter((chapter) => chapter.required && chapter.content.trim().length < requiredChapterMinimum(chapter))
    .map((chapter) => chapter.title);
  const overWordLimit = chapters
    .filter((chapter) => chapter.wordLimit && chapter.content.trim().length > chapter.wordLimit)
    .map((chapter) => ({
      chapterKey: chapter.key,
      chapterTitle: chapter.title,
      actual: chapter.content.trim().length,
      limit: chapter.wordLimit!,
    }));
  const highIssues = review.issues.filter((issue) => issue.severity === "high");
  const uncoveredRubric = evaluateRubricCoverage(chapters, rubric)
    .filter((item) => !item.covered)
    .map(({ item, points, missingCriteria }) => ({ item, points, missingCriteria }));

  return {
    score: review.totalScore,
    dimensions: review.dimensions,
    issues: review.issues,
    unsupportedClaims,
    pendingCount,
    missingRequired,
    overWordLimit,
    uncoveredRubric,
    canAdvanceToHumanReview:
      review.totalScore >= 75 &&
      highIssues.length === 0 &&
      unsupportedClaims.length === 0 &&
      pendingCount === 0 &&
      missingRequired.length === 0 &&
      overWordLimit.length === 0 &&
      uncoveredRubric.length === 0,
  };
}
