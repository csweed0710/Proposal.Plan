// 手動增量遷移（純 JS，Railway Console 可直接 node 執行）：客戶自填問卷分享連結
// ① cases 加 intake_token / intake_submitted_at
// ② 既有案件補發專屬 token
// 執行：node db/migrate-share.mjs
import "dotenv/config";
import mysql from "mysql2/promise";
import crypto from "node:crypto";

const url = process.env.DATABASE_URL;
if (!url) { console.error("缺少 DATABASE_URL 環境變數"); process.exit(1); }
const conn = await mysql.createConnection(url);

async function columnExists(table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return rows[0].c > 0;
}

for (const [col, def] of [
  ["intake_token", "VARCHAR(64) NULL"],
  ["intake_submitted_at", "TIMESTAMP NULL"],
]) {
  if (await columnExists("cases", col)) {
    console.log(`cases.${col} 已存在，跳過`);
  } else {
    await conn.query(`ALTER TABLE cases ADD COLUMN ${col} ${def}`);
    console.log(`cases.${col} 已新增`);
  }
}

// 既有案件補發 token（已有的不動，可重複執行）
const [rows] = await conn.query(`SELECT id FROM cases WHERE intake_token IS NULL`);
for (const r of rows) {
  await conn.query(`UPDATE cases SET intake_token = ? WHERE id = ?`, [crypto.randomBytes(24).toString("hex"), r.id]);
}
console.log(rows.length ? `已為 ${rows.length} 件既有案件補發 token` : "所有案件皆已有 token");

await conn.end();
console.log("遷移完成");
