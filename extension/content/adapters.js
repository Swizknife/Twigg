// Per-site readers for job/internship/hackathon pages. They only READ what's already on the page you opened.
// Each returns raw fields; lib/roles.js cleans and judges them.
//   list()   → many roles from a search/listing page
//   detail() → one role from its own page (only needed when the site has no structured JobPosting data)
//
// Structured data (JSON-LD) is read separately in detect.js and is preferred on detail pages: Naukri, Indeed,
// Unstop and LinkedIn all publish it. Selectors below are tied to each site's current markup and will need
// updating when a site redesigns.

(() => {
  // No "already loaded" check: after Twigg is reloaded, an OLDER copy of this script can still live in tabs that
  // were open, and skipping would leave that old code running. Defining again simply replaces it.

  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const text = (root, sel) => clean(root.querySelector(sel)?.textContent);
  const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => clean(n.textContent)).filter(Boolean);
  const abs = (href) => {
    try {
      return new URL(href, location.href).href;
    } catch {
      return '';
    }
  };
  const first = (...vals) => vals.find((v) => v && String(v).trim()) || '';
  const bodyText = () => document.body?.innerText || '';
  /** "Label: value" or "LABEL\nvalue" anywhere on the page. */
  const fact = (label, max = 70) => {
    const m = bodyText().match(new RegExp(`${label}\\s*[:\\n]\\s*([^\\n]{1,${max}})`, 'i'));
    return m ? clean(m[1]) : '';
  };
  const deadlineFromText = () => {
    const m = bodyText().match(/(?:apply by|last date(?: to apply)?|deadline|registrations? (?:close|end)s?(?: on)?|closes? on|ends? on)\s*[:\-]?\s*([^\n]{4,30})/i);
    return m ? clean(m[1]) : '';
  };
  const description = (sel) => clean(document.querySelector(sel)?.innerText).length > 80 ? document.querySelector(sel).innerText : '';
  const meta = (name) => clean(document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.content);

  // ---------- Internshala ----------
  const internshala = {
    list() {
      return [...document.querySelectorAll('.individual_internship')]
        .map((card) => {
          const a = card.querySelector('a.job-title-href');
          if (!a) return null;
          const facts = texts(card, '.row-1-item');
          const stipend = first(text(card, '.stipend'), facts.find((t) => /₹|unpaid|performance|stipend/i.test(t)));
          const duration = facts.find((t) => /\d+\s*(month|week)/i.test(t) && !/₹/.test(t)) || '';
          const location = first(texts(card, '.locations a, #location_names a').join(', '), facts.find((t) => t !== stipend && t !== duration && !/start|apply/i.test(t)));
          return {
            title: clean(a.textContent),
            company: text(card, '.company-name'),
            location,
            stipend,
            duration,
            posted: (card.innerText.match(/(\d+\s*(?:day|week|month)s?\s*ago|just now|today)/i) || [])[0],
            skills: texts(card, '.job_skill'),
            url: abs(a.getAttribute('href') || card.getAttribute('data-href')),
            isDetail: false,
          };
        })
        .filter(Boolean);
    },
    detail() {
      if (!/\/(internship|job)\/detail\//.test(location.pathname)) return null;
      const items = {};
      document.querySelectorAll('.other_detail_item').forEach((n) => {
        items[text(n, '.item_heading').toLowerCase()] = text(n, '.item_body');
      });
      return {
        title: first(text(document, 'h1'), meta('og:title')).replace(/\s+-\s+(Internship|Job)$/i, ''),
        company: first(text(document, '.company_name a'), text(document, '.company-name'), text(document, '.company_and_premium a')),
        location: first(texts(document, '.location_link, #location_names a, .locations a').join(', '), fact('Location')),
        stipend: first(items.stipend, text(document, '.stipend'), fact('Stipend')),
        duration: first(items.duration, fact('Duration')),
        deadline: first(items['apply by'], fact('Apply by')),
        description: first(description('.text-container'), description('.internship_details'), description('.detail_view')),
        skills: texts(document, '.round_tabs_container .round_tabs, .skills_heading + .round_tabs_container .round_tabs'),
        url: location.href,
        isDetail: true,
      };
    },
  };

  // ---------- LinkedIn ----------
  const linkedinId = () => location.pathname.match(/(\d{6,})\/?$/)?.[1] || new URLSearchParams(location.search).get('currentJobId');
  const linkedin = {
    list() {
      // signed-out search results
      const guest = [...document.querySelectorAll('.base-card[data-entity-urn], .job-search-card')].map((card) => {
        const a = card.querySelector('a.base-card__full-link');
        return {
          title: first(text(card, '.base-search-card__title'), text(card, '.sr-only')),
          company: text(card, '.base-search-card__subtitle'),
          location: text(card, '.job-search-card__location'),
          posted: text(card, 'time'),
          url: a ? a.href : '',
          isDetail: false,
        };
      });
      // signed-in search results (selectors tied to LinkedIn's current logged-in markup)
      const member = [...document.querySelectorAll('li[data-occludable-job-id], .job-card-container[data-job-id]')].map((card) => {
        const id = card.getAttribute('data-occludable-job-id') || card.getAttribute('data-job-id') || card.querySelector('[data-job-id]')?.getAttribute('data-job-id');
        return {
          title: first(text(card, '.job-card-list__title--link, .job-card-list__title, a.job-card-container__link')),
          company: first(text(card, '.artdeco-entity-lockup__subtitle'), text(card, '.job-card-container__primary-description')),
          location: first(text(card, '.job-card-container__metadata-wrapper li, .job-card-container__metadata-item'), text(card, '.artdeco-entity-lockup__caption')),
          url: id ? `https://www.linkedin.com/jobs/view/${id}/` : '',
          isDetail: false,
        };
      });
      const known = [...guest, ...member].filter((r) => r.title && r.url);
      if (known.length) return known;
      // Signed-in LinkedIn uses scrambled class names that change often — but every job card still links to
      // /jobs/view/<id> or carries currentJobId=<id>. Read the cards from those links.
      return cardsFromLinks(/\/jobs\/view\/(?:[^/?#]*-)?\d{6,}|[?&]currentJobId=\d{6,}/, () => 'job', (href) => {
        const id = href.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/)?.[1] || href.match(/[?&]currentJobId=(\d{6,})/)?.[1];
        return id ? `https://www.linkedin.com/jobs/view/${id}/` : abs(href);
      });
    },
    detail() {
      const id = linkedinId();
      if (!id || !/\/jobs\//.test(location.pathname)) return null;
      const title = first(text(document, '.job-details-jobs-unified-top-card__job-title'), text(document, '.jobs-unified-top-card__job-title'), text(document, 'h1'));
      if (!title) return null;
      return {
        title,
        company: first(text(document, '.job-details-jobs-unified-top-card__company-name'), text(document, '.jobs-unified-top-card__company-name')),
        location: first(text(document, '.job-details-jobs-unified-top-card__primary-description-container .tvm__text'), text(document, '.jobs-unified-top-card__bullet')),
        description: first(description('#job-details'), description('.jobs-description__content')),
        url: `https://www.linkedin.com/jobs/view/${id}/`,
        isDetail: true,
      };
    },
  };

  // ---------- Naukri ----------
  const naukri = {
    list() {
      return [...document.querySelectorAll('.srp-jobtuple-wrapper')]
        .map((card) => {
          const a = card.querySelector('a.title');
          if (!a) return null;
          return {
            title: clean(a.textContent),
            company: text(card, 'a.comp-name'),
            location: first(text(card, '.locWdth'), text(card, '.loc-wrap span')),
            stipend: first(text(card, '.ni-job-tuple-icon-srp-rupee span'), text(card, '.sal-wrap span')),
            duration: text(card, '.ni-job-tuple-icon-srp-duration span'),
            posted: text(card, '.job-post-day'),
            skills: texts(card, '.tags-gt li'),
            url: abs(a.getAttribute('href')),
            isDetail: false,
          };
        })
        .filter(Boolean);
    },
  };

  // ---------- Indeed ----------
  const indeed = {
    list() {
      return [...document.querySelectorAll('.job_seen_beacon')]
        .map((card) => {
          const a = card.querySelector('a.jcs-JobTitle[data-jk], a[data-jk]');
          const jk = a?.getAttribute('data-jk');
          if (!jk) return null;
          const t = card.innerText;
          return {
            title: first(text(card, 'a.jcs-JobTitle span[title]'), text(card, 'a.jcs-JobTitle'), text(card, 'h2.jobTitle')),
            company: first(text(card, '[data-testid="company-name"]'), text(card, '.companyName')),
            location: first(text(card, '[data-testid="text-location"]'), text(card, '.companyLocation')),
            stipend: first(text(card, '[data-testid="attribute_snippet_testid"]'), text(card, '.salary-snippet-container'), (t.match(/[₹$£€][\d,.\s]+(?:[-–][^\n]*?)?(?:a|per) (?:month|year|hour|week)/i) || [])[0]),
            url: `${location.origin}/viewjob?jk=${jk}`,
            isDetail: false,
          };
        })
        .filter(Boolean);
    },
  };

  // ---------- Unstop ----------
  const unstopKind = (href) => (/\/(competitions|hackathons|quiz|quizzes|workshops-webinars|scholarships|conferences)\b/.test(href) ? 'opportunity' : 'job');
  /**
   * Layout-independent fallback: any link to an opportunity page, read from the card text around it.
   * Used when a site's usual card markup isn't there (e.g. a logged-in or redesigned layout).
   */
  function cardsFromLinks(hrefPattern, kindOf, urlOf = (href) => abs(href).split('?')[0]) {
    const seen = new Set();
    const out = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      if (!hrefPattern.test(href)) continue;
      const url = urlOf(href);
      if (seen.has(url)) continue;
      // climb to the card: the nearest ancestor that holds a few lines of text
      let card = a;
      for (let i = 0; i < 5 && card.parentElement && (card.innerText || '').split('\n').filter((l) => l.trim()).length < 3; i++) card = card.parentElement;
      const lines = (card.innerText || '').split('\n').map(clean).filter(Boolean);
      // LinkedIn puts the title in a link twice (visible copy + a screen-reader copy) — take the visible one
      const anchorText = clean(a.querySelector('[aria-hidden="true"]')?.textContent || (a.innerText || a.textContent || '').split('\n').map(clean).find(Boolean) || '').replace(/\s+with verification$/i, '');
      const title = first(text(card, 'h1, h2, h3, h4'), anchorText.length > 3 && anchorText.length < 120 ? anchorText : '', lines[0]).replace(/\s+with verification$/i, '');
      if (!title || title.length > 140 || /^(see|show) (all|more)/i.test(title)) continue;
      seen.add(url);
      const body = lines.join('\n');
      // the company is the first line after the title that isn't the title repeated (screen-reader copies, badges)
      const after = lines.slice(Math.max(0, lines.findIndex((l) => l.startsWith(title))) + 1);
      const company = after.find((l) => !l.startsWith(title) && !title.startsWith(l) && l.length < 90 && !/^(promoted|actively|easy apply|viewed|be an early|\d+ (applicants|benefits?)|·)/i.test(l)) || '';
      const placeLine = lines.find((l) => /\((on-site|remote|hybrid)\)|work from home|\bremote\b|in[- ]office/i.test(l)) || '';
      out.push({
        title,
        company,
        location: placeLine.length < 80 ? placeLine : (body.match(/\b(work from home|remote|hybrid|in[- ]office)\b/i) || [])[0] || '',
        stipend: (body.match(/(?:₹|rs\.?|inr)\s?[\d.,]+\s?k?(?:\s*[-–]\s*(?:₹|rs\.?)?\s?[\d.,]+\s?k?)?\s*\/?\s*(?:month|mo|year|week)?|\bunpaid\b/i) || [])[0] || '',
        posted: (body.match(/posted[^\n]{0,25}/i) || [])[0] || '',
        deadline: (body.match(/\d+\s*(?:days?|hours?)\s*left/i) || [])[0] || '',
        url,
        kind: kindOf(href),
        isDetail: false,
      });
    }
    return out;
  }

  const unstop = {
    list() {
      const cards = [...document.querySelectorAll('app-competition-listing a.item')]
        .map((a) => {
          const tags = texts(a, '.un_tag label, .tag-text');
          return {
            title: first(text(a, 'h3'), text(a, 'h2')),
            company: text(a, 'p.single-wrap'),
            location: text(a, '.job_location'),
            stipend: (a.innerText.match(/(?:₹|rs\.?)\s?[\d.,]+\s?k?(?:\s*[-–]\s*(?:₹|rs\.?)?\s?[\d.,]+\s?k?)?\s*\/?\s*(?:month|year)?|\bunpaid\b/i) || [])[0] || '',
            posted: tags.find((t) => /posted/i.test(t)),
            deadline: tags.find((t) => /left|day|hour/i.test(t) && !/posted/i.test(t)),
            url: abs(a.getAttribute('href')),
            kind: unstopKind(a.getAttribute('href') || ''),
            isDetail: false,
          };
        })
        .filter((r) => r.title && r.url);
      // the usual card markup is missing (logged-in or redesigned page) → read the opportunity links instead
      return cards.length ? cards : cardsFromLinks(/\/(internships?|jobs?|competitions|hackathons)\/[^/?#]+-\d{4,}/, unstopKind);
    },
  };

  // ---------- Work at a Startup (YC) ----------
  // Every job is a link to /jobs/<id>, shown in one of three layouts: a card that IS the link (company, tagline,
  // title, then "Full-time · US / Remote · $148K - $190K"), a company page's links (title + that line), or a card
  // with a separate "View job" button (title, where, then "Contract • Visa not required • $70K - $85K"). The one
  // thing all three share is the "<type> · <place> · <pay>" line, so jobs are found from it, not from class names.
  const YC_TYPE = /^(full[- ]?time|part[- ]?time|contract|intern(ship)?|co-?op)\b/i;
  const YC_BUTTON = /^(view job|view|apply|apply now|see job|see all \d+ jobs?)\s*[›>]?$/i;
  const ycLines = (el) => (el.innerText || '').split('\n').map(clean).filter((l) => l && !YC_BUTTON.test(l));
  const ycMetaIndex = (lines) => lines.findIndex((l) => YC_TYPE.test(l) && /\s[·•]\s/.test(l));
  // first line of a company link, without the batch tag ("Pesto (W21)", "Pesto · W21")
  const ycName = (a) => clean((a.innerText || a.textContent || '').split('\n')[0]).replace(/\s*[·(]\s*[SWFX]\d{2}\)?.*$/, '');
  // the nearest company link (/companies/<slug>, not "see all jobs" or "apply") at or above this block
  const ycCompanyFor = (block) => {
    for (let el = block, i = 0; el && i < 8; el = el.parentElement, i++) {
      const link = [...el.querySelectorAll('a[href]')].find((x) => /^\/companies\/[^/?#]+\/?$/.test(x.getAttribute('href')) && ycName(x).length > 1);
      if (link) return ycName(link);
    }
    return '';
  };
  const yc = {
    list() {
      const seen = new Set();
      const out = [];
      const pageCompany = clean(document.querySelector('h1')?.textContent).replace(/\s*[·(]\s*[SWFX]\d{2}\)?.*$/, '');
      const onCompanyPage = /^\/companies\//.test(location.pathname);
      for (const a of document.querySelectorAll('a[href]')) {
        const id = (a.getAttribute('href') || '').match(/^(?:https?:\/\/(?:www\.)?workatastartup\.com)?\/jobs\/(\d+)/)?.[1];
        if (!id || seen.has(id)) continue;
        // the smallest block around the link that contains the "<type> · …" line
        let block = a;
        let lines = ycLines(block);
        for (let i = 0; i < 6 && ycMetaIndex(lines) < 0 && block.parentElement; i++) {
          block = block.parentElement;
          lines = ycLines(block);
        }
        const m = ycMetaIndex(lines);
        if (m < 1) continue;
        seen.add(id);
        const anchorIsCard = ycMetaIndex(ycLines(a)) >= 0;
        // card that is the link: [company, tagline?, title, meta]; otherwise the block starts with the title
        const title = anchorIsCard ? lines[m - 1] : lines[0];
        const company = anchorIsCard && m >= 2 ? lines[0] : (onCompanyPage ? pageCompany : '') || ycCompanyFor(block) || ycCompanyFor(document.body);
        const parts = lines[m].split(/\s[·•]\s/).map(clean);
        const stipend = parts.find((p) => /[$₹€£]|equity/i.test(p)) || '';
        const placeBetween = anchorIsCard ? '' : lines.slice(1, m).join(' / ');
        const place = placeBetween || parts.find((p, i) => i > 0 && p !== stipend && !/visa|citizen|years?\b/i.test(p)) || '';
        out.push({
          title,
          company,
          location: place.slice(0, 120),
          stipend,
          employmentType: parts[0],
          url: abs(`/jobs/${id}`),
          isDetail: false,
        });
      }
      return out;
    },
    detail() {
      if (!/^\/jobs\/\d+/.test(location.pathname)) return null;
      const title = first(text(document, 'h1'), meta('og:title').split(' at ')[0]);
      if (!title) return null;
      const company = clean(document.querySelector('a[href^="/companies/"]')?.textContent).replace(/\s*\([SW]\d{2}\)\s*$/, '');
      return {
        title,
        company,
        location: fact('Location') || fact('Locations'),
        description: bodyText().slice(0, 6000),
        url: location.href.split('?')[0],
        isDetail: true,
      };
    },
  };

  // ---------- Y Combinator jobs (ycombinator.com/jobs) ----------
  // Card: company link (name "(S21)" • tagline (x ago)) · job link /companies/<co>/jobs/<id>-<title> · meta row
  // (type • category • … • salary • location). YC salaries are annual.
  // (separate from the Work at a Startup reader above: different site, different link format)
  const YC_JOB = /\/companies\/[^/]+\/jobs\/[^/?#]+/;
  const ycJobs = {
    list() {
      return [...document.querySelectorAll('a[href*="/jobs/"]')]
        .filter((a) => YC_JOB.test(a.getAttribute('href') || ''))
        .map((a) => {
          const card = a.parentElement;
          const companyLink = card?.querySelector('a[href^="/companies/"]:not([href*="/jobs/"])');
          const meta = [...(a.nextElementSibling?.children || [])].map((d) => clean(d.textContent)).filter((t) => t && t !== '•');
          const salary = meta.find((t) => /[$₹€£]\s?\d|\d+\s?k\b/i.test(t)) || '';
          const location = meta.length > 1 ? meta[meta.length - 1] : '';
          return {
            title: clean(a.textContent),
            company: clean(companyLink?.querySelector('span')?.textContent).replace(/\s*\([A-Z]\d{2}\)$/, ''), // drop the batch, e.g. "(S21)"
            location,
            remote: /remote/i.test(location),
            stipend: salary && !/year|month|hour|week/i.test(salary) ? `${salary} a year` : salary,
            employmentType: meta.find((t) => /full-time|part-time|intern|contract/i.test(t)) || '',
            posted: (companyLink?.textContent.match(/\(([^)]*ago)\)/) || [])[1] || '',
            url: abs(a.getAttribute('href')),
            isDetail: false,
          };
        })
        .filter((r) => r.title && r.url);
    },
    detail() {
      if (!YC_JOB.test(location.pathname)) return null;
      const title = text(document, 'h1');
      if (!title) return null;
      return {
        title,
        company: clean(document.querySelector('a[href^="/companies/"]:not([href*="/jobs/"]) span, a[href^="/companies/"]:not([href*="/jobs/"])')?.textContent).replace(/\s*\([A-Z]\d{2}\)$/, ''),
        description: first(description('.prose'), description('main')),
        url: location.href.split('?')[0],
        isDetail: true,
      };
    },
  };

  // ---------- ATS boards ----------
  const greenhouse = {
    list() {
      const company = (document.title.match(/Jobs at (.+)/) || [])[1] || text(document, '.company-name');
      return [...document.querySelectorAll('tr.job-post a, .opening a')]
        .map((a) => ({ title: first(text(a, 'p.body--medium'), clean(a.childNodes[0]?.textContent)), company, location: text(a, 'p.body__secondary, .location'), url: a.href, isDetail: false }))
        .filter((r) => r.title && r.url);
    },
    detail() {
      if (!/\/jobs\/\d+/.test(location.pathname)) return null;
      const company = (document.title.match(/at (.+)$/) || document.title.match(/Jobs at (.+)/) || [])[1] || '';
      return {
        title: first(text(document, 'h1')),
        company,
        location: first(text(document, '.job__location'), text(document, '.location')),
        description: first(description('.job__description'), description('#content'), description('main')),
        url: location.href,
        isDetail: true,
      };
    },
  };

  const lever = {
    list() {
      const company = clean(document.querySelector('.main-header-logo img')?.alt) || (document.title.split(' - ')[0] || '');
      return [...document.querySelectorAll('.posting')]
        .map((p) => ({ title: text(p, 'h5[data-qa="posting-name"], h5'), company, location: text(p, '.posting-categories .location, .sort-by-location'), url: p.querySelector('a.posting-title')?.href, isDetail: false }))
        .filter((r) => r.title && r.url);
    },
    detail() {
      if (!document.querySelector('.posting-headline')) return null;
      return {
        title: text(document, '.posting-headline h2'),
        company: clean(document.querySelector('.main-header-logo img')?.alt) || (document.title.split(' - ')[0] || ''),
        location: text(document, '.posting-categories .location'),
        description: first(description('.section-wrapper.page-full-width'), description('.content')),
        url: location.href,
        isDetail: true,
      };
    },
  };

  const workday = {
    detail() {
      const title = text(document, '[data-automation-id="jobPostingHeader"]');
      if (!title) return null;
      return {
        title,
        company: first(meta('og:site_name'), document.title.split(' - ').pop()),
        location: text(document, '[data-automation-id="locations"]'),
        description: description('[data-automation-id="jobPostingDescription"]'),
        url: location.href,
        isDetail: true,
      };
    },
  };

  // ---------- hackathons / fellowships / competitions ----------
  const OPPORTUNITY = /(devfolio\.co\/(hackathons|\w+-\w+)|unstop\.com\/(hackathons|competitions|quiz)|kaggle\.com\/(competitions|c\/)|mlh\.io|hackerearth\.com\/challenges|lablab\.ai\/event|summerofcode\.withgoogle\.com|hack2skill\.com)/i;
  const opportunity = {
    detail() {
      const title = first(text(document, 'h1'), meta('og:title'));
      if (!title) return null;
      return {
        kind: 'opportunity',
        title,
        company: first(meta('og:site_name'), location.hostname.replace(/^www\./, '')),
        description: first(meta('og:description'), meta('description')) + '\n' + bodyText().slice(0, 3000),
        deadline: deadlineFromText(),
        url: location.href,
        isDetail: true,
      };
    },
  };

  // ---------- picking the adapter for this page ----------
  function forPage() {
    const host = location.hostname.replace(/^www\./, '');
    const full = host + location.pathname;
    if (/(^|\.)internshala\.com$/.test(host)) return internshala;
    // any LinkedIn page: /jobs/, /internships/, a company's jobs tab… (the link-based reader finds job cards anywhere)
    if (/(^|\.)linkedin\.com$/.test(host)) return linkedin;
    if (/(^|\.)naukri\.com$/.test(host)) return naukri;
    if (/(^|\.)indeed\./.test(host)) return indeed;
    if (/(^|\.)unstop\.com$/.test(host)) return OPPORTUNITY.test(full) ? { list: unstop.list, detail: opportunity.detail } : unstop;
    if (/(^|\.)workatastartup\.com$/.test(host)) return yc;
    if (/(^|\.)ycombinator\.com$/.test(host)) return ycJobs;
    if (/greenhouse\.io$/.test(host)) return greenhouse;
    if (/(^|\.)lever\.co$/.test(host)) return lever;
    if (/myworkdayjobs\.com$/.test(host)) return workday;
    if (OPPORTUNITY.test(full)) return opportunity;
    return null;
  }

  window.TwiggAdapters = { forPage };
})();
