// The Tailor tab: how well does my resume match this job, what can I honestly add, and a tailored .tex.
// Role/page text is untrusted, so everything is rendered with textContent.

import { analyse, suggestRewrites, validateRewrite, buildTailoredTex, tailoredFileName } from '../lib/tailor.js';
import { loadProfile } from '../lib/profile.js';
import { getAllRoles } from '../lib/store.js';
import { parseSkillLines } from '../lib/tex.js';

const $ = (id) => document.getElementById(id);
const state = { tex: '', report: null, job: null, suggestions: [], tailored: '', profile: null };

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}
const say = (id, text, kind) => {
  $(id).hidden = !text;
  $(id).textContent = text || '';
  if (kind) $(id).className = `notice ${kind}`;
};
const fail = (err) => say('tl-error', `${err.message}${err.hint ? ` — ${err.hint}` : ''}`);

// ---------- which resume ----------

/** Resumes that have a .tex (only those can be tailored). */
async function loadResumes() {
  const select = $('tl-resume');
  const keep = select.value;
  const withTex = (await loadProfile()).resumes.filter((r) => r.tex?.text);
  select.replaceChildren(...withTex.map((r) => el('option', { value: r.id, textContent: `${r.label} — ${r.tex.name}` })));
  if ([...select.options].some((o) => o.value === keep)) select.value = keep;
  $('tl-resume-wrap').hidden = withTex.length < 2; // nothing to choose with one (or none)
  return withTex;
}
chrome.storage.onChanged.addListener((c, area) => area === 'local' && c.resumes && loadResumes());

// ---------- job source ----------

async function loadSources() {
  const select = $('tl-source');
  const keep = select.value;
  const roles = (await getAllRoles())
    .filter((r) => (r.description || '').length > 200 && r.status !== 'ignored')
    .sort((a, b) => (a.eval?.verdict === 'match' ? 0 : 1) - (b.eval?.verdict === 'match' ? 0 : 1) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 40);
  select.replaceChildren(
    el('option', { value: 'page', textContent: 'The page I have open' }),
    ...roles.map((r) => el('option', { value: `role:${r.id}`, textContent: `${r.title}${r.company ? ` — ${r.company}` : ''}` })),
    el('option', { value: 'paste', textContent: 'Paste a job description…' })
  );
  if ([...select.options].some((o) => o.value === keep)) select.value = keep;
  $('tl-paste-wrap').hidden = select.value !== 'paste';
}
$('tl-source').addEventListener('change', () => ($('tl-paste-wrap').hidden = $('tl-source').value !== 'paste'));
chrome.storage.onChanged.addListener((c, area) => area === 'local' && c.rolesVersion && loadSources());

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function readJob() {
  const choice = $('tl-source').value;
  if (choice === 'paste') {
    const text = $('tl-paste').value.trim();
    if (text.length < 80) throw new Error('Paste the full job description first.');
    return { text, title: '', company: '' };
  }
  if (choice.startsWith('role:')) {
    const role = (await getAllRoles()).find((r) => r.id === choice.slice(5));
    if (!role) throw new Error('That saved role is gone. Pick another.');
    return { text: `${role.title}\n${role.skills.join(', ')}\n${role.description}`, title: role.title, company: role.company };
  }
  const tab = await activeTab();
  if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error("Twigg can't read this tab. Open the job page, or paste the description.");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/extract.js'] });
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ page: window.TwiggExtract.page(30000) }) });
  const page = result.page;
  const posting = page.jobPostings?.[0];
  return { text: page.text, title: posting?.title || page.title, company: posting?.company || '' };
}

// ---------- analysis ----------

function chips(container, list, empty) {
  container.replaceChildren(...(list.length ? list.map((k) => el('span', { className: 'kwchip', textContent: k.term, title: k.kind === 'other' ? 'Found in the job text' : '' })) : [el('span', { className: 'muted small', textContent: empty })]));
}

function showScore(score) {
  const box = $('tl-score');
  box.textContent = score == null ? '–' : `${score}%`;
  box.className = `score ${score == null ? '' : score >= 70 ? 'good' : score >= 45 ? 'mid' : 'low'}`;
}

async function runAnalysis() {
  say('tl-error', '');
  $('tl-result').hidden = true;
  $('tl-export').hidden = true;
  $('tl-analyse').disabled = true;
  say('tl-progress', 'Reading the job…', 'ok');
  try {
    const [job, withTex, { profile }] = await Promise.all([readJob(), loadResumes(), loadProfile()]);
    state.job = job;
    const chosen = withTex.find((r) => r.id === $('tl-resume').value) || withTex[0];
    state.tex = chosen?.tex?.text || '';
    state.resumeLabel = chosen?.label || '';
    state.profile = profile;
    const report = analyse({ jdText: job.text, tex: state.tex, profile });
    state.report = report;
    if (!report.keywords.length) throw new Error("Couldn't find any skills or tools in that job text. Is it the full job description?");

    showScore(report.score);
    $('tl-score-note').textContent = `${report.matched.length} of ${report.keywords.length} things the job asks for are on ${report.usedTex ? `your “${state.resumeLabel}” resume` : 'your profile'}. A guide, not a promise — real screening systems differ.`;
    chips($('tl-matched'), report.matched, 'None yet.');
    chips($('tl-addable'), report.addable, 'Nothing — everything on your profile that the job wants is already on your resume.');
    chips($('tl-gaps'), report.gaps, 'No gaps — nice.');
    $('tl-copy-skills').hidden = !report.addable.length;

    say('tl-resume-status', state.tex ? '' : 'No .tex resume is stored, so this checks your profile instead. Upload your .tex in your profile (👤) for bullet rewrites and a tailored file.', 'warn');
    $('tl-rewrite-block').hidden = !state.tex;
    state.suggestions = [];
    $('tl-suggestions').replaceChildren();
    $('tl-build').hidden = true;
    say('tl-suggest-note', '');
    $('tl-result').hidden = false;
  } catch (err) {
    fail(err);
  } finally {
    say('tl-progress', '');
    $('tl-analyse').disabled = false;
  }
}
$('tl-analyse').addEventListener('click', runAnalysis);

