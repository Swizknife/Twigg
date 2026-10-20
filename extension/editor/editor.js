import {
  loadProfile, saveProfile, saveResumes, saveAnswers, saveVoice, mergeImported, fileRecord, persistResumeFile, deleteResume,
  newResumeId, fromBackup, storageErrorMessage, CONTENT_KEYS, MAX_RESUMES,
} from '../lib/profile.js';
import { extractPdfText, importFromText } from '../lib/resume-import.js';
import { renderEditor, humanize, markChanged } from '../ui/tree-editor.js';

const $ = (id) => document.getElementById(id);
const MAX_PDF_BYTES = 8 * 1024 * 1024;

let template = {}; // full bundled template (gives "Add entry" rows their shape)
let templates = { shared: {}, content: {} };
let state = { shared: {}, resumes: [], answers: [], voice: '' };
let saved = null; // what is in storage, for "unsaved changes"
const highlights = new Map(); // 'shared' | resumeId → Set of changed field paths (cleared on Save/Discard)

const hasContent = (a) => (a.question || '').trim() || (a.answer || '').trim();
const snapshotOf = (s) => JSON.stringify([s.shared, s.resumes.map((r) => [r.id, r.label, r.content]), s.answers.filter(hasContent), s.voice]);
const blankContent = () => structuredClone(templates.content);
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj && k in obj).map((k) => [k, obj[k]]));

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

// ---------- dirty tracking ----------

function updateDirty() {
  const dirty = snapshotOf(state) !== snapshotOf(saved);
  $('save').disabled = !dirty;
  $('discard').disabled = !dirty;
  if (!$('save-status').classList.contains('save-error')) $('save-status').textContent = dirty ? 'Unsaved changes' : '';
}
window.addEventListener('beforeunload', (e) => {
  if (saved && snapshotOf(state) !== snapshotOf(saved)) e.preventDefault();
});

// ---------- rendering ----------

const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const cards = new Map(); // resumeId → { status(text, kind), contentEl, card }

function render() {
  renderEditor($('profile-form'), state.shared, { templates: template, onChange: updateDirty });
  markChanged($('profile-form'), highlights.get('shared') || []);
  renderResumes();
  renderEditor($('answers-form'), { answers: state.answers }, { templates: { answers: [{ question: '', answer: '' }] }, onChange: updateDirty });
  $('voice').value = state.voice;
  $('add-resume').disabled = state.resumes.length >= MAX_RESUMES;
  updateDirty();
}

function fileRow(resume, kind) {
  const f = resume[kind];
  const label = kind === 'pdf' ? 'PDF' : 'LaTeX (.tex)';
  const use = kind === 'pdf' ? 'Attached to “upload resume” fields (Twigg asks which resume each time).' : 'Used to tailor this resume for a job.';
  const input = el('input', { type: 'file', hidden: true, accept: kind === 'pdf' ? 'application/pdf,.pdf' : '.tex,text/plain,application/x-tex' });
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) onUpload(resume, kind, file);
  });
  const again = el('button', { type: 'button', className: 'btn', textContent: 'Read again', disabled: !f, title: 'Fill this resume’s details from the file again' });
  again.addEventListener('click', () => readResume(resume, kind));
  const remove = el('button', { type: 'button', className: 'btn', textContent: 'Remove', disabled: !f });
  remove.addEventListener('click', () => onRemoveFile(resume, kind));
  return el(
    'div',
    { className: 'file-row' },
    el('div', { className: 'file-info' }, el('strong', { textContent: label }), el('span', { className: 'muted', textContent: f ? `${f.name} · ${kb(f.size)} · uploaded ${new Date(f.updated).toLocaleDateString()}` : 'None uploaded' }), el('span', { className: 'muted small', textContent: use })),
    el('div', { className: 'file-actions' }, el('label', { className: `btn${f ? '' : ' primary'}` }, f ? `Replace ${kind === 'pdf' ? 'PDF' : '.tex'}` : `Upload ${kind === 'pdf' ? 'PDF' : '.tex'}`, input), again, remove)
  );
}

