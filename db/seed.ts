// 種子資料：真實存在的常態型補助案（時程以當年度公告為準，系統內可隨時改）
// 來源：SBIR 官網（sbir.org.tw，隨到隨受理）、文化部獎補助資訊網（grants.moc.gov.tw）、
// 高雄市政府文化局（每年 2/6/10 月梯次）、臺中市政府文化局（每年 3/9 月梯次）
import { getDb } from "../api/queries/connection";
import { grantPrograms, clients, cases } from "./schema";
import { generateIntake } from "../api/engines/intake";
import type { ChapterSpec, ChapterTable, RubricItem } from "../contracts/types";

// 示範案件的結構化表格內容（對應 MOC 章節：goal=kpi、schedule=schedule、budget=budget）
const DEMO_KPI: ChapterTable = {
  type: "kpi",
  kpi: {
    rows: [
      { id: "k1", indicator: "服務獨居長者人數", target: "150 人（目前 0 人）", basis: "服務簽到紀錄" },
      { id: "k2", indicator: "藝術陪伴活動場次", target: "48 場（目前 0 場）", basis: "活動紀錄表＋照片" },
      { id: "k3", indicator: "培訓陪伴志工人數", target: "30 人（目前 12 人）", basis: "培訓簽到與檢核表" },
      { id: "k4", indicator: "長者孤獨感量表（UCLA）改善", target: "前後測平均下降 20%", basis: "期初期末量表施測" },
    ],
  },
};

const DEMO_SCHEDULE: ChapterTable = {
  type: "schedule",
  schedule: {
    months: 12,
    rows: [
      { id: "s1", task: "志工招募與培訓", startMonth: 1, endMonth: 3, checkpoint: "30 名志工完成 18 小時培訓" },
      { id: "s2", task: "個案訪視與媒合", startMonth: 2, endMonth: 4, checkpoint: "完成 150 位長者需求評估" },
      { id: "s3", task: "藝術陪伴活動執行", startMonth: 3, endMonth: 11, checkpoint: "每月 4–5 場，累計 48 場" },
      { id: "s4", task: "期中評估與修正", startMonth: 6, endMonth: 6, checkpoint: "期中報告＋孤獨感量表前測" },
      { id: "s5", task: "成果展覽與結案", startMonth: 11, endMonth: 12, checkpoint: "成果展 1 場、結案報告送部" },
    ],
  },
};

const DEMO_BUDGET: ChapterTable = {
  type: "budget",
  budget: {
    rows: [
      { id: "b1", item: "講師鐘點費", detail: "藝術陪伴帶領講師，每場 2 小時", unit: "場", qty: 48, unitPrice: 3200, grantShare: 153600, selfShare: 0, note: "依文化部講師費標準 1,600 元/時" },
      { id: "b2", item: "材料費", detail: "每場創作材料（畫材、輕黏土等）", unit: "場", qty: 48, unitPrice: 800, grantShare: 38400, selfShare: 0, note: "每場 25 人份估算" },
      { id: "b3", item: "志工培訓費", detail: "培訓課程講師與場地", unit: "梯次", qty: 3, unitPrice: 12000, grantShare: 24000, selfShare: 12000, note: "每梯次 6 小時" },
      { id: "b4", item: "交通費", detail: "偏里服務交通補貼", unit: "人次", qty: 96, unitPrice: 300, grantShare: 14400, selfShare: 14400, note: "台鐵・客運實報實銷" },
      { id: "b5", item: "成果展覽", detail: "期末社區成果展佈展與印刷", unit: "場", qty: 1, unitPrice: 30000, grantShare: 15000, selfShare: 15000, note: "結合里民活動中心" },
      { id: "b6", item: "行政費", detail: "專案管理與核銷行政", unit: "式", qty: 1, unitPrice: 60000, grantShare: 20000, selfShare: 40000, note: "不超過總經費 10%" },
    ],
  },
};

const DEMO_TABLES: Record<string, ChapterTable> = {
  goal: DEMO_KPI,
  schedule: DEMO_SCHEDULE,
  budget: DEMO_BUDGET,
};

