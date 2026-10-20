// Roles & opportunities: turning scraped page data into clean records, and judging them against your filters.
// Pure functions — no browser APIs — so the same code runs in the service worker, the side panel and tests.

export const STATUSES = [
  ['new', 'New'], // collected automatically; nothing is expected of it yet
  ['saved', 'Shortlisted'],
  ['applied', 'Applied'],
  ['oa', 'Online test'],
  ['interview', 'Interview'],
  ['offer', 'Offer'],
  ['rejected', 'Rejected'],
  ['ignored', 'Ignored'],
];
/** Statuses where a follow-up still matters. (Deadline alerts only go out for 'saved' — roles you shortlisted.) */
export const OPEN_STATUSES = new Set(['saved', 'applied', 'oa', 'interview']);
export const APPLIED_STATUSES = new Set(['applied', 'oa', 'interview', 'offer', 'rejected']);

const DAY = 86400000;
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9+# ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ---------- identity ----------

/** Stable id for a posting, so the same job opened twice (or via a list and its own page) is one record. */
export function canonicalKey(url, title = '', company = '') {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|in|m|uk|ca)\./, '');
    const last = (re) => u.pathname.match(re)?.[1];
    if (/linkedin\.com$/.test(host)) {
      const id = last(/(\d{6,})\/?$/) || u.searchParams.get('currentJobId');
      if (id) return `linkedin:${id}`;
    }
    if (/indeed\./.test(host) && u.searchParams.get('jk')) return `indeed:${u.searchParams.get('jk')}`;
    if (/naukri\.com$/.test(host) && last(/-(\d{9,})$/)) return `naukri:${last(/-(\d{9,})$/)}`;
    if (/unstop\.com$/.test(host) && last(/-(\d{4,})\/?$/)) return `unstop:${last(/-(\d{4,})\/?$/)}`;
    const gh = u.searchParams.get('gh_jid');
    return `${host}${u.pathname.replace(/\/$/, '')}${gh ? `#${gh}` : ''}`;
  } catch {
    return `${norm(company)}|${norm(title)}`;
  }
}

/** Same company + title across different sites → likely the same job. */
export const dupKey = (company, title) => (norm(company) && norm(title) ? `${norm(company)}|${norm(title)}` : '');

// ---------- parsing ----------

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const iso = (d) => d.toISOString().slice(0, 10);

/** "₹ 7,500 - 10,000 /month", "INR 7500-15000 MONTH", "$20/hr", "Unpaid", "3-5 LPA" → structured. */
export function parseStipend(input) {
  const text = clean(input);
  const out = { text, unpaid: false, currency: null, min: null, max: null, period: null, perMonthINR: null };
  if (!text) return out;
  if (/\b(unpaid|no stipend|not paid|volunteer|without stipend)\b/i.test(text)) {
    out.unpaid = true;
    return out;
  }
  if (/\b(performance|incentive|commission|not disclosed|not specified|negotiable|as per|competitive)\b/i.test(text) && !/\d/.test(text)) return out;

  out.currency = /₹|\brs\b\.?|\binr\b|\blpa\b|\blakh|\blac\b/i.test(text) ? 'INR' : /\$|\busd\b/i.test(text) ? 'USD' : /€|\beur\b/i.test(text) ? 'EUR' : /£|\bgbp\b/i.test(text) ? 'GBP' : null;

  // k = thousand, M = million, lakh/lpa = 1e5, crore = 1e7 (anything else written without a unit stays as it is)
  const UNIT = { k: 1e3, m: 1e6, mn: 1e6, million: 1e6, l: 1e5, lpa: 1e5, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, cr: 1e7, crore: 1e7, crores: 1e7 };
  const found = [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k|lpa|lakhs?|lacs?|million|mn|crores?|cr|m|l)?(?![a-z0-9])/gi)]
    .map((m) => ({ v: parseFloat(m[1].replace(/,/g, '')), suffix: (m[2] || '').toLowerCase() }))
    .filter((n) => !Number.isNaN(n.v))
    .slice(0, 2);
  // "3-5 LPA" / "10-15k": the unit written once applies to both ends of the range
  const unit = found.find((n) => n.suffix)?.suffix || '';
  const nums = found.map((n) => {
    const suffix = n.suffix || (n.v < 1000 ? unit : '');
    return { v: n.v * (UNIT[suffix] ?? 1), suffix };
  });
  if (!nums.length) return out;

  out.min = Math.min(...nums.map((n) => n.v));
  out.max = Math.max(...nums.map((n) => n.v));
  out.period = /\/\s*(month|mo)\b|per month|a month|\bp\.?m\.?\b|monthly|\bmonth\b/i.test(text)
    ? 'month'
    : /year|annum|\bp\.?a\.?\b|annual|\blpa\b/i.test(text) || nums.some((n) => n.suffix && n.suffix !== 'k')
      ? 'year'
      : /week/i.test(text)
        ? 'week'
        : /hour|\bhr\b/i.test(text)
          ? 'hour'
          : null;

  if (out.currency === 'INR' && out.period) {
    const f = { month: 1, year: 1 / 12, week: 4.33 }[out.period];
    if (f) out.perMonthINR = { min: Math.round(out.min * f), max: Math.round(out.max * f) };
  }
  return out;
}

