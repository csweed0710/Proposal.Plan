// 功能路由：補助案、客戶、適配、案件、問卷、寫作、審核、修改迴圈
import { z } from "zod";
import crypto from "node:crypto";
import { eq, desc, and } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { grantPrograms, clients, cases, reviews, chapterVersions, referenceDocs, radarCandidates } from "@db/schema";
import { parseAnnouncements, scanMocSite } from "./engines/radar";
import { matchAll } from "./engines/matching";
import { generateIntake } from "./engines/intake";
import { draftChapter } from "./engines/writer";
import { runReview, aiSummary } from "./engines/review";
import { applyRevision } from "./engines/revise";
import { pickRefs, docxToText } from "./engines/reference";
import { chat, llmStatus } from "./llm";
import { exportCase } from "./engines/exporter";
import { docxToPdf } from "./engines/pdf";
import type { CaseChapter, ChapterSpec, RubricItem } from "../contracts/types";

const chapterSpec = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  required: z.boolean(),
  guidance: z.string(),
  weight: z.number().optional(),
  tableType: z.enum(["budget", "schedule", "kpi"]).optional(),
  wordLimit: z.number().optional(),
});

const rubricItem = z.object({
  item: z.string().min(1),
  points: z.number(),
  description: z.string(),
});

const grantInput = z.object({
  name: z.string().min(1),
  agency: z.string().min(1),
  category: z.string().default("其他"),
  description: z.string().default(""),
  applyStart: z.string().nullable().default(null),
  applyEnd: z.string().nullable().default(null),
  rolling: z.boolean().default(false),
  deadlineNote: z.string().default(""),
  amountMin: z.number().nullable().default(null),
  amountMax: z.number().nullable().default(null),
  selfFundNote: z.string().default(""),
  orgTypes: z.array(z.string()).default([]),
  eligibilityNote: z.string().default(""),
  chapterSchema: z.array(chapterSpec).default([]),
  rubric: z.array(rubricItem).default([]),
  attachmentsNote: z.string().default(""),
  sourceUrl: z.string().default(""),
  status: z.string().default("open"),
  needsVerification: z.boolean().default(false),
});

const clientInput = z.object({
  name: z.string().min(1),
  orgType: z.string().default("公司"),
  taxId: z.string().default(""),
  foundedYear: z.number().nullable().default(null),
  city: z.string().default(""),
  employeesFull: z.number().nullable().default(null),
  employeesPart: z.number().nullable().default(null),
  capital: z.number().nullable().default(null),
  revenueAvg: z.number().nullable().default(null),
  contactName: z.string().default(""),
  contactTitle: z.string().default(""),
  contactPhone: z.string().default(""),
  contactEmail: z.string().default(""),
  strengths: z.string().default(""),
  pastProjects: z
    .array(z.object({ name: z.string(), year: z.string(), budget: z.string(), outcome: z.string() }))
    .default([]),
  adminCapability: z.string().default(""),
  financialNote: z.string().default(""),
  tags: z.array(z.string()).default([]),
  notes: z.string().default(""),
});

function toDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function mustGetCase(caseId: number) {
  const row = await getDb().query.cases.findFirst({ where: eq(cases.id, caseId) });
  if (!row) throw new Error("案件不存在");
  return row;
}

// ---- 版本快照：覆寫章節「前」把舊狀態存進 chapter_versions，之後可回看、可還原 ----
async function snapshotChapters(caseId: number, before: CaseChapter[], after: CaseChapter[], source: string) {
  const rows = after.flatMap((next) => {
    const prev = before.find((c) => c.key === next.key);
    if (!prev) return [];
    const contentChanged = (prev.content ?? "") !== (next.content ?? "");
    const tableChanged = JSON.stringify(prev.table ?? null) !== JSON.stringify(next.table ?? null);
    if (!contentChanged && !tableChanged) return [];
    // 舊狀態全空就不留版本，避免一堆空快照洗版
    if (!prev.content && !prev.table) return [];
    return [{
      caseId,
      chapterKey: prev.key,
      content: prev.content ?? "",
      tableJson: prev.table ?? null,
      source,
    }];
  });
  if (rows.length) await getDb().insert(chapterVersions).values(rows);
}

