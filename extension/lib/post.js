// LinkedIn post writing: drafts from your own notes (and optionally the page you're on), then quick rewrites.

import { complete } from './llm.js';
import { postPrompt, refinePrompt } from './prompts.js';
import { loadProfile } from './profile.js';

export const POST_TYPES = [
  { id: 'project', label: 'Project launch / demo', hint: 'Say what you built, why, one concrete result, and what you learned.', placeholder: 'e.g. Built a gesture recogniser on an STM32. Quantised the CNN to int8, runs in 18 ms. Hardest part: fitting it in 256 KB of RAM.' },
  { id: 'joined', label: 'Joined an internship / job', hint: 'Say where, the role, how it came about, what you will work on, and who helped.', placeholder: 'e.g. Starting as an Edge AI intern at … I will work on … Thanks to … for the referral.' },
  { id: 'certificate', label: 'Certificate / course done', hint: 'Say what you finished, the 1-2 things you actually learned, and how you will use them.', placeholder: 'e.g. Finished the TinyML course. Biggest takeaway: quantisation-aware training beats post-training for small models.' },
  { id: 'hackathon', label: 'Hackathon / competition', hint: 'Say the event, what your team built, the result, and what it taught you.', placeholder: 'e.g. 24-hour hackathon at …, team of 3, built …, finished top 5 of 120 teams.' },
  { id: 'learning', label: 'Learning milestone', hint: 'Say what you set out to learn, what you did, one surprise, and what is next.', placeholder: 'e.g. 30 days of reading one embedded-ML paper a day. Surprise: most gains came from data, not architecture.' },
  { id: 'research', label: 'Paper / research / talk', hint: 'Say the question, what you found or presented, and why it matters to you.', placeholder: 'e.g. Presented our poster on … at … The finding: …' },
  { id: 'update', label: 'Something else', hint: 'Say the news plainly, why it matters, and what you want to happen next (if anything).', placeholder: 'Write the main points in your own words.' },
];

const MAX_POST = 3000; // LinkedIn's limit

