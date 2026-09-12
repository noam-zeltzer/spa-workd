/* spa workd service worker.
   Precache the shell so the app opens instantly and works with no signal;
   cache fonts as they arrive. Bump CACHE to ship a new version. */

var CACHE = "spa-workd-v1";
var SHELL = [
  ".",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return key === CACHE ? null : caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;

  // Navigations: network first so a deploy lands, shell from cache when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(function (response) {
        var copy = response.clone();
        caches.open(CACHE).then(function (c) { c.put("index.html", copy); });
        return response;
      }).catch(function () {
        return caches.match("index.html").then(function (hit) {
          return hit || caches.match(".");
        });
      })
    );
    return;
  }

  // Everything else (own assets, Google Fonts): cache first, then fill in.
  event.respondWith(
    caches.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (response) {
        if (response && (response.ok || response.type === "opaque")) {
          var copy = response.clone();
          caches.open(CACHE).then(function (c) { c.put(request, copy); });
        }
        return response;
      });
    })
  );
});
