(() => {
  'use strict';

  const nav = document.querySelector('.site-nav');
  const toggle = document.querySelector('.menu-toggle');
  if (nav && toggle) {
    toggle.addEventListener('click', () => {
      const open = nav.dataset.open === 'true';
      nav.dataset.open = String(!open);
      toggle.setAttribute('aria-expanded', String(!open));
    });
    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) {
        nav.dataset.open = 'false';
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  document.querySelectorAll('.site-nav a[data-route]').forEach((link) => {
    const route = link.getAttribute('data-route');
    if (route === path) link.setAttribute('aria-current', 'page');
  });

  document.querySelectorAll('[data-year]').forEach((node) => {
    node.textContent = new Date().getFullYear();
  });

  const form = document.querySelector('#membership-form');
  const status = document.querySelector('#form-status');
  if (!form || !status) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.className = 'status';
    status.textContent = 'Submitting…';

    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;

    try {
      const formData = new FormData(form);
      const interests = formData.getAll('interests');
      const payload = {
        name: String(formData.get('name') || '').trim(),
        email: String(formData.get('email') || '').trim(),
        phone: String(formData.get('phone') || '').trim(),
        registerNumber: String(formData.get('registerNumber') || '').trim(),
        department: String(formData.get('department') || '').trim(),
        year: String(formData.get('year') || '').trim(),
        interests,
        motivation: String(formData.get('motivation') || '').trim(),
        website: String(formData.get('website') || '').trim()
      };

      const response = await fetch('/api/membership', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin'
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'We could not submit your application.');

      status.className = 'status success';
      status.textContent = `Application received. Your reference is ${data.reference}.`;
      form.reset();
    } catch (error) {
      status.className = 'status error';
      status.textContent = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
    } finally {
      if (button) button.disabled = false;
    }
  });
})();
