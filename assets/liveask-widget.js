// Ask PromptWorkx — live panel, wired to the Cloudflare Worker.
//
// Consolidated 24 August 2026 from three near-identical inline copies
// (index.html, /liveask, /ai-tips) into this one shared file, included via
// <script src="/assets/liveask-widget.js"> on all three pages. Two real
// things prompted this, not just tidiness:
//
// 1. The three copies had already started drifting — the responsive
//    setFinalPlaceholder() fix existed on the two subpage copies but was
//    missing from home's, silently out of sync. One shared file means one
//    fix lands everywhere at once, not "did we remember to also patch home."
//
// 2. Site-wide session persistence (see SESSION_KEY / saveSession /
//    loadSession / replaySession below) — until now, every single page
//    navigation on the site, for every visitor, silently reset the
//    conversation to zero (a fresh sessionId was minted client-side on
//    every load, nothing was ever persisted). That's not a Guided-Tour-only
//    problem — any ordinary visitor clicking from the homepage to /ai-tips
//    lost their conversation too. This fixes it for everyone, and the
//    upcoming Custom AI Tours page-hop action reuses this same mechanism
//    rather than needing its own bespoke plumbing.
(function(){
  const prompts = [
    "Ask PromptWorkx AI",
    "Am I visible to ChatGPT?",
    "What's the difference between SEO and GEO?",
    "Does Google AI know who I am?",
    "Why did a competitor show up instead of me?"
  ];
  let i = 0;
  const ph = document.getElementById('askPlaceholder');
  const input = document.getElementById('askInput');
  const thread = document.getElementById('askThread');
  const askPanel = document.getElementById('ask-panel');

  // The final "Ask another question..." placeholder needs genuinely
  // different content per viewport, not just different CSS wrapping —
  // desktop wants one flat line, mobile wants three specific manual
  // breaks. Checked at the moment it's shown, not baked into one string.
  function setFinalPlaceholder(){
    ph.classList.add('ask-fake-placeholder--final');
    if (window.matchMedia('(min-width: 1024px)').matches) {
      ph.textContent = 'Ask another question, or get PromptWorkx to contact you';
    } else {
      ph.innerHTML = 'Ask another question<br>or get PromptWorkx<br>to contact you';
    }
  }

  // Sticky panel — pinned via CSS (position:sticky). The panel and its
  // response thread stay fully visible at all times once a conversation's
  // active — the page content scrolls past the panel, not the other way
  // around. Only job here is the subtle "pinned" border cue once it's
  // actually stuck to the top, for a bit of visual feedback.
  window.addEventListener('scroll', function(){
    askPanel.classList.toggle('pinned', window.scrollY > 4);
  }, { passive: true });
  let rotateFadeTimeout = null;
  let rotateTimer = null;
  function startRotation(){
    rotateTimer = setInterval(function(){
      ph.classList.add('fade');
      rotateFadeTimeout = setTimeout(function(){
        i = (i + 1) % prompts.length;
        ph.textContent = prompts[i];
        ph.classList.remove('fade');
      }, 600);
    }, 8000);
  }

  function pauseRotation(){
    ph.classList.add('fade');
  }
  // Real bug fix, 7 August 2026: the placeholder previously only faded on
  // typing or submit — simply clicking into the empty field left it fully
  // visible, cluttering the real native caret rendering right on top of it.
  // 7 August 2026, later: the panel now auto-focuses on page load so the
  // real cursor is blinking immediately, not only after a tap. That first,
  // script-triggered focus must NOT fade the placeholder (visitors should
  // still see the rotating prompt suggestions) — only a genuine user tap
  // should trigger the fade. autoFocusPending tracks that distinction.
  let autoFocusPending = true;
  input.addEventListener('focus', function(){
    if (autoFocusPending) {
      autoFocusPending = false;
    } else {
      // Real bug fix, 7 August 2026: this was previously outside the
      // if/else, so it fired on the very first auto-triggered landing
      // focus too — killing rotation before it ever got to cycle even
      // once, freezing the placeholder on its first static prompt. Moved
      // here so only a genuine subsequent tap (or the post-submit refocus,
      // which is itself gated by autoFocusPending) stops it.
      pauseRotation();
      clearInterval(rotateTimer); rotateTimer = null;
      clearTimeout(rotateFadeTimeout);
    }
  });
  input.addEventListener('blur', function(){
    if (input.value.length === 0) {
      ph.classList.remove('fade');
    }
  });
  // Auto-focus on landing so the real cursor blinks immediately. Note: some
  // mobile browsers (notably iOS Safari) restrict or ignore programmatic
  // focus without a genuine user gesture first — this may not reliably open
  // the keyboard or show a caret on every device. Worth confirming on real
  // hardware, not assuming universal behaviour.
  window.addEventListener('load', function(){
    input.blur();
    requestAnimationFrame(function(){
      input.focus({ preventScroll: true }); // real paint gap before refocus — back-to-back blur/focus can get coalesced by the browser with no gap between them
    });
  });
  function autoGrow(){
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
  }
  input.addEventListener('input', function(){
    ph.classList.toggle('fade', input.value.length > 0);
    // Real bug fix, 7 August 2026: rotation-stop only ever lived inside the
    // 'focus' event handler — but clicking into an ALREADY-focused element
    // (which it is, after page-load autofocus) never fires a new focus
    // event at all. So typing directly after landing never stopped
    // rotation, even though it looked like it should. The 'input' event
    // fires on every real keystroke regardless of focus history — the
    // actually reliable signal for "user is genuinely typing."
    clearInterval(rotateTimer); rotateTimer = null;
    clearTimeout(rotateFadeTimeout);
    autoGrow();
  });

  const WORKER_URL = 'https://ask-promptworkx.chriscarroll-promptworkx.workers.dev';

  // ---- Cross-page session persistence (added 24 August 2026, alongside
  // this file's consolidation) ----
  // sessionStorage is per-tab, per-origin, and survives a real page
  // navigation but not a closed tab or a fresh one — exactly the lifetime
  // wanted here: the same visitor moving between promptworkx.com pages in
  // one sitting keeps talking to the same AI with the same history; a new
  // tab or a later visit starts clean, same as today.
  const SESSION_KEY = 'liveask_session_v1';
  function loadSession(){
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.sessionId !== 'string' || !Array.isArray(parsed.conversationHistory)) return null;
      return parsed;
    } catch (e) {
      return null; // corrupt/unavailable storage — fall back to a fresh session, never throw
    }
  }
  function saveSession(){
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ sessionId: sessionId, conversationHistory: conversationHistory, tourToken: tourToken }));
    } catch (e) {
      // Storage unavailable or full (private-browsing modes, quota) — the
      // conversation still works fine for this page, it just won't survive
      // a navigation. Fail silent rather than break the chat over it.
    }
  }

  const restoredSession = loadSession();

  // ---- Custom AI Tours: guest entry (added 24 August 2026) ----
  // A tour link always carries ?tour=<token> (see TOUR_DESTINATIONS /
  // handleTourCreate in index-worker.js — the guest link is literally
  // `${ALLOWED_ORIGIN}/?tour=<token>`). If this URL's token doesn't match
  // whatever tour token (if any) this same browser tab already had stored,
  // treat it as a brand new tour visit and start completely fresh — a tour
  // guest should never have an unrelated earlier conversation in this tab
  // silently merged into their tour.
  const urlTourToken = new URLSearchParams(window.location.search).get('tour');
  const isFreshTourEntry = !!urlTourToken && (!restoredSession || restoredSession.tourToken !== urlTourToken);

  let sessionId, conversationHistory, tourToken;
  if (isFreshTourEntry) {
    sessionId = 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    conversationHistory = [];
    tourToken = urlTourToken;
  } else {
    sessionId = (restoredSession && restoredSession.sessionId) || ('web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    conversationHistory = (restoredSession && restoredSession.conversationHistory) || [];
    tourToken = (restoredSession && restoredSession.tourToken) || null;
  }

  // Rebuilds the visible thread from a restored conversationHistory after a
  // same-tab page navigation, so arriving on the new page shows the
  // conversation continuing rather than looking like it vanished. Never
  // auto-scrolls the visitor's viewport to do this — the panel is sticky
  // near the top already, and forcing the page to jump on an ordinary nav
  // click (no consent given, unlike a Guided Tour's explicit "Shall we
  // start?") would be exactly the kind of unannounced page movement worth
  // avoiding.
  function replaySession(){
    conversationHistory.forEach(function(m){
      if (m.role === 'user') {
        const v = document.createElement('div');
        v.className = 'ask-msg visitor';
        v.innerHTML = '<span class="who">You</span><p></p>';
        v.querySelector('p').textContent = m.content;
        thread.appendChild(v);
      } else if (m.role === 'assistant') {
        const a = document.createElement('div');
        a.className = 'ask-msg ai';
        a.innerHTML = '<span class="who">PROMPTWORKX LIVEASK AI</span><p></p>';
        a.querySelector('p').textContent = m.content;
        thread.appendChild(a);
      }
    });
    thread.classList.add('active');
    document.querySelector('.ask-box').classList.add('expanded');
    clearInterval(rotateTimer); rotateTimer = null;
    clearTimeout(rotateFadeTimeout);
    setFinalPlaceholder();
    ph.classList.remove('fade');
    thread.scrollTop = thread.scrollHeight;
  }

  // ---- Custom AI Tours: guest-side action dispatcher (added 24 August
  // 2026) ----
  // Approved semantic destination names -> real on-page targets. Keep this
  // in sync with TOUR_DESTINATIONS in index-worker.js — the Worker only
  // ever sends a semantic name (e.g. "LIVEASK_SECTION"), never a raw
  // selector, so a destination added there needs a matching entry here
  // before it can actually move anyone's page.
  const TOUR_DESTINATION_SELECTORS = {
    LIVEASK_SECTION: '#liveask-pillar',
    GENSEEN_SECTION: '#genseen-pillar',
    ABOUT_SECTION: '#about'
  };

  // Executes the Worker's GO_TO action — smooth-scrolls to the destination
  // and gives it a brief highlight so it's obvious to the guest why the
  // page just moved. Plain inline styles rather than a CSS class, so this
  // stays fully self-contained in this one file rather than needing a
  // matching class added to every page's stylesheet. Fails completely
  // silently on an unknown destination name or a page that doesn't have
  // that element (e.g. GO_TO firing while the guest is somewhere the
  // target genuinely isn't present) — never breaks the reply that came
  // with it.
  function handleTourAction(action){
    if (!action || action.type !== 'GO_TO') return;
    const selector = TOUR_DESTINATION_SELECTORS[action.target];
    if (!selector) return;
    const el = document.querySelector(selector);
    if (!el) return;
    // Real live-test find (24 August 2026): the ask panel is pinned
    // (position: sticky) at the top of the viewport at all times — a plain
    // scrollIntoView({block:'start'}) aligns the destination's top edge
    // with the viewport's top edge, which is exactly where the panel
    // already sits, so the destination lands hidden behind it. Read the
    // panel's own CURRENT rendered height (varies by viewport width and
    // whether it's expanded) rather than a fixed guess, and scroll to just
    // below it with a little breathing room.
    const panelHeight = askPanel.getBoundingClientRect().height;
    const targetTop = el.getBoundingClientRect().top + window.scrollY - panelHeight - 16;
    window.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    const prev = { transition: el.style.transition, outline: el.style.outline, outlineOffset: el.style.outlineOffset };
    el.style.transition = 'outline-color 0.3s ease';
    el.style.outline = '3px solid #1e6fd9';
    el.style.outlineOffset = '4px';
    setTimeout(function(){
      el.style.outline = prev.outline;
      el.style.outlineOffset = prev.outlineOffset;
      el.style.transition = prev.transition;
    }, 2600);
  }

  // A tour guest's very first load: no conversation to replay yet, and the
  // ordinary rotating placeholder ("Ask PromptWorkx AI" / "Am I visible to
  // ChatGPT?" etc.) makes no sense for someone who arrived via a tour link,
  // not organically — fetch and show the fixed greeting instead (see
  // buildTourGreeting in index-worker.js). No Claude call happens for this
  // specific request; the Worker returns the greeting immediately.
  function beginTourEntry(){
    document.querySelector('.ask-box').classList.add('expanded');
    thread.classList.add('active');
    clearInterval(rotateTimer); rotateTimer = null;
    clearTimeout(rotateFadeTimeout);
    setFinalPlaceholder();
    ph.classList.remove('fade');

    const thinking = document.createElement('p');
    thinking.className = 'ask-thinking';
    thinking.textContent = 'PromptWorkx is thinking…';
    thread.appendChild(thinking);
    thread.scrollTop = thread.scrollHeight;

    fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, messages: [], tourToken: tourToken })
    })
      .then(function(res){ return res.json(); })
      .then(function(data){
        thinking.remove();
        const replyText = data.reply || "Welcome! Something went wrong setting up your tour — try refreshing, or just ask a question below.";
        const showPrivacyNotice = isFirstAiReply();
        conversationHistory.push({ role: 'assistant', content: replyText });
        saveSession();
        const a = document.createElement('div');
        a.className = 'ask-msg ai';
        a.innerHTML = '<span class="who">PROMPTWORKX LIVEASK AI</span><p></p>';
        const replyP = a.querySelector('p');
        if (showPrivacyNotice) {
          a.insertBefore(buildPrivacyNoticeEl(), replyP);
        }
        replyP.textContent = replyText;
        thread.appendChild(a);
        thread.scrollTop = thread.scrollHeight;
        if (data.action) handleTourAction(data.action);
        autoFocusPending = true;
        input.blur();
        requestAnimationFrame(function(){
          input.focus({ preventScroll: true }); // real paint gap before refocus
        });
      })
      .catch(function(){
        thinking.remove();
        const a = document.createElement('div');
        a.className = 'ask-msg ai';
        a.innerHTML = '<span class="who">PROMPTWORKX LIVEASK AI</span><p></p>';
        a.querySelector('p').textContent = "That's taking longer than it should to load your tour — try refreshing, or just ask a question below.";
        thread.appendChild(a);
        thread.scrollTop = thread.scrollHeight;
      });
  }

  if (conversationHistory.length > 0) {
    replaySession();
  } else if (tourToken) {
    beginTourEntry();
  } else {
    startRotation();
  }

  // "About" nav-intent needs a different link target depending on which
  // page it's clicked from — "#about" when already on the homepage,
  // "/#about" (back to the homepage's section) from a subpage. Computed
  // once here instead of hardcoded per page copy, which is exactly the
  // kind of thing that silently drifts when duplicated (see file header).
  const ABOUT_HREF = (function(){
    const p = window.location.pathname;
    return (p === '/' || p === '/index.html') ? '#about' : '/#about';
  })();

  // "Close" button — 10 August 2026. Purely visual collapse: removes the
  // .expanded/.active classes that make the box tall and the thread
  // visible, but never touches thread.innerHTML or conversationHistory.
  // Both submitToPanel and the nav-intent handler already independently
  // re-add .expanded/.active on every new message — so the next message
  // (typed or another nav click) naturally re-expands the box with the
  // full prior history still sitting there underneath, untouched. The
  // only thing that actually clears any of this is a real page reload,
  // which resets the JS variables themselves — nothing in this button
  // does that.
  //
  // ---- Hide/reopen discoverability (added 24 August 2026, direct request
  // from Chris after live-testing found this a genuine gap) ----
  // Two small additions, both injected here as self-contained CSS/DOM
  // rather than edited into each page's own <style> block or markup, so
  // this stays a single-file change: a quiet hint next to the X while the
  // panel is open explaining what it does, and a small tab that appears
  // once the panel has actually been closed at least once, giving a
  // visible way back in. was-closed is deliberately never removed again
  // once set — that's fine, since it only ever matters in combination with
  // :not(.expanded), i.e. it only shows the tab while collapsed.
  const uxStyle = document.createElement('style');
  uxStyle.textContent = '.ask-close-hint{display:none;position:absolute;bottom:20px;right:46px;font:500 11px/1.2 inherit;color:#8a94a3;white-space:nowrap;pointer-events:none}'
    + '.ask-box.expanded .ask-close-hint{display:block}'
    + '.ask-reopen-tab{display:none;position:absolute;right:14px;bottom:-15px;background:#1e6fd9;color:#fff;font:600 12px/1 inherit;padding:7px 14px;border:none;border-radius:0 0 12px 12px;cursor:pointer;box-shadow:0 3px 8px rgba(0,0,0,.15);z-index:5}'
    + '.ask-reopen-tab:hover{background:#175bb5}'
    + '.ask-box.was-closed:not(.expanded) .ask-reopen-tab{display:block}';
  document.head.appendChild(uxStyle);

  const closeBtn = document.getElementById('askCloseBtn');
  const closeHint = document.createElement('span');
  closeHint.className = 'ask-close-hint';
  closeHint.textContent = 'You can hide this chat panel';
  closeBtn.insertAdjacentElement('beforebegin', closeHint);

  const reopenTab = document.createElement('button');
  reopenTab.type = 'button';
  reopenTab.className = 'ask-reopen-tab';
  reopenTab.textContent = 'Reopen chat';
  document.querySelector('.ask-box').appendChild(reopenTab);
  reopenTab.addEventListener('click', function(){
    document.querySelector('.ask-box').classList.add('expanded');
    if (conversationHistory.length > 0) thread.classList.add('active');
    autoFocusPending = true;
    input.blur();
    requestAnimationFrame(function(){
      input.focus({ preventScroll: true }); // real paint gap before refocus
    });
  });

  closeBtn.addEventListener('click', function(){
    document.querySelector('.ask-box').classList.remove('expanded');
    document.querySelector('.ask-box').classList.add('was-closed');
    thread.classList.remove('active');
  });

  // ---- JIT privacy/collection notice (added 23 August 2026, simplified
  // 23 August 2026) ----
  // Wording and the Privacy link are owned entirely here, front-end,
  // deterministic — never generated by the model (see
  // liveaskbehaviourexpectations doc, "Core implementation principle": this
  // is a governed interface behaviour, not something left to model
  // improvisation).
  // Originally shown only when the backend detected the AI was asking for
  // information (a model-emitted tag plus a regex fallback) — real testing
  // showed that detection miss in ways that were hard to fully close.
  // Simplified per Chris's observation (23 August 2026): this system's
  // design already guarantees every AI-generated reply ends by moving the
  // conversation forward with a question (system-prompt.js, "Never end a
  // reply as a dead end"), so there's no need to detect WHICH replies ask
  // for something — showing it unconditionally on the session's very first
  // AI-generated reply covers every real case, with zero dependency on
  // model behaviour or pattern-matching. See isFirstAiReply() below.
  function buildPrivacyNoticeEl(){
    const p = document.createElement('p');
    p.className = 'ask-privacynotice';
    p.appendChild(document.createTextNode("We'll use the details you provide to respond to your enquiry. Please don't share sensitive information. "));
    const link = document.createElement('a');
    link.href = '/privacy-index.html';
    link.textContent = 'Privacy';
    p.appendChild(link);
    return p;
  }

  // True until the first assistant turn has actually landed in
  // conversationHistory — must always be called BEFORE that turn is pushed,
  // in every call site, or it'll never see "no assistant turns yet". A
  // restored session with a prior assistant turn already in history
  // correctly makes this false from the start, so the notice never
  // re-shows after a page-hop — it already ran once, earlier in this same
  // browser tab's session.
  function isFirstAiReply(){
    return !conversationHistory.some(function(m){ return m.role === 'assistant'; });
  }

  // ---- Quick Replies (Customer 000 / GEO 4, added 24 August 2026) ----
  // Renders the model's offered closed-choice buttons (data.quickReplies —
  // see system-prompt.js "Guided (closed) questions — Quick Replies" and
  // Section 8). Distinct from NAV_INTENTS: a Quick Reply click is ordinary
  // conversational input, not a fixed opener — it goes back through the
  // exact same submitToPanel() path as if the visitor had typed the
  // button's own text, and can lead to a normal Claude reply (including
  // another round of Quick Replies, or none). Also distinct from Governed
  // Actions (lead capture, verification) — selecting a choice never itself
  // triggers a consequential action, only ordinary conversation input.
  function buildQuickRepliesEl(choices){
    const wrap = document.createElement('div');
    wrap.className = 'ask-quickreplies';
    choices.forEach(function(choice){
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ask-quickreply-btn';
      btn.textContent = choice;
      btn.addEventListener('click', function(){
        wrap.remove(); // one-shot — once answered, don't leave it clickable again
        submitToPanel(choice, { showVisitorBubble: true });
      });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  // Defensive client-side re-validation of data.quickReplies — the Worker
  // already validates strictly (system-prompt.js Section 8 / index-worker.js),
  // but never trust a network response blindly for something rendered as
  // clickable UI. Same fail-closed rule as the backend: anything invalid
  // here just means no Quick Reply row renders, never a broken one.
  function validQuickReplies(data){
    if (!Array.isArray(data.quickReplies)) return [];
    return data.quickReplies
      .filter(function(c){ return typeof c === 'string' && c.trim().length > 0 && c.trim().length <= 40; })
      .map(function(c){ return c.trim(); })
      .slice(0, 4);
  }

  // Shared core — both manual typing and nav-triggered prompts flow through
  // this single, already-tested path. `showVisitorBubble` controls whether
  // the actual prompt text renders as a "You" bubble (real typed messages)
  // or stays invisible behind a plain system note (nav clicks) — a nav click
  // should never look like the visitor typed words they didn't type.
  function submitToPanel(promptText, opts){
    opts = opts || {};
    pauseRotation();
    thread.classList.add('active');
    document.querySelector('.ask-box').classList.add('expanded');

    if(opts.systemNote){
      const note = document.createElement('div');
      note.className = 'ask-sysnote';
      note.textContent = opts.systemNote;
      thread.appendChild(note);
    }
    if(opts.showVisitorBubble !== false){
      const v = document.createElement('div');
      v.className = 'ask-msg visitor';
      v.innerHTML = '<span class="who">You</span><p></p>';
      v.querySelector('p').textContent = promptText;
      thread.appendChild(v);
    }

    clearInterval(rotateTimer); rotateTimer = null;
    clearTimeout(rotateFadeTimeout);
    setFinalPlaceholder();
    ph.classList.remove('fade');

    conversationHistory.push({ role: 'user', content: promptText });
    saveSession();

    const thinking = document.createElement('p');
    thinking.className = 'ask-thinking';
    thinking.textContent = 'PromptWorkx is thinking…';
    thread.appendChild(thinking);
    thread.scrollTop = thread.scrollHeight;
    // Real fix, 7 August 2026: this refocus previously ran BEFORE the
    // thinking-bubble append and scroll above — both real DOM mutations
    // that immediately undid it, so the cursor never actually stayed
    // visible long enough to be seen. Moved to after every synchronous
    // mutation in this function completes.
    autoFocusPending = true;
    input.blur();
    requestAnimationFrame(function(){
      input.focus({ preventScroll: true }); // real paint gap before refocus — back-to-back blur/focus can get coalesced by the browser with no gap between them
    });

    fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, messages: conversationHistory, tourToken: tourToken })
    })
      .then(function(res){ return res.json(); })
      .then(function(data){
        thinking.remove();
        const replyText = data.reply || "Something went wrong on my end — try again in a moment.";
        // Must be checked BEFORE this reply is pushed to conversationHistory
        // below — see isFirstAiReply().
        const showPrivacyNotice = isFirstAiReply();
        conversationHistory.push({ role: 'assistant', content: replyText });
        saveSession();
        const a = document.createElement('div');
        a.className = 'ask-msg ai';
        a.innerHTML = '<span class="who">PROMPTWORKX LIVEASK AI</span><p></p>';
        // Capture the reply <p> BEFORE inserting the notice paragraph — real
        // bug found in testing (23 August 2026): insertBefore adds a SECOND
        // <p>, so a querySelector('p') called afterward grabs whichever one
        // is now first in DOM order (the notice), not the reply — silently
        // overwriting the notice text and leaving the real reply empty.
        const replyP = a.querySelector('p');
        if (showPrivacyNotice) {
          a.insertBefore(buildPrivacyNoticeEl(), replyP);
        }
        replyP.textContent = replyText;
        const quickReplyChoices = validQuickReplies(data);
        if (quickReplyChoices.length > 0) {
          a.appendChild(buildQuickRepliesEl(quickReplyChoices));
        }
        thread.appendChild(a);
        thread.scrollTop = thread.scrollHeight;
        // Custom AI Tours: only ever present on a tour guest's turn, and
        // only on the specific turn the Worker's guest-state-machine
        // decided to fire it (see handleTourAction above and the guest
        // state machine in index-worker.js's fetch()) — undefined/absent
        // on every ordinary reply, so this is a no-op there.
        if (data.action) handleTourAction(data.action);
        // Real fix, 7 August 2026: the async reply lands well after the
        // earlier submit-time refocus, and appending it here is a real DOM
        // mutation that can reset the caret blink a second time — same
        // underlying browser behaviour as the rotation-text issue, just
        // triggered later in the flow. Refocus again once the reply is
        // actually in.
        autoFocusPending = true;
        input.blur();
        requestAnimationFrame(function(){
          input.focus({ preventScroll: true }); // real paint gap before refocus
        });
      })
      .catch(function(){
        thinking.remove();
        const a = document.createElement('div');
        a.className = 'ask-msg ai';
        a.innerHTML = '<span class="who">PROMPTWORKX LIVEASK AI</span><p></p>';
        a.querySelector('p').textContent = "That's taking longer than it should — try again, or jump straight to a door below.";
        thread.appendChild(a);
        thread.scrollTop = thread.scrollHeight;
        autoFocusPending = true;
        input.blur();
        requestAnimationFrame(function(){
          input.focus({ preventScroll: true }); // real paint gap before refocus
        });
      });
  }

  function send(){
    const q = input.value.trim();
    if(!q) return;
    input.value = '';
    input.style.height = 'auto';
    submitToPanel(q, { showVisitorBubble: true });
  }

  document.getElementById('askSend').addEventListener('click', send);
  input.addEventListener('keydown', function(e){ if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send(); } });

  // ---- SearchAction deep-link handler ----
  // Makes the WebSite/SearchAction schema entry genuinely functional, not
  // just decorative markup. When an AI engine constructs a URL like
  // https://promptworkx.com/?q=some+question#ask-panel from that schema,
  // this reads the query, scrolls to the panel, and submits it through the
  // exact same tested pipeline as if the visitor had typed it themselves —
  // same lead capture, same verification flow, nothing new to maintain.
  // "Generative AIs" term-explainer modal — 10 August 2026.
  // Converted from the mockup's inline onclick handlers to proper
  // addEventListener-based ones. Also added: click on the darkened
  // background (not the modal itself) closes it, and Escape closes it —
  // standard modal behaviour, not in the original mockup, added since
  // we'd just discussed keyboard/screen-reader accessibility directly.
  // Only home's markup currently has the trigger/modal elements — this
  // safely no-ops on the other pages via the guard below, which is why it's
  // fine for this shared file to always include it rather than needing a
  // per-page config flag.
  (function genAiModal(){
    const trigger = document.getElementById('genai-term-trigger');
    const modal = document.getElementById('genai-modal');
    const closeBtn = document.getElementById('genai-modal-close');
    if (!trigger || !modal || !closeBtn) return;

    function openModal(){ modal.classList.add('open'); }
    function closeModal(){ modal.classList.remove('open'); }

    trigger.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', function(e){
      if (e.target === modal) closeModal(); // clicked the scrim itself, not the card
    });
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
    });
  })();

  (function handleSearchActionDeepLink(){
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if(!q) return;
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, '', cleanUrl); // avoid re-submitting on refresh
    document.getElementById('ask-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function(){ submitToPanel(q, { showVisitorBubble: true }); }, 400);
  })();

  // ---- Legacy nav items ("Services", "About", "Contact") now trigger the
  // panel with FIXED, locked text — no AI interpretation of the opener at
  // all. These are consistent, agreed messages (see liveask scripting docs,
  // 31 July) — the model only takes over from the visitor's next reply
  // onward, using the normal tested flow (contact-capture, door ID, etc).
  const NAV_INTENTS = {
    services: {
      note: '→ You clicked Services',
      reply: "Our core services are:\n\nGenCheck — $300 · Our AI Visibility Audit to see what AI currently says about your business and exploring the plan to improve on that\nGenGrid — from $2,000 · Our AI Visibility Build: Comprehensive Structural work so AIs find and recommend you\nLiveAsk — from $2,000 · Your own custom AI guiding your site visitors and answering their questions about your business prompting them towards providing contact details in lieu of filling in a form\nPromptGuide — $900 · Your Custom AI Use Protocol. Safe AI practices and data rules for your team\nPromptSpec — $1,500 · An AI Opportunity Audit of your whole business. Full workflow review with a prioritised action plan\n\nWhich service do you want to find out more about?"
    },
    about: {
      note: "→ You clicked 'About'",
      reply: "PromptWorkx has a unique take on AI adoption. We believe in helping you grow and build your business, not just shave costs. Our strategy prioritizes Two Pillars:\n\n1. Get you seen\n2. Get you leads",
      linkText: "Click here for our full 'About' section",
      linkHref: ABOUT_HREF
    },
    contact: {
      note: '→ You clicked Contact',
      reply: "Thank you for requesting contact from us.\nMay we start with your name please?"
    },
    'book-audit': {
      note: '→ You clicked Book a GenCheck',
      reply: "I see you'd like to discuss your AI Visibility.\nThank you for enquiring, may I have your name and your business name please?"
    },
    'enquire-build': {
      note: '→ You clicked Enquire',
      reply: "Thank you for enquiring about GenGrid, may I have your name and business name please?"
    },
    'register-protocol': {
      note: '→ You clicked HELP ME WITH MY AI POLICY',
      reply: "I see you'd like to learn more about PromptGuide and developing a Custom AI Use Protocol.\nThank you for enquiring, may I have your name and business name please?"
    },
    'enquire-opportunity': {
      note: '→ You clicked Get an Assessment',
      reply: "I see you're interested in PromptSpec and exploring an AI roadmap for your organisation.\nThank you for enquiring, may I have your name and business name please?"
    }
  };
  // Whether the notice shows for a nav-intent opener (including "About",
  // which doesn't ask the visitor anything) is now decided purely by
  // isFirstAiReply() at the click handler below, same as every other AI
  // reply path — no per-entry flag needed any more.
  document.querySelectorAll('[data-nav-intent]').forEach(function(el){
    el.addEventListener('click', function(e){
      e.preventDefault();
      const cfg = NAV_INTENTS[el.getAttribute('data-nav-intent')];
      if(!cfg) return;
      document.getElementById('ask-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      pauseRotation();
      // Real bug fix, 7 August 2026: this handler's own refocus deliberately
      // sets autoFocusPending=true (to protect the "Ask another question..."
      // text from immediately re-fading) — but that also skips the focus
      // handler's clearInterval/clearTimeout, since both live in the same
      // branch. Rotation was NEVER actually stopping after a nav click like
      // Contact — it kept firing every 8s in the background indefinitely,
      // explaining both the text-ghosting and the cursor disruption. Made
      // unconditional here, not dependent on that shared branch at all.
      clearInterval(rotateTimer); rotateTimer = null;
      clearTimeout(rotateFadeTimeout);
      thread.classList.add('active');
      document.querySelector('.ask-box').classList.add('expanded');

      const note = document.createElement('div');
      note.className = 'ask-sysnote';
      note.textContent = cfg.note;
      thread.appendChild(note);

      const a = document.createElement('div');
      a.className = 'ask-msg ai';
      a.innerHTML = '<span class="who">PROMPTWORKX LIVEASK AI</span><p></p>';
      // Capture the reply <p> BEFORE inserting the notice — see the matching
      // comment in submitToPanel's success handler above for why. Must be
      // checked BEFORE the assistant turn is pushed to conversationHistory
      // further down — see isFirstAiReply().
      const replyP = a.querySelector('p');
      if (isFirstAiReply()) {
        a.insertBefore(buildPrivacyNoticeEl(), replyP);
      }
      replyP.textContent = cfg.reply;
      // Optional real, genuinely clickable link — a separate element, not
      // text smuggled inside cfg.reply (which renders as inert plain text
      // via textContent). Only fires when a config entry actually supplies
      // linkText/linkHref; every other nav-intent reply is untouched.
      if (cfg.linkText && cfg.linkHref) {
        const linkPara = document.createElement('p');
        const link = document.createElement('a');
        link.href = cfg.linkHref;
        link.textContent = cfg.linkText;
        linkPara.appendChild(link);
        a.appendChild(linkPara);
      }
      thread.appendChild(a);
      thread.scrollTop = thread.scrollHeight;

      // Fed into history as an assistant turn so the visitor's next reply
      // (e.g. giving their name after Contact) continues naturally through
      // the normal, already-tested flow — no separate Claude call for
      // this fixed opener itself, no cost, no drift, no AI improvisation.
      conversationHistory.push({ role: 'assistant', content: cfg.reply });
      saveSession();

      setFinalPlaceholder();
      ph.classList.remove('fade');
      // Real fix, 7 August 2026: this handler's refocus was already ordered
      // correctly (after the DOM mutations above) — but scrollIntoView at
      // the top uses smooth/animated scrolling, which keeps running for
      // several hundred ms AFTER this synchronous code finishes. The still-
      // completing scroll animation was resetting blink even though focus
      // itself was set correctly. Delaying until the animation has actually
      // finished, not just until our own code has run.
      setTimeout(function(){
        autoFocusPending = true;
        input.blur();
        requestAnimationFrame(function(){
          input.focus({ preventScroll: true }); // real paint gap before refocus
        });
      }, 500);
    });
  });

  // Voice input — browser-native Speech-to-Text, free, client-side.
  // Not supported in every browser (Chrome/Edge: yes. Firefox/some mobile: patchy) — fails silently to typing.
  const micBtn = document.getElementById('askMic');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(SR){
    const recognition = new SR();
    recognition.lang = 'en-AU';
    recognition.interimResults = false;
    micBtn.addEventListener('click', function(){
      pauseRotation();
      micBtn.classList.add('listening');
      recognition.start();
    });
    recognition.onresult = function(e){
      input.value = e.results[0][0].transcript;
      micBtn.classList.remove('listening');
    };
    recognition.onerror = function(){ micBtn.classList.remove('listening'); };
    recognition.onend = function(){ micBtn.classList.remove('listening'); };
  } else {
    micBtn.style.display = 'none'; // graceful fallback — just type instead
  }
})();
