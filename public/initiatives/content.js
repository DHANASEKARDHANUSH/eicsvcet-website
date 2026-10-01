(() => {
  'use strict';

  const kinds = ['event', 'program', 'achievement'];
  const sections = Object.fromEntries(kinds.map(kind => [
    kind,
    document.querySelector(`[data-managed-content="${kind}"]`)
  ]));

  function makeCard(item) {
    const article = document.createElement('article');
    article.className = 'card managed-public-card';

    if (item.imageUrl) {
      const figure = document.createElement('div');
      figure.className = 'managed-public-media';
      const img = document.createElement('img');
      img.src = item.imageUrl;
      img.alt = item.imageAlt || '';
      img.loading = 'lazy';
      img.width = 1200;
      img.height = 675;
      figure.appendChild(img);
      article.appendChild(figure);
    }

    const body = document.createElement('div');
    body.className = 'managed-public-body';

    const type = document.createElement('div');
    type.className = 'managed-public-kicker';
    type.textContent = item.kind === 'achievement' ? 'Student achievement' : item.kind === 'event' ? 'Event' : 'Program';
    body.appendChild(type);

    const title = document.createElement('h3');
    title.textContent = item.title;
    body.appendChild(title);

    if (item.eventDate) {
      const date = document.createElement('p');
      date.className = 'managed-public-meta';
      date.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.eventDate));
      body.appendChild(date);
    }

    if (item.location) {
      const location = document.createElement('p');
      location.className = 'managed-public-meta';
      location.textContent = item.location;
      body.appendChild(location);
    }

    const description = document.createElement('p');
    description.textContent = item.description;
    body.appendChild(description);
    article.appendChild(body);

    return article;
  }

  async function load(kind) {
    const section = sections[kind];
    if (!section) return;

    try {
      const fullList = section.hasAttribute('data-achievements-full');
      const limit = kind === 'achievement' && !fullList ? '&limit=3' : '';
      const response = await fetch(`/api/public/content?kind=${encodeURIComponent(kind)}${limit}`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin'
      });
      if (!response.ok) return;
      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) return;

      const grid = section.querySelector('.managed-public-grid');
      if (!grid) return;
      grid.replaceChildren(...items.map(makeCard));
      section.hidden = false;
      if (kind === 'achievement' && !fullList && data.hasMore) {
        const more = document.createElement('a');
        more.className = 'button button-primary';
        more.href = '/initiatives/achievements/';
        more.textContent = 'See More';
        const action = document.createElement('div');
        action.className = 'managed-public-more';
        action.appendChild(more);
        grid.insertAdjacentElement('afterend', action);
      }
    } catch {
      // Existing static page remains usable if dynamic content is unavailable.
    }
  }

  kinds.forEach(load);
})();
