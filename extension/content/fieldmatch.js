// Decides which profile value a form field is asking for. Pure text logic, no DOM access,
// so it can be tested on its own. Loaded into pages together with fields.js.
//
//   TwiggMatch.match(field, flat, savedAnswers) → { key, value, source, confidence, note } | null
//
// `flat` is the profile flattened to { key: value } (see flattenProfile in lib/profile.js).
// A field with no confident match returns null — it is then left for the AI, or for you. Never guessed.

(() => {
  // No "already loaded" check: after Twigg is reloaded, an OLDER copy of this script can still live in tabs that
  // were open, and skipping would leave that old code running. Defining again simply replaces it.

  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9+%@ ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  // ---------- option matching ----------

  const CANON = [
    [/\bb ?tech(nology)?\b|\bbachelors? of technology\b/g, 'btech'],
    [/\bb e\b|\bbachelors? of engineering\b/g, 'be'],
    [/\bm ?tech(nology)?\b|\bmasters? of technology\b/g, 'mtech'],
    [/\bm e\b|\bmasters? of engineering\b/g, 'me'],
    [/\belectronics (and )?communications?( engineering)?\b|\bece\b/g, 'ece'],
    [/\bcomputer science( and engineering)?\b|\bcse\b/g, 'cse'],
  ];
  const STOP = new Set(['of', 'the', 'and', 'in', 'a', 'an', 'for', 'to']);

  function tokens(s) {
    let t = norm(s);
    for (const [re, to] of CANON) t = t.replace(re, to);
    return t.split(' ').filter((w) => w && !STOP.has(w));
  }

  /**
   * Index of the option that means the same as `value`, or -1.
   * Whole-word comparison, so "Male" never matches "Female" and "India" never matches "Indonesia".
   */
  function chooseOption(options, value) {
    const v = new Set(tokens(value));
    if (!v.size) return -1;
    let best = -1;
    let bestScore = 0;
    options.forEach((opt, i) => {
      const o = new Set(tokens(opt));
      if (!o.size) return;
      const shared = [...v].filter((t) => o.has(t)).length;
      let score = 0;
      if (shared === v.size && shared === o.size) score = 3;
      else if (shared === v.size || shared === o.size) score = 2 - Math.abs(o.size - v.size) * 0.01;
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    return best;
  }

  // ---------- what is this field asking for? ----------

  const AUTOCOMPLETE = {
    'given-name': 'firstName',
    'family-name': 'lastName',
    name: 'fullName',
    email: 'email',
    tel: 'phone',
    'tel-national': 'phone',
    bday: 'dob',
    'street-address': 'addressLine',
    'address-line1': 'addressLine',
    'postal-code': 'postalCode',
    'country-name': 'country',
    country: 'country',
    'address-level1': 'state',
    'address-level2': 'city',
    sex: 'gender',
    url: 'portfolio',
  };

  /** Profile key for a normalised label (or attribute text), or null. Order matters: specific before general. */
  function classify(t) {
    if (!t) return null;
    const has = (re) => re.test(t);

    // 10th / 12th details
    const ten = has(/\b(10th|tenth|ssc|matric|matriculation|class 10|class x|std 10|standard 10|grade 10|secondary school|xth)\b/);
    const twelve = has(/\b(12th|twelfth|hsc|intermediate|class 12|class xii|std 12|standard 12|grade 12|senior secondary|xiith|plus two)\b|(^| )\+2( |$)/);
    if (ten || twelve) {
      const p = twelve ? 'twelfth' : 'tenth';
      if (has(/board/)) return `${p}Board`;
      if (has(/\b(year|passing)\b/) && !has(/percent|%|marks|score|cgpa|grade/)) return `${p}Year`;
      if (has(/\b(school|institution|college)\b/) && !has(/percent|%|marks/)) return `${p}School`;
      return `${p}Percent`;
    }

    // contact
    if (has(/\be ?mail\b/)) return has(/alternat|secondary|parent|guardian|reference|referee|emergency|recruiter|manager/) ? null : 'email';
    if (has(/linkedin/)) return 'linkedin';
    if (has(/\bgit ?hub\b/)) return 'github';
    if (has(/portfolio|personal (web ?site|site|page)|\bblog\b|homepage/) || has(/^(personal |your )?(web ?site|url|link)$/)) return 'portfolio';
    if (has(/country code|dial code|\bisd\b/)) return 'phoneCountryCode';
    if (has(/\b(phone|mobile|telephone|cell|contact (no|number|num|details)|whatsapp)\b/)) {
      return has(/alternat|emergency|parent|guardian|father|mother|whatsapp|office|work|landline|reference/) ? null : 'phone';
    }

    // education
    if (has(/\b(cgpa|gpa|cpi|sgpa|spi)\b/)) return 'cgpa';
    if (has(/\b(percentage|percent|aggregate|marks)\b|%/) && has(/graduat|b ?tech|btech|engineering|college|university|\bug\b|undergrad|current|degree|semester|bachelor/)) return 'cgpaPercent';
    if (has(/\b(roll|registration|enrol+ment|reg) (no|number|id)\b|\busn\b|\b(student|university) id\b/)) return 'rollNumber';
    if (has(/\b(college|university|institute|institution|alma mater)\b/) && !has(/\b(location|city|state|address|email|website|id|code|pin)\b/)) return 'college';
    if (has(/\b(branch|discipline|specialization|specialisation|major|stream|field of study|department)\b/)) return 'branch';
    if (has(/\b(degree|qualification|course)\b/) && !has(/year|date/)) return 'degree';
    if (has(/\b(graduation|graduating|passing|pass out|passout|completion|batch)\b/)) return 'gradYear';

    // personal
    if (has(/\b(date of birth|dob|birth ?date|birthday)\b/)) return 'dob';
    if (has(/\b(gender|sex)\b/)) return 'gender';
    if (has(/\b(nationality|citizenship)\b/)) return 'nationality';
    if (has(/\b(pin ?code|zip( code)?|postal( code)?)\b/)) return 'postalCode';
    if (has(/\b(state|province)\b/) && !has(/united|status|statement|state of/)) return 'state';
    if (has(/^(current |present |your )?(city|town|location|city of residence)$/) || has(/\b(current|present) (city|location)\b/) || has(/^city\b/)) return 'city';
    if (has(/\bcountry\b/) && !has(/code/)) return 'country';
    if (has(/\b(address|street|residence|residential)\b/) && !has(/e ?mail|web/)) return 'addressLine';

    // preferences
    if (has(/relocat/)) return 'willingToRelocate';
    if (has(/\b(expected|desired|preferred)\b.*\b(stipend|salary|ctc|compensation|pay)\b|stipend expectation/)) return 'expectedStipend';
    if (has(/\b(available|start|joining|earliest)\b.*\b(from|date|start|join)\b|when can you (start|join)/)) return 'availableFrom';

    // names last, so "college name" etc. are already taken
    if (has(/\b(first|given) name\b|\bforename\b/)) return 'firstName';
    if (has(/\b(last|family) name\b|\bsurname\b/)) return 'lastName';
    if (has(/^(your |legal |candidate |applicant |student )?(full )?name$/) || has(/\b(full name|candidate name|applicant name|name of (the )?(candidate|applicant|student))\b/) || has(/^name as per/)) return 'fullName';
    return null;
  }

  // ---------- turning a profile value into what the field needs ----------

  function formatDob(raw, f) {
    const m = String(raw).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/) || String(raw).match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (!m) return { value: raw, check: 'Check the date format' };
    const iso = m[1].length === 4;
    const [y, mo, d] = iso ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
    const p2 = (n) => String(n).padStart(2, '0');
    if (f.type === 'date') return { value: `${y}-${p2(mo)}-${p2(d)}` };
    const ph = String(f.placeholder || '').toLowerCase();
    const sep = (ph.match(/[^a-z]/) || ['/'])[0];
    if (/y{2,4}\W?m{2}\W?d{2}/.test(ph)) return { value: [y, p2(mo), p2(d)].join(sep) };
    if (/m{2}\W?d{2}\W?y/.test(ph)) return { value: [p2(mo), p2(d), y].join(sep) };
    if (/d{2}\W?m{2}\W?y/.test(ph)) return { value: [p2(d), p2(mo), y].join(sep) };
    return { value: [p2(d), p2(mo), y].join('/'), check: 'Date format guessed as DD/MM/YYYY' };
  }

  function format(key, flat, f) {
    let value = flat[key];
    if (value == null) return null;
    let check = '';

    if (key === 'phone') {
      const tooLong = f.maxLength > 0 && value.length > f.maxLength;
      const wantsTen = /\b10 ?digit/i.test(`${f.label} ${f.placeholder}`);
      if ((tooLong || wantsTen) && flat.phone10) value = flat.phone10;
    } else if (key === 'dob') {
      ({ value, check = '' } = formatDob(value, f));
    } else if (key === 'cgpaPercent') {
      check = 'Converted from your CGPA (×9.5) — use your university’s formula if it differs';
    } else if (key === 'availableFrom') {
      check = 'Check the date format';
    }

    if (f.options?.length) {
      const idx = chooseOption(f.options, value);
      if (idx < 0) return null; // no option means this — leave it rather than pick wrongly
      value = f.options[idx];
    }
    return { key, value, source: 'rule', confidence: check ? 'check' : 'high', note: check || `From your profile (${key})` };
  }

  // ---------- public ----------

  const overlap = (a, b) => {
    const x = new Set(a.split(' '));
    const y = new Set(b.split(' '));
    const shared = [...x].filter((t) => y.has(t)).length;
    return shared / (x.size + y.size - shared);
  };

  function match(f, flat, saved = []) {
    const label = norm(f.label);

    // 1. answers you saved before (exact or near-exact question)
    if (label) {
      for (const a of saved) {
        const q = norm(a.question);
        if (!q || !String(a.answer || '').trim()) continue;
        if (q === label || (q.length > 12 && overlap(q, label) >= 0.85)) {
          let value = a.answer;
          if (f.options?.length) {
            const idx = chooseOption(f.options, value);
            if (idx < 0) continue;
            value = f.options[idx];
          }
          return { key: 'saved', value, source: 'learned', confidence: 'high', note: 'From your saved answers' };
        }
      }
    }

    // 2. what the label says, then the browser's autocomplete hint, then name/id attributes
    const key =
      classify(label) ||
      AUTOCOMPLETE[String(f.autocomplete || '').split(' ').pop()] ||
      classify(norm([f.name, f.attrId, f.placeholder].filter(Boolean).join(' ')));
    return key ? format(key, flat, f) : null;
  }

  globalThis.TwiggMatch = { match, classify, chooseOption, norm, tokens };
})();
