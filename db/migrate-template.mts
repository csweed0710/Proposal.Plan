import { getDb } from "/mnt/agents/output/app/api/queries/connection";
import { sql } from "drizzle-orm";
async function main() {
  const db = getDb();
  const cols = await db.execute(sql`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_NAME='grant_programs' AND COLUMN_NAME IN ('template_name','template_data')`);
  const existing = new Set((cols[0] as unknown as { COLUMN_NAME: string }[]).map(r => r.COLUMN_NAME));
  if (!existing.has("template_name")) {
    await db.execute(sql`ALTER TABLE grant_programs ADD COLUMN template_name varchar(255) NULL`);
    console.log("added template_name");
  }
  if (!existing.has("template_data")) {
    await db.execute(sql`ALTER TABLE grant_programs ADD COLUMN template_data mediumtext NULL`);
    console.log("added template_data");
  }
  console.log("done"); process.exit(0);
}
main();
