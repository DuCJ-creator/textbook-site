/* ===========================================================
   external-viewer.js — 外部資源卡片 + iframe 檢視器

   用於「English Basics」「Vocabulary Basics」這類連到外部網站的
   板塊：先顯示一排卡片，點卡片後在同一個區塊內用 iframe 開啟該網站，
   不用整頁跳轉離開。

   因為這些外部網站不是本站控制的，無法保證對方一定允許被 iframe
   嵌入（有些網站會設定 X-Frame-Options 或 CSP 擋掉嵌入）。這個元件
   會：
   - iframe 設定一個載入逾時（預設 4 秒），逾時或觸發 onerror 就顯示
     「這個網站可能不允許嵌入」的提示，並提供「在新分頁開啟」的按鈕，
     確保使用者永遠有路可走，不會卡在空白畫面。
   - 提供「← 返回列表」讓使用者切換回卡片列表，不用整頁重新整理。

   用法：
     ExternalViewer.render({
       containerId: "englishBasicsArea",
       cards: [
         { title: "Grammar Lemon Tree 文法檸檬樹", url: "https://..." },
         ...
       ]
     });
=========================================================== */

const ExternalViewer = (function () {
  function render(options) {
    const container = document.getElementById(options.containerId);
    if (!container) {
      console.error("ExternalViewer: container not found:", options.containerId);
      return;
    }
    const cards = options.cards || [];
    renderCardList(container, cards);
  }

  function renderCardList(container, cards) {
    container.innerHTML = `
      <div class="ext-card-grid">
        ${cards.map((c, i) => `
          <button type="button" class="ext-card" data-idx="${i}">
            <span class="ext-card-title">${Loader.escapeHtml(c.title)}</span>
            <span class="ext-card-arrow">→</span>
          </button>
        `).join("")}
      </div>
    `;
    container.querySelectorAll(".ext-card").forEach(btn => {
      const card = cards[Number(btn.dataset.idx)];
      btn.addEventListener("click", () => renderFrame(container, card, cards));
    });
  }

  function renderFrame(container, card, allCards) {
    container.innerHTML = `
      <div class="ext-frame-toolbar">
        <button type="button" class="btn" id="extBackBtn">← 返回列表</button>
        <span class="ext-frame-title">${Loader.escapeHtml(card.title)}</span>
        <a class="btn" id="extOpenNewTab" href="${Loader.escapeHtml(card.url)}" target="_blank" rel="noopener">在新分頁開啟 ↗</a>
      </div>
      <div class="ext-frame-wrap" id="extFrameWrap">
        <div class="ext-frame-loading" id="extFrameLoading">載入中…</div>
        <iframe id="extIframe" src="${Loader.escapeHtml(card.url)}" title="${Loader.escapeHtml(card.title)}" loading="lazy"></iframe>
      </div>
    `;

    document.getElementById("extBackBtn").addEventListener("click", () => renderCardList(container, allCards));

    const iframe = document.getElementById("extIframe");
    const loadingEl = document.getElementById("extFrameLoading");
    let settled = false;

    iframe.addEventListener("load", () => {
      settled = true;
      if (loadingEl) loadingEl.remove();
    });

    // 部分網站會擋掉 iframe 嵌入（X-Frame-Options / CSP），這種情況瀏覽器
    // 不一定會觸發 load 或 error 事件，用逾時當作保底判斷，避免畫面卡死在
    // 「載入中…」。逾時後不強制移除 iframe（萬一其實載入成功了只是慢），
    // 只是額外顯示「可能無法嵌入」的提示與明確的新分頁按鈕。
    setTimeout(() => {
      if (settled) return;
      if (loadingEl) {
        loadingEl.innerHTML = `
          載入時間較長，若畫面持續空白，這個網站可能不允許嵌入顯示。
          <br />可以直接<a href="${Loader.escapeHtml(card.url)}" target="_blank" rel="noopener">在新分頁開啟</a>。
        `;
      }
    }, 4000);
  }

  return { render };
})();
