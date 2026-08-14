/* ===========================================================
   word-practice.js — 單字拼寫 / 聽寫練習

   資料來源：整課的 vocabulary.rows（word family），攤平成單字清單
   {en, zh, pos} 後供兩種模式使用。設計理念參考老師提供的「隕石」
   遊戲範例，但重新用本站既有的淡金＋綠色視覺語言呈現，並簡化成
   單頁流程（不含關卡選擇、CSV 載入等原範例的額外系統）。

   兩種模式（刻意不做「辨識模式」——同一字族裡動詞/名詞常常同形同義，
   例如 reply、memory，中文提示無法用語意區分該選哪個詞性的答案，
   四選一的題目會產生無法公平判定的情況）：
   - spelling：畫面顯示中文＋詞性＋首字母，用鍵盤輸入完整拼字
   - dictation：畫面顯示中文＋詞性，先唸出發音，再用鍵盤輸入拼字
     （跟 spelling 的差異只在提供的線索是「聽到的發音」而非文字提示）

   離開頁面不保存進度／最高分，每次重新進入都是全新一輪（設計決定）。

   用法：WordPractice.init({ containerId: "gameArea", rows: [...] })
=========================================================== */

const WordPractice = (function () {
  const POS_LABELS_ZH = { verb: "動詞", noun: "名詞", adj: "形容詞", adv: "副詞" };

  let els = {};
  let state = null;

  function flattenWords(rows) {
    const POS_ORDER = ["verb", "noun", "adj", "adv"];
    const words = [];
    rows.forEach(row => {
      POS_ORDER.forEach(pos => {
        (row[pos] || []).forEach(entry => {
          if (entry.en) words.push({ en: entry.en, zh: entry.zh || "", pos });
        });
      });
    });
    return words;
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function init(options) {
    els.container = document.getElementById(options.containerId);
    const allWords = flattenWords(options.rows);
    if (!allWords.length) {
      els.container.innerHTML = '<p style="color:var(--ink-soft); font-size:.88rem;">這一課的單字資料不足，無法進行練習。</p>';
      return;
    }
    state = { allWords, mode: null };
    renderModeSelect();
  }

  function renderModeSelect() {
    els.container.innerHTML = `
      <div class="mode-select">
        <button type="button" class="mode-pick-card" id="pickSpelling">
          <div class="icon">⌨️</div>
          <h3>拼寫模式</h3>
          <p>看中文、詞性與首字母，用鍵盤拼出完整單字。</p>
        </button>
        <button type="button" class="mode-pick-card" id="pickDictation">
          <div class="icon">🔊</div>
          <h3>聽寫模式</h3>
          <p>聽發音、看中文與詞性，用鍵盤拼出完整單字。</p>
        </button>
      </div>
    `;
    document.getElementById("pickSpelling").addEventListener("click", () => startMode("spelling"));
    document.getElementById("pickDictation").addEventListener("click", () => startMode("dictation"));
  }

  function startMode(mode) {
    state.mode = mode;
    state.queue = shuffle(state.allWords);
    state.score = 0;
    state.correct = 0;
    state.wrong = 0;
    state.lives = 5;
    state.active = true;
    state.locked = false;
    state.current = null;
    state.typed = "";
    state.hintLen = 0;
    state.fallStart = 0;
    state.fallDuration = 12;
    renderGameShell();
    nextRound();
  }

  function renderGameShell() {
    els.container.innerHTML = `
      <div class="wp-hud">
        <div class="wp-hud-group">
          <div class="wp-stat"><span>Score</span><strong id="wpScore">0</strong></div>
          <div class="wp-stat"><span>Correct</span><strong id="wpCorrect">0</strong></div>
        </div>
        <div class="wp-hearts" id="wpHearts"></div>
        <div class="wp-hud-group">
          <button type="button" class="icon-btn" id="wpQuit">結束練習</button>
        </div>
      </div>
      <div class="wp-arena" id="wpArena">
        <div class="wp-banner" id="wpBanner"></div>
        <div class="wp-ground"></div>
      </div>
    `;
    els.arena = document.getElementById("wpArena");
    els.scoreEl = document.getElementById("wpScore");
    els.correctEl = document.getElementById("wpCorrect");
    els.heartsEl = document.getElementById("wpHearts");
    els.bannerEl = document.getElementById("wpBanner");
    document.getElementById("wpQuit").addEventListener("click", () => finish("已結束練習"));
    document.addEventListener("keydown", handleKeydown);
    updateHud();
  }

  function updateHud() {
    els.scoreEl.textContent = state.score;
    els.correctEl.textContent = state.correct;
    els.heartsEl.textContent = "💚".repeat(Math.max(0, state.lives)) + "🤍".repeat(Math.max(0, 5 - state.lives));
  }

  function showBanner(text) {
    els.bannerEl.textContent = text;
    els.bannerEl.classList.add("show");
    setTimeout(() => els.bannerEl && els.bannerEl.classList.remove("show"), 900);
  }

  function nextRound() {
    if (!state.active) return;
    if (!state.queue.length) { finish("練習完成！"); return; }
    state.current = state.queue.shift();
    state.locked = false;
    state.hintLen = 1;
    state.typed = state.current.en.slice(0, state.hintLen);

    els.arena.querySelectorAll(".wp-falling").forEach(el => el.remove());
    els.arena.querySelectorAll(".wp-keyboard").forEach(el => el.remove());

    const card = document.createElement("div");
    card.className = "wp-falling";
    card.style.top = "-140px";
    card.innerHTML = `
      ${state.mode === "dictation" ? '<div style="font-size:.75rem; color:var(--ink-soft); margin-bottom:6px;">🔊 播放中…</div>' : ""}
      <div class="meaning">${Loader.escapeHtml(state.current.zh)}</div>
      <span class="pos-tag">${POS_LABELS_ZH[state.current.pos] || state.current.pos}</span>
      <div class="letters" id="wpLetters"></div>
    `;
    els.arena.appendChild(card);
    renderLetters();
    renderKeyboard();
    if (state.mode === "dictation") Loader.speakText(state.current.en);

    els.currentCard = card;
    state.fallStart = performance.now();
    state.fallDuration = Math.max(9, 14 - (state.correct + state.wrong) * 0.3);
    cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(fallLoop);
  }

  function fallLoop(now) {
    if (!state.active || !els.currentCard || !els.currentCard.isConnected) return;
    const arenaHeight = els.arena.clientHeight;
    const progress = Math.min(1, (now - state.fallStart) / 1000 / state.fallDuration);
    els.currentCard.style.top = (-140 + progress * (arenaHeight - 40)) + "px";
    if (progress >= 1 && !state.locked) {
      missRound();
      return;
    }
    state.raf = requestAnimationFrame(fallLoop);
  }

  function renderLetters() {
    const el = document.getElementById("wpLetters");
    if (!el) return;
    const word = state.current.en;
    const parts = [];
    for (let i = 0; i < word.length; i++) {
      if (i < state.typed.length) {
        parts.push(`<span class="${i < state.hintLen ? "hint" : "filled"}">${Loader.escapeHtml(word[i])}</span>`);
      } else {
        parts.push("_");
      }
    }
    el.innerHTML = parts.join(" ");
  }

  function renderKeyboard() {
    const kb = document.createElement("div");
    kb.className = "wp-keyboard";
    ["qwertyuiop", "asdfghjkl", "zxcvbnm"].forEach(row => {
      const r = document.createElement("div");
      r.className = "wp-keyrow";
      [...row].forEach(ch => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "wp-key";
        b.textContent = ch.toUpperCase();
        b.addEventListener("click", () => handleLetter(ch));
        r.appendChild(b);
      });
      kb.appendChild(r);
    });
    els.arena.appendChild(kb);
  }

  function handleKeydown(e) {
    if (!state || !state.active) return;
    if (/^[a-zA-Z]$/.test(e.key)) handleLetter(e.key.toLowerCase());
  }

  function handleLetter(ch) {
    if (!state.active || state.locked) return;
    const word = state.current.en;
    const expected = (word[state.typed.length] || "").toLowerCase();
    if (expected && expected === ch.toLowerCase()) {
      state.typed += word[state.typed.length];
      renderLetters();
      if (state.typed.length >= word.length) solveTyping();
    } else {
      els.currentCard.classList.remove("wrong-shake");
      void els.currentCard.offsetWidth;
      els.currentCard.classList.add("wrong-shake");
    }
  }

  function solveTyping() {
    if (state.locked) return;
    state.locked = true;
    state.score += 15;
    state.correct++;
    showBanner("拼對了！+15");
    els.currentCard.classList.add("correct");
    updateHud();
    setTimeout(nextRound, 800);
  }

  function missRound() {
    if (state.locked) return;
    state.locked = true;
    state.wrong++;
    state.lives--;
    showBanner(`時間到，正確拼法是 ${state.current.en}`);
    updateHud();
    if (state.lives <= 0) { setTimeout(() => finish("生命值用完了"), 900); return; }
    setTimeout(nextRound, 900);
  }

  function finish(reason) {
    if (!state.active) return;
    state.active = false;
    cancelAnimationFrame(state.raf);
    document.removeEventListener("keydown", handleKeydown);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();

    const total = state.correct + state.wrong;
    const accuracy = total ? Math.round((state.correct / total) * 100) : 0;

    els.container.innerHTML = `
      <div class="card wp-results">
        <div class="trophy">${state.lives > 0 ? "🏆" : "💫"}</div>
        <p style="color:var(--ink-soft); font-size:.85rem; margin:0;">${Loader.escapeHtml(reason)}</p>
        <h2>練習結果</h2>
        <div class="wp-result-grid">
          <div class="wp-result-card"><strong>${state.score}</strong><span>Score</span></div>
          <div class="wp-result-card"><strong>${state.correct}</strong><span>答對</span></div>
          <div class="wp-result-card"><strong>${state.wrong}</strong><span>答錯</span></div>
          <div class="wp-result-card"><strong>${accuracy}%</strong><span>正確率</span></div>
        </div>
        <div class="wp-result-actions">
          <button type="button" class="btn" id="wpBackToModes">選擇其他模式</button>
          <button type="button" class="btn primary" id="wpPlayAgain">再玩一次</button>
        </div>
      </div>
    `;
    document.getElementById("wpBackToModes").addEventListener("click", renderModeSelect);
    document.getElementById("wpPlayAgain").addEventListener("click", () => startMode(state.mode));
  }

  return { init };
})();
