// 手動增量遷移（純 JS，Railway Console 可直接 node 執行）：
// ① reviews 加 ai_summary（LLM 總評）② radar_candidates 補助雷達候選表
// 執行：node db/migrate-radar.mjs
import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) { console.error("缺少 DATABASE_URL 環境變數"); process.exit(1); }
const conn = await mysql.createConnection(url);

const [cols] = await conn.query(
  `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reviews' AND COLUMN_NAME = 'ai_summary'`,
);
if (cols[0].c > 0) {
  console.log("reviews.ai_summary 已存在，跳過");
} else {
  await conn.query(`ALTER TABLE reviews ADD COLUMN ai_summary TEXT NULL`);
  console.log("reviews.ai_summary 已新增");
}

const [tbls] = await conn.query(
  `SELECT COUNT(*) AS c FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'radar_candidates'`,
);
if (tbls[0].c > 0) {
  console.log("radar_candidates 已存在，跳過");
} else {
  await conn.query(`
    CREATE TABLE radar_candidates (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      source VARCHAR(50) NOT NULL,
      title VARCHAR(300) NOT NULL,
      agency VARCHAR(120) NULL,
      url VARCHAR(500) NULL,
      apply_start VARCHAR(40) NULL,
      apply_end VARCHAR(40) NULL,
      amount_note VARCHAR(200) NULL,
      raw_text TEXT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'new',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("radar_candidates 已建立");
}

await conn.end();
console.log("遷移完成");
