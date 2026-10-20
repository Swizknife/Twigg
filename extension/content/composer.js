// Puts a drafted post into LinkedIn's "Start a post" box. Injected on demand when you press Insert.
//
// It ONLY types the text into the box. It never clicks "Post" — you read the draft and press Post yourself.
// LinkedIn changes its markup often; if the box can't be found Twigg falls back to the clipboard.

(() => {
  // No "already loaded" check: after Twigg is reloaded, an OLDER copy of this script can still live in tabs that
  // were open, and skipping would leave that old code running. Defining again simply replaces it.

  const EDITORS = [
    'div.ql-editor[contenteditable="true"]',
    '.share-creation-state__text-editor [contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"][aria-label*="Text editor" i]',
    'div[role="textbox"][contenteditable="true"][aria-label*="post" i]',
  ];
  const TRIGGERS = ['button.share-box-feed-entry__trigger', 'button[aria-label*="Start a post" i]', '.share-box-feed-entry__trigger'];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const findEditor = () => EDITORS.flatMap((s) => [...document.querySelectorAll(s)]).find(visible) || null;

  function findTrigger() {
    for (const s of TRIGGERS) {
      const el = [...document.querySelectorAll(s)].find(visible);
      if (el) return el;
    }
    return [...document.querySelectorAll('button')].find((b) => /^start a post$/i.test(b.textContent.trim()) && visible(b)) || null;
  }

  function typeInto(editor, text) {
    editor.focus();
    // 1) a paste event — rich editors (Quill) turn this into proper paragraphs
    const data = new DataTransfer();
    data.setData('text/plain', text);
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    if (editor.innerText.trim().length >= Math.min(20, text.length)) return true;
    // 2) plain insertion
    editor.focus();
    document.execCommand('insertText', false, text);
    return editor.innerText.trim().length >= Math.min(20, text.length);
  }

  async function insert(text) {
    let editor = findEditor();
    if (!editor) {
      const trigger = findTrigger();
      if (!trigger) return { ok: false, reason: 'composer-not-found' };
      trigger.click(); // opens the empty post box — same as you clicking "Start a post"
      for (let i = 0; i < 40 && !editor; i++) {
        await sleep(250);
        editor = findEditor();
      }
    }
    if (!editor) return { ok: false, reason: 'composer-not-found' };
    if (editor.innerText.replace(/\s/g, '').length > 0) return { ok: false, reason: 'composer-not-empty' }; // never overwrite your own draft
    return typeInto(editor, text) ? { ok: true } : { ok: false, reason: 'insert-failed' };
  }

  window.TwiggComposer = { insert };
})();