// ---- 公告解析：貼上公告文字 → 結構化草稿（AI 優先，規則兜底） ------------
function ruleParseAnnouncement(text: string) {
  const rocYear = new Date().getFullYear() - 1911;
  const dates: string[] = [];
  for (const m of text.matchAll(/(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) {
    const y = Number(m[1]) > 1911 ? Number(m[1]) : Number(m[1]) + 1911;
    dates.push(`${y}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`);
  }
  const amounts = [...text.matchAll(/(\d[\d,]*)\s*(萬元|億元|萬|元)/g)].map((m) => m[0]);
  const chapterMatches = [
    ...text.matchAll(/(?:^|\n)\s*(?:第?[一二三四五六七八九十]+[、.．]|\d+[.、．])\s*(計畫摘要|緣起|背景|現況|目標|內容|執行|方法|策略|進度|時程|組織|團隊|人力|實績|經驗|預算|經費|效益|永續|風險|附件)[^\n]{0,20}/g),
  ];
  const chapters: ChapterSpec[] = chapterMatches.slice(0, 14).map((m, i) => ({
    key: `ch_${i}`,
    title: m[0].replace(/(?:^|\n)\s*(?:第?[一二三四五六七八九十]+[、.．]|\d+[.、．])\s*/, "").trim(),
    required: true,
    guidance: "",
  }));
  const rubricMatches = [...text.matchAll(/([^\n，。；]{2,12})[（(]?\s*(\d{1,2})\s*分[）)]?/g)];
  const rubric: RubricItem[] = rubricMatches.slice(0, 8).map((m) => ({
    item: m[1].trim(),
    points: Number(m[2]),
    description: "",
  }));
  return {
    name: text.split("\n")[0]?.slice(0, 60) ?? "未命名補助案",
    agency: "",
    category: "其他",
    description: text.slice(0, 500),
    applyStart: dates[0] ?? null,
    applyEnd: dates[dates.length - 1] ?? null,
    rolling: /隨到隨|常年受理|随到随/.test(text),
    deadlineNote: dates.length > 0 ? "" : `公告年份未明（民國 ${rocYear} 年前後），請確認`,
    amountMin: null as number | null,
    amountMax: null as number | null,
    selfFundNote: amounts.slice(0, 3).join("、"),
    orgTypes: ["公司", "社團法人", "財團法人"].filter((t) => text.includes(t)),
    eligibilityNote: "",
    chapterSchema: chapters,
    rubric,
    attachmentsNote: "",
    sourceUrl: "",
    status: "open",
    needsVerification: true,
    _amountHints: amounts.slice(0, 5),
  };
}

// 範本檔很大（base64），列表/詳情一律不帶 templateData，只回 hasTemplate
function stripTemplate<T extends { templateData: string | null }>(g: T) {
  const { templateData, ...rest } = g;
  return { ...rest, hasTemplate: !!templateData };
}

export const grantRouter = createRouter({
  list: publicQuery
    .input(z.object({ windowDays: z.number().default(90), q: z.string().default(""), category: z.string().default("") }))
    .query(async ({ input }) => {
      const all = await getDb().query.grantPrograms.findMany({ orderBy: [desc(grantPrograms.updatedAt)] });
      const now = Date.now(), win = input.windowDays * 86400000;
      return all.filter((g) => {
        if (input.q && !`${g.name}${g.agency}`.includes(input.q)) return false;
        if (input.category && g.category !== input.category) return false;
        if (g.rolling) return true;
        if (!g.applyEnd) return true;
        const t = new Date(g.applyEnd).getTime();
        return t >= now - 86400000 && t <= now + win;
      }).map(stripTemplate);
    }),

  get: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const g = await getDb().query.grantPrograms.findFirst({ where: eq(grantPrograms.id, input.id) });
    return g ? stripTemplate(g) : null;
  }),

  create: publicQuery.input(grantInput).mutation(async ({ input }) => {
    const [{ id }] = await getDb().insert(grantPrograms).values({
      ...input,
      applyStart: toDate(input.applyStart),
      applyEnd: toDate(input.applyEnd),
    }).$returningId();
    return { id };
  }),

  update: publicQuery.input(grantInput.extend({ id: z.number() })).mutation(async ({ input }) => {
    const { id, ...data } = input;
    await getDb().update(grantPrograms).set({
      ...data,
      applyStart: toDate(data.applyStart),
      applyEnd: toDate(data.applyEnd),
    }).where(eq(grantPrograms.id, id));
    return { ok: true };
  }),

  remove: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await getDb().delete(grantPrograms).where(eq(grantPrograms.id, input.id));
    return { ok: true };
  }),

  // ---- 官方範本（等級三：每個補助案自己的固定格式 Word）----
  uploadTemplate: publicQuery
    .input(z.object({
      id: z.number(),
      name: z.string().min(1),
      data: z.custom<Uint8Array>((v) => v instanceof Uint8Array),
    }))
    .mutation(async ({ input }) => {
      if (input.data.byteLength < 100 || input.data.byteLength > 15 * 1024 * 1024)
        throw new Error("檔案大小異常（需為 .docx，100B–15MB）");
      await getDb().update(grantPrograms).set({
        templateName: input.name,
        templateData: Buffer.from(input.data).toString("base64"),
      }).where(eq(grantPrograms.id, input.id));
      return { ok: true };
    }),

  downloadTemplate: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const g = await getDb().query.grantPrograms.findFirst({ where: eq(grantPrograms.id, input.id) });
    if (!g?.templateData) return null;
    return { name: g.templateName ?? "template.docx", data: new Uint8Array(Buffer.from(g.templateData, "base64")) };
  }),

  deleteTemplate: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await getDb().update(grantPrograms)
      .set({ templateName: null, templateData: null })
      .where(eq(grantPrograms.id, input.id));
    return { ok: true };
  }),

  parseAnnouncement: publicQuery.input(z.object({ text: z.string().min(20) })).mutation(async ({ input }) => {
    const ai = await chat([
      {
        role: "system",
        content:
          "你是補助案公告解析器。從公告文字抽出結構化資料，只輸出 JSON：{\"name\",\"agency\",\"category\",\"applyStart\",\"applyEnd\",\"rolling\",\"amountMax\",\"orgTypes\":[],\"chapterSchema\":[{\"key\",\"title\",\"required\",\"guidance\"}],\"rubric\":[{\"item\",\"points\",\"description\"}]}。日期用 YYYY-MM-DD；找不到的欄位給 null 或空陣列。",
      },
      { role: "user", content: input.text.slice(0, 8000) },
    ]);
    if (ai) {
      try {
        const parsed = JSON.parse(ai.replace(/```json|```/g, "").trim());
        return { ...ruleParseAnnouncement(input.text), ...parsed, needsVerification: false };
      } catch { /* fall through */ }
    }
    return ruleParseAnnouncement(input.text);
  }),
});