/** "2 Months", "2-3 months", "8 weeks" → months (the longer end of a range). null if not stated. */
export function parseDuration(text) {
  const m = clean(text).match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)?\s*(\d+(?:\.\d+)?)?\s*(month|week|year)s?/i);
  if (!m) return null;
  const n = Math.max(parseFloat(m[1]), m[2] ? parseFloat(m[2]) : 0);
  const unit = m[3].toLowerCase();
  return Math.round((unit === 'month' ? n : unit === 'week' ? n / 4.345 : n * 12) * 10) / 10;
}

/** ISO date from "2026-11-15T…", "15 Nov' 26", "Nov 15, 2026", "2 days left"… or null. */
export function parseDeadline(input, now = new Date()) {
  const s = clean(input);
  if (!s) return null;
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/\btoday\b|last day/i.test(s)) return iso(now);
  m = s.match(/(\d+)\s*days?\s*(left|remaining|to go)|in\s*(\d+)\s*days?/i);
  if (m) return iso(new Date(now.getTime() + parseInt(m[1] || m[3], 10) * DAY));
  const year = (y) => (y.length === 2 ? 2000 + +y : +y);
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?[\s\-/']*([A-Za-z]{3})[a-z]*[\s\-/,']*(\d{2,4})/);
  if (m && MONTHS[m[2].toLowerCase()] != null) return iso(new Date(Date.UTC(year(m[3]), MONTHS[m[2].toLowerCase()], +m[1])));
  m = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()] != null) return iso(new Date(Date.UTC(+m[3], MONTHS[m[1].toLowerCase()], +m[2])));
  return null;
}

/** Whole days from today until an ISO date (negative = past). */
export function daysUntil(isoDate, now = new Date()) {
  if (!isoDate) return null;
  const end = new Date(`${isoDate}T23:59:59`);
  return Math.floor((end - now) / DAY); // today → 0, tomorrow → 1, yesterday → -1
}

// ---------- normalising a scraped role ----------

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^(www|in|m)\./, '');
  } catch {
    return '';
  }
};

/** raw = what a content script scraped; returns a record ready to store. */
export function normalizeRole(raw, now = new Date()) {
  const title = clean(raw.title);
  const company = clean(raw.company);
  const location = clean(raw.location);
  const durationText = clean(raw.duration);
  return {
    id: canonicalKey(raw.url, title, company),
    dupKey: dupKey(company, title),
    kind: raw.kind === 'opportunity' ? 'opportunity' : 'job',
    title,
    company,
    location,
    remote: Boolean(raw.remote) || /\b(remote|work from home|wfh)\b/i.test(location),
    url: raw.url,
    source: hostOf(raw.url),
    description: String(raw.description || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000),
    stipend: parseStipend(raw.stipend),
    durationText,
    durationMonths: parseDuration(durationText),
    deadline: parseDeadline(raw.deadline, now),
    postedText: clean(raw.posted),
    employmentType: clean([].concat(raw.employmentType || []).join(', ')),
    skills: [].concat(raw.skills || []).map(clean).filter(Boolean).slice(0, 25),
    isDetail: Boolean(raw.isDetail),
    seenAt: now.toISOString(),
  };
}

// ---------- filters ----------

