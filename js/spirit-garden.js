/* ===========================================================
   spirit-garden.js — 首頁靈植養成

   露珠來源只讀取既有學習紀錄：每 5 分鐘有效學習 1 顆，或每筆
   正確率 >= 88% 的練習 1 顆。原有分鐘與成績不會被修改或扣除。
   養成狀態存在 localStorage，並由 firebase-sync.js 跨裝置同步。
=========================================================== */
const SpiritGarden = (function () {
  "use strict";

  const STORAGE_KEY = "learning.spirit-garden.v1";
  const TIME_KEY = "learning.progress.time.v1";
  const HISTORY_KEY = "learning.progress.history.v1";
  const REALMS = ["練氣", "築基", "結丹", "元嬰", "化神", "煉虛", "合體", "大乘", "渡劫"];
  const LAYERS = ["前期", "中期", "後期", "大圓滿"];
  const STAGES = REALMS.flatMap(realm => LAYERS.map(layer => ({ realm, layer, label: `${realm} · ${layer}` })));
  const STAGE_COSTS = STAGES.map((_, index) => index + 1);
  const MATURITY_COST = STAGE_COSTS.reduce((sum, value) => sum + value, 0);
  const SPECIES = [
    { id: "jade-sprout", name: "翠芽", english: "Jade Sprout", asset: "assets/spirit-garden/jade-sprout-evolution-v2-960.png" },
    { id: "sunpetal", name: "曦葵", english: "Sunpetal", asset: "assets/spirit-garden/sunpetal-evolution-v2-960.png" },
    { id: "azure-lotus", name: "澄蓮", english: "Azure Lotus", asset: "assets/spirit-garden/azure-lotus-evolution-v2-960.png" },
    { id: "coral-berry", name: "珊莓", english: "Coral Berry", asset: "assets/spirit-garden/coral-berry-evolution-v2-960.png" },
    { id: "violet-ferncap", name: "紫蕈", english: "Violet Ferncap", asset: "assets/spirit-garden/violet-ferncap-evolution-v2-960.png" },
    { id: "mint-clover", name: "幸草", english: "Mint Clover", asset: "assets/spirit-garden/mint-clover-evolution-v2-960.png" },
    { id: "snow-cotton", name: "雪絮", english: "Snow Cotton", asset: "assets/spirit-garden/snow-cotton-evolution-v2-960.png" },
    { id: "ember-maple", name: "燼楓", english: "Ember Maple", asset: "assets/spirit-garden/ember-maple-evolution-v2-960.png" }
  ];

  let mounted = false;
  let initialized = false;
  let fallbackTimer = null;

  function safeParse(value, fallback) {
    try { return JSON.parse(value) ?? fallback; }
    catch (_) { return fallback; }
  }

  function blankState() {
    return { schemaVersion: 2, timeDew: 0, examDew: 0, spentDew: 0, active: null, pets: [], updatedAt: null };
  }

  function readState() {
    const value = safeParse(localStorage.getItem(STORAGE_KEY) || "null", blankState());
    const state = {
      ...blankState(),
      ...(value && typeof value === "object" ? value : {}),
      pets: Array.isArray(value?.pets) ? value.pets : []
    };
    // v1 每隻靈寵曾以 1,332 顆結算；規則降為 666 顆後，把已完成
    // 靈寵的投入量同步減半，釋出的露珠會保留給下一顆。
    if (Number(state.schemaVersion || 1) < 2) state.spentDew = state.pets.length * MATURITY_COST;
    return state;
  }

  function saveState(state) {
    state.schemaVersion = 2;
    state.updatedAt = new Date().toISOString();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (_) { return false; }
    return true;
  }

  function eligibleTimeSeconds() {
    const data = safeParse(localStorage.getItem(TIME_KEY) || "null", { byPage: {} });
    return Object.values(data.byPage || {}).reduce((sum, page) => {
      const seconds = Number(page?.seconds || 0);
      return sum + (seconds >= 120 ? seconds : 0);
    }, 0);
  }

  function practiceId(record) {
    return String(record?.attemptId || [record?.source, record?.mode, record?.startedAt, record?.endedAt, record?.score].join("|"));
  }

  function qualifyingPracticeCount() {
    const history = safeParse(localStorage.getItem(HISTORY_KEY) || "[]", []);
    const ids = new Set();
    (Array.isArray(history) ? history : []).forEach(record => {
      if (!record || record.deleted || Number(record.accuracy || 0) < 88) return;
      if (!["word-practice", "word-lab", "grammar-bank"].includes(record.source)) return;
      ids.add(practiceId(record));
    });
    return ids.size;
  }

  function updateEarnedDew(state) {
    state.timeDew = Math.max(Number(state.timeDew || 0), Math.floor(eligibleTimeSeconds() / 300));
    state.examDew = Math.max(Number(state.examDew || 0), qualifyingPracticeCount());
    return state;
  }

  function totalDew(state) { return Number(state.timeDew || 0) + Number(state.examDew || 0); }
  function availableDew(state) { return Math.max(0, totalDew(state) - Number(state.spentDew || 0)); }
  function speciesById(id) { return SPECIES.find(item => item.id === id) || SPECIES[0]; }
  function formAsset(species, formIndex = 9) {
    const safeForm = Math.max(0, Math.min(9, Number(formIndex) || 0));
    return `assets/spirit-garden/forms/${species.id}-${safeForm}.webp?v=20260907a`;
  }

  function realmFormIndex(completedStages) {
    if (!completedStages) return 0;
    return Math.min(REALMS.length - 1, Math.floor((completedStages - 1) / LAYERS.length));
  }

  function stageAt(progressDew) {
    let spent = 0;
    let completed = 0;
    while (completed < STAGE_COSTS.length && progressDew >= spent + STAGE_COSTS[completed]) {
      spent += STAGE_COSTS[completed];
      completed += 1;
    }
    const nextCost = completed < STAGE_COSTS.length ? STAGE_COSTS[completed] : 0;
    return {
      completed,
      current: completed ? STAGES[completed - 1] : null,
      next: completed < STAGES.length ? STAGES[completed] : null,
      within: progressDew - spent,
      nextCost,
      percent: nextCost ? Math.min(100, (progressDew - spent) / nextCost * 100) : 100
    };
  }

  function settleMaturity(state) {
    if (!state.active || availableDew(state) < MATURITY_COST) return false;
    const species = speciesById(state.active.speciesId);
    const completedAt = new Date().toISOString();
    if (!state.pets.some(pet => pet.id === state.active.id)) {
      state.pets.push({ id: state.active.id, speciesId: species.id, completedAt });
    }
    state.spentDew = Math.max(Number(state.spentDew || 0) + MATURITY_COST, state.pets.length * MATURITY_COST);
    state.active = null;
    return true;
  }

  function refreshState() {
    const previous = readState();
    const state = updateEarnedDew({ ...previous, pets: [...previous.pets] });
    const matured = settleMaturity(state);
    const changed = matured
      || Number(previous.schemaVersion || 1) < 2
      || Number(state.timeDew || 0) !== Number(previous.timeDew || 0)
      || Number(state.examDew || 0) !== Number(previous.examDew || 0)
      || Number(state.spentDew || 0) !== Number(previous.spentDew || 0)
      || JSON.stringify(state.active) !== JSON.stringify(previous.active)
      || JSON.stringify(state.pets) !== JSON.stringify(previous.pets);
    if (changed) saveState(state);
    render(state, matured);
  }

  function chooseSpecies(id) {
    const state = updateEarnedDew(readState());
    if (state.active) return;
    const species = speciesById(id);
    if (!confirm(`選定「${species.name} ${species.english}」開始養成嗎？選定後會自動吸收露珠，直到成為靈寵。`)) return;
    state.active = {
      id: `spirit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      speciesId: species.id,
      selectedAt: new Date().toISOString()
    };
    const matured = settleMaturity(state);
    saveState(state);
    render(state, matured);
  }

  function renderChooser(state, matured) {
    const bank = availableDew(state);
    return `
      <div class="spirit-chooser">
        <p class="spirit-choose-title">${matured ? "✨ 渡劫大圓滿完成！新的靈寵已加入收藏。請選擇下一顆靈芽。" : "從八種靈芽中選一種開始養成："}</p>
        <div class="spirit-species-grid">
          ${SPECIES.map(species => `
            <button class="spirit-species" type="button" data-spirit-species="${species.id}">
              <img class="spirit-species-art spirit-sprite" src="${formAsset(species, 9)}" alt="${species.name}飛升形態">
              <span><b>${species.name}</b><small>${species.english}</small></span>
            </button>`).join("")}
        </div>
        ${bank ? `<p class="spirit-rule-note">目前已有 ${bank} 顆尚未吸收的露珠；選定後會立即用於新靈芽的成長。</p>` : ""}
      </div>`;
  }

  function renderActive(state) {
    const species = speciesById(state.active.speciesId);
    const progressDew = Math.min(MATURITY_COST, availableDew(state));
    const stage = stageAt(progressDew);
    const formIndex = realmFormIndex(stage.completed);
    const layerIndex = stage.completed ? (stage.completed - 1) % LAYERS.length : 0;
    const growth = (.87 + layerIndex * .035 + stage.percent * .00025).toFixed(3);
    const saturation = (.88 + formIndex * .025).toFixed(3);
    const realmGlow = 5 + formIndex * 2;
    const auraOpacity = (.42 + formIndex * .045).toFixed(2);
    const runeSpeed = (15 - formIndex * .7).toFixed(1);
    const stageLabel = stage.current ? stage.current.label : "靈芽 · 初醒";
    const nextText = stage.next ? `下一層：${stage.next.label}，還需 ${stage.nextCost - stage.within} 顆露珠` : "即將渡劫成為靈寵";
    return `
      <div class="spirit-active">
        <div class="spirit-habitat" style="--realm-power:${formIndex};--aura-opacity:${auraOpacity};--rune-speed:${runeSpeed}s">
          <div class="spirit-mist spirit-mist-back" aria-hidden="true"></div>
          <div class="spirit-qi-particles" aria-hidden="true">${Array.from({ length: 12 }, (_, index) => `<i style="--x:${index * 37 % 100}%;--size:${3 + index % 3 * 2}px;--duration:${5.2 + index % 4 * .8}s;--delay:${(index * -.47).toFixed(2)}s;--drift:${index % 2 ? 9 : -9}px"></i>`).join("")}</div>
          <img class="spirit-main-art spirit-sprite" src="${formAsset(species, formIndex)}" alt="${species.name}，${stageLabel}" style="--growth:${growth};--saturation:${saturation};--realm-glow:${realmGlow}px">
          <div class="spirit-altar" aria-hidden="true"><span class="spirit-altar-halo"></span><span class="spirit-altar-disc"></span><span class="spirit-altar-base"></span></div>
          <div class="spirit-mist spirit-mist-front" aria-hidden="true"></div>
        </div>
        <div class="spirit-stage-card">
          <div class="spirit-name-line"><h3>${species.name} <small>${species.english}</small></h3><span class="spirit-realm">${stageLabel}</span><span class="spirit-form-note">第 ${formIndex + 1}／9 形態</span></div>
          <p class="spirit-next">${nextText}</p>
          <div class="spirit-progress-track" role="progressbar" aria-label="目前層級養成進度" aria-valuemin="0" aria-valuemax="${stage.nextCost || 1}" aria-valuenow="${stage.within}"><div class="spirit-progress-fill" style="width:${stage.percent}%"></div></div>
          <div class="spirit-progress-label"><span>本層 ${stage.within}／${stage.nextCost || stage.within} 💧</span><span>總養成 ${progressDew}／${MATURITY_COST} 💧</span></div>
          <div class="spirit-sources">
            <div class="spirit-source"><b>${state.timeDew} 💧</b><span>來自每 5 分鐘有效學習</span></div>
            <div class="spirit-source"><b>${state.examDew} 💧</b><span>來自正確率 88% 以上練習</span></div>
          </div>
          <p class="spirit-rule-note">共 9 級、每級 4 層；各層依序需要 1、2、3……36 顆露珠。露珠只記錄成長，不會扣除學習時間或練習分數。</p>
        </div>
      </div>`;
  }

  function renderCollection(state) {
    const area = document.getElementById("spiritCollection");
    const list = document.getElementById("spiritPetList");
    const pets = state.pets || [];
    area.hidden = pets.length === 0;
    document.getElementById("spiritCollectionCount").textContent = `${pets.length} 隻`;
    list.innerHTML = pets.length ? pets.map(pet => {
      const species = speciesById(pet.speciesId);
      return `<div class="spirit-pet-token" title="${species.name} · ${new Date(pet.completedAt).toLocaleDateString("zh-TW")}"><img class="spirit-sprite" src="${formAsset(species, 9)}" alt=""><span>${species.name}</span></div>`;
    }).join("") : '<span class="spirit-empty-collection">完成渡劫後，靈寵會住進這裡，並在首頁自在游動。</span>';
  }

  function renderRoamers(state) {
    const layer = document.getElementById("spiritRoamLayer");
    layer.innerHTML = (state.pets || []).map((pet, index) => {
      const species = speciesById(pet.speciesId);
      const top = 12 + (index * 17 % 68);
      const duration = 24 + (index * 7 % 19);
      const delay = -(index * 8 % duration);
      const size = 54 + (index * 9 % 25);
      return `<img class="spirit-roamer spirit-sprite" src="${formAsset(species, 9)}" alt="" style="--top:${top}vh;--duration:${duration}s;--delay:${delay}s;--size:${size}px">`;
    }).join("");
  }

  function render(state, matured = false) {
    const body = document.getElementById("spiritGardenBody");
    if (!body) return;
    document.getElementById("spiritAvailableDew").textContent = availableDew(state);
    body.innerHTML = state.active ? renderActive(state) : renderChooser(state, matured);
    body.querySelectorAll("[data-spirit-species]").forEach(button => button.addEventListener("click", () => chooseSpecies(button.dataset.spiritSpecies)));
    renderCollection(state);
    renderRoamers(state);
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    clearTimeout(fallbackTimer);
    refreshState();
  }

  function mount() {
    if (mounted || !document.getElementById("spiritGarden")) return;
    mounted = true;
    const garden = document.getElementById("spiritGarden");
    const toggle = document.getElementById("spiritGardenToggle");
    const toggleText = document.getElementById("spiritGardenToggleText");
    toggle?.addEventListener("click", () => {
      const expanded = garden.classList.toggle("is-expanded");
      toggle.setAttribute("aria-expanded", String(expanded));
      if (toggleText) toggleText.textContent = expanded ? "收起修煉台" : "展開修煉台";
      toggle.querySelector("[aria-hidden]").textContent = expanded ? "⌃" : "⌄";
    });
    window.addEventListener("firebase-sync-ready", initialize, { once: true });
    window.addEventListener("firebase-sync-updated", event => {
      if (initialized && (event.detail?.key === STORAGE_KEY || event.detail?.key === TIME_KEY || event.detail?.key === HISTORY_KEY)) refreshState();
    });
    window.addEventListener("learning-progress-updated", () => { if (initialized) refreshState(); });
    window.addEventListener("storage", event => {
      if (initialized && [STORAGE_KEY, TIME_KEY, HISTORY_KEY].includes(event.key)) refreshState();
    });
    if (window.FirebaseLearningSync?.ready) initialize();
    else fallbackTimer = setTimeout(initialize, 15000);
  }

  return { mount, refresh: refreshState, storageKey: STORAGE_KEY, maturityCost: MATURITY_COST };
})();