export const clientRouter = createRouter({
  list: publicQuery.query(async () => {
    const all = await getDb().query.clients.findMany({ orderBy: [desc(clients.updatedAt)] });
    const caseCounts = await getDb().query.cases.findMany();
    return all.map((c) => ({ ...c, caseCount: caseCounts.filter((k) => k.clientId === c.id).length }));
  }),

  get: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    return getDb().query.clients.findFirst({ where: eq(clients.id, input.id) });
  }),

  create: publicQuery.input(clientInput).mutation(async ({ input }) => {
    const [{ id }] = await getDb().insert(clients).values(input).$returningId();
    return { id };
  }),

  update: publicQuery.input(clientInput.extend({ id: z.number() })).mutation(async ({ input }) => {
    const { id, ...data } = input;
    await getDb().update(clients).set(data).where(eq(clients.id, id));
    return { ok: true };
  }),

  remove: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await getDb().delete(clients).where(eq(clients.id, input.id));
    return { ok: true };
  }),

  match: publicQuery
    .input(z.object({ clientId: z.number(), windowDays: z.number().default(90) }))
    .query(async ({ input }) => {
      const client = await getDb().query.clients.findFirst({ where: eq(clients.id, input.clientId) });
      if (!client) throw new Error("客戶不存在");
      const grants = await getDb().query.grantPrograms.findMany();
      return matchAll(client, grants, input.windowDays);
    }),
});

