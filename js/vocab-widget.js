/* ===========================================================
   vocab-widget.js — Part I: Word Family 字族探索元件

   採「字族標籤 + POS 四欄 + 詳情卡」的互動方式：
   - 上方是可橫向捲動的字族標籤列，點一個字族就切換顯示區
   - 中間是 Verb / Noun / Adjective / Adverb 四欄，屬於目前字族的字分別歸位
   - 下方詳情卡在使用者點某個字時「原地更新」，不需要捲動頁面
     （這是修正過去表格版「點字後要捲到最下面才看得到」問題的關鍵）
   - 同一字族內的字彼此的關聯，透過「同一標籤底下」與「四欄並排」
     這兩層視覺分組直接呈現，不需要額外連線或圖示

   可重用元件。用法：

     VocabWidget.render({
       railId: "familyRail",
       nameId: "familyName",
       progressId: "familyProgress",
       gridId: "posGrid",
       panelId: "detailPanel",
       countId: "wordCount",           // 選填：頁首「共 N 個字族／N 個項目」
       rows: LESSON.vocabulary.rows,    // 單課用法，每個 row 是一個字族
       onSelect: (entry, row) => {}      // 選填：跨課總覽可能想額外顯示「來自 B1L1」
     });

   跨課總覽（vocab-bank.html）用法：把多課的 rows concat 起來，
   每個 row 額外標記 _book/_lesson，再傳進來即可；元件本身不關心
   資料來自幾課，只負責渲染與互動。
=========================================================== */

const VocabWidget = (function () {
  const POS_ORDER = ["verb", "noun", "adj", "adv"];
  const POS_LABELS = { verb: "Verb", noun: "Noun", adj: "Adjective", adv: "Adverb" };
  const POS_LABELS_ZH = { verb: "動詞", noun: "名詞", adj: "形容詞", adv: "副詞" };

  let state = {
    rows: [],
    els: {},
    currentFamilyIndex: 0,
    currentEntry: null, // { pos, entries, idx, row }
    onSelect: null,
    boundEls: new Set()
  };

  // 把一個字族 row（{id, verb:[], noun:[], adj:[], adv:[]}）攤平成字詞清單，
  // 方便算「這個字族共有幾個項目」、決定預設要顯示哪一個字
  function familyWords(row) {
    return POS_ORDER.flatMap(pos => (row[pos] || []).map(e => ({ ...e, pos })));
  }

  // 用字族裡第一個有內容的字詞當作這個標籤的顯示名稱
  function familyLabel(row) {
    const words = familyWords(row);
    return words.length ? words[0].en : "—";
  }

  function render(options) {
    state.rows = options.rows || [];
    state.onSelect = options.onSelect || null;
    state.els = {
      rail: document.getElementById(options.railId),
      name: document.getElementById(options.nameId),
      progress: document.getElementById(options.progressId),
      grid: document.getElementById(options.gridId),
      panel: document.getElementById(options.panelId),
      count: options.countId ? document.getElementById(options.countId) : null
    };

    if (!state.els.rail || !state.els.grid || !state.els.panel) {
      console.error("VocabWidget: required elements not found");
      return;
    }

    if (state.els.count) {
      const totalWords = state.rows.reduce((sum, row) => sum + familyWords(row).length, 0);
      state.els.count.textContent = state.rows.length
        ? `${state.rows.length} 組字族 · ${totalWords} 個詞性項目`
        : "尚未建立";
    }

    state.currentFamilyIndex = 0;
    renderRail();
    if (state.rows.length) {
      renderFamily(0);
    } else {
      state.els.grid.innerHTML = '<p style="color:var(--ink-soft); font-size:.88rem;">這一課的單字家族尚未建立。</p>';
      state.els.panel.classList.remove("show");
    }
  }

  function renderRail() {
    const rail = state.els.rail;
    rail.innerHTML = "";
    state.rows.forEach((row, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "family-chip" + (i === state.currentFamilyIndex ? " active" : "");
      btn.textContent = familyLabel(row);
      btn.addEventListener("click", () => renderFamily(i));
      rail.appendChild(btn);
    });
  }

  function renderFamily(index) {
    state.currentFamilyIndex = index;
    const row = state.rows[index];
    const words = familyWords(row);

    state.els.rail.querySelectorAll(".family-chip").forEach((btn, i) => btn.classList.toggle("active", i === index));

    if (state.els.name) state.els.name.textContent = familyLabel(row);
    if (state.els.progress) {
      state.els.progress.textContent = `${index + 1} / ${state.rows.length} · ${words.length} 個項目`;
    }

    const grid = state.els.grid;
    grid.innerHTML = "";
    POS_ORDER.forEach(pos => {
      const col = document.createElement("section");
      col.className = "pos-column";
      col.innerHTML = `<div class="pos-title"><span class="pos-dot"></span>${POS_LABELS[pos]} ${POS_LABELS_ZH[pos]}</div>`;

      const entries = row[pos] || [];
      if (!entries.length) {
        const empty = document.createElement("div");
        empty.className = "pos-empty";
        empty.textContent = "—";
        col.appendChild(empty);
      } else {
        entries.forEach((entry, entryIdx) => {
          const card = document.createElement("button");
          card.type = "button";
          card.className = "word-chip";
          card.innerHTML = `<strong>${Loader.escapeHtml(entry.en)}</strong><span>${Loader.escapeHtml(entry.zh || "")}</span>`;
          card.addEventListener("click", () => showWord(row, pos, entries, entryIdx));
          col.appendChild(card);
        });
      }
      grid.appendChild(col);
    });

    // 預設顯示這個字族的第一個詞性項目，讓詳情卡一開始就有內容，不是空白
    const first = words[0];
    if (first) {
      const entries = row[first.pos] || [];
      showWord(row, first.pos, entries, 0);
    }
  }

  function showWord(row, pos, entries, idx) {
    state.currentEntry = { row, pos, entries, idx };
    const entry = entries[idx];

    // 高亮目前選取的字詞卡片
    state.els.grid.querySelectorAll(".word-chip").forEach(el => el.classList.remove("active"));
    const words = familyWords(row);
    // 用內容比對找出對應的按鈕（因為卡片是重新渲染的，用索引在 DOM 裡定位）
    const colIndex = POS_ORDER.indexOf(pos);
    const col = state.els.grid.children[colIndex];
    if (col) {
      const btn = col.querySelectorAll(".word-chip")[idx];
      if (btn) btn.classList.add("active");
    }

    const panel = state.els.panel;
    panel.classList.add("show");
    panel.querySelector(".detail-word").textContent = entry.en;
    panel.querySelector(".pos-tag").textContent = `${POS_LABELS[pos]} ${POS_LABELS_ZH[pos]}`;
    panel.querySelector(".detail-zh").textContent = entry.zh || "（尚未提供中文意思）";
    panel.querySelector(".detail-example-text").textContent = entry.example || "（尚未提供例句）";

    const sourceTag = panel.querySelector(".detail-source");
    if (sourceTag) {
      if (row._book && row._lesson) {
        sourceTag.textContent = `來自 ${row._book.toUpperCase()} ${row._lesson.toUpperCase()}`;
        sourceTag.style.display = "";
      } else {
        sourceTag.style.display = "none";
      }
    }

    const speakBtn = panel.querySelector(".speak-btn");
    if (speakBtn) speakBtn.onclick = () => Loader.speakText(entry.en);

    if (state.onSelect) state.onSelect(entry, row);
  }

  return { render };
})();
