/* ===========================================================
   sentence-sort.js — Part 3: 文法重點 + 句型分類練習

   兩個獨立但常一起用的小元件：
   - GrammarPoints.render(...)：純顯示文法重點卡片
   - SentenceSort.render(...)：拖曳分類練習（練習模式 / 顯示模式）

   可重用元件。用法：

     GrammarPoints.render({
       containerId: "grammarPoints",
       points: LESSON.grammar.points
     });

     SentenceSort.render({
       poolId: "sentencePool",
       basketsId: "sortBaskets",
       displayListId: "sentenceDisplayList",
       sortModeBtnId: "sortModeBtn",
       displayModeBtnId: "displayModeBtn",
       resetBtnId: "resetSortBtn",
       checkBtnId: "checkSortBtn",
       statusId: "sortStatus",
       toolbarSelector: ".sort-toolbar",
       items: LESSON.grammar.sentence_structures.items   // 單課用法
     });

   跨課總覽（grammar-bank.html）用法：把多課的 items concat 起來，
   一樣可以運作，只是句子量變多、練習範圍變大。
=========================================================== */

const GrammarPoints = (function () {
  function render(options) {
    const wrap = document.getElementById(options.containerId);
    if (!wrap) {
      console.error("GrammarPoints: container not found:", options.containerId);
      return;
    }
    wrap.innerHTML = "";
    (options.points || []).forEach(gp => {
      const div = document.createElement("div");
      div.className = "card grammar-point";
      div.innerHTML = `
        <h3>${Loader.escapeHtml(gp.title)}</h3>
        <ul>${gp.examples.map(ex => `<li>${Loader.escapeHtml(ex)}</li>`).join("")}</ul>
      `;
      wrap.appendChild(div);
    });
  }
  return { render };
})();