export const caseRouter = createRouter({
  list: publicQuery.query(async () => {
    const all = await getDb().query.cases.findMany({ orderBy: [desc(cases.updatedAt)] });
    const cs = await getDb().query.clients.findMany();
    const gs = await getDb().query.grantPrograms.findMany();
    return all.map((k) => ({
      ...k,
      clientName: cs.find((c) => c.id === k.clientId)?.name ?? "未知客戶",
      grantName: gs.find((g) => g.id === k.grantId)?.name ?? "未知補助案",
    }));
  }),

  get: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const k = await mustGetCase(input.id);
    const client = await getDb().query.clients.findFirst({ where: eq(clients.id, k.clientId) });
    const grant = await getDb().query.grantPrograms.findFirst({ where: eq(grantPrograms.id, k.grantId) });
    return { ...k, client, grant: grant ? stripTemplate(grant) : null };
  }),

  create: publicQuery
    .input(z.object({ clientId: z.number(), grantId: z.number(), title: z.string().min(1), targetScore: z.number().default(85) }))
    .mutation(async ({ input }) => {
      const client = await getDb().query.clients.findFirst({ where: eq(clients.id, input.clientId) });
      const grant = await getDb().query.grantPrograms.findFirst({ where: eq(grantPrograms.id, input.grantId) });
      if (!client || !grant) throw new Error("客戶或補助案不存在");
      const chapters: CaseChapter[] = (grant.chapterSchema ?? []).map((s) => ({
        ...s, content: "", status: "empty" as const,
      }));
      const intakeQA = generateIntake(grant.chapterSchema ?? [], grant.rubric ?? [], client);
      const [{ id }] = await getDb().insert(cases).values({
        clientId: input.clientId,
        grantId: input.grantId,
        title: input.title,
        targetScore: input.targetScore,
        intakeQA,
        chapters,
        rubricSnapshot: grant.rubric ?? [],
        status: "intake",
      }).$returningId();
      return { id };
    }),

  saveIntake: publicQuery
    .input(z.object({ id: z.number(), intakeQA: z.array(z.any()) }))
    .mutation(async ({ input }) => {
      await getDb().update(cases).set({ intakeQA: input.intakeQA as never, status: "draft" }).where(eq(cases.id, input.id));
      return { ok: true };
    }),

  saveChapters: publicQuery
    .input(z.object({ id: z.number(), chapters: z.array(z.any()) }))
    .mutation(async ({ input }) => {
      const k = await mustGetCase(input.id);
      const next = input.chapters as CaseChapter[];
      await snapshotChapters(input.id, k.chapters ?? [], next, "手動編輯");
      await getDb().update(cases).set({ chapters: next as never }).where(eq(cases.id, input.id));
      return { ok: true };
    }),

  setTargetScore: publicQuery
    .input(z.object({ id: z.number(), targetScore: z.number().min(1).max(100) }))
    .mutation(async ({ input }) => {
      await getDb().update(cases).set({ targetScore: input.targetScore }).where(eq(cases.id, input.id));
      return { ok: true };
    }),

  draftChapter: publicQuery
    .input(z.object({ id: z.number(), chapterKey: z.string() }))
    .mutation(async ({ input }) => {
      const k = await mustGetCase(input.id);
      const client = await getDb().query.clients.findFirst({ where: eq(clients.id, k.clientId) });
      const grant = await getDb().query.grantPrograms.findFirst({ where: eq(grantPrograms.id, k.grantId) });
      if (!client || !grant) throw new Error("資料缺漏");
      const ch = (k.chapters ?? []).find((c) => c.key === input.chapterKey);
      if (!ch) throw new Error("章節不存在");
      const allRefs = await getDb().query.referenceDocs.findMany();
      const refs = pickRefs(allRefs, grant.id, ["example", "data", "feedback", "rubric_doc"]);
      const { content, usedAI, usedRefs } = await draftChapter(ch, k.intakeQA ?? [], client, grant, k.rubricSnapshot ?? [], refs);
      const chapters = (k.chapters ?? []).map((c) =>
        c.key === input.chapterKey ? { ...c, content, status: "draft" as const } : c,
      );
      await snapshotChapters(input.id, k.chapters ?? [], chapters, "AI 起草");
      await getDb().update(cases).set({ chapters, status: "draft" }).where(eq(cases.id, input.id));
      return { content, usedAI, usedRefs };
    }),

  // ---- 案件 pipeline：狀態流轉 ----
  setStatus: publicQuery
    .input(z.object({
      id: z.number(),
      status: z.enum(["intake", "draft", "reviewing", "done", "submitted", "won", "lost"]),
    }))
    .mutation(async ({ input }) => {
      await getDb().update(cases).set({ status: input.status }).where(eq(cases.id, input.id));
      return { ok: true };
    }),

  // ---- 送件／結果登錄：送件日、核定金額、委員意見（未中標的意見是下次的秘密武器）----
  setResult: publicQuery
    .input(z.object({
      id: z.number(),
      status: z.enum(["submitted", "won", "lost"]),
      submittedAt: z.string().nullable().default(null), // YYYY-MM-DD
      resultAmount: z.number().nullable().default(null),
      reviewFeedback: z.string().default(""),
    }))
    .mutation(async ({ input }) => {
      const k = await mustGetCase(input.id);
      await getDb().update(cases).set({
        status: input.status,
        submittedAt: input.submittedAt ? new Date(input.submittedAt) : null,
        resultAmount: input.resultAmount,
        reviewFeedback: input.reviewFeedback.trim() || null,
      }).where(eq(cases.id, input.id));
      // 委員意見自動歸檔到參考資料庫——下次投同一補助案，起草與修改自動回應
      const fb = input.reviewFeedback.trim();
      if (fb) {
        const existing = await getDb().query.referenceDocs.findFirst({
          where: and(eq(referenceDocs.caseId, input.id), eq(referenceDocs.kind, "feedback")),
        });
        if (existing) {
          await getDb().update(referenceDocs).set({ textContent: fb }).where(eq(referenceDocs.id, existing.id));
        } else {
          await getDb().insert(referenceDocs).values({
            title: `「${k.title}」委員意見`,
            kind: "feedback",
            grantId: k.grantId,
            caseId: input.id,
            filename: null,
            textContent: fb,
            note: "送件結果登錄時自動歸檔",
          });
        }
      }
      return { ok: true };
    }),

  // ---- 章節版本歷史：列表（可依章節篩選）----
  versions: publicQuery
    .input(z.object({ id: z.number(), chapterKey: z.string().optional() }))
    .query(async ({ input }) => {
      const cond = input.chapterKey
        ? and(eq(chapterVersions.caseId, input.id), eq(chapterVersions.chapterKey, input.chapterKey))
        : eq(chapterVersions.caseId, input.id);
      return getDb().query.chapterVersions.findMany({
        where: cond,
        orderBy: [desc(chapterVersions.id)],
        limit: 100,
      });
    }),

  // ---- 還原版本：把某章節回復到指定快照（還原前也會再快照一次，還原本身可反悔）----
  restoreVersion: publicQuery
    .input(z.object({ id: z.number(), versionId: z.number() }))
    .mutation(async ({ input }) => {
      const v = await getDb().query.chapterVersions.findFirst({ where: eq(chapterVersions.id, input.versionId) });
      if (!v || v.caseId !== input.id) throw new Error("版本不存在");
      const k = await mustGetCase(input.id);
      const chapters = (k.chapters ?? []).map((c) =>
        c.key === v.chapterKey
          ? { ...c, content: v.content ?? "", table: v.tableJson ?? c.table, status: "draft" as const }
          : c,
      );
      await snapshotChapters(input.id, k.chapters ?? [], chapters, "還原前快照");
      await getDb().update(cases).set({ chapters: chapters as never }).where(eq(cases.id, input.id));
      return { ok: true };
    }),

  // ---- 匯出成真正的 .docx 檔案（官方範本填寫 / 標題自動對應 / 通用排版）----
  exportDocx: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const k = await mustGetCase(input.id);
    const client = await getDb().query.clients.findFirst({ where: eq(clients.id, k.clientId) });
    const grant = await getDb().query.grantPrograms.findFirst({ where: eq(grantPrograms.id, k.grantId) });
    if (!client || !grant) throw new Error("缺少客戶或補助資料");
    const result = await exportCase(k, client, grant);
    const safeTitle = k.title.replace(/[\\/:*?"<>|]/g, "_");
    return {
      filename: `${safeTitle}.docx`,
      mode: result.mode,
      mapped: result.mapped,
      unmapped: result.unmapped,
      data: result.data,
    };
  }),

  exportPdf: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const k = await mustGetCase(input.id);
    const client = await getDb().query.clients.findFirst({ where: eq(clients.id, k.clientId) });
    const grant = await getDb().query.grantPrograms.findFirst({ where: eq(grantPrograms.id, k.grantId) });
    if (!client || !grant) throw new Error("缺少客戶或補助資料");
    const result = await exportCase(k, client, grant);
    const pdf = await docxToPdf(new Uint8Array(result.data));
    const safeTitle = k.title.replace(/[\\/:*?"<>|]/g, "_");
    return {
      filename: `${safeTitle}.pdf`,
      mode: result.mode,
      data: pdf,
    };
  }),

  remove: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await getDb().delete(reviews).where(eq(reviews.caseId, input.id));
    await getDb().delete(cases).where(eq(cases.id, input.id));
    return { ok: true };
  }),

  // ---- 客戶自填連結：取得（或首次產生）專屬 token ----
  shareLink: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const k = await mustGetCase(input.id);
    let token = k.intakeToken;
    if (!token) {
      token = crypto.randomBytes(24).toString("hex");
      await getDb().update(cases).set({ intakeToken: token }).where(eq(cases.id, input.id));
    }
    return { token, submittedAt: k.intakeSubmittedAt };
  }),
});

