// Page-side autofill engine. Injected into every frame of the tab on demand (see lib/autofill.js).
//
//   TwiggFill.run(flat, saved, opts)   scan the form, fill what the profile answers → field list
//   TwiggFill.finalize(items)          write the AI's answers, then colour everything
//   TwiggFill.attachFile(id, file)     put your resume PDF into an upload field
//   TwiggFill.collect(ids)             read back what is in fields (to remember your answers)
//   TwiggFill.focus(id) / .clear()
//
// Rules: never clicks Submit/Next, never ticks checkboxes (consent boxes are yours to tick),
// never overwrites what is already in a field unless asked, never touches password fields.

(() => {
  // No "already loaded" check: after Twigg is reloaded, an OLDER copy of this script can still live in tabs that
  // were open, and skipping would leave that old code running. Defining again simply replaces it.

  const registry = new Map(); // id → { el, els, kind, optionEls, markEl, desc }
  let fields = []; // descriptors from the last scan
  let counter = 0;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const PLACEHOLDER_OPTION = /^(select|choose|please|pick|--|—|none$)/i;
  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password', 'search', 'range', 'color']);

  // ---------- DOM helpers ----------

  /** querySelectorAll that also looks inside open shadow roots. */
  function queryAll(selector) {
    const out = [];
    const visit = (root) => {
      out.push(...root.querySelectorAll(selector));
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot);
    };
    visit(document);
    return out;
  }

  function isVisible(el) {
    if (!el?.isConnected) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Radios/checkboxes are often visually hidden behind a styled label.
  const isShown = (el) => isVisible(el) || [...(el.labels || [])].some(isVisible) || isVisible(el.parentElement);

  /** Text of a node without the form controls inside it. */
  function ownText(node) {
    if (!node) return '';
    const copy = node.cloneNode(true);
    copy.querySelectorAll('input, select, textarea, button, script, style, svg, [aria-hidden="true"]').forEach((n) => n.remove());
    return clean(copy.textContent);
  }

  const hasControl = (n) => n.matches?.('input, select, textarea') || n.querySelector?.('input, select, textarea');

  /** Short text in the element just before this one — how most hand-built forms label inputs. */
  function nearbyLabel(el) {
    let node = el;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      let sib = node.previousElementSibling;
      for (let i = 0; sib && i < 3; i++, sib = sib.previousElementSibling) {
        if (hasControl(sib)) continue;
        const t = ownText(sib);
        if (t && t.length < 160) return t;
      }
    }
    return '';
  }

  function byIds(el, ids) {
    const root = el.getRootNode();
    return ids
      .split(/\s+/)
      .map((id) => root.getElementById?.(id) || document.getElementById(id))
      .filter(Boolean)
      .map(ownText)
      .filter(Boolean)
      .join(' ');
  }

  function labelFor(el) {
    const labelledby = el.getAttribute('aria-labelledby');
    let t = labelledby && byIds(el, labelledby);
    if (t) return t;
    if (el.labels?.length) {
      t = [...el.labels].map(ownText).join(' ');
      if (t) return t;
    }
    const wrap = el.closest('label');
    if (wrap && (t = ownText(wrap))) return t;
    if ((t = clean(el.getAttribute('aria-label')))) return t;
    if ((t = nearbyLabel(el))) return t;
    return clean(el.placeholder || el.title || '');
  }

  /** Strip "*" / "(required)" and report whether it was there. */
  function splitRequired(label) {
    const required = /\*\s*$|\(\s*required\s*\)|\brequired\b\s*$/i.test(label);
    return { label: clean(label.replace(/\s*\*+\s*$/, '').replace(/\(?\s*required\s*\)?\s*$/i, '')), required };
  }

  function commonAncestor(els) {
    let node = els[0].parentElement;
    while (node && !els.every((e) => node.contains(e))) node = node.parentElement;
    return node || els[0].parentElement;
  }

  const optionLabel = (r) => ownText(r.labels?.[0] || r.closest('label')) || clean(r.getAttribute('aria-label')) || ownText(r.nextElementSibling) || clean(r.value);

  // ---------- scan ----------

  function addField(desc, entry) {
    desc.id = `t${counter++}`;
    entry.desc = desc;
    registry.set(desc.id, entry);
    fields.push(desc);
  }

  function baseDesc(el, kind) {
    const { label, required } = splitRequired(labelFor(el));
    return {
      kind,
      type: (el.type || '').toLowerCase(),
      label,
      required: required || el.required || el.getAttribute('aria-required') === 'true',
      placeholder: clean(el.placeholder),
      name: el.name || '',
      attrId: el.id || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      maxLength: el.maxLength > 0 && el.maxLength < 100000 ? el.maxLength : 0,
      filled: false,
    };
  }

  function scan() {
    registry.clear();
    fields = [];
    counter = 0;

    const all = queryAll('input, textarea, select, [role="radiogroup"], [role="listbox"]');
    const fileCount = all.filter((e) => e.type === 'file' && !e.disabled).length;
    const radios = [];

    for (const el of all) {
      const tag = el.tagName.toLowerCase();
      const type = (el.type || '').toLowerCase();

      if (el.getAttribute('role') === 'radiogroup') {
        const options = [...el.querySelectorAll('[role="radio"]')];
        if (!options.length || !isVisible(el)) continue;
        const { label, required } = splitRequired(labelFor(el));
        addField(
          { kind: 'radio', type: 'radio', label, required, options: options.map((o) => clean(o.getAttribute('aria-label') || o.getAttribute('data-value') || o.textContent)), filled: options.some((o) => o.getAttribute('aria-checked') === 'true') },
          { els: options, markEl: el, custom: true }
        );
        continue;
      }
      if (el.getAttribute('role') === 'listbox') {
        if (!isVisible(el)) continue;
        const { label, required } = splitRequired(labelFor(el));
        const current = clean(el.textContent);
        addField({ kind: 'listbox', type: 'listbox', label, required, filled: Boolean(current) && !PLACEHOLDER_OPTION.test(current) && !/^choose$/i.test(current) }, { el, markEl: el });
        continue;
      }
      if (type === 'radio') {
        if (!el.disabled) radios.push(el);
        continue;
      }
      if (SKIP_TYPES.has(type) || el.disabled || el.readOnly) continue;

      if (type === 'file') {
        const d = fileDesc(el, fileCount);
        addField(d, { el, markEl: isVisible(el) ? el : el.parentElement });
        continue;
      }

      if (!isShown(el)) continue;

      if (type === 'checkbox') {
        const d = baseDesc(el, 'checkbox');
        d.label = d.label || optionLabel(el);
        d.filled = el.checked;
        addField(d, { el, markEl: el });
        continue;
      }

      if (tag === 'select') {
        const d = baseDesc(el, 'select');
        const optionEls = [...el.options].filter((o) => o.value !== '' && !PLACEHOLDER_OPTION.test(clean(o.textContent)));
        d.options = optionEls.map((o) => clean(o.textContent));
        d.filled = el.value !== '' && !PLACEHOLDER_OPTION.test(clean(el.selectedOptions[0]?.textContent));
        addField(d, { el, optionEls, markEl: el });
        continue;
      }

      const custom = el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-autocomplete') || el.getAttribute('aria-haspopup') === 'listbox';
      const kind = custom ? 'custom' : tag === 'textarea' ? 'textarea' : type === 'date' ? 'date' : 'text';
      const d = baseDesc(el, kind);
      d.filled = el.value.trim() !== '';
      addField(d, { el, markEl: el });
    }

    // radio buttons: one field per group
    const groups = new Map();
    radios.forEach((r, i) => {
      if (!isShown(r)) return;
      const key = r.name ? `${[...document.forms].indexOf(r.form)}|${r.name}` : `solo${i}`;
      (groups.get(key) || groups.set(key, []).get(key)).push(r);
    });
    for (const els of groups.values()) {
      const area = commonAncestor(els);
      const legend = els[0].closest('fieldset')?.querySelector('legend');
      const raw = ownText(legend) || (area?.getAttribute?.('aria-labelledby') && byIds(area, area.getAttribute('aria-labelledby'))) || clean(area?.getAttribute?.('aria-label')) || nearbyLabel(area || els[0]);
      const { label, required } = splitRequired(raw);
      addField(
        { kind: 'radio', type: 'radio', label, required: required || els.some((r) => r.required), name: els[0].name, options: els.map(optionLabel), filled: els.some((r) => r.checked) },
        { els, markEl: area }
      );
    }
    return fields;
  }

  // ---------- setting values ----------

  const nativeSetter = (el) => Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;

  function fireInput(el, data) {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Cut at a sentence/word boundary rather than mid-word when a field has a length limit. */
  function fit(text, max) {
    if (!max || text.length <= max) return text;
    const cut = text.slice(0, max);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
    return stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max);
  }

  async function pickFromListbox(box, value) {
    box.click();
    await sleep(300);
    const scope = box.closest('[role="listitem"]') || document;
    const options = [...scope.querySelectorAll('[role="option"]')].filter(isVisible);
    const texts = options.map((o) => clean(o.getAttribute('data-value') || o.textContent));
    const idx = TwiggMatch.chooseOption(texts, value);
    if (idx < 0) {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }
    options[idx].click();
    await sleep(150);
    return true;
  }

  /** Put `value` into the field. Returns true if it took. */
  async function setValue(entry, value) {
    const { desc } = entry;
    const text = String(value ?? '');
    if (!text.trim()) return false;

    switch (desc.kind) {
      case 'text':
      case 'textarea':
      case 'date': {
        const el = entry.el;
        const v = fit(text, desc.maxLength);
        if (desc.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
        if (desc.type === 'number' && Number.isNaN(Number(v))) return false;
        el.focus({ preventScroll: true });
        nativeSetter(el)?.call(el, v);
        fireInput(el, v);
        el.blur();
        return el.value !== '';
      }
      case 'select': {
        const idx = TwiggMatch.chooseOption(desc.options, text);
        if (idx < 0) return false;
        const el = entry.el;
        nativeSetter(el)?.call(el, entry.optionEls[idx].value);
        fireInput(el, entry.optionEls[idx].value);
        return el.value === entry.optionEls[idx].value;
      }
      case 'radio': {
        const idx = TwiggMatch.chooseOption(desc.options, text);
        if (idx < 0) return false;
        const target = entry.els[idx];
        if (entry.custom) target.click();
        else if (!target.checked) target.click();
        return entry.custom ? true : target.checked;
      }
      case 'listbox':
        return pickFromListbox(entry.el, text);
      default:
        return false; // checkbox, file, custom widgets: not filled by value
    }
  }

  // ---------- highlighting ----------

  const COLOR = { rule: 'green', learned: 'green', file: 'green', ai: 'yellow', review: 'yellow', needs: 'red' };
  const TITLE = { green: 'Twigg: filled from your profile', yellow: 'Twigg: please check this one', red: 'Twigg: needs you' };
  const marked = new Map(); // el → original title

  function injectStyle() {
    if (document.getElementById('twigg-style')) return;
    const style = document.createElement('style');
    style.id = 'twigg-style';
    style.textContent = `
      [data-twigg="green"]  { outline: 2px solid #2f7d4f !important; outline-offset: 1px !important; }
      [data-twigg="yellow"] { outline: 2px solid #d9a400 !important; outline-offset: 1px !important; }
      [data-twigg="red"]    { outline: 2px solid #c0392b !important; outline-offset: 1px !important; }
      [data-twigg="flash"]  { outline: 3px solid #2563eb !important; outline-offset: 2px !important; }`;
    document.head.append(style);
  }

  function paint(desc) {
    const color = COLOR[desc.status];
    const el = registry.get(desc.id)?.markEl;
    if (!color || !el) return;
    if (!marked.has(el)) marked.set(el, el.getAttribute('title'));
    el.setAttribute('data-twigg', color);
    el.setAttribute('title', `${TITLE[color]}${desc.note ? ` — ${desc.note}` : ''}`);
  }

  function clear() {
    for (const [el, title] of marked) {
      el.removeAttribute('data-twigg');
      title == null ? el.removeAttribute('title') : el.setAttribute('title', title);
    }
    marked.clear();
    // highlights left by an older copy of this script (after Twigg was reloaded)
    document.querySelectorAll('[data-twigg]').forEach((el) => el.removeAttribute('data-twigg'));
  }

  // ---------- public API ----------

  const slim = (d) => ({ id: d.id, kind: d.kind, type: d.type, label: d.label, required: d.required, options: d.options, maxLength: d.maxLength, resumeSlot: d.resumeSlot, status: d.status, note: d.note });

  async function run(flat, saved, opts = {}) {
    injectStyle();
    clear();
    scan();

    for (const d of fields) {
      const entry = registry.get(d.id);
      if (d.filled && !opts.overwrite && d.kind !== 'checkbox') {
        d.status = 'existing';
        continue;
      }
      if (d.kind === 'checkbox') {
        d.status = d.required && !d.filled ? 'needs' : 'skipped';
        d.note = d.status === 'needs' ? 'Tick this yourself (Twigg never ticks consent boxes)' : '';
        continue;
      }
      if (d.kind === 'custom') {
        d.status = d.required ? 'needs' : 'skipped';
        d.note = 'Custom dropdown — choose it yourself';
        continue;
      }
      if (d.kind === 'file') {
        d.status = d.resumeSlot ? 'file' : d.required ? 'needs' : 'skipped';
        if (d.status === 'needs') d.note = 'Upload this yourself';
        continue;
      }

      const m = TwiggMatch.match(d, flat, saved);
      if (m && (await setValue(entry, m.value))) {
        d.matchKey = m.key;
        d.note = m.note;
        d.status = m.confidence === 'check' || (m.source === 'learned' && d.kind === 'textarea') ? 'review' : m.source === 'learned' ? 'learned' : 'rule';
        if (d.status === 'review' && m.source === 'learned') d.note = 'Your saved answer — adapt it to this company';
      } else {
        d.status = 'pending';
      }
    }

    fields.forEach(paint);
    return fields.map(slim);
  }

  async function finalize(items = []) {
    for (const it of items) {
      const entry = registry.get(it.id);
      if (!entry || entry.desc.status !== 'pending') continue;
      const ok = await setValue(entry, it.value);
      entry.desc.status = ok ? 'ai' : 'needs';
      entry.desc.note = ok ? 'Written by AI — read it before submitting' : "AI's answer didn't fit this field";
    }
    for (const d of fields) if (d.status === 'pending') d.status = d.required ? 'needs' : 'skipped';
    fields.forEach(paint);
    return fields.map(slim);
  }

  /** Is this upload field for a resume? 'sure' (says resume/CV), 'maybe' (the only upload on the page), or ''. */
  function fileDesc(el, fileCount) {
    const d = baseDesc(el, 'file');
    const hint = `${d.label} ${d.name} ${d.attrId} ${el.getAttribute('accept') || ''}`.toLowerCase();
    const excluded = /cover|photo|picture|image|transcript|certificate|marksheet|mark sheet|id ?proof|signature|portfolio|sample/.test(hint);
    d.resumeSlot = !excluded && /resume|\bcv\b|curriculum/.test(hint) ? 'sure' : !excluded && fileCount === 1 ? 'maybe' : '';
    d.filled = el.files?.length > 0;
    return d;
  }

  /**
   * Find resume upload fields again, without disturbing the rest of the last fill.
   * Used when the site rebuilt its form (or the frame holding it) after Twigg filled it.
   */
  function findResumeSlots() {
    injectStyle();
    const inputs = queryAll('input[type="file"]').filter((e) => !e.disabled);
    const out = [];
    for (const el of inputs) {
      const d = fileDesc(el, inputs.length);
      if (!d.resumeSlot) continue;
      d.id = `t${counter++}`;
      registry.set(d.id, { el, markEl: isVisible(el) ? el : el.parentElement, desc: d });
      fields.push(d);
      out.push({ id: d.id, resumeSlot: d.resumeSlot });
    }
    return out;
  }

  async function attachFile(id, { name, type, b64 }) {
    const entry = registry.get(id);
    if (!entry || !entry.el?.isConnected) return 'gone'; // unknown here, or the site replaced the field — the caller looks for it again
    if (entry.desc.kind !== 'file') return false;
    try {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type }));
      entry.el.files = dt.files;
      entry.el.dispatchEvent(new Event('input', { bubbles: true }));
      entry.el.dispatchEvent(new Event('change', { bubbles: true }));
      const ok = entry.el.files.length === 1;
      entry.desc.status = ok ? (entry.desc.resumeSlot === 'maybe' ? 'review' : 'file') : 'needs';
      entry.desc.note = ok ? (entry.desc.resumeSlot === 'maybe' ? 'Resume attached — check this is the right upload' : 'Resume attached') : 'Could not attach — upload it yourself';
      paint(entry.desc);
      return ok;
    } catch {
      return false;
    }
  }

  function currentValue(entry) {
    const { desc } = entry;
    if (desc.kind === 'select') return clean(entry.el.selectedOptions[0]?.textContent);
    if (desc.kind === 'radio') {
      const i = entry.custom ? entry.els.findIndex((o) => o.getAttribute('aria-checked') === 'true') : entry.els.findIndex((r) => r.checked);
      return i >= 0 ? desc.options[i] : '';
    }
    if (desc.kind === 'listbox') return clean(entry.el.textContent);
    return clean(entry.el?.value);
  }

  function collect(ids) {
    return ids
      .map((id) => registry.get(id))
      .filter(Boolean)
      .map((e) => ({ id: e.desc.id, label: e.desc.label, kind: e.desc.kind, status: e.desc.status, value: currentValue(e) }))
      .filter((x) => x.value);
  }

  function focus(id) {
    const entry = registry.get(id);
    if (!entry) return;
    const el = entry.markEl || entry.el;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const prev = el.getAttribute('data-twigg');
    el.setAttribute('data-twigg', 'flash');
    setTimeout(() => (prev ? el.setAttribute('data-twigg', prev) : el.removeAttribute('data-twigg')), 1500);
    (entry.el || entry.els?.[0])?.focus?.({ preventScroll: true });
  }

  /** Set a field's status/note from outside (e.g. "choose which resume") and repaint it. */
  function mark(id, status, note) {
    const entry = registry.get(id);
    if (!entry) return false;
    entry.desc.status = status;
    entry.desc.note = note;
    paint(entry.desc);
    return true;
  }

  globalThis.TwiggFill = { run, finalize, attachFile, collect, focus, clear, mark, findResumeSlots };
})();