const SBIR_CHAPTERS: ChapterSpec[] = [
  { key: "summary", title: "計畫摘要", required: true, guidance: "一句話願景＋三個量化亮點，全書完成後最後寫", weight: 5 },
  { key: "company", title: "公司概況與團隊", required: true, guidance: "核心成員資歷對應分工，研發能量具體化", weight: 3 },
  { key: "background", title: "計畫緣起與問題分析", required: true, guidance: "產業痛點＋數據佐證，說明為什麼是現在", weight: 4 },
  { key: "innovation", title: "創新內容與核心技術", required: true, guidance: "與現有做法的差異、創新點、技術或服務可行性", weight: 5 },
  { key: "method", title: "執行方法與時程", required: true, guidance: "工作項目分解、查核點、甘特圖概念", weight: 4, tableType: "schedule" },
  { key: "benefit", title: "預期效益與量化指標", required: true, guidance: "基期值與目標值並陳，連結產值與就業", weight: 4, tableType: "kpi" },
  { key: "budget", title: "經費預算", required: true, guidance: "科目對應工作項目，自籌款展現承諾（補助款≤總經費50%）", weight: 4, tableType: "budget" },
  { key: "risk", title: "風險與應變", required: false, guidance: "真實風險＋具體應變，不寫空泛項目", weight: 2 },
];

const SBIR_RUBRIC: RubricItem[] = [
  { item: "創新性", points: 30, description: "技術或服務模式與現有做法的差異與突破" },
  { item: "可行性", points: 25, description: "執行方法、時程與資源配置是否合理可達成" },
  { item: "預期效益", points: 20, description: "量化產值、就業、市場影響" },
  { item: "團隊能量", points: 15, description: "核心成員資歷與執行經驗" },
  { item: "經費合理性", points: 10, description: "科目編列與單價是否合理" },
];

const MOC_CHAPTERS: ChapterSpec[] = [
  { key: "summary", title: "計畫摘要", required: true, guidance: "計畫亮點與公共價值一頁看懂", weight: 5 },
  { key: "background", title: "計畫緣起", required: true, guidance: "議題脈絡與參與動機", weight: 4 },
  { key: "analysis", title: "現況分析", required: true, guidance: "場域、對象、既有資源盤點", weight: 3 },
  { key: "goal", title: "計畫目標", required: true, guidance: "總目標＋分項目標＋量化指標", weight: 4, tableType: "kpi" },
  { key: "method", title: "執行內容與方法", required: true, guidance: "工作項目、方法、創新之處", weight: 5 },
  { key: "schedule", title: "執行進度", required: true, guidance: "期程與查核點", weight: 3, tableType: "schedule" },
  { key: "team", title: "組織與人力", required: true, guidance: "分工與專業背景", weight: 3 },
  { key: "track", title: "過去實績", required: true, guidance: "近三年相關成果數據", weight: 4 },
  { key: "budget", title: "經費預算", required: true, guidance: "科目對應工作項目", weight: 4, tableType: "budget" },
  { key: "benefit", title: "預期效益", required: true, guidance: "量化與質化效益、受益對象", weight: 4 },
  { key: "sustain", title: "永續與推廣", required: true, guidance: "結案後的延續與擴散", weight: 3 },
];

const MOC_RUBRIC: RubricItem[] = [
  { item: "主題性與公共性", points: 25, description: "議題價值與公共性" },
  { item: "內容可行性", points: 30, description: "方法、時程、資源是否可行" },
  { item: "執行能量", points: 20, description: "團隊與過往實績" },
  { item: "預期效益", points: 15, description: "效益具體可衡量" },
  { item: "預算合理性", points: 10, description: "編列合理、自籌展現承諾" },
];

const CSR_CHAPTERS: ChapterSpec[] = [
  { key: "summary", title: "計畫摘要", required: true, guidance: "地方價值主張一句話", weight: 5 },
  { key: "dna", title: "地方現況與 DNA 分析", required: true, guidance: "在地資源、人口、產業盤點", weight: 4 },
  { key: "problem", title: "問題與機會", required: true, guidance: "地方痛點與切入機會", weight: 4 },
  { key: "goal", title: "計畫目標", required: true, guidance: "量化目標與查核指標", weight: 4, tableType: "kpi" },
  { key: "model", title: "事業構想與商業模式", required: true, guidance: "收入從哪來、如何自償", weight: 5 },
  { key: "method", title: "執行策略", required: true, guidance: "工作項目與方法", weight: 4 },
  { key: "schedule", title: "時程與查核", required: true, guidance: "里程碑與查核點", weight: 3, tableType: "schedule" },
  { key: "team", title: "團隊與合作夥伴", required: true, guidance: "在地連結與外部夥伴", weight: 3 },
  { key: "budget", title: "經費預算", required: true, guidance: "科目對應與自籌", weight: 4, tableType: "budget" },
  { key: "sustain", title: "預期效益與永續", required: true, guidance: "就業、人口回流、模式複製", weight: 4 },
];

