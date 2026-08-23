import {
  collection,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { app, getPortalProfile, observePortalAuth } from "./firebase-auth.js";

/*
 * FirebaseLearningSync
 * --------------------
 * Existing pages continue to use localStorage, so their game and note-taking
 * code stays fast and works offline. This bridge mirrors learner-owned records
 * to Firestore, restores them after sign-in on another browser, and migrates
 * pre-Firebase local records the first time the original browser connects.
 */

const db = getFirestore(app);
const META_KEY = "learning.firebase-sync.meta.v1";
const DEVICE_KEY = "learning.firebase-sync.device.v1";
// Firestore measures UTF-8 bytes, not JavaScript character count. Keeping each
// piece at 180k characters stays safely below the document limit even for
// Chinese text, while large base64 images are divided across several records.
const CHUNK_SIZE = 180000;
const CLOUD_PULL_INTERVAL_MS = 15 * 60 * 1000;
const PROFILE_WRITE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const HOUSEKEEPING_INTERVAL_MS = 15000;

// Local changes are immediate. Cloud writes are intentionally batched to keep
// a whole class safely inside Firestore's free daily quota.
const SYNC_POLICIES = {
  "learning.progress.time.v1": { idleMs: Infinity, minIntervalMs: 5 * 60 * 1000, maxWaitMs: 5 * 60 * 1000 },
  "learning.progress.history.v1": { idleMs: 1200, minIntervalMs: 0, maxWaitMs: 5000 },
  "learning.progress.reflection.v1": { idleMs: 15000, minIntervalMs: 0, maxWaitMs: 2 * 60 * 1000 },
  "learning.progress.images.v1": { idleMs: 4000, minIntervalMs: 0, maxWaitMs: 30000 },
  "studentNotepadData": { idleMs: 20000, minIntervalMs: 0, maxWaitMs: 5 * 60 * 1000 },
  "vocabStarredIds": { idleMs: 1800, minIntervalMs: 0, maxWaitMs: 10000 },
  "vocab-bank.starred": { idleMs: 1800, minIntervalMs: 0, maxWaitMs: 10000 },
  "phraseStarredIds": { idleMs: 1800, minIntervalMs: 0, maxWaitMs: 10000 }
};

const TRACKED_KEYS = new Map([
  ["learning.progress.time.v1", "learning-time"],
  ["learning.progress.history.v1", "practice-history"],
  ["learning.progress.reflection.v1", "reflection"],
  ["learning.progress.images.v1", "annotation-images"],
  ["studentNotepadData", "notepad"],
  ["vocabStarredIds", "vocab-family-stars"],
  ["vocab-bank.starred", "vocab-detail-stars"],
  ["phraseStarredIds", "phrase-stars"]
]);

const nativeGetItem = Storage.prototype.getItem;
const nativeSetItem = Storage.prototype.setItem;
const nativeRemoveItem = Storage.prototype.removeItem;
let activeUser = null;
let activeProfile = null;
let syncReady = false;
let applyingRemote = false;
let flushTimer = null;
let initializationTimer = null;
let pullInFlight = false;
const observedValues = new Map();

function getLocal(key) {
  try { return nativeGetItem.call(localStorage, key); }
  catch (_) { return null; }
}

function setLocal(key, value) {
  applyingRemote = true;
  try {
    if (value === null || value === undefined) nativeRemoveItem.call(localStorage, key);
    else nativeSetItem.call(localStorage, key, value);
  } finally {
    applyingRemote = false;
  }
  observedValues.set(key, value ?? null);
}

function readMeta() {
  try {
    const value = JSON.parse(nativeGetItem.call(localStorage, META_KEY) || "null");
    if (value && typeof value === "object") {
      value.keys = value.keys && typeof value.keys === "object" ? value.keys : {};
      return value;
    }
  } catch (_) {}
  return { schemaVersion: 1, keys: {} };
}

function saveMeta(meta) {
  try { nativeSetItem.call(localStorage, META_KEY, JSON.stringify(meta)); }
  catch (_) {}
}

function updateKeyMeta(key, patch) {
  const meta = readMeta();
  meta.keys[key] = { ...(meta.keys[key] || {}), ...patch };
  saveMeta(meta);
  return meta.keys[key];
}

function updateMeta(patch) {
  const meta = readMeta();
  Object.assign(meta, patch);
  saveMeta(meta);
  return meta;
}

function deviceId() {
  let value = getLocal(DEVICE_KEY);
  if (!value) {
    value = crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try { nativeSetItem.call(localStorage, DEVICE_KEY, value); } catch (_) {}
  }
  return value;
}

function randomRevision() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function markDirty(key) {
  if (!TRACKED_KEYS.has(key) || applyingRemote) return;
  const meta = readMeta();
  meta.keys[key] = { ...(meta.keys[key] || {}), dirty: true, dirtyAt: Date.now() };
  saveMeta(meta);
  observedValues.set(key, getLocal(key));
  scheduleFlush();
}

// Make every existing localStorage writer participate without rewriting each
// game. Dirty state is persisted immediately so a page navigation cannot lose
// a score that has not reached Firestore yet.
Storage.prototype.setItem = function (key, value) {
  nativeSetItem.call(this, key, value);
  if (this === localStorage) markDirty(String(key));
};

Storage.prototype.removeItem = function (key) {
  nativeRemoveItem.call(this, key);
  if (this === localStorage) markDirty(String(key));
};

function safeParse(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch (_) { return fallback; }
}

// Dashboard snapshots turn over at 11:00 and 23:00 Taiwan time. Subtracting
// 11 hours makes those boundaries the start of two simple 12-hour buckets.
function summaryCycleId(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(now - 11 * 60 * 60 * 1000));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const boundaryHour = Number(values.hour) >= 12 ? "23" : "11";
  return `${values.year}-${values.month}-${values.day}T${boundaryHour}`;
}

