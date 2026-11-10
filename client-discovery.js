/* Client Discovery v1: anonymous demo-only guided AI interview for existing local Client Studio.
   No production customer PII or cloud case sync. AI requests use the existing bounded demo proxy. */
(function () {
  "use strict";
  const DRAFT_KEY = "agentraining_client_discovery_draft_v1";
  const FIRST_QUESTION = {
    en: "How did you first connect with this potential client, and what have they agreed to discuss?",
    zh: "你是怎样认识这位潜在客户的？对方目前同意和你讨论什么？"
  };
  const empty = () => ({ version: 1, alias: "Demo Prospect", industry: "Insurance", turns: [], insights: null, nextQuestion: null });
  let state = empty(), dialog, answer, question, feedback, saveButton, submitButton, consent, aliasInput, industryInput, voiceButton;
  let pending = false, voiceBusy = false, voiceControl = null;
  const lang = () => {
    try { return ((new URLSearchParams(location.search).get("lang") || sessionStorage.getItem("agentraining_lang") || navigator.language || "en").toLowerCase().startsWith("zh")) ? "zh" : "en"; }
    catch { return "en"; }
  };
  const t = (en, zh) => lang() === "zh" ? zh : en;
  const byId = id => document.getElementById(id);
  const bounded = (s, n) => String(s == null ? "" : s).trim().slice(0, n);
  const textList = (x, limit) => Array.isArray(x) ? x.filter(v => typeof v === "string").map(v => bounded(v, 180)).filter(Boolean).slice(0, limit) : [];
  const hasSensitiveIdentifiers = s => /[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b|\b\d{3}-\d{2}-\d{4}\b/i.test(s);
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (raw && raw.version === 1 && Array.isArray(raw.turns)) {
        state = Object.assign(empty(), raw);
        state.turns = raw.turns.slice(0, 5).filter(v => typeof v.answer === "string" && typeof v.question === "string");
        state.alias = bounded(state.alias, 60) || "Demo Prospect";
        state.industry = state.industry === "Health" ? "Health" : "Insurance";
      }
    } catch { state = empty(); }
  }
  function persist() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); }
    catch { displayStatus(t("Unable to save this draft on this browser.", "无法在本浏览器保存草稿。")); }
  }
  function displayStatus(message) { if (feedback) feedback.textContent = message; }
  function writeList(parent, title, items) {
    const p = document.createElement("p");
    const heading = document.createElement("strong");
    heading.textContent = title;
    p.appendChild(heading);
    if (!items.length) {
      p.appendChild(document.createTextNode(" " + t("Not enough information yet.", "信息尚不充分。")));
    } else {
      const ul = document.createElement("ul");
      items.forEach(item => { const li = document.createElement("li"); li.textContent = item; ul.appendChild(li); });
      p.appendChild(ul);
    }
    parent.appendChild(p);
  }
  function render() {
    if (!dialog) return;
    byId("cs-ai-step").textContent = state.turns.length >= 5 ? t("Discovery complete · 5 of 5", "访谈已完成 · 5/5") : t("Answer ", "回答第 ") + (state.turns.length + 1) + t(" of up to 5", " 个问题（最多 5 个）");
    question.textContent = state.turns.length >= 5 ? t("Review the Client Understanding Map below, then save the case.", "请核对下方客户理解地图，再保存客户档案。") : (state.nextQuestion || FIRST_QUESTION[lang()]);
    aliasInput.value = state.alias;
    industryInput.value = state.industry;
    saveButton.disabled = !state.insights || !state.turns.length || pending;
    submitButton.disabled = pending || voiceBusy || state.turns.length >= 5;
    byId("cs-ai-answer-label").textContent = t("Your answer (without private client identifiers)", "你的回答（勿填写客户身份及敏感资料）");
    submitButton.textContent = pending ? t("Thinking…", "正在分析…") : t("Send answer to AI", "发送回答给 AI");
    saveButton.textContent = t("Save case & open Practice path", "保存客户档案并进入练习流程");
    const map = byId("cs-ai-map");
    map.replaceChildren();
    if (state.insights) {
      writeList(map, t("Learner-reported facts (not independently verified):", "学员陈述的事实（尚未独立核实）："), state.insights.facts);
      writeList(map, t("Information gaps:", "尚待了解的信息："), state.insights.unknowns);
      writeList(map, t("Hypotheses to verify:", "需要核实的假设："), state.insights.hypotheses);
      const p = document.createElement("p");
      const bold = document.createElement("strong");
      bold.textContent = t("Suggested next approach: ", "建议的下一次接触方式：");
      p.appendChild(bold);
      p.appendChild(document.createTextNode(state.insights.approach || t("Ask permission to understand needs before discussing products.", "先征得同意、了解需求，再考虑介绍产品。")));
      map.appendChild(p);
    } else {
      const p = document.createElement("p");
      p.textContent = t("After your first answer, the AI will identify what you know, what is missing, and ask a relevant follow-up.", "回答第一个问题后，AI 会整理已知信息、信息缺口，并针对你的回答继续追问。");
      map.appendChild(p);
    }
  }
  function parseAI(raw) {
    const text = (raw.content || []).filter(x => x && x.type === "text").map(x => x.text || "").join("\n");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(t("AI did not return a structured answer.", "AI 未返回结构化回答。"));
    const obj = JSON.parse(match[0]);
    if (!obj || typeof obj.nextQuestion !== "string") throw new Error(t("AI answer was incomplete.", "AI 回答不完整。"));
    return {
      nextQuestion: bounded(obj.nextQuestion, 350),
      facts: textList(obj.facts, 7),
      unknowns: textList(obj.unknowns, 6),
      hypotheses: textList(obj.hypotheses, 5),
      approach: bounded(obj.approach, 700),
      objection: bounded(obj.objection, 240)
    };
  }
  async function submitAnswer() {
    if (pending || voiceBusy || state.turns.length >= 5) return;
    if (!consent.checked) { displayStatus(t("Please confirm anonymous-demo consent first.", "请先确认同意仅使用匿名示例数据。")); return; }
    const response = bounded(answer.value, 3000);
    if (response.length < 4) { displayStatus(t("Please add a little more context.", "请再补充一点背景。")); return; }
    if (hasSensitiveIdentifiers(response)) { displayStatus(t("Remove email, phone, or government ID before sending.", "发送前请删除邮箱、电话号码或证件号码。")); return; }
    const q = state.nextQuestion || FIRST_QUESTION[lang()];
    const turns = state.turns.concat([{ question: q, answer: response }]).slice(-5);
    const system = [
      "You are the Client Discovery coach for an insurance-advisor training DEMO, not an insurance recommendation engine.",
      "Input is fictional/anonymized prospect context. Do not request names, contact details, medical history, exact financial values, protected class, or government identifiers.",
      "Coach a novice advisor to learn about a prospective client's goals, relationship, permission to contact, and information gaps.",
      "Return ONLY valid JSON: {\"nextQuestion\":\"...\",\"facts\":[\"...\"],\"unknowns\":[\"...\"],\"hypotheses\":[\"...\"],\"approach\":\"...\",\"objection\":\"...\"}.",
      "Facts must be learner-reported only, never invented; distinguish hypotheses from facts. Do not infer age, health, wealth, family, or coverage details.",
      "Ask ONE specific, natural next question based on the last answer; skip repetitive questions. Recommend a respectful, permission-based approach and no high-pressure selling.",
      "If information is insufficient, leave objection empty. Never make compliance or coverage promises. Language: " + (lang() === "zh" ? "Traditional Chinese" : "English")
    ].join("\n");
    pending = true; render(); displayStatus(t("AI is reviewing your answer…", "AI 正在分析你的回答…"));
    try {
      const res = await fetch("/.netlify/functions/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_tokens: 600, system, messages: [{ role: "user", content: JSON.stringify({ prior: turns, previousMap: state.insights, instruction: "Analyze the latest answer and provide an updated map and next question. Keep each item brief." }) }] })
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(bounded(json.error || ("HTTP " + res.status), 180));
      const result = parseAI(json);
      state.turns = turns;
      state.insights = { facts: result.facts, unknowns: result.unknowns, hypotheses: result.hypotheses, approach: result.approach, objection: result.objection };
      state.nextQuestion = result.nextQuestion;
      state.alias = bounded(aliasInput.value, 60) || "Demo Prospect";
      state.industry = industryInput.value === "Health" ? "Health" : "Insurance";
      persist(); answer.value = "";
      displayStatus(state.turns.length >= 5 ? t("Discovery complete. Review and save this local demo case.", "访谈完成。核对后可保存匿名示例客户档案。") : t("Map updated. You can answer the next question or save this draft.", "理解地图已更新。可以继续回答，也可以保存当前客户档案。"));
    } catch (err) { displayStatus(t("AI request failed; your unsent answer remains here. ", "AI 请求失败；回答仍保留在输入框内。") + bounded(err.message, 160)); }
    finally { pending = false; render(); }
  }
  function finish() {
    if (!state.turns.length || !state.insights || pending) return;
    if (!consent.checked) { displayStatus(t("Confirm anonymous-demo consent before saving.", "保存前请确认匿名示例数据同意。")); return; }
    if (typeof getClientCases !== "function" || typeof saveClientCasesList !== "function" || typeof genCaseId !== "function") {
      displayStatus(t("Client case storage is not available.", "客户档案保存功能暂不可用。")); return;
    }
    const alias = bounded(aliasInput.value, 60) || "Demo Prospect";
    if (hasSensitiveIdentifiers(alias)) { displayStatus(t("Use an alias, not contact details.", "请使用代号，不要填写联系方式。")); return; }
    const now = new Date().toISOString();
    const factSummary = state.insights.facts.slice(0, 5).join("; ");
    const record = {
      id: genCaseId(), clientName: alias, caseType: "client",
      industry: industryInput.value === "Health" ? "Health" : "Insurance",
      need: bounded(factSummary || state.turns.map(v => v.answer).join("; "), 600),
      objection: bounded(state.insights.objection, 240), status: "New",
      nextFollowUp: "", createdAt: now, updatedAt: now,
      practiceHistory: [], lastPractice: null,
      clientDiscovery: { version: 1, turns: state.turns, facts: state.insights.facts, unknowns: state.insights.unknowns, hypotheses: state.insights.hypotheses, approach: state.insights.approach, anonymousDemo: true }
    };
    const cases = getClientCases();
    cases.push(record);
    saveClientCasesList(cases);
    if (!getClientCases().some(c => c.id === record.id)) {
      displayStatus(t("Could not verify local save. Please check browser storage settings.", "未能确认本地保存成功，请检查浏览器储存设置。"));
      return;
    }
    localStorage.removeItem(DRAFT_KEY);
    state = empty();
    dialog.close();
    if (typeof openClientStudio === "function") openClientStudio();
    if (typeof openCaseDetail === "function") openCaseDetail(record.id);
  }
  function refreshDetail(c) {
    if (!c || !c.clientDiscovery) return;
    const d = c.clientDiscovery, body = byId("cs-detail-body");
    if (!body) return;
    const panel = document.createElement("div");
    panel.className = "cs-ai-case-map";
    const h = document.createElement("h3");
    h.textContent = t("Client Understanding Map · Anonymous Demo", "客户理解地图 · 匿名示例");
    panel.appendChild(h);
    writeList(panel, t("Reported facts:", "学员陈述："), textList(d.facts, 7));
    writeList(panel, t("Information gaps:", "信息缺口："), textList(d.unknowns, 6));
    writeList(panel, t("Hypotheses to verify:", "待核实假设："), textList(d.hypotheses, 5));
    const p = document.createElement("p");
    p.textContent = t("Suggested approach: ", "建议接触方式：") + bounded(d.approach, 700);
    panel.appendChild(p);
    const actions = body.querySelector(".cs-detail-actions");
    body.insertBefore(panel, actions || null);
  }
  function setup() {
    const newCase = byId("cs-new-case-btn");
    if (!newCase || byId("cs-ai-start")) return;
    const style = document.createElement("style");
    style.textContent = ".cs-ai-start{margin:0 0 12px 10px;padding:10px 15px;border:1px solid #2563eb;border-radius:10px;background:#eff6ff;color:#1d4ed8;font-weight:750}.cs-ai-dialog{border:1px solid #dbeafe;border-radius:16px;max-width:730px;width:calc(100% - 24px);max-height:90vh;overflow:auto;padding:22px;margin:auto;color:#111827;background:white;box-shadow:0 18px 70px #0004}.cs-ai-dialog::backdrop{background:#111827a8}.cs-ai-dialog h2{font-size:22px;margin:0 0 10px}.cs-ai-dialog p{line-height:1.6;margin:8px 0}.cs-ai-dialog input:not([type=checkbox]),.cs-ai-dialog textarea,.cs-ai-dialog select{width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:10px;font:inherit;margin:5px 0 10px}.cs-ai-dialog textarea{min-height:95px;resize:vertical}.cs-ai-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.cs-ai-row label{flex:1 1 180px}.cs-ai-dialog button{padding:10px 12px;border-radius:9px;background:#1a56db;color:white;font-weight:700}.cs-ai-dialog button.secondary{background:#e2e8f0;color:#1e293b}.cs-ai-dialog button:disabled{opacity:.5}.cs-ai-note{font-size:12px;color:#64748b}.cs-ai-map,.cs-ai-case-map{background:#f8fafc;border:1px solid #dbeafe;border-radius:12px;padding:14px;margin:13px 0}.cs-ai-map p,.cs-ai-case-map p{margin:8px 0;line-height:1.55}.cs-ai-map ul,.cs-ai-case-map ul{padding-left:22px;margin:5px 0}.cs-ai-status{font-size:13px;color:#1d4ed8;margin:10px 0;min-height:22px}";
    document.head.appendChild(style);
    const btn = document.createElement("button");
    btn.id = "cs-ai-start"; btn.type = "button"; btn.className = "cs-ai-start";
    btn.textContent = t("AI Client Discovery (demo)", "AI 潜在客户探索（示例）");
    newCase.insertAdjacentElement("afterend", btn);
    dialog = document.createElement("dialog"); dialog.id = "cs-ai-dialog"; dialog.className = "cs-ai-dialog";
    dialog.innerHTML =
      '<h2>' + t("AI Client Discovery", "AI 潜在客户探索") + '</h2>' +
      '<p class="cs-ai-note">' + t("Experimental demo: use only fictional or anonymized situations. When you record, audio is sent to an OpenAI transcription service; the site does not save the audio. AI analyzes the checked text; the case and draft stay in this browser. Never record actual client identifiers, medical records, or account details.", "实验性示例：只使用虚构或匿名情境。录音会发送给 OpenAI 语音转写服务，本站不会保存录音。确认文字后才交给 AI 分析；档案及草稿仅存于本浏览器。请勿录入真实客户身份、病历或账户信息。") + '</p>' +
      '<div class="cs-ai-row"><label>' + t("Fictional client alias (sent to AI during Practice)", "虚构客户代号（进入 Practice 后将发送给 AI）") + '<input id="cs-ai-alias" maxlength="60"></label><label>' + t("Industry", "行业") + '<select id="cs-ai-industry"><option value="Insurance">Insurance</option><option value="Health">Health</option></select></label></div>' +
      '<label><input type="checkbox" id="cs-ai-consent"> ' + t("I will use fictional/anonymized information and consent to AI processing; recorded audio is sent to a speech transcription service if I record.", "我只使用虚构或匿名示例信息，同意 AI 处理；使用录音时，音频将发送至语音转写服务。") + '</label>' +
      '<p><strong id="cs-ai-step"></strong></p><p id="cs-ai-question"></p>' +
      '<label id="cs-ai-answer-label" for="cs-ai-answer"></label><textarea id="cs-ai-answer" maxlength="3000"></textarea>' +
      '<div class="cs-ai-row"><button class="secondary" type="button" id="cs-ai-voice">' + t("🎤 Dictate", "🎤 语音输入") + '</button><button type="button" id="cs-ai-submit"></button></div>' +
      '<div id="cs-ai-feedback" class="cs-ai-status" role="status" aria-live="polite"></div>' +
      '<div id="cs-ai-map" class="cs-ai-map"></div>' +
      '<div class="cs-ai-row"><button type="button" id="cs-ai-save"></button><button type="button" class="secondary" id="cs-ai-reset">' + t("New interview", "重新访谈") + '</button><button type="button" class="secondary" id="cs-ai-close">' + t("Close", "关闭") + '</button></div>';
    document.body.appendChild(dialog);
    answer = byId("cs-ai-answer"); question = byId("cs-ai-question"); feedback = byId("cs-ai-feedback");
    saveButton = byId("cs-ai-save"); submitButton = byId("cs-ai-submit"); consent = byId("cs-ai-consent");
    aliasInput = byId("cs-ai-alias"); industryInput = byId("cs-ai-industry"); voiceButton = byId("cs-ai-voice");
    btn.addEventListener("click", () => { load(); render(); displayStatus(""); consent.checked = false; dialog.showModal(); });
    submitButton.addEventListener("click", submitAnswer);
    saveButton.addEventListener("click", finish);
    byId("cs-ai-close").addEventListener("click", () => dialog.close());
    byId("cs-ai-reset").addEventListener("click", () => { if (pending) return; state = empty(); try { localStorage.removeItem(DRAFT_KEY); } catch {} answer.value = ""; consent.checked = false; render(); displayStatus(""); });
    aliasInput.addEventListener("change", () => { state.alias = bounded(aliasInput.value, 60) || "Demo Prospect"; persist(); });
    industryInput.addEventListener("change", () => { state.industry = industryInput.value; persist(); });
    if (typeof window.setupClientDiscoveryVoice === "function") {
      voiceControl = window.setupClientDiscoveryVoice(
        voiceButton, answer, displayStatus,
        () => {
          if (pending || state.turns.length >= 5) return false;
          if (!consent.checked) {
            displayStatus(t("Consent to anonymous demo/audio processing before recording.",
                            "录音前请先确认匿名示例及音频处理同意。"));
            return false;
          }
          return true;
        },
        busy => { voiceBusy = busy; render(); }
      );
      dialog.addEventListener("close", () => { if (voiceControl) voiceControl.cancel(); });
    } else {
      voiceButton.disabled = true;
      voiceButton.title = t("Audio capture is unavailable. Type your answer.",
                            "语音录音不可用，请手动输入。");
    }
    if (typeof window.renderCaseDetail === "function") {
      const original = window.renderCaseDetail;
      window.renderCaseDetail = function (c) { original(c); refreshDetail(c); };
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
  else setup();
})();