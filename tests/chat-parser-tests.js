/*
 * 聊天式記帳本機解析器 — 自動化回歸測試
 * ===========================================
 *
 * 用途：
 *   每次修改聊天記帳的意圖辨識／解析邏輯（index.html 裡
 *   「聊天式懶人記帳」那個區塊，大約從 extractChatDate 開始到
 *   sendChatMessage 結束）之後，跑這個檔案做回歸測試，確認沒有
 *   改壞原本已經驗證過的行為。
 *
 * 執行方式：
 *   node tests/chat-parser-tests.js
 *
 * 前置需求：
 *   需要 Playwright 以及一份可用的 Chromium（npm install playwright
 *   並執行過 `npx playwright install chromium`，或環境裡已經有
 *   PLAYWRIGHT_BROWSERS_PATH 指到的 Chromium）。若找不到就會直接
 *   報錯並說明原因，不會假裝測試通過。
 *
 * 運作方式：
 *   直接用 file:// 開啟同目錄下的 index.html（不需要另外起 server），
 *   每一組測試開始前都會把 DB.transactions／DB.chatLedger 重設成
 *   乾淨的空狀態，所以完全不會動到使用者在瀏覽器裡真正存著的資料
 *   （這個 Node 行程開的 Chromium 是獨立的、全新的瀏覽器環境，
 *   跟使用者平常用來打開這個網頁的瀏覽器完全無關）。每一筆訊息都
 *   直接呼叫網頁裡真正的 sendChatMessage()，不是另外寫一份簡化版
 *   的解析邏輯，確保測試測的就是正式程式碼本身。
 *
 * 測試案例分成五組：
 *   A. normal       - 50 句應該直接記帳的句子
 *   B. chitChat      - 30 句一般聊天，不該記帳
 *   C. tricky        - 20 句容易誤判的邊界案例
 *   D. multiContext  - 20 句多筆／日期／待補上下文案例
 *   E. confirmFlow   - 「不確定交易的確認機制」與多輪補充資訊流程，
 *                       對應需求裡的 A～K 情境（C 缺分類／D 轉折句先
 *                       確認金額／E 回答「對」保留上下文／F 回答「不是，
 *                       是150元」更正金額／G 回答「最後沒買」不建立交易／
 *                       H 回答「取消」清除待確認狀態／I 一般聊天不觸發
 *                       確認／J 多筆交易中只有部分需要確認／K 確認完成
 *                       後正式交易與財務串聯正確更新）
 */

const path = require('path');

function resolvePlaywright() {
  try { return require('playwright'); } catch (e) { /* fall through */ }
  // 這個沙盒環境固定把 playwright 裝在這裡；一般開發機上通常可以
  // 直接 `require('playwright')`（上面那行），這裡只是備援路徑。
  try { return require('/opt/node-tools/node_modules/playwright'); } catch (e) {
    console.error('找不到 playwright，請先執行：npm install playwright');
    process.exit(1);
  }
}
const { chromium } = resolvePlaywright();
const CHROMIUM_EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium';

