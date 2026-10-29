import { h, clear, modal, toast, fmtDate } from '../util.js';
import * as store from '../store.js';
import { api } from '../api.js';

export async function render(view) {
  if (!store.state.user || !store.state.user.admin) {
    view.append(h('div', { class: 'card' }, h('p', null, 'Admins only.')));
    return;
  }
  const box = h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Loading...'));
  view.append(h('h1', null, 'Admin'), box);

  async function load() {
    let users;
    try { users = (await api('GET', '/admin/users')).users; } catch (e) { clear(box).append(h('p', { class: 'err' }, e.message)); return; }
    const t = h('table', { class: 'list' }, h('tr', null,
      h('th', null, 'User'), h('th', null, 'Joined'), h('th', null, 'Last seen'), h('th', null, 'Rating'), h('th', null, 'Games'), h('th', null, '')));
    for (const u of users) {
      t.append(h('tr', null,
        h('td', null, u.username, u.admin ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, 'admin') : null),
        h('td', null, fmtDate(u.created_at)),
        h('td', null, u.last_seen ? fmtDate(u.last_seen) : '-'),
        h('td', null, u.r != null ? Math.round(u.r) : '-'),
        h('td', null, u.games || 0),
        h('td', null,
          h('button', { class: 'btn small', onclick: () => resetPw(u) }, 'Set password'), ' ',
          u.admin ? null : h('button', { class: 'btn small danger', onclick: () => del(u) }, 'Delete'))));
    }
    clear(box).append(h('p', { class: 'muted small' }, `${users.length} accounts. There is no email, so password resets happen here.`), t);
  }

  async function resetPw(u) {
    const input = h('input', { type: 'text', placeholder: 'New password (6+ characters)', style: { width: '100%' } });
    const pw = await modal({ title: 'New password for ' + u.username, body: input, buttons: [{ label: 'Cancel', value: null }, { label: 'Set password', value: () => input.value, primary: true }] });
    if (!pw) return;
    try { await api('POST', `/admin/users/${u.id}/password`, { password: pw }); toast('Password set. Their other sessions were signed out.'); } catch (e) { toast(e.message); }
  }

  async function del(u) {
    const ok = await modal({ title: 'Delete ' + u.username + '?', body: 'This removes the account and all its games.', buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, danger: true }] });
    if (!ok) return;
    try { await api('DELETE', `/admin/users/${u.id}`); toast('Deleted'); load(); } catch (e) { toast(e.message); }
  }

  load();
}