function buildLearningSummary() {
  const time = safeParse(getLocal("learning.progress.time.v1") || "null", { totalSeconds: 0, byPage: {} });
  const rawHistory = safeParse(getLocal("learning.progress.history.v1") || "[]", []);
  const history = (Array.isArray(rawHistory) ? rawHistory : []).filter(record =>
    record && ["word-practice", "word-lab", "grammar-bank"].includes(record.source)
  );
  const notepad = safeParse(getLocal("studentNotepadData") || "null", { notes: [] });
  const annotations = safeParse(getLocal("learning.progress.images.v1") || "[]", []);
  const stars = ["vocabStarredIds", "vocab-bank.starred", "phraseStarredIds"].reduce((total, key) => {
    const value = safeParse(getLocal(key) || "[]", []);
    return total + (Array.isArray(value) ? value.length : 0);
  }, 0);
  const totalSeconds = Object.values(time.byPage || {}).reduce((sum, page) => {
    const seconds = Number(page?.seconds || 0);
    return sum + (seconds >= 120 ? seconds : 0);
  }, 0);
  const latestPracticeAt = history.map(record => record.endedAt || record.startedAt || "").filter(Boolean).sort().pop() || null;
  const lastActivityAt = [time.updatedAt, latestPracticeAt].filter(Boolean).sort().pop() || null;
  const totalScore = history.reduce((sum, record) => sum + Number(record.score || 0), 0);
  const totalAccuracy = history.reduce((sum, record) => sum + Number(record.accuracy || 0), 0);
  const pageBreakdown = Object.values(time.byPage || {})
    .filter(page => Number(page?.seconds || 0) >= 120)
    .sort((a, b) => Number(b.seconds || 0) - Number(a.seconds || 0))
    .slice(0, 50)
    .map(page => ({
      title: String(page.title || page.path || "頁面"),
      path: String(page.path || ""),
      seconds: Math.round(Number(page.seconds || 0)),
      visits: Math.round(Number(page.visits || 0)),
      lastVisitedAt: page.lastVisitedAt || null
    }));
  const recentPractices = history.slice(-20).reverse().map(record => ({
    source: String(record.source || ""),
    mode: String(record.mode || ""),
    modeLabel: String(record.modeLabel || ""),
    score: Number(record.score || 0),
    accuracy: Number(record.accuracy || 0),
    correct: Number(record.correct || 0),
    total: Number(record.total || 0),
    endedAt: record.endedAt || record.startedAt || null
  }));
  return {
    uid: activeUser?.uid || "",
    role: activeProfile?.role || "student",
    name: activeProfile?.name || "",
    className: activeProfile?.className || "",
    school: activeProfile?.school || "",
    seatNo: activeProfile?.seatNo || "",
    totalSeconds,
    practiceCount: history.length,
    averageScore: history.length ? Math.round(totalScore / history.length) : 0,
    averageAccuracy: history.length ? Math.round(totalAccuracy / history.length) : 0,
    latestPracticeAt,
    lastActivityAt,
    starCount: stars,
    noteCount: Array.isArray(notepad.notes) ? notepad.notes.filter(note => note?.content).length : 0,
    annotationCount: Array.isArray(annotations) ? annotations.length : 0,
    hasActivity: totalSeconds > 0 || history.length > 0,
    pageBreakdown,
    recentPractices,
    snapshotCycle: summaryCycleId()
  };
}