function renderResumes() {
  const old = new Map([...cards].map(([id, c]) => [id, c.statusBox]));
  cards.clear();
  $('resume-list').replaceChildren(
    ...state.resumes.map((resume, i) => {
      const labelInput = el('input', { type: 'text', value: resume.label || '', placeholder: 'e.g. AI Engineering' });
      labelInput.addEventListener('input', () => {
        resume.label = labelInput.value;
        updateDirty();
      });
      const del = el('button', { type: 'button', className: 'btn', textContent: 'Delete resume' });
      del.addEventListener('click', () => onDeleteResume(resume));

      const statusBox = old.get(resume.id) || el('div', { className: 'notice status', hidden: true });
      const contentEl = el('div');
      renderEditor(contentEl, resume.content, { templates: template, onChange: updateDirty });
      markChanged(contentEl, highlights.get(resume.id) || []);

      const card = el(
        'div',
        { className: 'resume-card' },
        el('div', { className: 'resume-head' }, el('label', {}, `Resume ${i + 1} — which role is it for?`, labelInput), del),
        fileRow(resume, 'pdf'),
        fileRow(resume, 'tex'),
        statusBox,
        el('details', { open: true }, el('summary', { textContent: 'What this resume shows' }), contentEl)
      );
      const status = (text, kind = '') => {
        statusBox.hidden = !text;
        statusBox.className = `notice status ${kind}`;
        statusBox.textContent = text || '';
      };
      cards.set(resume.id, { card, contentEl, statusBox, status });
      return card;
    })
  );
}

$('voice').addEventListener('input', () => {
  state.voice = $('voice').value;
  updateDirty();
});

async function load() {
  const data = await loadProfile();
  template = data.template;
  templates = data.templates;
  state = { shared: structuredClone(data.shared), resumes: structuredClone(data.resumes), answers: structuredClone(data.answers), voice: data.voice };
  saved = structuredClone(state);
  if (!state.resumes.length) state.resumes.push({ id: newResumeId(), label: '', content: blankContent() }); // first visit: one empty card
  if (!saved.resumes.length) saved.resumes = structuredClone(state.resumes); // an untouched empty card is not "unsaved"
  highlights.clear();
  $('save-status').classList.remove('save-error');
  render();
}

// ---------- resume files ----------

const statusOf = (resume) => cards.get(resume.id)?.status || (() => {});

async function onUpload(resume, kind, file) {
  const status = statusOf(resume);
  if (kind === 'pdf' && file.size > MAX_PDF_BYTES) return status('That PDF is over 8 MB. Export a smaller one.', 'error');
  if (kind === 'pdf' && !/pdf$/i.test(file.type || file.name)) return status('That doesn’t look like a PDF.', 'error');
  status(`Saving ${file.name}…`, 'ok');
  try {
    const record = await fileRecord(kind, file);
    await persistResumeFile(resume, kind, record, blankContent());
    resume[kind] = record;
  } catch (err) {
    return status(storageErrorMessage(err), 'error');
  }
  render();
  await readResume(resume, kind); // fill this resume's details straight away
}

async function onRemoveFile(resume, kind) {
  try {
    await persistResumeFile(resume, kind, null, blankContent());
    delete resume[kind];
    render();
    statusOf(resume)('');
  } catch (err) {
    statusOf(resume)(storageErrorMessage(err), 'error');
  }
}

async function onDeleteResume(resume) {
  const name = resume.label || 'this resume';
  if (!confirm(`Delete ${name}, its files and its details? Your “About you” details stay.`)) return;
  try {
    await deleteResume(resume.id);
  } catch (err) {
    return statusOf(resume)(storageErrorMessage(err), 'error');
  }
  state.resumes = state.resumes.filter((r) => r.id !== resume.id);
  saved.resumes = saved.resumes.filter((r) => r.id !== resume.id);
  highlights.delete(resume.id);
  if (!state.resumes.length) {
    const blank = { id: newResumeId(), label: '', content: blankContent() };
    state.resumes.push(blank);
    saved.resumes.push(structuredClone(blank));
  }
  render();
}

$('add-resume').addEventListener('click', () => {
  if (state.resumes.length >= MAX_RESUMES) return;
  const resume = { id: newResumeId(), label: '', content: blankContent() };
  state.resumes.push(resume);
  render();
  cards.get(resume.id)?.card.querySelector('input[type="text"]')?.focus();
});

