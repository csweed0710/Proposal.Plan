import {
  mysqlTable,
  serial,
  bigint,
  varchar,
  text,
  json,
  int,
  boolean,
  timestamp,
  date,
  mediumtext,
} from "drizzle-orm/mysql-core";
import type {
  ChapterSpec,
  RubricItem,
  IntakeQuestion,
  CaseChapter,
  ReviewDimension,
  ReviewIssue,
} from "../contracts/types";
import type { ChapterTable } from "../contracts/tables";

// ============================================================================
// 補助案：官方章節格式與評分標準以 JSON 存放 — 逐案不同、隨時可改，不寫死
// ============================================================================
export const grantPrograms = mysqlTable("grant_programs", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  agency: varchar("agency", { length: 255 }).notNull(),
  category: varchar("category", { length: 64 }).notNull().default("其他"),
  description: text("description"),
  applyStart: date("apply_start"),
  applyEnd: date("apply_end"),
  rolling: boolean("rolling").notNull().default(false), // 常年受理
  deadlineNote: varchar("deadline_note", { length: 255 }), // 時程備註
  amountMin: int("amount_min"),
  amountMax: int("amount_max"),
  selfFundNote: varchar("self_fund_note", { length: 255 }), // 自籌款規定
  orgTypes: json("org_types").$type<string[]>().notNull(), // 適用組織型態
  eligibilityNote: text("eligibility_note"), // 資格條件
  chapterSchema: json("chapter_schema").$type<ChapterSpec[]>().notNull(), // 官方章節格式
  rubric: json("rubric").$type<RubricItem[]>().notNull(), // 官方評分標準
  attachmentsNote: text("attachments_note"), // 應備文件
  sourceUrl: varchar("source_url", { length: 512 }),
  status: varchar("status", { length: 32 }).notNull().default("open"), // open / upcoming / closed
  needsVerification: boolean("needs_verification").notNull().default(false), // 時程待查證
  templateName: varchar("template_name", { length: 255 }), // 官方範本檔名
  templateData: mediumtext("template_data"), // 官方範本 .docx（base64 存放）
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

// ============================================================================
// 客戶：永久記憶 — 基本資料、實績、能量、標籤，下一案自動帶入
// ============================================================================
export const clients = mysqlTable("clients", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  orgType: varchar("org_type", { length: 64 }).notNull().default("公司"),
  taxId: varchar("tax_id", { length: 64 }),
  foundedYear: int("founded_year"),
  city: varchar("city", { length: 64 }),
  employeesFull: int("employees_full"),
  employeesPart: int("employees_part"),
  capital: int("capital"), // 資本額（元）
  revenueAvg: int("revenue_avg"), // 年均營業額（元）
  contactName: varchar("contact_name", { length: 128 }),
  contactTitle: varchar("contact_title", { length: 128 }),
  contactPhone: varchar("contact_phone", { length: 64 }),
  contactEmail: varchar("contact_email", { length: 255 }),
  strengths: text("strengths"), // 優勢與特色
  pastProjects: json("past_projects").$type<
    { name: string; year: string; budget: string; outcome: string }[]
  >(),
  adminCapability: text("admin_capability"), // 行政與核銷能量
  financialNote: text("financial_note"),
  tags: json("tags").$type<string[]>().notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

// ============================================================================
// 案件：客戶 × 補助案。章節與評分標準在此快照，之後補助案修改不影響案件
// ============================================================================
export const cases = mysqlTable("cases", {
  id: serial("id").primaryKey(),
  clientId: bigint("client_id", { mode: "number", unsigned: true }).notNull(),
  grantId: bigint("grant_id", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("intake"),
  targetScore: int("target_score").notNull().default(85),
  currentScore: int("current_score"),
  reviewRound: int("review_round").notNull().default(0),
  intakeQA: json("intake_qa").$type<IntakeQuestion[]>().notNull(),
  chapters: json("chapters").$type<CaseChapter[]>().notNull(),
  rubricSnapshot: json("rubric_snapshot").$type<RubricItem[]>().notNull(),
  // ---- 送件追蹤（接案實戰）----
  submittedAt: timestamp("submitted_at"),       // 送件日期
  resultAmount: int("result_amount"),           // 得標／核定金額（未通過則留空）
  reviewFeedback: text("review_feedback"),      // 委員審查意見（下次投同案的秘密武器）
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

// ============================================================================
// 章節版本歷史：每次儲存/AI 起草/修改迴圈前快照，可回看可還原
// ============================================================================
export const chapterVersions = mysqlTable("chapter_versions", {
  id: serial("id").primaryKey(),
  caseId: bigint("case_id", { mode: "number", unsigned: true }).notNull(),
  chapterKey: varchar("chapter_key", { length: 64 }).notNull(),
  content: text("content"),
  tableJson: json("table_json").$type<ChapterTable>(),
  source: varchar("source", { length: 32 }).notNull().default("手動編輯"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============================================================================
// 審核紀錄：每一輪審核都留痕，形成迭代歷史
// ============================================================================
export const reviews = mysqlTable("reviews", {
  id: serial("id").primaryKey(),
  caseId: bigint("case_id", { mode: "number", unsigned: true }).notNull(),
  round: int("round").notNull(),
  totalScore: int("total_score").notNull(),
  dimensions: json("dimensions").$type<ReviewDimension[]>().notNull(),
  issues: json("issues").$type<ReviewIssue[]>().notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type GrantProgram = typeof grantPrograms.$inferSelect;
export type InsertGrantProgram = typeof grantPrograms.$inferInsert;
export type Client = typeof clients.$inferSelect;
export type InsertClient = typeof clients.$inferInsert;
export type Case = typeof cases.$inferSelect;
export type InsertCase = typeof cases.$inferInsert;
export type Review = typeof reviews.$inferSelect;
export type InsertReview = typeof reviews.$inferInsert;
export type ChapterVersion = typeof chapterVersions.$inferSelect;
