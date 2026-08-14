/* ===========================================================
   notepad.js — 隨處可見的筆記本

   固定在畫面右下角的浮動按鈕，點開/收合一個筆記面板。內容存在
   localStorage（單一 textarea，所有筆記堆在一起，設計上刻意簡單），
   跨頁面共用同一份內容——在 Word Family 頁面寫的筆記，切到 Phrases
   頁面也看得到，因為存取的是同一個瀏覽器的同一個 key。

   用法：只要在頁面裡引入這支 script，並在 body 結尾呼叫
   Notepad.mount()，就會自動注入浮動按鈕與面板，不需要額外的
   HTML markup（避免每個頁面都要手動加一段一樣的結構）。
=========================================================== */

const Notepad = (function () {
  const STORAGE_KEY = "studentNotepadContent";
  let mounted = false;

  function loadContent() {
    try {
      return localStorage.getItem(STORAGE_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function saveContent(text) {
    try {
      localStorage.setItem(STORAGE_KEY, text);
    } catch (e) {
      // localStorage 可能因隱私模式或空間不足而寫入失敗，安靜忽略，不影響其他功能
    }
  }

  function mount() {
    if (mounted) return; // 避免同一頁重複呼叫時注入兩份
    mounted = true;

    const fab = document.createElement("button");
    fab.type = "button";
    fab.id = "notepadFab";
    fab.className = "notepad-fab";
    fab.setAttribute("aria-label", "開啟筆記本");
    fab.textContent = "📝";

    const panel = document.createElement("div");
    panel.id = "notepadPanel";
    panel.className = "notepad-panel";
    panel.innerHTML = `
      <div class="notepad-header">
        <span>📝 我的筆記</span>
        <button type="button" class="notepad-close" aria-label="關閉筆記本">✕</button>
      </div>
      <textarea id="notepadText" class="notepad-textarea" placeholder="在這裡寫下任何筆記……離開頁面也不會消失。"></textarea>
      <div class="notepad-footer">
        <span class="notepad-status" id="notepadStatus"></span>
      </div>
    `;

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    const textarea = panel.querySelector("#notepadText");
    const statusEl = panel.querySelector("#notepadStatus");
    textarea.value = loadContent();

    let saveTimer = null;
    textarea.addEventListener("input", () => {
      statusEl.textContent = "編輯中…";
      clearTimeout(saveTimer);
      // 打字時不用每個按鍵都寫 localStorage，停頓一下再存，避免頻繁寫入
      saveTimer = setTimeout(() => {
        saveContent(textarea.value);
        statusEl.textContent = "已自動儲存";
        setTimeout(() => { if (statusEl.textContent === "已自動儲存") statusEl.textContent = ""; }, 1500);
      }, 400);
    });

    fab.addEventListener("click", () => {
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) textarea.focus();
    });
    panel.querySelector(".notepad-close").addEventListener("click", () => {
      panel.classList.remove("open");
    });

    // 點面板以外的地方自動收合，行為跟一般浮動面板一致
    document.addEventListener("click", e => {
      if (!panel.classList.contains("open")) return;
      if (panel.contains(e.target) || fab.contains(e.target)) return;
      panel.classList.remove("open");
    });
  }

  return { mount };
})();
