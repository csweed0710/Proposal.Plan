// 審核引擎：五個面向檢查計畫書，每一個問題都附「改進方向」。
// 規則引擎為主（離線可跑、結果可解釋）；有 LLM 金鑰時另附評審總評。
import type {
  CaseChapter,
  ReviewDimension,
  ReviewIssue,
  RubricItem,
} from "../../contracts/types";
import {
  BANNED_BUDGET_KEYWORDS,
  budgetExpected,
  budgetRowTotal,
  budgetTotals,
} from "../../contracts/tables";

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
  // 官方字數上限
  for (const ch of chapters) {
    if (ch.wordLimit && ch.content.length > ch.wordLimit) {
      issues.push({
        severity: "mid",
        dimension: "consistency",
        chapterKey: ch.key,
        location: `「${ch.title}」`,
        problem: `內容 ${ch.content.length.toLocaleString()} 字，超過官方上限 ${ch.wordLimit.toLocaleString()} 字`,
        suggestion: "精簡至上限以內；超過字數／頁數限制會被扣分或退件",
      });
    }
  }
  const score = clamp(100 - mismatches * 25 - issues.filter((i) => i.dimension === "consistency" && !i.problem.includes("金額不一致")).length * 8);
  return {
    dim: { key: "consistency", label: "一致性檢查", score, weight: 0.15, summary: mismatches === 0 ? "金額數字前後一致" : `發現 ${mismatches} 處金額不一致` },
    issues,
  };
}

