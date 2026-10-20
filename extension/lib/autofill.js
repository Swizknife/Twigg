// Autofill orchestrator. Runs in the side panel (or background for the Alt+F shortcut).
//
//   1. inject the field scripts into every frame of the tab
//   2. each frame scans its form and fills what your profile answers directly (no AI)
//   3. fields still empty go to the AI in ONE request — it never sees phone, email, address or DOB
//   4. the AI's answers are written back, everything is colour-coded
//   5. your resume PDF is attached to upload fields
// It never clicks Submit or Next.

import { completeJSON, primaryProvider } from './llm.js';
import { fillPrompt } from './prompts.js';
import { loadProfile, flattenProfile, profileForAI, getResumes, saveAnswers } from './profile.js';

const MAX_AI_FIELDS = 40;
const PAGE_CHARS = { gemini: 6000, ollama: 2500 };

const inFrames = (tabId, func, args = [], frameIds) =>
  chrome.scripting.executeScript({ target: frameIds ? { tabId, frameIds } : { tabId, allFrames: true }, func, args });

async function injectScripts(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content/fieldmatch.js', 'content/fields.js'] });
}

async function pageContext(tabId, provider) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/extract.js'] });
    const [{ result }] = await inFrames(tabId, (n) => window.TwiggExtract.page(n), [PAGE_CHARS[provider]], [0]);
    return result;
  } catch {
    return { title: '', url: '', text: '' };
  }
}

/**
 * Fill the form(s) on a tab.
 * Returns { counts, attention, notes, resumeChoice } for the side panel to display.
 * resumeChoice is set when the form wants a resume and you have several: the panel asks which one.
 */
export async function fillTab(tabId, { useAI = true, overwrite = false, resumeId = null } = {}, progress = () => {}) {
  const { profile, answers } = await loadProfile();
  const flat = flattenProfile(profile);
  if (!Object.keys(flat).length) throw new Error('Your profile is empty. Add your resume details first (👤 in the top bar).');

  progress('Scanning the page…');
  await injectScripts(tabId);
  const saved = answers.filter((a) => a.question && a.answer);
  const runs = (await inFrames(tabId, (f, s, o) => TwiggFill.run(f, s, o), [flat, saved, { overwrite }])).filter((r) => Array.isArray(r.result));

  const total = runs.reduce((n, r) => n + r.result.length, 0);
  if (!total) {
    return { counts: {}, attention: [], notes: ["No form fields found. Some sites load the form after you click Apply — open the form, then run Fill again."] };
  }

  // ---- AI for what the profile couldn't answer ----
  const notes = [];
  const items = new Map(); // frameId → [{ id, value }]
  const pending = runs.flatMap((r) => r.result.filter((f) => f.status === 'pending').map((f) => ({ ...f, frameId: r.frameId })));

  if (useAI && pending.length) {
    const asked = pending
      .sort((a, b) => (b.required - a.required) || (b.kind === 'textarea') - (a.kind === 'textarea'))
      .slice(0, MAX_AI_FIELDS);
    progress(`Asking AI about ${asked.length} field${asked.length > 1 ? 's' : ''}…`);
    try {
      const provider = await primaryProvider();
      const page = await pageContext(tabId, provider);
      const { system, user } = fillPrompt({
        profile: profileForAI(profile),
        answers,
        page,
        fields: asked.map((f) => ({ id: `${f.frameId}:${f.id}`, label: f.label, type: f.kind, required: f.required || undefined, options: f.options, maxLength: f.maxLength || undefined })),
      });
      const result = await completeJSON({ system, messages: [{ role: 'user', content: user }] });
      const valid = new Set(asked.map((f) => `${f.frameId}:${f.id}`));
      for (const fill of result.fills || []) {
        if (!valid.has(fill.id) || !String(fill.value ?? '').trim()) continue;
        const [frameId, id] = fill.id.split(':');
        (items.get(+frameId) || items.set(+frameId, []).get(+frameId)).push({ id, value: String(fill.value) });
      }
    } catch (err) {
      notes.push(`AI step skipped: ${err.message}${err.hint ? ` (${err.hint})` : ''}`);
    }
  }

  // ---- write AI answers, colour everything ----
  progress('Finishing…');
  const final = [];
  for (const { frameId } of runs) {
    const [res] = await inFrames(tabId, (it) => TwiggFill.finalize(it), [items.get(frameId) || []], [frameId]);
    final.push({ frameId, fields: res.result });
  }

  // ---- resume PDF ----
  // With one resume there is nothing to choose. With two or more, Twigg ASKS (the user's choice):
  // the upload field stays red and the Fill tab shows a picker.
  const resumes = (await getResumes()).filter((r) => r.pdf);
  const slots = final.flatMap((r) => r.fields.filter((f) => f.kind === 'file' && f.resumeSlot && f.status === 'file').map((f) => ({ frameId: r.frameId, id: f.id, resumeSlot: f.resumeSlot })));
  let resumeChoice = null;
  if (slots.length && !resumes.length) {
    notes.push('This form has a resume upload, but no PDF is stored. Upload one in your profile (👤).');
  } else if (slots.length) {
    const chosen = resumeId ? resumes.find((r) => r.id === resumeId) : resumes.length === 1 ? resumes[0] : null;
    if (chosen) {
      const results = await attachResume(tabId, slots, chosen.id);
      for (const r of results) Object.assign(final.find((x) => x.frameId === r.frameId).fields.find((f) => f.id === r.id), { status: r.status, note: r.note });
    } else {
      for (const slot of slots) {
        const note = 'Choose which resume to attach (Fill tab)';
        await inFrames(tabId, (id, n) => TwiggFill.mark(id, 'needs', n), [slot.id, note], [slot.frameId]);
        Object.assign(final.find((x) => x.frameId === slot.frameId).fields.find((f) => f.id === slot.id), { status: 'needs', note });
      }
      resumeChoice = { slots, resumes: resumes.map((r) => ({ id: r.id, label: r.label, file: r.pdf.name })) };
    }
  }

  // ---- summary ----
  const counts = { filled: 0, check: 0, needs: 0, skipped: 0, existing: 0 };
  const attention = [];
  for (const { frameId, fields } of final) {
    for (const f of fields) {
      const group = { rule: 'filled', learned: 'filled', file: 'filled', ai: 'check', review: 'check', needs: 'needs', skipped: 'skipped', existing: 'existing' }[f.status];
      if (group) counts[group]++;
      if (group === 'check' || group === 'needs') {
        attention.push({ frameId, id: f.id, label: f.label || '(unlabelled field)', status: group, kind: f.kind, note: f.note || '', required: f.required });
      }
    }
  }
  attention.sort((a, b) => (a.status === b.status ? 0 : a.status === 'needs' ? -1 : 1));
  return { counts, attention, notes, resumeChoice };
}