async function syncLearningSummary() {
  if (!activeUser || !activeProfile || !syncReady) return false;
  const cycle = summaryCycleId();
  const meta = readMeta();
  // At most one dashboard write per account/device in each 12-hour cycle.
  if (meta.summaryCycle === cycle) return false;
  const summary = buildLearningSummary();
  await setDoc(doc(db, "learningSummaries", activeUser.uid), {
    ...summary,
    updatedAt: serverTimestamp()
  }, { merge: true });
  updateMeta({ summaryCycle: cycle, summarySyncedAt: Date.now() });
  return true;
}

function recordId(record) {
  if (record?.attemptId) return String(record.attemptId);
  return [record?.source, record?.mode, record?.startedAt, record?.endedAt, record?.score].join("|");
}

function mergeHistory(localValue, remoteValue) {
  const local = safeParse(localValue || "[]", []);
  const remote = safeParse(remoteValue || "[]", []);
  const records = new Map();
  [...(Array.isArray(remote) ? remote : []), ...(Array.isArray(local) ? local : [])]
    .forEach(record => { if (record && typeof record === "object") records.set(recordId(record), record); });
  return JSON.stringify([...records.values()]
    .sort((a, b) => String(a.endedAt || a.startedAt || "").localeCompare(String(b.endedAt || b.startedAt || "")))
    .slice(-300));
}

function mergeTime(localValue, remoteValue) {
  const empty = { schemaVersion: 1, totalSeconds: 0, byPage: {}, updatedAt: null };
  const local = safeParse(localValue || "null", empty);
  const remote = safeParse(remoteValue || "null", empty);
  const byPage = {};
  const keys = new Set([...Object.keys(remote.byPage || {}), ...Object.keys(local.byPage || {})]);
  keys.forEach(key => {
    const a = remote.byPage?.[key] || {};
    const b = local.byPage?.[key] || {};
    const newer = String(b.lastVisitedAt || "") > String(a.lastVisitedAt || "") ? b : a;
    byPage[key] = {
      ...a,
      ...b,
      ...newer,
      seconds: Math.max(Number(a.seconds || 0), Number(b.seconds || 0)),
      visits: Math.max(Number(a.visits || 0), Number(b.visits || 0))
    };
  });
  const totalSeconds = Object.values(byPage).reduce((sum, page) => {
    const seconds = Number(page.seconds || 0);
    return sum + (seconds >= 120 ? seconds : 0);
  }, 0);
  return JSON.stringify({
    schemaVersion: 1,
    totalSeconds,
    byPage,
    updatedAt: [local.updatedAt, remote.updatedAt].filter(Boolean).sort().pop() || new Date().toISOString()
  });
}

function mergeArraysById(localValue, remoteValue, limit = Infinity) {
  const local = safeParse(localValue || "[]", []);
  const remote = safeParse(remoteValue || "[]", []);
  const items = new Map();
  [...(Array.isArray(remote) ? remote : []), ...(Array.isArray(local) ? local : [])].forEach((item, index) => {
    const id = item && typeof item === "object" ? (item.id || `${item.createdAt || "item"}-${index}`) : String(item);
    items.set(String(id), item);
  });
  return JSON.stringify([...items.values()].slice(-limit));
}

function mergeStringSets(localValue, remoteValue) {
  const local = safeParse(localValue || "[]", []);
  const remote = safeParse(remoteValue || "[]", []);
  return JSON.stringify([...new Set([...(Array.isArray(remote) ? remote : []), ...(Array.isArray(local) ? local : [])])]);
}

function mergeNotepad(localValue, remoteValue) {
  const empty = { notes: [], tags: [] };
  const local = safeParse(localValue || "null", empty);
  const remote = safeParse(remoteValue || "null", empty);
  const mergeItems = (remoteItems, localItems) => {
    const map = new Map();
    [...(remoteItems || []), ...(localItems || [])].forEach(item => {
      if (item?.id) map.set(String(item.id), item);
    });
    return [...map.values()];
  };
  return JSON.stringify({
    ...remote,
    ...local,
    notes: mergeItems(remote.notes, local.notes),
    tags: mergeItems(remote.tags, local.tags)
  });
}