const SentenceSort = (function () {
  const TYPE_LABELS = {
    simple: "Simple Sentence",
    compound: "Compound Sentence",
    complex: "Complex Sentence",
    "compound-complex": "Compound-Complex Sentence"
  };
  const TYPE_ORDER = ["simple", "compound", "complex", "compound-complex"];

  let state = {
    items: [],
    sortItems: [],
    placement: {},
    mode: "sort",
    draggedId: null,
    els: {},
    boundEls: new Set() // 記錄哪些按鈕元素已經綁過事件，避免重複 render 時疊加監聽器
  };

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function render(options) {
    state.items = options.items || [];
    state.sortItems = shuffle(state.items);
    state.placement = {};
    state.els = {
      pool: document.getElementById(options.poolId),
      baskets: document.getElementById(options.basketsId),
      displayList: document.getElementById(options.displayListId),
      sortModeBtn: document.getElementById(options.sortModeBtnId),
      displayModeBtn: document.getElementById(options.displayModeBtnId),
      resetBtn: document.getElementById(options.resetBtnId),
      checkBtn: document.getElementById(options.checkBtnId),
      status: document.getElementById(options.statusId),
      toolbar: options.toolbarSelector ? document.querySelector(options.toolbarSelector) : null
    };

    if (!state.els.pool || !state.els.baskets) {
      console.error("SentenceSort: pool/baskets element not found");
      return;
    }

    // 按鈕事件只綁一次：跨課總覽頁面篩選條件變動時會重複呼叫 render()，
    // 若每次都 addEventListener 會讓同一次點擊觸發多次 setMode/resetSort/checkSort。
    bindOnce(state.els.sortModeBtn, () => setMode("sort"));
    bindOnce(state.els.displayModeBtn, () => setMode("display"));
    bindOnce(state.els.resetBtn, resetSort);
    bindOnce(state.els.checkBtn, checkSort);

    renderBaskets();
    renderPool();
    renderDisplayList();
    setMode(state.mode || "sort");
  }

  function bindOnce(el, handler) {
    if (!el || state.boundEls.has(el)) return;
    el.addEventListener("click", handler);
    state.boundEls.add(el);
  }

  function setMode(mode) {
    state.mode = mode;
    if (state.els.sortModeBtn) state.els.sortModeBtn.classList.toggle("primary", mode === "sort");
    if (state.els.displayModeBtn) state.els.displayModeBtn.classList.toggle("primary", mode === "display");
    state.els.pool.style.display = mode === "sort" ? "flex" : "none";
    state.els.baskets.style.display = mode === "sort" ? "grid" : "none";
    if (state.els.displayList) state.els.displayList.classList.toggle("show", mode === "display");
    if (state.els.toolbar) state.els.toolbar.style.display = mode === "sort" ? "flex" : "none";
  }

  function renderBaskets() {
    const wrap = state.els.baskets;
    wrap.innerHTML = "";
    TYPE_ORDER.forEach(type => {
      const basket = document.createElement("div");
      basket.className = "basket";
      basket.dataset.type = type;
      basket.innerHTML = `<h4>${TYPE_LABELS[type]}</h4>`;
      basket.addEventListener("dragover", e => { e.preventDefault(); basket.classList.add("dragover"); });
      basket.addEventListener("dragleave", () => basket.classList.remove("dragover"));
      basket.addEventListener("drop", e => {
        e.preventDefault();
        basket.classList.remove("dragover");
        if (!state.draggedId) return;
        placeInBasket(state.draggedId, type);
      });
      wrap.appendChild(basket);
    });
  }

  function renderPool() {
    const pool = state.els.pool;
    pool.innerHTML = "";
    state.sortItems.forEach(item => {
      if (state.placement[item.id]) return;
      pool.appendChild(makeChip(item));
    });
    if (!pool.children.length) {
      pool.innerHTML = '<span style="color:var(--ink-soft); font-size:.82rem;">全部句子都已分類，按「對答案」查看結果。</span>';
    }
  }

  function makeChip(item) {
    const chip = document.createElement("div");
    chip.className = "sentence-chip";
    chip.draggable = true;
    chip.dataset.id = item.id;
    chip.textContent = item.sentence;
    chip.addEventListener("dragstart", () => {
      state.draggedId = item.id;
      chip.classList.add("dragging");
    });
    chip.addEventListener("dragend", () => chip.classList.remove("dragging"));
    return chip;
  }

  function placeInBasket(id, type) {
    state.placement[id] = type;
    renderPool();
    renderBasketContents();
    if (state.els.status) state.els.status.textContent = "";
  }

  function renderBasketContents() {
    state.els.baskets.querySelectorAll(".basket").forEach(basket => {
      const type = basket.dataset.type;
      basket.querySelectorAll(".sentence-chip").forEach(c => c.remove());
      state.sortItems.filter(it => state.placement[it.id] === type).forEach(item => {
        const chip = document.createElement("div");
        chip.className = "sentence-chip";
        chip.textContent = item.sentence;
        basket.appendChild(chip);
      });
    });
  }

  function resetSort() {
    state.placement = {};
    state.els.baskets.querySelectorAll(".sentence-chip").forEach(c => c.remove());
    renderPool();
    if (state.els.status) state.els.status.textContent = "";
  }

  function checkSort() {
    let correct = 0;
    const total = Object.keys(state.placement).length;

    state.els.baskets.querySelectorAll(".basket").forEach(basket => {
      const type = basket.dataset.type;
      basket.querySelectorAll(".sentence-chip").forEach(chip => chip.remove());
      state.sortItems.filter(it => state.placement[it.id] === type).forEach(item => {
        const chip = document.createElement("div");
        const isCorrect = item.type === type;
        chip.className = "sentence-chip " + (isCorrect ? "correct" : "incorrect");
        chip.innerHTML = `${Loader.escapeHtml(item.sentence)}<span class="pattern-tag">${
          isCorrect ? "✓ 正確" : "✗ 應屬於：" + TYPE_LABELS[item.type]
        }（${Loader.escapeHtml(item.pattern)}）</span>`;
        basket.appendChild(chip);
        if (isCorrect) correct++;
      });
    });

    const unplaced = state.sortItems.length - total;
    if (state.els.status) {
      state.els.status.textContent = `答對 ${correct} / ${state.sortItems.length}${unplaced > 0 ? `（尚有 ${unplaced} 句未分類）` : ""}`;
      state.els.status.style.color = (correct === state.sortItems.length && unplaced === 0) ? "var(--sage)" : "var(--accent)";
    }
  }

  function renderDisplayList() {
    if (!state.els.displayList) return;
    const wrap = state.els.displayList;
    wrap.innerHTML = "";
    TYPE_ORDER.forEach(type => {
      const items = state.items.filter(it => it.type === type);
      if (!items.length) return;
      const group = document.createElement("div");
      group.className = "type-group";
      group.innerHTML = `<h4>${TYPE_LABELS[type]}</h4>` + items.map(it => `
        <div class="sentence-row">
          <span>${Loader.escapeHtml(it.sentence)}</span>
          <span class="pattern-tag">${Loader.escapeHtml(it.pattern)}</span>
        </div>
      `).join("");
      wrap.appendChild(group);
    });
  }

  return { render };
})();
