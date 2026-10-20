// Your resume data. It lives in chrome.storage.local (this browser only) and is edited
// from the Twigg profile page. extension/profile/profile.json is only the blank starting template.
//
// Storage model:
//   profile  → what is true about you whichever resume you send: basics, education, preferences
//   resumes  → [{ id, label, pdf, tex, content }] one per target role; content = what THAT resume shows
//              (skills, projects, experience, achievements, certifications)
// Everything else in Twigg reads loadProfile().profile — the shared details plus the union of all resumes,
// because every project on every resume is true about you.

const KEYS = ['profile', 'answers', 'voice', 'resumes', 'resumeFiles'];
export const SHARED_KEYS = ['basics', 'education', 'preferences'];
export const CONTENT_KEYS = ['skills', 'projects', 'experience', 'achievements', 'certifications'];
export const MAX_RESUMES = 4;

async function bundled(path) {
  try {
    const res = await fetch(chrome.runtime.getURL(path));
    return res.ok ? await res.json() : {};
  } catch {
    return {};
  }
}

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Add keys the template has but the stored profile lacks (so new fields appear after updates). */
function withDefaults(template, value) {
  if (!isObject(template)) return value ?? template;
  const out = { ...(isObject(value) ? value : {}) };
  for (const [key, def] of Object.entries(template)) {
    if (isObject(def)) out[key] = withDefaults(def, out[key]);
    else if (!(key in out)) out[key] = def;
  }
  return out;
}

/** chrome.storage hands keys back alphabetised; restore the template's natural order (name before email, etc.). */
function orderLike(value, template) {
  if (Array.isArray(value)) {
    const refs = Array.isArray(template) ? template.filter(isObject) : [];
    const keys = [...new Set(refs.flatMap(Object.keys))];
    const merged = Object.fromEntries(keys.map((k) => [k, refs.find((r) => k in r)[k]]));
    return value.map((v) => (isObject(v) ? orderLike(v, merged) : v));
  }
  if (!isObject(value)) return value;
  const out = {};
  const known = isObject(template) ? template : {};
  for (const k of Object.keys(known)) if (k in value) out[k] = orderLike(value[k], known[k]);
  for (const k of Object.keys(value)) if (!(k in out)) out[k] = orderLike(value[k]);
  return out;
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj && k in obj).map((k) => [k, obj[k]]));

/** Templates for the two halves of the profile, cut from the bundled profile.json. */
export function splitTemplate(template) {
  return { shared: pick(template, SHARED_KEYS), content: pick(template, CONTENT_KEYS) };
}

/** Any real value anywhere inside (used to drop blank template rows like an empty project card). */
function hasValue(v) {
  if (Array.isArray(v)) return v.some(hasValue);
  if (isObject(v)) return Object.values(v).some(hasValue);
  return v != null && v !== '' && v !== false && v !== 0;
}

/**
 * Bring stored data to the current model. Older Twigg kept one profile with everything in it plus
 * `resumeFiles: { pdf, tex }`; that becomes resume #1. Pure — returns { shared, resumes, migrated }.
 */
export function migrateStored(stored) {
  const old = stored.profile || {};
  if (Array.isArray(stored.resumes)) return { shared: pick(old, SHARED_KEYS), resumes: stored.resumes, migrated: false };
  const files = stored.resumeFiles || {};
  const content = pick(old, CONTENT_KEYS);
  const resumes = files.pdf || files.tex || hasValue(content) ? [{ id: 'r1', label: 'My resume', ...(files.pdf && { pdf: files.pdf }), ...(files.tex && { tex: files.tex }), content }] : [];
  return { shared: pick(old, SHARED_KEYS), resumes, migrated: true };
}

