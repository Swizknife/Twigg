// Generic form editor for a JSON-like object. Edits mutate `data` in place and call onChange().
//   string  → text box (textarea if long)     boolean → checkbox     number → number box
//   string[] → one-per-line box (long items) or comma-separated box (short items)
//   object[] → repeating cards with Add / Remove
//   object   → grouped fields
// Because it works from the data's own shape, new profile fields show up here with no extra UI code.

const LABELS = {
  cgpa: 'CGPA',
  cgpaScale: 'CGPA scale (out of)',
  dateOfBirth: 'Date of birth',
  ml_dl: 'ML / DL',
  edge_ai: 'Edge AI',
  embedded_hardware: 'Embedded & hardware',
  linkedin: 'LinkedIn',
  github: 'GitHub',
  minStipendINR: 'Min stipend (₹ per month)',
  postalCode: 'Postal code',
  openToRemote: 'Open to remote',
  openToInternational: 'Open to international roles',
  phoneCountryCode: 'Phone country code',
  rollNumber: 'Roll number',
  targetRoles: 'Target roles',
  jobTypes: 'Job types',
  durationsMonths: 'Durations (months)',
};

const HINTS = {
  dateOfBirth: 'DD/MM/YYYY',
  phone: 'As you want it on forms',
  phoneCountryCode: 'e.g. +91 (optional)',
  graduationYear: 'Year, e.g. 2027',
  availableFrom: 'e.g. May 2027',
  willingToRelocate: 'e.g. Yes / No / Open to it',
  score: 'Number only, e.g. 92.4',
};

const LONG_KEYS = new Set(['answer', 'summary', 'description']);
const LINE_KEYS = new Set(['bullets', 'achievements', 'certifications']);

export const humanize = (key) =>
  LABELS[key] || key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
}

/** An empty copy of an object with the same shape. */
export function blankLike(value) {
  if (Array.isArray(value)) return [];
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, blankLike(v)]));
  if (typeof value === 'boolean') return false;
  if (typeof value === 'number') return 0;
  return '';
}

export function renderEditor(container, data, { templates = {}, onChange = () => {} } = {}) {
  container.replaceChildren();

  const field = (label, control, hint, wide) =>
    el('label', { className: `field${wide ? ' wide' : ''}` }, el('span', { className: 'field-label', textContent: label }), control, hint && el('span', { className: 'field-hint', textContent: hint }));

  const at = (base, key) => (base ? `${base}.${key}` : key);

  function stringField(obj, key, base) {
    const value = obj[key] ?? '';
    const long = LONG_KEYS.has(key) || value.includes('\n') || value.length > 90;
    const control = el(long ? 'textarea' : 'input', { value, rows: 3, spellcheck: !/url|link|email|github|linkedin/i.test(key) });
    if (!long) control.type = 'text';
    control.dataset.path = at(base, key);
    control.addEventListener('input', () => {
      obj[key] = control.value;
      onChange();
    });
    return field(humanize(key), control, HINTS[key], long);
  }

  function boolField(obj, key, base) {
    const box = el('input', { type: 'checkbox', checked: Boolean(obj[key]) });
    box.dataset.path = at(base, key);
    box.addEventListener('change', () => {
      obj[key] = box.checked;
      onChange();
    });
    return el('label', { className: 'field check' }, box, el('span', { textContent: humanize(key) }));
  }

  function numberField(obj, key, base) {
    const control = el('input', { type: 'number', value: obj[key] });
    control.dataset.path = at(base, key);
    control.addEventListener('input', () => {
      obj[key] = control.value === '' ? 0 : Number(control.value);
      onChange();
    });
    return field(humanize(key), control);
  }

  function listField(obj, key, base) {
    const items = obj[key];
    const lines = LINE_KEYS.has(key) || items.some((s) => String(s).length > 28);
    const control = lines
      ? el('textarea', { value: items.join('\n'), rows: Math.max(3, Math.min(items.length + 1, 10)), spellcheck: true })
      : el('input', { type: 'text', value: items.join(', ') });
    control.dataset.path = at(base, key);
    control.addEventListener('input', () => {
      obj[key] = control.value
        .split(lines ? '\n' : ',')
        .map((s) => s.trim())
        .filter(Boolean);
      onChange();
    });
    return field(humanize(key), control, lines ? 'One per line' : 'Separate with commas', lines);
  }

  function cardList(obj, key, base) {
    const host = el('div', { className: 'card-list' });
    const items = obj[key];
    const draw = () => {
      host.replaceChildren(
        ...items.map((item, i) => {
          const body = el('div', { className: 'grid' });
          fill(body, item, `${at(base, key)}[${i}]`);
          const remove = el('button', { type: 'button', className: 'btn small', textContent: 'Remove' });
          remove.addEventListener('click', () => {
            items.splice(i, 1);
            onChange();
            draw();
          });
          const title = item.name || item.institution || item.company || item.question || item.degree || `${humanize(key)} ${i + 1}`;
          return el('div', { className: 'item-card' }, el('div', { className: 'item-head' }, el('strong', { textContent: title }), remove), body);
        }),
        (() => {
          const add = el('button', { type: 'button', className: 'btn small', textContent: `+ Add ${humanize(key).toLowerCase()} entry` });
          add.addEventListener('click', () => {
            const sample = templates[key]?.[0] ?? items[items.length - 1] ?? {};
            items.push(blankLike(sample));
            onChange();
            draw();
          });
          return add;
        })()
      );
    };
    draw();
    return el('div', { className: 'field wide' }, el('span', { className: 'field-label', textContent: humanize(key) }), host);
  }

  function group(obj, key, base) {
    const body = el('div', { className: 'grid' });
    fill(body, obj[key], at(base, key));
    return el('fieldset', { className: 'group wide' }, el('legend', { textContent: humanize(key) }), body);
  }

  function fill(target, obj, base = '') {
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        const objects = value.length && typeof value[0] === 'object';
        target.append(objects || (templates[key] && !value.length) ? cardList(obj, key, base) : listField(obj, key, base));
      } else if (value && typeof value === 'object') target.append(group(obj, key, base));
      else if (typeof value === 'boolean') target.append(boolField(obj, key, base));
      else if (typeof value === 'number') target.append(numberField(obj, key, base));
      else target.append(stringField(obj, key, base));
    }
  }

  for (const [key, value] of Object.entries(data)) {
    const body = el('div', { className: 'grid top' }); // 'top': the section title already names this list
    fill(body, { [key]: value });
    // A top-level object/array becomes its own section; unwrap it so it isn't double-titled.
    const section = el('details', { className: 'section', open: true }, el('summary', { textContent: humanize(key) }));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const inner = el('div', { className: 'grid' });
      fill(inner, value, key);
      section.append(inner);
    } else section.append(body);
    container.append(section);
  }
}

/**
 * Outline the fields whose values changed (paths like "projects[0].name" or "skills.ml_dl[2]").
 * A list box such as "skills.ml_dl" lights up when any item inside it changed.
 */
export function markChanged(container, paths) {
  const changed = [...paths];
  for (const node of container.querySelectorAll('[data-path]')) {
    const p = node.dataset.path;
    node.classList.toggle('changed', changed.some((c) => c === p || c.startsWith(`${p}[`) || c.startsWith(`${p}.`)));
  }
}
