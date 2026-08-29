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
  // ---- Deployment identity (28 August 2026) ----
  // The single source for this file's customer-specific UI strings. Every
  // occurrence of the deployment's display name below — the + menu's
  // customer-section heading, the idle/rotating placeholder text, the
  // returning-visitor placeholder, the "thinking…" indicator, and any
  // customer-name-bearing Quick Reply label — is derived from this one
  // constant. Provisioning a new deployment means changing this one line,
  // not hunting the file for "PromptWorkx".
  //
  // Deliberately NOT covered by this constant (confirmed 28 August 2026):
  // - The AI speaker label is the separate AI_SPEAKER_LABEL constant right
  //   below — "LiveAsk AI" is platform branding, not customer-specific,
  //   and must never carry the deployment name.
  // - Governed reply CONTENT that is genuine business copy rather than
  //   reusable UI/template text (e.g. the "Two Pillars" answer, and the
  //   "How to use LiveAsk" explanation — the latter also names a specific
  //   RA ("Chris"), not just the company, so company-name substitution
  //   alone wouldn't actually make it deployment-portable) stays literal
  //   for this pass — that's a content-authoring problem, not a config one.
  // - TOUR_DESTINATIONS' labels/context and the system prompt itself
  //   (index-worker.js / system-prompt.js) are far more deeply
  //   PromptWorkx-specific — real page-content descriptions and business
  //   knowledge, not a swappable name. Productising those is a separate,
  //   later workstream, not part of this constant.
  // - The static pre-JS placeholder fallback + aria-label baked into
  //   index.html / liveask-index.html / ai-tips-index.html (6 lines, 2 per
  //   file) can't be centralized without a build/templating step, which is
  //   explicitly out of scope for this pass. This is a KNOWN, ACCEPTED
  //   TEMPORARY EXCEPTION: provisioning a new deployment still means
  //   hand-editing those 6 lines across the three HTML files until a build
  //   step exists to inject them from one source. Low risk in practice —
  //   this file's own init overwrites that text within a fraction of a
  //   second of load — but a real manual step until that future step lands.
  const DEPLOYMENT_COMPANY_NAME = 'PromptWorkx';
  // Platform-controlled constant — never derived from DEPLOYMENT_COMPANY_NAME.
  // Proper case here; the existing .ask-msg .who CSS rule uppercases it for
  // display, so nothing in this file needs to hand-type caps.
  const AI_SPEAKER_LABEL = 'LiveAsk AI';

  const prompts = [
    `Ask ${DEPLOYMENT_COMPANY_NAME} AI`,
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
  const row2 = document.getElementById('askRow2');
  // 26 August 2026, third correction: Row 2 now also permanently hosts mic
  // + send (moved down from Row 1) inside .ask-row2-right — so quickReply
  // buttons must be appended into this LEFT cluster specifically, not into
  // #askRow2 directly, or they'd land after mic/send in the DOM and break
  // the always-mic/send-pinned-right layout.
  const row2Left = document.getElementById('askRow2Left');

  // The final "Ask another question..." placeholder needs genuinely
  // different content per viewport, not just different CSS wrapping —
  // desktop wants one flat line, mobile wants three specific manual
  // breaks. Checked at the moment it's shown, not baked into one string.
  function setFinalPlaceholder(){
    ph.classList.add('ask-fake-placeholder--final');
    if (window.matchMedia('(min-width: 1024px)').matches) {
      ph.textContent = `Ask another question, or get ${DEPLOYMENT_COMPANY_NAME} to contact you`;
    } else {
      ph.innerHTML = `Ask another question<br>or get ${DEPLOYMENT_COMPANY_NAME}<br>to contact you`;
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
  // ---- Reveal-on-interaction (added 25 August 2026, replaces the removed
  // "Reopen chat" tab) ----
  // Expands the panel to show what's already in conversationHistory — but
  // ONLY when there's actually something to show. Real bug found testing
  // this exact addition: .ask-close-btn is positioned absolute against
  // .ask-box, and .ask-box only grows tall enough to fit it properly once
  // .ask-thread.active has real content — expanding with zero history left
  // a short box with the close button landing right on top of the send
  // button. There's also nothing meaningful to "reveal" for a brand new
  // visitor anyway — the rotating placeholder already is their experience.
  function revealPanel(){
    if (conversationHistory.length === 0) return;
    document.querySelector('.ask-box').classList.add('expanded');
    thread.classList.add('active');
  }

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
      //
      // Real bug fix, 26 August 2026: pauseRotation() was unconditional
      // here, so a genuine tap into an EMPTY box — with no rotation even
      // running (e.g. the "final"/post-conversation placeholder, or the
      // brief window before the first reply lands) — still added the
      // shared 'fade' class. Since the logo and the textarea's own left
      // padding now key off that same class (see the CSS :has() rules), a
      // plain tap with zero characters typed was enough to start the logo
      // fading and the padding collapsing — the exact glitch reported live:
      // a half-transparent logo with the moving caret cutting through it,
      // triggered purely by focusing, not by actually typing anything.
      // Guarding on rotateTimer restricts the fade to when rotation is
      // genuinely active (the only case this was ever meant to cover) —
      // real typing still fades things correctly regardless, via the
      // separate 'input' listener below, which checks input.value.length.
      if (rotateTimer) { pauseRotation(); }
      clearInterval(rotateTimer); rotateTimer = null;
      clearTimeout(rotateFadeTimeout);
      // Covers a genuinely NEW focus — e.g. tabbing into the field with a
      // keyboard when it wasn't already focused. See the separate 'click'
      // listener below for why this alone isn't enough.
      revealPanel();
    }
  });
  // Real bug found testing this exact addition (25 August 2026): the page
  // auto-focuses the input on load (see the 'load' listener below), so by
  // the time a real visitor actually clicks into it, it's usually ALREADY
  // focused — and clicking an already-focused element fires no new 'focus'
  // event at all, so the reveal logic above silently never ran on a plain
  // click. Same root cause as the documented 7 August fix for rotation-
  // stop below (input event vs. focus event) — a genuine 'click' fires
  // every single time regardless of prior focus state, which 'focus'
  // fundamentally cannot guarantee. autoFocusPending doesn't need
  // checking here: the landing autofocus is triggered from script via
  // input.focus(), never a real click, so this listener is naturally never
  // reached by it.
  input.addEventListener('click', revealPanel);
  input.addEventListener('blur', function(){
    if (input.value.length === 0) {
      ph.classList.remove('fade');
    }
  });
  // Auto-focus on landing so the real cursor blinks immediately — desktop
  // only. Real bug found live on mobile, 25 August 2026 (Jolene's tour
  // link): this used to run unconditionally on every page load, phone or
  // not. On a touch device that queues the on-screen keyboard to open the
  // instant the page finishes loading — often not even visibly firing
  // until later, once page layout/scrolling settles (Android was seen
  // popping the keyboard exactly when the tour's first scroll-to-stop
  // animation ran, well after the actual focus() call). A tour guest
  // landing on a personalised link is never expected to type immediately;
  // neither, really, is an ordinary visitor just arriving on their phone.
  // (pointer: coarse) is the standard, UA-sniff-free way to detect a
  // touch-primary device — skip the auto-focus there entirely. Desktop
  // (pointer: fine, no on-screen keyboard to disturb) keeps the original
  // courteous cursor-ready-on-landing touch, unchanged.
  //
  // IMPORTANT — this ONLY ever gates this one script-triggered focus() call
  // on page load. A visitor's own genuine tap into the input still opens
  // the keyboard exactly as any text field always does on any device —
  // that's native browser behaviour, entirely separate from this code, and
  // nothing here touches it (see the 'click' listener above, which only
  // reveals the panel and never blocks or replaces the browser's own
  // focus-on-tap handling).
  window.addEventListener('load', function(){
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
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

  // ---- RA PIN masking (added 25 August 2026) ----
  // Must match index-worker.js's own PIN_PROMPT_TEXT constant exactly —
  // this is the one fixed string submitToPanel checks for to know "the
  // very next thing typed is a PIN, not an ordinary message." See
  // submitToPanel's own comment at the point this is used for the full
  // picture of what does and doesn't get masked/stored/sent.
  const PIN_PROMPT_TEXT = "Sure — what's your PIN?";

  // ---- Site-wide "Get a copy of your chat" (added 26 August 2026, direct
  // request from Chris) ----
  // Must match index-worker.js's own CHAT_COPY_TRIGGER constant exactly —
  // same "one fixed string both sides check for" pattern as PIN_PROMPT_TEXT
  // above. Also renders as the visible visitor bubble when clicked (first
  // person, reads naturally as something the visitor just said) — see
  // refreshChatCopyLink below.
  const CHAT_COPY_TRIGGER = "Get a copy of my chat";

  // Real bug already fixed once this session, deliberately never repeated
  // here: an earlier "close this chat panel" control was positioned
  // ABSOLUTE against .ask-box, which only grows tall enough to properly fit
  // an absolutely-positioned child once .ask-thread already has real
  // content — the close button ended up landing right on top of the send
  // button, a genuine visual overlay/bleed bug (see the "Reveal-on-
  // interaction" comment near the top of this file for the fuller story of
  // that fix). This control is built the opposite way on purpose: a plain,
  // normal in-flow child appended at the END of #askThread, exactly like
  // every .ask-msg bubble and the .ask-quickreplies row already are — the
  // box naturally grows to contain it, nothing can ever sit on top of
  // anything else. Removed and re-appended after every new reply (see the
  // three call sites below) so it's always the last thing in the thread,
  // never accumulating a copy per turn.
  function refreshChatCopyLink(){
    const existing = document.getElementById('ask-chatcopy-link');
    if (existing) existing.remove();
    const wrap = document.createElement('div');
    wrap.id = 'ask-chatcopy-link';
    wrap.style.cssText = 'margin-top:10px;text-align:center;';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'background:none;border:none;color:#5f5e5a;font-size:12px;text-decoration:underline;cursor:pointer;padding:4px 8px;';
    btn.textContent = 'Click here to get a copy of your chat';
    btn.addEventListener('click', function(){
      submitToPanel(CHAT_COPY_TRIGGER, { showVisitorBubble: true });
    });
    wrap.appendChild(btn);
    thread.appendChild(wrap);
    thread.scrollTop = thread.scrollHeight;
  }

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

  // Rebuilds the thread's DOM content from a restored conversationHistory
  // after a same-tab page navigation or reload, so it's fully ready the
  // instant the visitor actually opens the panel again — but does NOT
  // open it itself. Redesigned 25 August 2026: the original version also
  // force-expanded the panel here, which meant simply reloading the page
  // (or navigating to another page) yanked the full conversation back into
  // view even if the visitor had just closed it, with no chance to browse
  // quietly. Remembering the conversation and deciding whether to SHOW it
  // are now two separate concerns — content persists always; visibility
  // only ever changes because of a real, deliberate action (focusing the
  // input, sending a message, a defined nav trigger, or a fresh tour
  // link — see each of those call sites for their own .expanded handling).
  // Rotation still needs stopping and the placeholder still needs updating
  // regardless of visibility, so a visitor who returns to a history-
  // carrying tab never sees the "Ask PromptWorkx AI" rotating suggestions
  // — they'd be wrong the moment there's already a real conversation on
  // record, collapsed or not.
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
        a.innerHTML = `<span class="who">${AI_SPEAKER_LABEL}</span><p></p>`;
        a.querySelector('p').textContent = m.content;
        thread.appendChild(a);
      }
    });
    clearInterval(rotateTimer); rotateTimer = null;
    clearTimeout(rotateFadeTimeout);
    setFinalPlaceholder();
    ph.classList.remove('fade');
    // Persistent chat-copy control — restored on a same-tab reload/nav same
    // as everything else in this replay, so it's not missing until the next
    // reply happens to land.
    if (conversationHistory.some(function(m){ return m.role === 'assistant'; })) {
      refreshChatCopyLink();
    }
    // Row 2 never persisted quickReplies across a reload even in the old
    // one-shot design (they were never part of conversationHistory/
    // saveSession to begin with) — explicit clear here just guarantees
    // Row 2 comes back showing nothing stale (only the static '+') rather
    // than whatever it happened to hold in memory before the reload.
    renderRow2([]);
    thread.scrollTop = thread.scrollHeight;
  }

  // ---- Custom AI Tours: guest-side action dispatcher (added 24 August
  // 2026; extended 25 August 2026 for real cross-page destinations) ----
  // Approved semantic destination names -> real on-page targets. Keep this
  // in sync with TOUR_DESTINATIONS in index-worker.js — the Worker only
  // ever sends a semantic name (e.g. "LIVEASK_SECTION"), never a raw
  // selector, so a destination added there needs a matching entry here
  // before it can actually move anyone's page. Each entry now carries
  // `page` (the real site path it lives on) alongside `selector` — until 25
  // August 2026 every destination lived on the homepage, so this was a bare
  // selector string; now a destination can point at a genuinely different
  // page, which needs a full navigation, not just a scroll.
  const TOUR_DESTINATION_SELECTORS = {
    LIVEASK_SECTION: { page: '/', selector: '#liveask-pillar' },
    GENSEEN_SECTION: { page: '/', selector: '#genseen-pillar' },
    ABOUT_SECTION: { page: '/', selector: '#about' },
    // Added 25 August 2026 — the first real cross-page destination, direct
    // request from Chris to prove page-hopping actually works. Lands on the
    // dedicated LiveAsk page's hero section (new id added there).
    LIVEASK_PAGE_HERO: { page: '/liveask', selector: '#liveask-page-hero' }
  };

  // Same "treat home specially" normalization as ABOUT_HREF above, reused
  // here to compare a destination's configured `page` against where the
  // guest actually is right now. '/' and '/index.html' are the same place;
  // everything else compares as its own literal path with any trailing
  // slash stripped, so '/liveask' and '/liveask/' count as the same page.
  function normalizedCurrentPath(){
    const p = window.location.pathname;
    if (p === '/' || p === '/index.html') return '/';
    return p.replace(/\/$/, '');
  }
  function normalizedDestPage(page){
    if (page === '/' || page === '/index.html') return '/';
    return page.replace(/\/$/, '');
  }

  // Persists across the hard navigation a cross-page GO_TO needs — a real
  // page load destroys this whole script's running state, so "there's a
  // scroll-and-highlight still owed once we land" has to survive in
  // sessionStorage, same storage already relied on for cross-page
  // conversation continuity (SESSION_KEY above). Cleared the moment it's
  // been carried out, or on any first-contact tour ping starting fresh, so
  // a stale pending action can never fire on the wrong page later.
  const PENDING_ACTION_KEY = 'liveask_pending_tour_action_v1';
  // quickReplies (added 26 August 2026 — real bug found live: "The Tour
  // Conclusion buttons flash up and immediately disappear again before any
  // action is taken and cannot be retrieved.") A stop's just-offered
  // buttons (Next stop/End tour, or the final-stop feedback options) were
  // already appended to the OLD page's thread before this same hard
  // navigation fires — a real page load destroys that DOM before the
  // visitor can ever click them, and replaySession() only ever replays
  // plain message text, never quick-replies, so they were gone for good.
  // Carrying just the CHOICES (not the DOM) across the hop, same idea as
  // the scroll target itself, lets the resume path below render a genuine,
  // fresh, clickable set once this new page has actually settled.
  function savePendingTourAction(target, quickReplies){
    try {
      const payload = { target: target };
      if (Array.isArray(quickReplies) && quickReplies.length > 0) payload.quickReplies = quickReplies;
      sessionStorage.setItem(PENDING_ACTION_KEY, JSON.stringify(payload));
    } catch (e) { /* ignore, same fail-silent rule as saveSession */ }
  }
  function takePendingTourAction(){
    try {
      const raw = sessionStorage.getItem(PENDING_ACTION_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(PENDING_ACTION_KEY);
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.target !== 'string') return null;
      return {
        target: parsed.target,
        quickReplies: Array.isArray(parsed.quickReplies) ? parsed.quickReplies : null
      };
    } catch (e) { return null; }
  }

  // The actual same-page scroll-and-highlight — unchanged from the original
  // 24 August version, just split out so both the same-page path below AND
  // the "just landed after a cross-page hop" resume path (see near the
  // bottom of this file) can call the identical, already-tested logic.
  function scrollAndHighlight(selector){
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

  // Executes the Worker's GO_TO action. Fails completely silently on an
  // unknown destination name (never breaks the reply that came with it) —
  // same principle as the original same-page-only version.
  function handleTourAction(action, pendingQuickReplies){
    if (!action || action.type !== 'GO_TO') return;
    const dest = TOUR_DESTINATION_SELECTORS[action.target];
    if (!dest) return;
    if (normalizedDestPage(dest.page) === normalizedCurrentPath()) {
      scrollAndHighlight(dest.selector);
      return;
    }
    // Cross-page destination (added 25 August 2026): the explanation text
    // accompanying this same action has already been delivered in this
    // same reply, so nothing more needs saying — just remember what's
    // still owed, then navigate. sessionStorage (not the in-memory
    // conversationHistory push, which already happened by this point)
    // carries the pending scroll-and-highlight across the reload; the
    // resume check near the bottom of this file picks it up once the new
    // page's own copy of this script starts running. pendingQuickReplies
    // (26 August 2026) rides along the same way — see savePendingTourAction's
    // own comment for the bug this fixes.
    savePendingTourAction(action.target, pendingQuickReplies);
    window.location.href = dest.page;
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
    thinking.textContent = `${DEPLOYMENT_COMPANY_NAME} is thinking…`;
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
        a.innerHTML = `<span class="who">${AI_SPEAKER_LABEL}</span><p></p>`;
        const replyP = a.querySelector('p');
        if (showPrivacyNotice) {
          a.insertBefore(buildPrivacyNoticeEl(), replyP);
        }
        replyP.textContent = replyText;
        // Real gap found 25 August 2026: this greeting path never rendered
        // data.quickReplies at all (only submitToPanel's success handler
        // did) — so the Worker's new fixed "Start tour" button silently had
        // nowhere to go, leaving the guest to type "yes" regardless. Same
        // validated Quick Reply rendering as everywhere else, now landing
        // in the persistent Row 2 zone rather than the bubble itself.
        const quickReplyChoices = validQuickReplies(data);
        renderRow2(quickReplyChoices);
        thread.appendChild(a);
        refreshChatCopyLink();
        thread.scrollTop = thread.scrollHeight;
        if (data.action) handleTourAction(data.action, quickReplyChoices);
        // Real bug found live on mobile, 25 August 2026: this used to
        // force-focus the text input the instant a guest's tour greeting
        // landed — before they'd tapped or typed anything at all. On a
        // phone that meant the keyboard shot open the moment the tour
        // page finished loading, with nothing to type yet. Removed, same
        // reasoning as the nav-intent handler and the quick-reply path in
        // submitToPanel above — only a genuine typed submission should
        // pull the keyboard back open.
      })
      .catch(function(){
        thinking.remove();
        const a = document.createElement('div');
        a.className = 'ask-msg ai';
        a.innerHTML = `<span class="who">${AI_SPEAKER_LABEL}</span><p></p>`;
        a.querySelector('p').textContent = "That's taking longer than it should to load your tour — try refreshing, or just ask a question below.";
        thread.appendChild(a);
        renderRow2([]);
        refreshChatCopyLink();
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

  // ---- Cross-page GO_TO resume (added 25 August 2026) ----
  // The other half of handleTourAction's cross-page branch above: a
  // pending action was stashed in sessionStorage right before the
  // navigation that brought us to THIS page load. If one is sitting there
  // and its destination's page matches where we actually are now, carry
  // out the scroll-and-highlight it was always meant to do — same
  // function, same visual result as an in-page GO_TO, just fired after a
  // real page load instead of a same-page reply. A short delay lets the
  // page's own layout (images, fonts, anything above the target that
  // shifts height on load) settle before measuring positions — the
  // in-page path never needed this since nothing above the target moves
  // mid-conversation, but a fresh page load can still be reflowing right
  // after DOMContentLoaded.
  //
  // Any mismatch — no pending action, unknown target, or a pending
  // action whose page doesn't match here (shouldn't happen, but a
  // guest could always intervene by hand) — is a silent no-op, same
  // fail-quiet rule as the rest of this dispatcher. Read once via
  // takePendingTourAction() itself, so a stale flag can never fire twice.
  //
  // pendingQuickReplies (added 26 August 2026 — see savePendingTourAction's
  // own comment for the real bug this fixes: a cross-page hop landing on
  // the final stop used to carry the just-offered feedback buttons across
  // in the DOM, which the hard navigation always destroyed before they
  // could be clicked, with no way to get them back). A genuine, freshly
  // built set — same renderRow2/submitToPanel machinery as every other
  // quick-reply row in the app — renders into Row 2 here instead, once the
  // page has actually settled, right after the scroll-and-highlight.
  (function(){
    const pending = takePendingTourAction();
    if (!pending) return;
    const dest = TOUR_DESTINATION_SELECTORS[pending.target];
    if (!dest) return;
    if (normalizedDestPage(dest.page) !== normalizedCurrentPath()) return;
    // 26 August 2026: a guided tour hopping someone to a new page IS the
    // deliberate action — per Chris, this should deterministically reveal
    // the thread (so the tour's own narration is actually visible here),
    // unlike ordinary same-tab navigation elsewhere on the site, which
    // stays collapsed on arrival per replaySession's 25 August redesign.
    // Called immediately, ahead of the scroll/highlight delay below, so
    // the panel is already open by the time the highlight lands rather
    // than visibly popping open a beat later.
    revealPanel();
    setTimeout(function(){
      scrollAndHighlight(dest.selector);
      if (pending.quickReplies && pending.quickReplies.length > 0) {
        renderRow2(pending.quickReplies);
        thread.scrollTop = thread.scrollHeight;
      }
    }, 300);
  })();

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
  // ---- Open/close redesign (25 August 2026, replacing the 24 August
  // "hide/reopen tab" pattern after real live-testing found it worse than
  // no affordance at all) ----
  // The 24 August version added a floating "Reopen chat" tab plus a hint
  // label next to the X, specifically so a visitor who'd closed the panel
  // had a visible way back in. Real testing surfaced three separate
  // problems with it: the tab and hint collided/misaligned on both mobile
  // and desktop; a page reload forced the FULL panel back open regardless
  // of whether the visitor had just closed it (session persistence and
  // panel VISIBILITY were wrongly tied together — see replaySession's own
  // comment); and clicking an unrelated nav button reopened the whole
  // conversation even when the visitor only wanted to browse elsewhere on
  // the page.
  //
  // The actual fix, per Chris (25 August 2026): stop treating "closed" as
  // a thing that needs its own dedicated escape hatch at all, and instead
  // make opening/closing behave the way visitors already expect from any
  // search-bar-like control on the web — focusing the input reveals what's
  // already there (no separate button needed), and clicking anywhere else
  // on the page puts it away again. The input bar itself, always visible
  // regardless of open/closed state, IS the reopen affordance now. The X
  // stays — "all windows deserve a good X" — just without the label that
  // used to sit next to it and collide with it.
  const closeBtn = document.getElementById('askCloseBtn');

  closeBtn.addEventListener('click', function(){
    document.querySelector('.ask-box').classList.remove('expanded');
    thread.classList.remove('active');
  });

  // Click-outside-to-collapse. Only fires when the panel is actually open,
  // and deliberately ignores two categories of "outside" click rather than
  // collapsing on every single one: anything inside #ask-panel itself
  // (the input, the thread, quick-reply buttons, the mic, the X — all
  // legitimately part of using the panel, none of them should close it),
  // and any of the site's own defined nav-intent triggers (About, Contact,
  // etc. — see NAV_INTENTS below), which have their own click handler that
  // deliberately OPENS the panel; without this exclusion, that handler's
  // own expand and this listener's collapse would both fire on the same
  // click and fight each other. Every other click on the page — page text,
  // whitespace, a plain link that isn't a defined trigger — collapses it.
  document.addEventListener('click', function(e){
    const askBox = document.querySelector('.ask-box');
    if (!askBox.classList.contains('expanded')) return;
    if (e.target.closest('#ask-panel')) return;
    if (e.target.closest('[data-nav-intent]')) return;
    askBox.classList.remove('expanded');
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

  // ---- Quick Replies / Row 2 (Customer 000 / GEO 4, added 24 August 2026;
  // moved into the persistent Row 2 zone as part of the LiveAsk UI Panel
  // Upgrade, 26 August 2026) ----
  // Renders the model's offered closed-choice buttons (data.quickReplies —
  // see system-prompt.js "Guided (closed) questions — Quick Replies" and
  // Section 8). Distinct from NAV_INTENTS: a Quick Reply click is ordinary
  // conversational input, not a fixed opener — it goes back through the
  // exact same submitToPanel() path as if the visitor had typed the
  // button's own text, and can lead to a normal Claude reply (including
  // another round of Quick Replies, or none). Also distinct from Governed
  // Actions (lead capture, verification) — selecting a choice never itself
  // triggers a consequential action, only ordinary conversation input.
  //
  // Until 26 August 2026 this rendered a one-shot button row appended
  // inside whichever AI message bubble had just landed — meaning the
  // buttons for a mid-tour turn, or a tour-conclusion turn, lived and died
  // with that one bubble, and any turn that crossed a hard page navigation
  // lost them outright unless something (see savePendingTourAction) went
  // out of its way to carry them across by hand. Row 2 replaces that: one
  // persistent zone, immediately below the composer, always reflecting the
  // CURRENT turn's valid choices — cleared and rebuilt on every call, never
  // tied to a specific historical bubble. The '+' placeholder to its left
  // is static markup, not touched here — it's a reserved-but-inert spot
  // for the Phase 2 capability menu, per the approved UI Panel Upgrade
  // sequence.
  //
  // The old wrap.remove()-on-click dance (and the mobile race it was
  // working around — a self-removing button detaching itself from the
  // page before the outside-click-to-collapse listener could see the click
  // as "inside the panel") no longer applies: Row 2's buttons are never
  // removed synchronously on click, only disabled, and the container gets
  // wiped and rebuilt by the next renderRow2() call once a response (or a
  // failure) actually lands.
  function renderRow2(choices){
    Array.prototype.forEach.call(row2Left.querySelectorAll('.ask-quickreply-btn'), function(b){ b.remove(); });
    (choices || []).forEach(function(choice){
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ask-quickreply-btn';
      btn.textContent = choice;
      btn.addEventListener('click', function(){
        // Scoped to quickreply buttons only — mic/send now live in this
        // same #askRow2 (in .ask-row2-right) and must stay usable while a
        // choice submission is in flight, not get swept up by this guard.
        Array.prototype.forEach.call(row2Left.querySelectorAll('.ask-quickreply-btn'), function(b){ b.disabled = true; });
        submitToPanel(choice, { showVisitorBubble: true });
      });
      row2Left.appendChild(btn);
    });
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

    // ---- RA PIN masking (added 25 August 2026, real live-test find) ----
    // Detected purely by checking whether the fixed, exact PIN-prompt text
    // was the AI's most recent turn — deterministic, no guessing at intent,
    // same "code decides, model never does" principle as everything else
    // security-relevant in this flow. The real PIN still has to reach the
    // server this one time (that's the whole point — the server is what
    // actually checks it against a stored hash), but nothing else about it
    // survives past this single request: the visible bubble shows a fixed
    // mask instead of the digits (a FIXED mask, not one sized to the PIN's
    // own length — a variable-length mask would leak how many digits it
    // was), and conversationHistory — which gets saved into this browser's
    // own sessionStorage AND resent in full on every later request — never
    // holds the real value, not even for a moment. See index-worker.js's
    // redactPinFromMessages for this same fix's backend half (a
    // defense-in-depth backstop that doesn't rely on this file having done
    // its part correctly).
    const lastAiTurn = conversationHistory.length > 0 ? conversationHistory[conversationHistory.length - 1] : null;
    const isPinAnswer = !!lastAiTurn && lastAiTurn.role === 'assistant' && lastAiTurn.content === PIN_PROMPT_TEXT;

    if(opts.showVisitorBubble !== false){
      const v = document.createElement('div');
      v.className = 'ask-msg visitor';
      v.innerHTML = '<span class="who">You</span><p></p>';
      v.querySelector('p').textContent = isPinAnswer ? '••••••' : promptText;
      thread.appendChild(v);
    }

    clearInterval(rotateTimer); rotateTimer = null;
    clearTimeout(rotateFadeTimeout);
    setFinalPlaceholder();
    ph.classList.remove('fade');

    // The array actually persisted to sessionStorage and resent on every
    // future turn gets a redacted placeholder, never the real PIN.
    conversationHistory.push({ role: 'user', content: isPinAnswer ? '[PIN entered]' : promptText });
    saveSession();

    const thinking = document.createElement('p');
    thinking.className = 'ask-thinking';
    thinking.textContent = `${DEPLOYMENT_COMPANY_NAME} is thinking…`;
    thread.appendChild(thinking);
    thread.scrollTop = thread.scrollHeight;
    // Real fix, 7 August 2026: this refocus previously ran BEFORE the
    // thinking-bubble append and scroll above — both real DOM mutations
    // that immediately undid it, so the cursor never actually stayed
    // visible long enough to be seen. Moved to after every synchronous
    // mutation in this function completes.
    // Real bug found live on mobile, 25 August 2026: this refocus used to
    // be unconditional — meaning it ran even when this turn came from a
    // quick-reply BUTTON tap, not typed text. Focusing a text input is
    // exactly what pops a phone's on-screen keyboard, so a visitor who'd
    // only ever tapped buttons kept getting the keyboard shoved open at
    // them for no reason. Now only opted into by the actual typed-message
    // path (send(), via opts.refocusInput) — a quick-reply choice never
    // asked for a keyboard, so it no longer summons one. See the matching
    // gates further down in this function's success/catch handlers.
    if (opts.refocusInput) {
      autoFocusPending = true;
      input.blur();
      requestAnimationFrame(function(){
        input.focus({ preventScroll: true }); // real paint gap before refocus — back-to-back blur/focus can get coalesced by the browser with no gap between them
      });
    }

    // The real PIN goes to the server in THIS one request only, spliced
    // back in on top of a copy of conversationHistory (which itself only
    // ever holds the redacted placeholder) — the one and only place the
    // actual value needs to exist at all is the single request the server
    // uses to check it against a stored hash.
    const outgoingMessages = isPinAnswer
      ? conversationHistory.slice(0, -1).concat([{ role: 'user', content: promptText }])
      : conversationHistory;

    fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, messages: outgoingMessages, tourToken: tourToken })
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
        a.innerHTML = `<span class="who">${AI_SPEAKER_LABEL}</span><p></p>`;
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
        renderRow2(quickReplyChoices);
        thread.appendChild(a);
        refreshChatCopyLink();
        thread.scrollTop = thread.scrollHeight;
        // Custom AI Tours: only ever present on a tour guest's turn, and
        // only on the specific turn the Worker's guest-state-machine
        // decided to fire it (see handleTourAction above and the guest
        // state machine in index-worker.js's fetch()) — undefined/absent
        // on every ordinary reply, so this is a no-op there.
        if (data.action) handleTourAction(data.action, quickReplyChoices);
        // Real fix, 7 August 2026: the async reply lands well after the
        // earlier submit-time refocus, and appending it here is a real DOM
        // mutation that can reset the caret blink a second time — same
        // underlying browser behaviour as the rotation-text issue, just
        // triggered later in the flow. Refocus again once the reply is
        // actually in. Gated the same way as the submit-time refocus above
        // (25 August 2026) — same reasoning: don't summon the phone
        // keyboard on the back of a quick-reply tap.
        if (opts.refocusInput) {
          autoFocusPending = true;
          input.blur();
          requestAnimationFrame(function(){
            input.focus({ preventScroll: true }); // real paint gap before refocus
          });
        }
      })
      .catch(function(){
        thinking.remove();
        const a = document.createElement('div');
        a.className = 'ask-msg ai';
        a.innerHTML = `<span class="who">${AI_SPEAKER_LABEL}</span><p></p>`;
        a.querySelector('p').textContent = "That's taking longer than it should — try again, or jump straight to a door below.";
        thread.appendChild(a);
        renderRow2([]);
        refreshChatCopyLink();
        thread.scrollTop = thread.scrollHeight;
        if (opts.refocusInput) {
          autoFocusPending = true;
          input.blur();
          requestAnimationFrame(function(){
            input.focus({ preventScroll: true }); // real paint gap before refocus
          });
        }
      });
  }

  function send(){
    const q = input.value.trim();
    if(!q) return;
    input.value = '';
    input.style.height = 'auto';
    // refocusInput: true — this is the one real "the visitor was just
    // typing" path (see submitToPanel's own comment on the flag), so
    // keeping the keyboard open/refocused here is the wanted behaviour,
    // not the bug.
    submitToPanel(q, { showVisitorBubble: true, refocusInput: true });
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
      a.innerHTML = `<span class="who">${AI_SPEAKER_LABEL}</span><p></p>`;
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
      refreshChatCopyLink();
      thread.scrollTop = thread.scrollHeight;

      // Fed into history as an assistant turn so the visitor's next reply
      // (e.g. giving their name after Contact) continues naturally through
      // the normal, already-tested flow — no separate Claude call for
      // this fixed opener itself, no cost, no drift, no AI improvisation.
      conversationHistory.push({ role: 'assistant', content: cfg.reply });
      saveSession();

      setFinalPlaceholder();
      ph.classList.remove('fade');
      // Real bug found live on mobile, 25 August 2026: this handler used to
      // end with a forced refocus of the text input (see this file's git
      // history / the PIN/quick-reply fix notes above for the fuller story)
      // — but clicking a nav button (About/Services/Contact etc.) is a
      // button tap, not typed text, and focusing a text input is exactly
      // what pops a phone's on-screen keyboard. Removed outright rather
      // than gated, since a nav-intent click is never the "visitor was
      // just typing" case submitToPanel's refocusInput flag exists for.
    });
  });

  // ====================================================================
  // ---- `+` capability menu / Secondary Input Layer / Admin (LiveAsk UI
  // Panel Upgrade v3, added 27 August 2026) ----
  // ====================================================================
  // One shared popover shell — a discreet upward-opening popover on
  // desktop, a capped-height bottom sheet with a scrim on mobile (spec
  // Section 4) — reused for the public `+` menu itself, the Secondary Input
  // Layer (masked PIN entry, Give Feedback's rating/comment, Restart Tour's
  // confirmation), and every RA Admin sub-view (Create Tour handoff, Manage
  // Tours, Manage Quick Menu). Built entirely as dynamic DOM, same
  // established pattern as refreshChatCopyLink/buildPrivacyNoticeEl above —
  // nothing new baked into the three pages' static markup beyond the `+`
  // button itself.
  //
  // Design note on "conversational" vs "structured": Tour CREATION keeps
  // its existing fully-conversational bookflow engine untouched (spec
  // Section 8.3, Section 12's "do not convert generative Tour authoring
  // into a rigid form wizard") — Admin's "Create Tour" below is only a
  // front door into that same engine (see adminCreateTourStart in
  // index-worker.js). Everything else here (Manage Tours' Run/Test and
  // Edit, Manage Quick Menu's Add) genuinely IS structured admin data entry
  // — Section 3.4 explicitly lists "small contextual choice sets" as a
  // Secondary Input primitive, and these fit that better than a multi-turn
  // chat exchange would.

  const scrim = document.createElement('div');
  scrim.className = 'ask-panel-scrim';
  scrim.id = 'askPanelScrim';
  const popover = document.createElement('div');
  popover.className = 'ask-popover';
  popover.id = 'askPopover';
  askPanel.querySelector('.ask-box').appendChild(scrim);
  askPanel.querySelector('.ask-box').appendChild(popover);

  const plusBtn = document.getElementById('askPlusBtn');

  // Admin session state — mirrors the server's adminsession:<sessionId>
  // record only loosely (raName, for display; the actual authority lives
  // server-side and is re-checked on every adminAction call). Cleared
  // whenever the popover fully closes, same "don't linger" principle as the
  // server's own 30-minute TTL — a closed panel means this sitting is over.
  let adminAuthed = null; // { raName } | null

  function closePlusMenu(){
    popover.classList.remove('open');
    scrim.classList.remove('open');
    plusBtn.setAttribute('aria-expanded', 'false');
    adminAuthed = null;
  }

  // Anchors the popover to the ACTUAL current position of the + button,
  // computed via JS rather than a pure-CSS "bottom:100% of the nearest
  // positioned ancestor" trick — real live-test find building this: the
  // popover's positioning parent is .ask-box, whose height changes with the
  // conversation thread's own height (collapsed vs expanded, short vs long
  // history), so a fixed CSS anchor drifted away from the + button itself
  // and, on this site's top-pinned panel (unlike a bottom-anchored chat
  // composer, .ask-panel sits at position:sticky;top:0), could open mostly
  // above the visible viewport. Opens DOWNWARD from the + here for that
  // same reason — there's reliably more room below the composer on this
  // layout than above it. Skipped entirely on mobile — the bottom-sheet
  // media query fully owns position there (fixed to the viewport edges),
  // and a leftover inline top/left would otherwise outrank it (inline
  // style beats a class selector) — so both are explicitly cleared first.
  function positionPopover(){
    if (window.matchMedia('(max-width: 640px)').matches) {
      popover.style.top = '';
      popover.style.left = '';
      popover.style.bottom = '';
      return;
    }
    const boxRect = document.querySelector('.ask-box').getBoundingClientRect();
    const btnRect = plusBtn.getBoundingClientRect();
    popover.style.left = Math.max(0, btnRect.left - boxRect.left) + 'px';
    popover.style.top = (btnRect.bottom - boxRect.top + 8) + 'px';
    popover.style.bottom = 'auto';
  }

  // Renders one "screen" into the shared popover — a title, an optional
  // Back control, and whatever the caller builds into the body container.
  // Every menu/sub-view below calls this rather than manipulating popover
  // directly, so opening a new screen always starts from a clean slate.
  // opts.progress = { step, total } — Phase 2 UI refinement pass: renders
  // a small "n/total" + filled bar above the title, used by the two-step
  // Give Feedback flow. Purely presentational — carries no state of its
  // own beyond what the caller already tracks (rating/comment).
  function renderSecondaryPanel(title, buildFn, opts){
    opts = opts || {};
    popover.innerHTML = '';
    if (opts.onBack) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'ask-popover-back';
      back.textContent = '← Back';
      back.addEventListener('click', opts.onBack);
      popover.appendChild(back);
    }
    if (opts.progress) {
      const wrap = document.createElement('div');
      wrap.className = 'ask-popover-progress';
      const lbl = document.createElement('div');
      lbl.className = 'ask-popover-progress-label';
      lbl.textContent = opts.progress.step + '/' + opts.progress.total;
      const bar = document.createElement('div');
      bar.className = 'ask-popover-progress-bar';
      const fill = document.createElement('div');
      fill.className = 'ask-popover-progress-fill';
      fill.style.width = Math.round((opts.progress.step / opts.progress.total) * 100) + '%';
      bar.appendChild(fill);
      wrap.appendChild(lbl);
      wrap.appendChild(bar);
      popover.appendChild(wrap);
    }
    if (title) {
      const h = document.createElement('div');
      h.className = 'ask-popover-title';
      h.textContent = title;
      popover.appendChild(h);
    }
    const body = document.createElement('div');
    popover.appendChild(body);
    buildFn(body);
    popover.classList.add('open');
    scrim.classList.add('open');
    plusBtn.setAttribute('aria-expanded', 'true');
    positionPopover();
  }

  function renderPopoverError(container, message){
    const existing = container.querySelector('.ask-popover-error');
    if (existing) existing.remove();
    if (!message) return;
    const e = document.createElement('div');
    e.className = 'ask-popover-error';
    e.textContent = message;
    container.appendChild(e);
  }

  function renderChoiceButtons(container, choices, onPick){
    choices.forEach(function(choice){
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ask-popover-item';
      btn.textContent = choice.label !== undefined ? choice.label : choice;
      btn.addEventListener('click', function(){ onPick(choice.value !== undefined ? choice.value : choice); });
      container.appendChild(btn);
    });
  }

  // Phase 2 UI refinement pass — full-width navigation rows with a trailing
  // chevron, used for Admin Home and Tour Detail's action list (Section 6
  // and 8 of the pass brief: "navigation, not a form/CTA buttons"). Rows
  // are plain data objects: { label, value, danger }. `danger` gets the
  // same visually-separated destructive treatment as Revoke everywhere
  // else — never an ordinary row, per the pass brief's explicit carve-out.
  function renderNavRows(container, rows, onPick){
    rows.forEach(function(row){
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ask-popover-navrow' + (row.danger ? ' ask-popover-navrow--danger' : '');
      const lbl = document.createElement('span');
      lbl.textContent = row.label;
      const chev = document.createElement('span');
      chev.className = 'chev';
      chev.setAttribute('aria-hidden', 'true');
      chev.textContent = '›';
      btn.appendChild(lbl);
      btn.appendChild(chev);
      btn.addEventListener('click', function(){ onPick(row.value !== undefined ? row.value : row); });
      container.appendChild(btn);
    });
  }

  // opts.multiline → <textarea> instead of <input> (Give Feedback's comment
  // step wants a generously sized field, Section 4 of the pass brief).
  // Autofocuses on render and, when opts.onEnter is given, Enter submits —
  // both requested explicitly for Admin PIN (Section 5) and applied to
  // every other single-field popover step for the same reason: "apply
  // consistent treatment... for inputs" (Global Phase 2 UI System). Shift+
  // Enter still inserts a newline in the textarea case, as expected.
  function renderTextField(container, opts){
    opts = opts || {};
    const field = document.createElement(opts.multiline ? 'textarea' : 'input');
    field.className = 'ask-popover-field' + (opts.multiline ? ' ask-popover-field--textarea' : '');
    if (!opts.multiline) {
      field.type = opts.masked ? 'password' : 'text';
      if (opts.numeric) field.setAttribute('inputmode', 'numeric');
    } else {
      field.rows = 4;
    }
    if (opts.placeholder) field.placeholder = opts.placeholder;
    if (opts.maxLength) field.maxLength = opts.maxLength;
    if (opts.onEnter) {
      field.addEventListener('keydown', function(e){
        if (e.key === 'Enter' && !(opts.multiline && !e.metaKey && !e.ctrlKey)) {
          e.preventDefault();
          opts.onEnter();
        }
      });
    }
    container.appendChild(field);
    setTimeout(function(){ try { field.focus(); } catch (e) {} }, 0);
    return field;
  }

  // Primary actions use the LiveAsk blue system (--logo-blue, via the
  // existing site-wide .btn--liveask class) rather than the site's
  // burgundy .btn--primary — confirmed 28 August 2026: burgundy stays
  // reserved for the rest of the PromptWorkx site, not this component
  // family. Destructive primary actions (Revoke, delete-confirm) pass
  // `danger:true` instead, which gets the dedicated --danger treatment
  // rather than looking like an ordinary blue primary action.
  function renderActions(container, actions){
    const row = document.createElement('div');
    row.className = 'ask-popover-actions';
    actions.forEach(function(a){
      const btn = document.createElement('button');
      btn.type = 'button';
      const variant = a.danger ? 'btn--danger' : (a.primary ? 'btn--liveask' : 'btn--ghost');
      btn.className = 'btn btn--compact ' + variant;
      btn.textContent = a.label;
      btn.addEventListener('click', a.onClick);
      row.appendChild(btn);
    });
    container.appendChild(row);
  }

  // Generic POST-and-parse helper — every Admin/Feedback/Restart request
  // below is small and stateless from the client's point of view (unlike
  // the ordinary chat pipeline, none of these touch conversationHistory),
  // so they share this rather than each hand-rolling fetch/json().
  function postWorker(bodyObj){
    return fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bodyObj)
    }).then(function(res){ return res.json(); });
  }

  // ---- Public Customer Quick Menu (Section 6) — fetched once per page
  // load and re-fetched every time the + menu is (re)opened at the root, so
  // an RA's just-added/deleted item shows up for this same visitor without
  // needing a reload. No admin auth on this request — every visitor sees
  // it. ----
  function fetchQuickMenuItems(){
    return postWorker({ getQuickMenu: true }).then(function(data){
      return (data && data.ok) ? data.items : [];
    }).catch(function(){ return []; });
  }

  function runQuickMenuItem(item){
    closePlusMenu();
    if (item.type === 'page') {
      window.location.href = item.target;
    } else if (item.type === 'chat') {
      document.getElementById('ask-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      submitToPanel(item.prompt, { showVisitorBubble: false, systemNote: `→ You clicked ${item.title}` });
    } else if (item.type === 'contact') {
      const trigger = document.querySelector('[data-nav-intent="' + item.contactIntent + '"]');
      if (trigger) trigger.click();
    }
  }

  // ---- LiveAsk section item: How to use LiveAsk (Section 5.1.A) ----
  // Fixed, code-authored explanation — no Claude call, same "code decides
  // fixed governed copy" principle as NAV_INTENTS above. Rendered as an
  // ordinary AI bubble in the main thread (not inside the popover) since
  // this is genuinely part of the conversation, just triggered by a menu
  // click instead of typed text.
  function showHowToUseLiveAsk(){
    closePlusMenu();
    thread.classList.add('active');
    document.querySelector('.ask-box').classList.add('expanded');
    const note = document.createElement('div');
    note.className = 'ask-sysnote';
    note.textContent = '→ You clicked How to use LiveAsk';
    thread.appendChild(note);
    const replyText = "I can answer questions about PromptWorkx, help you find the right service, walk you through a Guided Tour of the site if one's available, and help you get in touch with Chris when you're ready. Just ask me anything, or use the choices below.";
    const a = document.createElement('div');
    a.className = 'ask-msg ai';
    a.innerHTML = `<span class="who">${AI_SPEAKER_LABEL}</span><p></p>`;
    const replyP = a.querySelector('p');
    if (isFirstAiReply()) a.insertBefore(buildPrivacyNoticeEl(), replyP);
    replyP.textContent = replyText;
    thread.appendChild(a);
    conversationHistory.push({ role: 'assistant', content: replyText });
    saveSession();
    const choices = tourToken ? [] : ['Find the right service', `Contact ${DEPLOYMENT_COMPANY_NAME}`];
    renderRow2(choices);
    refreshChatCopyLink();
    thread.scrollTop = thread.scrollHeight;
  }

  // ---- LiveAsk section item: Start new chat (Section 5.1.B) ----
  // Omitted from the menu entirely while a Tour is active (confirmed 27
  // August 2026 — see the v3 Addendum) — openPlusMenu below never even
  // renders this item in that case, so there is nothing to gate here.
  function startNewChatConfirm(){
    renderSecondaryPanel('Start a new chat?', function(body){
      const p = document.createElement('div');
      p.className = 'ask-popover-note';
      p.textContent = 'This will clear the current conversation from this browser tab.';
      body.appendChild(p);
      renderActions(body, [
        { label: 'Start new chat', primary: true, onClick: function(){
          conversationHistory = [];
          try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
          saveSession();
          thread.innerHTML = '';
          document.querySelector('.ask-box').classList.remove('expanded');
          thread.classList.remove('active');
          ph.classList.remove('ask-fake-placeholder--final');
          ph.textContent = prompts[0];
          i = 0;
          ph.classList.remove('fade');
          startRotation();
          closePlusMenu();
        } },
        { label: 'Cancel', onClick: closePlusMenu }
      ]);
    }, { onBack: openPlusMenu });
  }

  // ---- LiveAsk section item: Give feedback (Section 5.1.C) ----
  // Two-step flow with a shared progress treatment (Phase 2 UI refinement
  // pass, Sections 3-4) — quality/interaction reference only, LiveAsk's own
  // visual identity throughout: large circular rating controls in place of
  // the previous bare vertical "1 2 3 4 5" list, selection advances
  // immediately to step 2 exactly as before (no change to that behaviour).
  function giveFeedbackFlow(){
    renderSecondaryPanel('How would you rate your overall conversation with LiveAsk?', function(body){
      const row = document.createElement('div');
      row.className = 'ask-popover-rating-row';
      ['1', '2', '3', '4', '5'].forEach(function(n){
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ask-popover-rating-btn';
        btn.textContent = n;
        btn.setAttribute('aria-label', 'Rate ' + n + ' of 5');
        btn.addEventListener('click', function(){ giveFeedbackCommentStep(parseInt(n, 10)); });
        row.appendChild(btn);
      });
      const scale = document.createElement('div');
      scale.className = 'ask-popover-rating-scale';
      scale.innerHTML = '<span>Not satisfied</span><span>Very satisfied</span>';
      body.appendChild(row);
      body.appendChild(scale);
    }, { onBack: openPlusMenu, progress: { step: 1, total: 2 } });
  }
  function giveFeedbackCommentStep(rating){
    renderSecondaryPanel("Anything you'd like to add?", function(body){
      const field = renderTextField(body, { placeholder: 'Optional comment', multiline: true });
      renderActions(body, [
        { label: 'Submit', primary: true, onClick: function(){
          postWorker({ giveFeedback: { sessionId: sessionId, rating: rating, comment: field.value } })
            .then(function(){
              renderSecondaryPanel('Thanks for the feedback!', function(body2){
                renderActions(body2, [{ label: 'Done', primary: true, onClick: closePlusMenu }]);
              });
            })
            .catch(function(){ renderPopoverError(body, "That didn't send — please try again."); });
        } },
        { label: 'Cancel', onClick: closePlusMenu }
      ]);
    }, { onBack: function(){ giveFeedbackFlow(); }, progress: { step: 2, total: 2 } });
  }

  // ---- LiveAsk section item: Restart Tour (Section 5.1.D) — contextual
  // only, only ever offered by openPlusMenu when tourToken is set. ----
  function restartTourConfirm(){
    renderSecondaryPanel('Restart this Tour from the beginning?', function(body){
      renderActions(body, [
        { label: 'Restart', primary: true, onClick: function(){
          postWorker({ restartTour: true, sessionId: sessionId, tourToken: tourToken })
            .then(function(data){
              closePlusMenu();
              if (!data.ok) return;
              conversationHistory = [{ role: 'assistant', content: data.reply }];
              saveSession();
              thread.innerHTML = '';
              thread.classList.add('active');
              document.querySelector('.ask-box').classList.add('expanded');
              const a = document.createElement('div');
              a.className = 'ask-msg ai';
              a.innerHTML = `<span class="who">${AI_SPEAKER_LABEL}</span><p></p>`;
              a.querySelector('p').textContent = data.reply;
              thread.appendChild(a);
              renderRow2(data.quickReplies || []);
              refreshChatCopyLink();
              thread.scrollTop = thread.scrollHeight;
            });
        } },
        { label: 'Cancel', onClick: closePlusMenu }
      ]);
    }, { onBack: openPlusMenu });
  }

  // ====================================================================
  // ---- Admin (Section 5.1.E, 7, 8) ----
  // ====================================================================
  function adminPinEntry(){
    renderSecondaryPanel('Admin', function(body){
      const field = renderTextField(body, { masked: true, placeholder: 'PIN', numeric: true, onEnter: function(){ submitPin(); } });
      function submitPin(){
        // The raw PIN travels in THIS one request only, via a dedicated
        // field never touching messages/conversationHistory — see
        // handleAdminAuth's own header comment in index-worker.js for why
        // that's the whole point of this being a separate mechanism from
        // the in-chat Book Tour PIN step.
        postWorker({ adminAuth: { sessionId: sessionId, pin: field.value } }).then(function(data){
          if (!data.ok) { renderPopoverError(body, data.error || "That didn't work."); field.value = ''; return; }
          adminAuthed = { raName: data.raName };
          adminMenu();
        });
      }
      renderActions(body, [
        { label: 'Continue', primary: true, onClick: submitPin },
        { label: 'Cancel', onClick: closePlusMenu }
      ]);
    }, { onBack: openPlusMenu });
  }

  function adminAction(action, extra){
    return postWorker({ adminAction: Object.assign({ sessionId: sessionId, action: action }, extra || {}) });
  }

  function adminMenu(){
    renderSecondaryPanel('Admin — ' + adminAuthed.raName, function(body){
      renderNavRows(body, [
        { label: 'Create Tour', value: 'create' },
        { label: 'Manage Tours', value: 'manage' },
        { label: 'Manage Quick Menu', value: 'quickmenu' }
      ], function(choice){
        if (choice === 'create') adminCreateTour();
        else if (choice === 'manage') adminManageToursList();
        else if (choice === 'quickmenu') adminQuickMenuList();
      });
    }, { onBack: closePlusMenu });
  }

  // ---- Create Tour (Section 8.3) — hands off into the SAME proven
  // bookflow engine Tour creation already uses (see adminCreateTourStart in
  // index-worker.js). From here on, the RA continues in the ORDINARY chat
  // panel, not the Secondary Input Layer — exactly as if they'd typed
  // "book tour" and their PIN in chat. ----
  function adminCreateTour(){
    adminAction('createTourStart').then(function(data){
      closePlusMenu();
      if (!data.ok) return;
      thread.classList.add('active');
      document.querySelector('.ask-box').classList.add('expanded');
      const note = document.createElement('div');
      note.className = 'ask-sysnote';
      note.textContent = '→ Admin: Create Tour';
      thread.appendChild(note);
      const a = document.createElement('div');
      a.className = 'ask-msg ai';
      a.innerHTML = `<span class="who">${AI_SPEAKER_LABEL}</span><p></p>`;
      a.querySelector('p').textContent = data.reply;
      thread.appendChild(a);
      conversationHistory.push({ role: 'assistant', content: data.reply });
      saveSession();
      renderRow2(data.quickReplies || []);
      refreshChatCopyLink();
      thread.scrollTop = thread.scrollHeight;
    });
  }

  // ---- Manage Tours (Section 8.4) ----
  function adminManageToursList(){
    renderSecondaryPanel('Manage Tours', function(body){
      body.textContent = 'Loading…';
      adminAction('manageToursList').then(function(data){
        body.innerHTML = '';
        if (!data.ok) { renderPopoverError(body, data.error); return; }
        const active = data.tours.filter(function(t){ return t.status === 'Active'; });
        const expired = data.tours.filter(function(t){ return t.status === 'Expired'; });
        function renderGroup(label, list){
          if (list.length === 0) return;
          const lbl = document.createElement('div');
          lbl.className = 'ask-popover-section-label';
          lbl.textContent = label;
          body.appendChild(lbl);
          list.forEach(function(t){
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'ask-popover-tourrow';
            row.innerHTML = '<div class="txt"><div class="ttl"></div><div class="meta"></div></div><span class="chev" aria-hidden="true">›</span>';
            row.querySelector('.ttl').textContent = t.tourName || t.guestName || '(untitled tour)';
            row.querySelector('.meta').textContent = t.guestName ? ('Guest: ' + t.guestName) : 'Multiple recipients';
            row.addEventListener('click', function(){ adminManageToursDetail(t.token); });
            body.appendChild(row);
          });
        }
        renderGroup('Active', active);
        renderGroup('Expired', expired);
        if (active.length === 0 && expired.length === 0) {
          const p = document.createElement('div');
          p.className = 'ask-popover-note';
          p.textContent = "You haven't created any tours yet.";
          body.appendChild(p);
        }
      });
    }, { onBack: adminMenu });
  }

  // Tour Detail (Phase 2 UI refinement pass, Section 8) — a proper detail
  // layer (name + status pill, then labelled metadata rows, then a
  // clearly-separated actions area) rather than the previous flat text
  // dump. `expiresAt` comes from the narrow, explicitly-approved backend
  // exception in adminManageToursReview (index-worker.js) — Active/Expired
  // here is derived client-side from that same already-stored value, the
  // identical derivation adminManageToursList already does server-side;
  // nothing here invents data the backend doesn't provide.
  function adminManageToursDetail(token){
    renderSecondaryPanel(null, function(body){
      body.textContent = 'Loading…';
      adminAction('manageToursReview', { token: token }).then(function(data){
        body.innerHTML = '';
        if (!data.ok) { renderPopoverError(body, data.error); return; }
        const t = data.tour;
        const expired = !!(t.expiresAt && t.expiresAt < Date.now());

        const head = document.createElement('div');
        head.className = 'ask-popover-detail-head';
        const title = document.createElement('div');
        title.className = 'ask-popover-detail-title';
        title.textContent = t.tourName || t.guestName || '(untitled tour)';
        const pill = document.createElement('span');
        pill.className = 'ask-popover-status-pill ' + (expired ? 'ask-popover-status-pill--expired' : 'ask-popover-status-pill--active');
        pill.textContent = expired ? 'Expired' : 'Active';
        head.appendChild(title);
        head.appendChild(pill);
        body.appendChild(head);

        const meta = document.createElement('div');
        meta.className = 'ask-popover-detail-meta';
        const rows = [
          ['Guest', t.guestName || 'Multiple recipients'],
          ['Stops', t.destinations.join(' → ')],
          ['Locked in', t.lockedIn ? 'Yes' : 'No (still a draft)'],
          ['Guest visits recorded', String(t.guestSessions)],
          ['RA preview runs recorded', String(t.previewSessions)]
        ];
        if (t.expiresAt) {
          rows.push([expired ? 'Expired' : 'Expires', new Date(t.expiresAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })]);
        }
        rows.forEach(function(pair){
          const row = document.createElement('div');
          row.className = 'ask-popover-detail-row';
          const k = document.createElement('span');
          k.className = 'k';
          k.textContent = pair[0];
          const v = document.createElement('span');
          v.className = 'v';
          v.textContent = pair[1];
          row.appendChild(k);
          row.appendChild(v);
          meta.appendChild(row);
        });
        body.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'ask-popover-detail-actions';
        body.appendChild(actions);
        // Ordinary actions get the standard nav-row treatment; Revoke is
        // visually separated toward the bottom with the destructive
        // treatment (Section 8's explicit requirement) via danger:true.
        renderNavRows(actions, [
          { label: 'Run/Test', value: 'preview' },
          { label: 'Edit', value: 'edit' },
          { label: 'Duplicate', value: 'duplicate' },
          { label: 'Extend expiry', value: 'extend' },
          { label: 'Revoke', value: 'revoke', danger: true }
        ], function(choice){
          if (choice === 'preview') adminManageToursPreview(token);
          else if (choice === 'edit') adminManageToursEdit(token);
          else if (choice === 'duplicate') adminManageToursDuplicate(token);
          else if (choice === 'extend') adminManageToursExtend(token);
          else if (choice === 'revoke') adminManageToursRevokeConfirm(token);
        });
      });
    }, { onBack: adminManageToursList });
  }

  // Run/Test — pages through the server's already-computed narration for
  // every stop, entirely client-side (see adminManageToursPreview's own
  // header comment in index-worker.js: this NEVER touches the real guest
  // link or a tourprogress: record, so it stays safe to re-run any time,
  // including after lock-in).
  function adminManageToursPreview(token){
    renderSecondaryPanel('Run/Test', function(body){
      body.textContent = 'Loading…';
      adminAction('manageToursPreview', { token: token }).then(function(data){
        body.innerHTML = '';
        if (!data.ok) { renderPopoverError(body, data.error); return; }
        let idx = 0;
        const textEl = document.createElement('div');
        textEl.className = 'ask-popover-note';
        body.appendChild(textEl);
        function render(){ textEl.textContent = data.stops[idx].text; }
        render();
        renderActions(body, [
          { label: 'Next', primary: true, onClick: function(){
            if (idx < data.stops.length - 1) { idx++; render(); }
          } },
          { label: 'Done', onClick: function(){ adminManageToursDetail(token); } }
        ]);
      });
    }, { onBack: function(){ adminManageToursDetail(token); } });
  }

  // Edit — an ordered tap-to-pick multi-select over all 4 possible
  // destinations (see adminManageToursEditOptions's header comment in
  // index-worker.js for why this is a one-shot select rather than the
  // one-at-a-time conversational picker Tour creation uses).
  function adminManageToursEdit(token){
    renderSecondaryPanel('Edit stops', function(body){
      body.textContent = 'Loading…';
      adminAction('manageToursEditOptions', { token: token }).then(function(data){
        body.innerHTML = '';
        if (!data.ok) { renderPopoverError(body, data.error); return; }
        let picked = data.current.slice();
        const list = document.createElement('div');
        body.appendChild(list);
        function renderList(){
          list.innerHTML = '';
          data.allDestinations.forEach(function(d){
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ask-popover-item';
            const order = picked.indexOf(d.key);
            btn.textContent = (order === -1 ? '☐ ' : ('☑ ' + (order + 1) + '. ')) + d.picker;
            btn.addEventListener('click', function(){
              if (order === -1) picked.push(d.key); else picked.splice(order, 1);
              renderList();
            });
            list.appendChild(btn);
          });
        }
        renderList();
        renderActions(body, [
          { label: 'Save', primary: true, onClick: function(){
            adminAction('manageToursEditConfirm', { token: token, destinations: picked }).then(function(res){
              if (!res.ok) { renderPopoverError(body, res.error); return; }
              adminManageToursDetail(token);
            });
          } },
          { label: 'Cancel', onClick: function(){ adminManageToursDetail(token); } }
        ]);
      });
    }, { onBack: function(){ adminManageToursDetail(token); } });
  }

  function adminManageToursDuplicate(token){
    adminAction('manageToursDuplicate', { token: token }).then(function(data){
      renderSecondaryPanel('Tour duplicated', function(body){
        if (!data.ok) { renderPopoverError(body, data.error); return; }
        const p = document.createElement('div');
        p.className = 'ask-popover-note';
        p.textContent = 'A new copy has been created: ' + data.tourUrl;
        body.appendChild(p);
        renderActions(body, [{ label: 'Done', primary: true, onClick: adminManageToursList }]);
      });
    });
  }

  function adminManageToursExtend(token){
    adminAction('manageToursExtend', { token: token }).then(function(data){
      renderSecondaryPanel('Expiry extended', function(body){
        if (!data.ok) { renderPopoverError(body, data.error); return; }
        const p = document.createElement('div');
        p.className = 'ask-popover-note';
        p.textContent = 'This tour now expires ' + data.expiresInDays + ' days from today.';
        body.appendChild(p);
        renderActions(body, [{ label: 'Done', primary: true, onClick: function(){ adminManageToursDetail(token); } }]);
      });
    });
  }

  // Revoke — MVP behaviour, explicitly documented as such (see
  // adminManageToursRevoke's header comment in index-worker.js): an
  // immediate KV delete, no soft-revoke. The confirmation wording below is
  // the spec's own required explicit warning (Section 8.4/Addendum), not a
  // generic "are you sure".
  function adminManageToursRevokeConfirm(token){
    renderSecondaryPanel('Revoke this tour?', function(body){
      const p = document.createElement('div');
      p.className = 'ask-popover-note';
      p.textContent = 'This link will stop working immediately, including for anyone currently using it. This cannot be undone.';
      body.appendChild(p);
      renderActions(body, [
        { label: 'Revoke', primary: true, danger: true, onClick: function(){
          adminAction('manageToursRevoke', { token: token }).then(function(data){
            if (!data.ok) { renderPopoverError(body, data.error); return; }
            adminManageToursList();
          });
        } },
        { label: 'Cancel', onClick: function(){ adminManageToursDetail(token); } }
      ]);
    }, { onBack: function(){ adminManageToursDetail(token); } });
  }

  // ---- Manage Quick Menu (Section 7.1) ----
  // Shared with the "Contact action" step of Add below, so the label an RA
  // picks when adding an item and the label shown back to them in an
  // existing item's detail view can never drift apart.
  const CONTACT_INTENT_OPTIONS = [
    { label: 'General contact', value: 'contact' },
    { label: 'Book a GenCheck', value: 'book-audit' },
    { label: 'Enquire about GenGrid', value: 'enquire-build' },
    { label: 'PromptGuide enquiry', value: 'register-protocol' },
    { label: 'PromptSpec enquiry', value: 'enquire-opportunity' }
  ];
  function contactIntentLabel(intent){
    const found = CONTACT_INTENT_OPTIONS.find(function(o){ return o.value === intent; });
    return found ? found.label : intent;
  }
  // One-line secondary summary shown under an item's title in the list —
  // Phase 2 UI refinement pass, Section 9 — built entirely from fields the
  // backend already returns on every item, no new data required.
  function humanizeQuickMenuItem(item){
    if (item.type === 'page') return 'Opens page: ' + (item.target || '');
    if (item.type === 'chat') return 'Starts a conversation: ' + (item.prompt || '');
    if (item.type === 'contact') return 'Contact action: ' + contactIntentLabel(item.contactIntent);
    return '';
  }

  function adminQuickMenuList(){
    renderSecondaryPanel('Manage Quick Menu', function(body){
      body.textContent = 'Loading…';
      adminAction('manageQuickMenuList').then(function(data){
        body.innerHTML = '';
        if (!data.ok) { renderPopoverError(body, data.error); return; }
        if (data.items.length === 0) {
          const p = document.createElement('div');
          p.className = 'ask-popover-note';
          p.textContent = "You haven't added any Quick Menu items yet.";
          body.appendChild(p);
        } else {
          data.items.forEach(function(item){
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'ask-popover-itemrow';
            row.innerHTML = '<div class="txt"><div class="ttl"></div><div class="meta"></div></div><span class="chev" aria-hidden="true">›</span>';
            row.querySelector('.ttl').textContent = item.title;
            row.querySelector('.meta').textContent = humanizeQuickMenuItem(item);
            row.addEventListener('click', function(){ adminQuickMenuItemDetail(item); });
            body.appendChild(row);
          });
        }
        renderActions(body, [{ label: '+ Add menu item', primary: true, onClick: adminQuickMenuAddTitle }]);
      });
    }, { onBack: adminMenu });
  }

  // Item detail/manage view (Section 9): tap an existing item to see its
  // current title/type/target, with Delete available here rather than a
  // permanent red control sitting directly in the list. True field-level
  // editing is explicitly deferred — this pass only restructures how an
  // existing item is inspected and removed, no new backend action.
  function adminQuickMenuItemDetail(item){
    renderSecondaryPanel(item.title, function(body){
      const meta = document.createElement('div');
      meta.className = 'ask-popover-detail-meta';
      const typeLabel = item.type === 'page' ? 'Opens page' : (item.type === 'chat' ? 'Starts a conversation' : 'Contact action');
      const valueLabel = item.type === 'page' ? item.target : (item.type === 'chat' ? item.prompt : contactIntentLabel(item.contactIntent));
      [['Type', typeLabel], ['Detail', valueLabel || '—']].forEach(function(pair){
        const row = document.createElement('div');
        row.className = 'ask-popover-detail-row';
        const k = document.createElement('span');
        k.className = 'k';
        k.textContent = pair[0];
        const v = document.createElement('span');
        v.className = 'v';
        v.textContent = pair[1];
        row.appendChild(k);
        row.appendChild(v);
        meta.appendChild(row);
      });
      body.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'ask-popover-detail-actions';
      body.appendChild(actions);
      renderNavRows(actions, [{ label: 'Delete', value: 'delete', danger: true }], function(){
        adminQuickMenuItemDeleteConfirm(item);
      });
    }, { onBack: adminQuickMenuList });
  }

  function adminQuickMenuItemDeleteConfirm(item){
    renderSecondaryPanel('Delete this menu item?', function(body){
      const p = document.createElement('div');
      p.className = 'ask-popover-note';
      p.textContent = '"' + item.title + '" will no longer appear in the Quick Menu.';
      body.appendChild(p);
      renderActions(body, [
        { label: 'Delete', primary: true, danger: true, onClick: function(){
          adminAction('manageQuickMenuDelete', { id: item.id }).then(function(){ adminQuickMenuList(); });
        } },
        { label: 'Cancel', onClick: function(){ adminQuickMenuItemDetail(item); } }
      ]);
    }, { onBack: function(){ adminQuickMenuItemDetail(item); } });
  }

  function adminQuickMenuAddTitle(){
    renderSecondaryPanel('What should the menu option say?', function(body){
      const field = renderTextField(body, { placeholder: 'e.g. Get a Quote', maxLength: 40 });
      renderActions(body, [
        { label: 'Next', primary: true, onClick: function(){
          if (!field.value.trim()) { renderPopoverError(body, 'A title is required.'); return; }
          adminQuickMenuAddType(field.value.trim());
        } },
        { label: 'Cancel', onClick: adminQuickMenuList }
      ]);
    }, { onBack: adminQuickMenuList });
  }

  function adminQuickMenuAddType(title){
    renderSecondaryPanel('What should this option do?', function(body){
      renderChoiceButtons(body, [
        { label: 'Go to page', value: 'page' },
        { label: 'Start conversation', value: 'chat' },
        { label: 'Contact action', value: 'contact' }
      ], function(type){ adminQuickMenuAddDetail(title, type); });
    }, { onBack: function(){ adminQuickMenuAddTitle(); } });
  }

  function adminQuickMenuAddDetail(title, type){
    if (type === 'page') {
      renderSecondaryPanel('Which page?', function(body){
        const field = renderTextField(body, { placeholder: '/liveask' });
        renderActions(body, [
          { label: 'Next', primary: true, onClick: function(){ adminQuickMenuAddConfirm(title, type, { target: field.value.trim() }); } },
          { label: 'Cancel', onClick: adminQuickMenuList }
        ]);
      }, { onBack: function(){ adminQuickMenuAddType(title); } });
    } else if (type === 'chat') {
      renderSecondaryPanel('What should LiveAsk help the visitor with when they choose this?', function(body){
        const field = renderTextField(body, { placeholder: 'e.g. Help them understand GenSeen pricing' });
        renderActions(body, [
          { label: 'Next', primary: true, onClick: function(){ adminQuickMenuAddConfirm(title, type, { prompt: field.value.trim() }); } },
          { label: 'Cancel', onClick: adminQuickMenuList }
        ]);
      }, { onBack: function(){ adminQuickMenuAddType(title); } });
    } else {
      renderSecondaryPanel('Which contact action?', function(body){
        renderChoiceButtons(body, CONTACT_INTENT_OPTIONS, function(contactIntent){ adminQuickMenuAddConfirm(title, type, { contactIntent: contactIntent }); });
      }, { onBack: function(){ adminQuickMenuAddType(title); } });
    }
  }

  function adminQuickMenuAddConfirm(title, type, detail){
    renderSecondaryPanel('Add this menu option?', function(body){
      const p = document.createElement('div');
      p.className = 'ask-popover-note';
      p.textContent = '"' + title + '" will appear in the Quick Menu.';
      body.appendChild(p);
      renderActions(body, [
        { label: 'Confirm', primary: true, onClick: function(){
          const item = Object.assign({ title: title, type: type }, detail);
          adminAction('manageQuickMenuAdd', { item: item }).then(function(data){
            if (!data.ok) { renderPopoverError(body, data.error); return; }
            adminQuickMenuList();
          });
        } },
        { label: 'Cancel', onClick: adminQuickMenuList }
      ]);
    }, { onBack: adminQuickMenuList });
  }

  // ---- Root `+` menu (Section 5, 6) ----
  // Phase 2 UI refinement pass (Section 1): the customer/company section —
  // divider, "PromptWorkx" heading, and its items — is only ever appended
  // once the Quick Menu fetch confirms at least one item exists. With zero
  // configured items, none of that renders (no divider, no heading, no
  // "Nothing here yet." message) — the menu just ends after LiveAsk's own
  // items, rather than flashing a "Loading…" placeholder first.
  function openPlusMenu(){
    adminAuthed = null;
    renderSecondaryPanel(null, function(body){
      const liveAskLabel = document.createElement('div');
      liveAskLabel.className = 'ask-popover-section-label ask-popover-section-label--first';
      liveAskLabel.textContent = 'LiveAsk';
      body.appendChild(liveAskLabel);

      const liveAskItems = [{ label: 'How to use LiveAsk', onClick: showHowToUseLiveAsk }];
      // Start new chat — omitted entirely while a Tour is active (Section
      // 5.1.B, confirmed 27 August 2026), and only offered at all once
      // there's a real conversation to clear.
      if (!tourToken && conversationHistory.length > 0) {
        liveAskItems.push({ label: 'Start new chat', onClick: startNewChatConfirm });
      }
      liveAskItems.push({ label: 'Give feedback', onClick: giveFeedbackFlow });
      // Restart Tour — contextual only (Section 5.1.D): shown only while a
      // Tour is actually active.
      if (tourToken) {
        liveAskItems.push({ label: 'Restart Tour', onClick: restartTourConfirm });
      }
      liveAskItems.push({ label: 'Admin', onClick: adminPinEntry });
      renderChoiceButtons(body, liveAskItems.map(function(it){ return { label: it.label, value: it }; }), function(it){ it.onClick(); });

      fetchQuickMenuItems().then(function(items){
        if (items.length === 0) return;
        const divider = document.createElement('div');
        divider.className = 'ask-popover-divider';
        body.appendChild(divider);

        const customerLabel = document.createElement('div');
        customerLabel.className = 'ask-popover-section-label';
        customerLabel.textContent = DEPLOYMENT_COMPANY_NAME;
        body.appendChild(customerLabel);

        renderChoiceButtons(body, items.map(function(it){ return { label: it.title, value: it }; }), runQuickMenuItem);
        positionPopover();
      });
    });
  }

  plusBtn.addEventListener('click', function(e){
    e.stopPropagation();
    if (popover.classList.contains('open')) { closePlusMenu(); return; }
    openPlusMenu();
  });
  scrim.addEventListener('click', closePlusMenu);
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && popover.classList.contains('open')) closePlusMenu();
  });
  // Reuse the panel's own existing outside-click-to-collapse exclusion —
  // the popover lives inside #ask-panel, so submitToPanel/the main
  // document click listener above already leaves it alone; this only needs
  // to stop a click INSIDE the popover from bubbling up to that listener
  // and collapsing the whole chat panel underneath it.
  popover.addEventListener('click', function(e){ e.stopPropagation(); });
  window.addEventListener('resize', function(){
    if (popover.classList.contains('open')) positionPopover();
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
