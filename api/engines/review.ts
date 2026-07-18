// 審核引擎：五個面向檢查計畫書，每一個問題都附「改進方向」。
// 規則引擎為主（離線可跑、結果可解釋）；有 LLM 金鑰時另附評審總評。
import type {
  CaseChapter,
  ReviewDimension,
  ReviewIssue,
  RubricItem,
} from "../../contracts/types";

const VAGUE_PHRASES = [
  "浪潮", "賦能", "打造生態", "生態圈", "積極推動", "落實執行",
  "深獲好評", "效益顯著", "廣受好評", "各界肯定", "多元發展",
  "創新思維", "共同努力", "有目共睹", "指日可待", "更上一層樓",
];

const NUM_RE = /\d+(?:\.\d+)?\s*(?:%|％|萬元|億元|萬|元|人次|人|場|案|家|年|月|小時)/g;
const MONEY_RE = /([^\n，。；、]{0,10}?)(\d[\d,]*(?:\.\d+)?)\s*(萬元|億元|萬|元)/g;

interface DimResult {
  dim: ReviewDimension;
  issues: Omit<ReviewIssue, "id" | "status">[];
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ---- 面向一：評分標準對應 ------------------------------------------------
function dimRubric(chapters: CaseChapter[], rubric: RubricItem[]): DimResult {
  const issues: DimResult["issues"] = [];
  if (rubric.length === 0) {
    return {
      dim: { key: "rubric", label: "評分標準對應", score: 60, weight: 0.35, summary: "本案未建立評分標準，僅能以章節完整度粗估" },
      issues: [],
    };
  }
  const total = rubric.reduce((s, r) => s + r.points, 0) || 100;
  let covered = 0;
  for (const r of rubric) {
    const keys = [r.item, ...r.description.split(/[，、；\s]/).filter((w) => w.length >= 2)];
    const hits = chapters.filter(
      (ch) => ch.content.length >= 120 && keys.some((k) => k.length >= 2 && (ch.content.includes(k) || (ch.title + ch.guidance).includes(k))),
    );
    if (hits.length > 0) {
      covered += r.points;
    } else {
      issues.push({
        severity: r.points >= 20 ? "high" : "mid",
        dimension: "rubric",
        chapterKey: "ALL",
        location: `評分項目「${r.item}」（${r.points} 分）`,
        problem: `計畫書中找不到足以對應「${r.item}」的內容（${r.description || "評分重點未涵蓋"}）`,
        suggestion: `回到章節中補上與「${r.item}」直接相關的段落：${r.description || r.item}，並用具體數據或做法呈現`,
      });
    }
  }
  const score = clamp((covered / total) * 100);
  return {
    dim: { key: "rubric", label: "評分標準對應", score, weight: 0.35, summary: `評分項目覆蓋 ${Math.round((covered / total) * 100)}%（${rubric.length} 項檢查）` },
    issues,
  };
}

// ---- 面向二：數據與事實支撐 ------------------------------------------------
function dimEvidence(chapters: CaseChapter[]): DimResult {
  const issues: DimResult["issues"] = [];
  let ok = 0, counted = 0;
  for (const ch of chapters.filter((c) => c.content.length >= 80)) {
    counted++;
    const nums = ch.content.match(NUM_RE) ?? [];
    if (nums.length >= 2) {
      ok++;
    } else {
      issues.push({
        severity: "mid",
        dimension: "evidence",
        chapterKey: ch.key,
        location: `「${ch.title}」`,
        problem: `本章僅 ${nums.length} 處數據，內容偏敘述、缺事實支撐`,
        suggestion: "補上可衡量的數字：基期值與目標值、人次／場次／金額、統計來源；沒有的數據向客戶要，不要虛構",
      });
    }
  }
  const score = counted === 0 ? 0 : clamp((ok / counted) * 100);
  return {
    dim: { key: "evidence", label: "數據與事實支撐", score, weight: 0.15, summary: `${ok}/${counted} 個章節有足夠數據` },
    issues,
  };
}

// ---- 面向三：結構與格式符合 ------------------------------------------------
function dimStructure(chapters: CaseChapter[]): DimResult {
  const issues: DimResult["issues"] = [];
  let lost = 0;
  for (const ch of chapters) {
    if (ch.required && ch.content.trim().length === 0) {
      lost += 30;
      issues.push({
        severity: "high",
        dimension: "structure",
        chapterKey: ch.key,
        location: `「${ch.title}」`,
        problem: "必要章節完全沒有內容",
        suggestion: "先在寫作台產生草稿，或回到問卷補齊本章素材",
      });
    } else if (ch.required && ch.content.trim().length < 120) {
      lost += 12;
      issues.push({
        severity: "mid",
        dimension: "structure",
        chapterKey: ch.key,
        location: `「${ch.title}」`,
        problem: `內容僅 ${ch.content.trim().length} 字，明顯單薄`,
        suggestion: `依本章指引擴寫：${ch.guidance || "補充具體做法與數據"}`,
      });
    }
    const pending = ch.content.match(/【待補】/g) ?? [];
    if (pending.length > 0) {
      lost += 5;
      issues.push({
        severity: "low",
        dimension: "structure",
        chapterKey: ch.key,
        location: `「${ch.title}」`,
        problem: `仍有 ${pending.length} 處【待補】標記未補齊`,
        suggestion: "逐一回填【待補】資料；送件前不得殘留任何標記",
      });
    }
  }
  const score = clamp(100 - lost);
  return {
    dim: { key: "structure", label: "結構與格式符合", score, weight: 0.2, summary: `${chapters.filter((c) => c.required && c.content.trim().length >= 120).length}/${chapters.filter((c) => c.required).length} 個必要章節達基本量` },
    issues,
  };
}

// ---- 面向四：具體性（去空泛） ------------------------------------------------
function dimSpecificity(chapters: CaseChapter[]): DimResult {
  const issues: DimResult["issues"] = [];
  let found = 0;
  for (const ch of chapters) {
    for (const phrase of VAGUE_PHRASES) {
      const idx = ch.content.indexOf(phrase);
      if (idx >= 0) {
        found++;
        issues.push({
          severity: "low",
          dimension: "specificity",
          chapterKey: ch.key,
          location: `「${ch.title}」第 ${Math.max(1, Math.floor(idx / 40) + 1)} 段附近`,
          problem: `出現空泛用語「${phrase}」`,
          suggestion: `把「${phrase}」換成具體主詞＋動詞＋數字，例如誰、做了什麼、多少量`,
        });
      }
    }
  }
  const score = clamp(100 - found * 12);
  return {
    dim: { key: "specificity", label: "具體性（去空泛）", score, weight: 0.15, summary: `發現 ${found} 處空泛用語` },
    issues,
  };
}

// ---- 面向五：一致性 -------------------------------------------------------
function dimConsistency(chapters: CaseChapter[]): DimResult {
  const issues: DimResult["issues"] = [];
  // 同一個金額「標籤」在不同章節出現不同數字 → 不一致
  const seen = new Map<string, { value: string; chapter: string }>();
  let mismatches = 0;
  for (const ch of chapters) {
    for (const m of ch.content.matchAll(MONEY_RE)) {
      const label = (m[1] ?? "").replace(/[\s：:，。]/g, "").slice(-6);
      if (label.length < 2) continue;
      const value = `${m[2]}${m[3]}`;
      const prev = seen.get(label);
      if (prev && prev.value !== value) {
        mismatches++;
        issues.push({
          severity: "high",
          dimension: "consistency",
          chapterKey: ch.key,
          location: `「${ch.title}」vs「${prev.chapter}」`,
          problem: `「${label}」金額不一致：${prev.value} ≠ ${value}`,
          suggestion: "統一全書金額；內文、摘要、預算表三處數字必須完全相同",
        });
      } else if (!prev) {
        seen.set(label, { value, chapter: ch.title });
      }
    }
  }
  const score = clamp(100 - mismatches * 25);
  return {
    dim: { key: "consistency", label: "一致性檢查", score, weight: 0.15, summary: mismatches === 0 ? "金額數字前後一致" : `發現 ${mismatches} 處金額不一致` },
    issues,
  };
}

export interface ReviewOutput {
  totalScore: number;
  dimensions: ReviewDimension[];
  issues: ReviewIssue[];
}

/** 主入口：對整份計畫書執行五面向審核 */
export function runReview(chapters: CaseChapter[], rubric: RubricItem[], round: number): ReviewOutput {
  const results = [
    dimRubric(chapters, rubric),
    dimEvidence(chapters),
    dimStructure(chapters),
    dimSpecificity(chapters),
    dimConsistency(chapters),
  ];
  const dimensions = results.map((r) => r.dim);
  const totalScore = clamp(dimensions.reduce((s, d) => s + d.score * d.weight, 0));
  const issues: ReviewIssue[] = results
    .flatMap((r) => r.issues)
    .sort((a, b) => ({ high: 0, mid: 1, low: 2 })[a.severity] - { high: 0, mid: 1, low: 2 }[b.severity])
    .map((it, i) => ({ ...it, id: `r${round}_i${i}`, status: "open" as const }));
  return { totalScore, dimensions, issues };
}
