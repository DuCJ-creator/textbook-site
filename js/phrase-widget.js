/* ===========================================================
   phrase-widget.js — Part 2: 片語卡片（瀏覽 / 測驗模式 + 搜尋 + 星標收藏）

   可重用元件。用法：

     PhraseWidget.render({
       gridId: "phraseGrid",
       countId: "phraseCount",
       searchInputId: "phraseSearch",
       browseBtnId: "browseBtn",
       quizBtnId: "quizBtn",
       starredOnlyBtnId: "starredOnlyBtn",  // 選填：只看已標星的切換鈕
       items: LESSON.phrases.items      // 單課用法
     });

   跨課總覽（phrase-bank.html）用法：把多課的 items concat 起來，
   每個 item 額外標記 _book/_lesson，卡片上會自動顯示來源徽章。

   星標狀態存在瀏覽器 localStorage（key: STORAGE_KEY），跨頁面共用
   同一份收藏清單——在單課頁面標星的片語，去 phrase-bank.html 也會
   看到已標星狀態，因為判斷依據是片語的 id（例如 "b1l1-p001"），
   不是頁面本身的資料。同一台裝置、同一個瀏覽器才會看到收藏，
   換裝置或清除瀏覽器資料會遺失，這是純前端 localStorage 的固有限制。
=========================================================== */

const PhraseWidget = (function () {
  const STORAGE_KEY = "phraseStarredIds";

  function loadStarredIds() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch (e) {
      return new Set();
    }
  }

  function saveStarredIds(set) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
    } catch (e) {
      // localStorage 可能因隱私模式或空間不足而寫入失敗，安靜忽略即可，不影響其他功能
    }
  }

  let state = {
    items: [],
    mode: "browse",       // 'browse' | 'quiz'
    revealedIds: new Set(),
    starredIds: loadStarredIds(),
    starredOnly: false,
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
      quizBtn: document.getElementById(options.quizBtnId),
      starredOnlyBtn: options.starredOnlyBtnId ? document.getElementById(options.starredOnlyBtnId) : null
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
    bindOnce(state.els.starredOnlyBtn, "click", toggleStarredOnly);

    // 保留目前模式與已翻開的答案（跨課頁面篩選時不應該重置使用者的測驗進度）
    applyModeUI(state.mode);
    applyStarredOnlyUI();
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

  function toggleStarredOnly() {
    state.starredOnly = !state.starredOnly;
    applyStarredOnlyUI();
    renderList();
  }

  function applyStarredOnlyUI() {
    if (state.els.starredOnlyBtn) {
      state.els.starredOnlyBtn.classList.toggle("active", state.starredOnly);
      state.els.starredOnlyBtn.textContent = state.starredOnly ? "★ 只看已收藏" : "☆ 只看已收藏";
    }
  }

  function toggleStar(id) {
    if (state.starredIds.has(id)) state.starredIds.delete(id);
    else state.starredIds.add(id);
    saveStarredIds(state.starredIds);
    renderList();
  }

  function renderList() {
    const query = (state.els.search ? state.els.search.value : "").trim().toLowerCase();
    let items = state.items.filter(p => {
      if (!query) return true;
      return p.phrase.toLowerCase().includes(query) || (p.zh || "").includes(query);
    });

    if (state.starredOnly) {
      items = items.filter(p => state.starredIds.has(p.id));
    }

    if (state.els.count) {
      const parts = [`共 ${items.length} 筆`];
      if (query) parts.push("已篩選");
      if (state.starredOnly) parts.push("只看收藏");
      state.els.count.textContent = parts.join("・");
    }

    const grid = state.els.grid;
    grid.innerHTML = "";
    const isQuiz = state.mode === "quiz";

    if (!items.length && state.starredOnly) {
      grid.innerHTML = '<p style="color:var(--ink-soft); font-size:.85rem; grid-column:1/-1;">還沒有收藏任何片語，點卡片右上角的星星即可收藏。</p>';
      return;
    }

    items.forEach((p, i) => {
      const card = document.createElement("div");
      const isRevealed = state.revealedIds.has(p.id);
      const isStarred = state.starredIds.has(p.id);
      card.className = "phrase-card" + (isQuiz ? " quiz" : "") + (isRevealed ? " revealed" : "");

      const sourceTag = (p._book && p._lesson)
        ? `<div class="num">${p._book.toUpperCase()} ${p._lesson.toUpperCase()} · ${String(i + 1).padStart(2, "0")}</div>`
        : `<div class="num">${String(i + 1).padStart(2, "0")}</div>`;

      card.innerHTML = `
        <button type="button" class="star-btn${isStarred ? " starred" : ""}" aria-label="收藏這個片語" title="收藏">${isStarred ? "★" : "☆"}</button>
        ${sourceTag}
        <div class="ph">${Loader.escapeHtml(p.phrase)}</div>
        <div class="zh">${Loader.escapeHtml(p.zh || "")}</div>
        <div class="ex">${Loader.escapeHtml(p.example_en || "")}</div>
        <div class="ex-zh">${Loader.escapeHtml(p.example_zh || "")}</div>
        ${isQuiz ? '<div class="reveal-hint">點卡片顯示答案</div>' : ""}
      `;

      // 星標按鈕的點擊不該觸發卡片本身的翻牌互動（測驗模式），所以要阻止事件冒泡
      card.querySelector(".star-btn").addEventListener("click", e => {
        e.stopPropagation();
        toggleStar(p.id);
      });

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
