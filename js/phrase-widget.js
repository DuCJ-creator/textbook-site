/* ===========================================================
   phrase-widget.js — Part 2: 片語卡片（瀏覽 / 測驗模式 + 搜尋）

   可重用元件。用法：

     PhraseWidget.render({
       gridId: "phraseGrid",
       countId: "phraseCount",
       searchInputId: "phraseSearch",
       browseBtnId: "browseBtn",
       quizBtnId: "quizBtn",
       items: LESSON.phrases.items      // 單課用法
     });

   跨課總覽（phrase-bank.html）用法：把多課的 items concat 起來，
   每個 item 額外標記 _book/_lesson，卡片上會自動顯示來源徽章。
=========================================================== */

const PhraseWidget = (function () {
  let state = {
    items: [],
    mode: "browse",       // 'browse' | 'quiz'
    revealedIds: new Set(),
    els: {},
    boundEls: new Set() // 記錄哪些元素已經綁過事件，避免重複 render() 時疊加監聽器
  };

  function render(options) {
    state.items = options.items || [];
    state.els = {
      grid: document.getElementById(options.gridId),
      count: document.getElementById(options.countId),
      search: document.getElementById(options.searchInputId),
      browseBtn: document.getElementById(options.browseBtnId),
      quizBtn: document.getElementById(options.quizBtnId)
    };

    if (!state.els.grid) {
      console.error("PhraseWidget: grid element not found:", options.gridId);
      return;
    }

    // 事件只綁一次：跨課總覽頁面篩選條件變動時會重複呼叫 render()，
    // 若每次都 addEventListener 會讓輸入/點擊觸發多次 renderList。
    bindOnce(state.els.search, "input", renderList);
    bindOnce(state.els.browseBtn, "click", () => setMode("browse"));
    bindOnce(state.els.quizBtn, "click", () => setMode("quiz"));

    // 保留目前模式與已翻開的答案（跨課頁面篩選時不應該重置使用者的測驗進度）
    applyModeUI(state.mode);
    renderList();
  }

  function bindOnce(el, eventName, handler) {
    if (!el || state.boundEls.has(el)) return;
    el.addEventListener(eventName, handler);
    state.boundEls.add(el);
  }

  // 使用者主動點擊切換模式：視為重新開始測驗，清空已翻開的答案
  function setMode(mode) {
    state.mode = mode;
    state.revealedIds.clear();
    applyModeUI(mode);
    renderList();
  }

  // 內部套用模式到 UI（不清空已翻開答案），render() 重繪時使用
  function applyModeUI(mode) {
    if (state.els.browseBtn) state.els.browseBtn.classList.toggle("active", mode === "browse");
    if (state.els.quizBtn) state.els.quizBtn.classList.toggle("active", mode === "quiz");
  }

  function renderList() {
    const query = (state.els.search ? state.els.search.value : "").trim().toLowerCase();
    const items = state.items.filter(p => {
      if (!query) return true;
      return p.phrase.toLowerCase().includes(query) || (p.zh || "").includes(query);
    });

    if (state.els.count) {
      state.els.count.textContent = `共 ${items.length} 筆${query ? "（已篩選）" : ""}`;
    }

    const grid = state.els.grid;
    grid.innerHTML = "";
    const isQuiz = state.mode === "quiz";

    items.forEach((p, i) => {
      const card = document.createElement("div");
      const isRevealed = state.revealedIds.has(p.id);
      card.className = "phrase-card" + (isQuiz ? " quiz" : "") + (isRevealed ? " revealed" : "");

      const sourceTag = (p._book && p._lesson)
        ? `<div class="num">${p._book.toUpperCase()} ${p._lesson.toUpperCase()} · ${String(i + 1).padStart(2, "0")}</div>`
        : `<div class="num">${String(i + 1).padStart(2, "0")}</div>`;

      card.innerHTML = `
        ${sourceTag}
        <div class="ph">${Loader.escapeHtml(p.phrase)}</div>
        <div class="zh">${Loader.escapeHtml(p.zh || "")}</div>
        <div class="ex">${Loader.escapeHtml(p.example_en || "")}</div>
        <div class="ex-zh">${Loader.escapeHtml(p.example_zh || "")}</div>
        ${isQuiz ? '<div class="reveal-hint">點卡片顯示答案</div>' : ""}
      `;

      if (isQuiz) {
        card.addEventListener("click", () => {
          if (state.revealedIds.has(p.id)) state.revealedIds.delete(p.id);
          else state.revealedIds.add(p.id);
          renderList();
        });
      }

      grid.appendChild(card);
    });
  }

  return { render };
})();
