// 手動增量遷移（純 JS，Railway Console 可直接 node 執行）：參考資料庫表
// 執行：node db/migrate-references.mjs
import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) { console.error("缺少 DATABASE_URL 環境變數"); process.exit(1); }
const conn = await mysql.createConnection(url);

const [rows] = await conn.query(
  `SELECT COUNT(*) AS c FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reference_docs'`,
);
if (rows[0].c > 0) {
  console.log("reference_docs 已存在，跳過");
} else {
  await conn.query(`
    CREATE TABLE reference_docs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      kind VARCHAR(20) NOT NULL,
      grant_id BIGINT UNSIGNED NULL,
      case_id BIGINT UNSIGNED NULL,
      filename VARCHAR(200) NULL,
      text_content MEDIUMTEXT NULL,
      note TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("reference_docs 已建立");
}

await conn.end();
console.log("遷移完成");
