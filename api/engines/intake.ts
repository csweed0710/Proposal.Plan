// 動態問卷引擎：問卷不是固定表單，而是由「該案的章節格式＋評分標準＋客戶記憶」即時生成。
// 換一個補助案、改一次章節，問卷就跟著變。
import type { ChapterSpec, IntakeQuestion, RubricItem } from "../../contracts/types";
import type { Client } from "../../db/schema";

interface QuestionTemplate {
  patterns: RegExp;      // 比對章節 key 或標題
  questions: { question: string; hint: string }[];
}

// 問題模板庫：依章節「語意」對應，不是對應固定章節名
const TEMPLATES: QuestionTemplate[] = [
  {
    patterns: /摘要|summary|概述/i,
    questions: [
      { question: "用一句話說明這個計畫：為「誰」做「什麼」，解決「什麼問題」？", hint: "摘要最後寫，但這句話會貫穿全書" },
    ],
  },
  {
    patterns: /緣起|背景|問題|現況|需求|background|現狀/i,
    questions: [
      { question: "這個計畫要解決什麼問題？誰遇到的困難？有什麼數據、新聞或親身觀察？", hint: "數據越具體越好，例如「在地 65 歲以上人口占 28%」" },
      { question: "現有的資源或做法有什麼缺口？為什麼現在需要這個計畫？", hint: "回答「為什麼是現在」" },
    ],
  },
  {
    patterns: /目標|KPI|效益指標|goal/i,
    questions: [
      { question: "計畫總目標是什麼？想達成的最大改變是什麼？", hint: "一句話，可衡量" },
      { question: "有哪些可量化的指標？請寫出基期值與目標值", hint: "例如：服務人次 0→3,000、活動 0→24 場" },
    ],
  },
  {
    patterns: /內容|執行|方法|策略|工作項目|方案|做法|服務|產品|技術|研發/i,
    questions: [
      { question: "主要工作項目有哪些？請列 3–5 項，每項一句話", hint: "每項要能被追蹤查核" },
      { question: "每一項打算「怎麼做」？方法、流程、使用的工具或模式？", hint: "動詞開頭，避免形容詞" },
      { question: "這個做法的創新點或獨特之處是什麼？跟現有做法差在哪？", hint: "評審在找差異化" },
    ],
  },
  {
    patterns: /進度|時程|期程|查核|里程碑|schedule/i,
    questions: [
      { question: "預計執行期程？（起訖月份）各階段的重點是什麼？", hint: "例如：第 1–2 月籌備、第 3–8 月執行" },
      { question: "有哪些時間上的硬限制？（活動日期已定、配合單位時程等）", hint: "沒有就填「無」" },
    ],
  },
  {
    patterns: /組織|團隊|人力|人員|架構|分工|team/i,
    questions: [
      { question: "核心成員有誰？姓名／職稱／相關經歷／在本計畫負責什麼？", hint: "列 3–5 人，經歷要對應分工" },
      { question: "有合作或協力單位嗎？已談定還是洽談中？", hint: "有推薦函或意向書更加分" },
    ],
  },
  {
    patterns: /實績|經驗|能量|績效|過去|track/i,
    questions: [
      { question: "近三年執行過哪些相關計畫？名稱／年度／經費／成果數據", hint: "同類計畫優先，數據優先" },
      { question: "有執行過政府補助案的核銷經驗嗎？誰負責行政核銷？", hint: "證明「罩得住」" },
    ],
  },
  {
    patterns: /預算|經費|費用|budget/i,
    questions: [
      { question: "總預算粗估多少？主要支出項目與概估金額？", hint: "概列即可，例如：人事費 40 萬、活動費 20 萬" },
      { question: "自籌款多少、來源是什麼？", hint: "自有資金／營收／募款／其他補助" },
      { question: "是否已獲或同時申請其他補助？", hint: "有無重複補助疑慮，請誠實填寫" },
    ],
  },
  {
    patterns: /效益|成效|影響|成果|benefit/i,
    questions: [
      { question: "這個計畫會為誰帶來什麼改變？量化與質化各是什麼？", hint: "受益對象要具體" },
    ],
  },
  {
    patterns: /永續|延續|擴散|營運模式|sustain/i,
    questions: [
      { question: "補助結束後，計畫如何延續？錢從哪來、誰接手？", hint: "評審最重視的一題，不能寫「會繼續努力」" },
    ],
  },
  {
    patterns: /風險|應變|risk/i,
    questions: [
      { question: "這個案子最可能失敗或卡關的地方是什麼？怎麼應變？", hint: "寫真實的風險，不要寫天災" },
    ],
  },
  {
    patterns: /市場|競爭|分析|SWOT/i,
    questions: [
      { question: "這個領域的現況與競爭者是什麼？你們的位置在哪？", hint: "點出缺口，而不是歌功頌德" },
    ],
  },
];

