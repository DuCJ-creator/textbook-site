import {
  collection,
  getDocs,
  getFirestore,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { app } from "./firebase-auth.js";

const db = getFirestore(app);
const CACHE_PREFIX = "shirley.classroom-sparks.cache.v1:";
const DEFAULT_MAX_AGE = 6 * 60 * 60 * 1000;

export function classroomAudienceKey(profile) {
  return `${String(profile?.school || "").trim()}::${String(profile?.className || "").trim()}`;
}

function timestampValue(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (typeof value === "string") return value;
  return null;
}

function normalizeSpark(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    title: String(data.title || ""),
    question: String(data.question || ""),
    quickAnswer: String(data.quickAnswer || ""),
    explanation: String(data.explanation || ""),
    comparison: String(data.comparison || ""),
    examples: String(data.examples || ""),
    challenge: String(data.challenge || ""),
    source: String(data.source || ""),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    audienceKeys: Array.isArray(data.audienceKeys) ? data.audienceKeys.map(String) : [],
    status: String(data.status || "draft"),
    publishedAt: timestampValue(data.publishedAt),
    updatedAt: timestampValue(data.updatedAt),
    createdAt: timestampValue(data.createdAt)
  };
}

function sortNewest(items) {
  return items.sort((a, b) => String(b.publishedAt || b.updatedAt || "").localeCompare(String(a.publishedAt || a.updatedAt || "")));
}

export async function loadPublishedSparks(profile, options = {}) {
  const force = options.force === true;
  const maxAgeMs = Number(options.maxAgeMs ?? DEFAULT_MAX_AGE);
  const audienceKey = profile?.admin ? "ADMIN" : classroomAudienceKey(profile);
  if (!profile?.admin && (!profile?.school || !profile?.className)) return [];
  const cacheKey = CACHE_PREFIX + encodeURIComponent(audienceKey);

  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (cached?.loadedAt && Date.now() - Number(cached.loadedAt) < maxAgeMs && Array.isArray(cached.items)) {
        return sortNewest(cached.items);
      }
    } catch (_) {}
  }

  const source = collection(db, "classroomSparks");
  const request = profile.admin
    ? query(source, where("status", "==", "published"))
    : query(source,
        where("status", "==", "published"),
        where("audienceKeys", "array-contains-any", ["ALL", audienceKey]));
  const snapshot = await getDocs(request);
  const items = sortNewest(snapshot.docs.map(normalizeSpark));
  try { localStorage.setItem(cacheKey, JSON.stringify({ loadedAt: Date.now(), items })); } catch (_) {}
  return items;
}

export function clearClassroomSparksCache() {
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
  });
}
