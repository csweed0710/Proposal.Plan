// 手動增量遷移（純 JS，Railway Console 可直接 node 執行，不需 tsx）
// 執行：node db/migrate-pipeline.mjs
import "dotenv/config";
import mysql from "mysql2/promise";

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

async function tableExists(table) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  );
  return rows[0].c > 0;
}

// 1. cases 新增送件追蹤欄位
const cols = [
  ["submitted_at", "TIMESTAMP NULL"],
  ["result_amount", "INT NULL"],
  ["review_feedback", "TEXT NULL"],
];
for (const [col, def] of cols) {
  if (await columnExists("cases", col)) {
    console.log(`cases.${col} 已存在，跳過`);
  } else {
    await conn.query(`ALTER TABLE cases ADD COLUMN ${col} ${def}`);
    console.log(`cases.${col} 已新增`);
  }
}

// 2. chapter_versions 版本歷史表
if (await tableExists("chapter_versions")) {
  console.log("chapter_versions 已存在，跳過");
} else {
  await conn.query(`
    CREATE TABLE chapter_versions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      case_id BIGINT UNSIGNED NOT NULL,
      chapter_key VARCHAR(64) NOT NULL,
      content TEXT,
      table_json JSON,
      source VARCHAR(32) NOT NULL DEFAULT '手動編輯',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("chapter_versions 已建立");
}

await conn.end();
console.log("遷移完成");
