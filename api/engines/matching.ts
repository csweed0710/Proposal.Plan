// 適配引擎：把「哪個客戶適合哪個補助案」變成可解釋的規則評分，不靠感覺。
import type { MatchResult } from "../../contracts/types";
import type { Client, GrantProgram } from "../../db/schema";

const DAY = 86400000;

function daysUntil(d: Date | string | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / DAY);
}

function keywordHits(haystack: string, needles: string[]): string[] {
  return needles.filter((n) => n.length >= 2 && haystack.includes(n));
}

/** 為一位客戶評一個補助案，回傳 0–100 分＋理由＋警示 */
export function matchOne(client: Client, grant: GrantProgram, windowDays = 90): MatchResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  // 1. 組織資格（35 分）— 硬性門檻
  const orgTypes = grant.orgTypes ?? [];
  if (orgTypes.length === 0 || orgTypes.includes(client.orgType)) {
    score += 35;
    reasons.push(`組織型態「${client.orgType}」符合申請資格`);
  } else {
    warnings.push(`組織型態不符：本案限 ${orgTypes.join("、")} 申請`);
  }

  // 2. 時程（25 分）
  const left = daysUntil(grant.applyEnd);
  if (grant.rolling) {
    score += 25;
    reasons.push("常年受理，隨到隨審，時程彈性");
  } else if (left !== null && left >= 0 && left <= windowDays) {
    score += left >= 21 ? 25 : 15;
    reasons.push(`距截止約 ${left} 天，在受理窗口內`);
    if (left < 21) warnings.push(`時程偏趕（剩 ${left} 天），建議評估急件可行性`);
  } else if (left !== null && left > windowDays) {
    score += 8;
    reasons.push(`受理日在 ${windowDays} 天窗口之外（約 ${left} 天後截止）`);
  } else {
    warnings.push("已逾截止日或時程未明，需先確認當年度公告");
  }

  // 3. 領域相關性（25 分）— 客戶標籤／優勢／實績 vs 補助案文字
  const grantText = `${grant.name} ${grant.category} ${grant.description ?? ""}`;
  const tags = client.tags ?? [];
  const hits = keywordHits(grantText, tags);
  if (hits.length > 0) {
    score += Math.min(25, 10 + hits.length * 5);
    reasons.push(`領域對應：${hits.join("、")}`);
  }
  const projectHits = (client.pastProjects ?? []).filter((p) =>
    keywordHits(grantText, p.name.split(/[、，\s]/).filter((w) => w.length >= 2)).length > 0,
  );
  if (projectHits.length > 0) {
    score = Math.min(100, score + 8);
    reasons.push(`過往實績相關：「${projectHits[0].name}」`);
  }
  if (hits.length === 0 && projectHits.length === 0) {
    warnings.push("領域關聯不明確，需確認計畫主題是否對得上客戶專長");
  }

  // 4. 規模合理性（15 分）
  const amount = grant.amountMax;
  if (amount && client.capital) {
    if (amount <= client.capital * 10) {
      score += 15;
      reasons.push("申請規模與客戶資本規模相稱");
    } else {
      score += 5;
      warnings.push("申請上限遠高於客戶資本額，自籌款與財務規劃會被嚴審");
    }
  } else {
    score += 8;
  }

  if (grant.needsVerification) warnings.push("本案時程標記為「待查證」，送件前務必核對官方公告");

  const level: MatchResult["level"] =
    score >= 75 ? "強力推薦" : score >= 55 ? "適合" : score >= 35 ? "可考慮" : "不建議";

  return {
    grantId: grant.id,
    grantName: grant.name,
    agency: grant.agency,
    category: grant.category,
    applyEnd: grant.applyEnd ? String(grant.applyEnd) : null,
    rolling: grant.rolling,
    amountMax: grant.amountMax,
    score,
    level,
    reasons,
    warnings,
  };
}

/** 為一位客戶對全部補助案評分並排序 */
export function matchAll(client: Client, grants: GrantProgram[], windowDays = 90): MatchResult[] {
  return grants
    .filter((g) => g.status !== "closed")
    .map((g) => matchOne(client, g, windowDays))
    .sort((a, b) => b.score - a.score);
}
