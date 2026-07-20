// 動態問卷引擎：問卷不是固定表單，而是由「該案的章節格式＋評分標準＋客戶記憶」即時生成。
// 換一個補助案、改一次章節，問卷就跟著變。
import type { ChapterSpec, IntakeQuestion, RubricItem } from "../../contracts/types";
import type { Client } from "../../db/schema";

interface QuestionTemplate {
  patterns: RegExp;      // 比對章節 key 或標題
  questions: { question: string; hint: string }[];
}

// 問題模板庫：依章節「語意」對應，不是對應固定章節名。
// 設計原則：問「客戶日常就知道的事實」，不問「計畫書語言的論述」——
// 白話、拆小題、附範例答案；白話碎片由 AI 負責提煉成正式文字。
const TEMPLATES: QuestionTemplate[] = [
  {
    patterns: /摘要|summary|概述/i,
    questions: [
      { question: "這個計畫一句話講完：幫「誰」、做「什麼」？", hint: "例：幫社區的獨居長輩，每週辦共餐和藝術課，讓他們願意走出家門" },
    ],
  },
  {
    patterns: /緣起|背景|問題|現況|需求|background|現狀/i,
    questions: [
      { question: "你服務的人（或你的客戶）平常最大的困擾是什麼？講一個你實際看過的例子就好", hint: "例：里內很多阿公阿嬤整天一個人在家，上次里長去關心才發現有人三天沒出門" },
      { question: "有沒有相關的數字？大概的就好", hint: "例：我們里 65 歲以上大概占三成、附近類似的據點只有兩處" },
      { question: "這個問題大家現在都怎麼處理？為什麼還是不夠？", hint: "例：社區有關懷據點但一週只開兩天，住的遠的長輩根本過不來" },
    ],
  },
  {
    patterns: /目標|KPI|效益指標|goal/i,
    questions: [
      { question: "計畫結束那天，你希望看到什麼改變？白話講就好", hint: "例：希望長輩每週至少出門兩次，不再一個人悶在家" },
      { question: "換成數字想想看？估的也可以——大概服務幾個人、辦幾場、增加多少", hint: "例：一年服務 500 人次、辦 48 場活動、固定參加的長輩從 10 人變 40 人" },
    ],
  },
  {
    patterns: /內容|執行|方法|策略|工作項目|方案|做法|服務|產品|技術|研發/i,
    questions: [
      { question: "這個計畫實際要做哪幾件事？像寫待辦清單一樣列出來（3–5 項）", hint: "例：每週二四共餐、每月兩次藝術課、年底辦一場成果展" },
      { question: "每一件事分別找誰做？在哪裡做？", hint: "例：共餐找巷口餐廳配合，在里民活動中心辦；藝術課請社大的老師" },
      { question: "同行或別的單位做類似的事時，通常怎麼做？你們有什麼不一樣的做法或堅持？", hint: "例：一般據點只有白天開放，我們加了晚上和假日的場次，子女下班也能陪長輩來" },
    ],
  },
  {
    patterns: /進度|時程|期程|查核|里程碑|schedule/i,
    questions: [
      { question: "打算幾月開始、幾月結束？前段、中段、後段大概各做什麼？", hint: "例：3–4 月找場地招人、5–10 月正式跑、11 月收尾辦成果展" },
      { question: "有沒有已經定下來的日期？（場地訂了、活動檔期、配合單位的時間）", hint: "例：活動中心 5 月起才能用；沒有的話寫「無」" },
    ],
  },
  {
    patterns: /組織|團隊|人力|人員|架構|分工|team/i,
    questions: [
      { question: "這案子主要誰負責？他以前做過什麼相關的事？", hint: "例：總幹事美玲姐，辦過三年關懷據點，長輩都認識她" },
      { question: "還有誰會加入？有沒有外聘的老師或合作單位？談好了嗎？", hint: "例：社大王老師口頭答應了；餐廳老闆是里民，已經說好成本價供餐" },
    ],
  },
  {
    patterns: /實績|經驗|能量|績效|過去|track/i,
    questions: [
      { question: "你們以前做過類似的事嗎？什麼時候、規模多大、結果如何？", hint: "例：112 年起辦關懷據點，每週兩天、平均 25 位長輩參加" },
      { question: "有沒有申請過政府補助？後來報帳核銷是誰在處理？", hint: "例：去年有拿過社會處的方案，核銷是辦公室小陳在跑；沒有就寫「第一次申請」" },
    ],
  },
  {
    patterns: /預算|經費|費用|budget/i,
    questions: [
      { question: "錢主要會花在哪幾項？各大概多少？粗估就好", hint: "例：講師費 20 萬、餐費 30 萬、材料 10 萬、雜支 5 萬" },
      { question: "自己要出多少？從哪裡來？", hint: "例：協會基金出 10 萬，還有里長募的社會善心款約 5 萬" },
      { question: "有沒有同時在申請其他補助？", hint: "誠實寫就好，評審在意的是有沒有重複領；沒有就寫「無」" },
    ],
  },
  {
    patterns: /效益|成效|影響|成果|benefit/i,
    questions: [
      { question: "誰會因為這個計畫過得比較好？大概多少人？會變成什麼樣？", hint: "例：里內約 200 位獨居長輩，預計 40 位會固定來參加，孤單感減少、也認識新朋友" },
    ],
  },
  {
    patterns: /永續|延續|擴散|營運模式|sustain/i,
    questions: [
      { question: "補助款用完之後，這件事還做得下去嗎？錢或人從哪來？", hint: "例：共餐每人收 50 元可持續；藝術課打算下一年改申請社大的常年方案" },
    ],
  },
  {
    patterns: /風險|應變|risk/i,
    questions: [
      { question: "你最擔心哪個環節出問題？（人、錢、場地、報名不足…）到時候怎麼辦？", hint: "例：怕長輩一開始不敢來——先拜託里長和志工一對一邀請，前兩週提供接送" },
    ],
  },
  {
    patterns: /市場|競爭|分析|SWOT/i,
    questions: [
      { question: "跟你做類似事情的有哪些家？客人為什麼選你不選他？", hint: "例：附近兩家便當店都有外送，我們的差別是可以配合長輩的軟質餐和低鹽需求" },
    ],
  },
];

// 通用模板：遇到模板庫對應不到的章節，用章節指引現場生成
function genericQuestions(ch: ChapterSpec): { question: string; hint: string }[] {
  return [
    {
      question: `「${ch.title}」這部分，你手邊有什麼相關資料或想法？想到什麼寫什麼，條列就好`,
      hint: ch.guidance ? `公告的要求：${ch.guidance}——照著回答即可，白話沒關係，顧問會幫你整理成正式文字` : "白話沒關係，顧問會幫你整理成正式文字",
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
      question: `「${r.item}」這一項評審配了 ${r.points} 分（特別重）——你們有什麼相關的成績、數字或承諾可以拿出來？想到什麼寫什麼`,
      hint: r.description ? `評分說明：${r.description}——照著列事實就好，白話沒關係` : "列事實就好：做過什麼、多少人、什麼成果——白話沒關係",
      answer: "",
      prefilled: false,
    });
  }

  return out;
}