// 通用模板：遇到模板庫對應不到的章節，用章節指引現場生成
function genericQuestions(ch: ChapterSpec): { question: string; hint: string }[] {
  return [
    {
      question: `針對「${ch.title}」這一章：${ch.guidance || "請提供相關資料"}——你們手上有什麼素材？`,
      hint: "條列即可，寫作台會轉化為正式文字",
    },
  ];
}

/** 由客戶記憶產生「組織基本資料」區塊（已知自動帶入並標記） */
function profileQuestions(client: Client): IntakeQuestion[] {
  const rows: { q: string; value: string }[] = [
    { q: "組織全名", value: client.name ?? "" },
    { q: "組織型態", value: client.orgType ?? "" },
    { q: "統一編號／立案字號", value: client.taxId ?? "" },
    { q: "成立年份", value: client.foundedYear ? String(client.foundedYear) : "" },
    { q: "所在地", value: client.city ?? "" },
    { q: "專職／兼職人員數", value: client.employeesFull != null ? `專職 ${client.employeesFull} 人、兼職 ${client.employeesPart ?? 0} 人` : "" },
    { q: "資本額／基金規模", value: client.capital ? `新台幣 ${client.capital.toLocaleString()} 元` : "" },
    { q: "年均營業額／年收入", value: client.revenueAvg ? `新台幣 ${client.revenueAvg.toLocaleString()} 元` : "" },
    { q: "優勢與特色", value: client.strengths ?? "" },
    { q: "行政與核銷能量", value: client.adminCapability ?? "" },
  ];
  return rows.map((r, i) => ({
    id: `profile_${i}`,
    chapterKey: "__profile__",
    question: r.q,
    hint: r.value ? "已由客戶資料庫帶入，可直接修改" : "客戶資料庫尚無此資料，請補填",
    answer: r.value,
    prefilled: Boolean(r.value),
  }));
}

/** 主入口：依章節格式＋評分標準＋客戶記憶，生成整份動態問卷 */
export function generateIntake(
  chapters: ChapterSpec[],
  rubric: RubricItem[],
  client: Client,
): IntakeQuestion[] {
  const out: IntakeQuestion[] = [...profileQuestions(client)];
  let n = 0;

  for (const ch of chapters) {
    const tpl = TEMPLATES.find((t) => t.patterns.test(ch.key) || t.patterns.test(ch.title));
    const qs = tpl ? tpl.questions : genericQuestions(ch);
    for (const q of qs) {
      out.push({
        id: `q_${n++}`,
        chapterKey: ch.key,
        question: q.question,
        hint: q.hint,
        answer: "",
        prefilled: false,
      });
    }
  }

  // 高分配評分項目 → 追問具體資料（配分 ≥ 20 的項目）
  const sorted = [...rubric].sort((a, b) => b.points - a.points);
  for (const r of sorted.filter((x) => x.points >= 20)) {
    out.push({
      id: `q_${n++}`,
      chapterKey: "__rubric__",
      question: `評分項目「${r.item}」占 ${r.points} 分——你們有什麼具體資料可以支撐這一項？`,
      hint: r.description || "配分最高的項目，資料越具體越好",
      answer: "",
      prefilled: false,
    });
  }

  return out;
}
