(() => {
  'use strict';

  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) return;

  const nav = document.querySelector('.site-nav');
  if (!nav || nav.querySelector('[data-eic-notifications]')) return;

  const button = document.createElement('a');
  button.href = '#';
  button.className = 'nav-cta';
  button.dataset.eicNotifications = 'true';
  button.setAttribute('aria-label', 'EIC notification settings');
  button.textContent = 'EIC alerts';

  const joinButton = nav.querySelector('.nav-cta');
  if (joinButton) nav.insertBefore(button, joinButton);
  else nav.appendChild(button);

  let busy = false;

  function setButton(text, disabled = false, title = '') {
    button.textContent = text;
    button.setAttribute('aria-disabled', String(disabled));
    button.title = title;
    if (disabled) button.style.pointerEvents = 'none';
    else button.style.pointerEvents = '';
  }

  function uint8ArrayFromBase64Url(value) {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
  }

  async function registerServiceWorker() {
    return navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
  }

  async function getPublicKey() {
    const response = await fetch('/api/notifications/public-key', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.publicKey) {
      throw new Error(data.message || 'Notifications are not configured yet.');
    }
    return data.publicKey;
  }

  async function getCurrentSubscription() {
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
  }

  async function saveSubscription(subscription) {
    const response = await fetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      credentials: 'same-origin',
      body: JSON.stringify(subscription.toJSON())
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Could not enable notifications.');
  }

  async function removeSubscription(endpoint) {
    await fetch('/api/notifications/subscribe', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      credentials: 'same-origin',
      body: JSON.stringify({ endpoint })
    });
  }

  async function refreshState() {
    if (Notification.permission === 'denied') {
      setButton('Notifications blocked', false, 'Enable notifications in your browser/site settings.');
      return;
    }

    try {
      await getPublicKey();
      await registerServiceWorker();
      const subscription = await getCurrentSubscription();
      if (subscription) {
        // Re-sync in case the subscription was rotated by the browser.
        await saveSubscription(subscription);
        setButton('Notifications on');
      } else {
        setButton('EIC alerts');
      }
    } catch {
      // Do not make notification support break the rest of the site.
      button.hidden = true;
    }
  }

  async function enableNotifications() {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      if (permission === 'denied') {
        setButton('Notifications blocked', false, 'Enable notifications in your browser/site settings.');
      }
      return;
    }

    await registerServiceWorker();
    const publicKey = await getPublicKey();
    const registration = await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: uint8ArrayFromBase64Url(publicKey)
      });
    }

    await saveSubscription(subscription);
    setButton('Notifications on');
  }

  async function disableNotifications() {
    const subscription = await getCurrentSubscription();
    if (!subscription) {
      setButton('EIC alerts');
      return;
    }

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await removeSubscription(endpoint);
    setButton('EIC alerts');
  }

  button.addEventListener('click', async event => {
    event.preventDefault();
    if (busy) return;

    busy = true;
    const wasOn = Notification.permission === 'granted' && await getCurrentSubscription().catch(() => null);
    setButton('Updating…', true);

    try {
      if (wasOn) await disableNotifications();
      else await enableNotifications();
    } catch (error) {
      setButton('EIC alerts');
      window.console.error('EIC notifications:', error);
      window.alert(error instanceof Error ? error.message : 'Could not update notification settings.');
    } finally {
      busy = false;
    }
  });

  void refreshState();
})();