function base64ToBuffer(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

function leaves(value, path = '', out = new Map()) {
  if (Array.isArray(value)) value.forEach((v, i) => leaves(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) leaves(v, path ? `${path}.${k}` : k, out);
  else out.set(path, String(value ?? ''));
  return out;
}

/** Field paths whose value differs (new, changed or removed). */
function changedPaths(before, after) {
  const a = leaves(before);
  const b = leaves(after);
  return [...new Set([...[...b.keys()].filter((p) => a.get(p) !== b.get(p) && b.get(p)), ...[...a.keys()].filter((p) => !b.has(p) && a.get(p))])];
}

/** Read a resume file with the AI and fill that resume's details (+ your shared details). Not saved until Save. */
async function readResume(resume, kind) {
  const status = statusOf(resume);
  const file = resume[kind];
  if (!file) return;
  try {
    status(`Reading ${file.name}…`, 'ok');
    const text = kind === 'pdf' ? await extractPdfText(base64ToBuffer(file.data)) : file.text;
    status('Filling in your details with AI — this can take a minute on a local model…', 'ok');
    const imported = await importFromText(text);

    const beforeShared = structuredClone(state.shared);
    const beforeContent = structuredClone(resume.content);
    state.shared = mergeImported(state.shared, pick(imported, ['basics', 'education'])); // DOB, 10th/12th etc. you typed are kept
    resume.content = mergeImported(resume.content, pick(imported, CONTENT_KEYS));

    const shared = changedPaths(beforeShared, state.shared);
    const content = changedPaths(beforeContent, resume.content);
    highlights.set('shared', new Set([...(highlights.get('shared') || []), ...shared]));
    highlights.set(resume.id, new Set([...(highlights.get(resume.id) || []), ...content]));
    render();

    const total = shared.length + content.length;
    const groups = [...new Set([...content, ...shared].map((p) => humanize(p.split(/[.[]/)[0])))];
    statusOf(resume)(
      total
        ? `Filled ${total} details from ${file.name} (${groups.join(', ')}). They are highlighted below and in “About you” — check them, then press Save.`
        : `${file.name} matches what is already here — nothing changed.`,
      total ? 'ok' : ''
    );
  } catch (err) {
    statusOf(resume)(`${err.message}${err.hint ? ` — ${err.hint}` : ''}`, 'error');
  }
}

// ---------- save / discard ----------

$('save').addEventListener('click', async () => {
  $('save').disabled = true;
  try {
    state.answers = state.answers.filter(hasContent);
    const stored = (await loadProfile()).resumes;
    // an empty card you never touched (no files, no label, no details) isn't worth saving
    const untouched = (r) => !r.pdf && !r.tex && !stored.some((s) => s.id === r.id) && !r.label.trim() && JSON.stringify(r.content) === JSON.stringify(templates.content);
    const resumes = state.resumes
      .filter((r) => !untouched(r))
      .map((r, i) => {
        const s = stored.find((x) => x.id === r.id);
        const pdf = r.pdf ?? s?.pdf;
        const tex = r.tex ?? s?.tex;
        return { id: r.id, label: r.label.trim() || `Resume ${i + 1}`, content: r.content, ...(pdf && { pdf }), ...(tex && { tex }) };
      });
    await Promise.all([saveProfile(state.shared), saveResumes(resumes), saveAnswers(state.answers), saveVoice(state.voice)]);
    for (const r of state.resumes) if (!r.label.trim()) r.label = resumes.find((x) => x.id === r.id)?.label || '';
    saved = structuredClone(state);
    highlights.clear();
    $('save-status').classList.remove('save-error');
    render();
    $('save-status').textContent = 'Saved ✓';
    setTimeout(updateDirty, 2000);
  } catch (err) {
    $('save-status').classList.add('save-error');
    $('save-status').textContent = storageErrorMessage(err);
    $('save').disabled = false;
  }
});

$('discard').addEventListener('click', load);

// ---------- backup ----------

$('export').addEventListener('click', async () => {
  const stored = (await loadProfile()).resumes;
  const resumes = state.resumes.map((r) => {
    const s = stored.find((x) => x.id === r.id) || {};
    return { ...r, pdf: r.pdf ?? s.pdf, tex: r.tex ?? s.tex };
  });
  const backup = { twigg: 2, profile: state.shared, resumes, answers: state.answers, voice: state.voice };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: `twigg-backup-${new Date().toISOString().slice(0, 10)}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('import-backup').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const note = (text, kind) => {
    $('shared-status').hidden = !text;
    $('shared-status').className = `notice ${kind}`;
    $('shared-status').textContent = text;
  };
  try {
    const b = fromBackup(JSON.parse(await file.text()));
    state.shared = mergeImported(structuredClone(templates.shared), b.shared);
    state.resumes = b.resumes.length ? b.resumes.map((r) => ({ ...r, content: mergeImported(blankContent(), r.content || {}) })) : [{ id: newResumeId(), label: '', content: blankContent() }];
    state.answers = b.answers;
    state.voice = b.voice;
    render();
    note('Backup loaded. Review it, then press Save to keep it.', 'ok');
  } catch (err) {
    note(`Couldn't import that file: ${err.message}`, 'error');
  }
});

load();
