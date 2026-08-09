/* ===========================================================
   vocab-widget.js — Part 1: 單字家族表格 + 詳情面板

   可重用元件。用法：

     VocabWidget.render({
       tableBodyId: "wfBody",
       panelId: "detailPanel",
       rows: LESSON.vocabulary.rows,          // 單課用法
       onSelect: (entry, sourceInfo) => {}     // 選填：跨課總覽可能想額外顯示「來自 B1L1」
     });

   跨課總覽（vocab-bank.html）用法：把多課的 rows concat 起來，
   每個 row 額外標記 _book/_lesson，再傳進來即可；元件本身不關心
   資料來自幾課，只負責渲染與互動。
=========================================================== */

const VocabWidget = (function () {
  const POS_LABELS = { verb: "Verb 動詞", noun: "Noun 名詞", adj: "Adjective 形容詞", adv: "Adverb 副詞" };
  const POS_ORDER = ["verb", "noun", "adj", "adv"];

  let state = {
    rows: [],
    tableBodyId: null,
    panelId: null,
    currentEntry: null
  };

  function render(options) {
    state.rows = options.rows || [];
    state.tableBodyId = options.tableBodyId;
    state.panelId = options.panelId;
    state.onSelect = options.onSelect || null;

    const tbody = document.getElementById(state.tableBodyId);
    if (!tbody) {
      console.error("VocabWidget: table body element not found:", state.tableBodyId);
      return;
    }

    tbody.innerHTML = "";
    state.rows.forEach((row, rowIdx) => {
      const tr = document.createElement("tr");
      POS_ORDER.forEach(pos => {
        const td = document.createElement("td");
        const entries = row[pos] || [];
        if (!entries.length) {
          td.innerHTML = `<span class="cell empty">&nbsp;</span>`;
        } else {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "cell";
          btn.innerHTML = entries.map(e => `<span class="word-line">${Loader.escapeHtml(e.en)}</span>`).join("");
          btn.addEventListener("click", () => selectCell(rowIdx, pos, btn));
          td.appendChild(btn);
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function selectCell(rowIdx, pos, btnEl) {
    const tbody = document.getElementById(state.tableBodyId);
    tbody.querySelectorAll(".cell.active").forEach(el => el.classList.remove("active"));
    if (btnEl) btnEl.classList.add("active");

    const row = state.rows[rowIdx];
    const entries = row[pos] || [];
    if (!entries.length) return;

    state.currentEntry = { pos, entries, idx: 0, row };
    renderDetail();
    if (state.onSelect) state.onSelect(entries[0], row);
  }

  function renderDetail() {
    if (!state.currentEntry) return;
    const { entries, idx, pos, row } = state.currentEntry;
    const entry = entries[idx];
    const panel = document.getElementById(state.panelId);
    if (!panel) return;

    panel.classList.add("show");
    panel.querySelector(".detail-word").textContent = entry.en;
    panel.querySelector(".pos-tag").textContent = POS_LABELS[pos];
    panel.querySelector(".detail-zh").textContent = entry.zh || "（尚未提供中文意思）";
    panel.querySelector(".detail-example-text").textContent =
      entry.example || "（尚未提供例句）";

    // 跨課總覽情境：顯示這個字來自哪一課
    const sourceTag = panel.querySelector(".detail-source");
    if (sourceTag) {
      if (row._book && row._lesson) {
        sourceTag.textContent = `來自 ${row._book.toUpperCase()} ${row._lesson.toUpperCase()}`;
        sourceTag.style.display = "";
      } else {
        sourceTag.style.display = "none";
      }
    }

    const switcher = panel.querySelector(".switch-others");
    if (switcher) {
      switcher.innerHTML = "";
      if (entries.length > 1) {
        switcher.innerHTML = "同格其他字形：" + entries.map((e, i) =>
          `<button type="button" data-idx="${i}" style="text-decoration:${i === idx ? "underline" : "none"}">${Loader.escapeHtml(e.en)}</button>`
        ).join("");
        switcher.querySelectorAll("button").forEach(b => {
          b.addEventListener("click", () => switchEntry(Number(b.dataset.idx)));
        });
      }
    }

    const speakBtn = panel.querySelector(".speak-btn");
    if (speakBtn) speakBtn.onclick = () => Loader.speakText(entry.en);

    Loader.speakText(entry.en);
  }

  function switchEntry(i) {
    if (!state.currentEntry) return;
    state.currentEntry.idx = i;
    renderDetail();
  }

  return { render };
})();
