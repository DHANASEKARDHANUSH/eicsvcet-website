'use strict';

self.addEventListener('push', event => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {
      title: 'EIC update',
      body: event.data ? event.data.text() : 'There is a new update from EIC.'
    };
  }

  const title = typeof data.title === 'string' && data.title.trim()
    ? data.title.trim()
    : 'EIC update';

  const options = {
    body: typeof data.body === 'string' && data.body.trim()
      ? data.body.trim()
      : 'There is a new update from EIC.',
    icon: typeof data.icon === 'string' ? data.icon : '/assets/favicon.svg',
    badge: typeof data.badge === 'string' ? data.badge : '/assets/favicon.svg',
    tag: typeof data.tag === 'string' ? data.tag : 'eic-update',
    renotify: false,
    data: {
      url: typeof data.url === 'string' ? data.url : '/initiatives/'
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || '/initiatives/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        for (const client of clientList) {
          if ('focus' in client) {
            try {
              const current = new URL(client.url);
              const target = new URL(targetUrl, self.location.origin);
              if (current.origin === target.origin) {
                return client.navigate(target.href).then(() => client.focus());
              }
            } catch {
              // Fall through to opening a new window.
            }
          }
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(new URL(targetUrl, self.location.origin).href);
        }
        return undefined;
      })
  );
});
