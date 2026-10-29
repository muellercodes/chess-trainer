import { h, clear } from '../util.js';
import * as store from '../store.js';

export async function render(view) {
  let tab = 'login';
  const box = h('div', { class: 'card auth' });
  view.append(box);

  function draw() {
    clear(box);
    const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'off', spellcheck: false, maxLength: 20 });
    const pw = h('input', { type: 'password', autocomplete: tab === 'login' ? 'current-password' : 'new-password' });
    const pw2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const bring = h('input', { type: 'checkbox', checked: true });
    const err = h('p', { class: 'err small' });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, tab === 'login' ? 'Sign in' : 'Create account');
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        if (tab === 'signup' && pw.value !== pw2.value) { err.textContent = 'The passwords do not match.'; return; }
        btn.disabled = true;
        try {
          if (tab === 'login') await store.login(user.value.trim(), pw.value);
          else await store.signup(user.value.trim(), pw.value, guestProgress && bring.checked);
          location.hash = '#/';
        } catch (ex) {
          err.textContent = ex.message;
          btn.disabled = false;
        }
      },
    },
    h('label', { class: 'field' }, h('span', null, 'Username'), user),
    h('label', { class: 'field' }, h('span', null, 'Password'), pw),
    tab === 'signup' ? h('label', { class: 'field' }, h('span', null, 'Password again'), pw2) : null,
    tab === 'signup' && guestProgress ? h('label', { class: 'check small' }, bring, 'Bring over what I played as a guest') : null,
    err, btn);
    box.append(
      h('div', { class: 'tabs' },
        h('button', { class: tab === 'login' ? 'on' : '', onclick: () => { tab = 'login'; draw(); } }, 'Sign in'),
        h('button', { class: tab === 'signup' ? 'on' : '', onclick: () => { tab = 'signup'; draw(); } }, 'Create account')),
      form,
      h('p', { class: 'muted small', style: { marginTop: '14px' } }, tab === 'signup'
        ? 'Usernames are 3 to 20 letters, numbers or underscores. Passwords need at least 6 characters. No email needed. If you forget your password, ask the admin to reset it.'
        : 'No email on file, so there is no reset link. If you forget your password, ask the admin to reset it.'));
    user.focus();
  }

  const guestProgress = store.guestHasProgress();
  if (store.state.user) {
    view.append(h('p', { class: 'muted' }, 'You are signed in as ' + store.state.user.username + '.'));
  }
  draw();
}