// keep + and # so "C", "C++" and "C#" stay three different skills
const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim();
function uniqStrings(lists) {
  const seen = new Set();
  return lists.flat().filter((s) => {
    const k = key(s);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function uniqBy(items, keyOf, richer) {
  const out = new Map();
  for (const item of items) {
    if (!hasValue(item)) continue;
    const k = keyOf(item);
    if (!k) continue;
    const prev = out.get(k);
    out.set(k, prev ? richer(prev, item) : item);
  }
  return [...out.values()];
}
const moreBullets = (a, b) => ((b.bullets || []).length > (a.bullets || []).length ? b : a);

/** Shared details + the union of every resume's content (duplicates merged). */
export function combineProfile(shared, resumes) {
  const contents = (resumes || []).map((r) => r.content || {});
  const skills = {};
  for (const c of contents) for (const [cat, list] of Object.entries(c.skills || {})) skills[cat] = uniqStrings([skills[cat] || [], list || []]);
  return {
    ...shared,
    skills,
    projects: uniqBy(contents.flatMap((c) => c.projects || []), (p) => key(p.name), moreBullets),
    experience: uniqBy(contents.flatMap((c) => c.experience || []), (e) => key(`${e.company} ${e.role}`), moreBullets),
    achievements: uniqStrings(contents.map((c) => c.achievements || [])),
    certifications: uniqStrings(contents.map((c) => c.certifications || [])),
  };
}

/**
 * Everything the profile page and the features need.
 *   profile  — combined view (shared + all resumes) used by chat, autofill, fit, posts, outreach, skill gaps
 *   shared   — the "About you" part        resumes — [{ id, label, pdf, tex, content }]
 */
export async function loadProfile() {
  const [stored, template] = await Promise.all([chrome.storage.local.get(KEYS), bundled('profile/profile.json')]);
  const tpl = splitTemplate(template);
  const { shared: rawShared, resumes: rawResumes, migrated } = migrateStored(stored);
  if (migrated && (rawResumes.length || stored.profile)) {
    // save the new shape once; if storage is full this just retries next time
    await chrome.storage.local.set({ profile: rawShared, resumes: rawResumes }).then(() => chrome.storage.local.remove('resumeFiles')).catch(() => {});
  }
  const shared = orderLike(withDefaults(tpl.shared, rawShared), tpl.shared);
  const resumes = rawResumes.map((r) => ({ ...r, content: orderLike(withDefaults(tpl.content, r.content), tpl.content) }));
  return {
    profile: orderLike(combineProfile(shared, resumes), template),
    shared,
    resumes,
    answers: stored.answers || [], // [{ question, answer, learned? }]
    voice: stored.voice || '',
    template,
    templates: tpl,
  };
}

export const saveProfile = (shared) => chrome.storage.local.set({ profile: pick(shared, SHARED_KEYS) });
export const saveResumes = (resumes) => chrome.storage.local.set({ resumes });
export const saveAnswers = (answers) => chrome.storage.local.set({ answers });
export const saveVoice = (voice) => chrome.storage.local.set({ voice });

/** Turn a storage failure into words a person can act on (a full disk used to fail silently). */
export function storageErrorMessage(err) {
  const msg = String(err?.message || err || '');
  if (/quota|no space|disk|full|IO error|FILE_ERROR_NO_SPACE|ENOSPC/i.test(msg)) {
    return "Couldn't save: your disk (or the browser's storage) is full. Free some space on your C: drive and try again.";
  }
  return `Couldn't save: ${msg || 'unknown error'}`;
}

export function onProfileChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEYS.some((k) => k in changes)) callback();
  });
}

export function isProfileFilled(profile) {
  return Boolean(profile?.basics?.name?.trim());
}

// ---------- resumes (PDF for upload fields, .tex for tailoring) ----------

/** All resumes with their files: [{ id, label, pdf?, tex?, content }]. */
export async function getResumes() {
  return (await loadProfile()).resumes;
}

export const newResumeId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function toBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** kind: 'pdf' | 'tex' → the record stored on a resume. */
export async function fileRecord(kind, file) {
  const record = { name: file.name, size: file.size, updated: Date.now() };
  if (kind === 'pdf') record.data = toBase64(await file.arrayBuffer());
  else record.text = await file.text();
  return record;
}

/**
 * Store (or remove, when record is null) one file on one resume right away, without touching
 * anything else that is still unsaved on the profile page. A resume that only exists on the page yet
 * is created in storage with its label and blank content — its details are saved when you press Save.
 */
export async function persistResumeFile(resume, kind, record, blankContent) {
  const { resumes } = await loadProfile();
  let stored = resumes.find((r) => r.id === resume.id);
  if (!stored) {
    stored = { id: resume.id, label: resume.label, content: structuredClone(blankContent || {}) };
    resumes.push(stored);
  }
  if (record) stored[kind] = record;
  else delete stored[kind];
  await saveResumes(resumes);
}

export async function deleteResume(id) {
  const { resumes } = await loadProfile();
  await saveResumes(resumes.filter((r) => r.id !== id));
}

/** A backup file (old single-resume format or the current one) → { shared, resumes, answers, voice }. */
export function fromBackup(backup) {
  if (!backup || typeof backup.profile !== 'object' || ![1, 2].includes(backup.twigg)) throw new Error('This is not a Twigg backup file.');
  const { shared, resumes } = backup.twigg === 2 ? { shared: pick(backup.profile, SHARED_KEYS), resumes: backup.resumes || [] } : migrateStored({ profile: backup.profile, resumeFiles: backup.resumeFiles });
  return { shared, resumes, answers: Array.isArray(backup.answers) ? backup.answers : [], voice: typeof backup.voice === 'string' ? backup.voice : '' };
}

// ---------- what the AI may see ----------

/**
 * The parts of the profile the AI needs to reason about fit and write text.
 * Contact details, DOB, address and IDs are left out — autofill fills those locally without the AI.
 */
