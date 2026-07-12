# AGENTS.md — agentraining-site

給任何在這個 repo 上工作的 AI agent（Claude Code、Claude 網頁版、或其他工具）看的規則文件。開始改動之前，請先讀完這份文件。

---

## 1. 分支規則（最重要，之前造成過長時間的線上事故）

- **`master` 是唯一的正式分支。** Netlify 的 production 部署固定抓 `master`（可在 Netlify → Deploys 頁面確認，會顯示 `Production: master@xxxxxxx`）。
- **一律直接在 `master` 上編輯、commit。** 不要開新分支再合併，除非使用者明確要求。
- **`main` 分支基本上是廢棄的，不要用。** `main` 上的 `data/` 資料夾（場景資料）根本不存在，`main` 的內容跟 `master`已經嚴重分岔（相差 30+ commits）。曾經因為 `main` 跟 `master` 的 `netlify/functions/claude.js` 版本不同步，導致網站整整故障，一直到深入排查才發現。
- 如果不確定該用哪個分支，答案永遠是 `master`。

## 2. 場景資料：有兩套系統，兩套都要查

這個 repo 目前有 **兩套平行存在的場景（scenario）資料來源**，新增或修改場景時，兩套都必須檢查，避免重複：

1. **舊版：`simulator.html` 內部寫死的 `scenarios` 陣列**（約 28 筆，分類 `free` / `finance` / `health` / `realestate`）。目前左側「選擇情境」清單實際渲染的就是這一套。
2. **新版：`data/cases-*.json` 外部檔案**（`cases-insurance.json`、`cases-realestate.json`、`cases-health.json`、`cases-manager.json`，各 industry 目前約 10-16 筆，雙語 en/zh，透過 onboarding 流程動態載入）。

**新增場景前，務必同時搜尋這兩套資料的內容**（包含 `simulator.html` 裡的 `keywords`/`preview`/`systemPrompt` 文字，以及各 `cases-*.json` 裡的 `bio`/`archetype`），確認沒有概念重複，才動筆寫新的。

## 3. `data/cases-*.json` 的資料格式

每筆場景物件的必要欄位：

```json
{
  "id": "insurance-17",
  "tags": {
    "objectionType": "...",
    "difficulty": 1,
    "archetype": "..."
  },
  "en": {
    "name": "...",
    "bio": "...",
    "greeting": "...",
    "tasks": "...",
    "openers": ["...", "...", "..."]
  },
  "zh": {
    "name": "...",
    "bio": "...",
    "greeting": "...",
    "tasks": "...",
    "openers": ["...", "...", "..."]
  }
}
```

- `id` 不可重複，命名慣例是 `{industry}-{兩位數字}`。
- `openers` 至少 3 條，en/zh 各自對應。
- 修改或替換這類檔案前，**一定要先用 JSON 解析器驗證格式**（沒有語法錯誤、沒有重複 id），再 commit。
- **已使用過的 `objectionType` 分類**，加新場景時優先重複使用，不要每次都發明新分類：
  `no_urgency`、`already_has_solution`、`needs_third_party_approval`、`price_sensitive`、`distrust_of_salesperson`、`overwhelmed_by_options`、`time_constrained`、`risk_aversion`、`emotional_attachment`、`prefers_alternative_investment`

## 4. 內容範圍限制（授權執照邊界，硬性規定）

平台使用者是持有**一般保險/房地產執照**的業務員，**沒有證券執照**。

- **絕對不要**寫任何要求業務員「講解或推薦具體投資標的」的場景內容——不管是 ETF、股票、基金比較、加密貨幣配置、variable life/variable annuity 這類牽涉 separate account 的商品。這些需要另外的證券牌照，超出一般保險執照範圍。
- 如果客戶角色提到投資、加密貨幣等話題（例如「我比較想投資 ETF」），這類場景**可以做**，但業務員的任務必須被設計成「理解客戶動機 → 轉回保障/保險的價值」，**絕不能**讓 AI 或業務員在對話裡實際教客戶怎麼做投資決策。已有的正確示範：`insurance-15`（crypto_curious_young_professional）。

## 5. `netlify/functions/claude.js`

正確版本（前端 `simulator.html` 送出 `{ system, messages }` 格式，這個函式必須原樣轉發，不要改回舊版單一 `message` 字串格式）：

```js
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const body = JSON.parse(event.body);
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: body.system || '',
        messages: body.messages
      })
    });
    const data = await response.json();
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
```

## 6. 編輯 GitHub 網頁檔案編輯器時：只貼純內容

**曾經發生過的錯誤**：把整段「給 AI agent 的操作指令」（包含前言文字、任務說明）一起貼進了 GitHub 的檔案編輯器，導致 `data/cases-insurance.json` 開頭變成一段中文說明文字而不是合法 JSON，網站讀取失敗。

規則：不管是人類還是 AI agent，透過 GitHub 網頁編輯器更新檔案時，**只貼該檔案該有的純內容**（例如純 JSON、純程式碼），絕對不要連同任何前言、任務描述、markdown code fence 標記一起貼進去。貼完之後第一行、最後幾行都要人工核對一次，確認是乾淨的檔案內容。

## 7. 已知的架構限制（暫不處理，僅供知悉）

`does-it-work-health-en.html` / `does-it-work-health-zh.html` 這類行銷/說明頁面，是每個語言各自獨立的靜態 HTML 檔案，沒有共用的 header/footer 模板或元件系統。這代表改動共用區塊（例如導覽列）時需要手動同步多個檔案，有不同步的風險。**目前刻意不處理這個問題**——因為要解決需要導入一套建置（build）系統，跟目前「直接改 HTML、直接部署」的簡單模式不相容，且尚未發生過實際的不同步事故。除非未來真的出現內容不同步的問題，否則不要主動建議重構這部分。

註：`simulator.html`（核心產品頁面）不在此限——它是單一檔案、用 JS（`obLang`/`obContent`）動態切換語言，沒有雙檔案不同步的風險。

## 8. 其他背景

- 兩個網站（agentraining.ai、coursify.art）目前共用同一組 Anthropic API 金鑰（Console 裡標籤為 `coursify-art`，純粹是命名，非限制）。
- Netlify site identifier：`magical-platypus-ba1dfe`
- 平台定位是「Sales Performance Platform」，訴求企業/團隊客戶（訓練主管管理 50+ 名業務員），文案應強調業務成果（成交率、上手速度、管理效率），不是強調 AI 技術本身。