export const reviewRouter = createRouter({
  list: publicQuery.input(z.object({ caseId: z.number() })).query(async ({ input }) => {
    return getDb().query.reviews.findMany({
      where: eq(reviews.caseId, input.caseId),
      orderBy: [desc(reviews.round)],
    });
  }),

  run: publicQuery.input(z.object({ caseId: z.number() })).mutation(async ({ input }) => {
    const k = await mustGetCase(input.caseId);
    const round = k.reviewRound + 1;
    const out = runReview(k.chapters ?? [], k.rubricSnapshot ?? [], round);
    const summary = await aiSummary(k.chapters ?? [], out.dimensions, out.issues, k.rubricSnapshot ?? []);
    await getDb().insert(reviews).values({
      caseId: input.caseId,
      round,
      totalScore: out.totalScore,
      dimensions: out.dimensions,
      issues: out.issues,
      aiSummary: summary,
    });
    await getDb().update(cases).set({
      currentScore: out.totalScore,
      reviewRound: round,
      status: out.totalScore >= k.targetScore ? "done" : "reviewing",
    }).where(eq(cases.id, input.caseId));
    return { ...out, round, targetScore: k.targetScore, passed: out.totalScore >= k.targetScore, aiSummary: summary };
  }),

  // 一鍵「接續修改」：修 → 再審，回傳兩步結果，前端可連續呼叫直到達標
  reviseAndReview: publicQuery.input(z.object({ caseId: z.number() })).mutation(async ({ input }) => {
    const k = await mustGetCase(input.caseId);
    const latest = await getDb().query.reviews.findFirst({
      where: eq(reviews.caseId, input.caseId),
      orderBy: [desc(reviews.round)],
    });
    if (!latest) throw new Error("請先執行一次審核");

    const chapterAnswers: Record<string, string[]> = {};
    for (const q of k.intakeQA ?? []) {
      if (q.answer.trim()) {
        chapterAnswers[q.chapterKey] = [...(chapterAnswers[q.chapterKey] ?? []), `${q.question}：${q.answer.trim()}`];
      }
    }
    const allRefs = await getDb().query.referenceDocs.findMany();
    const refs = pickRefs(allRefs, k.grantId, ["feedback", "data"]);
    const rev = await applyRevision(k.chapters ?? [], latest.issues ?? [], chapterAnswers, refs);
    await snapshotChapters(input.caseId, k.chapters ?? [], rev.chapters, "修改迴圈");
    await getDb().update(cases).set({ chapters: rev.chapters }).where(eq(cases.id, input.caseId));

    const round = k.reviewRound + 1;
    const out = runReview(rev.chapters, k.rubricSnapshot ?? [], round);
    const summary = await aiSummary(rev.chapters, out.dimensions, out.issues, k.rubricSnapshot ?? []);
    await getDb().insert(reviews).values({
      caseId: input.caseId,
      round,
      totalScore: out.totalScore,
      dimensions: out.dimensions,
      issues: out.issues,
      note: rev.changeLog.join("\n"),
      aiSummary: summary,
    });
    await getDb().update(cases).set({
      currentScore: out.totalScore,
      reviewRound: round,
      status: out.totalScore >= k.targetScore ? "done" : "reviewing",
    }).where(eq(cases.id, input.caseId));
    return {
      changeLog: rev.changeLog,
      usedAI: rev.usedAI,
      ...out,
      round,
      targetScore: k.targetScore,
      passed: out.totalScore >= k.targetScore,
      aiSummary: summary,
    };
  }),
});