const CSR_RUBRIC: RubricItem[] = [
  { item: "地方連結", points: 25, description: "與在地資源和需求的連結深度" },
  { item: "商業模式可行性", points: 30, description: "自償性與營運模式" },
  { item: "創新性", points: 15, description: "模式創新" },
  { item: "團隊", points: 15, description: "執行團隊與夥伴" },
  { item: "永續性", points: 15, description: "補助結束後的延續能力" },
];

const ART_CHAPTERS: ChapterSpec[] = [
  { key: "summary", title: "計畫摘要", required: true, guidance: "演出亮點一頁", weight: 4 },
  { key: "team", title: "團隊介紹與實績", required: true, guidance: "主要創作者與近年演出紀錄", weight: 4 },
  { key: "content", title: "演出內容與藝術理念", required: true, guidance: "作品概念、形式、曲目或橋段", weight: 5 },
  { key: "method", title: "執行方式與場地", required: true, guidance: "場次、場地、技術需求", weight: 4 },
  { key: "marketing", title: "行銷與觀眾開發", required: true, guidance: "目標觀眾與推廣管道", weight: 3 },
  { key: "schedule", title: "時程", required: true, guidance: "排練與演出期程", weight: 3, tableType: "schedule" },
  { key: "budget", title: "經費預算", required: true, guidance: "科目對應場次", weight: 4, tableType: "budget" },
  { key: "benefit", title: "預期效益", required: true, guidance: "觀眾人次與藝文影響", weight: 3, tableType: "kpi" },
];

const ART_RUBRIC: RubricItem[] = [
  { item: "藝術性", points: 30, description: "作品藝術價值與完整性" },
  { item: "可行性", points: 25, description: "執行與場地安排" },
  { item: "觀眾開發", points: 15, description: "推廣與觀眾經營" },
  { item: "團隊實績", points: 20, description: "過往演出成果" },
  { item: "預算合理性", points: 10, description: "編列合理" },
];

