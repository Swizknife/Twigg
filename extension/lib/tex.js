// Reading and editing a LaTeX resume (built for Jake's Resume and similar templates).
// We find the bullet points, let the AI rewrite their TEXT, and splice only those bullets back into your file.
// Everything else — preamble, layout, headings, dates — is never touched.

const BODY_START = /\\begin\{document\}/;

/** Index of the "}" matching the "{" at `open`, or -1. Skips escaped braces. */
export function matchBrace(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') i++; // skip the escaped character
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/** First {…} group at or after `from`: { start, end, text } (positions inside the braces) or null. */
function firstGroup(s, from) {
  const open = s.indexOf('{', from);
  if (open < 0) return null;
  const close = matchBrace(s, open);
  return close < 0 ? null : { start: open + 1, end: close, text: s.slice(open + 1, close) };
}

/** LaTeX → readable text (for matching keywords, showing diffs, and sending to the AI). */
export function texToPlain(tex) {
  let t = String(tex)
    .replace(/(^|[^\\])%.*$/gm, '$1') // comments
    .replace(/\\href\{[^{}]*\}\{([^{}]*)\}/g, '$1')
    .replace(/\$\|\$/g, '|')
    .replace(/\\\\(\[[^\]]*\])?/g, '\n')
    .replace(/\\([%&#_$])/g, '$1')
    .replace(/\\textbackslash\{\}/g, '\\')
    .replace(/~/g, ' ');
  // unwrap \textbf{x}, \emph{x}, \small{x}… repeatedly (nested)
  for (let i = 0; i < 6; i++) t = t.replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g, '$1');
  return t
    .replace(/\\[a-zA-Z]+\*?/g, ' ') // leftover commands
    .replace(/[{}]/g, '')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``|''/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plain text → LaTeX-safe text. */
export function escapeTex(text) {
  return String(text)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/—/g, '---')
    .replace(/–/g, '--')
    .replace(/…/g, '...')
    .replace(/→/g, '$\\rightarrow$')
    .replace(/×/g, '$\\times$')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/** The resume text after \begin{document} as plain text (what an ATS would read). */
export function resumePlain(tex) {
  const m = BODY_START.exec(tex);
  return texToPlain(m ? tex.slice(m.index + m[0].length) : tex);
}

/**
 * Bullet points: \resumeItem{…} (Jake's template) and plain \item lines in lists.
 * Returns [{ id, start, end, raw, plain, context }] where start/end bound the bullet's text inside the file.
 */
/** Blank out % comments but keep every character offset, so commented-out bullets are never parsed. */
function maskComments(tex) {
  return tex.replace(/(^|[^\\])%.*$/gm, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

export function parseBullets(tex) {
  const src = maskComments(tex); // scan this; slice text from the original
  const m = BODY_START.exec(src);
  const from = m ? m.index + m[0].length : 0; // macro definitions in the preamble are not bullets
  const bullets = [];
  const headings = [];

  // headings give each bullet its context (which project / job it belongs to)
  for (const h of src.slice(from).matchAll(/\\(resumeSubheading|resumeProjectHeading|section|subsection)\*?\s*\{/g)) {
    const at = from + h.index;
    const g = firstGroup(src, at);
    if (g) headings.push({ at, text: texToPlain(tex.slice(g.start, g.end)) });
  }
  const contextAt = (pos) => {
    const prior = headings.filter((h) => h.at < pos);
    return prior.length ? prior[prior.length - 1].text : '';
  };

  for (const b of src.slice(from).matchAll(/\\resumeItem\s*\{/g)) {
    const open = from + b.index + b[0].length - 1;
    const close = matchBrace(src, open);
    if (close < 0) continue;
    bullets.push({ kind: 'resumeItem', start: open + 1, end: close });
  }

  // plain \item lines: text runs to the next \item or \end{…}; skip "Label: values" skills rows
  const itemRe = /\\item\b\s*/g;
  const body = src.slice(from);
  for (const it of body.matchAll(itemRe)) {
    const start = from + it.index + it[0].length;
    const rest = src.slice(start);
    const stop = rest.search(/\\item\b|\\end\{|\\resumeItemListEnd/);
    const end = start + (stop < 0 ? rest.length : stop);
    const raw = tex.slice(start, end).replace(/\s+$/, '');
    if (!raw || /^\{?\s*\\textbf\{[^}]*\}\s*\{?\s*:/.test(raw)) continue; // skills row like \textbf{Languages}{: Python}
    if (bullets.some((b) => start >= b.start && start <= b.end)) continue; // already inside a \resumeItem
    bullets.push({ kind: 'item', start, end: start + raw.length });
  }

  return bullets
    .sort((a, b) => a.start - b.start)
    .map((b, i) => {
      const raw = tex.slice(b.start, b.end);
      return { id: i, ...b, raw, plain: texToPlain(raw), context: contextAt(b.start) };
    })
    .filter((b) => b.plain.length > 12);
}

/** Lines like \textbf{Languages}{: Python, C++} — returns [{ label, items }] for suggestions. */
export function parseSkillLines(tex) {
  const out = [];
  for (const m of tex.matchAll(/\\textbf\{([^{}]*)\}\s*\{?\s*:\s*([^}\\]*)\}?/g)) {
    const items = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    if (items.length) out.push({ label: m[1].trim(), items });
  }
  return out;
}

/** Replace the given ranges, working from the end so earlier offsets stay valid. */
export function applyEdits(tex, edits) {
  let out = tex;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Cheap structural sanity check on LaTeX we edited: braces balance and begin/end pairs match. */
export function looksBalanced(tex) {
  const noComments = tex.replace(/(^|[^\\])%.*$/gm, '$1');
  let depth = 0;
  for (let i = 0; i < noComments.length; i++) {
    const c = noComments[i];
    if (c === '\\') i++;
    else if (c === '{') depth++;
    else if (c === '}' && --depth < 0) return false;
  }
  const count = (re) => (noComments.match(re) || []).length;
  return depth === 0 && count(/\\begin\{/g) === count(/\\end\{/g);
}