// ============================================================================
// 參考資料庫：得標範本／評分文件／委員意見／數據文獻
// 只存文字（供 AI 使用），原始檔案由使用者自行留存
// ============================================================================
export const referenceRouter = createRouter({
  list: publicQuery
    .input(z.object({ kind: z.string().default(""), grantId: z.number().nullable().default(null) }))
    .query(async ({ input }) => {
      const all = await getDb().query.referenceDocs.findMany({ orderBy: [desc(referenceDocs.id)] });
      const gs = await getDb().query.grantPrograms.findMany();
      return all
        .filter((d) =>
          (!input.kind || d.kind === input.kind) &&
          (input.grantId == null || d.grantId === input.grantId || d.grantId == null))
        .map((d) => ({
          id: d.id,
          title: d.title,
          kind: d.kind,
          grantId: d.grantId,
          grantName: d.grantId ? (gs.find((g) => g.id === d.grantId)?.name ?? "未知補助案") : null,
          caseId: d.caseId,
          filename: d.filename,
          note: d.note,
          createdAt: d.createdAt,
          textLength: d.textContent?.length ?? 0,
          preview: (d.textContent ?? "").slice(0, 150),
        }));
    }),

  get: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    return getDb().query.referenceDocs.findFirst({ where: eq(referenceDocs.id, input.id) });
  }),

  create: publicQuery
    .input(z.object({
      title: z.string().min(1),
      kind: z.enum(["example", "rubric_doc", "feedback", "data"]),
      grantId: z.number().nullable().default(null),
      note: z.string().default(""),
      text: z.string().default(""),
      filename: z.string().nullable().default(null),
      fileData: z.custom<Uint8Array>((v) => v instanceof Uint8Array).optional(),
    }))
    .mutation(async ({ input }) => {
      let text = input.text.trim();
      if (!text && input.fileData) {
        const name = (input.filename ?? "").toLowerCase();
        if (name.endsWith(".docx")) {
          text = docxToText(input.fileData);
        } else {
          text = Buffer.from(input.fileData).toString("utf8").trim();
        }
      }
      if (!text) throw new Error("沒有可用的文字內容——請貼上文字，或上傳 .docx／.txt 檔案");
      if (text.length > 200000) text = text.slice(0, 200000);
      const [{ id }] = await getDb().insert(referenceDocs).values({
        title: input.title,
        kind: input.kind,
        grantId: input.grantId,
        caseId: null,
        filename: input.filename,
        textContent: text,
        note: input.note.trim() || null,
      }).$returningId();
      return { id, textLength: text.length };
    }),

  remove: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await getDb().delete(referenceDocs).where(eq(referenceDocs.id, input.id));
    return { ok: true };
  }),
});