// ---- 面向六：結構化表格檢核（預算/進度/KPI） --------------------------------
// 委員 80% 先看這三張表；算錯、比例不對、禁列項目都是常見退件原因。
function dimTables(chapters: CaseChapter[]): DimResult {
  const issues: DimResult["issues"] = [];
  let hasTable = false;

  for (const ch of chapters) {
    if (!ch.table) continue;
    hasTable = true;
    const loc = `「${ch.title}」`;

    if (ch.table.type === "budget") {
      const t = ch.table.budget;
      const totals = budgetTotals(t);
      if (t.rows.length === 0 || totals.total === 0) {
        issues.push({ severity: "high", dimension: "tables", chapterKey: ch.key, location: loc,
          problem: "預算表是空的或總額為 0",
          suggestion: "逐列填寫科目、數量、單價與補助款/自籌款拆分；預算表空白等同未附預算，直接退件" });
      }
      t.rows.forEach((r, i) => {
        const rowName = r.item || `第 ${i + 1} 列`;
        if (!r.item.trim()) {
          issues.push({ severity: "mid", dimension: "tables", chapterKey: ch.key, location: `${loc}第 ${i + 1} 列`,
            problem: "科目名稱空白", suggestion: "填寫科目名稱（如人事費、材料費、差旅費），或刪除此列" });
        }
        const expected = budgetExpected(r);
        const actual = budgetRowTotal(r);
        if (expected > 0 && Math.abs(expected - actual) > 1) {
          issues.push({ severity: "high", dimension: "tables", chapterKey: ch.key, location: `${loc}「${rowName}」`,
            problem: `算術不符：${r.qty} × ${r.unitPrice.toLocaleString()} = ${expected.toLocaleString()}，但拆分合計 ${actual.toLocaleString()}`,
            suggestion: "修正數量×單價與補助款+自籌款的金額，兩者必須相等——金額算錯是退件主因之一" });
        }
        const text = `${r.item}${r.detail}`;
        for (const kw of BANNED_BUDGET_KEYWORDS) {
          if (text.includes(kw)) {
            issues.push({ severity: "mid", dimension: "tables", chapterKey: ch.key, location: `${loc}「${rowName}」`,
              problem: `出現敏感科目「${kw}」——多數補助案列為不得補助項目`,
              suggestion: "確認本案經費編列規定；若屬禁列項目請移除或改列自籌並說明必要性" });
          }
        }
        if (r.unitPrice > 0 && !r.note.trim()) {
          issues.push({ severity: "low", dimension: "tables", chapterKey: ch.key, location: `${loc}「${rowName}」`,
            problem: "單價未附依據", suggestion: "在備註寫明單價依據（行情、過往契約、薪資標準），委員會質疑過高單價" });
        }
      });
      if (totals.total > 0) {
        const selfRatio = totals.self / totals.total;
        if (selfRatio < 0.5) {
          issues.push({ severity: "low", dimension: "tables", chapterKey: ch.key, location: loc,
            problem: `自籌款比例僅 ${(selfRatio * 100).toFixed(0)}%`,
            suggestion: "許多補助案要求自籌款 ≥ 50%，請核對本案規定；不足時調整補助款/自籌款拆分" });
        }
        // 內文金額 vs 表格總額 交叉檢查
        const m = ch.content.match(/總(?:經費|預算|計)?[^\d]{0,8}([\d,]+(?:\.\d+)?)\s*(萬元|元)/);
        if (m) {
          const inText = Number(m[1].replace(/,/g, "")) * (m[2] === "萬元" ? 10000 : 1);
          if (Math.abs(inText - totals.total) > 1) {
            issues.push({ severity: "high", dimension: "tables", chapterKey: ch.key, location: loc,
              problem: `內文寫 ${m[1]}${m[2]}，但預算表加總為 ${totals.total.toLocaleString()} 元，前後不一致`,
              suggestion: "統一內文與預算表的總金額；送件前所有章節的金額必須完全相同" });
          }
        }
      }
    }

    if (ch.table.type === "schedule") {
      const t = ch.table.schedule;
      if (t.rows.length === 0) {
        issues.push({ severity: "high", dimension: "tables", chapterKey: ch.key, location: loc,
          problem: "進度表沒有任何工作項目", suggestion: "至少列出 3–6 個工作項目，含起訖月與查核點" });
      }
      t.rows.forEach((r, i) => {
        const rowName = r.task || `第 ${i + 1} 列`;
        if (!r.task.trim()) {
          issues.push({ severity: "mid", dimension: "tables", chapterKey: ch.key, location: `${loc}第 ${i + 1} 列`,
            problem: "工作項目空白", suggestion: "填寫工作項目名稱，或刪除此列" });
        }
        if (r.startMonth > r.endMonth) {
          issues.push({ severity: "mid", dimension: "tables", chapterKey: ch.key, location: `${loc}「${rowName}」`,
            problem: `開始月（${r.startMonth}）晚於結束月（${r.endMonth}）`, suggestion: "修正起訖月份" });
        }
        if (r.endMonth > t.months) {
          issues.push({ severity: "mid", dimension: "tables", chapterKey: ch.key, location: `${loc}「${rowName}」`,
            problem: `結束月（${r.endMonth}）超過計畫總月數（${t.months}）`, suggestion: "修正月份或調整計畫總月數" });
        }
        if (r.task.trim() && !r.checkpoint.trim()) {
          issues.push({ severity: "low", dimension: "tables", chapterKey: ch.key, location: `${loc}「${rowName}」`,
            problem: "缺少查核點", suggestion: "每個工作項目都應有可驗收的查核點（如「完成期中報告」「產出 20 份問卷」）" });
        }
      });
    }

    if (ch.table.type === "kpi") {
      const t = ch.table.kpi;
      if (t.rows.length === 0) {
        issues.push({ severity: "high", dimension: "tables", chapterKey: ch.key, location: loc,
          problem: "效益指標表是空的", suggestion: "列出 3–5 個量化 KPI（人次、產值、場次…），附目標值與計算基準" });
      }
      t.rows.forEach((r, i) => {
        const rowName = r.indicator || `第 ${i + 1} 列`;
        if (!r.indicator.trim()) {
          issues.push({ severity: "mid", dimension: "tables", chapterKey: ch.key, location: `${loc}第 ${i + 1} 列`,
            problem: "指標名稱空白", suggestion: "填寫指標名稱（如服務人次、滿意度），或刪除此列" });
        }
        if (r.indicator.trim() && !/\d/.test(r.target)) {
          issues.push({ severity: "high", dimension: "tables", chapterKey: ch.key, location: `${loc}「${rowName}」`,
            problem: "目標值沒有數字——KPI 必須量化",
            suggestion: "把目標改成可衡量的數字（如 1,200 人次/年、滿意度 85%）；「提升」「強化」不算指標" });
        }
        if (r.indicator.trim() && !r.basis.trim()) {
          issues.push({ severity: "low", dimension: "tables", chapterKey: ch.key, location: `${loc}「${rowName}」`,
            problem: "缺少計算基準", suggestion: "寫明數字怎麼算出來的（如每週 2 場 × 15 人 × 40 週），委員必問" });
        }
      });
    }
  }

  const deduct = issues.reduce((s, i) => s + ({ high: 25, mid: 10, low: 4 }[i.severity]), 0);
  const score = hasTable ? clamp(100 - deduct) : 100;
  return {
    dim: {
      key: "tables", label: "表格檢核（預算/進度/KPI）", score, weight: 0.15,
      summary: hasTable ? `表格問題 ${issues.length} 項` : "本案章節未宣告結構化表格",
    },
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
    dimTables(chapters),
  ];
  const dimensions = results.map((r) => r.dim);
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const totalScore = clamp(dimensions.reduce((s, d) => s + d.score * d.weight, 0) / totalWeight);
  const issues: ReviewIssue[] = results
    .flatMap((r) => r.issues)
    .sort((a, b) => ({ high: 0, mid: 1, low: 2 })[a.severity] - { high: 0, mid: 1, low: 2 }[b.severity])
    .map((it, i) => ({ ...it, id: `r${round}_i${i}`, status: "open" as const }));
  return { totalScore, dimensions, issues };
}
