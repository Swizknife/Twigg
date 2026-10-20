// Where collected roles live: IndexedDB in this browser. Works in the service worker and in pages.
// UIs re-render when `rolesVersion` in chrome.storage changes.

import { normalizeRole, mergeRole, evaluate, defaultFilters, APPLIED_STATUSES } from './roles.js';
import { loadProfile, findEducation } from './profile.js';

const DB = 'twigg';
const STORE = 'roles';
let dbPromise;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, work) {
  const store = (await db()).transaction(STORE, mode);
  const result = work(store.objectStore(STORE));
  return new Promise((resolve, reject) => {
    store.oncomplete = () => resolve(result?.result); // writes that queue several puts return no single request
    store.onerror = store.onabort = () => reject(store.error);
  });
}

const touch = () => chrome.storage.local.set({ rolesVersion: Date.now() });

export const getAllRoles = () => run('readonly', (s) => s.getAll());
export const getRole = (id) => run('readonly', (s) => s.get(id));

export async function putRoles(roles) {
  if (!roles.length) return;
  await run('readwrite', (s) => roles.forEach((r) => s.put(r)));
  await touch();
}

export async function deleteRole(id) {
  await run('readwrite', (s) => s.delete(id));
  await touch();
}

export async function updateRole(id, patch) {
  const role = await getRole(id);
  if (!role) return null;
  const next = { ...role, ...patch, updatedAt: new Date().toISOString() };
  await putRoles([next]);
  return next;
}

/** Save records already analysed by the background worker (e.g. from the "this page" card). */
export async function saveRecords(records) {
  const existing = new Map((await getAllRoles()).map((r) => [r.id, r]));
  const now = new Date();
  await putRoles(
    records.map(({ isNew, saved, ...rec }) => mergeRole(existing.get(rec.id), rec, now))
  );
}

// ---------- filters ----------

export async function filterContext() {
  const { profile } = await loadProfile();
  return { batchYear: findEducation(profile).college?.graduationYear || '' };
}

export async function loadFilters() {
  const [{ filters }, ctx] = await Promise.all([chrome.storage.local.get('filters'), filterContext()]);
  return { ...defaultFilters(ctx), ...(filters || {}) };
}

export async function saveFilters(filters) {
  const clean = { ...filters };
  if (!clean.batchYear) delete clean.batchYear; // empty = follow the graduation year in your profile
  await chrome.storage.local.set({ filters: clean });
  await reevaluateAll();
}

export async function reevaluateAll() {
  const [roles, filters] = await Promise.all([getAllRoles(), loadFilters()]);
  const now = new Date();
  await putRoles(roles.map((r) => ({ ...r, eval: evaluate(r, filters, now) })));
}

// ---------- ingesting scraped roles ----------

/**
 * Normalise + judge scraped roles and (optionally) save them.
 * Returns [{ rec, isNew }] — `rec.dupOf` is set when you already applied to the same company+title elsewhere.
 */
export async function ingest(raws, { persist = true } = {}) {
  const [filters, existingList] = await Promise.all([loadFilters(), getAllRoles()]);
  const existing = new Map(existingList.map((r) => [r.id, r]));
  const now = new Date();
  const out = new Map();

  for (const raw of raws) {
    const incoming = normalizeRole(raw, now);
    if (!incoming.title || !incoming.url) continue;
    const prev = out.get(incoming.id)?.rec || existing.get(incoming.id);
    const rec = mergeRole(prev, incoming, now);
    rec.eval = evaluate(rec, filters, now);
    const dup = existingList.find((r) => r.id !== rec.id && r.dupKey && r.dupKey === rec.dupKey && APPLIED_STATUSES.has(r.status));
    rec.dupOf = dup ? { id: dup.id, status: dup.status, appliedAt: dup.appliedAt, url: dup.url } : undefined;
    out.set(rec.id, { rec, isNew: !existing.has(rec.id) });
  }

  const results = [...out.values()];
  if (persist) await putRoles(results.map((r) => r.rec));
  return results;
}
