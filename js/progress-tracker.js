/* 全站學習時間追蹤：資料只保存在目前瀏覽器的 localStorage。 */
(function () {
  "use strict";
  if (window.LearningProgressTracker) return;
  const KEY = "learning.progress.time.v1";
  const EXCLUDED_FILES = new Set(["index.html", "progress-report.html"]);
  const isTopPage = window.self === window.top;
  let activeSince = null;

  function currentFile() {
    return location.pathname.split("/").pop() || "index.html";
  }

  function isExcludedPage() {
    return EXCLUDED_FILES.has(currentFile());
  }

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || "null");
      if (value && typeof value === "object") return value;
    } catch (_) {}
    return { schemaVersion: 1, totalSeconds: 0, byPage: {}, updatedAt: null };
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
    if (!seconds) return;
    const data = read();
    const info = pageInfo();
    const item = data.byPage[info.key] || { seconds: 0, visits: 0, title: info.title, path: info.path, lastVisitedAt: null };
    item.seconds += seconds;
    item.title = info.title;
    item.path = info.path;
    item.lastVisitedAt = new Date(now).toISOString();
    data.byPage[info.key] = item;
    data.totalSeconds = Object.values(data.byPage).reduce((sum, page) => sum + Number(page.seconds || 0), 0);
    data.updatedAt = new Date(now).toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) {}
    window.dispatchEvent(new CustomEvent("learning-progress-updated", { detail: data }));
  }

  function countVisit() {
    if (!isTopPage || isExcludedPage()) return;
    const data = read();
    const info = pageInfo();
    const item = data.byPage[info.key] || { seconds: 0, visits: 0, title: info.title, path: info.path, lastVisitedAt: null };
    item.visits += 1;
    item.title = info.title;
    item.path = info.path;
    item.lastVisitedAt = new Date().toISOString();
    data.byPage[info.key] = item;
    data.updatedAt = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) {}
  }

  function removeExcludedPageHistory() {
    const data = read();
    data.byPage = data.byPage && typeof data.byPage === "object" ? data.byPage : {};
    let changed = false;
    Object.keys(data.byPage).forEach(key => {
      const file = String(key).split("?")[0];
      if (EXCLUDED_FILES.has(file)) {
        delete data.byPage[key];
        changed = true;
      }
    });
    if (!changed) return;
    data.totalSeconds = Object.values(data.byPage)
      .reduce((sum, page) => sum + Number(page.seconds || 0), 0);
    data.updatedAt = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) {}
  }

  removeExcludedPageHistory();
  countVisit();
  start();
  document.addEventListener("visibilitychange", () => { commit(); start(); });
  window.addEventListener("focus", start);
  window.addEventListener("blur", commit);
  window.addEventListener("pagehide", commit);
  setInterval(commit, 15000);

  window.LearningProgressTracker = { read, commit, storageKey: KEY };
})();
