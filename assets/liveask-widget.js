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
      pauseRotation();
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
        a.innerHTML = '<span class="who">PROMPTWORKX LIVEASK AI</span><p></p>';
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
        // Real gap found 25 August 2026: this greeting path never rendered
        // data.quickReplies at all (only submitToPanel's success handler
        // did) — so the Worker's new fixed "Start tour" button silently had
        // nowhere to go, leaving the guest to type "yes" regardless. Same
        // validated, one-shot Quick Reply rendering as everywhere else.
        const quickReplyChoices = validQuickReplies(data);
        if (quickReplyChoices.length > 0) {
          a.appendChild(buildQuickRepliesEl(quickReplyChoices));
        }
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
        a.innerHTML = '<span class="who">PROMPTWORKX LIVEASK AI</span><p></p>';
        a.querySelector('p').textContent = "That's taking longer than it should to load your tour — try refreshing, or just ask a question below.";
        thread.appendChild(a);
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
  // built set — same buildQuickRepliesEl/submitToPanel machinery as every
  // other quick-reply row in the app — renders here instead, once the page
  // has actually settled, right after the scroll-and-highlight.
  (function(){
    const pending = takePendingTourAction();
    if (!pending) return;
    const dest = TOUR_DESTINATION_SELECTORS[pending.target];
    if (!dest) return;
    if (normalizedDestPage(dest.page) !== normalizedCurrentPath()) return;
    setTimeout(function(){
      scrollAndHighlight(dest.selector);
      if (pending.quickReplies && pending.quickReplies.length > 0) {
        thread.appendChild(buildQuickRepliesEl(pending.quickReplies));
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
        // Real bug found live on mobile, 25 August 2026: this used to call
        // wrap.remove() immediately, synchronously, right here. That's a
        // problem now that the document-level click-outside-to-collapse
        // listener exists (see it further down) — removing wrap detaches
        // the very button that was just clicked from the page BEFORE this
        // same click event finishes bubbling up to that listener. By the
        // time the listener asks "was this click inside #ask-panel?", the
        // clicked button has no path up to #ask-panel any more (it's still
        // attached to wrap, but wrap itself is now detached from
        // everything), so the check wrongly says "no" and collapses the
        // panel — right as the normal post-submit refocus pops the mobile
        // keyboard back open. Net effect on a phone: every quick-reply tap
        // looked like "the panel slams shut and the keyboard pops up".
        // Fix: disable the buttons immediately (so a genuine accidental
        // double-tap still can't submit twice — same guarantee as before),
        // but defer the actual DOM removal to the next tick, after this
        // click has fully finished bubbling and the outside-click check has
        // already correctly seen it as "inside the panel".
        Array.prototype.forEach.call(wrap.querySelectorAll('button'), function(b){ b.disabled = true; });
        submitToPanel(choice, { showVisitorBubble: true });
        setTimeout(function(){ wrap.remove(); }, 0);
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
    thinking.textContent = 'PromptWorkx is thinking…';
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
        a.innerHTML = '<span class="who">PROMPTWORKX LIVEASK AI</span><p></p>';
        a.querySelector('p').textContent = "That's taking longer than it should — try again, or jump straight to a door below.";
        thread.appendChild(a);
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