// ============================================================================
// 客戶自填問卷（分享連結）：不需登入，不可猜的 token 即存取權限
// ============================================================================
export const shareRouter = createRouter({
  // 依 token 取問卷（含既有答案，客戶可續填）
  getForm: publicQuery.input(z.object({ token: z.string().min(1) })).query(async ({ input }) => {
    const k = await getDb().query.cases.findFirst({ where: eq(cases.intakeToken, input.token) });
    if (!k) throw new Error("連結無效，請向您的提案顧問確認");
    const grant = await getDb().query.grantPrograms.findFirst({ where: eq(grantPrograms.id, k.grantId) });
    const client = await getDb().query.clients.findFirst({ where: eq(clients.id, k.clientId) });
    const chapterTitles: Record<string, string> = {};
    for (const c of k.chapters ?? []) chapterTitles[c.key] = c.title;
    return {
      caseTitle: k.title,
      grantName: grant?.name ?? "",
      agency: grant?.agency ?? "",
      clientName: client?.name ?? "",
      chapterTitles,
      questions: k.intakeQA ?? [],
      submittedAt: k.intakeSubmittedAt,
    };
  }),

  // 客戶送出答案（依題目 id 寫回，保留未送題目的原值）
  submit: publicQuery
    .input(z.object({
      token: z.string().min(1),
      answers: z.array(z.object({ id: z.string(), answer: z.string() })),
    }))
    .mutation(async ({ input }) => {
      const k = await getDb().query.cases.findFirst({ where: eq(cases.intakeToken, input.token) });
      if (!k) throw new Error("連結無效，請向您的提案顧問確認");
      const map = new Map(input.answers.map((a) => [a.id, a.answer]));
      const intakeQA = (k.intakeQA ?? []).map((q) =>
        map.has(q.id) ? { ...q, answer: map.get(q.id)! } : q,
      );
      await getDb().update(cases).set({
        intakeQA: intakeQA as never,
        intakeSubmittedAt: new Date(),
      }).where(eq(cases.id, k.id));
      return { ok: true };
    }),
});

// ============================================================================
// 補助雷達：收件匣 AI 解析＋自動掃描轉接器＋候選收錄
// ============================================================================
const RADAR_SOURCES = [{ key: "moc", label: "文化部獎補助資訊網", fn: scanMocSite }];

