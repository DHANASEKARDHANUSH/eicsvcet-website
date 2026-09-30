(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);

  const loginView = $('#login-view');
  const dashboardView = $('#dashboard-view');
  const loginForm = $('#login-form');
  const loginStatus = $('#login-status');
  const logoutButton = $('#logout-button');
  const contentForm = $('#content-form');
  const contentId = $('#content-id');
  const contentKind = $('#content-kind');
  const contentTitle = $('#content-title');
  const contentDescription = $('#content-description');
  const contentDescriptionHelp = $('#content-description-help');
  const contentDate = $('#content-date');
  const contentDateLabel = $('#content-date-label');
  const contentLocation = $('#content-location');
  const contentImage = $('#content-image');
  const contentAlt = $('#content-alt');
  const contentPublished = $('#content-published');
  const contentPreviewWrap = $('#image-preview-wrap');
  const contentPreview = $('#image-preview');
  const imageRequiredLabel = $('#image-required-label');
  const editorTitle = $('#editor-title');
  const saveButton = $('#save-content');
  const cancelEditButton = $('#cancel-edit');
  const contentStatus = $('#content-status');
  const listStatus = $('#list-status');
  const contentList = $('#content-list');
  const exportButton = $('#export-members');
  const filterButtons = [...document.querySelectorAll('[data-filter]')];

  const stats = {
    event: $('#stat-events'),
    program: $('#stat-programs'),
    achievement: $('#stat-achievements'),
    published: $('#stat-published')
  };

  let csrfToken = '';
  let allItems = [];
  let currentFilter = 'all';

  function setStatus(node, message, type = '') {
    node.className = `admin-status ${type}`.trim();
    node.textContent = message;
  }

  function showLogin(message = '') {
    loginView.hidden = false;
    dashboardView.hidden = true;
    if (message) setStatus(loginStatus, message, 'error');
  }

  function showDashboard() {
    loginView.hidden = true;
    dashboardView.hidden = false;
  }

  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');

    if (options.body && typeof options.body !== 'string') {
      headers.set('Content-Type', 'application/json');
      options.body = JSON.stringify(options.body);
    }

    if (csrfToken && ['POST', 'PUT', 'DELETE'].includes(options.method || 'GET')) {
      headers.set('X-CSRF-Token', csrfToken);
    }

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'same-origin'
    });

    if (response.status === 401) {
      csrfToken = '';
      showLogin('Your admin session has expired.');
      throw new Error('Authentication required.');
    }

    return response;
  }

  async function restoreSession() {
    try {
      const response = await api('/api/admin/session');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Could not check admin session.');
      if (!data.authenticated) return;

      csrfToken = data.csrfToken || '';
      showDashboard();
      await loadContent();
    } catch {
      setStatus(loginStatus, 'Could not check your admin session. Refresh to try again.', 'error');
    }
  }

  async function login(event) {
    event.preventDefault();
    setStatus(loginStatus, 'Signing in…');

    const submit = loginForm.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;

    try {
      const formData = new FormData(loginForm);
      const response = await api('/api/admin/login', {
        method: 'POST',
        body: {
          username: String(formData.get('username') || ''),
          password: String(formData.get('password') || '')
        }
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Login failed.');

      csrfToken = data.csrfToken || '';
      loginForm.reset();
      setStatus(loginStatus, '');
      showDashboard();
      await loadContent();
    } catch (error) {
      if (!dashboardView.hidden) return;
      setStatus(loginStatus, error instanceof Error ? error.message : 'Login failed.', 'error');
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function resetEditor() {
    contentForm.reset();
    contentId.value = '';
    contentKind.value = 'event';
    contentPublished.checked = true;
    contentPreview.src = '';
    contentPreviewWrap.hidden = true;
    editorTitle.textContent = 'Add something new.';
    saveButton.textContent = 'Publish event';
    cancelEditButton.hidden = true;
    imageRequiredLabel.textContent = '(required)';
    setStatus(contentStatus, '');
    updateTypeLabels();
  }

  function updateTypeLabels() {
    const kind = contentKind.value;
    const labels = {
      event: { date: 'Date & time', description: 'Write the useful detail a student actually needs. New lines are preserved.' },
      program: { date: 'Program date', description: 'Describe the program and who it is for. New lines are preserved.' },
      achievement: { date: 'Achievement date', description: 'Name the member or team, the competition, and what they achieved. New lines are preserved.' }
    };
    const selected = labels[kind] || labels.event;
    contentDateLabel.textContent = selected.date;
    contentDescriptionHelp.textContent = selected.description;
    saveButton.textContent = contentId.value ? 'Save changes' : `Publish ${kind}`;
  }

  function toDateTimeInput(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hour}:${minute}`;
  }

  function parseDateTimeInput(value) {
    const text = value.trim();
    if (!text) return null;

    const match = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/.exec(text);
    if (!match) throw new Error('Enter date and time as DD/MM/YYYY HH:MM (24-hour).');

    const [, dayText, monthText, yearText, hourText, minuteText] = match;
    const day = Number(dayText);
    const month = Number(monthText);
    const year = Number(yearText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const date = new Date(year, month - 1, day, hour, minute);

    if (year < 1000 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) {
      throw new Error('Enter a valid date and time as DD/MM/YYYY HH:MM.');
    }

    return date.toISOString();
  }

  function formatDate(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).format(new Date(value));
  }

  function startEdit(item) {
    contentId.value = item.id;
    contentKind.value = item.kind;
    contentTitle.value = item.title;
    contentDescription.value = item.description;
    contentDate.value = toDateTimeInput(item.eventDate);
    contentLocation.value = item.location || '';
    contentAlt.value = item.imageAlt || '';
    contentPublished.checked = item.published;
    contentImage.value = '';
    editorTitle.textContent = `Edit ${item.kind}.`;
    saveButton.textContent = 'Save changes';
    cancelEditButton.hidden = false;
    imageRequiredLabel.textContent = '(optional — keeps current image)';
    updateTypeLabels();

    if (item.imageUrl) {
      contentPreview.src = item.imageUrl;
      contentPreviewWrap.hidden = false;
    } else {
      contentPreview.src = '';
      contentPreviewWrap.hidden = true;
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function compressImage(file) {
    const bitmap = await createImageBitmap(file);
    const maxDimension = 1500;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Your browser could not process the image.');

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
    let mime = 'image/webp';

    if (!blob) {
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      mime = 'image/jpeg';
    }

    if (!blob) throw new Error('Could not compress image.');
    if (blob.size > 900 * 1024) {
      const secondTry = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.65));
      if (secondTry && secondTry.size <= 900 * 1024) {
        blob = secondTry;
        mime = 'image/jpeg';
      }
    }

    if (blob.size > 900 * 1024) {
      throw new Error('The image is still too large after compression. Choose a simpler image.');
    }

    const arrayBuffer = await blob.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
    }
    return {
      mime,
      data: `data:${mime};base64,${btoa(binary)}`
    };
  }

  async function submitContent(event) {
    event.preventDefault();
    setStatus(contentStatus, 'Saving…');
    saveButton.disabled = true;

    try {
      const existingId = contentId.value.trim();
      const eventDate = parseDateTimeInput(contentDate.value);
      const file = contentImage.files[0];
      let image = null;

      if (file) {
        image = await compressImage(file);
        image.alt = contentAlt.value.trim();
      } else if (!existingId) {
        throw new Error('Choose a picture for a new item.');
      }

      const payload = {
        kind: contentKind.value,
        title: contentTitle.value.trim(),
        description: contentDescription.value.trim(),
        eventDate,
        location: contentLocation.value.trim(),
        published: contentPublished.checked,
        image
      };

      const response = await api(
        existingId ? `/api/admin/content/${encodeURIComponent(existingId)}` : '/api/admin/content',
        {
          method: existingId ? 'PUT' : 'POST',
          body: payload
        }
      );

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Could not save content.');

      setStatus(contentStatus, existingId ? 'Changes saved.' : 'Published.', 'success');
      resetEditor();
      await loadContent();
    } catch (error) {
      setStatus(contentStatus, error instanceof Error ? error.message : 'Could not save content.', 'error');
    } finally {
      saveButton.disabled = false;
    }
  }

  async function loadContent() {
    setStatus(listStatus, 'Loading…');

    try {
      const response = await api('/api/admin/content');
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not load content.');

      allItems = Array.isArray(data.items) ? data.items : [];
      renderContent();
      updateStats();
      setStatus(listStatus, allItems.length ? `${allItems.length} managed item${allItems.length === 1 ? '' : 's'}.` : 'No events, programs, or achievements yet.');
    } catch (error) {
      setStatus(listStatus, error instanceof Error ? error.message : 'Could not load content.', 'error');
    }
  }

  function updateStats() {
    const eventCount = allItems.filter(item => item.kind === 'event').length;
    const programCount = allItems.filter(item => item.kind === 'program').length;
    const achievementCount = allItems.filter(item => item.kind === 'achievement').length;
    const publishedCount = allItems.filter(item => item.published).length;
    stats.event.textContent = eventCount;
    stats.program.textContent = programCount;
    stats.achievement.textContent = achievementCount;
    stats.published.textContent = publishedCount;
  }

  function renderContent() {
    contentList.replaceChildren();

    const filtered = currentFilter === 'all'
      ? allItems
      : allItems.filter(item => item.kind === currentFilter);

    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'admin-muted';
      empty.textContent = 'Nothing in this view yet.';
      contentList.appendChild(empty);
      return;
    }

    for (const item of filtered) {
      const article = document.createElement('article');
      article.className = 'managed-admin-card';

      if (item.imageUrl) {
        const media = document.createElement('div');
        media.className = 'managed-admin-media';
        const img = document.createElement('img');
        img.src = item.imageUrl;
        img.alt = item.imageAlt || '';
        img.loading = 'lazy';
        media.appendChild(img);
        article.appendChild(media);
      }

      const body = document.createElement('div');
      body.className = 'managed-admin-body';

      const meta = document.createElement('div');
      meta.className = 'managed-admin-meta';

      const tag = document.createElement('span');
      tag.className = 'managed-admin-tag';
      tag.textContent = item.kind;
      meta.appendChild(tag);

      if (!item.published) {
        const draft = document.createElement('span');
        draft.className = 'managed-admin-tag is-draft';
        draft.textContent = 'draft';
        meta.appendChild(draft);
      }

      if (item.eventDate) {
        const date = document.createElement('span');
        date.className = 'admin-muted';
        date.textContent = formatDate(item.eventDate);
        meta.appendChild(date);
      }

      body.appendChild(meta);

      const title = document.createElement('h3');
      title.textContent = item.title;
      body.appendChild(title);

      if (item.location) {
        const location = document.createElement('p');
        location.textContent = item.location;
        body.appendChild(location);
      }

      const description = document.createElement('p');
      description.textContent = item.description;
      description.classList.toggle('has-location-gap', Boolean(item.location));
      body.appendChild(description);

      const actions = document.createElement('div');
      actions.className = 'managed-admin-actions';

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => startEdit(item));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'delete-button';
      del.textContent = 'Remove';
      del.addEventListener('click', () => removeItem(item));

      actions.append(edit, del);
      body.appendChild(actions);

      article.appendChild(body);
      contentList.appendChild(article);
    }
  }

  async function removeItem(item) {
    const confirmed = window.confirm(`Remove “${item.title}” from the website? This permanently deletes its saved content and image.`);
    if (!confirmed) return;

    try {
      const response = await api(`/api/admin/content/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Could not remove item.');

      if (contentId.value === item.id) resetEditor();
      await loadContent();
    } catch (error) {
      setStatus(listStatus, error instanceof Error ? error.message : 'Could not remove item.', 'error');
    }
  }

  async function checkExportAccess() {
    // Keep the download action simple; the server enforces authentication.
    exportButton.addEventListener('click', event => {
      if (!csrfToken) {
        event.preventDefault();
        setStatus(listStatus, 'Sign in again before exporting membership data.', 'error');
      }
    });
  }

  contentImage.addEventListener('change', async () => {
    const file = contentImage.files[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      contentImage.value = '';
      setStatus(contentStatus, 'Choose a JPEG, PNG, or WebP image.', 'error');
      return;
    }

    const url = URL.createObjectURL(file);
    contentPreview.src = url;
    contentPreviewWrap.hidden = false;
    contentPreview.onload = () => URL.revokeObjectURL(url);
  });

  contentKind.addEventListener('change', updateTypeLabels);
  cancelEditButton.addEventListener('click', resetEditor);
  contentForm.addEventListener('submit', submitContent);
  loginForm.addEventListener('submit', login);

  logoutButton.addEventListener('click', async () => {
    try {
      await api('/api/admin/logout', { method: 'POST' });
    } catch { /* session may already be gone */ }
    csrfToken = '';
    resetEditor();
    showLogin();
  });

  filterButtons.forEach(button => {
    button.addEventListener('click', () => {
      currentFilter = button.dataset.filter || 'all';
      filterButtons.forEach(other => other.classList.toggle('active', other === button));
      renderContent();
    });
  });

  checkExportAccess();
  resetEditor();
  void restoreSession();
})();