async function seed() {
  const db = getDb();
  console.log("Seeding database...");

  const existing = await db.query.grantPrograms.findMany();
  if (existing.length > 0) {
    console.log("已有資料，跳過 seed。");
    process.exit(0);
  }

  const grantRows = [
    {
      name: "小型企業創新研發計畫（SBIR）Phase 1 先期研究",
      agency: "經濟部中小及新創企業署",
      category: "創新研發",
      description: "補助中小企業投入創新研發，Phase 1 以簡報格式申請，補助上限 150 萬元／6 個月。採隨到隨受理。",
      applyStart: null, applyEnd: null, rolling: true,
      deadlineNote: "隨到隨受理，備齊文件線上申請即為正式收件日",
      amountMin: null, amountMax: 1500000,
      selfFundNote: "補助款不得超過計畫總經費 50%",
      orgTypes: ["公司", "獨資合夥"],
      eligibilityNote: "實收資本額一億元以下，或經常僱用員工數未滿二百人；不得有陸資、欠稅或重大違約紀錄",
      chapterSchema: SBIR_CHAPTERS,
      rubric: SBIR_RUBRIC,
      attachmentsNote: "計畫申請表、公司登記證明、最近一期勞保繳費清單、納稅證明",
      sourceUrl: "https://sbir.org.tw",
      status: "open", needsVerification: false,
    },
    {
      name: "小型企業創新研發計畫（SBIR）Phase 2 研究開發",
      agency: "經濟部中小及新創企業署",
      category: "創新研發",
      description: "Phase 2 以計畫書格式申請，補助上限 600 萬元／1 年（兩年期可達 1,200 萬元）。採隨到隨受理。",
      applyStart: null, applyEnd: null, rolling: true,
      deadlineNote: "隨到隨受理",
      amountMin: null, amountMax: 12000000,
      selfFundNote: "補助款不得超過計畫總經費 50%",
      orgTypes: ["公司", "獨資合夥"],
      eligibilityNote: "同 Phase 1；延續案須 Phase 1 結案並經委員同意",
      chapterSchema: SBIR_CHAPTERS,
      rubric: SBIR_RUBRIC,
      attachmentsNote: "同 Phase 1，另附前期成果（延續案）",
      sourceUrl: "https://sbir.org.tw",
      status: "open", needsVerification: false,
    },
    {
      name: "文化部獎補助（通用入口・各類別）",
      agency: "文化部",
      category: "文化藝術",
      description: "文化部各類獎補助（文創出版、社區村落、表演藝術、人才培育等 14 大類），統一於文化部獎補助資訊網線上申請，各類別梯次不同。",
      applyStart: null, applyEnd: null, rolling: true,
      deadlineNote: "各類別受理梯次不同，以文化部獎補助資訊網當年度公告為準",
      amountMin: null, amountMax: null,
      selfFundNote: "依各類別要點規定",
      orgTypes: ["公司", "社團法人", "財團法人", "工作室", "個人"],
      eligibilityNote: "依各類別補助要點；多數限中華民國立案團體或國民",
      chapterSchema: MOC_CHAPTERS,
      rubric: MOC_RUBRIC,
      attachmentsNote: "立案證明、計畫書、經費表；依類別另附",
      sourceUrl: "https://grants.moc.gov.tw/Web/",
      status: "open", needsVerification: true,
    },
    {
      name: "高雄市表演藝術類補助",
      agency: "高雄市政府文化局",
      category: "文化藝術",
      description: "提升表演藝術展演水準，補助藝文團體展演活動。每年 2 月、6 月、10 月梯次受理。",
      applyStart: "2026-10-01" as never, applyEnd: "2026-10-31" as never, rolling: false,
      deadlineNote: "每年 2／6／10 月梯次，以當期公告為準",
      amountMin: null, amountMax: null,
      selfFundNote: "依當期公告",
      orgTypes: ["社團法人", "財團法人", "公司", "個人"],
      eligibilityNote: "藝文團體、公司、文教基金會或個人",
      chapterSchema: ART_CHAPTERS,
      rubric: ART_RUBRIC,
      attachmentsNote: "立案證明、演出計畫、經費表、過往演出紀錄",
      sourceUrl: "https://khcc.kcg.gov.tw",
      status: "open", needsVerification: true,
    },
    {
      name: "臺中市視覺藝術類活動補助",
      agency: "臺中市政府文化局",
      category: "文化藝術",
      description: "推動視覺藝術多元發展。每年 3 月申請當年度下半年活動、9 月申請次年度上半年活動。",
      applyStart: "2026-09-01" as never, applyEnd: "2026-09-30" as never, rolling: false,
      deadlineNote: "每年 3／9 月梯次，以當期公告為準",
      amountMin: null, amountMax: null,
      selfFundNote: "依當期公告",
      orgTypes: ["社團法人", "個人"],
      eligibilityNote: "立案文化團體或個人",
      chapterSchema: ART_CHAPTERS,
      rubric: ART_RUBRIC,
      attachmentsNote: "立案證明、活動計畫、經費表",
      sourceUrl: "",
      status: "open", needsVerification: true,
    },
    {
      name: "地方創生相關計畫（國發會體系）",
      agency: "國家發展委員會",
      category: "地方創生",
      description: "地方創生體系補助（依年度釋出之計畫別而定），強調在地 DNA、商業模式與自償性。",
      applyStart: null, applyEnd: null, rolling: false,
      deadlineNote: "依年度公告，送件前務必確認當年度時程",
      amountMin: null, amountMax: null,
      selfFundNote: "依當年度公告",
      orgTypes: ["公司", "社團法人", "財團法人"],
      eligibilityNote: "依當年度計畫別公告",
      chapterSchema: CSR_CHAPTERS,
      rubric: CSR_RUBRIC,
      attachmentsNote: "依當年度公告",
      sourceUrl: "",
      status: "open", needsVerification: true,
    },
  ];

  for (const g of grantRows) {
    await db.insert(grantPrograms).values(g as never);
  }
  console.log(`補助案 ${grantRows.length} 筆`);

  const [{ id: clientA }] = await db.insert(clients).values({
    name: "社團法人台南市暖心社區發展協會",
    orgType: "社團法人",
    taxId: "12345678",
    foundedYear: 2015,
    city: "台南市",
    employeesFull: 3, employeesPart: 6,
    capital: 500000, revenueAvg: 2800000,
    contactName: "林淑芬", contactTitle: "總幹事",
    contactPhone: "06-2222-333", contactEmail: "warm@example.org",
    strengths: "深耕社區長照與在地長者服務，擁有 120 位志工，與 8 個里辦公處長期合作；有企業 ESG 合作提案經驗",
    pastProjects: [
      { name: "幫扶箱｜在地生活韌性支持方案", year: "114", budget: "85 萬", outcome: "服務 320 戶、媒合 3 家企業贊助" },
      { name: "社區長者共餐計畫", year: "113", budget: "60 萬", outcome: "每週 5 天、年服務 9,600 人次" },
    ],
    adminCapability: "專職會計 1 人，執行過 3 件政府補助案核銷，熟悉核銷流程",
    financialNote: "近三年決算完備，無欠稅",
    tags: ["社區", "長照", "公益", "ESG", "在地", "文化"],
    notes: "對 CSR／ESG 企業合作有強烈需求",
  } as never).$returningId();

  await db.insert(clients).values({
    name: "陳記食品股份有限公司",
    orgType: "公司",
    taxId: "87654321",
    foundedYear: 2009,
    city: "高雄市",
    employeesFull: 18, employeesPart: 2,
    capital: 5000000, revenueAvg: 32000000,
    contactName: "陳建宏", contactTitle: "總經理",
    contactPhone: "07-555-6666", contactEmail: "chen@example.com",
    strengths: "傳統醬料製程，擁有 2 項製程專利，外銷東南亞五國",
    pastProjects: [
      { name: "低鈉醬油製程改良", year: "113", budget: "120 萬自籌", outcome: "鈉含量降 30%，已量產上市" },
    ],
    adminCapability: "有專任會計，首次申請政府補助",
    financialNote: "近三年財報完備",
    tags: ["食品", "製造", "研發", "外銷"],
    notes: "想做減鹽製程升級與包材減塑研發",
  } as never).$returningId();
  console.log("客戶 2 筆");

  // 示範案件：協會 × 文化部，含部分內容，可直接體驗審核迴圈
  const grant = await db.query.grantPrograms.findFirst();
  const moc = (await db.query.grantPrograms.findMany()).find((g) => g.agency === "文化部");
  const clientA_row = await db.query.clients.findFirst();
  if (moc && clientA_row) {
    const intakeQA = generateIntake(moc.chapterSchema, moc.rubric, clientA_row);
    // 預填幾個關鍵答案，讓示範更真實
    for (const q of intakeQA) {
      if (q.question.includes("一句話")) q.answer = "為台南 3 個里的獨居長者，用藝術陪伴降低孤獨感，並培訓社區自己的陪伴志工。";
      if (q.question.includes("解決什麼問題")) q.answer = "台南市 65 歲以上人口占 18%，本協會服務的 3 個里更高達 24%；訪視發現 4 成獨居長者一週與人說話少於 3 次。";
      if (q.question.includes("可量化的指標")) q.answer = "服務長者 150 人（目前 0）、藝術陪伴活動 48 場（目前 0）、培訓志工 30 人（目前 12 人）。";
      if (q.question.includes("近三年執行過")) q.answer = "114 年幫扶箱方案（85 萬，服務 320 戶）、113 年共餐計畫（60 萬，年 9,600 人次）。";
    }
    const chapters = moc.chapterSchema.map((s) => {
      let content = "";
      let status: "empty" | "draft" | "done" = "empty";
      if (s.key === "background") {
        content = "台灣已進入超高齡社會，台南市 65 歲以上人口占 18%，本協會服務的新化、大內、山上 3 個里更高達 24%。\n本會 114 年訪視 320 戶長者的紀錄顯示：4 成獨居長者一週與人說話少於 3 次，孤獨感直接影響就醫與用藥遵從性。\n現有長照資源集中在身體照顧，心理陪伴明顯不足——這正是本計畫的切入點。";
        status = "draft";
      }
      if (s.key === "track") {
        content = "114 年執行「幫扶箱｜在地生活韌性支持方案」（85 萬元），服務 320 戶、媒合 3 家企業贊助。\n113 年執行社區長者共餐計畫（60 萬元），每週 5 天、全年服務 9,600 人次，核銷率 100%。";
        status = "draft";
      }
      if (s.key === "summary") {
        content = "本計畫擬為台南 3 個里的獨居長者提供藝術陪伴服務。";
        status = "draft";
      }
      // 表格章節：附上示範表格，開箱就能體驗結構化編輯與匯出
      const table = DEMO_TABLES[s.key];
      if (table) status = "draft";
      return { ...s, content, status, ...(table ? { table } : {}) };
    });
    await db.insert(cases).values({
      clientId: clientA,
      grantId: moc.id,
      title: "社區長者藝術陪伴計畫（示範案件）",
      status: "draft",
      targetScore: 85,
      intakeQA,
      chapters,
      rubricSnapshot: moc.rubric,
    } as never);
    console.log("示範案件 1 筆");
  }

  console.log("Done.");
  process.exit(0);
}

seed();
