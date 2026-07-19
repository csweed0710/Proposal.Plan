// 參考資料引擎測試：挑選邏輯、提示組裝、docx 文字抽取
import { describe, it, expect } from "vitest";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { pickRefs, refsPrompt, docxToText } from "./reference";

const doc = (patch: Record<string, unknown>) => ({
  title: "文件", kind: "example", grantId: 1, textContent: "內容", note: null, ...patch,
});

describe("pickRefs：依補助案與類型挑選", () => {
  const all = [
    doc({ title: "SBIR 得標範本", kind: "example", grantId: 1 }),
    doc({ title: "通用範本", kind: "example", grantId: null }),
    doc({ title: "別案範本", kind: "example", grantId: 2 }),
    doc({ title: "委員意見", kind: "feedback", grantId: 1 }),
    doc({ title: "產業數據", kind: "data", grantId: null }),
  ];

  it("同案＋通用入選，他案排除", () => {
    const picked = pickRefs(all as never, 1, ["example"]);
    expect(picked.map((d) => d.title)).toEqual(["SBIR 得標範本", "通用範本"]);
  });

  it("類型過濾", () => {
    const picked = pickRefs(all as never, 1, ["feedback", "data"]);
    expect(picked.map((d) => d.title)).toEqual(["委員意見", "產業數據"]);
  });
});

describe("refsPrompt：依類型限量裁切並加標籤", () => {
  it("範本最多 2 份、每份 1800 字；意見與數據各有標籤", () => {
    const refs = [
      doc({ title: "A", kind: "example", textContent: "甲".repeat(3000) }),
      doc({ title: "B", kind: "example", textContent: "乙".repeat(100) }),
      doc({ title: "C", kind: "example", textContent: "丙".repeat(100) }), // 超過 maxDocs=2 應被捨棄
      doc({ title: "D", kind: "feedback", textContent: "委員說預算不合理" }),
      doc({ title: "E", kind: "data", textContent: "2025 年市場規模 50 億" }),
    ];
    const { text, used } = refsPrompt(refs as never);
    expect(used).toBe(4); // A、B、D、E（C 被裁掉）
    expect(text).toContain("得標範本風格參考");
    expect(text).toContain("過去委員審查意見");
    expect(text).toContain("可引用的數據與文獻素材");
    expect(text).not.toContain("〈C〉");
    expect(text).toContain("委員說預算不合理");
    // A 被裁到 1800 字
    const aBlock = text.split("〈A〉")[1].split("〈B〉")[0];
    expect(aBlock.replace(/\n/g, "").length).toBeLessThanOrEqual(1810);
  });

  it("空內容文件不計入", () => {
    const { text, used } = refsPrompt([doc({ textContent: "  " })] as never);
    expect(used).toBe(0);
    expect(text).toBe("");
  });
});

describe("docxToText：從 .docx 抽出純文字", () => {
  it("段落變換行、內容完整", async () => {
    const d = new Document({
      sections: [{
        children: [
          new Paragraph({ children: [new TextRun("第一段：計畫緣起")] }),
          new Paragraph({ children: [new TextRun("第二段：預算 100 萬元")] }),
        ],
      }],
    });
    const buf = await Packer.toBuffer(d);
    const text = docxToText(new Uint8Array(buf));
    expect(text).toContain("第一段：計畫緣起");
    expect(text).toContain("第二段：預算 100 萬元");
    expect(text.indexOf("第一段")).toBeLessThan(text.indexOf("第二段"));
  });
});
