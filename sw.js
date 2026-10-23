/* 字笺 · 本地通知 Service Worker */
self.addEventListener('install', function (e) {
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var cid = event.notification && event.notification.data && event.notification.data.contactId;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url && 'focus' in c) {
          c.postMessage({ type: 'zijian-open-chat', contactId: cid });
          return c.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('./');
      }
    })
  );
});
