/* 全站學習時間追蹤：本機即時保存，登入後自動同步至 Firestore。 */
(function () {
  "use strict";
  if (window.LearningProgressTracker) return;

  const KEY = "learning.progress.time.v1";
  const PENDING_EXTERNAL_KEY = "learning.progress.external.pending.v1";
  const MIN_PAGE_SECONDS = 120;
  const MAX_EXTERNAL_SESSION_SECONDS = 4 * 60 * 60;
  const EXCLUDED_FILES = new Set(["index.html", "progress-report.html"]);
  const isTopPage = window.self === window.top;
  let activeSince = null;
  let awaySession = null;
  let embeddedSession = null;

  function currentFile() {
    return location.pathname.split("/").pop() || "index.html";
  }

  function isExcludedPage() {
    return EXCLUDED_FILES.has(currentFile());
  }

  function countedTotal(byPage) {
    return Object.values(byPage || {}).reduce((sum, page) => {
      const seconds = Number(page?.seconds || 0);
      return sum + (seconds >= MIN_PAGE_SECONDS ? seconds : 0);
    }, 0);
  }

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || "null");
      if (value && typeof value === "object") return value;
    } catch (_) {}
    return { schemaVersion: 1, totalSeconds: 0, byPage: {}, updatedAt: null };
  }

  function save(data, notify = true) {
    data.totalSeconds = countedTotal(data.byPage);
    data.updatedAt = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) {}
    if (notify) {
      window.dispatchEvent(new CustomEvent("learning-progress-updated", { detail: data }));
    }
  }

  function pageInfo() {
    const file = currentFile();
    const params = new URLSearchParams(location.search);
    const scope = ["book", "lesson"].filter(k => params.get(k)).map(k => `${k}=${params.get(k)}`).join("&");
    return {
      key: scope ? `${file}?${scope}` : file,
      title: document.title || file,
      path: location.pathname + location.search
    };
  }

  function normalizeExternalUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (!/^https?:$/.test(url.protocol)) return null;
      url.hash = "";
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function externalInfo(urlValue, titleValue) {
    const url = normalizeExternalUrl(urlValue);
    if (!url) return null;
    const fallback = new URL(url).hostname.replace(/^www\./, "");
    const title = String(titleValue || fallback).replace(/\s+/g, " ").trim().slice(0, 120) || fallback;
    return {
      key: `external:${url}`,
      title: `↗ ${title}`,
      path: url,
      external: true
    };
  }

  function addTime(info, seconds, visits = 0) {
    if (!info) return;
    const now = Date.now();
    const data = read();
    data.byPage = data.byPage && typeof data.byPage === "object" ? data.byPage : {};
    const item = data.byPage[info.key] || {
      seconds: 0,
      visits: 0,
      title: info.title,
      path: info.path,
      lastVisitedAt: null
    };
    item.seconds += Math.max(0, Number(seconds) || 0);
    item.visits += Math.max(0, Number(visits) || 0);
    item.title = info.title;
    item.path = info.path;
    if (info.external) item.external = true;
    item.lastVisitedAt = new Date(now).toISOString();
    data.byPage[info.key] = item;
    save(data);
  }

  function isActive() {
    return isTopPage && !isExcludedPage() && document.visibilityState === "visible" && document.hasFocus();
  }

  function start() {
    if (isActive() && activeSince === null) activeSince = Date.now();
  }

  function commit() {
    if (activeSince === null) return;
    const now = Date.now();
    // 單次最多計 60 秒，避免裝置睡眠或瀏覽器凍結造成虛增。
    const seconds = Math.max(0, Math.min(60, Math.round((now - activeSince) / 1000)));
    activeSince = isActive() ? now : null;
    if (seconds) addTime(pageInfo(), seconds);
  }

  function countVisit() {
    if (!isTopPage || isExcludedPage()) return;
    addTime(pageInfo(), 0, 1);
  }

  function normalizePageHistory() {
    const data = read();
    data.byPage = data.byPage && typeof data.byPage === "object" ? data.byPage : {};
    let changed = false;
    Object.keys(data.byPage).forEach(key => {
      // 外部資源不是 index.html 或 progress-report.html，不參與這項清理。
      if (key.startsWith("external:")) return;
      const file = String(key).split("?")[0];
      if (EXCLUDED_FILES.has(file)) {
        delete data.byPage[key];
        changed = true;
      }
    });
    const normalizedTotal = countedTotal(data.byPage);
    if (Number(data.totalSeconds || 0) !== normalizedTotal) changed = true;
    if (!changed) return;
    save(data, false);
  }

  function persistAwaySession() {
    try {
      if (awaySession) localStorage.setItem(PENDING_EXTERNAL_KEY, JSON.stringify(awaySession));
      else localStorage.removeItem(PENDING_EXTERNAL_KEY);
    } catch (_) {}
  }

  function beginAwaySession(info) {
    if (!isTopPage || !info) return;
    // 若使用者連續點擊連結，以最後一個真正離開的平台資源為準。
    awaySession = { info, startedAt: Date.now(), activated: false };
    persistAwaySession();
    setTimeout(() => {
      if (!awaySession || awaySession.activated) return;
      if (document.visibilityState === "visible" && document.hasFocus()) {
        awaySession = null;
        persistAwaySession();
      }
    }, 1800);
  }

  function activateAwaySession() {
    if (!awaySession) return;
    awaySession.activated = true;
    persistAwaySession();
  }

  function finishAwaySession() {
    if (!awaySession || !awaySession.activated) return;
    const session = awaySession;
    awaySession = null;
    persistAwaySession();
    const seconds = Math.max(0, Math.min(
      MAX_EXTERNAL_SESSION_SECONDS,
      Math.round((Date.now() - Number(session.startedAt || Date.now())) / 1000)
    ));
    addTime(session.info, seconds, 1);
  }

  function restoreAwaySession() {
    try {
      const stored = JSON.parse(localStorage.getItem(PENDING_EXTERNAL_KEY) || "null");
      if (stored?.info?.key && stored?.startedAt) awaySession = stored;
    } catch (_) {}
    if (awaySession?.activated && document.visibilityState === "visible" && document.hasFocus()) {
      finishAwaySession();
    }
  }

  function startExternalView(url, title, token = "embedded") {
    if (!isTopPage) return;
    stopExternalView();
    const info = externalInfo(url, title);
    if (!info) return;
    embeddedSession = {
      info,
      token: String(token || "embedded"),
      activeSince: document.visibilityState === "visible" ? Date.now() : null
    };
    addTime(info, 0, 1);
  }

  function commitExternalView() {
    if (!embeddedSession || embeddedSession.activeSince === null) return;
    const now = Date.now();
    const seconds = Math.max(0, Math.min(60, Math.round((now - embeddedSession.activeSince) / 1000)));
    embeddedSession.activeSince = document.visibilityState === "visible" ? now : null;
    if (seconds) addTime(embeddedSession.info, seconds);
  }

  function resumeExternalView() {
    if (embeddedSession && embeddedSession.activeSince === null && document.visibilityState === "visible") {
      embeddedSession.activeSince = Date.now();
    }
  }

  function pauseExternalViewIfWindowWasLeft() {
    // 點進 iframe 也可能觸發父頁 blur；此時仍在學習，不應誤停計時。
    setTimeout(() => {
      if (!embeddedSession || document.visibilityState !== "visible") return;
      if (document.activeElement?.tagName === "IFRAME") return;
      commitExternalView();
      if (embeddedSession) embeddedSession.activeSince = null;
    }, 0);
  }

  function stopExternalView(token) {
    if (!embeddedSession) return;
    if (token && embeddedSession.token !== String(token)) return;
    commitExternalView();
    embeddedSession = null;
  }

  function externalAnchorFromEvent(event) {
    const anchor = event.target?.closest?.("a[href]");
    if (!anchor || anchor.hasAttribute("download") || anchor.dataset.noLearningTime !== undefined) return null;
    const url = normalizeExternalUrl(anchor.href);
    if (!url || new URL(url).origin === location.origin) return null;
    return { anchor, info: externalInfo(url, anchor.dataset.learningTitle || anchor.textContent) };
  }

  normalizePageHistory();
  countVisit();
  start();
  restoreAwaySession();

  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = externalAnchorFromEvent(event);
    if (target) beginAwaySession(target.info);
  });

  window.addEventListener("learning-external-view-start", event => {
    const detail = event.detail || {};
    startExternalView(detail.url, detail.title, detail.token);
  });
  window.addEventListener("learning-external-view-stop", event => {
    stopExternalView(event.detail?.token);
  });

  document.addEventListener("visibilitychange", () => {
    commit();
    commitExternalView();
    if (document.visibilityState === "hidden") activateAwaySession();
    else {
      start();
      resumeExternalView();
      finishAwaySession();
    }
  });
  window.addEventListener("focus", () => {
    start();
    resumeExternalView();
    finishAwaySession();
  });
  window.addEventListener("blur", () => {
    commit();
    activateAwaySession();
    pauseExternalViewIfWindowWasLeft();
  });
  window.addEventListener("pagehide", () => {
    commit();
    commitExternalView();
    activateAwaySession();
  });
  setInterval(() => {
    commit();
    commitExternalView();
  }, 15000);

  window.LearningProgressTracker = {
    read,
    commit,
    startExternalView,
    stopExternalView,
    storageKey: KEY,
    minimumPageSeconds: MIN_PAGE_SECONDS
  };
})();
