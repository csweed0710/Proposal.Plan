// 回填遷移（純 JS，Railway Console 可直接 node 執行）：
// ① 為既有補助案章節格式補上 tableType（預算表／進度表／KPI 表標記）
// ② 同步到既有案件的章節
// ③ 示範案件的表格章節若還是空的，補上示範表格（開箱即見新功能）
// 只補「尚未設定」的資料，可重複執行。執行：node db/migrate-table-types.mjs
import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) { console.error("缺少 DATABASE_URL 環境變數"); process.exit(1); }
const conn = await mysql.createConnection(url);

// 依補助案名稱決定各章節的表格型別（種子案精準對應；其他案件保守處理）
function tableTypeMapFor(grantName) {
  if (grantName.includes("小型企業創新研發計畫")) {
    return { method: "schedule", benefit: "kpi", budget: "budget" };
  }
  if (grantName.includes("文化部獎補助") || grantName.includes("地方創生")) {
    return { goal: "kpi", schedule: "schedule", budget: "budget" };
  }
  if (grantName.includes("表演藝術類補助") || grantName.includes("視覺藝術類活動補助")) {
    return { schedule: "schedule", budget: "budget", benefit: "kpi" };
  }
  // 使用者自建的補助案：只對最常見的 key 保守標記
  return { budget: "budget", schedule: "schedule" };
}

function patchChapters(chapters, map) {
  let changed = 0;
  const next = chapters.map((c) => {
    const t = map[c.key];
    if (t && !c.tableType) { changed++; return { ...c, tableType: t }; }
    return c;
  });
  return { next, changed };
}

// 示範表格（與 db/seed.ts 的示範案件一致）
const DEMO_TABLES = {
  goal: {
    type: "kpi",
    kpi: { rows: [
      { id: "k1", indicator: "服務獨居長者人數", target: "150 人（目前 0 人）", basis: "服務簽到紀錄" },
      { id: "k2", indicator: "藝術陪伴活動場次", target: "48 場（目前 0 場）", basis: "活動紀錄表＋照片" },
      { id: "k3", indicator: "培訓陪伴志工人數", target: "30 人（目前 12 人）", basis: "培訓簽到與檢核表" },
      { id: "k4", indicator: "長者孤獨感量表（UCLA）改善", target: "前後測平均下降 20%", basis: "期初期末量表施測" },
    ] },
  },
  schedule: {
    type: "schedule",
    schedule: { months: 12, rows: [
      { id: "s1", task: "志工招募與培訓", startMonth: 1, endMonth: 3, checkpoint: "30 名志工完成 18 小時培訓" },
      { id: "s2", task: "個案訪視與媒合", startMonth: 2, endMonth: 4, checkpoint: "完成 150 位長者需求評估" },
      { id: "s3", task: "藝術陪伴活動執行", startMonth: 3, endMonth: 11, checkpoint: "每月 4–5 場，累計 48 場" },
      { id: "s4", task: "期中評估與修正", startMonth: 6, endMonth: 6, checkpoint: "期中報告＋孤獨感量表前測" },
      { id: "s5", task: "成果展覽與結案", startMonth: 11, endMonth: 12, checkpoint: "成果展 1 場、結案報告送部" },
    ] },
  },
  budget: {
    type: "budget",
    budget: { rows: [
      { id: "b1", item: "講師鐘點費", detail: "藝術陪伴帶領講師，每場 2 小時", unit: "場", qty: 48, unitPrice: 3200, grantShare: 153600, selfShare: 0, note: "依文化部講師費標準 1,600 元/時" },
      { id: "b2", item: "材料費", detail: "每場創作材料（畫材、輕黏土等）", unit: "場", qty: 48, unitPrice: 800, grantShare: 38400, selfShare: 0, note: "每場 25 人份估算" },
      { id: "b3", item: "志工培訓費", detail: "培訓課程講師與場地", unit: "梯次", qty: 3, unitPrice: 12000, grantShare: 24000, selfShare: 12000, note: "每梯次 6 小時" },
      { id: "b4", item: "交通費", detail: "偏里服務交通補貼", unit: "人次", qty: 96, unitPrice: 300, grantShare: 14400, selfShare: 14400, note: "台鐵・客運實報實銷" },
      { id: "b5", item: "成果展覽", detail: "期末社區成果展佈展與印刷", unit: "場", qty: 1, unitPrice: 30000, grantShare: 15000, selfShare: 15000, note: "結合里民活動中心" },
      { id: "b6", item: "行政費", detail: "專案管理與核銷行政", unit: "式", qty: 1, unitPrice: 60000, grantShare: 20000, selfShare: 40000, note: "不超過總經費 10%" },
    ] },
  },
};

// ① 補助案章節格式
const [grantRows] = await conn.query(`SELECT id, name, chapter_schema FROM grant_programs`);
const grantMaps = new Map();
for (const g of grantRows) {
  const schema = typeof g.chapter_schema === "string" ? JSON.parse(g.chapter_schema) : (g.chapter_schema ?? []);
  if (!schema.length) continue;
  const map = tableTypeMapFor(g.name);
  grantMaps.set(g.id, map);
  const { next, changed } = patchChapters(schema, map);
  if (changed > 0) {
    await conn.query(`UPDATE grant_programs SET chapter_schema = ? WHERE id = ?`, [JSON.stringify(next), g.id]);
    console.log(`補助案 #${g.id}「${g.name}」：${changed} 章補上 tableType`);
  } else {
    console.log(`補助案 #${g.id}「${g.name}」：無需更動`);
  }
}

// ② 既有案件章節（跟著所屬補助案走；只補沒設過的）
const [caseRows] = await conn.query(`SELECT id, title, grant_id, chapters FROM cases`);
for (const k of caseRows) {
  const chapters = typeof k.chapters === "string" ? JSON.parse(k.chapters) : (k.chapters ?? []);
  if (!chapters.length) continue;
  const map = grantMaps.get(k.grant_id) ?? { budget: "budget", schedule: "schedule" };
  const { next, changed } = patchChapters(chapters, map);
  // ③ 示範案件：表格章節仍空白者，補上示範表格
  let demoAdded = 0;
  const isDemo = (k.title ?? "").includes("示範案件");
  const final = next.map((c) => {
    if (isDemo && !c.table && DEMO_TABLES[c.key]) { demoAdded++; return { ...c, table: DEMO_TABLES[c.key], status: "draft" }; }
    return c;
  });
  if (changed > 0 || demoAdded > 0) {
    await conn.query(`UPDATE cases SET chapters = ? WHERE id = ?`, [JSON.stringify(final), k.id]);
    console.log(`案件 #${k.id}：${changed} 章補上 tableType${demoAdded ? `，${demoAdded} 章補上示範表格` : ""}`);
  } else {
    console.log(`案件 #${k.id}：無需更動`);
  }
}

await conn.end();
console.log("tableType 回填完成");
