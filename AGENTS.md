# AGENTS.md — agentraining-site

給任何在這個 repo 上工作的 AI agent（Claude Code、Claude 網頁版、或其他工具）看的規則文件。開始改動之前，請先讀完這份文件。

---

## 1. 分支與部署規則（最重要，之前造成過長時間的線上事故）

### 1a. `master` = 正式環境，不直接改

- **`master` 是唯一的 production 分支。** Netlify 的 production 部署固定抓 `master`（可在 Netlify → Deploys 頁面確認，會顯示 `Production: master@xxxxxxx`）。
- **不要直接在 `master` 上編輯或 commit。** 所有實質改動（新功能、bug 修復、refactor）都必須走下面 1b 的流程。
- 唯一可以直接改 `master` 的情況：**文件修改**（README、AGENTS.md 等純文字說明檔），且改動不影響任何程式碼行為。

### 1b. 標準改動流程

1. **從 `master` 開出專用分支**，命名要能看出內容（如 `fix/knowledge-map-409`、`feat/capacity-banner`）。
2. 在分支上開發、commit。
3. **開 Draft Pull Request**（目標合併到 `master`）。Netlify 會自動產生 Deploy Preview URL。
4. **在 Deploy Preview 上做 UAT 驗證**——功能是否正常、有沒有 regression、console 有沒有新的錯誤。
5. PR 通過驗證後，由使用者（Lei）明確批准再合併。**AI agent 不得自行合併 PR。**
6. 合併前的 checklist：
   - PR 裡包含分支上所有必要的新檔案（本次事故教訓：`knowledge-map.mjs` 在分支上存在但 PR 裡遺漏，導致合併後 production 缺少關鍵函式）。
   - 如果分支新增了 `netlify/functions/` 底下的檔案，**逐一確認這些檔案都在 PR 的 diff 裡**。
   - Deploy Preview 的功能驗證通過。

### 1c. `main` 分支已廢棄

- **`main` 分支基本上是廢棄的，不要用。** `main` 上的 `data/` 資料夾（場景資料）根本不存在，`main` 的內容跟 `master` 已經嚴重分岔（相差 30+ commits）。曾經因為 `main` 跟 `master` 的 `netlify/functions/claude.js` 版本不同步，導致網站整整故障，一直到深入排查才發現。
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

### 4b. AI 教練的語氣：不要動不動搬出卡內基、孫子兵法（使用者 Lei 的指示）

教練的方法論背後確實是孫子兵法（先了解對方，再設法影響對方）和卡內基（真誠關心對方，讓客戶自己得出結論，不為贏得爭論而傷害關係）。但**教練回饋裡不可以動不動就點名引用**。學員一場練習碰到兩三次「根據卡內基原則……」「孫子兵法說……」，會覺得教條、說教，覺得 AI 很笨，久了就會生厭。

規則：
- 把這些想法**化進具體、白話的建議裡**，針對眼前這位客戶、這一句話來說，像一位有經驗的前輩，不像教科書。
- 教練要**真正掌握並在對話中運用**這些原則，而不是只「知道」它們。`simulator.html` 的 `COACH_METHOD` 是給教練的內部方法論，所有教練 prompt 都會帶上，分兩部分：
  1. **怎麼看銷售對話**：先了解客戶真正的顧慮再說服；選擇該打的仗（不是每個異議都要當場贏）；用提問引導，不用硬推；不贏了爭論卻輸了客戶（先認同再轉向）；真誠關心，用客戶說過的細節；讓客戶改變主意時保有面子。
  2. **怎麼對待學員**：教練用同樣的原則對待學員，用行動示範，而不是說教。先具體肯定做得好的地方；一次只抓最重要的一個改進點；把錯誤說成容易做到的下一步，有空間時用提問讓學員自己看到更好的說法；注意並說出學員的進步；把學員當成有能力的專業人士。
- 修改 `COACH_METHOD` 時，**內容本身也不可以出現書名、作者或「某某原則」的字眼**，否則模型會照著引用。
- **每輪評分、教練插話、結束時的總評：一律不點名**（不提孫子、孫子兵法、卡內基或任何書名、作者、「某某原則」）。這些請求每輪各自獨立，模型無法知道這次練習是否已經提過，所以只能全面禁止。
- **教練對話、複盤、Free Practice：預設也不點名。** 只有學員主動問起，或在非常少見、點名真的能幫上忙的情況下才可以，而且**整段對話最多一次、每位學員每星期最多兩次**。
- 每星期的次數由網頁計算（單一 AI 請求記不得之前的練習）：教練回覆裡只要出現孫子、孫子兵法、卡內基（中英文），就記錄在學員瀏覽器的 `localStorage`（`agentraining_coach_name_mentions`）。7 天內已達 `COACH_NAME_WEEKLY_LIMIT`（2 次），或這段對話已經提過，就改用 STRICT 備忘錄，連學員主動問起也只用白話回答。限制：換裝置或瀏覽器、清除瀏覽資料會重新計算。
- 程式位置：`simulator.html` 裡的 `COACH_STYLE_MEMO_STRICT`（評分、插話、總評）、`COACH_STYLE_MEMO_CHAT`，以及決定用哪一份的 `coachNameMemoForChat()`（教練對話、複盤、Free Practice）。新增或修改任何教練 prompt 時，都要帶上其中一個。
- 不適用於行銷頁面（如 `index.html` 介紹方法論的段落）。那是介紹產品，不是在對學員說教。

## 5. `netlify/functions/claude.js`

前端 `simulator.html` 送出 `{ system, messages, role }`。這個函式把 `system` 和 `messages` **原樣轉發**給 Anthropic，不要改回舊版單一 `message` 字串格式。

**模型分工（2026-11 起，為了降低 API 花費）：**

| `role` | 用途 | 模型與設定 |
|---|---|---|
| `'client'` | AI 客戶角色扮演 | `claude-haiku-5-5`，thinking 關閉（`{type:'disabled'}`），effort `low`，max_tokens 1000 |
| 其他（前端送 `'coach'`） | 評分、AI 教練插話、教練對話與複盤、Free Practice | `claude-sonnet-5-5`，adaptive thinking，effort `low`，max_tokens 2000，`fallbacks: "default"`（header `anthropic-beta: server-side-fallback-2026-07-01`） |

規則：
- **模型只能由伺服器端的 `MODEL_SETTINGS` 決定。** 前端只能選 `role`，不可以讓前端傳 `model`、`max_tokens` 等參數進來（防止被拿去跑昂貴的模型）。
- **回應只保留 `text` 區塊**，所以前端可以繼續用 `data.content[0].text`。新模型可能先回傳 `thinking` 區塊，不能用位置取答案。
- `stop_reason: "refusal"` 或沒有文字答案時回傳 502，不要回傳空內容。
- 不要送 `temperature` / `top_p` / `top_k`（這些模型會回 400）。Sonnet 5.5 不接受 `thinking: {type:'disabled'}`；Haiku 5.5 沒有 server-side fallback，不要加 `fallbacks`。
- 防濫用保護不可移除：來源網域白名單、每個 IP 每 10 分鐘 40 次、輸入長度上限 20000 字元。
- 測試：`tests/claude-proxy.test.mjs`（`npm test`）。
- 其他函式（`knowledge-chat.mjs`、`pilot-data.mjs`、`knowledge-question-bank.mjs`）目前仍使用 `claude-sonnet-4-6`，尚未切換。

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
