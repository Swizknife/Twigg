// Outreach drafts: referral DMs, recruiter emails, professor emails, follow-ups.
// Draft only — Twigg never sends anything and never guesses an email address.
// Small models make characteristic mistakes in cold messages, so every draft is checked in code.

import { complete } from './llm.js';
import { outreachPrompt, outreachRefinePrompt } from './prompts.js';
import { loadProfile, profileForAI } from './profile.js';
import { unsupportedClaims } from './post.js';

export const OUTREACH_TYPES = [
  { id: 'referral', label: 'Referral request (LinkedIn message)', email: false, words: '70-110', limit: 1900, hint: 'Ask for one specific thing — a referral or a quick pointer — and make it easy to decline.', placeholder: 'e.g. Saw the Edge AI intern opening on your team. I built a gesture recogniser on an STM32. Could you refer me or tell me who to talk to?' },
  { id: 'connect', label: 'Connection note (300 characters max)', email: false, words: '35-50', limit: 300, hint: 'One sentence on why you are reaching out, one on the shared interest. LinkedIn caps this at 300 characters.', placeholder: 'e.g. Interested in on-device ML; I work on TinyML projects and would like to follow your team’s work.' },
  { id: 'recruiter', label: 'Cold email to a recruiter / hiring manager', email: true, words: '90-130', limit: 2500, hint: 'Name the role, give one relevant proof point, ask one question or offer your resume.', placeholder: 'e.g. Applying for the Embedded Vision intern role. Wanted to share my Edge Cam project and check the timeline.' },
  { id: 'professor', label: 'Research internship email to a professor', email: true, words: '110-160', limit: 3000, hint: 'Mention a specific research area from their page, one relevant project of yours, and ask whether they take interns.', placeholder: 'e.g. I am interested in their work on efficient on-device inference. Looking for a summer research internship.' },
  { id: 'followup', label: 'Follow-up after applying / interviewing', email: true, words: '50-80', limit: 1500, hint: 'Short and polite: remind them you applied, add one new fact if you have one, ask for a status.', placeholder: 'e.g. Applied two weeks ago, no update yet. Finished the ONNX project since then.' },
];

const GREETING_SKIP = /^(there|team|all|everyone|hiring|recruit|sir|madam|and)$/i;

/** Things cold messages written by small models get wrong, in plain words for the user. */
export function outreachWarnings(draft, { type, sources, notes }) {
  const { subject, body } = draft;
  const text = `${subject || ''}\n${body}`;
  const said = String(notes || '').toLowerCase();
  const out = [];

  const placeholder = text.match(/\[[^\]\n]{2,40}\]|<[^>\n]{2,30}>|\{[^}\n]{2,30}\}/);
  if (placeholder) out.push(`it contains a placeholder (${placeholder[0]}) — fill it in`);

  // greeting words are matched in any case, but the NAME must be capitalised (so "Hi there" is not read as a name)
  const hello = body.match(/^\s*(?:[Hh]i|[Hh]ello|[Dd]ear)\s+((?:(?:[Dd]r|[Pp]rof|[Pp]rofessor|[Mm]r|[Mm]s|[Mm]rs)\.?\s+)?[A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+)?)/m);
  if (hello) {
    const tokens = hello[1].replace(/^(?:dr|prof|professor|mr|ms|mrs)\.?\s+/i, '').split(/\s+/).filter((t) => !GREETING_SKIP.test(t));
    const src = String(sources).toLowerCase();
    if (tokens.length && !tokens.every((t) => src.includes(t.toLowerCase().replace(/[.,]$/, '')))) out.push(`it greets “${hello[1]}”, which isn't on the page or in your notes — confirm the name`);
  }

  if (/\b(big fan|huge fan|love your work|loved your work|inspiring|groundbreaking|admire (?:your|the) work)\b/i.test(text) && !/fan|admire|inspir/.test(said)) out.push('it uses generic flattery — cut it or make it specific');
  if (/\b(?:I (?:have )?read|I(?:'ve| have) been following|after reading|I enjoyed reading|I went through)\b/i.test(text) && !/\b(read|follow|went through)/.test(said)) out.push('it says you read or followed their work — keep that only if it is true');

  for (const c of unsupportedClaims(text, sources)) out.push(`${c} isn't in your profile or notes`);

  if (type.id === 'connect' && body.length > 300) out.push(`it is ${body.length} characters; LinkedIn allows 300 for a connection note`);
  const words = body.trim().split(/\s+/).length;
  const max = Number(type.words.split('-')[1]);
  if (words > max * 1.5) out.push(`${words} words is long for cold outreach (aim for about ${max})`);
  if (type.email && !subject) out.push('there is no subject line');
  return out;
}

/** Split "Subject: …" off the top of an email draft. */
export function parseOutreach(raw, type) {
  let text = String(raw ?? '').replace(/\r\n?/g, '\n').trim().replace(/^["“]|["”]$/g, '').trim();
  let subject = '';
  if (type.email) {
    const m = text.match(/^\s*(?:\*\*)?subject(?:\*\*)?\s*:\s*(.+)\n?/i);
    if (m) {
      subject = m[1].replace(/\*\*/g, '').trim();
      text = text.slice(m[0].length).trim();
    }
  }
  const body = text.replace(/\n{3,}/g, '\n\n');
  return { subject, body };
}

export async function generateOutreach({ typeId, notes, page, role, tone, link }) {
  const type = OUTREACH_TYPES.find((t) => t.id === typeId) || OUTREACH_TYPES[0];
  if (!notes.trim() && !page && !role) throw new Error('Say what you want in a line or two, pick a role, or open the person’s page and tick “Use this page”.');
  const { profile } = await loadProfile();
  const profileAI = profileForAI(profile);
  const appliedOn = type.id === 'followup' && role?.appliedAt ? role.appliedAt.slice(0, 10) : '';
  const { system, user } = outreachPrompt({ type, notes: notes.trim(), page, role, profile: profileAI, tone, link, appliedOn });
  const raw = await complete({ system, messages: [{ role: 'user', content: user }], temperature: 0.4 });
  const draft = parseOutreach(raw, type);
  if (draft.body.length < 40) throw new Error('The AI returned no usable message. Try again, or add more detail.');
  const sources = `${notes} ${page?.text || ''} ${role ? `${role.title} ${role.company} ${role.description}` : ''} ${JSON.stringify(profileAI)} ${link || ''} ${appliedOn}`;
  return { ...draft, warnings: outreachWarnings(draft, { type, sources, notes }) };
}

export async function refineOutreach(draft, instruction, typeId) {
  const type = OUTREACH_TYPES.find((t) => t.id === typeId) || OUTREACH_TYPES[0];
  const text = type.email ? `Subject: ${draft.subject}\n\n${draft.body}` : draft.body;
  const { system, user } = outreachRefinePrompt({ text, instruction, email: type.email });
  return parseOutreach(await complete({ system, messages: [{ role: 'user', content: user }], temperature: 0.4 }), type);
}

/** Gmail compose link. Very long bodies are dropped from the URL (the caller copies them to the clipboard instead). */
export function gmailUrl({ to = '', subject = '', body = '' }) {
  const enc = encodeURIComponent;
  const base = `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(to)}&su=${enc(subject)}`;
  const full = `${base}&body=${enc(body)}`;
  return full.length <= 6000 ? { url: full, bodyIncluded: true } : { url: base, bodyIncluded: false };
}