/**
 * Put one resume's PDF into the form's resume upload field(s).
 * slots: [{ frameId, id, resumeSlot }] from fillTab. Returns [{ frameId, id, status, note }].
 */
export async function attachResume(tabId, slots, resumeId) {
  const resume = (await getResumes()).find((r) => r.id === resumeId && r.pdf);
  if (!resume) throw new Error('That resume has no PDF any more. Upload one in your profile (👤).');
  const file = { name: resume.pdf.name, type: 'application/pdf', b64: resume.pdf.data };

  // 'gone' = the frame or the field no longer exists (the site rebuilt its form after Twigg filled it)
  const tryAttach = async (slot) => {
    try {
      const [res] = await inFrames(tabId, (id, f) => globalThis.TwiggFill?.attachFile(id, f), [slot.id, file], [slot.frameId]);
      // only true/false are real answers; anything else means the page we filled is not there any more
      return res?.result === true || res?.result === false ? res.result : 'gone';
    } catch {
      return 'gone'; // e.g. "No frame with id 254 in tab …"
    }
  };

  let attempts = [];
  for (const slot of slots) attempts.push({ slot, result: await tryAttach(slot) });

  if (attempts.some((a) => a.result === 'gone')) {
    // look for the resume upload box again, in every frame of the tab as it is NOW
    await injectScripts(tabId).catch(() => {});
    const found = (await inFrames(tabId, () => globalThis.TwiggFill?.findResumeSlots()).catch(() => []))
      .flatMap((r) => (Array.isArray(r.result) ? r.result.map((s) => ({ ...s, frameId: r.frameId })) : []));
    const retried = [];
    for (const slot of found) retried.push({ slot, result: await tryAttach(slot) });
    attempts = [...attempts.filter((a) => a.result !== 'gone'), ...(retried.length ? retried : attempts.filter((a) => a.result === 'gone'))];
  }

  return attempts.map(({ slot, result }) => {
    const ok = result === true;
    return {
      frameId: slot.frameId,
      id: slot.id,
      status: ok ? (slot.resumeSlot === 'maybe' ? 'review' : 'file') : 'needs',
      note: ok
        ? `${resume.label} attached${slot.resumeSlot === 'maybe' ? ' — check this is the right upload' : ''}`
        : result === 'gone'
          ? "The form changed and Twigg couldn't find its upload box — upload it yourself"
          : 'Could not attach — upload it yourself',
    };
  });
}

export const clearHighlights = (tabId) => inFrames(tabId, () => globalThis.TwiggFill?.clear()).catch(() => {});

export const focusField = (tabId, frameId, id) => inFrames(tabId, (i) => TwiggFill.focus(i), [id], [frameId]).catch(() => {});

/** Current values of the fields that needed you, so they can be offered as saved answers. */
export async function collectAnswers(tabId, attention) {
  const byFrame = new Map();
  for (const a of attention) (byFrame.get(a.frameId) || byFrame.set(a.frameId, []).get(a.frameId)).push(a.id);
  const out = [];
  for (const [frameId, ids] of byFrame) {
    const [res] = await inFrames(tabId, (x) => TwiggFill.collect(x), [ids], [frameId]);
    out.push(...(res?.result || []).filter((r) => r.label && r.kind !== 'checkbox'));
  }
  return out;
}

export async function rememberAnswers(items) {
  const { answers } = await loadProfile();
  const key = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const { label, value } of items) {
    const existing = answers.find((a) => key(a.question) === key(label));
    if (existing) Object.assign(existing, { answer: value, learned: true });
    else answers.push({ question: label, answer: value, learned: true });
  }
  await saveAnswers(answers);
}
