# EIC Web Push event and achievement notifications

This implementation is integrated with the current EIC website architecture:
Node.js built-in HTTP server + PostgreSQL (`pg`) + vanilla HTML/CSS/JS.
It does not add React, Firebase, Supabase JS, or a new UI framework.

## 1. Install the server dependency

From the EIC repository root:

```bash
npm install web-push
```

Commit both `package.json` and the generated `package-lock.json`.

## 2. Integrated files

These files are already part of the project:

```text
notification-service.js
```

and the browser service worker into:

```text
public/service-worker.js
```

## 3. Notification UI

The notification opt-in script is included on all public pages:

```text
public/notifications.js
```

Each page loads it after `/app.js`:

```html
<script defer src="/notifications.js"></script>
```

The public notification button reuses the site's existing `nav-cta` class, so it does not introduce a new color palette or visual system. It is hidden until VAPID keys are configured.

Included pages:

```text
public/index.html
public/about/index.html
public/initiatives/index.html
public/membership/index.html
public/contact/index.html
public/privacy/index.html
```

## 4. Modify `admin-controller.js`

### 4a. Add this import with the existing imports

```js
import {
  getVapidPublicKey,
  initPushDatabase,
  savePushSubscription,
  removePushSubscription,
  sendContentPush
} from './notification-service.js';
```

### 4b. In `createAdminController().init()`, initialize the notification table

Change:

```js
async init() {
  await import('./admin-db.js').then(module => module.initAdminDatabase());
},
```

to:

```js
async init() {
  await import('./admin-db.js').then(module => module.initAdminDatabase());
  await initPushDatabase();
},
```

### 4c. Add these public notification API routes

Inside `handle(req, res, requestUrl)`, after:

```js
const pathname = requestUrl.pathname;
```

insert:

```js
if (req.method === 'GET' && pathname === '/api/notifications/public-key') {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return json(res, 503, { message: 'Notifications are not configured yet.' });
  }
  return json(res, 200, { publicKey }, { 'Cache-Control': 'no-store' });
}

if (req.method === 'POST' && pathname === '/api/notifications/subscribe') {
  if (!sameOrigin(req)) return json(res, 403, { message: 'Request validation failed.' });

  try {
    const body = JSON.parse(await readBody(req));
    await savePushSubscription(body);
    return json(res, 201, { ok: true });
  } catch (error) {
    return json(res, error?.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, {
      message: error.message || 'Could not save notification settings.'
    });
  }
}

if (req.method === 'DELETE' && pathname === '/api/notifications/subscribe') {
  if (!sameOrigin(req)) return json(res, 403, { message: 'Request validation failed.' });

  try {
    const body = JSON.parse(await readBody(req));
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
    if (!endpoint || endpoint.length > 4096) {
      return json(res, 400, { message: 'Invalid push endpoint.' });
    }

    await removePushSubscription(endpoint);
    return json(res, 200, { ok: true });
  } catch (error) {
    return json(res, 400, { message: error.message || 'Could not disable notifications.' });
  }
}
```

### 4d. Trigger a push only after a NEW published event or achievement is saved

Find the existing block:

```js
const item = parseContent(body);
const created = await createContent(item);
return json(res, 201, { item: created });
```

Replace it with:

```js
const item = parseContent(body);
const created = await createContent(item);

let notification = null;
if (['event', 'achievement'].includes(created.kind) && created.published) {
  try {
    notification = await sendContentPush(created);
  } catch (notificationError) {
    // The content is already safely stored. A push failure must not
    // turn a successful content publish into a failed admin request.
    console.error('Content notification failed:', notificationError);
    notification = { sent: 0, removed: 0, failed: 1, skipped: false };
  }
}

return json(res, 201, { item: created, notification });
```

This intentionally does **not** send a new push when an existing event or achievement is edited, or when a draft is saved.

## 5. Render environment variables

Generate VAPID keys once:

```bash
npx web-push generate-vapid-keys --json
```

Add the resulting values to Render > your service > Environment:

```text
VAPID_PUBLIC_KEY=<publicKey>
VAPID_PRIVATE_KEY=<privateKey>
VAPID_SUBJECT=mailto:eicsvcet@gmail.com
```

Keep the private key secret. Do not commit these values to Git.

Do not regenerate the VAPID key pair after users have subscribed; changing the server key pair invalidates the relationship with existing subscriptions.

## 6. Deploy

Push the code to GitHub and let Render redeploy.

The existing server already serves `.js` files with the correct JavaScript MIME type, so no new static-file MIME configuration is needed.

## 7. Test

Use a real HTTPS Render domain.

1. Open the EIC website.
2. Click `EIC alerts`.
3. Choose `Allow` in the browser prompt.
4. The button should change to `Notifications on`.
5. Add a NEW published Event or Achievement from `/admin/`.
6. The subscribed device should receive `New EIC event` or `New EIC achievement`.
7. Click the notification; it should open `/initiatives/`.
8. Turn notifications off from the `Notifications on` button and verify the subscription disappears from the database.

For multiple devices, enable notifications separately on each device/browser. Each creates its own anonymous push subscription record.
