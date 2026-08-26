/* ===========================================================
   word-practice.js — 單字拼寫 / 聽寫練習（豌豆射手風格）

   資料來源：整課的 vocabulary.rows（word family），攤平成單字清單
   {en, zh, pos} 後供兩種模式使用。

   兩種模式（刻意不做「辨識模式」——同一字族裡動詞/名詞常常同形同義，
   例如 reply、memory，中文提示無法用語意區分該選哪個詞性的答案）：
   - spelling：掉落的豆莢上方顯示中文、詞性，豆莢內先給首字母。
   - dictation：同樣給首字母，並可播放／重播單字發音。

   互動改成「豌豆射手」風格：玩家固定在畫面底部，輸入正確字母時，
   會從底部發射一顆「豆子」往上飛，命中掉落物上對應的字母位置會有
   爆裂粒子效果與音效；輸入錯誤時豆子會偏斜射歪、伴隨低沉的錯誤音效，
   營造遊戲緊迫感與節奏感。

   離開頁面不保存進度／最高分，每次重新進入都是全新一輪（設計決定）。

   用法：WordPractice.init({ containerId: "gameArea", rows: [...] })
=========================================================== */

const WordPractice = (function () {
  const POS_LABELS_ZH = { verb: "動詞", noun: "名詞", adj: "形容詞", adv: "副詞" };

  let els = {};
  let state = null;
  let audioCtx = null;

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

  // 簡易音效：不依賴外部音檔，用 Web Audio API 產生短促的嗶聲，
  // 分成「命中」（高音、清脆）與「失誤」（低音、沉悶）兩種音色。
  function beep(freq, duration) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = audioCtx || new Ctx();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) { /* Web Audio 不可用時安靜略過，不影響遊戲邏輯 */ }
  }
  function sfxHit() { beep(720, 0.07); setTimeout(() => beep(980, 0.06), 45); }
  function sfxMiss() { beep(160, 0.12); }
  function sfxComplete() { [520, 660, 880].forEach((f, i) => setTimeout(() => beep(f, 0.1), i * 80)); }

  function appendProgressHistory(record) {
    const key = "learning.progress.history.v1";
    let history = [];
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "[]");
      if (Array.isArray(saved)) history = saved;
    } catch (_) {}
    history.push(record);
    history = history.slice(-300);
    try { localStorage.setItem(key, JSON.stringify(history)); }
    catch (_) {
      try { localStorage.setItem(key, JSON.stringify(history.slice(-100))); } catch (_) {}
    }
  }

  function init(options) {
    els.container = document.getElementById(options.containerId);
    const allWords = flattenWords(options.rows);
    if (!allWords.length) {
      els.container.innerHTML = '<p style="color:var(--ink-soft); font-size:.88rem;">這一課的單字資料不足，無法進行練習。</p>';
      return;
    }
    state = {
      allWords, mode: null,
      book: options.book || "all",
      lesson: options.lesson || "all",
      startedAt: null
    };
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
          <p>聽發音、看中文、詞性與首字母，用鍵盤拼出完整單字。</p>
        </button>
      </div>
    `;
    document.getElementById("pickSpelling").addEventListener("click", () => startMode("spelling"));
    document.getElementById("pickDictation").addEventListener("click", () => startMode("dictation"));
  }

  function startMode(mode) {
    state.mode = mode;
    state.startedAt = new Date();
    state.queue = shuffle(state.allWords);
    state.score = 0;
    state.correct = 0;
    state.wrong = 0;
    state.misses = 0;
    state.lives = 5;
    state.active = true;
    state.locked = false;
    state.current = null;
    state.typed = "";
    state.visualTyped = "";
    state.finishing = false;
    state.hintLen = 1;
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
          <div class="wp-stat"><span>Miss</span><strong id="wpMisses">0</strong></div>
        </div>
        <div class="wp-hearts" id="wpHearts"></div>
        <div class="wp-hud-group">
          <button type="button" class="icon-btn" id="wpQuit">結束練習</button>
        </div>
      </div>
      <div class="wp-arena" id="wpArena">
        <div class="wp-banner" id="wpBanner"></div>
        <div class="wp-shooter" id="wpShooter">🌱</div>
        <div class="wp-ground"></div>
      </div>
      <div class="wp-hintbar" id="wpHintbar"></div>
      <div class="wp-keyboard" id="wpKeyboard"></div>
    `;
    els.arena = document.getElementById("wpArena");
    els.shooter = document.getElementById("wpShooter");
    els.scoreEl = document.getElementById("wpScore");
    els.correctEl = document.getElementById("wpCorrect");
    els.missesEl = document.getElementById("wpMisses");
    els.heartsEl = document.getElementById("wpHearts");
    els.bannerEl = document.getElementById("wpBanner");
    els.hintbar = document.getElementById("wpHintbar");
    document.getElementById("wpQuit").addEventListener("click", () => finish("已結束練習"));
    document.addEventListener("keydown", handleKeydown);
    renderKeyboard();
    updateHud();
  }

  function renderKeyboard() {
    const kb = document.getElementById("wpKeyboard");
    if (!kb) return;
    kb.innerHTML = "";
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
  }

  function updateHud() {
    els.scoreEl.textContent = state.score;
    els.correctEl.textContent = state.correct;
    els.missesEl.textContent = state.misses;
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
    state.finishing = false;
    // 拼寫與聽寫都預先給第一個字母。
    state.hintLen = 1;
    state.typed = state.current.en.slice(0, state.hintLen);
    state.visualTyped = state.typed;

    els.arena.querySelectorAll(".wp-falling").forEach(el => el.remove());

    // 中文、詞性與首字母同時顯示在下方固定提示區，避免等待豆莢進場；
    // 掉落物本身也保留同一組提示，讓視線移到場內後仍能直接判讀。
    els.hintbar.innerHTML = `
      ${state.mode === "dictation" ? `<button type="button" class="wp-replay-btn" id="wpReplayBtn">🔊 再聽一次</button>` : ""}
      <div class="wp-hint-meaning">${Loader.escapeHtml(state.current.zh)}</div>
      <span class="pos-tag">${POS_LABELS_ZH[state.current.pos] || Loader.escapeHtml(state.current.pos)}</span>
      <div class="letters" id="wpHintLetters" aria-label="固定單字提示"></div>
      <div class="wp-instruction">依序輸入字母，把豆子射進掉落的豆莢裡；射錯會顯示 MISS，但豆莢會繼續掉落。</div>
    `;
    if (state.mode === "dictation") {
      document.getElementById("wpReplayBtn").addEventListener("click", () => Loader.speakText(state.current.en));
    }
    if (state.mode === "dictation") Loader.speakText(state.current.en);

    const card = document.createElement("div");
    card.className = "wp-falling";
    card.style.top = "-140px";
    card.innerHTML = `
      <div class="wp-falling-clue">
        <div class="wp-falling-meaning">${Loader.escapeHtml(state.current.zh)}</div>
        <span class="pos-tag">${POS_LABELS_ZH[state.current.pos] || Loader.escapeHtml(state.current.pos)}</span>
      </div>
      <div class="wp-pod" id="wpPodLetters" aria-label="單字豆莢"></div>
    `;
    els.arena.appendChild(card);
    els.currentCard = card;
    renderLetters();

    state.fallStart = performance.now();
    // 給打字較慢的學生更充裕時間：初始約 22 秒，之後只緩慢加速，最快仍保留 15 秒。
    state.fallDuration = Math.max(15, 22 - (state.correct + state.wrong) * 0.2);
    cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(fallLoop);
  }

  function fallLoop(now) {
    if (!state.active || !els.currentCard || !els.currentCard.isConnected) return;
    const arenaHeight = els.arena.clientHeight;
    const progress = Math.min(1, (now - state.fallStart) / 1000 / state.fallDuration);
    const startTop = -140;
    const nearGroundTop = Math.max(80, arenaHeight - els.currentCard.offsetHeight - 54);
    els.currentCard.style.top = (startTop + progress * (nearGroundTop - startTop)) + "px";
    // 最後幾顆豆子仍在飛行時先等動畫完成，避免已打完卻在落地瞬間扣命。
    if (progress >= 1 && !state.locked && !state.finishing) {
      missRound();
      return;
    }
    state.raf = requestAnimationFrame(fallLoop);
  }

  function renderLetters() {
    const podEl = document.getElementById("wpPodLetters");
    const hintEl = document.getElementById("wpHintLetters");
    if (!podEl && !hintEl) return;
    const word = state.current.en;
    const displayed = state.visualTyped;
    const podParts = [];
    const hintParts = [];
    for (let i = 0; i < word.length; i++) {
      if (i < displayed.length) {
        const letterClass = i < state.hintLen ? "hint" : "filled";
        podParts.push(`<span class="wp-pod-slot ${letterClass}">${Loader.escapeHtml(word[i])}</span>`);
        hintParts.push(`<span class="${letterClass}">${Loader.escapeHtml(word[i])}</span>`);
      } else {
        podParts.push('<span class="wp-pod-slot empty" aria-hidden="true"></span>');
        hintParts.push("_");
      }
    }
    if (podEl) {
      podEl.innerHTML = `<span class="wp-pod-icon" aria-hidden="true">🫛</span><span class="wp-pod-slots">${podParts.join("")}</span>`;
    }
    if (hintEl) hintEl.innerHTML = hintParts.join(" ");
  }

  function handleKeydown(e) {
    if (!state || !state.active) return;
    if (/^[a-zA-Z]$/.test(e.key)) handleLetter(e.key.toLowerCase());
  }

  // 從射手位置發射一顆豆子往目標飛去，飛行結束後才真正判定命中／落空，
  // 讓輸入結果有「飛行時間」的視覺回饋，而不是瞬間變化。
  function launchPea(hit) {
    if (!els.shooter || !els.currentCard || !els.currentCard.isConnected) return;
    const arenaRect = els.arena.getBoundingClientRect();
    const shooterRect = els.shooter.getBoundingClientRect();
    const targetRect = els.currentCard.getBoundingClientRect();

    const startX = shooterRect.left - arenaRect.left + shooterRect.width / 2;
    const startY = shooterRect.top - arenaRect.top + shooterRect.height / 2;
    // 命中時瞄準掉落物中心；失手時故意偏移一段距離，做出「射歪」的感覺
    const targetX = targetRect.left - arenaRect.left + targetRect.width / 2 + (hit ? 0 : (Math.random() < 0.5 ? -1 : 1) * 60);
    const targetY = targetRect.top - arenaRect.top + targetRect.height / 2 + (hit ? 0 : -40);

    const pea = document.createElement("div");
    pea.className = "wp-pea" + (hit ? "" : " miss");
    pea.style.left = startX + "px";
    pea.style.top = startY + "px";
    pea.style.setProperty("--dx", (targetX - startX) + "px");
    pea.style.setProperty("--dy", (targetY - startY) + "px");
    els.arena.appendChild(pea);
    requestAnimationFrame(() => pea.classList.add("fly"));

    setTimeout(() => {
      pea.remove();
      if (hit) {
        spawnHitBurst(targetX, targetY);
        sfxHit();
      } else {
        sfxMiss();
      }
    }, 220);
  }

  function spawnHitBurst(x, y) {
    for (let i = 0; i < 6; i++) {
      const p = document.createElement("span");
      p.className = "wp-burst";
      p.style.left = x + "px";
      p.style.top = y + "px";
      const angle = (i / 6) * Math.PI * 2;
      p.style.setProperty("--bx", Math.cos(angle) * 26 + "px");
      p.style.setProperty("--by", Math.sin(angle) * 26 + "px");
      els.arena.appendChild(p);
      setTimeout(() => p.remove(), 420);
    }
  }

  function showMiss(targetX, targetY) {
    const miss = document.createElement("span");
    miss.className = "wp-miss-label";
    miss.textContent = "MISS";
    miss.style.left = targetX + "px";
    miss.style.top = targetY + "px";
    els.arena.appendChild(miss);
    setTimeout(() => miss.remove(), 650);
  }

  function handleLetter(ch) {
    if (!state.active || state.locked || state.finishing) return;
    const word = state.current.en;
    const expected = (word[state.typed.length] || "").toLowerCase();
    const isHit = !!expected && expected === ch.toLowerCase();

    const arenaRect = els.arena.getBoundingClientRect();
    const targetRect = els.currentCard.getBoundingClientRect();
    const targetX = targetRect.left - arenaRect.left + targetRect.width / 2;
    const targetY = targetRect.top - arenaRect.top + targetRect.height / 2;
    launchPea(isHit);

    if (isHit) {
      // 輸入判定立即前進，動畫則稍後填字：快速連續打字不會再漏接按鍵。
      const acceptedLetter = word[state.typed.length];
      state.typed += acceptedLetter;
      if (state.typed.length >= word.length) state.finishing = true;
      setTimeout(() => {
        if (!state.active || state.locked || !els.currentCard || !els.currentCard.isConnected) return;
        state.visualTyped += acceptedLetter;
        renderLetters();
        if (state.visualTyped.length >= word.length) solveTyping();
      }, 220);
    } else {
      state.misses++;
      updateHud();
      showMiss(targetX, targetY - 24);
      els.currentCard.classList.remove("wrong-shake");
      void els.currentCard.offsetWidth;
      els.currentCard.classList.add("wrong-shake");
      els.shooter.classList.remove("shooter-recoil");
      void els.shooter.offsetWidth;
      els.shooter.classList.add("shooter-recoil");
    }
  }

  function solveTyping() {
    if (state.locked) return;
    state.locked = true;
    state.score += 15;
    state.correct++;
    showBanner("拼對了！+15");
    els.currentCard.classList.add("correct");
    sfxComplete();
    updateHud();
    setTimeout(nextRound, 750);
  }

  function missRound() {
    if (state.locked) return;
    state.locked = true;
    state.wrong++;
    state.lives--;
    showBanner(`豆莢落地！正確拼法是 ${state.current.en}`);
    sfxMiss();
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
    const endedAt = new Date();

    appendProgressHistory({
      schemaVersion: 1,
      attemptId: (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `word-practice-${endedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      activity: "word-practice",
      source: "word-practice",
      mode: state.mode,
      modeLabel: state.mode === "dictation" ? "聽寫模式" : "拼寫模式",
      book: state.book,
      lesson: state.lesson,
      startedAt: state.startedAt ? state.startedAt.toISOString() : endedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationSeconds: state.startedAt ? Math.max(0, Math.round((endedAt - state.startedAt) / 1000)) : 0,
      endReason: reason,
      scoreRule: "15-per-correct",
      pointsPerCorrect: 15,
      score: state.score,
      correct: state.correct,
      misses: state.misses,
      wrong: state.wrong,
      total,
      accuracy
    });

    els.container.innerHTML = `
      <div class="card wp-results">
        <div class="trophy">${state.lives > 0 ? "🏆" : "💫"}</div>
        <p style="color:var(--ink-soft); font-size:.85rem; margin:0;">${Loader.escapeHtml(reason)}</p>
        <h2>練習結果</h2>
        <div class="wp-result-grid">
          <div class="wp-result-card"><strong>${state.score}</strong><span>Score</span></div>
          <div class="wp-result-card"><strong>${state.correct}</strong><span>答對</span></div>
          <div class="wp-result-card"><strong>${state.misses}</strong><span>MISS</span></div>
          <div class="wp-result-card"><strong>${state.wrong}</strong><span>掉落</span></div>
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
