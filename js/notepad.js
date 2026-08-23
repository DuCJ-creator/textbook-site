/* ===========================================================
   notepad.js — 隨處可見的多功能筆記本

   浮動按鈕＋可拖曳的面板，出現在每一個頁面。
   功能：
   - 多筆記：每則筆記獨立一張卡片，可新增、刪除
   - 文字或手繪：每則筆記可以是純文字，或是簡易手繪塗鴉（單色畫板）
   - 自訂標籤：學生可自己新增/命名標籤並指定顏色，用來分類筆記
     （例如「單字」「文法」「片語」），標籤本身也可以刪除
   - 匯出 PDF：可選擇「全部」或「單一標籤」匯出成 PDF 檔案
   - 面板可拖曳移動（避免面板剛好擋住畫面上的內容）
   - 本機即時保存；登入後由 FirebaseLearningSync 自動跨裝置同步

   用法：只要在頁面裡引入這支 script 並呼叫 Notepad.mount()，
   會自動注入浮動按鈕與面板，不需要額外 HTML markup。
=========================================================== */

const Notepad = (function () {
  const STORAGE_KEY = "studentNotepadData";
  const POS_KEY = "studentNotepadPanelPos";
  const DEFAULT_TAG_COLORS = ["#276749", "#c9622f", "#3d5a73", "#9333ea", "#c23b3b", "#b8860b"];

  let mounted = false;
  let data = { notes: [], tags: [] };
  let els = {};
  let activeTagFilter = null; // null = 全部
  let jsPDFLoadPromise = null;

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* 損壞的資料就當作沒有，從空白開始，不讓整個筆記本掛掉 */ }
    return { notes: [], tags: [] };
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      // localStorage 可能因隱私模式或空間不足而寫入失敗（尤其手繪圖片資料量較大），
      // 安靜忽略，不影響其他功能；使用者若真的存不進去，畫面上內容還在，
      // 只是重新整理後可能遺失，這是純前端 localStorage 的固有限制。
    }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function loadPanelPos() {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return null;
  }

  function savePanelPos(pos) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (e) { /* ignore */ }
  }

  function mount() {
    if (mounted) return; // 避免同一頁重複呼叫時注入兩份
    mounted = true;
    // Notepad 幾乎出現在全站頁面；沒有另外引入時，順便啟用學習時間追蹤。
    if (!window.LearningProgressTracker &&
        !document.querySelector('script[data-learning-progress], script[src="js/progress-tracker.js"]')) {
      const tracker = document.createElement("script");
      tracker.src = "js/progress-tracker.js";
      tracker.dataset.learningProgress = "true";
      document.head.appendChild(tracker);
    }
    data = loadData();

    window.addEventListener("firebase-sync-updated", event => {
      if (event.detail?.key !== STORAGE_KEY || event.detail?.source !== "cloud") return;
      data = loadData();
      if (mounted && els.notesArea) renderAll();
    });

    injectFab();
    injectPanel();
    applyPanelPosition();
    makePanelDraggable();
    renderAll();
  }

  function injectFab() {
    const fab = document.createElement("button");
    fab.type = "button";
    fab.id = "notepadFab";
    fab.className = "notepad-fab";
    fab.setAttribute("aria-label", "開啟筆記本");
    fab.textContent = "📝";
    fab.addEventListener("click", () => {
      els.panel.classList.toggle("open");
    });
    document.body.appendChild(fab);
    els.fab = fab;
  }

  function injectPanel() {
    const panel = document.createElement("div");
    panel.id = "notepadPanel";
    panel.className = "notepad-panel";
    panel.innerHTML = `
      <div class="notepad-header" id="notepadDragHandle">
        <span>📝 我的筆記</span>
        <button type="button" class="notepad-close" aria-label="關閉筆記本">✕</button>
      </div>

      <div class="notepad-toolbar">
        <select id="notepadTagFilter" class="notepad-select" aria-label="依標籤篩選"></select>
        <button type="button" class="notepad-icon-btn" id="notepadExportBtn" title="匯出 PDF">⬇️ PDF</button>
      </div>

      <div class="notepad-tag-manager" id="notepadTagManager"></div>

      <div class="notepad-notes" id="notepadNotes"></div>

      <div class="notepad-footer">
        <button type="button" class="notepad-add-btn" id="notepadAddText">＋ 文字筆記</button>
        <button type="button" class="notepad-add-btn" id="notepadAddDoodle">🖊️ 手繪筆記</button>
      </div>
    `;
    document.body.appendChild(panel);
    els.panel = panel;
    els.notesArea = panel.querySelector("#notepadNotes");
    els.tagFilter = panel.querySelector("#notepadTagFilter");
    els.tagManager = panel.querySelector("#notepadTagManager");
    els.dragHandle = panel.querySelector("#notepadDragHandle");

    panel.querySelector(".notepad-close").addEventListener("click", () => panel.classList.remove("open"));
    panel.querySelector("#notepadAddText").addEventListener("click", () => addNote("text"));
    panel.querySelector("#notepadAddDoodle").addEventListener("click", () => addNote("doodle"));
    panel.querySelector("#notepadExportBtn").addEventListener("click", exportPdf);
    els.tagFilter.addEventListener("change", () => {
      activeTagFilter = els.tagFilter.value || null;
      renderNotes();
    });
  }

  // ===================== 拖曳面板 =====================
  function applyPanelPosition() {
    const pos = loadPanelPos();
    if (pos) {
      els.panel.style.left = pos.left + "px";
      els.panel.style.top = pos.top + "px";
      els.panel.style.right = "auto";
      els.panel.style.bottom = "auto";
    }
    // 沒有存過位置時，維持 CSS 預設的右下角定位，不用額外處理
  }

  function makePanelDraggable() {
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    function onPointerDown(e) {
      // 拖曳把手上的關閉按鈕點擊不該觸發拖曳
      if (e.target.closest(".notepad-close")) return;
      dragging = true;
      const rect = els.panel.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      const point = e.touches ? e.touches[0] : e;
      startX = point.clientX;
      startY = point.clientY;
      els.panel.classList.add("dragging");
      e.preventDefault();
    }

    function onPointerMove(e) {
      if (!dragging) return;
      const point = e.touches ? e.touches[0] : e;
      const dx = point.clientX - startX;
      const dy = point.clientY - startY;
      // 限制面板不要被拖出視窗範圍太多，至少保留一部分在畫面內方便拉回來
      const maxLeft = window.innerWidth - 60;
      const maxTop = window.innerHeight - 60;
      const newLeft = Math.min(maxLeft, Math.max(-els.panel.offsetWidth + 60, startLeft + dx));
      const newTop = Math.min(maxTop, Math.max(0, startTop + dy));
      els.panel.style.left = newLeft + "px";
      els.panel.style.top = newTop + "px";
      els.panel.style.right = "auto";
      els.panel.style.bottom = "auto";
    }

    function onPointerUp() {
      if (!dragging) return;
      dragging = false;
      els.panel.classList.remove("dragging");
      const rect = els.panel.getBoundingClientRect();
      savePanelPos({ left: rect.left, top: rect.top });
    }

    els.dragHandle.addEventListener("mousedown", onPointerDown);
    document.addEventListener("mousemove", onPointerMove);
    document.addEventListener("mouseup", onPointerUp);
    els.dragHandle.addEventListener("touchstart", onPointerDown, { passive: false });
    document.addEventListener("touchmove", onPointerMove, { passive: false });
    document.addEventListener("touchend", onPointerUp);
  }

  // ===================== 標籤管理 =====================
  function renderTagFilter() {
    const sel = els.tagFilter;
    sel.innerHTML = `<option value="">全部筆記</option>` +
      data.tags.map(t => `<option value="${t.id}">${escapeHtmlLite(t.name)}</option>`).join("");
    sel.value = activeTagFilter && data.tags.some(t => t.id === activeTagFilter) ? activeTagFilter : "";
  }

  function renderTagManager() {
    els.tagManager.innerHTML = `
      <div class="notepad-tag-list">
        ${data.tags.map(t => `
          <span class="notepad-tag-chip" style="background:${t.color}22; border-color:${t.color}; color:${t.color};">
            ${escapeHtmlLite(t.name)}
            <button type="button" class="notepad-tag-del" data-id="${t.id}" aria-label="刪除標籤 ${escapeHtmlLite(t.name)}">✕</button>
          </span>
        `).join("")}
      </div>
      <div class="notepad-tag-add">
        <input type="text" id="notepadNewTagName" placeholder="新增標籤名稱…" maxlength="12" />
        <input type="color" id="notepadNewTagColor" value="${DEFAULT_TAG_COLORS[data.tags.length % DEFAULT_TAG_COLORS.length]}" title="標籤顏色" />
        <button type="button" id="notepadNewTagBtn">新增</button>
      </div>
    `;
    els.tagManager.querySelectorAll(".notepad-tag-del").forEach(btn => {
      btn.addEventListener("click", () => deleteTag(btn.dataset.id));
    });
    const addBtn = els.tagManager.querySelector("#notepadNewTagBtn");
    const nameInput = els.tagManager.querySelector("#notepadNewTagName");
    addBtn.addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (!name) return;
      const color = els.tagManager.querySelector("#notepadNewTagColor").value;
      data.tags.push({ id: uid(), name, color });
      saveData();
      renderAll();
    });
    nameInput.addEventListener("keydown", e => { if (e.key === "Enter") addBtn.click(); });
  }

  function deleteTag(tagId) {
    // 刪除標籤時，改用該標籤的筆記不會一起被刪掉，只是變回「未分類」，
    // 避免使用者不小心刪標籤時連帶弄丟筆記內容
    data.tags = data.tags.filter(t => t.id !== tagId);
    data.notes.forEach(n => { if (n.tagId === tagId) n.tagId = null; });
    if (activeTagFilter === tagId) activeTagFilter = null;
    saveData();
    renderAll();
  }

  // ===================== 筆記卡片 =====================
  function addNote(type) {
    const note = { id: uid(), type, content: "", tagId: null, createdAt: Date.now() };
    data.notes.unshift(note);
    saveData();
    renderNotes();
  }

  function deleteNote(noteId) {
    data.notes = data.notes.filter(n => n.id !== noteId);
    saveData();
    renderNotes();
  }

  function updateNoteTag(noteId, tagId) {
    const note = data.notes.find(n => n.id === noteId);
    if (!note) return;
    note.tagId = tagId || null;
    saveData();
    renderNotes();
  }

  function renderNotes() {
    const filtered = activeTagFilter
      ? data.notes.filter(n => n.tagId === activeTagFilter)
      : data.notes;

    if (!filtered.length) {
      els.notesArea.innerHTML = `<p class="notepad-empty">${activeTagFilter ? "這個標籤還沒有筆記。" : "還沒有筆記，點下方按鈕新增第一則。"}</p>`;
      return;
    }

    els.notesArea.innerHTML = "";
    filtered.forEach(note => {
      const tag = data.tags.find(t => t.id === note.tagId);
      const card = document.createElement("div");
      card.className = "notepad-note-card";
      if (tag) card.style.borderLeftColor = tag.color;

      const tagSelectHtml = `
        <select class="notepad-note-tag-select" data-id="${note.id}">
          <option value="">未分類</option>
          ${data.tags.map(t => `<option value="${t.id}" ${t.id === note.tagId ? "selected" : ""}>${escapeHtmlLite(t.name)}</option>`).join("")}
        </select>
      `;

      if (note.type === "text") {
        card.innerHTML = `
          <div class="notepad-note-head">
            ${tagSelectHtml}
            <button type="button" class="notepad-note-del" data-id="${note.id}" aria-label="刪除這則筆記">🗑️</button>
          </div>
          <textarea class="notepad-note-textarea" data-id="${note.id}" placeholder="寫點什麼……">${escapeHtmlLite(note.content)}</textarea>
        `;
        const textarea = card.querySelector(".notepad-note-textarea");
        let saveTimer = null;
        textarea.addEventListener("input", () => {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            note.content = textarea.value;
            saveData();
          }, 400);
        });
      } else {
        card.innerHTML = `
          <div class="notepad-note-head">
            ${tagSelectHtml}
            <div class="notepad-note-head-actions">
              <button type="button" class="notepad-note-clear" data-id="${note.id}" title="清除畫布">🧹</button>
              <button type="button" class="notepad-note-del" data-id="${note.id}" aria-label="刪除這則筆記">🗑️</button>
            </div>
          </div>
          <canvas class="notepad-note-canvas" data-id="${note.id}" width="280" height="160"></canvas>
        `;
        setupDoodleCanvas(card.querySelector(".notepad-note-canvas"), note);
        card.querySelector(".notepad-note-clear").addEventListener("click", () => {
          const canvas = card.querySelector(".notepad-note-canvas");
          const ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          note.content = "";
          saveData();
        });
      }

      card.querySelector(".notepad-note-del").addEventListener("click", () => deleteNote(note.id));
      card.querySelector(".notepad-note-tag-select").addEventListener("change", e => updateNoteTag(note.id, e.target.value));

      els.notesArea.appendChild(card);
    });
  }

  // ===================== 手繪畫布 =====================
  function setupDoodleCanvas(canvas, note) {
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#276749";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // 還原之前存的圖（如果有）
    if (note.content) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = note.content;
    }

    let drawing = false;
    let lastPoint = null;

    function getPoint(e) {
      const rect = canvas.getBoundingClientRect();
      const point = e.touches ? e.touches[0] : e;
      return {
        x: (point.clientX - rect.left) * (canvas.width / rect.width),
        y: (point.clientY - rect.top) * (canvas.height / rect.height)
      };
    }

    function start(e) {
      drawing = true;
      lastPoint = getPoint(e);
      e.preventDefault();
    }
    function move(e) {
      if (!drawing) return;
      const point = getPoint(e);
      ctx.beginPath();
      ctx.moveTo(lastPoint.x, lastPoint.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      lastPoint = point;
      e.preventDefault();
    }
    function end() {
      if (!drawing) return;
      drawing = false;
      note.content = canvas.toDataURL("image/png");
      saveData();
    }

    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("mouseup", end);
    canvas.addEventListener("mouseleave", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);
  }

  function renderAll() {
    renderTagFilter();
    renderTagManager();
    renderNotes();
  }

  function escapeHtmlLite(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // ===================== 匯出 PDF =====================
  function loadJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (jsPDFLoadPromise) return jsPDFLoadPromise;
    jsPDFLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      script.onload = () => {
        if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
        else reject(new Error("jsPDF failed to initialize"));
      };
      script.onerror = () => reject(new Error("無法載入 PDF 匯出功能，請確認網路連線"));
      document.head.appendChild(script);
    });
    return jsPDFLoadPromise;
  }

  async function exportPdf() {
    const exportBtn = els.panel.querySelector("#notepadExportBtn");
    const originalText = exportBtn.textContent;
    exportBtn.textContent = "產生中…";
    exportBtn.disabled = true;

    try {
      const JsPDFCtor = await loadJsPDF();
      const doc = new JsPDFCtor({ unit: "pt", format: "a4" });

      const notesToExport = activeTagFilter
        ? data.notes.filter(n => n.tagId === activeTagFilter)
        : data.notes;

      const tagLabel = activeTagFilter
        ? (data.tags.find(t => t.id === activeTagFilter)?.name || "")
        : "全部筆記";

      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 48;
      let y = margin;

      doc.setFontSize(16);
      doc.text(`我的筆記 · ${tagLabel}`, margin, y);
      y += 26;
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(new Date().toLocaleString("zh-TW"), margin, y);
      doc.setTextColor(0);
      y += 20;

      if (!notesToExport.length) {
        doc.setFontSize(11);
        doc.text("（這個範圍目前沒有筆記）", margin, y);
      }

      for (const note of notesToExport) {
        if (y > 760) { doc.addPage(); y = margin; }

        const tag = data.tags.find(t => t.id === note.tagId);
        doc.setFontSize(9);
        doc.setTextColor(120);
        doc.text(`${tag ? tag.name : "未分類"} · ${new Date(note.createdAt).toLocaleDateString("zh-TW")}`, margin, y);
        doc.setTextColor(0);
        y += 14;

        if (note.type === "text") {
          doc.setFontSize(11);
          const lines = doc.splitTextToSize(note.content || "（空白筆記）", pageWidth - margin * 2);
          for (const line of lines) {
            if (y > 780) { doc.addPage(); y = margin; }
            doc.text(line, margin, y);
            y += 15;
          }
        } else if (note.content) {
          const imgWidth = 220;
          const imgHeight = 126; // 維持畫布 280x160 的比例
          if (y + imgHeight > 780) { doc.addPage(); y = margin; }
          try {
            doc.addImage(note.content, "PNG", margin, y, imgWidth, imgHeight);
          } catch (e) { /* 圖片資料異常時跳過該圖，不中斷整份 PDF 產生 */ }
          y += imgHeight + 10;
        } else {
          doc.setFontSize(10);
          doc.setTextColor(150);
          doc.text("（空白手繪）", margin, y);
          doc.setTextColor(0);
          y += 14;
        }
        y += 12;
      }

      doc.save(`筆記_${tagLabel}_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      alert("PDF 匯出失敗：" + err.message);
    } finally {
      exportBtn.textContent = originalText;
      exportBtn.disabled = false;
    }
  }

  return { mount };
})();

// loader.js 透過 window 取得並掛載共用工具。
window.Notepad = Notepad;