/* ============ 測試案例 ============
   每一筆測試是 { id, desc, steps, expect }：
   - steps：依序送出的訊息（模擬使用者一句一句打字送出）。
   - expect.txAdded：這組 steps 執行完後，DB.transactions 應該增加幾筆
     （用來確認「有沒有記帳」「有沒有重複記帳」）。
   - expect.lastTx：若有新增交易，最後一筆應該符合的欄位（amount 必填，
     category／type／nameIncludes／dateOffsetDays 視案例而定）。
   - expect.pendingAskAfter：執行完後是否應該還留著「待補金額／名稱」
     的草稿（true／false／undefined=不檢查）。
   dateOffsetDays：相對「今天」的天數差（0=今天，-1=昨天，-2=前天，-3=大前天）。
*/
const TESTS = {

  // ===== A. 50 句應該直接記帳 =====
  normal: [
    { id:'A01', steps:['早餐50'], expect:{ txAdded:1, lastTx:{ amount:50, category:'餐費' } } },
    { id:'A02', steps:['午餐120'], expect:{ txAdded:1, lastTx:{ amount:120, category:'餐費' } } },
    { id:'A03', steps:['晚餐400'], expect:{ txAdded:1, lastTx:{ amount:400, category:'餐費' } } },
    { id:'A04', steps:['飲料35'], expect:{ txAdded:1, lastTx:{ amount:35, category:'餐費' } } },
    { id:'A05', steps:['咖啡65'], expect:{ txAdded:1, lastTx:{ amount:65, category:'餐費' } } },
    { id:'A06', steps:['買飲料35'], expect:{ txAdded:1, lastTx:{ amount:35, category:'餐費' } } },
    { id:'A07', steps:['買咖啡65'], expect:{ txAdded:1, lastTx:{ amount:65, category:'餐費' } } },
    { id:'A08', steps:['今天早餐花了50元'], expect:{ txAdded:1, lastTx:{ amount:50, category:'餐費' } } },
    { id:'A09', steps:['昨天晚餐200'], expect:{ txAdded:1, lastTx:{ amount:200, category:'餐費', dateOffsetDays:-1 } } },
    { id:'A10', steps:['前天買衣服590'], expect:{ txAdded:1, lastTx:{ amount:590, category:'購物', dateOffsetDays:-2 } } },
    { id:'A11', steps:['大前天看電影280'], expect:{ txAdded:1, lastTx:{ amount:280, category:'娛樂', dateOffsetDays:-3 } } },
    { id:'A12', steps:['購買日常用品500'], expect:{ txAdded:1, lastTx:{ amount:500, category:'購物' } } },
    { id:'A13', steps:['買東西500'], expect:{ txAdded:1, lastTx:{ amount:500, category:'購物' } } },
    { id:'A14', steps:['計程車300'], expect:{ txAdded:1, lastTx:{ amount:300, category:'交通' } } },
    { id:'A15', steps:['搭公車15'], expect:{ txAdded:1, lastTx:{ amount:15, category:'交通' } } },
    { id:'A16', steps:['加油1000'], expect:{ txAdded:1, lastTx:{ amount:1000, category:'交通' } } },
    { id:'A17', steps:['停車50'], expect:{ txAdded:1, lastTx:{ amount:50, category:'交通' } } },
    { id:'A18', steps:['手機費599'], expect:{ txAdded:1, lastTx:{ amount:599, category:'手機／網路' } } },
    { id:'A19', steps:['網路費799'], expect:{ txAdded:1, lastTx:{ amount:799, category:'手機／網路' } } },
    { id:'A20', steps:['水費300'], expect:{ txAdded:1, lastTx:{ amount:300, category:'水電／瓦斯' } } },
    { id:'A21', steps:['電費1200'], expect:{ txAdded:1, lastTx:{ amount:1200, category:'水電／瓦斯' } } },
    { id:'A22', steps:['瓦斯費450'], expect:{ txAdded:1, lastTx:{ amount:450, category:'水電／瓦斯' } } },
    { id:'A23', steps:['保費2000'], expect:{ txAdded:1, lastTx:{ amount:2000, category:'保險' } } },
    { id:'A24', steps:['看醫生150'], expect:{ txAdded:1, lastTx:{ amount:150, category:'醫療／藥品' } } },
    { id:'A25', steps:['買藥200'], expect:{ txAdded:1, lastTx:{ amount:200, category:'醫療／藥品' } } },
    { id:'A26', steps:['牙醫1500'], expect:{ txAdded:1, lastTx:{ amount:1500, category:'醫療／藥品' } } },
    { id:'A27', steps:['給媽媽2000'], expect:{ txAdded:1, lastTx:{ amount:2000, category:'孝親／家庭支出' } } },
    { id:'A28', steps:['剪髮300'], expect:{ txAdded:1, lastTx:{ amount:300, category:'美容／保養' } } },
    { id:'A29', steps:['看電影280'], expect:{ txAdded:1, lastTx:{ amount:280, category:'娛樂' } } },
    { id:'A30', steps:['唱歌500'], expect:{ txAdded:1, lastTx:{ amount:500, category:'娛樂' } } },
    { id:'A31', steps:['聚餐800'], expect:{ txAdded:1, lastTx:{ amount:800, category:'聚餐／約會' } } },
    { id:'A32', steps:['約會1000'], expect:{ txAdded:1, lastTx:{ amount:1000, category:'聚餐／約會' } } },
    { id:'A33', steps:['買樂器3000'], expect:{ txAdded:1, lastTx:{ amount:3000, category:'興趣' } } },
    { id:'A34', steps:['訂閱netflix390'], expect:{ txAdded:1, lastTx:{ amount:390, category:'訂閱／會員' } } },
    { id:'A35', steps:['機票5000'], expect:{ txAdded:1, lastTx:{ amount:5000, category:'旅行／玩樂' } } },
    { id:'A36', steps:['訂房2000'], expect:{ txAdded:1, lastTx:{ amount:2000, category:'旅行／玩樂' } } },
    { id:'A37', steps:['補習3000'], expect:{ txAdded:1, lastTx:{ amount:3000, category:'學習' } } },
    { id:'A38', steps:['買衣服1200'], expect:{ txAdded:1, lastTx:{ amount:1200, category:'購物' } } },
    { id:'A39', steps:['買鞋子2500'], expect:{ txAdded:1, lastTx:{ amount:2500, category:'購物' } } },
    { id:'A40', steps:['化妝品800'], expect:{ txAdded:1, lastTx:{ amount:800, category:'購物' } } },
    { id:'A41', steps:['衛生紙150'], expect:{ txAdded:1, lastTx:{ amount:150, category:'購物' } } },
    { id:'A42', steps:['買文具200'], expect:{ txAdded:1, lastTx:{ amount:200, category:'購物' } } },
    { id:'A43', steps:['買保養品600'], expect:{ txAdded:1, lastTx:{ amount:600, category:'購物' } } },
    { id:'A44', steps:['薪水30000'], expect:{ txAdded:1, lastTx:{ amount:30000, category:'薪資', type:'income' } } },
    { id:'A45', steps:['獎金5000'], expect:{ txAdded:1, lastTx:{ amount:5000, category:'獎金', type:'income' } } },
    { id:'A46', steps:['兼職收入3000'], expect:{ txAdded:1, lastTx:{ amount:3000, category:'兼職', type:'income' } } },
    { id:'A47', steps:['投資收入2000'], expect:{ txAdded:1, lastTx:{ amount:2000, category:'投資', type:'income' } } },
    { id:'A48', steps:['收到退款300'], expect:{ txAdded:1, lastTx:{ amount:300, category:'其他', type:'income' } } },
    { id:'A49', steps:['存入緊急預備金1000'], expect:{ txAdded:1, lastTx:{ amount:1000, category:'緊急預備金' } } },
    { id:'A50', steps:['存了2000到緊急預備金'], expect:{ txAdded:1, lastTx:{ amount:2000, category:'緊急預備金' } } },
  ],

  // ===== B. 30 句一般聊天，不該記帳 =====
  chitChat: [
    { id:'B01', steps:['你好'] },
    { id:'B02', steps:['哈囉'] },
    { id:'B03', steps:['早安'] },
    { id:'B04', steps:['午安'] },
    { id:'B05', steps:['晚安'] },
    { id:'B06', steps:['謝謝'] },
    { id:'B07', steps:['謝謝你'] },
    { id:'B08', steps:['哈哈哈'] },
    { id:'B09', steps:['在嗎'] },
    { id:'B10', steps:['你是誰'] },
    { id:'B11', steps:['你會做什麼'] },
    { id:'B12', steps:['今天天氣真好'] },
    { id:'B13', steps:['今天好熱'] },
    { id:'B14', steps:['我好累'] },
    { id:'B15', steps:['晚安啦'] },
    { id:'B16', steps:['加油喔'] },
    { id:'B17', steps:['辛苦了'] },
    { id:'B18', steps:['你好棒'] },
    { id:'B19', steps:['早餐很好吃'] },
    { id:'B20', steps:['午餐普通'] },
    { id:'B21', steps:['最近餐費好高'] },
    { id:'B22', steps:['最近開銷好大'] },
    { id:'B23', steps:['我今天只睡了5小時'] },
    { id:'B24', steps:['我今天吃了早餐'] },
    { id:'B25', steps:['今天想買飲料'] },
    { id:'B26', steps:['我想開始存錢'] },
    { id:'B27', steps:['你今天過得好嗎'] },
    { id:'B28', steps:['你吃飯了嗎'] },
    { id:'B29', steps:['我在忙'] },
    { id:'B30', steps:['掰掰'] },
  ].map(t => ({ ...t, expect:{ txAdded:0, pendingAskAfter:false } })),

  // ===== C. 20 句容易誤判的邊界案例 =====
  tricky: [
    { id:'C01', steps:['早餐很好吃'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'C02', steps:['我今天吃了早餐'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'C03', steps:['今天想買飲料'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'C04', steps:['最近餐費好高'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'C05', steps:['我今天只睡了5小時'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'C06', steps:['早餐吃了2顆蛋'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'C07', steps:['早餐50分'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'C08', steps:['今天走了10000步'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'C09', steps:['我想買一件500元的衣服'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'C10', steps:['我明天要花500元'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'C11', steps:['如果買這個要500元'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'C12', steps:['假設我花了300元'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'C13', steps:['今天沒有買早餐'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'C14', steps:['我沒有花500元'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'C15', steps:['本來想買500元的東西，後來沒買'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'C16', steps:['我買了一件500元的衣服'], expect:{ txAdded:1, lastTx:{ amount:500, category:'購物' } } },
    { id:'C17', steps:['我昨天差點花500元，結果只花了100元'], expect:{ txAdded:0, pendingAskAfter:true } },
    { id:'C18', steps:['昨天原本想買500元的衣服，但最後花了300元買衣服'], expect:{ txAdded:1, lastTx:{ amount:300, category:'購物', dateOffsetDays:-1 } } },
    { id:'C19', steps:['早餐'], expect:{ txAdded:0, pendingAskAfter:true } },
    { id:'C20', steps:['幫我記早餐'], expect:{ txAdded:0, pendingAskAfter:true } },
  ],

  // ===== D. 20 句多筆／日期／上下文案例 =====
  multiContext: [
    { id:'D01', steps:['早餐50、午餐120、飲料35'], expect:{ txAdded:3 } },
    { id:'D02', steps:['昨天早餐50、午餐120'], expect:{ txAdded:2, lastTx:{ amount:120, category:'餐費', dateOffsetDays:-1 } } },
    { id:'D03', steps:['昨天晚餐200、今天午餐150'], expect:{ txAdded:2, lastTx:{ amount:150, category:'餐費', dateOffsetDays:0 } } },
    { id:'D04', steps:['前天買衣服590'], expect:{ txAdded:1, lastTx:{ amount:590, category:'購物', dateOffsetDays:-2 } } },
    { id:'D05', steps:['大前天看電影280'], expect:{ txAdded:1, lastTx:{ amount:280, category:'娛樂', dateOffsetDays:-3 } } },
    { id:'D06', steps:['早餐、午餐120'], expect:{ txAdded:1, lastTx:{ amount:120, category:'餐費' }, pendingAskAfter:true } },
    { id:'D07', steps:['你好、早餐50'], expect:{ txAdded:1, lastTx:{ amount:50, category:'餐費' } } },
    { id:'D08', steps:['早餐50、你好'], expect:{ txAdded:1, lastTx:{ amount:50, category:'餐費' } } },
    { id:'D09', steps:['早餐','50'], expect:{ txAdded:1, lastTx:{ amount:50, category:'餐費' }, pendingAskAfter:false } },
    { id:'D10', steps:['幫我記早餐','80'], expect:{ txAdded:1, lastTx:{ amount:80, category:'餐費' }, pendingAskAfter:false } },
    { id:'D11', steps:['午餐','你好'], expect:{ txAdded:0, pendingAskAfter:true } },
    { id:'D12', steps:['300'], expect:{ txAdded:0, pendingAskAfter:true } },
    { id:'D13', steps:['早餐','早餐50'], expect:{ txAdded:1, lastTx:{ amount:50, category:'餐費' } } },
    { id:'D14', steps:['早餐50、午餐'], expect:{ txAdded:1, lastTx:{ amount:50, category:'餐費' }, pendingAskAfter:true } },
    { id:'D15', steps:['購買日常用品500、買東西500'], expect:{ txAdded:2, lastTx:{ amount:500, category:'購物' } } },
    { id:'D16', steps:['薪水30000、早餐50'], expect:{ txAdded:2, lastTx:{ amount:50, category:'餐費' } } },
    { id:'D17', steps:['昨天收到退款300'], expect:{ txAdded:1, lastTx:{ amount:300, category:'其他', type:'income', dateOffsetDays:-1 } } },
    { id:'D18', steps:['我昨天差點花500元，結果只花了100元、早餐30'], expect:{ txAdded:1, lastTx:{ amount:30, category:'餐費' }, pendingAskAfter:true } },
    { id:'D19', steps:['今天沒有買早餐、午餐120'], expect:{ txAdded:1, lastTx:{ amount:120, category:'餐費' } } },
    { id:'D20', steps:['10/10買咖啡65'], expect:{ txAdded:1, lastTx:{ amount:65, category:'餐費' } } },
  ],

  // ===== E. 不確定交易的確認機制／多輪補充資訊流程 =====
  confirmFlow: [
    // A（對照組）：資訊完整直接記帳，不該觸發任何確認。
    { id:'E_A1', steps:['午餐120'], expect:{ txAdded:1, lastTx:{ amount:120, category:'餐費' }, pendingAskAfter:false } },
    // B（對照組）：純粹缺金額，照舊只問金額，不是確認式問句。
    { id:'E_B1', steps:['早餐'], expect:{ txAdded:0, pendingAskAfter:true, pendingAskField:'amount', lastBotReplyIncludes:'多少錢' } },
    // C：資訊完整只缺分類時，只問分類，不重複確認日期／金額／收支類型。
    { id:'E_C1', steps:['昨天花了300元'], expect:{ txAdded:0, pendingAskAfter:true, pendingAskField:'name', lastBotReplyIncludes:'分類' } },
    { id:'E_C2', steps:['昨天花了300元','購物'], expect:{ txAdded:1, lastTx:{ amount:300, category:'購物', dateOffsetDays:-1 }, pendingAskAfter:false } },
    // D：轉折句猜出來的金額，先確認金額本身（不是直接問分類，也不是直接記帳）。
    { id:'E_D1', steps:['我昨天差點花500元，結果只花了100元'], expect:{ txAdded:0, pendingAskAfter:true, pendingAskField:'confirmAmount', lastBotReplyIncludes:'100' } },
    // E：回答「對」後，保留金額／日期，只在分類仍不明時才繼續問分類。
    { id:'E_E1', steps:['我昨天差點花500元，結果只花了100元','對'], expect:{ txAdded:0, pendingAskAfter:true, pendingAskField:'name', lastBotReplyIncludes:'分類' } },
    { id:'E_E2', steps:['我昨天差點花500元，結果只花了100元','對','購物'], expect:{ txAdded:1, lastTx:{ amount:100, category:'購物', dateOffsetDays:-1 }, pendingAskAfter:false } },
    // F：回答「不是，是150元」後，更正待確認金額，不會同時留下 100 跟 150 兩筆。
    { id:'E_F1', steps:['我昨天差點花500元，結果只花了100元','不是，是150元'], expect:{ txAdded:0, pendingAskAfter:true, pendingAskField:'name', lastBotReplyIncludes:'150' } },
    { id:'E_F2', steps:['我昨天差點花500元，結果只花了100元','不是，是150元','飲料'], expect:{ txAdded:1, lastTx:{ amount:150, category:'餐費', dateOffsetDays:-1 }, pendingAskAfter:false } },
    // G：回答「最後沒買／根本沒買」後，不建立任何交易。
    { id:'E_G1', steps:['我昨天差點花500元，結果只花了100元','不是，我最後根本沒買'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'E_G2', steps:['我昨天差點花500元，結果只花了100元','沒有買'], expect:{ txAdded:0, pendingAskAfter:false } },
    // 單獨回答「不是」：不等於取消，也不能自己亂猜，應該追問「是哪裡不對」，並保留原本
    // 待確認的草稿（金額、日期都還在），不會清掉也不會記帳。
    { id:'E_N1', steps:['我昨天差點花500元，結果只花了100元','不是'], expect:{ txAdded:0, pendingAskAfter:true, pendingAskField:'confirmAmount', lastBotReplyIncludes:'哪裡不對' } },
    // 「不是」之後接著補充「是150元」：延續同一筆待確認草稿，正確更正金額、保留日期，
    // 不會把 100 跟 150 都記進去。
    { id:'E_N2', steps:['我昨天差點花500元，結果只花了100元','不是','是150元'], expect:{ txAdded:0, pendingAskAfter:true, pendingAskField:'name', lastBotReplyIncludes:'150' } },
    { id:'E_N3', steps:['我昨天差點花500元，結果只花了100元','不是','是150元','購物'], expect:{ txAdded:1, lastTx:{ amount:150, category:'購物', dateOffsetDays:-1 }, pendingAskAfter:false } },
    // 「不是昨天，是前天」：只修正日期，金額（100）維持不變，分類仍缺就繼續問分類。
    { id:'E_N4', steps:['我昨天差點花500元，結果只花了100元','不是昨天，是前天'], expect:{ txAdded:0, pendingAskAfter:true, pendingAskField:'name', lastBotReplyIncludes:'100' } },
    { id:'E_N5', steps:['我昨天差點花500元，結果只花了100元','不是昨天，是前天','飲料'], expect:{ txAdded:1, lastTx:{ amount:100, category:'餐費', dateOffsetDays:-2 }, pendingAskAfter:false } },
    // 「不是支出，是收入」：更正收支類型，分類重新檢查（原本就是 null，改完還是要問）。
    { id:'E_N6', steps:['我昨天差點花500元，結果只花了100元','不是支出，是收入','薪資'], expect:{ txAdded:1, lastTx:{ amount:100, category:'薪資', type:'income' }, pendingAskAfter:false } },
    // 沒有待確認交易時，單獨輸入「不是」不得建立交易，也不得莫名其妙啟動確認流程。
    { id:'E_N7', steps:['不是'], expect:{ txAdded:0, pendingAskAfter:false } },
    // H：輸入「取消」或「算了」後，正確清除待確認狀態（之後可以正常開始新的一筆）。
    { id:'E_H1', steps:['我昨天差點花500元，結果只花了100元','取消'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'E_H2', steps:['我昨天差點花500元，結果只花了100元','算了'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'E_H3', steps:['我昨天差點花500元，結果只花了100元','算了','早餐50'], expect:{ txAdded:1, lastTx:{ amount:50, category:'餐費' }, pendingAskAfter:false } },
    // I：一般聊天完全不會進入確認機制（不是只檢查「沒記帳」，是連 pendingAsk 都不該出現）。
    { id:'E_I1', steps:['你好'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'E_I2', steps:['早餐很好吃'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'E_I3', steps:['今天想買飲料'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'E_I4', steps:['最近餐費好高'], expect:{ txAdded:0, pendingAskAfter:false } },
    // J：一次輸入多筆，其中一筆需要確認時，已經完整的那一筆照樣直接記帳，不會被卡住，
    // 也不會因為後面在等確認，就重複處理前面已經完成的那一筆。
    { id:'E_J1', steps:['早餐50、我昨天差點花500元結果只花了100元'], expect:{ txAdded:1, lastTx:{ amount:50, category:'餐費' }, pendingAskAfter:true, pendingAskField:'confirmAmount' } },
    { id:'E_J2', steps:['早餐50、我昨天差點花500元結果只花了100元','對','購物'], expect:{ txAdded:2, lastTx:{ amount:100, category:'購物' }, pendingAskAfter:false } },
    // 待確認期間輸入另一筆全新、資訊齊全的記帳指令，不會被誤吃成上一筆的回答，
    // 新的那一筆照樣正確記帳（原本待確認的狀態維持不變，不會被悄悄清掉或誤判）。
    { id:'E_J3', steps:['我昨天差點花500元，結果只花了100元','早餐50'], expect:{ txAdded:1, lastTx:{ amount:50, category:'餐費' }, pendingAskAfter:true, pendingAskField:'confirmAmount' } },
    // 沒有待確認交易時，「對」「算了」這類簡短回答不會被誤解讀成記帳。
    { id:'E_X1', steps:['對'], expect:{ txAdded:0, pendingAskAfter:false } },
    { id:'E_X2', steps:['算了'], expect:{ txAdded:0, pendingAskAfter:false } },
    // K：轉折句如果連分類都能確定（例如句子裡本來就提到「衣服」），代表規則判斷已經有
    // 足夠把握，直接記帳即可，不需要多一層確認——呼應「不得為了完成記帳增加不必要的
    // 確認步驟」。這筆完成後記帳歷史／收支統計／預算／復盤的即時串聯，由既有的
    // saveCompleteChatDrafts() → renderAll() 機制保證（見下面 main() 的額外 DOM 檢查）。
    { id:'E_K1', steps:['昨天原本想買500元的衣服，但最後花了300元買衣服'], expect:{ txAdded:1, lastTx:{ amount:300, category:'購物', dateOffsetDays:-1 }, pendingAskAfter:false } },
  ],
};

async function runGroup(page, groupName, cases) {
  const results = [];
  for (const c of cases) {
    // 每組測試前重設成乾淨狀態，確保彼此獨立、不互相汙染，
    // 也完全不會動到使用者在真實瀏覽器裡的 localStorage 資料
    // （這整個 page 本來就是這個測試行程自己開的全新瀏覽器環境）。
    await page.evaluate(() => {
      DB.transactions = [];
      DB.emergencyFundDeposits = [];
      DB.chatLedger = { messages: [], soundOn: true, pendingAsk: null };
      save();
    });

    const before = await page.evaluate(() => DB.transactions.length);
    for (const text of c.steps) {
      await page.evaluate((t) => {
        document.getElementById('chatInput').value = t;
        sendChatMessage();
      }, text);
    }
    const after = await page.evaluate(() => DB.transactions.length);
    const txs = await page.evaluate(() => DB.transactions.map(t => ({
      amount: t.amount, category: t.category, type: t.type, name: t.name, date: t.date
    })));
    const pendingAsk = await page.evaluate(() => DB.chatLedger.pendingAsk);
    const today = await page.evaluate(() => todayStr());

    const added = after - before;
    const lastTx = txs[txs.length - 1];
    const problems = [];

    if (c.expect) {
      if (typeof c.expect.txAdded === 'number' && added !== c.expect.txAdded) {
        problems.push(`txAdded 預期 ${c.expect.txAdded}，實際 ${added}`);
      }
      if (c.expect.lastTx) {
        if (!lastTx) {
          problems.push('預期有新交易但沒有');
        } else {
          const e = c.expect.lastTx;
          if (e.amount != null && lastTx.amount !== e.amount) problems.push(`amount 預期 ${e.amount}，實際 ${lastTx.amount}`);
          if (e.category != null && lastTx.category !== e.category) problems.push(`category 預期 ${e.category}，實際 ${lastTx.category}`);
          if (e.type != null && lastTx.type !== e.type) problems.push(`type 預期 ${e.type}，實際 ${lastTx.type}`);
          if (e.nameIncludes != null && !String(lastTx.name).includes(e.nameIncludes)) problems.push(`name 預期包含「${e.nameIncludes}」，實際「${lastTx.name}」`);
          if (e.dateOffsetDays != null) {
            const expectedDate = await page.evaluate((off) => {
              const d = new Date(); d.setDate(d.getDate() + off); return fmtDate(d);
            }, e.dateOffsetDays);
            if (lastTx.date !== expectedDate) problems.push(`date 預期 ${expectedDate}，實際 ${lastTx.date}`);
          }
        }
      }
      if (typeof c.expect.pendingAskAfter === 'boolean') {
        const has = !!pendingAsk;
        if (has !== c.expect.pendingAskAfter) {
          problems.push(`pendingAsk 預期${c.expect.pendingAskAfter ? '存在' : '不存在'}，實際${has ? '存在' : '不存在'}`);
        }
      }
      if (c.expect.pendingAskField != null) {
        const field = pendingAsk ? pendingAsk.field : null;
        if (field !== c.expect.pendingAskField) {
          problems.push(`pendingAsk.field 預期 ${c.expect.pendingAskField}，實際 ${field}`);
        }
      }
      if (c.expect.lastBotReplyIncludes != null) {
        const bots = await page.evaluate(() => DB.chatLedger.messages.filter(m => m.role === 'bot'));
        const lastBot = bots[bots.length - 1];
        const text = lastBot ? lastBot.text : '';
        if (!text.includes(c.expect.lastBotReplyIncludes)) {
          problems.push(`最後一句小夥伴回覆預期包含「${c.expect.lastBotReplyIncludes}」，實際「${text}」`);
        }
      }
    }

    results.push({ id: c.id, group: groupName, steps: c.steps, pass: problems.length === 0, problems, added, lastTx, pendingAsk });
  }
  return results;
}

async function main() {
  const indexPath = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const browser = await chromium.launch({ executablePath: CHROMIUM_EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));

  await page.goto(indexPath);
  await page.waitForFunction(() => typeof sendChatMessage === 'function');

  const allResults = [];
  for (const [groupName, cases] of Object.entries(TESTS)) {
    const r = await runGroup(page, groupName, cases);
    allResults.push(...r);
  }

  // K：確認流程完成後，正式記帳歷史／當月收支／分類統計／預算頁必須立即反映最新資料，
  // 跟既有「聊天記帳 -> renderAll()」的即時同步機制一致。這裡額外直接讀「畫面上實際
  // 顯示的 DOM」而不是只查 DB.transactions，因為這個即時同步問題之前就是因為只驗證
  // DB 資料、沒有驗證實際畫面而被忽略過一次。
  const syncResult = { id: 'E_K2_dom_sync', group: 'confirmFlow', pass: true, problems: [] };
  try {
    await page.evaluate(() => {
      DB.transactions = [];
      DB.chatLedger = { messages: [], soundOn: true, pendingAsk: null };
      const mk = cycleKeyForDate(todayStr());
      const calcItems = { necessary: [{ id: '餐費', name: '餐費', amount: 9000 }], debt: [], savings: [], free: [] };
      const allocations = computeAllocationsFromCalcItems(calcItems, null, null);
      createBudget(mk, { available: 30000, allocations, calcItems });
      save();
    });
    await page.click('.nav-item[data-view="ledger"]');
    await page.click('#goChatLedgerCard');
    await page.evaluate(() => { document.getElementById('chatInput').value = '我昨天差點花500元，結果只花了100元'; sendChatMessage(); });
    await page.evaluate(() => { document.getElementById('chatInput').value = '對'; sendChatMessage(); });
    await page.evaluate(() => { document.getElementById('chatInput').value = '飲料'; sendChatMessage(); });
    await page.click('#btnBackFromChatLedger');
    await page.click('#goLedgerCard');
    const ledgerExpense = await page.textContent('#ledgerExpense');
    const ledgerListText = await page.innerText('#ledgerList');
    if (ledgerExpense.trim() !== '100') syncResult.problems.push(`#ledgerExpense 預期 100，實際 ${ledgerExpense}`);
    if (!ledgerListText.includes('飲料')) syncResult.problems.push('記帳歷史清單沒有顯示「飲料」這筆交易');
    await page.click('#btnBackFromLedger');
    await page.click('#goBudgetCard');
    const budgetText = await page.innerText('#budgetContent');
    if (!budgetText.includes('100')) syncResult.problems.push('預算頁的實際總支出沒有反映這筆 100 元');
  } catch (e) {
    syncResult.problems.push('DOM 同步檢查執行失敗：' + e.message);
  }
  syncResult.pass = syncResult.problems.length === 0;
  allResults.push(syncResult);

  await browser.close();

  const total = allResults.length;
  const passed = allResults.filter(r => r.pass).length;
  const failed = allResults.filter(r => !r.pass);

  console.log(`\n聊天記帳解析器回歸測試：共 ${total} 筆，通過 ${passed} 筆，失敗 ${failed.length} 筆。\n`);
  if (failed.length) {
    console.log('失敗案例：');
    failed.forEach(r => {
      console.log(`  [${r.id}] 輸入：${JSON.stringify(r.steps)}`);
      r.problems.forEach(p => console.log(`      - ${p}`));
    });
  }
  const realErrors = consoleErrors.filter(e => !e.includes('ERR_TUNNEL') && !e.includes('Failed to load resource'));
  if (realErrors.length) {
    console.log('\n測試過程中出現的 console 錯誤（不含已知的 CDN 連線限制噪音）：');
    realErrors.forEach(e => console.log('  ' + e));
  }

  process.exit(failed.length === 0 && realErrors.length === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('測試執行失敗：', err);
  process.exit(1);
});
