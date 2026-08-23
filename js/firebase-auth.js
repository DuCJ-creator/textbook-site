import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  getIdTokenResult,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCmWiKCq7kWMEzpGuTkn-Eu2hXjvlot7yo",
  authDomain: "textbook-site.firebaseapp.com",
  projectId: "textbook-site",
  storageBucket: "textbook-site.firebasestorage.app",
  messagingSenderId: "1080267900580",
  appId: "1:1080267900580:web:19dd19e1631cdc9dfd0831",
  measurementId: "G-7E9X2J0G72"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const persistenceReady = setPersistence(auth, browserLocalPersistence);

function normalizeIdentityPart(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Firebase Password Auth requires an email-shaped identifier. The portal never
 * asks learners for email; instead both the importer and the browser derive the
 * same private, deterministic alias from the visible login fields.
 */
export async function buildInternalEmail({ role, school, className, name }) {
  const normalizedRole = role === "teacher" ? "teacher" : "student";
  const identity = normalizedRole === "teacher"
    ? [normalizedRole, normalizeIdentityPart(school), normalizeIdentityPart(name)].join("|")
    : [normalizedRole, normalizeIdentityPart(className), normalizeIdentityPart(name)].join("|");
  const hash = await sha256Hex(identity);
  const prefix = normalizedRole === "teacher" ? "t" : "s";
  return `${prefix}.${hash.slice(0, 48)}@textbook-site.firebaseapp.com`;
}

export async function signInPortal(identity, password) {
  await persistenceReady;
  const email = await buildInternalEmail(identity);
  return signInWithEmailAndPassword(auth, email, password);
}

export function observePortalAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function getPortalProfile(user = auth.currentUser) {
  if (!user) return null;
  await user.reload();
  const token = await getIdTokenResult(user, true);
  return {
    uid: user.uid,
    role: String(token.claims.role || "student"),
    school: String(token.claims.school || ""),
    className: String(token.claims.className || ""),
    seatNo: String(token.claims.seatNo || ""),
    name: String(user.displayName || "")
  };
}

export async function signOutPortal() {
  await persistenceReady;
  return signOut(auth);
}

export { auth };