/** 執行所有掃描轉接器並入庫（endpoint 與排程共用；單源失敗不影響其他源） */
export async function runRadarScan() {
  const today = new Date().toISOString().slice(0, 10);
  const results: Array<{ source: string; label: string; found: number; added: number; error?: string }> = [];
  for (const ad of RADAR_SOURCES) {
    try {
      const items = await ad.fn();
      let added = 0;
      for (const it of items) {
        if (it.applyEnd && it.applyEnd < today) continue;
        const dup = await getDb().query.radarCandidates.findFirst({
          where: and(eq(radarCandidates.source, ad.key), eq(radarCandidates.title, it.title)),
        });
        if (dup) continue;
        await getDb().insert(radarCandidates).values({
          source: ad.key,
          title: it.title,
          agency: it.agency || null,
          url: it.url || null,
          applyStart: it.applyStart || null,
          applyEnd: it.applyEnd || null,
          amountNote: it.amountNote || null,
          rawText: null,
        });
        added++;
      }
      results.push({ source: ad.key, label: ad.label, found: items.length, added });
    } catch (e) {
      results.push({
        source: ad.key, label: ad.label, found: 0, added: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { results, at: new Date().toISOString() };
}

export const radarRouter = createRouter({
  list: publicQuery.query(async () => {
    return getDb().query.radarCandidates.findMany({
      orderBy: [desc(radarCandidates.id)],
      limit: 200,
    });
  }),

  // 收件匣：貼上公告或列表文字 → AI（或規則）解析 → 入候選區（自動略過已截止與重複）
  paste: publicQuery.input(z.object({ text: z.string().min(10) })).mutation(async ({ input }) => {
    const { items, usedAI } = await parseAnnouncements(input.text);
    const today = new Date().toISOString().slice(0, 10);
    let added = 0, skippedExpired = 0, skippedDup = 0;
    for (const it of items) {
      if (it.applyEnd && it.applyEnd < today) { skippedExpired++; continue; }
      const dup = await getDb().query.radarCandidates.findFirst({
        where: and(eq(radarCandidates.source, "paste"), eq(radarCandidates.title, it.title)),
      });
      if (dup) { skippedDup++; continue; }
      await getDb().insert(radarCandidates).values({
        source: "paste",
        title: it.title,
        agency: it.agency || null,
        url: it.url || null,
        applyStart: it.applyStart || null,
        applyEnd: it.applyEnd || null,
        amountNote: it.amountNote || null,
        rawText: input.text.slice(0, 4000),
      });
      added++;
    }
    return { added, skippedExpired, skippedDup, usedAI, parsed: items.length };
  }),

  // 立即掃描全部轉接器
  scan: publicQuery.mutation(async () => runRadarScan()),

  // 收錄：候選轉正式補助案（草稿；章節與評分標準之後用「公告解析」補齊）
  accept: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const c = await getDb().query.radarCandidates.findFirst({ where: eq(radarCandidates.id, input.id) });
    if (!c) throw new Error("候選不存在");
    const descParts = [
      c.amountNote ? `補助金額：${c.amountNote}` : "",
      c.url ? `公告來源：${c.url}` : "",
      "（由補助雷達收錄；請到編輯頁用「公告解析」補齊章節格式與評分標準）",
    ].filter(Boolean);
    const [{ id }] = await getDb().insert(grantPrograms).values({
      name: c.title,
      agency: c.agency || "待查證",
      category: "其他",
      description: descParts.join("\n"),
      applyStart: c.applyStart ? new Date(c.applyStart) : null,
      applyEnd: c.applyEnd ? new Date(c.applyEnd) : null,
      rolling: !c.applyEnd,
      deadlineNote: c.applyEnd ? "" : "時程待查證",
      orgTypes: [],
      eligibilityNote: "",
      chapterSchema: [],
      rubric: [],
      attachmentsNote: "",
      sourceUrl: c.url || "",
      status: c.applyStart && c.applyStart > new Date().toISOString().slice(0, 10) ? "upcoming" : "open",
      needsVerification: !c.applyEnd,
    }).$returningId();
    await getDb().update(radarCandidates).set({ status: "accepted" }).where(eq(radarCandidates.id, input.id));
    return { grantId: id };
  }),

  dismiss: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await getDb().update(radarCandidates).set({ status: "dismissed" }).where(eq(radarCandidates.id, input.id));
    return { ok: true };
  }),
});

export const metaRouter = createRouter({
  status: publicQuery.query(async () => {
    const db = getDb();
    const gs = await db.query.grantPrograms.findMany();
    const cs = await db.query.clients.findMany();
    const ks = await db.query.cases.findMany();
    const now = Date.now();
    const soon = gs.filter((g) => !g.rolling && g.applyEnd && new Date(g.applyEnd).getTime() >= now && new Date(g.applyEnd).getTime() <= now + 30 * 86400000).length;
    return {
      llm: llmStatus(),
      grantCount: gs.length,
      rollingCount: gs.filter((g) => g.rolling).length,
      closingIn30: soon,
      clientCount: cs.length,
      activeCases: ks.filter((k) => k.status !== "done").length,
      doneCases: ks.filter((k) => k.status === "done").length,
    };
  }),
});
