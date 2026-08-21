// PromptWorkx service worker — exists ONLY to satisfy Chrome's installability
// check (real native "Install app" prompt, badge-free home-screen icon).
// Deliberately does no caching whatsoever. LiveAsk's chat panel depends on
// live, uncached fetch() calls to the Cloudflare Worker for every message —
// any caching logic here risks serving a stale reply. Every request passes
// straight through to the real network, unmodified, every time.

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function(event) {
  event.respondWith(fetch(event.request));
});
