// 功能路由：補助案、客戶、適配、案件、問卷、寫作、審核、修改迴圈
import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { grantPrograms, clients, cases, reviews, chapterVersions } from "@db/schema";
import { matchAll } from "./engines/matching";
import { generateIntake } from "./engines/intake";
import { draftChapter } from "./engines/writer";
import { runReview } from "./engines/review";
import { applyRevision } from "./engines/revise";
import { chat, llmStatus } from "./llm";
import { exportCase } from "./engines/exporter";
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
      const { content, usedAI } = await draftChapter(ch, k.intakeQA ?? [], client, grant, k.rubricSnapshot ?? []);
      const chapters = (k.chapters ?? []).map((c) =>
        c.key === input.chapterKey ? { ...c, content, status: "draft" as const } : c,
      );
      await snapshotChapters(input.id, k.chapters ?? [], chapters, "AI 起草");
      await getDb().update(cases).set({ chapters, status: "draft" }).where(eq(cases.id, input.id));
      return { content, usedAI };
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
      await getDb().update(cases).set({
        status: input.status,
        submittedAt: input.submittedAt ? new Date(input.submittedAt) : null,
        resultAmount: input.resultAmount,
        reviewFeedback: input.reviewFeedback.trim() || null,
      }).where(eq(cases.id, input.id));
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

  remove: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await getDb().delete(reviews).where(eq(reviews.caseId, input.id));
    await getDb().delete(cases).where(eq(cases.id, input.id));
    return { ok: true };
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
    await getDb().insert(reviews).values({
      caseId: input.caseId,
      round,
      totalScore: out.totalScore,
      dimensions: out.dimensions,
      issues: out.issues,
    });
    await getDb().update(cases).set({
      currentScore: out.totalScore,
      reviewRound: round,
      status: out.totalScore >= k.targetScore ? "done" : "reviewing",
    }).where(eq(cases.id, input.caseId));
    return { ...out, round, targetScore: k.targetScore, passed: out.totalScore >= k.targetScore };
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
    const rev = await applyRevision(k.chapters ?? [], latest.issues ?? [], chapterAnswers);
    await snapshotChapters(input.caseId, k.chapters ?? [], rev.chapters, "修改迴圈");
    await getDb().update(cases).set({ chapters: rev.chapters }).where(eq(cases.id, input.caseId));

    const round = k.reviewRound + 1;
    const out = runReview(rev.chapters, k.rubricSnapshot ?? [], round);
    await getDb().insert(reviews).values({
      caseId: input.caseId,
      round,
      totalScore: out.totalScore,
      dimensions: out.dimensions,
      issues: out.issues,
      note: rev.changeLog.join("\n"),
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
    };
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
