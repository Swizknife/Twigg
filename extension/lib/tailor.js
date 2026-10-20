// Resume tailoring: analyse a job against your resume, ask the AI to reword bullets, and build a tailored .tex.
// The AI may only REWORD. Every suggestion is checked against the original bullet and thrown away if it adds a
// number or a tool the bullet didn't have, switches to first person, or balloons in length.

import { completeJSON } from './llm.js';
import { tailorPrompt } from './prompts.js';
import { extractKeywords, scoreResume, profileSkillText, techTermsIn } from './ats.js';
import { parseBullets, resumePlain, escapeTex, applyEdits, looksBalanced } from './tex.js';

const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const numbersIn = (s) => (String(s).replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).map(String);
const same = (a, b) => a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === b.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Keywords + score for a job description against your .tex resume (or your profile if no .tex is stored). */
export function analyse({ jdText, tex, profile }) {
  const keywords = extractKeywords(jdText);
  const profileText = profileSkillText(profile);
  const resumeText = tex ? resumePlain(tex) : profileText;
  return { keywords, usedTex: Boolean(tex), resumeText, ...scoreResume(keywords, resumeText, tex ? profileText : '') };
}

/** Why a suggested rewrite is not acceptable. Empty list = fine to offer. */
export function validateRewrite(original, rewrite) {
  const problems = [];
  const text = String(rewrite || '').trim();
  if (!text) return ['empty'];
  if (same(original, text)) return ['unchanged'];

  const known = new Set(numbersIn(original));
  const invented = [...new Set(numbersIn(text).filter((n) => !known.has(n)))];
  if (invented.length) problems.push(`adds the number ${invented.join(', ')}`);

  const had = new Set(techTermsIn(original));
  const added = techTermsIn(text).filter((t) => !had.has(t));
  if (added.length) problems.push(`adds ${added.join(', ')}, which the original doesn't mention`);

  const before = words(original);
  const after = words(text);
  if (after > before * 1.35 + 3) problems.push('much longer than the original');
  if (after < before * 0.5) problems.push('drops too much of the original');
  if (/\b(I|my|me|we|our)\b/.test(text)) problems.push('uses first person');
  if (/[*`]|^\s*[-•]/.test(text)) problems.push('contains formatting characters');
  return problems;
}

/** Bullets most worth rewording for this job: the ones whose wording is closest to what the job asks for. */
export function rankBullets(bullets, keywords, limit = 8) {
  const score = (b) => {
    const lower = b.plain.toLowerCase();
    const hits = keywords.filter((k) => k.aliases.some((a) => lower.includes(a.toLowerCase()))).reduce((n, k) => n + k.weight, 0);
    return hits + Math.min(words(b.plain), 25) / 50; // prefer substantial bullets
  };
  return [...bullets].sort((a, b) => score(b) - score(a)).slice(0, limit).sort((a, b) => a.id - b.id);
}

/**
 * Ask the AI to reword bullets for this job.
 * Returns { suggestions: [{ id, original, text, context }], rejected: [{ id, text, problems }] }.
 */
export async function suggestRewrites({ tex, keywords, job, limit = 8 }) {
  const bullets = parseBullets(tex);
  if (!bullets.length) throw new Error("Couldn't find bullet points in your .tex. Twigg understands \\resumeItem{…} and \\item lines.");
  const chosen = rankBullets(bullets, keywords, limit);
  const { system, user } = tailorPrompt({ bullets: chosen, keywords, job });
  const result = await completeJSON({ system, messages: [{ role: 'user', content: user }], temperature: 0.3 });

  const byId = new Map(chosen.map((b) => [b.id, b]));
  const suggestions = [];
  const rejected = [];
  for (const r of result.rewrites || []) {
    const b = byId.get(Number(r.id));
    if (!b || typeof r.text !== 'string') continue;
    const problems = validateRewrite(b.plain, r.text);
    if (problems.includes('unchanged') || problems.includes('empty')) continue;
    if (problems.length) rejected.push({ id: b.id, original: b.plain, text: r.text.trim(), problems });
    else suggestions.push({ id: b.id, original: b.plain, text: r.text.trim(), context: b.context });
  }
  return { suggestions, rejected, bulletCount: bullets.length };
}

/** Splice accepted rewrites into the .tex. Only those bullets change; the result is checked for balanced braces. */
export function buildTailoredTex(tex, accepted) {
  const bullets = new Map(parseBullets(tex).map((b) => [b.id, b]));
  const edits = accepted
    .map((a) => ({ b: bullets.get(a.id), text: a.text }))
    .filter((e) => e.b)
    .map((e) => ({ start: e.b.start, end: e.b.end, text: escapeTex(e.text) }));
  const out = applyEdits(tex, edits);
  if (!looksBalanced(out)) throw new Error('The edited .tex looks malformed, so Twigg did not produce it. Your original is unchanged.');
  return out;
}

export function tailoredFileName(job) {
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  return `resume-${[slug(job?.company), slug(job?.title)].filter(Boolean).join('-') || 'tailored'}.tex`;
}
