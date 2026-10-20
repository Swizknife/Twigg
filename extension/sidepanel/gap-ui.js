// Skill-gap report card in the Roles tab. Role data is untrusted page text → textContent only.

import { skillGapReport, suggestGapProjects } from '../lib/skillgap.js';
import { getAllRoles } from '../lib/store.js';
import { loadProfile } from '../lib/profile.js';
import { resumePlain } from '../lib/tex.js';
import { profileSkillText } from '../lib/ats.js';

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

function rows(list, kind, max) {
  if (!list.length) return [el('p', { className: 'muted small', textContent: 'None.' })];
  return list.slice(0, max).map((r) =>
    el('div', { className: `gap-row ${kind}` }, el('strong', { textContent: r.term }), el('span', { className: 'n', textContent: `${r.count} role${r.count === 1 ? '' : 's'} · ${r.pct}%` }), el('div', { className: 'bar' }, el('i', { style: `width:${Math.min(100, r.pct)}%` })))
  );
}

async function render() {
  const card = $('gap-card');
  card.replaceChildren(el('p', { className: 'muted', textContent: 'Reading your saved roles…' }));
  const [roles, { profile, resumes }] = await Promise.all([getAllRoles(), loadProfile()]);
  const profileText = profileSkillText(profile);
  // a skill on ANY of your resumes counts as "on your resume"
  const texts = resumes.filter((r) => r.tex?.text).map((r) => resumePlain(r.tex.text));
  const usingTex = texts.length > 0;
  const report = skillGapReport(roles, usingTex ? texts.join('\n') : profileText, profileText);

  if (!report.enough) {
    card.replaceChildren(el('p', { textContent: `Only ${report.roleCount} saved role${report.roleCount === 1 ? '' : 's'} have enough detail to read skills from. Open a few more full job pages (not just search results) and try again — the report needs at least 3.` }));
    return;
  }

  const ideas = el('ul', { className: 'ideas' });
  const note = el('div', { className: 'notice', hidden: true });
  const suggest = el('button', { type: 'button', className: 'btn small', textContent: 'Suggest projects for my top gaps', disabled: !report.gaps.length });
  suggest.addEventListener('click', async () => {
    suggest.disabled = true;
    note.hidden = false;
    note.className = 'notice ok';
    note.textContent = 'Asking the AI…';
    try {
      const top = report.gaps.slice(0, 4);
      const out = await suggestGapProjects({ gaps: top, projects: (profile.projects || []).map((p) => ({ name: p.name, tech: p.tech })), target: (profile.preferences?.targetRoles || []).join(', ') });
      ideas.replaceChildren(...out.map((i) => el('li', {}, el('strong', { textContent: `${i.gap}: ` }), i.idea, i.show ? el('span', { className: 'show', textContent: `On your resume once done: ${i.show}` }) : null)));
      note.className = out.length ? 'notice ok' : 'notice warn';
      note.textContent = out.length ? 'Ideas to build — not claims. Add one to your resume only after you have actually done it.' : 'The AI gave no usable ideas. Try again.';
    } catch (err) {
      note.className = 'notice error';
      note.textContent = `${err.message}${err.hint ? ` — ${err.hint}` : ''}`;
    } finally {
      suggest.disabled = false;
    }
  });

  card.replaceChildren(
    el('p', { textContent: `Based on ${report.roleCount} saved roles. Compared with your ${usingTex ? (texts.length > 1 ? `${texts.length} resumes (.tex)` : 'resume (.tex)') : 'profile'}.` }),
    el('h4', { textContent: 'Missing — not on your profile' }),
    el('p', { className: 'muted small', textContent: 'Asked for often, but you list it nowhere. Learn or build something first; do not claim it.' }),
    ...rows(report.gaps, 'gap', 8),
    // without a .tex there is no "resume vs profile" difference to show — everything is compared with the profile
    ...(usingTex ? [el('h4', { textContent: 'On your profile, not on your resume' }), ...rows(report.addable, 'addable', 6)] : []),
    el('h4', { textContent: usingTex ? 'Already on your resume' : 'Already on your profile' }),
    ...rows(report.strengths, 'resume', 5),
    el('div', { className: 'row' }, suggest),
    note,
    ideas
  );
}

$('gap-btn').addEventListener('click', async () => {
  const open = $('gap-card').hidden;
  $('gap-card').hidden = !open;
  $('gap-btn').setAttribute('aria-expanded', String(open));
  if (open) await render();
});
