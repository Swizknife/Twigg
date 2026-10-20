// Skill-gap report: across the roles you've collected, what do employers keep asking for,
// and is it on your resume, only on your profile, or genuinely missing?

import { extractKeywords, mentions } from './ats.js';
import { complete } from './llm.js';
import { gapProjectsPrompt } from './prompts.js';

const MIN_ROLES = 3;

/** Roles with enough text to read skills from (list-page stubs carry too little). */
export function usableRoles(roles) {
  return roles.filter((r) => r.status !== 'ignored' && r.kind !== 'opportunity' && ((r.description || '').length > 200 || (r.skills || []).length >= 3));
}

/**
 * rows: [{ term, count, pct, status: 'resume' | 'addable' | 'gap' }], most requested first.
 * `resumeText` is your resume (or profile if there's no .tex); `profileText` is everything on your profile.
 */
export function skillGapReport(roles, resumeText, profileText) {
  const used = usableRoles(roles);
  const tally = new Map();
  for (const r of used) {
    const seen = new Set();
    for (const kw of extractKeywords(`${r.title}\n${(r.skills || []).join(', ')}\n${r.description || ''}`, { limit: 40 })) {
      if (kw.kind !== 'lexicon' || seen.has(kw.term)) continue; // free-form "other" tokens are too noisy to count across roles
      seen.add(kw.term);
      const entry = tally.get(kw.term) || { kw, count: 0 };
      entry.count++;
      tally.set(kw.term, entry);
    }
  }

  const resume = String(resumeText || '').toLowerCase();
  const profile = String(profileText || '').toLowerCase();
  const minCount = used.length >= 6 ? 2 : 1;
  const rows = [...tally.values()]
    .filter((e) => e.count >= minCount)
    .map(({ kw, count }) => ({
      term: kw.term,
      count,
      pct: Math.round((100 * count) / used.length),
      status: mentions(resume, kw) ? 'resume' : mentions(profile, kw) ? 'addable' : 'gap',
    }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));

  return {
    roleCount: used.length,
    enough: used.length >= MIN_ROLES,
    gaps: rows.filter((r) => r.status === 'gap'),
    addable: rows.filter((r) => r.status === 'addable'),
    strengths: rows.filter((r) => r.status === 'resume'),
  };
}

/** Plain-text list of project ideas for the top gaps, parsed into rows. */
export async function suggestGapProjects({ gaps, projects, target }) {
  const { system, user } = gapProjectsPrompt({ gaps: gaps.map((g) => g.term), projects, target });
  const raw = await complete({ system, messages: [{ role: 'user', content: user }], temperature: 0.5 });
  return parseGapProjects(raw, gaps.map((g) => g.term));
}

/** "ONNX — Export your Edge Cam model and compare latency | 'Exported to ONNX…'" → [{ gap, idea, show }] */
export function parseGapProjects(raw, gapNames) {
  const rows = [];
  for (const line of String(raw ?? '').split('\n')) {
    const m = line.replace(/^[\s\-*•\d.)]+/, '').match(/^([^—–:]{2,40}?)\s*[—–:-]\s*(.+)$/);
    if (!m) continue;
    const gap = gapNames.find((g) => g.toLowerCase() === m[1].trim().toLowerCase().replace(/\*\*/g, ''));
    if (!gap) continue; // only suggestions for the gaps we asked about
    const [idea, show = ''] = m[2].replace(/\*\*/g, '').split(/\s*\|\s*/);
    if (idea.trim().length > 15) rows.push({ gap, idea: idea.trim(), show: show.trim() });
  }
  return rows;
}
