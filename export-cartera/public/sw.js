// CRM notifications: shows what the server sends (Web Push) and opens the CRM where it points when tapped.
self.addEventListener('push', (event) => {
  let msg = { title: 'CRM', body: '', url: '/crm' };
  try {
    msg = Object.assign(msg, event.data ? event.data.json() : {});
  } catch (e) {
    msg.body = event.data ? event.data.text() : '';
  }
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag,
      renotify: !!msg.tag,
      data: { url: msg.url },
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      // To-do reminders: stay on screen until touched and vibrate hard.
      requireInteraction: !!msg.intense,
      vibrate: msg.intense ? [600, 200, 600, 200, 600, 200, 600] : undefined
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/crm', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin + '/crm') && 'focus' in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