export const DEFAULT_KEYWORDS = [
  'ai', 'artificial intelligence', 'ml', 'machine learning', 'deep learning', 'computer vision', 'vision', 'edge', 'embedded', 'tinyml',
  'nlp', 'llm', 'genai', 'generative', 'data scientist', 'data science', 'robotics', 'firmware', 'iot', 'fpga', 'dsp', 'signal processing', 'neural', 'tensorflow', 'pytorch',
];
export const DEFAULT_EXCLUDE = [
  'sales', 'marketing', 'business development', 'telecaller', 'human resources', 'content writ', 'social media', 'graphic design',
  'accountant', 'accounts', 'recruiter', 'recruitment', 'customer support', 'video edit', 'seo', 'data entry', 'copywriting',
];

export function defaultFilters(ctx = {}) {
  return { keywords: DEFAULT_KEYWORDS, exclude: DEFAULT_EXCLUDE, minStipend: 0, maxDurationMonths: 0, remoteOnly: false, locations: [], batchYear: ctx.batchYear || '' };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Short single words must match as whole words ("ai" must not match "mail"); longer phrases match anywhere. */
function found(text, words) {
  const t = ` ${norm(text)} `;
  return words.filter((w) => {
    const k = norm(w);
    return k && (k.length <= 4 && !k.includes(' ') ? new RegExp(`(^| )${escapeRe(k)}( |$)`).test(t) : t.includes(k));
  });
}

const FLAG_RULES = [
  { re: /(registration|training|security|joining|program(me)?|processing|enrol+ment|placement|certification)\s*(fee|fees|deposit|charges|amount)|pay\s*(rs|₹|inr)?\s*[\d,]+\s*(to|for)\s*(join|apply|get)|refundable\s*(deposit|fee)|\bearn\s*(while|and)\s*pay/i, severity: 'danger', text: 'Asks you to pay a fee' },
  { re: /\b(whatsapp|telegram)\b.{0,60}\b(contact|apply|send|message|resume|cv)\b|\b(contact|apply|send|message)\b.{0,60}\b(whatsapp|telegram)\b/i, severity: 'warn', text: 'Asks you to apply via WhatsApp/Telegram' },
  { re: /\b(earn|income)\b.{0,30}\b(per day|daily|per week|weekly|lakhs?)\b|\bwork from home\b.{0,40}\bearn\b/i, severity: 'warn', text: 'Reads like an earn-from-home pitch' },
  { re: /\b(performance[- ]based|commission[- ]only|incentive[- ]only|only incentives?)\b/i, severity: 'warn', text: 'Pay is performance/commission based' },
];

/** Judge a role against your filters → { verdict: 'match'|'maybe'|'skip', reasons, flags }. */
export function evaluate(role, filters, now = new Date()) {
  const f = { ...defaultFilters(), ...filters };
  const reasons = [];
  const flags = [];
  const body = `${role.title} ${role.description} ${role.stipend?.text || ''} ${role.durationText}`;

  // red flags
  for (const rule of FLAG_RULES) if (rule.re.test(body)) flags.push({ severity: rule.severity, text: rule.text });
  if (role.stipend?.unpaid) flags.push({ severity: 'warn', text: 'Unpaid' });
  if (role.kind === 'job' && !role.company) flags.push({ severity: 'warn', text: 'No company name shown' });
  if (/^(confidential|stealth|undisclosed)\b/i.test(role.company)) flags.push({ severity: 'warn', text: 'Company is hidden' });

  // relevance
  const inTitle = found(role.title, f.keywords);
  const inBody = found(`${role.skills.join(' ')} ${role.description}`, f.keywords);
  const excluded = found(role.title, f.exclude);
  if (inTitle.length) reasons.push({ kind: 'ok', text: `Title matches: ${inTitle.slice(0, 4).join(', ')}` });
  else if (inBody.length >= 3) reasons.push({ kind: 'ok', text: `Mentions: ${inBody.slice(0, 4).join(', ')}` });
  if (excluded.length && !inTitle.length) reasons.push({ kind: 'fail', text: `Looks off-target (${excluded[0]})` });
  if (!inTitle.length && inBody.length < 3 && !excluded.length) reasons.push({ kind: 'warn', text: 'Little overlap with your keywords' });

  // hard filters
  const days = daysUntil(role.deadline, now);
  if (days != null && days < 0) reasons.push({ kind: 'fail', text: 'Deadline has passed' });
  const pay = role.stipend?.perMonthINR;
  if (f.minStipend > 0) {
    if (role.stipend?.unpaid) reasons.push({ kind: 'fail', text: 'Unpaid, you want ≥ ₹' + f.minStipend.toLocaleString('en-IN') });
    else if (pay && pay.max < f.minStipend) reasons.push({ kind: 'fail', text: `Stipend up to ₹${pay.max.toLocaleString('en-IN')} is below your minimum` });
    else if (!pay && role.kind === 'job') reasons.push({ kind: 'warn', text: 'Stipend not stated' });
  }
  if (f.remoteOnly && !role.remote) reasons.push({ kind: 'fail', text: 'Not remote' });
  if (f.locations.length && !role.remote) {
    const loc = norm(role.location);
    if (!loc) reasons.push({ kind: 'warn', text: 'Location not stated' });
    else if (!f.locations.some((l) => loc.includes(norm(l)))) reasons.push({ kind: 'fail', text: `Location “${role.location}” isn't in your list` });
  }
  if (f.maxDurationMonths > 0 && role.durationMonths && role.durationMonths > f.maxDurationMonths) {
    reasons.push({ kind: 'fail', text: `${role.durationMonths} months is longer than your ${f.maxDurationMonths}-month limit` });
  }

  // batch / graduation year mentioned in the posting
  if (f.batchYear) {
    // years named next to a batch/graduation word, in either order: "batch of 2027 and 2028", "2027/2028 batch"
    const yearList = '(20\\d\\d(?:\\s*(?:,|/|&|and|or|-|–|to)\\s*20\\d\\d)*)';
    const word = '(?:batch(?:es)?|class of|graduat\\w*|pass(?:ing)?[- ]?out)';
    const years = new Set();
    for (const re of [new RegExp(`${word}[^.\\n]{0,30}?${yearList}`, 'gi'), new RegExp(`${yearList}\\s*${word}`, 'gi')]) {
      for (const m of body.matchAll(re)) m[1].match(/20\d\d/g).forEach((y) => years.add(y));
    }
    if (years.size && !years.has(String(f.batchYear))) {
      reasons.push({ kind: 'warn', text: `Mentions batch ${[...years].sort().join('/')} — you're ${f.batchYear}` });
    } else if (years.has(String(f.batchYear))) reasons.push({ kind: 'ok', text: `Open to your ${f.batchYear} batch` });
  }

  const failed = reasons.some((r) => r.kind === 'fail');
  const batchWarning = reasons.some((r) => r.kind === 'warn' && r.text.startsWith('Mentions batch'));
  let verdict;
  if (flags.some((x) => x.severity === 'danger') || failed) verdict = 'skip';
  else if (inTitle.length) verdict = batchWarning ? 'maybe' : 'match';
  else if (inBody.length >= 3) verdict = 'maybe';
  else verdict = 'skip';
  return { verdict, reasons, flags };
}

// ---------- merging & export ----------

const prefer = (a, b) => (b == null || b === '' || (Array.isArray(b) && !b.length) ? a : b);

/** Fold a freshly scraped record into one already stored. Your own fields (status, notes, fit…) always survive. */
export function mergeRole(existing, incoming, now = new Date()) {
  if (!existing) return { ...incoming, status: 'new', createdAt: now.toISOString(), updatedAt: now.toISOString() };
  const stub = !incoming.isDetail && existing.isDetail; // a list card must not downgrade a full detail record
  const merged = { ...existing };
  for (const key of ['title', 'company', 'location', 'url', 'durationText', 'durationMonths', 'deadline', 'postedText', 'employmentType', 'skills']) {
    merged[key] = stub ? prefer(incoming[key], existing[key]) : prefer(existing[key], incoming[key]);
  }
  merged.remote = existing.remote || incoming.remote;
  merged.kind = incoming.kind;
  merged.isDetail = existing.isDetail || incoming.isDetail;
  merged.description = (incoming.description || '').length > (existing.description || '').length ? incoming.description : existing.description;
  merged.stipend = incoming.stipend?.text && (!existing.stipend?.text || !stub) ? incoming.stipend : existing.stipend;
  merged.seenAt = incoming.seenAt;
  merged.updatedAt = now.toISOString();
  return merged;
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
export function toCSV(roles) {
  const head = ['Title', 'Company', 'Location', 'Stipend', 'Duration', 'Deadline', 'Status', 'Verdict', 'Fit', 'Applied', 'Follow-up', 'Link', 'Notes'];
  const rows = roles.map((r) => [r.title, r.company, r.location, r.stipend?.text, r.durationText, r.deadline, r.status, r.eval?.verdict, r.fit?.score, r.appliedAt?.slice(0, 10), r.followUpAt, r.url, r.notes]);
  return [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