$('tl-copy-skills').addEventListener('click', async () => {
  const names = state.report.addable.map((k) => k.term).join(', ');
  const lines = parseSkillLines(state.tex);
  const where = lines.length ? ` (your Skills section has: ${lines.map((l) => l.label).join(', ')})` : '';
  await navigator.clipboard.writeText(names);
  $('tl-copy-skills').textContent = 'Copied ✓';
  setTimeout(() => ($('tl-copy-skills').textContent = 'Copy “add to Skills” line'), 1500);
  say('tl-suggest-note', `Copied: ${names}. Add them to the right line of your Skills section${where}.`, 'ok');
});

// ---------- bullet rewrites ----------

function suggestionCard(s, index) {
  const area = el('textarea', { rows: 3, value: s.text, spellcheck: true });
  const pick = el('input', { type: 'checkbox', checked: !s.problems?.length });
  const problem = el('div', { className: 'problem' });
  const check = () => {
    const problems = validateRewrite(s.original, area.value);
    s.problems = problems.filter((p) => p !== 'unchanged');
    problem.textContent = s.problems.length ? `Check: ${s.problems.join('; ')}.` : '';
    s.text = area.value;
  };
  area.addEventListener('input', check);
  pick.addEventListener('change', () => (s.accepted = pick.checked));
  s.accepted = pick.checked;
  check();
  return el(
    'li',
    { className: `suggestion${s.rejected ? ' rejected' : ''}` },
    el('div', { className: 'ctx', textContent: s.context || 'Bullet' }),
    el('div', { className: 'was', textContent: s.original }),
    area,
    problem,
    el('label', { className: 'pick' }, pick, s.rejected ? 'Use anyway (I checked it)' : 'Use this wording')
  );
}

function renderSuggestions(list) {
  $('tl-suggestions').replaceChildren(...list.map((s, i) => suggestionCard(s, i)));
  $('tl-build').hidden = !list.length;
}

$('tl-suggest').addEventListener('click', async () => {
  say('tl-error', '');
  $('tl-suggest').disabled = true;
  say('tl-suggest-note', 'Asking the AI — a local model can take a minute…', 'ok');
  try {
    const { suggestions, rejected, bulletCount } = await suggestRewrites({ tex: state.tex, keywords: state.report.keywords, job: state.job });
    state.suggestions = [...suggestions, ...rejected.map((r) => ({ ...r, rejected: true }))];
    renderSuggestions(state.suggestions);
    const bits = [`${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'} from ${bulletCount} bullets`];
    if (rejected.length) bits.push(`${rejected.length} more came back but add things you didn't write (shown unticked — only use them if they're true)`);
    if (!suggestions.length && !rejected.length) bits.push('your bullets already read well for this job, or can’t be improved without adding facts');
    say('tl-suggest-note', bits.join(' · '), suggestions.length ? 'ok' : 'warn');
  } catch (err) {
    say('tl-suggest-note', '');
    fail(err);
  } finally {
    $('tl-suggest').disabled = false;
  }
});

// ---------- build & export ----------

$('tl-build').addEventListener('click', () => {
  say('tl-error', '');
  try {
    const chosen = state.suggestions.filter((s) => s.accepted);
    if (!chosen.length) throw new Error('Tick at least one rewrite to use.');
    state.tailored = buildTailoredTex(state.tex, chosen.map((s) => ({ id: s.id, text: s.text })));
    const after = analyse({ jdText: state.job.text, tex: state.tailored, profile: state.profile });
    const before = state.report.score;
    $('tl-delta').textContent = `${chosen.length} bullet${chosen.length === 1 ? '' : 's'} reworded. Keyword match ${before}% → ${after.score}% (estimate).`;
    $('tl-tex').value = state.tailored;
    $('tl-export').hidden = false;
    showScore(after.score);
  } catch (err) {
    fail(err);
  }
});

$('tl-download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([state.tailored], { type: 'application/x-tex' }));
  Object.assign(document.createElement('a'), { href: url, download: tailoredFileName(state.job) }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('tl-copy-tex').addEventListener('click', async () => {
  await navigator.clipboard.writeText(state.tailored);
  $('tl-copy-tex').textContent = 'Copied ✓';
  setTimeout(() => ($('tl-copy-tex').textContent = 'Copy .tex'), 1500);
});

loadSources();
loadResumes();
