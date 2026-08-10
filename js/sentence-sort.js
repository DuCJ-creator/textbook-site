/* ===========================================================
   sentence-sort.js — Part 3: 文法重點 + 句型分類練習

   兩個獨立但常一起用的小元件：
   - GrammarPoints.render(...)：純顯示文法重點卡片（紅字標題）
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
       modeSwitchSelector: ".mode-switch",   // 只包住模式切換鈕的容器，永遠可見
       actionsSelector: ".sort-actions",      // 只有練習模式才需要的動作鈕（重新開始/對答案），容器
       items: LESSON.grammar.sentence_structures.items   // 單課用法
     });

   跨課總覽（grammar-bank.html）用法：把多課的 items concat 起來，
   一樣可以運作，只是句子量變多、練習範圍變大。

   每個句子在 pool / 分類籃 / 顯示模式表格裡都會顯示原始編號（依 CSV 的
   no 欄位或原始順序），方便老師與學生對照講義。
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
    boundEls: new Set() // 記錄哪些元素已經綁過事件，避免重複 render() 時疊加監聽器
  };

  // 依編號（displayNo）由小到大排序，讓練習模式的句子照講義順序出現，
  // 不再隨機打亂——方便老師與學生對照紙本教材逐句練習。
  // 若 id 沒有可辨識的編號格式，保留原始陣列順序（用原始索引位置排序）。
  function sortByNo(items) {
    return items
      .map((item, i) => ({ item, no: Number(displayNo(item, i)), origIndex: i }))
      .sort((a, b) => {
        if (Number.isNaN(a.no) && Number.isNaN(b.no)) return a.origIndex - b.origIndex;
        if (Number.isNaN(a.no)) return 1;
        if (Number.isNaN(b.no)) return -1;
        return a.no - b.no;
      })
      .map(x => x.item);
  }

  // 從 item.id（例如 "b1l1-s004"）取出編號給使用者看；沒有編號格式就用陣列序位代替
  function displayNo(item, indexInOriginal) {
    const match = /-s0*(\d+)$/.exec(item.id || "");
    if (match) return match[1];
    return String(indexInOriginal + 1);
  }

  function render(options) {
    state.items = options.items || [];
    state.sortItems = sortByNo(state.items);
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
      // modeSwitch 容器只裝「練習模式／顯示模式」兩顆按鈕，永遠顯示，
      // 這樣使用者切到顯示模式後仍然看得到、點得到切換鈕，能隨時切回來。
      modeSwitch: options.modeSwitchSelector ? document.querySelector(options.modeSwitchSelector) : null,
      // actions 容器裝「重新開始／對答案」，這兩個只有練習模式下才有意義，顯示模式會隱藏。
      actions: options.actionsSelector ? document.querySelector(options.actionsSelector) : null
    };

    if (!state.els.pool || !state.els.baskets) {
      console.error("SentenceSort: pool/baskets element not found");
      return;
    }

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
    if (state.els.sortModeBtn) state.els.sortModeBtn.classList.toggle("active", mode === "sort");
    if (state.els.displayModeBtn) state.els.displayModeBtn.classList.toggle("active", mode === "display");
    state.els.pool.style.display = mode === "sort" ? "flex" : "none";
    state.els.baskets.style.display = mode === "sort" ? "grid" : "none";
    if (state.els.displayList) state.els.displayList.classList.toggle("show", mode === "display");
    // 只隱藏「重新開始／對答案」這兩個練習專用按鈕，模式切換鈕本身（modeSwitch）永遠留著，
    // 這是修正過去「切到顯示模式後找不到按鈕切回練習模式」問題的關鍵。
    if (state.els.actions) state.els.actions.style.display = mode === "sort" ? "flex" : "none";
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

    // 題目池本身也要能接收 drop：把句子從籃子拖回池子，等同取消分類。
    // 這樣拉錯籃子時可以直接拖回池子重新選，不用先按「重新開始」整批重來。
    const pool = state.els.pool;
    pool.addEventListener("dragover", e => { e.preventDefault(); pool.classList.add("dragover"); });
    pool.addEventListener("dragleave", () => pool.classList.remove("dragover"));
    pool.addEventListener("drop", e => {
      e.preventDefault();
      pool.classList.remove("dragover");
      if (!state.draggedId) return;
      removeFromBasket(state.draggedId);
    });
  }

  function renderPool() {
    const pool = state.els.pool;
    pool.innerHTML = "";
    state.sortItems.forEach((item, i) => {
      if (state.placement[item.id]) return;
      pool.appendChild(makeChip(item, i, null));
    });
    if (!pool.children.length) {
      pool.innerHTML = '<span style="color:var(--ink-soft); font-size:.82rem;">全部句子都已分類，按「對答案」查看結果。</span>';
    }
  }

  // 建立一個可拖曳的句子卡片。currentType 是 null 代表卡片目前在題目池裡，
  // 否則代表卡片目前在某個分類籃裡——兩種情況都要能繼續拖曳（拉出去重新分類）。
  function makeChip(item, indexInOriginal, currentType) {
    const chip = document.createElement("div");
    chip.className = "sentence-chip";
    chip.draggable = true;
    chip.dataset.id = item.id;
    chip.innerHTML = `<span class="s-no">${Loader.escapeHtml(displayNo(item, indexInOriginal))}</span>${Loader.escapeHtml(item.sentence)}`;
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

  // 把句子從目前的分類籃移回題目池（取消分類）
  function removeFromBasket(id) {
    if (!state.placement[id]) return; // 本來就在池子裡，不用處理
    delete state.placement[id];
    renderPool();
    renderBasketContents();
    if (state.els.status) state.els.status.textContent = "";
  }

  function renderBasketContents() {
    state.els.baskets.querySelectorAll(".basket").forEach(basket => {
      const type = basket.dataset.type;
      basket.querySelectorAll(".sentence-chip").forEach(c => c.remove());
      state.sortItems.forEach((item, i) => {
        if (state.placement[item.id] !== type) return;
        basket.appendChild(makeChip(item, i, type));
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
    const total = Object.keys(state.placement).length;
    const unplaced = state.sortItems.length - total;

    // 允許還沒分類完就提交，但先確認一次，避免誤觸「對答案」漏看還沒做的句子
    if (unplaced > 0) {
      const proceed = window.confirm(`還有 ${unplaced} 句尚未分類，確定要提交查看結果嗎？`);
      if (!proceed) return;
    }

    let correct = 0;
    state.els.baskets.querySelectorAll(".basket").forEach(basket => {
      const type = basket.dataset.type;
      basket.querySelectorAll(".sentence-chip").forEach(chip => chip.remove());
      state.sortItems.forEach((item, i) => {
        if (state.placement[item.id] !== type) return;
        const chip = document.createElement("div");
        const isCorrect = item.type === type;
        chip.className = "sentence-chip " + (isCorrect ? "correct" : "incorrect");
        chip.innerHTML = `<span class="s-no">${Loader.escapeHtml(displayNo(item, i))}</span>${Loader.escapeHtml(item.sentence)}<span class="pattern-tag">${
          isCorrect ? "✓ 正確" : "✗ 應屬於：" + TYPE_LABELS[item.type]
        }（${Loader.escapeHtml(item.pattern)}）</span>`;
        basket.appendChild(chip);
        if (isCorrect) correct++;
      });
    });

    if (state.els.status) {
      state.els.status.textContent = `答對 ${correct} / ${state.sortItems.length}${unplaced > 0 ? `（尚有 ${unplaced} 句未分類）` : ""}`;
      state.els.status.style.color = (correct === state.sortItems.length && unplaced === 0) ? "var(--sage)" : "#c23b3b";
    }
  }

  // 顯示模式：依句型分類，每一類用「編號 | 句子 | 句型標籤」的兩欄對照表格呈現，
  // 讓學生一眼看出句子與句型的對應關係，不需要互動也能拿來複習。
  function renderDisplayList() {
    if (!state.els.displayList) return;
    const wrap = state.els.displayList;
    wrap.innerHTML = "";
    TYPE_ORDER.forEach(type => {
      const items = state.items
        .map((it, i) => ({ ...it, _origIndex: i }))
        .filter(it => it.type === type);
      if (!items.length) return;

      const group = document.createElement("div");
      group.className = "type-group";
      group.innerHTML = `
        <h4>${TYPE_LABELS[type]}</h4>
        <div class="type-table">
          ${items.map(it => `
            <div class="sentence-row">
              <span class="s-no-cell">${Loader.escapeHtml(displayNo(it, it._origIndex))}</span>
              <span class="s-text-cell">${Loader.escapeHtml(it.sentence)}</span>
              <span class="s-pattern-cell">${Loader.escapeHtml(it.pattern)}</span>
            </div>
          `).join("")}
        </div>
      `;
      wrap.appendChild(group);
    });
  }

  return { render };
})();