function mergeForMigration(key, localValue, remoteValue) {
  if (key === "learning.progress.history.v1") return mergeHistory(localValue, remoteValue);
  if (key === "learning.progress.time.v1") return mergeTime(localValue, remoteValue);
  if (key === "learning.progress.images.v1") return mergeArraysById(localValue, remoteValue, 8);
  if (key === "studentNotepadData") return mergeNotepad(localValue, remoteValue);
  if (["vocabStarredIds", "vocab-bank.starred", "phraseStarredIds"].includes(key)) return mergeStringSets(localValue, remoteValue);
  return remoteValue ?? localValue;
}

function mergeBeforeUpload(key, localValue, remoteValue) {
  if (key === "learning.progress.history.v1") return mergeHistory(localValue, remoteValue);
  if (key === "learning.progress.time.v1") return mergeTime(localValue, remoteValue);
  return localValue;
}

function stateRef(userId, key) {
  return doc(db, "users", userId, "state", TRACKED_KEYS.get(key));
}

function chunkRef(userId, key, index) {
  return doc(collection(stateRef(userId, key), "chunks"), String(index).padStart(4, "0"));
}

async function readRemote(userId, key, providedSnapshot = null) {
  const snapshot = providedSnapshot || await getDoc(stateRef(userId, key));
  if (!snapshot.exists()) return { exists: false, value: null, revision: null, chunkCount: 0 };
  const data = snapshot.data() || {};
  if (data.deleted) return { exists: true, value: null, revision: data.revision || null, chunkCount: Number(data.chunkCount || 0) };
  if (typeof data.inlineValue === "string") {
    return { exists: true, value: data.inlineValue, revision: data.revision || null, chunkCount: Number(data.chunkCount || 0) };
  }
  const chunkCount = Number(data.chunkCount || 0);
  const chunks = await Promise.all(Array.from({ length: chunkCount }, (_, index) => getDoc(chunkRef(userId, key, index))));
  if (chunks.some(chunk => !chunk.exists())) throw new Error(`Incomplete cloud data for ${key}`);
  return {
    exists: true,
    value: chunks.map(chunk => String(chunk.data().value || "")).join(""),
    revision: data.revision || null,
    chunkCount
  };
}

async function writeRemote(userId, key, value, previousChunkCount = 0) {
  const revision = randomRevision();
  const text = value === null || value === undefined ? null : String(value);
  const chunks = text && text.length > CHUNK_SIZE
    ? Array.from({ length: Math.ceil(text.length / CHUNK_SIZE) }, (_, index) => text.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE))
    : [];
  const batch = writeBatch(db);
  chunks.forEach((chunk, index) => {
    batch.set(chunkRef(userId, key, index), { value: chunk, index, revision });
  });
  for (let index = chunks.length; index < previousChunkCount; index++) {
    batch.delete(chunkRef(userId, key, index));
  }
  batch.set(stateRef(userId, key), {
    schemaVersion: 1,
    key,
    deleted: text === null,
    inlineValue: text !== null && !chunks.length ? text : null,
    chunkCount: chunks.length,
    revision,
    writerDeviceId: deviceId(),
    updatedAtMs: Date.now(),
    updatedAt: serverTimestamp()
  });
  await batch.commit();
  return { revision, chunkCount: chunks.length };
}

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function applyRemoteValue(key, value, revision, chunkCount = 0) {
  setLocal(key, value);
  const meta = readMeta();
  meta.keys[key] = { ...(meta.keys[key] || {}), dirty: false, synced: true, revision, chunkCount, syncedAt: Date.now() };
  saveMeta(meta);
  emit("firebase-sync-updated", { key, source: "cloud" });
}

async function flushKey(key) {
  if (!activeUser || !syncReady) return;
  const meta = readMeta();
  if (!meta.keys[key]?.dirty) return;
  const capturedLocal = getLocal(key);
  // The latest cloud snapshot was already merged during the periodic pull.
  // Avoiding a read before every write roughly halves quota usage.
  const value = capturedLocal;
  const result = await writeRemote(activeUser.uid, key, value, Number(meta.keys[key]?.chunkCount || 0));
  const latestLocal = getLocal(key);
  const latestMeta = readMeta();
  const unchanged = latestLocal === value;
  latestMeta.keys[key] = {
    ...(latestMeta.keys[key] || {}),
    dirty: !unchanged,
    synced: true,
    revision: result.revision,
    chunkCount: result.chunkCount,
    syncedAt: Date.now()
  };
  saveMeta(latestMeta);
  observedValues.set(key, latestLocal);
  emit("firebase-sync-updated", { key, source: "local" });
  if (!unchanged) scheduleFlush();
}

