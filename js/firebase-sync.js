import {
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
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
const WRITE_DELAY_MS = 900;

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
let unsubscribeSnapshots = [];
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
  return revision;
}

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function applyRemoteValue(key, value, revision) {
  setLocal(key, value);
  const meta = readMeta();
  meta.keys[key] = { ...(meta.keys[key] || {}), dirty: false, synced: true, revision, syncedAt: Date.now() };
  saveMeta(meta);
  emit("firebase-sync-updated", { key, source: "cloud" });
}

async function flushKey(key) {
  if (!activeUser || !syncReady) return;
  const meta = readMeta();
  if (!meta.keys[key]?.dirty) return;
  const capturedLocal = getLocal(key);
  const remote = await readRemote(activeUser.uid, key);
  const value = remote.exists ? mergeBeforeUpload(key, capturedLocal, remote.value) : capturedLocal;
  if (value !== capturedLocal) setLocal(key, value);
  const revision = await writeRemote(activeUser.uid, key, value, remote.chunkCount);
  const latestLocal = getLocal(key);
  const latestMeta = readMeta();
  const unchanged = latestLocal === value;
  latestMeta.keys[key] = {
    ...(latestMeta.keys[key] || {}),
    dirty: !unchanged,
    synced: true,
    revision,
    syncedAt: Date.now()
  };
  saveMeta(latestMeta);
  observedValues.set(key, latestLocal);
  emit("firebase-sync-updated", { key, source: "local" });
  if (!unchanged) scheduleFlush();
}

async function flushAll() {
  if (!activeUser || !syncReady) return;
  const meta = readMeta();
  const dirtyKeys = [...TRACKED_KEYS.keys()].filter(key => meta.keys[key]?.dirty);
  await Promise.allSettled(dirtyKeys.map(flushKey));
}

function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushAll().catch(handleError); }, WRITE_DELAY_MS);
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
      const revision = await writeRemote(userId, key, localValue, 0);
      updateKeyMeta(key, {
        dirty: getLocal(key) !== localValue,
        synced: true,
        revision,
        syncedAt: Date.now()
      });
    }
    observedValues.set(key, localValue);
    return false;
  }

  if (keyMeta.dirty) {
    const value = keyMeta.synced ? mergeBeforeUpload(key, localValue, remote.value) : mergeForMigration(key, localValue, remote.value);
    if (value !== localValue) setLocal(key, value);
    const revision = await writeRemote(userId, key, value, remote.chunkCount);
    updateKeyMeta(key, {
      dirty: getLocal(key) !== value,
      synced: true,
      revision,
      syncedAt: Date.now()
    });
    observedValues.set(key, value);
    return value !== localValue;
  }

  if (!keyMeta.synced && localValue !== null) {
    const merged = mergeForMigration(key, localValue, remote.value);
    if (merged !== remote.value) {
      setLocal(key, merged);
      const revision = await writeRemote(userId, key, merged, remote.chunkCount);
      updateKeyMeta(key, {
        dirty: getLocal(key) !== merged,
        synced: true,
        revision,
        syncedAt: Date.now()
      });
      return merged !== localValue;
    }
  }

  applyRemoteValue(key, remote.value, remote.revision);
  return remote.value !== localValue;
}

function attachSnapshots(userId) {
  unsubscribeSnapshots.forEach(unsubscribe => unsubscribe());
  unsubscribeSnapshots = [...TRACKED_KEYS.keys()].map(key => onSnapshot(stateRef(userId, key), async snapshot => {
    try {
      if (!snapshot.exists() || snapshot.metadata.hasPendingWrites) return;
      const remote = await readRemote(userId, key, snapshot);
      const meta = readMeta();
      const keyMeta = meta.keys[key] || {};
      if (remote.revision && remote.revision === keyMeta.revision) return;
      if (keyMeta.dirty) {
        scheduleFlush();
        return;
      }
      if (getLocal(key) !== remote.value) applyRemoteValue(key, remote.value, remote.revision);
    } catch (error) { handleError(error); }
  }, handleError));
}

async function beginForUser(user) {
  activeUser = user;
  syncReady = false;
  activeProfile = await getPortalProfile(user);
  await setDoc(doc(db, "users", user.uid), {
    uid: user.uid,
    role: activeProfile.role,
    school: activeProfile.school,
    className: activeProfile.className,
    seatNo: activeProfile.seatNo,
    name: activeProfile.name,
    lastSeenAt: serverTimestamp()
  }, { merge: true });

  const results = await Promise.all([...TRACKED_KEYS.keys()].map(key => syncInitialKey(user.uid, key)));
  syncReady = true;
  attachSnapshots(user.uid);
  emit("firebase-sync-ready", { uid: user.uid, profile: activeProfile });
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
    unsubscribeSnapshots.forEach(unsubscribe => unsubscribe());
    unsubscribeSnapshots = [];
    return;
  }
  startForUser(user);
});

window.addEventListener("online", scheduleFlush);
window.addEventListener("focus", scheduleFlush);
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
}, 4000);

window.FirebaseLearningSync = {
  get ready() { return syncReady; },
  get user() { return activeUser; },
  get profile() { return activeProfile; },
  flush: flushAll,
  trackedKeys: [...TRACKED_KEYS.keys()]
};