export function profileForAI(profile) {
  if (!profile) return {};
  const { basics = {}, education, skills, projects, experience, achievements, certifications, preferences } = profile;
  return {
    name: basics.name,
    headline: basics.headline,
    links: { github: basics.github, linkedin: basics.linkedin, portfolio: basics.portfolio },
    education: (education || []).map(({ rollNumber, ...rest }) => rest),
    skills,
    projects,
    experience,
    achievements,
    certifications,
    preferences,
  };
}

// ---------- flat values for form filling ----------

const DEGREE_10 = /\b(10|x|tenth|ssc|matric|secondary)\b/i;
const DEGREE_12 = /\b(12|xii|twelfth|hsc|intermediate|senior secondary)\b/i;

export function findEducation(profile) {
  const edu = profile?.education || [];
  const tenth = edu.find((e) => DEGREE_10.test(e.degree || '') && !DEGREE_12.test(e.degree || ''));
  const twelfth = edu.find((e) => DEGREE_12.test(e.degree || ''));
  const college = edu.find((e) => e !== tenth && e !== twelfth);
  return { college, tenth, twelfth };
}

const digits = (s) => String(s || '').replace(/\D/g, '');

/**
 * key → string value. Empty values are omitted so a missing detail stays unfilled
 * (shown red) instead of being guessed. Everything stays on this laptop.
 */
export function flattenProfile(profile) {
  const b = profile?.basics || {};
  const addr = b.address || {};
  const { college, tenth, twelfth } = findEducation(profile);
  const prefs = profile?.preferences || {};

  const name = (b.name || '').trim();
  const parts = name.split(/\s+/);
  const phone = (b.phone || '').trim();
  const phoneDigits = digits(phone);
  const countryCode = b.phoneCountryCode || (phone.startsWith('+') && phoneDigits.length > 10 ? `+${phoneDigits.slice(0, phoneDigits.length - 10)}` : '');

  const cgpa = parseFloat(college?.cgpa);
  const scale = parseFloat(college?.cgpaScale) || 10;

  const flat = {
    fullName: name,
    firstName: parts.length > 1 ? parts.slice(0, -1).join(' ') : name,
    lastName: parts.length > 1 ? parts[parts.length - 1] : '',
    email: b.email,
    phone,
    phone10: phoneDigits.length >= 10 ? phoneDigits.slice(-10) : '',
    phoneCountryCode: countryCode,
    linkedin: b.linkedin,
    github: b.github,
    portfolio: b.portfolio,
    dob: b.dateOfBirth,
    gender: b.gender,
    nationality: b.nationality,
    addressLine: addr.line,
    city: addr.city || b.currentCity,
    state: addr.state,
    postalCode: addr.postalCode,
    country: addr.country,
    college: college?.institution,
    degree: college?.degree,
    branch: college?.branch,
    startYear: college?.startYear,
    gradYear: college?.graduationYear,
    cgpa: college?.cgpa,
    cgpaScale: college?.cgpaScale,
    rollNumber: college?.rollNumber,
    tenthPercent: tenth?.score,
    tenthBoard: tenth?.board,
    tenthYear: tenth?.year,
    tenthSchool: tenth?.institution,
    twelfthPercent: twelfth?.score,
    twelfthBoard: twelfth?.board,
    twelfthYear: twelfth?.year,
    twelfthSchool: twelfth?.institution,
    headline: b.headline,
    availableFrom: prefs.availableFrom,
    expectedStipend: prefs.minStipendINR,
    willingToRelocate: prefs.willingToRelocate,
  };
  if (cgpa > 0 && scale === 10) flat.cgpaPercent = (cgpa * 9.5).toFixed(1);

  return Object.fromEntries(Object.entries(flat).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '').map(([k, v]) => [k, String(v).trim()]));
}

/** Keys whose value is computed rather than copied from the profile — shown yellow so you double-check. */
export const DERIVED_KEYS = ['cgpaPercent'];

// ---------- merging a re-imported resume into the profile ----------

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function isEmpty(v) {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0);
}

function mergeEducation(base = [], imported = []) {
  const out = base.map((e) => ({ ...e }));
  for (const item of imported) {
    const match = out.find((e) => (norm(e.institution) && norm(e.institution) === norm(item.institution)) || (norm(e.degree) && norm(e.degree) === norm(item.degree)));
    if (match) {
      for (const [k, v] of Object.entries(item)) if (!isEmpty(v)) match[k] = v;
    } else if (Object.values(item).some((v) => !isEmpty(v))) {
      out.push(item);
    }
  }
  return out;
}

/**
 * Fold AI-extracted resume data into the existing profile.
 * Resume wins where it has something; form-only details (DOB, 10th/12th, address, preferences) are kept.
 */
export function mergeImported(base, imported, key = '') {
  if (key === 'education') return mergeEducation(base, imported);
  if (Array.isArray(imported)) return imported.length ? imported : base;
  if (isObject(imported)) {
    const out = { ...(isObject(base) ? base : {}) };
    for (const [k, v] of Object.entries(imported)) out[k] = mergeImported(out[k], v, k);
    return out;
  }
  return isEmpty(imported) ? base : imported;
}