function isWriteDue(key, keyMeta, now = Date.now(), force = false) {
  if (!keyMeta?.dirty) return false;
  if (force) return true;
  const policy = SYNC_POLICIES[key];
  const dirtyAge = Math.max(0, now - Number(keyMeta.dirtyAt || now));
  const sinceSync = Math.max(0, now - Number(keyMeta.syncedAt || 0));
  if (policy.minIntervalMs && sinceSync < policy.minIntervalMs) return false;
  return dirtyAge >= policy.idleMs || sinceSync >= policy.maxWaitMs;
}

function nextWriteDelay(meta, now = Date.now()) {
  let delay = 30000;
  [...TRACKED_KEYS.keys()].forEach(key => {
    const keyMeta = meta.keys[key];
    if (!keyMeta?.dirty) return;
    const policy = SYNC_POLICIES[key];
    const dirtyAge = Math.max(0, now - Number(keyMeta.dirtyAt || now));
    const sinceSync = Math.max(0, now - Number(keyMeta.syncedAt || 0));
    const untilMin = Math.max(0, policy.minIntervalMs - sinceSync);
    const untilIdle = Number.isFinite(policy.idleMs) ? Math.max(0, policy.idleMs - dirtyAge) : Infinity;
    const untilMax = Math.max(0, policy.maxWaitMs - sinceSync);
    delay = Math.min(delay, Math.max(untilMin, Math.min(untilIdle, untilMax)));
  });
  return Math.max(500, delay);
}

async function flushAll({ force = false } = {}) {
  if (!activeUser || !syncReady) return;
  const meta = readMeta();
  const now = Date.now();
  const dirtyKeys = [...TRACKED_KEYS.keys()].filter(key => isWriteDue(key, meta.keys[key], now, force));
  await Promise.allSettled(dirtyKeys.map(flushKey));
  await syncLearningSummary().catch(handleError);
  if ([...TRACKED_KEYS.keys()].some(key => readMeta().keys[key]?.dirty)) scheduleFlush();
}

function scheduleFlush() {
  clearTimeout(flushTimer);
  const delay = nextWriteDelay(readMeta());
  flushTimer = setTimeout(() => { flushAll().catch(handleError); }, delay);
}

function handleError(error) {
  console.warn("Learning record cloud sync is temporarily unavailable:", error);
  emit("firebase-sync-error", { message: "雲端同步暫時無法完成，紀錄已保留在本機，稍後會自動重試。" });
}

async function syncInitialKey(userId, key) {
  const localValue = getLocal(key);
  const remote = await readRemote(userId, key);
  const meta = readMeta();
  const keyMeta = meta.keys[key] || {};

  if (!remote.exists) {
    if (localValue !== null) {
      const result = await writeRemote(userId, key, localValue, 0);
      updateKeyMeta(key, {
        dirty: getLocal(key) !== localValue,
        synced: true,
        revision: result.revision,
        chunkCount: result.chunkCount,
        syncedAt: Date.now()
      });
    }
    observedValues.set(key, localValue);
    return false;
  }

  if (keyMeta.dirty) {
    const value = keyMeta.synced ? mergeBeforeUpload(key, localValue, remote.value) : mergeForMigration(key, localValue, remote.value);
    if (value !== localValue) setLocal(key, value);
    const result = await writeRemote(userId, key, value, remote.chunkCount);
    updateKeyMeta(key, {
      dirty: getLocal(key) !== value,
      synced: true,
      revision: result.revision,
      chunkCount: result.chunkCount,
      syncedAt: Date.now()
    });
    observedValues.set(key, value);
    return value !== localValue;
  }

  if (!keyMeta.synced && localValue !== null) {
    const merged = mergeForMigration(key, localValue, remote.value);
    if (merged !== remote.value) {
      setLocal(key, merged);
      const result = await writeRemote(userId, key, merged, remote.chunkCount);
      updateKeyMeta(key, {
        dirty: getLocal(key) !== merged,
        synced: true,
        revision: result.revision,
        chunkCount: result.chunkCount,
        syncedAt: Date.now()
      });
      return merged !== localValue;
    }
  }

  applyRemoteValue(key, remote.value, remote.revision, remote.chunkCount);
  return remote.value !== localValue;
}

async function pullAll(userId) {
  if (pullInFlight) return [];
  pullInFlight = true;
  try {
    const results = await Promise.all([...TRACKED_KEYS.keys()].map(key => syncInitialKey(userId, key)));
    updateMeta({ userId, lastPulledAt: Date.now() });
    return results;
  } finally {
    pullInFlight = false;
  }
}

