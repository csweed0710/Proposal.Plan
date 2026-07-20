// PDF 轉檔：用容器內的 LibreOffice headless 把 docx 轉成 PDF（版型、表格、中文字型完整保留）
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execFileP = promisify(execFile);

export async function docxToPdf(docx: Uint8Array): Promise<Uint8Array> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-"));
  try {
    const input = path.join(dir, "input.docx");
    await fs.writeFile(input, Buffer.from(docx));
    // 每次轉檔用獨立 profile 目錄，避免 LibreOffice profile 鎖定與併發衝突
    await execFileP(
      "soffice",
      [
        "--headless",
        "--norestore",
        `-env:UserInstallation=file://${dir}/lo-profile`,
        "--convert-to", "pdf",
        "--outdir", dir,
        input,
      ],
      { timeout: 120000 },
    );
    const pdf = await fs.readFile(path.join(dir, "input.pdf"));
    return new Uint8Array(pdf);
  } catch {
    throw new Error("PDF 轉檔失敗——伺服器的 LibreOffice 尚未就緒（部署新版映像後即可使用）");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