/** Tidy a model-written post: normalise newlines, enforce the length limit, add the link if it was asked for and missing. */
export function cleanPost(text, link) {
  let t = String(text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  t = t.replace(/^["“]|["”]$/g, '').trim();
  if (link && !t.includes(link)) {
    const lines = t.split('\n');
    const tagLine = lines.length && /^(#\S+\s*)+$/.test(lines[lines.length - 1].trim()) ? lines.pop() : null;
    t = `${lines.join('\n').trim()}\n\n${link}${tagLine ? `\n\n${tagLine}` : ''}`;
  }
  return t.length > MAX_POST ? `${t.slice(0, MAX_POST - 1).trimEnd()}…` : t;
}

/**
 * Describe HOW the student writes, measured locally from their own posts. Only these traits go to the AI —
 * never the posts themselves, because small models borrow the subject matter of any sample text.
 */
export function styleNotes(voice) {
  const text = String(voice ?? '').trim();
  if (text.length < 80) return [];
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3);
  if (!sentences.length) return [];
  const words = sentences.reduce((n, s) => n + s.split(/\s+/).length, 0) / sentences.length;
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
  const emojis = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
  const exclaims = (text.match(/!/g) || []).length / sentences.length;
  const contractions = (text.match(/\b\w+(?:n't|'m|'ve|'re|'ll|'d|'s)\b/gi) || []).length / sentences.length;
  const british = (text.match(/\b\w+(?:isation|ise|ised|ising|our)\b/gi) || []).length;
  const american = (text.match(/\b\w+(?:ization|ize|ized|izing)\b/gi) || []).length;

  const notes = [
    words <= 12 ? `Short, plain sentences (about ${Math.round(words)} words each).` : words <= 20 ? `Medium-length sentences (about ${Math.round(words)} words each).` : `Longer, flowing sentences (about ${Math.round(words)} words each).`,
    contractions >= 0.3 ? 'Casual and conversational, with contractions.' : 'Fairly measured, few contractions.',
    exclaims >= 0.3 ? 'Uses exclamation marks.' : 'Rarely uses exclamation marks.',
    emojis ? 'Uses an emoji occasionally.' : 'Does not use emojis.',
    paragraphs.length > 1 && paragraphs.reduce((n, p) => n + p.split(/[.!?]\s/).length, 0) / paragraphs.length <= 2.5 ? 'Writes in very short paragraphs.' : '',
    british > american ? 'Uses British spelling (-isation, -ise).' : american > british ? 'Uses American spelling (-ization, -ize).' : '',
  ];
  return notes.filter(Boolean);
}

/** Numbers in a draft that appear nowhere in the student's notes or the page — likely invented. */
export function ungroundedNumbers(post, sourceText) {
  const source = String(sourceText).toLowerCase().replace(/,/g, '');
  const seen = new Set();
  const out = [];
  for (const m of String(post).matchAll(/\d+(?:\.\d+)?\s?(?:%|ms|s|x|k|gb|mb|kb|fps|hz|mhz|ghz)?/gi)) {
    const token = m[0].trim().toLowerCase();
    const digits = token.match(/\d+(?:\.\d+)?/)[0];
    if (seen.has(digits) || /^(?:19|20)\d\d$/.test(digits)) continue; // years are rarely the invented part
    seen.add(digits);
    if (!new RegExp(`(^|[^\\d.])${digits.replace('.', '\\.')}([^\\d]|$)`).test(source)) out.push(m[0].trim());
  }
  return out;
}

const CLAIMS = [
  // [label, pattern found in the draft, pattern that would show the student really said it]
  ['a time span', /\b(?:the )?(?:last|past)\s+(?:few\s+)?(?:days|weeks|months)\b|\b(?:few|several)\s+(?:days|weeks|months)\b|\bover the (?:weekend|summer|holidays)\b/i, /\b(?:days?|weeks?|months?|weekend|summer|holidays?)\b/i],
  ['a future plan', /\bI(?:'m| am)\s+(?:now\s+)?(?:going to|planning|keen to|looking forward|excited to)\b|\bI plan to\b|\bI(?:'ll| will)\s+(?:explore|dive|focus|keep)\b|\bnext up\b|\bgoing forward\b/i, /\b(?:plan|next|going to|will|want to|hope to|keen)\b/i],
  ['a strength word like "significantly"', /\b(?:significantly|considerably|dramatically|substantially|tremendously)\b/i, /\b(?:significant|considerabl|dramatic|substantial|tremendous)/i],
];

/** Things AI drafts like to add that the student never said: invented numbers, time spans, plans, strength words. */
export function unsupportedClaims(post, sourceText) {
  const out = ungroundedNumbers(post, sourceText).map((n) => `the number ${n}`);
  for (const [label, found, grounded] of CLAIMS) {
    const hit = String(post).match(found);
    if (hit && !grounded.test(sourceText)) out.push(`${label} (“${hit[0].trim()}”)`);
  }
  return out;
}

export async function generatePosts({ typeId, notes, page, tone, length, link }) {
  const type = POST_TYPES.find((t) => t.id === typeId) || POST_TYPES[0];
  if (!notes.trim() && !page) throw new Error('Add a few notes about what you want to post, or open a project page and tick “Use this page”.');
  const { profile, voice } = await loadProfile();
  const background = { headline: profile.basics?.headline, skills: profile.skills, education: (profile.education || []).slice(0, 1).map((e) => ({ institution: e.institution, branch: e.branch })) };
  const { system, user } = postPrompt({ type, notes: notes.trim(), page, style: styleNotes(voice), profile: background, tone, length, link });
  const raw = await complete({ system, messages: [{ role: 'user', content: user }], temperature: 0.5 });
  const variants = parseVariants(raw, link);
  if (!variants.length) throw new Error('The AI returned no usable post. Try again, or add more detail to your notes.');
  const sources = `${notes} ${page?.text || ''} ${link || ''}`;
  return variants.map((v) => ({ ...v, warnings: unsupportedClaims(v.text, sources) }));
}

const ANGLES = ['Story first', 'Result first'];

/**
 * Split the model's reply into drafts. It was asked for two posts divided by a ===== line, but small models also
 * use --- or "Post 2:" headings, add a label line, or wrap everything in quotes — accept all of those.
 */
export function parseVariants(raw, link = '') {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n');
  const parts = text.split(/^[ \t]*(?:={3,}|-{3,}|\*{3,}|(?:\*\*)?\s*(?:post|draft|variant|option)\s*(?:2|b|two)\b[^\n]{0,30})[ \t]*$/im);
  return parts
    .map((p) => p.replace(/^\s*(?:\*\*)?\s*(?:post|draft|variant|option)\s*(?:1|a|one|2|b|two)\b[^\n]{0,30}\n/i, '')) // a leading "Post 1:" label
    .map((p) => cleanPost(p, link))
    .filter((p) => p.length > 30)
    .slice(0, 2)
    .map((p, i) => ({ angle: ANGLES[i], text: p }));
}

export async function refinePost(text, instruction, link) {
  const { system, user } = refinePrompt({ text, instruction });
  return cleanPost(await complete({ system, messages: [{ role: 'user', content: user }], temperature: 0.6 }), link);
}