function prepareUserCache(userId) {
  const meta = readMeta();
  // A shared computer must never show or upload the previous learner's local
  // cache. The previous account's cloud copy remains intact.
  if (meta.userId && meta.userId !== userId) {
    TRACKED_KEYS.forEach((_, key) => setLocal(key, null));
    meta.keys = {};
    meta.lastPulledAt = 0;
    meta.profileSyncedAt = 0;
    meta.summaryCycle = "";
    meta.summarySyncedAt = 0;
    delete meta.summaryFingerprint;
  }
  meta.userId = userId;
  saveMeta(meta);
  return meta;
}

async function updateProfileIfDue(user, profile) {
  const meta = readMeta();
  if (Date.now() - Number(meta.profileSyncedAt || 0) < PROFILE_WRITE_INTERVAL_MS) return;
  await setDoc(doc(db, "users", user.uid), {
    uid: user.uid,
    role: profile.role,
    school: profile.school,
    className: profile.className,
    seatNo: profile.seatNo,
    name: profile.name,
    lastSeenAt: serverTimestamp()
  }, { merge: true });
  updateMeta({ profileSyncedAt: Date.now() });
}

async function beginForUser(user) {
  activeUser = user;
  syncReady = false;
  activeProfile = await getPortalProfile(user);
  const meta = prepareUserCache(user.uid);
  await updateProfileIfDue(user, activeProfile);
  const forcePull = location.pathname.endsWith("/progress-report.html") || location.pathname.endsWith("progress-report.html");
  const pullDue = forcePull || Date.now() - Number(meta.lastPulledAt || 0) >= CLOUD_PULL_INTERVAL_MS;
  const results = pullDue ? await pullAll(user.uid) : [];
  syncReady = true;
  emit("firebase-sync-ready", { uid: user.uid, profile: activeProfile, cloudChecked: pullDue });
  syncLearningSummary().catch(handleError);
  scheduleFlush();

  // On a browser's first cloud restore, reload once so widgets that read their
  // stars only during construction immediately reflect the restored values.
  const restored = results.some(Boolean);
  const reloadKey = `learning.firebase-sync.restored.${user.uid}`;
  if (restored && !sessionStorage.getItem(reloadKey)) {
    sessionStorage.setItem(reloadKey, "1");
    location.reload();
  }
}

function startForUser(user) {
  clearTimeout(initializationTimer);
  beginForUser(user).catch(error => {
    handleError(error);
    initializationTimer = setTimeout(() => {
      if (activeUser?.uid === user.uid) startForUser(user);
    }, 6000);
  });
}

observePortalAuth(user => {
  if (!user) {
    clearTimeout(initializationTimer);
    activeUser = null;
    syncReady = false;
    return;
  }
  startForUser(user);
});

window.addEventListener("online", () => { scheduleFlush(); });
window.addEventListener("focus", () => {
  scheduleFlush();
  const meta = readMeta();
  if (activeUser && syncReady && Date.now() - Number(meta.lastPulledAt || 0) >= CLOUD_PULL_INTERVAL_MS) {
    pullAll(activeUser.uid).catch(handleError);
  }
});
window.addEventListener("storage", event => {
  if (TRACKED_KEYS.has(event.key)) observedValues.set(event.key, event.newValue);
});

setInterval(() => {
  TRACKED_KEYS.forEach((_, key) => {
    const current = getLocal(key);
    if (observedValues.has(key) && observedValues.get(key) !== current) markDirty(key);
    observedValues.set(key, current);
  });
  scheduleFlush();
  // When a learner leaves a tab open across 11:00 or 23:00, create the new
  // dashboard snapshot without waiting for another practice action.
  syncLearningSummary().catch(handleError);
  const meta = readMeta();
  if (activeUser && syncReady && Date.now() - Number(meta.lastPulledAt || 0) >= CLOUD_PULL_INTERVAL_MS) {
    pullAll(activeUser.uid).catch(handleError);
  }
}, HOUSEKEEPING_INTERVAL_MS);

window.FirebaseLearningSync = {
  get ready() { return syncReady; },
  get user() { return activeUser; },
  get profile() { return activeProfile; },
  flush: () => flushAll({ force: true }),
  pull: () => activeUser ? pullAll(activeUser.uid) : Promise.resolve([]),
  trackedKeys: [...TRACKED_KEYS.keys()]
};
