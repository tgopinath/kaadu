import { PLANTS, GROUPS } from './data.js';
import { TA_NAMES } from './data-ta.js';
import { STR, TA_GROUPS, GROUP_BLURB, FORM_ONE, TA_RANKS } from './i18n.js';

const INAT = 'https://api.inaturalist.org/v1';
const INDIA = 6681; // iNaturalist place ID for India
const app = document.getElementById('app');
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const icon = (n, cls = 'k-icon') => `<svg class="${cls}" aria-hidden="true"><use href="#${n.includes('-') ? n : 'i-' + n}"/></svg>`;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const byKey = Object.fromEntries(PLANTS.map(p => [p.key, p]));
const byId = Object.fromEntries(PLANTS.filter(p => p.id).map(p => [p.id, p]));
const groupByKey = Object.fromEntries(GROUPS.map(g => [g.key, g]));

// ---------------------------------------------------------------- language
let lang = store.get('kd.lang', 'en');
const isTa = () => lang === 'ta';
const tr = (k, v = {}) => (STR[lang]?.[k] ?? STR.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
const gLabel = g => (isTa() && TA_GROUPS[g.key]) || g.label;
const nm = p => (isTa() && TA_NAMES[p.key]) || p.name;
const langAttr = () => isTa() ? ' lang="ta"' : '';
function syncLang() {
  document.documentElement.lang = isTa() ? 'ta' : 'en';
  const b = $('#langBtn'); b.setAttribute('aria-checked', isTa()); b.setAttribute('aria-label', tr('lang_label'));
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = tr(el.dataset.t); });
  document.querySelectorAll('[data-t-ph]').forEach(el => { el.placeholder = tr(el.dataset.tPh); });
  document.querySelectorAll('[data-t-label]').forEach(el => { el.setAttribute('aria-label', tr(el.dataset.tLabel)); });
}
function toast(msg) {
  if (document.documentElement.classList.contains('k-android') && window.KolamM3) return KolamM3.snackbar(msg, { duration: 2600 });
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- app modes
// Android app (Capacitor shell, Android WebView or Chrome's installed app): Material Design 3 from the shared
// Kolam M3 kit (kolam-m3.js sets html.k-android; ?app=android / ?app=web force it on / off for this tab).
// iPhone app (Kaadu-iOS shell, Home Screen web app, or ?app=ios): Apple HIG from the shared Kolam iOS kit
// (kolam-ios.js sets html.k-ios). In a normal browser neither kit does anything.
try { localStorage.removeItem('kd.appmode'); } catch {} // the old hand-written iOS mode's switch
const APP = window.KolamIOS && (KolamIOS.isIOS || KolamIOS.detect(['Kaadu-iOS'])) ? 'ios' : window.KolamM3?.isAndroid ? 'android' : false;
const IOS = APP === 'ios', ANDROID = APP === 'android';
if (IOS) document.documentElement.classList.remove('k-android', 'k-app');
// Haptics: the iPhone app's native bridge, or the Android kit (Capacitor Haptics / vibrate).
const haptic = kind => {
  if (IOS) return KolamIOS.haptic(kind || 'light');
  if (ANDROID) return KolamM3.haptic(kind === 'success' ? 'medium' : kind === 'error' ? 'heavy' : 'light');
  try { window.webkit?.messageHandlers?.haptic?.postMessage(kind || 'light'); } catch {}
};

// ---------------------------------------------------------------- data access
const memo = new Map();
function api(path) {
  if (memo.has(path)) return memo.get(path);
  const p = fetch(INAT + path).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  memo.set(path, p); p.catch(() => memo.delete(path));
  return p;
}
const big = u => u?.replace(/\/(square|small|medium|thumb)\./, '/large.');
const med = u => u?.replace(/\/(square|small|thumb|large|original)\./, '/medium.');

// Library photos and ancestry come from iNaturalist in batches of 30, cached on the device for a day.
let lib = store.get('kd.lib.v2', null);
async function loadLibrary() {
  if (lib && Date.now() - lib.t < 864e5) return lib.map;
  const ids = PLANTS.map(p => p.id).filter(Boolean), map = {};
  for (let i = 0; i < ids.length; i += 30) {
    const r = await api(`/taxa/${ids.slice(i, i + 30).join(',')}`);
    for (const t of r.results) map[t.id] = { url: t.default_photo?.medium_url, by: t.default_photo?.attribution, obs: t.observations_count };
  }
  lib = { t: Date.now(), map }; store.set('kd.lib.v2', lib);
  return map;
}
const photoOf = p => lib?.map?.[p?.id]?.url;
const inGroup = (p, g) => g.key === 'all' || p.forms.includes(g.key);

// Tamil names for live species, from Wikidata (P3151 = iNaturalist taxon ID); cached per device.
const taCache = store.get('kd.ta.v1', {});
async function taNames(ids) {
  const want = ids.filter(id => !(id in taCache));
  if (want.length) {
    const q = `SELECT ?id ?label WHERE { VALUES ?id { ${want.map(id => `"${+id}"`).join(' ')} } ?item wdt:P3151 ?id . ?item rdfs:label ?label FILTER(lang(?label) = "ta") }`;
    try {
      const r = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q)).then(r => r.json());
      want.forEach(id => { taCache[id] = null; });
      for (const x of r.results.bindings) taCache[x.id.value] = x.label.value;
      store.set('kd.ta.v1', taCache);
    } catch {} // offline or busy: English this time
  }
  return Object.fromEntries(ids.filter(id => taCache[id]).map(id => [id, taCache[id]]));
}
function sentences(html, n = 3) {
  const d = document.createElement('div'); d.innerHTML = html || '';
  const text = d.textContent.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return (text.match(/[^.!?।]+[.!?।]+/g) || [text]).slice(0, n).join(' ').trim();
}
async function wikiSummary(title, host = 'en') {
  try {
    const r = await fetch(`https://${host}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
    if (!r.ok) return null;
    const j = await r.json();
    return j.type === 'disambiguation' || !j.extract ? null : { text: sentences(j.extract_html || j.extract, 3), url: j.content_urls?.desktop?.page };
  } catch { return null; }
}
async function tamilWiki(enTitle) {
  try {
    const ll = await fetch('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'query', prop: 'langlinks', lllang: 'ta', titles: enTitle, redirects: 1, format: 'json', origin: '*' })).then(r => r.json());
    const ta = Object.values(ll.query?.pages || {})[0]?.langlinks?.[0]?.['*'];
    return ta ? { ...(await wikiSummary(ta, 'ta')), title: ta } : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- saved
const saved = () => store.get('kd.saved', []);
const isSaved = h => saved().some(s => s.h === h);
function toggleSave(item) {
  const l = saved(), i = l.findIndex(s => s.h === item.h);
  if (i >= 0) l.splice(i, 1); else l.unshift(item);
  store.set('kd.saved', l); return i < 0;
}

// ---------------------------------------------------------------- saying a name aloud
// A blue speaker beside every name says it (English or Tamil voice), like Zoorassic Park.
let speakingBtn = null;
function say(text, btn, ta) {
  if (!('speechSynthesis' in window)) return toast(tr('no_voice'));
  speechSynthesis.cancel(); speakingBtn?.classList.remove('speaking');
  const u = new SpeechSynthesisUtterance(text);
  u.lang = ta ? 'ta-IN' : 'en-IN';
  const v = speechSynthesis.getVoices().find(v => v.lang.replace('_', '-').startsWith(u.lang)) || speechSynthesis.getVoices().find(v => v.lang.startsWith(ta ? 'ta' : 'en'));
  if (v) u.voice = v;
  u.rate = .9;
  speakingBtn = btn; btn?.classList.add('speaking');
  u.onend = u.onerror = () => btn?.classList.remove('speaking');
  speechSynthesis.speak(u);
}
const speak = (text, ta = isTa()) => { if ('speechSynthesis' in window) say(text, null, ta); };
const sayBtn = (name, ta, cls = 'say-name') => `<button class="${cls}" type="button" data-say="${esc(name)}"${ta ? ' data-ta="1"' : ''} aria-label="${esc(tr('say_name', { name }))}" title="${esc(tr('say_name', { name }))}">${icon('speak')}</button>`;
document.addEventListener('click', e => {
  const b = e.target.closest('[data-say]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  say(b.dataset.say, b, !!b.dataset.ta);
}, true);

// Cards say their plant's name: when tapped (the name is spoken as its page opens) and, with a mouse,
// when the pointer rests on a card for a moment. No speaker button on every card.
let pendingSay = null, hoverSay = 0;
document.addEventListener('click', e => { const a = e.target.closest('a.card'); if (a?.dataset.n && !matchMedia('(hover: hover) and (pointer: fine)').matches) pendingSay = { n: a.dataset.n, ta: !!a.dataset.nta }; }, true);
if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
  document.addEventListener('pointerover', e => {
    const a = e.target.closest('a.card'); if (!a || a.contains(e.relatedTarget)) return;
    clearTimeout(hoverSay); hoverSay = setTimeout(() => a.matches(':hover') && say(a.dataset.n, null, !!a.dataset.nta), 350);
  });
  document.addEventListener('pointerout', e => { const a = e.target.closest('a.card'); if (a && !a.contains(e.relatedTarget)) { clearTimeout(hoverSay); speechSynthesis?.cancel(); } });
}

// ---------------------------------------------------------------- cards
const img = (url, alt, lazy = true) => url ? `<img src="${url}" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ''} decoding="async" onload="this.classList.add('loaded')" onerror="this.remove()">` : '';
const FORM_KEYS = ['tree', 'shrub', 'vine', 'herb', 'grass', 'fern', 'succulent', 'aquatic', 'moss', 'palm', 'conifer'];
const formTag = forms => { const f = forms.find(x => FORM_KEYS.includes(x)); return f ? `<span class="tagform"${langAttr()}>${icon('f-' + f)}${esc(gLabel(groupByKey[f]))}</span>` : ''; };
// Photo with the name (and its speaker) laid over the bottom, Zoorassic Park style.
const card = ({ h, url, name, sub, forms = [], ta = false }) => `<a class="card" href="${h}" data-n="${esc(name)}"${ta ? ' data-nta="1"' : ''}>
    <div class="card-img">${img(url, name)}${formTag(forms)}</div>
    <div class="card-meta"><div><div class="name-row"><h3 class="card-name"${ta ? ' lang="ta"' : ''}>${esc(name)}</h3></div><div class="card-sub">${esc(sub)}</div></div></div></a>`;
const plantCard = p => card({ h: `#/p/${p.key}`, url: photoOf(p), name: nm(p), sub: p.sci, forms: p.forms, ta: isTa() && !!TA_NAMES[p.key] });
// Growth forms a live species belongs to, by its ancestry.
const formsOfAnc = anc => GROUPS.filter(g => !['all', 'flower'].includes(g.key) && g.ids.some(id => anc?.includes(id))).map(g => g.key);
function taxonCard(t, ta) {
  if (byId[t.id]) return plantCard(byId[t.id]);
  const en = cap(t.preferred_common_name || t.name), name = (isTa() && ta) || en;
  return card({ h: `#/t/${t.id}`, url: t.default_photo?.medium_url, name, sub: t.name, forms: formsOfAnc(t.ancestor_ids), ta: isTa() && !!ta });
}
const skelCards = n => Array.from({ length: n }, () => '<div class="card" aria-hidden="true"><div class="card-img skeleton"></div></div>').join('');
const skeleton = n => `<div class="grid" aria-hidden="true">${skelCards(n)}</div>`;

// Shelves: a title (with "See all" on hover) over a row of cards that scrolls sideways.
const shelf = (title, cards, href, { id } = {}) => `<section class="shelf"${id ? ` id="${id}"` : ''}>
    <h2 class="shelf-title">${href ? `<a href="${href}">${title}<span class="see">${tr('see_all')}${icon('next')}</span></a>` : title}</h2>
    <div class="shelf-wrap"><button class="shelf-arrow prev" type="button" data-dir="-1" aria-label="${tr('scroll_l')}">${icon('back')}</button><div class="shelf-track">${cards}</div><button class="shelf-arrow next" type="button" data-dir="1" aria-label="${tr('scroll_r')}">${icon('next')}</button></div>
  </section>`;
document.addEventListener('click', e => {
  const b = e.target.closest('.shelf-arrow'); if (!b) return;
  const r = b.parentElement.querySelector('.shelf-track');
  r.scrollBy({ left: +b.dataset.dir * r.clientWidth * .85, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
});

// Group filters carry plant photos, so the type reads at a glance.
const chipPics = g => `<span class="fpics">${g.pic.map(k => { const u = photoOf(byKey[k]); return u ? `<img src="${u.replace('/medium.', '/square.')}" alt="">` : ''; }).join('')}</span>`;
const chips = cur => `<nav class="filters" aria-label="${tr('groups_label')}">${GROUPS.map(g => `<a class="filter" href="${g.key === 'all' ? '#/' : '#/g/' + g.key}" aria-current="${g.key === cur}">${chipPics(g)}<span${langAttr()}>${esc(gLabel(g))}</span></a>`).join('')}</nav>`;

// ---------------------------------------------------------------- infinite list (no "Load more")
let io = null;
let scope = store.get('kd.scope', 'india');
function infinite(listEl, moreEl, { ids, skip }) {
  let page = 1, grid = null, busy = false, end = false;
  const q = `taxon_id=${ids.join(',')}&quality_grade=research&per_page=30&photos=true${scope === 'india' ? `&place_id=${INDIA}` : ''}`;
  async function load() {
    if (busy || end || !moreEl.isConnected) return;
    busy = true;
    if (grid) moreEl.innerHTML = `<div class="spinner" role="status" aria-label="${tr('loading_more')}"></div>`;
    try {
      const r = await api(`/observations/species_counts?${q}&page=${page}`);
      if (!moreEl.isConnected) return;
      if (!grid) { listEl.innerHTML = '<div class="grid"></div>'; grid = listEl.firstChild; }
      const items = r.results.map(x => x.taxon).filter(t => t.default_photo && !skip.has(t.id));
      const ta = isTa() ? await taNames(items.map(t => t.id)) : {};
      if (!moreEl.isConnected) return;
      grid.insertAdjacentHTML('beforeend', items.map(t => taxonCard(t, ta[t.id])).join(''));
      end = r.results.length < 30; page++;
      moreEl.innerHTML = end ? `<p>${tr('seen_all')}</p>` : '';
      busy = false;
      if (!end && moreEl.getBoundingClientRect().top < innerHeight + 600) load();
    } catch {
      busy = false;
      if (!moreEl.isConnected) return;
      const retry = `<button class="btn outline" type="button">${tr('try_again')}</button>`;
      if (grid) { moreEl.innerHTML = retry; moreEl.firstChild.onclick = load; }
      else { listEl.innerHTML = `<div class="empty"><b>${tr('no_connect')}</b>${tr('check_net')}<div style="margin-top:16px">${retry}</div></div>`; listEl.querySelector('button').onclick = () => { listEl.innerHTML = skeleton(8); load(); }; }
    }
  }
  io?.disconnect();
  io = new IntersectionObserver(es => { if (es[0].isIntersecting && !moreEl.querySelector('button')) load(); }, { rootMargin: '800px 0px' });
  io.observe(moreEl);
  load();
}

// ---------------------------------------------------------------- views
const SUGGEST = ['Neem', 'Lotus', 'Ficus', 'Orchid', 'Bamboo', 'Moss'];
const SUGGEST_TA = ['வேம்பு', 'தாமரை', 'மல்லிகை', 'மூங்கில்'];
function plantOfDay() { const d = Math.floor(Date.now() / 864e5); return PLANTS[d % PLANTS.length]; }
const byName = (a, b) => nm(a).localeCompare(nm(b), isTa() ? 'ta' : 'en');
const saveInner = on => `${icon(on ? 'bookmark-on' : 'bookmark')}<span>${tr(on ? 'saved' : 'save')}</span>`;
function wireSave(btn, item) {
  btn.onclick = () => {
    const on = toggleSave(item);
    btn.setAttribute('aria-pressed', on); btn.classList.toggle('on', on); btn.innerHTML = saveInner(on);
    toast(tr(on ? 'saved_toast' : 'unsaved_toast'));
  };
}
const scopeSwitch = () => `<div class="seg" role="group" aria-label="${tr('scope_label')}">
    <button type="button" data-scope="india" aria-pressed="${scope === 'india'}">${tr('scope_india')}</button>
    <button type="button" data-scope="world" aria-pressed="${scope === 'world'}">${tr('scope_world')}</button></div>`;
// Library grid, then the live iNaturalist list for a group, with the India / Worldwide switch.
function listFor(g, list) {
  app.querySelectorAll('[data-scope]').forEach(b => b.onclick = () => {
    if (scope === b.dataset.scope) return;
    scope = b.dataset.scope; store.set('kd.scope', scope);
    app.querySelectorAll('[data-scope]').forEach(x => x.setAttribute('aria-pressed', x.dataset.scope === scope));
    $('#list').innerHTML = skeleton(8); $('#more').innerHTML = '';
    infinite($('#list'), $('#more'), { ids: g.ids, skip: new Set(list.map(p => p.id)) });
  });
  const cur = $('.filter[aria-current="true"]'), row = $('.filters');
  if (cur && row) row.scrollLeft = cur.offsetLeft - row.offsetLeft - (row.clientWidth - cur.offsetWidth) / 2;
  infinite($('#list'), $('#more'), { ids: g.ids, skip: new Set(list.map(p => p.id)) });
}
const liveHead = g => `<div class="section-head">
    <div><span class="eyebrow">${tr('every_species')}</span><h2 class="h-section"${langAttr()}>${g.key === 'all' ? tr('all_live_all') : esc(tr('all_live', { group: isTa() ? gLabel(g) : g.label.toLowerCase() }))}</h2>
    ${g.proxy ? `<p class="note"${langAttr()}>${esc(tr('proxy_note', { group: gLabel(g), group_l: isTa() ? gLabel(g) : g.label.toLowerCase() }))}</p>` : ''}</div>
    ${scopeSwitch()}</div>`;

// Recently viewed plants (newest first, last 20), recorded when a plant page opens.
const recent = () => store.get('kd.recent', []);
function noteRecent(item) { store.set('kd.recent', [item, ...recent().filter(x => x.h !== item.h)].slice(0, 20)); }
const savedCard = s => s.h.startsWith('#/p/') && byKey[s.h.slice(4)] ? plantCard(byKey[s.h.slice(4)]) : card({ h: s.h, url: s.img, name: s.n, sub: s.sci });

// A to Z over the library grid: a letter shows only the plants that start with it, and says the letter.
// With Tamil on, the letters are the Tamil initials of the names on show.
const firstLetter = p => [...nm(p).trim()][0]?.toLocaleUpperCase() || '';
function azBar(list) {
  const have = new Set(list.map(firstLetter));
  const letters = isTa() ? [...have].sort((a, b) => a.localeCompare(b, 'ta')) : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  return `<nav class="az" aria-label="${tr('az_label')}"><button class="az-all" type="button" aria-pressed="true" data-az="">${tr('az_all')}</button>${letters.map(l => `<button type="button" data-az="${l}" aria-pressed="false"${have.has(l) ? '' : ' disabled'}${isTa() && /[\u0B80-\u0BFF]/.test(l) ? ' lang="ta"' : ''}>${l}</button>`).join('')}</nav>`;
}
function wireAz(list) {
  const bar = $('.az'), grid = $('#libGrid'); if (!bar || !grid) return;
  [...grid.children].forEach((c, i) => { c.dataset.letter = firstLetter(list[i]); });
  bar.addEventListener('click', e => {
    const btn = e.target.closest('button[data-az]'); if (!btn || btn.disabled) return;
    const l = btn.dataset.az;
    bar.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === btn));
    [...grid.children].forEach(c => { c.hidden = !!l && c.dataset.letter !== l; });
    if (l) speak(l.toLowerCase(), /[\u0B80-\u0BFF]/.test(l));
    haptic();
  });
}

async function viewHome(gk = 'all') {
  const g = groupByKey[gk] || GROUPS[0];
  if (!lib) { app.innerHTML = skeleton(8); await loadLibrary().catch(() => {}); }
  if (route.current !== location.hash) return;
  const list = PLANTS.filter(p => inGroup(p, g)).sort(byName);
  let head;
  if (g.key === 'all') {
    const f = plantOfDay(), fh = `#/p/${f.key}`, fs = isSaved(fh), fta = isTa() && !!TA_NAMES[f.key];
    const mine = saved(), rec = recent();
    head = `<section class="feature">
        <a class="feature-img" href="${fh}" tabindex="-1" aria-hidden="true">${img(big(photoOf(f)), '', false)}</a>
        <div class="feature-body">
          <span class="eyebrow">${tr('featured')}</span>
          <div class="title-row"><h1 class="h-display"${fta ? ' lang="ta"' : ''}>${esc(nm(f))}</h1>${sayBtn(nm(f), fta, 'say-name big')}</div>
          <p${langAttr()}>${esc(isTa() ? (GROUP_BLURB.ta[f.forms.find(k => FORM_KEYS.includes(k))] || '') : f.about)}</p>
          <div class="row">
            <a class="btn accent" href="${fh}"${langAttr()}>${esc(tr('meet', { name: isTa() ? nm(f) : f.name.toLowerCase() }))} ${icon('arrow')}</a>
            <button class="btn outline save${fs ? ' on' : ''}" id="heroSave" type="button" aria-pressed="${fs}">${saveInner(fs)}</button>
          </div>
        </div>
      </section>
      ${rec.length ? shelf(tr('recent'), rec.map(savedCard).join('')) : ''}
      ${mine.length ? shelf(tr('my_list'), mine.map(s => card({ h: s.h, url: s.img, name: s.n, sub: s.sci })).join(''), '#/saved') : ''}
      ${shelf(tr('top10'), skelCards(6), '', { id: 'top10' })}
      ${GROUPS.filter(x => x.key !== 'all' && x.key !== 'flower').map(x => {
        const l = PLANTS.filter(p => inGroup(p, x)).sort(byName);
        return l.length ? shelf(`<span${langAttr()}>${esc(gLabel(x))}</span>`, l.map(plantCard).join(''), `#/g/${x.key}`) : '';
      }).join('')}
      <div class="section-head"><div><span class="eyebrow">${tr('library')}</span><h2 class="h-section">${tr('every_plant')}</h2></div></div>`;
  } else {
    head = `<div class="page-head"><span class="eyebrow">${tr('group')}</span><h1 class="h-display"${langAttr()}>${esc(gLabel(g))}</h1><p class="lede"${langAttr()}>${esc(GROUP_BLURB[lang][g.key])}</p></div>`;
  }
  app.innerHTML = `${head}
    ${chips(g.key)}
    ${list.length > 6 ? azBar(list) : ''}
    ${list.length ? `<div class="grid" id="libGrid">${list.map(plantCard).join('')}</div>` : ''}
    ${liveHead(g)}
    <div id="list">${skeleton(8)}</div>
    <div class="more" id="more" aria-live="polite"></div>
    ${footer()}`;
  if (g.key === 'all') {
    const f = plantOfDay();
    wireSave($('#heroSave'), { h: `#/p/${f.key}`, n: nm(f), sci: f.sci, img: photoOf(f) });
    fillTop($('#top10'));
  }
  wireAz(list);
  listFor(g, list);
}

// Most-recorded plants in India on iNaturalist.
async function fillTop(el) {
  try {
    const r = await api(`/observations/species_counts?taxon_id=47126&place_id=${INDIA}&quality_grade=research&per_page=24&photos=true`);
    const items = r.results.map(x => x.taxon).filter(t => t.default_photo).slice(0, 20);
    const ta = isTa() ? await taNames(items.map(t => t.id)) : {};
    if (!el.isConnected) return;
    el.querySelector('.shelf-track').innerHTML = items.map(t => taxonCard(t, ta[t.id])).join('');
  } catch { el.remove(); }
}
const footer = () => `<footer class="foot"><b>${tr('about_app')}.</b> ${esc(tr('about_body'))} <a href="https://www.inaturalist.org" target="_blank" rel="noopener">iNaturalist</a> · <a href="https://www.wikipedia.org" target="_blank" rel="noopener">Wikipedia</a> · <a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a></footer>`;

async function viewTypes() {
  if (!lib) await loadLibrary().catch(() => {});
  if (route.current !== location.hash) return;
  app.innerHTML = `<div class="page-head"><h1 class="h-display">${tr('groups_title')}</h1><p class="lede">${tr('groups_lede')}</p></div>
    <div class="tiles">${GROUPS.filter(g => g.key !== 'all').map(g => {
      const n = PLANTS.filter(p => inGroup(p, g)).length, p = byKey[g.pic[0]];
      return `<a class="tile" href="#/g/${g.key}">${img(big(photoOf(p)), '')}<b${langAttr()}>${esc(gLabel(g))}</b><span${langAttr()}>${esc(GROUP_BLURB[lang][g.key])}</span><small>${tr('n_lib', { n })}</small></a>`;
    }).join('')}</div>${footer()}`;
}

function viewSearchHome() {
  const input = $('#searchInput'); input.value = '';
  app.innerHTML = `<div class="page-head"><h1 class="h-display">${tr('search_title')}</h1><p class="lede">${tr('search_lede')}</p>
    <div class="suggest">${(isTa() ? SUGGEST_TA : SUGGEST).map(s => `<a href="#/search/${encodeURIComponent(s)}">${esc(s)}</a>`).join('')}</div></div>
    <button class="id-card" type="button" data-identify><span class="id-card-ico">${icon('camera')}</span><span><b>${tr('id_card')}</b><small>${tr('id_card_d')}</small></span>${icon('next')}</button>
    ${shelf(tr('lib_title'), [...PLANTS].sort(byName).map(plantCard).join(''))}`;
  if (matchMedia('(pointer: fine)').matches) input.focus();
  if (!lib) loadLibrary().then(() => { if (location.hash === '#/search') viewSearchHome(); }).catch(() => {});
}

async function viewSearch(q) {
  q = q.trim(); const input = $('#searchInput'); if (input.value !== q) input.value = q;
  if (!lib) await loadLibrary().catch(() => {});
  const ql = q.toLowerCase();
  const local = PLANTS.filter(p => [p.name, p.sci, p.fam, p.key].some(s => s.toLowerCase().includes(ql)) || TA_NAMES[p.key]?.includes(q) ||
    GROUPS.some(g => p.forms.includes(g.key) && (g.label.toLowerCase().includes(ql) || TA_GROUPS[g.key]?.includes(q))));
  app.innerHTML = `<div class="page-head"><span class="eyebrow" id="sub" aria-live="polite">${tr('searching')}</span><h1 class="h-display">“${esc(q)}”</h1></div>
    ${local.length ? `<div class="section-head" style="margin-top:0"><h2 class="h-section">${tr('in_library')}</h2></div><div class="grid">${local.map(plantCard).join('')}</div>
      <div class="section-head"><h2 class="h-section">${tr('more_matches')}</h2></div>` : ''}
    <div id="remote">${skeleton(4)}</div>`;
  try {
    const r = await api(`/taxa/autocomplete?q=${encodeURIComponent(q)}&taxon_id=47126&per_page=30&is_active=true${isTa() ? '&locale=ta' : ''}`);
    if ($('#searchInput').value.trim() !== q || !$('#remote')) return;
    const seen = new Set(local.map(p => p.id));
    const res = r.results.filter(t => t.default_photo && !seen.has(t.id));
    const ta = isTa() ? await taNames(res.map(t => t.id)) : {};
    if (!$('#remote')) return;
    $('#remote').innerHTML = res.length ? `<div class="grid">${res.map(t => taxonCard(t, ta[t.id])).join('')}</div>`
      : local.length ? '' : `<div class="empty"><b>${tr('no_matches')}</b>${tr('no_matches_hint')}</div>`;
    $('#sub').textContent = tr('results', { n: local.length + res.length });
  } catch {
    if (!$('#remote')) return;
    $('#remote').innerHTML = local.length ? '' : `<div class="empty"><b>${tr('offline')}</b>${tr('offline_hint')}</div>`;
    $('#sub').textContent = tr('results', { n: local.length });
  }
}

function viewSaved() {
  const l = saved();
  app.innerHTML = `<div class="page-head"><h1 class="h-display">${tr('my_list')}</h1></div>
    ${l.length ? `<div class="grid">${l.map(s => card({ h: s.h, url: s.img, name: s.n, sub: s.sci })).join('')}</div>`
      : `<div class="empty"><b>${tr('saved_empty')}</b>${tr('saved_hint')}</div>`}`;
}

// ---------------------------------------------------------------- tree of life (after Zoorassic Park's Explore)
// Start at the plant kingdom; each branch shows its child taxa as photo tiles, most recorded first,
// loading more as the page scrolls. A species opens its plant page.
const PLANTAE = 47126;
const LEAF = ['species', 'hybrid', 'subspecies', 'variety', 'form'];
const rankLabel = r => (isTa() && TA_RANKS[r]) || cap(r);
const taxName = (t, ta) => (isTa() && ta) || cap(t.preferred_common_name || t.name);
const leafHref = id => byId[id] ? `#/p/${byId[id].key}` : `#/t/${id}`;
const num = n => (+n || 0).toLocaleString(isTa() ? 'ta-IN' : 'en-IN');
function treeTile(t, ta) {
  const name = taxName(t, ta), taOn = isTa() && !!ta;
  return `<a class="tile tol" href="${LEAF.includes(t.rank) ? leafHref(t.id) : `#/explore/${t.id}`}">${img(t.default_photo?.medium_url, '')}
    <span class="tol-rank"${langAttr()}>${esc(rankLabel(t.rank))}</span><b${taOn ? ' lang="ta"' : ''}>${esc(name)}</b>${name.toLowerCase() !== t.name.toLowerCase() ? `<i>${esc(t.name)}</i>` : ''}
    <small>${esc(tr('n_records', { n: num(t.observations_count) }))}</small></a>`;
}
const skelTiles = n => `<div class="tiles tol-grid" aria-hidden="true">${Array.from({ length: n }, () => '<div class="tile skeleton"></div>').join('')}</div>`;
function infiniteTaxa(listEl, moreEl, parent) {
  let page = 1, grid = null, busy = false, end = false;
  async function load() {
    if (busy || end || !moreEl.isConnected) return;
    busy = true;
    if (grid) moreEl.innerHTML = `<div class="spinner" role="status" aria-label="${tr('loading_branches')}"></div>`;
    try {
      const r = await api(`/taxa?parent_id=${parent}&is_active=true&per_page=30&page=${page}&order_by=observations_count&order=desc`);
      if (!moreEl.isConnected) return;
      if (!grid) { listEl.innerHTML = '<div class="tiles tol-grid"></div>'; grid = listEl.firstChild; }
      const items = r.results.filter(t => t.observations_count > 0);
      const ta = isTa() ? await taNames(items.map(t => t.id)) : {};
      if (!moreEl.isConnected) return;
      grid.insertAdjacentHTML('beforeend', items.map(t => treeTile(t, ta[t.id])).join(''));
      end = r.results.length < 30 || items.length < r.results.length || page * 30 >= r.total_results; page++;
      if (!grid.children.length) listEl.innerHTML = `<div class="empty"><b>${tr('no_branches')}</b></div>`;
      moreEl.innerHTML = end && grid.children.length > 6 ? `<p>${tr('seen_all')}</p>` : '';
      busy = false;
      if (!end && moreEl.getBoundingClientRect().top < innerHeight + 600) load();
    } catch {
      busy = false;
      if (!moreEl.isConnected) return;
      const retry = `<button class="btn outline" type="button">${tr('try_again')}</button>`;
      if (grid) { moreEl.innerHTML = retry; moreEl.firstChild.onclick = load; }
      else { listEl.innerHTML = `<div class="empty"><b>${tr('no_connect')}</b>${tr('check_net')}<div style="margin-top:16px">${retry}</div></div>`; listEl.querySelector('button').onclick = () => { listEl.innerHTML = skelTiles(6); load(); }; }
    }
  }
  io?.disconnect();
  io = new IntersectionObserver(es => { if (es[0].isIntersecting && !moreEl.querySelector('button')) load(); }, { rootMargin: '800px 0px' });
  io.observe(moreEl);
  load();
}
async function viewExplore(id = PLANTAE) {
  const here = location.hash;
  app.innerHTML = `<div class="page-head"><span class="eyebrow">${tr('nav_tree')}</span><div class="skeleton sk-line" style="height:40px;width:40%"></div></div>${skelTiles(9)}`;
  let t = null;
  try { t = (await api(`/taxa/${id}`)).results[0]; } catch {}
  if (location.hash !== here) return;
  if (!t) { app.innerHTML = `<div class="empty"><b>${tr('no_connect')}</b>${tr('check_net')}<div style="margin-top:16px"><button class="btn outline" type="button" id="retry">${tr('try_again')}</button></div></div>`; $('#retry').onclick = () => route({ keep: true }); return; }
  if (LEAF.includes(t.rank)) return location.replace(leafHref(id));
  if (id !== PLANTAE && !t.ancestor_ids?.includes(PLANTAE)) return location.replace('#/explore');
  // The path from the plant kingdom down to here.
  const path = [...(t.ancestors || []).filter(a => t.ancestor_ids.indexOf(a.id) >= t.ancestor_ids.indexOf(PLANTAE)), t];
  const ta = isTa() ? await taNames(path.map(a => a.id)) : {};
  if (location.hash !== here) return;
  const name = id === PLANTAE ? tr('tree_title') : taxName(t, ta[t.id]), taOn = isTa() && (id === PLANTAE || !!ta[t.id]);
  const up = path.length > 1 ? (path[path.length - 2].id === PLANTAE ? '#/explore' : `#/explore/${path[path.length - 2].id}`) : null;
  const kids = ['genus', 'subgenus', 'section', 'complex'].includes(t.rank) ? 'tree_species' : 'tree_branches';
  app.innerHTML = `
    ${path.length > 1 ? `<nav class="crumbs" aria-label="${tr('tree_where')}">${path.map((a, i) => i === path.length - 1
      ? `<span aria-current="page"${isTa() && ta[a.id] ? ' lang="ta"' : ''}>${esc(taxName(a, ta[a.id]))}</span>`
      : `<a href="${a.id === PLANTAE ? '#/explore' : `#/explore/${a.id}`}"${isTa() && ta[a.id] ? ' lang="ta"' : ''}>${esc(a.id === PLANTAE ? tr('nav_tree') : taxName(a, ta[a.id]))}</a>${icon('next')}`).join('')}</nav>` : ''}
    <div class="page-head"><span class="eyebrow"${langAttr()}>${esc(id === PLANTAE ? tr('nav_tree') : rankLabel(t.rank))}</span>
      <div class="title-row"><h1 class="h-display"${taOn ? ' lang="ta"' : ''}>${esc(name)}</h1>${id === PLANTAE ? '' : sayBtn(name, taOn, 'say-name big')}</div>
      <p class="lede">${id === PLANTAE ? esc(tr('tree_lede')) : `${name.toLowerCase() !== t.name.toLowerCase() ? `<i>${esc(t.name)}</i> · ` : ''}${esc(tr('n_records', { n: num(t.observations_count) }))}`}</p></div>
    <div class="section-head" style="margin-top:8px"><h2 class="h-section">${tr(kids)}</h2></div>
    <div id="list">${skelTiles(9)}</div>
    <div class="more" id="more" aria-live="polite"></div>`;
  appBar(id === PLANTAE ? tr('nav_tree') : name, up, taOn && id !== PLANTAE);
  document.title = `${id === PLANTAE ? tr('nav_tree') : name} · Kaadu`;
  infiniteTaxa($('#list'), $('#more'), id);
}

// ---------------------------------------------------------------- games (after Zoorassic Park's)
// Five games over the library: Name it, Which type?, Odd one out, Find it and Memory match.
// Rounds of 10 questions; a right answer chimes, throws confetti and moves on by itself after 2 s.
let actx;
const ac = () => (actx ||= new (window.AudioContext || window.webkitAudioContext)());
function tone(freqs, { type = 'triangle', dur = .14, gap = .09, vol = .22, slide } = {}) {
  try {
    const c = ac(); c.resume?.();
    freqs.forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + i * gap;
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + .05);
    });
  } catch {}
}
const sfxWin = () => tone([523.3, 659.3, 784, 1046.5, 1318.5], { dur: .22, gap: .08 });
const sfxFlop = () => tone([311, 233], { type: 'sawtooth', dur: .32, gap: .3, vol: .12, slide: .72 });
function confetti(from) {
  if (calm() || !from?.isConnected) return;
  const r = from.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const colors = ['#1d6b45', '#7CC6A3', '#F2B33D', '#E5487A', '#4A7DF0', '#FF7A45'];
  const box = document.createElement('div'); box.className = 'confetti'; box.setAttribute('aria-hidden', 'true'); document.body.appendChild(box);
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('i');
    p.style.cssText = `left:${cx}px;top:${cy}px;background:${colors[i % colors.length]};${i % 3 ? '' : 'border-radius:50%;'}`;
    box.appendChild(p);
    const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 260;
    p.animate([
      { transform: 'translate(-50%,-50%) rotate(0)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d - 120}px)) rotate(${Math.random() * 720}deg)`, opacity: 1, offset: .6 },
      { transform: `translate(calc(-50% + ${Math.cos(a) * d * 1.1}px), calc(-50% + ${Math.sin(a) * d + 220}px)) rotate(${Math.random() * 900}deg)`, opacity: 0 },
    ], { duration: 1300 + Math.random() * 600, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
  }
  setTimeout(() => box.remove(), 2200);
}
function celebrate(el) { sfxWin(); confetti(el); haptic('success'); }
function flop(el) { sfxFlop(); haptic('error'); if (!calm()) el.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(0)' }], { duration: 380 }); }

const GAMES = [
  { key: 'name', icon: 'eye', t: 'g_name', ask: 'g_name_ask', d: 'gd_name' },
  { key: 'group', icon: 'f-tree', t: 'g_group', ask: 'g_group_ask', d: 'gd_group' },
  { key: 'odd', icon: 'shuffle', t: 'g_odd', ask: 'g_odd_ask', d: 'gd_odd' },
  { key: 'find', icon: 'search', t: 'g_find', ask: 'g_find_ask', d: 'gd_find' },
  { key: 'memory', icon: 'cards', t: 'g_memory', ask: 'g_memory_ask', d: 'gd_memory' },
  { key: 'fv', icon: 'f-fruit', t: 'g_fv', ask: 'g_fv_ask', d: 'gd_fv' },
];
const gameByKey = Object.fromEntries(GAMES.map(g => [g.key, g]));
const formOf = p => p.forms.find(f => FORM_KEYS.includes(f));
const hasTa = p => isTa() && !!TA_NAMES[p.key];
const taOf = p => hasTa(p) ? ' lang="ta"' : '';
const theName = p => isTa() ? nm(p) : p.name.toLowerCase();
async function gamePool() {
  if (!lib) await loadLibrary().catch(() => {});
  return PLANTS.filter(p => photoOf(p) && formOf(p));
}
const scores = new Proxy({}, { get: (o, m) => (o[m] ||= store.get(`kd.score.${m}`, { stars: 0, played: 0, streak: 0 })) });
const saveScore = mode => store.set(`kd.score.${mode}`, scores[mode]);
const cheer = () => { const c = tr('cheers').split('|'); return c[Math.floor(Math.random() * c.length)]; };
let lastAnswer, announceTimer, autoNextTimer;
const pickAnswer = pool => { let a; do { a = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && a === lastAnswer); return (lastAnswer = a); };
function scoreAnswer(mode, missed) {
  const sc = scores[mode];
  sc.played++;
  if (!missed) { sc.stars++; sc.streak = (sc.streak || 0) + 1; } else sc.streak = 0;
  saveScore(mode);
  const st = app.querySelectorAll('.stat b');
  if (st.length) { st[0].textContent = sc.stars; st[1].textContent = sc.streak; }
}
// After a right answer the next question comes by itself in 2 s (3 s after a wrong one); the Next button fills meanwhile.
function autoNext(c, ms = 2000) {
  const next = $('#next'); if (!next) return;
  next.classList.add('auto'); next.style.setProperty('--auto-ms', `${ms}ms`);
  clearTimeout(autoNextTimer);
  autoNextTimer = setTimeout(() => { if (c.isConnected && next.isConnected) next.click(); }, ms);
}
// Rounds of 10 questions, with "3 of 10" progress and a results screen at the end.
const ROUND = 10;
let round = { mode: null, done: 0, right: 0 };
const roundFor = mode => { if (round.mode !== mode) round = { mode, done: 0, right: 0 }; return round; };
function resolveQ(mode, correct) { const r = roundFor(mode); r.done++; if (correct) r.right++; paintProgress(); }
const progressHtml = mode => { const r = roundFor(mode), n = Math.min(r.done + 1, ROUND); return `<div class="qprog" id="qprog" role="progressbar" aria-label="${esc(tr('q_of', { n, total: ROUND }))}" aria-valuemin="0" aria-valuemax="${ROUND}" aria-valuenow="${r.done}"><span>${tr('q_of', { n, total: ROUND })}</span><div class="qprog-dots" aria-hidden="true">${Array.from({ length: ROUND }, (_, i) => `<i class="${i < r.done ? 'done' : i === r.done ? 'now' : ''}"></i>`).join('')}</div><small>${tr('q_left', { n: ROUND - r.done })}</small></div>`; };
function paintProgress() { const el = $('#qprog'); if (el) el.outerHTML = progressHtml(round.mode); }
// After the 10th question, "Next" opens the results instead of another question.
document.addEventListener('click', e => {
  if (!e.target.closest('#next') || round.done < ROUND) return;
  e.stopImmediatePropagation(); clearTimeout(autoNextTimer); clearTimeout(announceTimer); showResults(round.mode);
}, true);
function showResults(mode) {
  const r = round, g = gameByKey[mode], line = tr('you_got', { n: r.right, total: ROUND });
  app.innerHTML = `<section class="quiz results">
    <span class="eyebrow">${tr(g.t)}</span><h1 class="h-display">${tr('round_done')}</h1>
    <div class="res-card"><div class="res-big"><strong>${r.right}</strong><span>/ ${ROUND}</span></div>
      <div class="res-stars" role="img" aria-label="${esc(line)}">${Array.from({ length: 5 }, (_, i) => `<i class="${i < Math.round(r.right / 2) ? 'on' : ''}">${icon('star')}</i>`).join('')}</div>
      <p class="res-line" role="status">${esc(line)}</p></div>
    <div class="row res-acts"><button class="btn accent" type="button" id="again">${icon('play')} ${tr('play_again')}</button><a class="btn outline" href="#/game">${tr('all_games')}</a></div></section>`;
  celebrate($('.res-card')); speak(line);
  $('#again').onclick = () => { round = { mode: null }; route(); };
}
// The game's title and question (with a speaker), the score, and the round's progress.
function quizHead(mode) {
  const sc = scores[mode], g = gameByKey[mode];
  return `<nav class="quiz-modes" aria-label="${tr('games_title')}"><a href="#/game">${icon('back')} ${tr('all_games')}</a></nav>
    <div class="quiz-top">
      <div><span class="eyebrow">${tr(g.t)}</span><div class="title-row"><h1 class="h-display">${tr(g.ask)}</h1>${sayBtn(tr(g.ask), isTa())}</div></div>
      <div class="stats"><div class="stat"><b>${sc.stars}</b><span>${tr('correct')}</span></div><div class="stat"><b>${sc.streak || 0}</b><span>${tr('streak')}</span></div></div>
    </div>
    ${mode !== 'memory' ? progressHtml(mode) : ''}`;
}
const quizEmpty = mode => { app.innerHTML = `<section class="quiz">${quizHead(mode)}<div class="empty"><b>${tr('quiz_empty')}</b>${tr('quiz_need_net')}<div style="margin-top:14px"><button class="btn outline" type="button" id="retry">${tr('try_again')}</button></div></div></section>`; $('#retry').onclick = () => { memo.clear(); lib = null; route({ keep: true }); }; };
const feedback = () => `<div class="feedback"><p id="cheer" role="status" aria-live="polite"></p><div id="fact"></div><div class="row"><button class="btn accent" type="button" id="next" hidden>${tr('next_question')} ${icon('arrow')}</button></div></div>`;
const cheerLine = (missed, text, href) => `<span class="${missed ? 'no' : 'ok'}">${missed ? tr('oops') : cheer()} — ${esc(text)}</span>${href ? ` <a class="more-link" href="${href}">${tr('learn_more')}</a>` : ''}`;
// After every answer, a short "Did you know?" card about the plant, so each question teaches something.
function showFact(p) {
  const el = $('#fact'); if (!el || !p) return;
  const f = formOf(p), bits = [p.h && `${icon('ruler')}${esc(p.h)}`, p.nat && `${icon('globe')}${esc(p.nat)}`, p.uses && `${icon('hand')}${esc(p.uses)}`].filter(Boolean);
  el.innerHTML = `<aside class="did-know" aria-label="${tr('did_you_know')}">
    ${photoOf(p) ? `<img src="${photoOf(p).replace('/medium.', '/square.')}" alt="">` : ''}
    <div><b>${icon('spark')}${tr('did_you_know')}</b>
      <p${isTa() ? ' lang="ta"' : ''}>${esc(isTa() ? `${nm(p)}: ${GROUP_BLURB.ta[f] || ''}` : p.about)}</p>
      ${bits.length ? `<ul>${bits.map(b => `<li>${b}</li>`).join('')}</ul>` : ''}</div></aside>`;
}
// A photo to pick (names hidden in "Find it" until the answer is in).
const photoChoice = (p, i, showName = true) => `<div class="choice-wrap"><button class="choice pick" type="button" data-k="${p.key}"${showName ? '' : ` aria-label="${esc(tr('photo_n', { i: i + 1, n: 4 }))}"`}><img src="${photoOf(p)}" alt=""><div${taOf(p)}${showName ? '' : ' hidden'}>${esc(nm(p))}</div></button>${showName ? sayBtn(nm(p), hasTa(p), 'say-opt in-choice') : ''}</div>`;

// Shared answer handling: celebrate a right answer and move on; a wrong one flops and shows the right one.
function wireAnswers(mode, sel, isRight, onRight, again) {
  let done = false;
  app.querySelectorAll(sel).forEach(c => c.onclick = () => {
    if (done) return;
    done = true; window.speechSynthesis?.cancel();
    const ok = isRight(c) ? c : [...app.querySelectorAll(sel)].find(isRight), right = ok === c;
    ok?.classList.add('right'); if (!right) { c.classList.add('wrong'); ok?.classList.add('reveal'); flop(c); } else celebrate(c);
    app.querySelectorAll(sel).forEach(x => x !== c && x !== ok && x.classList.add('dim'));
    scoreAnswer(mode, !right); resolveQ(mode, right);
    onRight(ok || c, !right);
    $('#next').hidden = false; autoNext(c, right ? 6000 : 8000); // time to read the fact card
  });
  $('#next').onclick = () => { clearTimeout(announceTimer); clearTimeout(autoNextTimer); again(); };
}
// Each game's question waits for the library photos; if the player left meanwhile, nothing is drawn.
async function ready(mode) {
  const here = location.hash, pool = await gamePool();
  if (location.hash !== here) return null;
  if (pool.length < 6) { quizEmpty(mode); return null; }
  return pool;
}

// Name it: see a photo, pick its name from four (two of them the same type of plant).
async function viewNameGame() {
  const pool = await ready('name'); if (!pool) return;
  const answer = pickAnswer(pool), f = formOf(answer);
  const near = shuffle(pool.filter(p => p !== answer && p.forms.includes(f))).slice(0, 2);
  const far = shuffle(pool.filter(p => p !== answer && !near.includes(p))).slice(0, 3 - near.length);
  const opts = shuffle([answer, ...near, ...far]);
  app.innerHTML = `<section class="quiz">${quizHead('name')}
    <figure class="name-photo"><img id="qimg" src="${big(photoOf(answer))}" alt="${tr('mystery')}"><figcaption id="qcredit">${esc(lib.map[answer.id]?.by || '')}</figcaption></figure>
    <div class="name-choices">${opts.map(o => `<div class="name-opt"><button class="name-choice pick" type="button" data-k="${o.key}"${taOf(o)}>${esc(nm(o))}</button>${sayBtn(nm(o), hasTa(o), 'say-opt')}</div>`).join('')}</div>
    ${feedback()}</section>`;
  // A random real photo, not always the one on the library card.
  api(`/taxa/${answer.id}`).then(r => {
    const ph = shuffle(r.results[0]?.taxon_photos || [])[0]?.photo;
    if (ph && lastAnswer === answer && $('#qimg')) { $('#qimg').src = big(ph.medium_url); $('#qcredit').textContent = ph.attribution || ''; }
  }).catch(() => {});
  wireAnswers('name', '.pick', c => c.dataset.k === answer.key, (c, missed) => {
    $('#cheer').innerHTML = cheerLine(missed, tr('its_the', { name: theName(answer) }), `#/p/${answer.key}`); showFact(answer);
    announceTimer = setTimeout(() => speak(nm(answer), hasTa(answer)), 550);
  }, viewNameGame);
}

// Which type? A plant's photo and name; pick how it grows (tree, vine, fern…), with the type icons.
const formName = (k, one) => one ? FORM_ONE[lang][k] : gLabel(groupByKey[k]);
async function viewGroupGame() {
  const pool = await ready('group'); if (!pool) return;
  const answer = pickAnswer(pool), f = formOf(answer);
  const opts = shuffle([f, ...shuffle(FORM_KEYS.filter(k => !answer.forms.includes(k))).slice(0, 3)]);
  app.innerHTML = `<section class="quiz">${quizHead('group')}
    <figure class="name-photo"><img src="${big(photoOf(answer))}" alt="${esc(nm(answer))}"><figcaption>${esc(lib.map[answer.id]?.by || '')}</figcaption></figure>
    <div class="title-row group-name"><b${taOf(answer)}>${esc(nm(answer))}</b>${sayBtn(nm(answer), hasTa(answer))}</div>
    <div class="name-choices">${opts.map(k => `<div class="name-opt"><button class="name-choice form-choice pick" type="button" data-c="${k}"${langAttr()}>${icon('f-' + k)}<span>${esc(formName(k))}</span></button>${sayBtn(formName(k), isTa(), 'say-opt')}</div>`).join('')}</div>
    ${feedback()}</section>`;
  wireAnswers('group', '.pick', c => answer.forms.includes(c.dataset.c), (c, missed) => {
    $('#cheer').innerHTML = cheerLine(missed, tr('is_a', { name: isTa() ? nm(answer) : answer.name, form: formName(f, true) }), `#/p/${answer.key}`); showFact(answer);
    announceTimer = setTimeout(() => speak(formName(f)), 550);
  }, viewGroupGame);
}

// Fruit or vegetable? A photo and name; pick how we eat it. Vegetables that are fruits to a botanist say so.
const BOTANIC_FRUIT = new Set(['tomato', 'brinjal', 'okra', 'chilli', 'bittergourd', 'bottlegourd', 'pumpkin', 'cucumber', 'snakegourd', 'ivygourd', 'drumstick']);
async function viewFvGame() {
  const all = await ready('fv'); if (!all) return;
  const pool = all.filter(p => p.forms.includes('fruit') || p.forms.includes('veg'));
  if (pool.length < 6) return quizEmpty('fv');
  const answer = pickAnswer(pool), k = answer.forms.includes('fruit') ? 'fruit' : 'veg';
  app.innerHTML = `<section class="quiz">${quizHead('fv')}
    <figure class="name-photo"><img src="${big(photoOf(answer))}" alt="${esc(nm(answer))}"><figcaption>${esc(lib.map[answer.id]?.by || '')}</figcaption></figure>
    <div class="title-row group-name"><b${taOf(answer)}>${esc(nm(answer))}</b>${sayBtn(nm(answer), hasTa(answer))}</div>
    <div class="name-choices fv-choices">${['fruit', 'veg'].map(x => `<div class="name-opt"><button class="name-choice form-choice pick" type="button" data-c="${x}"${langAttr()}>${icon('f-' + x)}<span>${esc(gLabel(groupByKey[x]))}</span></button>${sayBtn(gLabel(groupByKey[x]), isTa(), 'say-opt')}</div>`).join('')}</div>
    ${feedback()}</section>`;
  wireAnswers('fv', '.pick', c => c.dataset.c === k, (c, missed) => {
    const line = tr(k === 'fruit' ? 'fv_fruit' : (BOTANIC_FRUIT.has(answer.key) ? 'fv_veg_fruit' : 'fv_veg'), { name: isTa() ? nm(answer) : answer.name });
    $('#cheer').innerHTML = cheerLine(missed, line, `#/p/${answer.key}`); showFact(answer);
    announceTimer = setTimeout(() => speak(gLabel(groupByKey[k])), 550);
  }, viewFvGame);
}

// Odd one out: three plants that grow the same way, and one that doesn't.
async function viewOddGame() {
  const pool = await ready('odd'); if (!pool) return;
  let A, odd, same;
  for (let i = 0; i < 30 && !same; i++) {
    const forms = FORM_KEYS.filter(k => pool.filter(p => p.forms.includes(k)).length >= 3);
    A = forms[Math.floor(Math.random() * forms.length)];
    odd = shuffle(pool.filter(p => !p.forms.includes(A)))[0];
    // None of the three may also share the odd one's type, so only one answer is right.
    const three = shuffle(pool.filter(p => p.forms.includes(A) && !p.forms.includes(formOf(odd)))).slice(0, 3);
    if (three.length === 3 && odd !== lastAnswer) same = three;
  }
  if (!same) return quizEmpty('odd');
  lastAnswer = odd;
  const opts = shuffle([...same, odd]);
  app.innerHTML = `<section class="quiz">${quizHead('odd')}
    <div class="choices">${opts.map((o, i) => photoChoice(o, i)).join('')}</div>${feedback()}</section>`;
  speak(tr('g_odd_ask'));
  wireAnswers('odd', '.pick', c => c.dataset.k === odd.key, (c, missed) => {
    $('#cheer').innerHTML = cheerLine(missed, tr('odd_explain', { name: isTa() ? nm(odd) : odd.name.toLowerCase(), form: formName(formOf(odd), true), others: isTa() ? gLabel(groupByKey[A]) : groupByKey[A].label.toLowerCase() }), `#/p/${odd.key}`); showFact(odd);
    announceTimer = setTimeout(() => speak(nm(odd), hasTa(odd)), 550);
  }, viewOddGame);
}

// Find it: hear (and see) a name, tap the right photo out of four.
async function viewFindGame() {
  const pool = await ready('find'); if (!pool) return;
  const answer = pickAnswer(pool);
  let others = shuffle(pool.filter(p => p !== answer && formOf(p) !== formOf(answer)));
  if (others.length < 3) others = shuffle(pool.filter(p => p !== answer));
  const opts = shuffle([answer, ...others.slice(0, 3)]);
  app.innerHTML = `<section class="quiz">${quizHead('find')}
    <div class="quiz-player"><button class="sound-play" type="button" id="sayAns" aria-label="${esc(tr('say_name', { name: nm(answer) }))}">${icon('speak')}</button>
      <div><b class="find-name"${taOf(answer)}>${esc(nm(answer))}</b><p>${tr('find_hint')}</p></div></div>
    <div class="choices">${opts.map((o, i) => photoChoice(o, i, false)).join('')}</div>${feedback()}</section>`;
  const sayAns = () => say(nm(answer), $('#sayAns'), hasTa(answer));
  $('#sayAns').onclick = sayAns; setTimeout(sayAns, 250);
  wireAnswers('find', '.pick', c => c.dataset.k === answer.key, (c, missed) => {
    app.querySelectorAll('.pick div').forEach(d => (d.hidden = false));
    app.querySelectorAll('.pick').forEach(b => b.removeAttribute('aria-label'));
    $('#cheer').innerHTML = cheerLine(missed, tr('its_the', { name: theName(answer) }), `#/p/${answer.key}`); showFact(answer);
  }, viewFindGame);
}

// Memory match: turn two cards at a time to find the six pairs.
async function viewMemoryGame() {
  const pool = await ready('memory'); if (!pool) return;
  const picks = shuffle(pool).slice(0, 6), cards = shuffle([...picks, ...picks]);
  const best = store.get('kd.memory.best', 0);
  app.innerHTML = `<section class="quiz">${quizHead('memory')}
    <p class="lede" style="margin:12px 0 14px">${tr('memory_hint')}${best ? ` · ${tr('memory_best', { n: best })}` : ''}</p>
    <div class="memory">${cards.map((p, i) => `<button class="mem" type="button" data-k="${p.key}" aria-label="${esc(tr('card_n', { n: i + 1 }))}"><span class="back">${icon('leaf')}</span><span class="front"><img src="${photoOf(p)}" alt=""><b${taOf(p)}>${esc(nm(p))}</b></span></button>`).join('')}</div>
    <div class="feedback"><p id="cheer" role="status" aria-live="polite">${tr('moves', { n: 0 })} · ${tr('pairs_left', { n: picks.length })}</p><div class="row"><button class="btn accent" type="button" id="again" hidden>${tr('play_again')} ${icon('arrow')}</button></div></div></section>`;
  speak(tr('g_memory_ask'));
  let open = [], moves = 0, found = 0, lock = false;
  app.querySelectorAll('.mem').forEach(c => c.onclick = () => {
    if (lock || c.classList.contains('up')) return;
    const p = byKey[c.dataset.k];
    c.classList.add('up'); c.setAttribute('aria-label', nm(p)); open.push(c);
    if (open.length < 2) return;
    moves++;
    const [a, b] = open; open = [];
    const same = a.dataset.k === b.dataset.k;
    $('#cheer').textContent = `${tr('moves', { n: moves })} · ${tr('pairs_left', { n: picks.length - found - (same ? 1 : 0) })}`;
    if (same) {
      a.classList.add('matched'); b.classList.add('matched'); found++;
      tone([660, 880], { dur: .12, gap: .07 }); haptic();
      setTimeout(() => speak(nm(p), hasTa(p)), 250);
      if (found === picks.length) {
        scoreAnswer('memory', false);
        if (!best || moves < best) store.set('kd.memory.best', moves);
        setTimeout(() => { celebrate(b); $('#cheer').innerHTML = `<span class="ok">${tr('memory_done', { n: moves })}</span>`; speak(tr('memory_done', { n: moves })); $('#again').hidden = false; $('#again').focus(); }, 700);
      }
    } else {
      lock = true;
      setTimeout(() => { sfxFlop(); [a, b].forEach((x, i) => { x.classList.remove('up'); x.setAttribute('aria-label', tr('card_n', { n: [...x.parentElement.children].indexOf(x) + 1 })); }); lock = false; }, 900);
    }
  });
  $('#again').onclick = () => viewMemoryGame();
}

// The games screen: each card leads with a small picture of the game itself, made from real plant photos.
const gp = k => { const u = photoOf(byKey[k]); return u ? `<img src="${esc(u.replace('/medium.', '/small.'))}" alt="" loading="lazy">` : '<i></i>'; };
const gname = k => esc(nm(byKey[k]));
const GAME_ART = {
  name: () => `<div class="ga ga-name"><span class="ga-photo">${gp('lotus')}</span><div class="ga-chips">${['waterlily', 'lotus', 'hyacinth'].map(k => `<b class="${k === 'lotus' ? 'ok' : ''}"${taOf(byKey[k])}>${gname(k)}</b>`).join('')}</div></div>`,
  group: () => `<div class="ga ga-name"><span class="ga-photo">${gp('coconut')}</span><div class="ga-chips">${['tree', 'palm', 'vine'].map(k => `<b class="${k === 'palm' ? 'ok' : ''}"${langAttr()}>${icon('f-' + k)}${esc(formName(k, true))}</b>`).join('')}</div></div>`,
  odd: () => `<div class="ga ga-odd">${['neem', 'banyan', 'lotus', 'mango'].map(k => `<span class="${k === 'lotus' ? 'odd' : ''}">${gp(k)}</span>`).join('')}</div>`,
  find: () => `<div class="ga ga-find"><span class="ga-say"${taOf(byKey.neem)}>${icon('speak')} ${gname('neem')}?</span><div class="ga-grid">${['tulsi', 'neem', 'fern', 'aloe'].map(k => `<span class="${k === 'neem' ? 'ok' : ''}">${gp(k)}</span>`).join('')}</div></div>`,
  fv: () => `<div class="ga ga-name"><span class="ga-photo">${gp('tomato')}</span><div class="ga-chips">${['fruit', 'veg'].map(k => `<b class="${k === 'veg' ? 'ok' : ''}"${langAttr()}>${icon('f-' + k)}${esc(gLabel(groupByKey[k]))}</b>`).join('')}</div></div>`,
  memory: () => `<div class="ga ga-memory">${[0, 1, 2, 3, 4, 5].map(i => i === 1 || i === 4 ? `<span class="up">${gp('hibiscus')}</span>` : `<span class="down">${icon('leaf')}</span>`).join('')}</div>`,
};
const gameCover = (k, ico) => `<span class="game-cover gc-${k}" aria-hidden="true">${GAME_ART[k]()}<span class="game-ico">${icon(ico)}</span></span>`;
async function viewGameHub() {
  if (!lib) { app.innerHTML = skeleton(4); await loadLibrary().catch(() => {}); }
  if (location.hash !== '#/game') return;
  app.innerHTML = `<div class="page-head"><span class="eyebrow">${tr('nav_games')}</span><h1 class="h-display">${tr('games_title')}</h1><p class="lede">${tr('games_lede')}</p></div>
    <div class="games">${GAMES.map(g => `<a class="game-card" href="#/game/${g.key}">${gameCover(g.key, g.icon)}<b>${tr(g.t)}</b><span>${tr(g.d)}</span>${scores[g.key].stars ? `<small>${icon('star')} <span class="sr-only">${esc(tr('stars_n', { n: scores[g.key].stars }))}</span><span aria-hidden="true">${scores[g.key].stars}</span></small>` : ''}</a>`).join('')}</div>`;
}

// The shelf or grid a card was opened from, so a plant page can step to the previous / next plant (swipe, arrows).
let navList = (() => { try { return JSON.parse(sessionStorage.getItem('kd.nav') || '[]'); } catch { return []; } })();
document.addEventListener('click', e => {
  const a = e.target.closest('a.card'); if (!a || e.target.closest('[data-say]')) return;
  const items = [...(a.closest('.shelf-track, .grid') || app).querySelectorAll('a.card')].map(c => ({ h: c.getAttribute('href'), n: c.dataset.n, img: c.querySelector('img')?.getAttribute('src') }));
  navList = items.filter((x, i) => items.findIndex(y => y.h === x.h) === i);
  try { sessionStorage.setItem('kd.nav', JSON.stringify(navList)); } catch {}
}, true);
function neighbours(h) {
  let l = navList;
  if (!l.some(x => x.h === h)) l = PLANTS.map(p => ({ h: `#/p/${p.key}`, n: nm(p), img: photoOf(p) }));
  const i = l.findIndex(x => x.h === h);
  return i < 0 ? {} : { prev: l[i - 1], next: l[i + 1] };
}
let lastList = '#/';
// Previous / Next: thumbnails with names on the photo's edges (wide screens); swipe or arrow keys anywhere.
function sideNav(h) {
  const { prev, next } = neighbours(h);
  const side = (x, dir) => x ? `<a class="pn-side ${dir}" href="${x.h}" data-pn="${dir}" aria-label="${esc(tr(dir) + ': ' + x.n)}">${x.img ? `<img src="${esc(x.img.replace(/\/(medium|large)\./, '/square.'))}" alt="">` : '<span class="pn-side-ph"></span>'}<b>${esc(x.n)}</b><kbd aria-hidden="true">${dir === 'prev' ? '←' : '→'}</kbd></a>` : '';
  return side(prev, 'prev') + side(next, 'next');
}

const fact = (ic, k, v) => v ? `<div class="fact"><span class="fact-ico">${icon(ic)}</span><dt class="sr-only">${tr(k)}</dt><dd>${esc(v)}</dd></div>` : '';
async function viewDetail({ plant: p, id }) {
  const h = p ? `#/p/${p.key}` : `#/t/${id}`;
  id = p?.id ?? id;
  app.innerHTML = `<article class="detail nf"><div class="gallery"><div class="hero"><div class="slides skeleton"></div></div></div></article>`;
  let t = null;
  if (id) try { t = (await api(`/taxa/${id}${isTa() ? '?locale=ta' : ''}`)).results[0]; } catch {}
  if (location.hash !== h) return;
  if (!t && !p) { app.innerHTML = `<div class="empty"><b>${tr('no_load')}</b>${tr('check_net')}</div>`; return; }

  const en = p?.name || cap(t?.english_common_name || t?.preferred_common_name || t?.name);
  const ta = p ? TA_NAMES[p.key] : (await taNames([id]))[id];
  const name = (isTa() && ta) || en, nameTa = isTa() && !!ta;
  const sci = p?.sci || t?.name;
  const forms = p ? p.forms : formsOfAnc(t?.ancestor_ids);
  const fam = p?.fam || t?.ancestors?.find(a => a.rank === 'family')?.name;
  const pics = (t?.taxon_photos || []).slice(0, 8).map(x => ({ url: big(x.photo.medium_url || x.photo.url), small: x.photo.square_url || x.photo.url, by: x.photo.attribution }));
  if (!pics.length && photoOf(p)) pics.push({ url: big(photoOf(p)), small: photoOf(p), by: lib.map[p.id].by });
  const wikiTitle = t?.wikipedia_url ? decodeURIComponent(t.wikipedia_url.split('/wiki/')[1] || '') : sci;
  const form1 = forms.find(f => FORM_KEYS.includes(f)) || forms[0];
  const sv = isSaved(h);
  const alike = PLANTS.filter(x => x.key !== p?.key && forms.some(f => FORM_KEYS.includes(f) && x.forms.includes(f))).sort(byName).slice(0, 18);
  const obs = t?.observations_count ? tr('observations', { n: t.observations_count.toLocaleString(isTa() ? 'ta-IN' : 'en-IN') }) : '';

  app.innerHTML = `
    <article class="detail nf">
      <div class="gallery">
        <div class="hero">
          <div class="slides" id="slides" tabindex="0" aria-label="${esc(name)}">${pics.map((x, i) => `<figure><img src="${x.url}" alt="${esc(tr('photo_n', { i: i + 1, n: pics.length }) + ': ' + name)}"${i ? ' loading="lazy"' : ''}></figure>`).join('') || '<figure></figure>'}</div>
          <div class="nf-shade" aria-hidden="true"></div>
          <a class="back-round nf-back" href="${lastList}" data-back aria-label="${tr('back')}" title="${tr('back')}">${icon('back')}</a>
          ${sideNav(h)}
          <div class="nf-info">
            <header class="d-head">
              <div class="d-title"><h1 class="h-display"${nameTa ? ' lang="ta"' : ''}>${esc(name)}</h1>${sayBtn(name, nameTa, 'say-round')}</div>
              <p class="nf-meta">${form1 ? `<span${langAttr()}>${esc(gLabel(groupByKey[form1]))}</span>` : ''}${nameTa ? `<span>${esc(en)}</span>` : (ta ? `<span lang="ta">${esc(ta)}</span>` : '')}<span class="d-sci">${esc(sci)}</span></p>
            </header>
            <div class="hero-acts">
              <button class="hero-btn save${sv ? ' on' : ''}" id="saveBtn" type="button" aria-pressed="${sv}">${saveInner(sv)}</button>
              <span id="wikiBtn"></span>
            </div>
          </div>
        </div>
        ${pics.length > 1 ? `<div class="thumbs" id="thumbs">${pics.map((x, i) => `<button type="button" class="${i ? '' : 'on'}" aria-label="${esc(tr('photo_n', { i: i + 1, n: pics.length }))}"><img src="${x.small}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
        <p class="credit" id="credit">${esc(pics[0]?.by || '')}</p>
      </div>
      <div class="d-body">
        ${p && !isTa() ? `<p class="d-bio">${esc(p.about)}</p>` : ''}
        <div id="wiki">${p && !isTa() ? '' : '<div class="skeleton sk-line" style="width:90%"></div><div class="skeleton sk-line"></div>'}</div>
        <dl class="facts">
          ${fact('family', 'f_family', fam)}
          ${fact('ruler', 'f_height', p?.h)}
          ${fact('pin', 'f_habitat', p?.hab)}
          ${fact('globe', 'f_native', p?.nat)}
          ${p?.uses ? `<div class="fact fact-fun"><span class="fact-ico">${icon('hand')}</span><dt class="sr-only">${tr('f_uses')}</dt><dd>${esc(p.uses)}</dd></div>` : ''}
          ${fact('eye', 'records', obs)}
        </dl>
        ${forms.length ? `<div class="forms" aria-label="${tr('f_form')}">${forms.map(f => `<a href="#/g/${f}"${langAttr()}>${icon('f-' + f)}${esc(gLabel(groupByKey[f]))}</a>`).join('')}</div>` : ''}
        <p class="source" id="srcLine"></p>
      </div>
    </article>
    ${alike.length ? shelf(tr('more_like'), alike.map(plantCard).join('')) : ''}`;
  wireSave($('#saveBtn'), { h, n: name, sci, img: pics[0]?.url ? med(pics[0].url) : '' });
  noteRecent({ h, n: name, sci, img: pics[0]?.url ? med(pics[0].url) : '' });
  appBar(name, lastList, nameTa);

  // Photos: thumbnails pick a slide; the credit follows the slide on show.
  const slides = $('#slides'), thumbs = $('#thumbs');
  const show = i => { thumbs && [...thumbs.children].forEach((d, j) => d.classList.toggle('on', i === j)); $('#credit').textContent = pics[i]?.by || ''; };
  slides.addEventListener('scroll', () => show(Math.round(slides.scrollLeft / slides.clientWidth)), { passive: true });
  thumbs?.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; slides.scrollTo({ left: [...thumbs.children].indexOf(b) * slides.clientWidth, behavior: 'smooth' }); });

  // Wikipedia: English summary, or Tamil Wikipedia's when Tamil is on (falls back to English).
  const src = [];
  if (t) src.push(`${tr('src_inat')}: <a href="https://www.inaturalist.org/taxa/${t.id}" target="_blank" rel="noopener">iNaturalist</a>`);
  if (ta && !p) src.push(`${tr('src_wd')}: <a href="https://www.wikidata.org/w/index.php?search=haswbstatement%3AP3151%3D${id}" target="_blank" rel="noopener">Wikidata</a>`);
  let w = null, wTa = false;
  if (isTa()) { w = await tamilWiki(wikiTitle); wTa = !!w?.text; if (!wTa) w = null; }
  if (!w) w = await wikiSummary(wikiTitle);
  if (location.hash !== h) return;
  const wikiEl = $('#wiki');
  if (w?.text) {
    wikiEl.innerHTML = `<p class="d-wiki"${wTa ? ' lang="ta"' : ''}>${esc(w.text)}</p>`;
    if (w.url && $('#wikiBtn')) $('#wikiBtn').outerHTML = `<a class="hero-btn" href="${w.url}" target="_blank" rel="noopener">${icon('book')}<span>${tr('wikipedia')}</span></a>`;
    src.push(`${tr('src_wiki')}: <a href="${w.url}" target="_blank" rel="noopener">${wTa ? 'Tamil ' : ''}Wikipedia</a>`);
  } else wikiEl.innerHTML = p && isTa() ? `<p class="d-bio">${esc(p.about)}</p>` : '';
  $('#srcLine').innerHTML = src.join(' · ');
  document.title = `${name} · Kaadu`;

  if (!store.get('kd.swipeHint', false) && (APP || matchMedia('(pointer: coarse)').matches)) { store.set('kd.swipeHint', true); setTimeout(() => toast(tr('swipe_hint')), 900); }
}

// ---------------------------------------------------------------- swipe and keys for previous / next
let sx = 0, sy = 0, st = 0;
app.addEventListener('touchstart', e => { const p = e.touches[0]; sx = p.clientX; sy = p.clientY; st = Date.now(); }, { passive: true });
app.addEventListener('touchend', e => {
  if (!/^#\/(p|t)\//.test(location.hash) || document.querySelector('dialog[open]') || e.target.closest?.('.slides, .thumbs, .shelf-track, .filters')) return;
  const p = e.changedTouches[0], dx = p.clientX - sx, dy = p.clientY - sy;
  if (sx < 24 || (ANDROID && sx > innerWidth - 24) || Date.now() - st > 600 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * .6) return;
  step(dx < 0 ? 'next' : 'prev', dx);
}, { passive: true });
document.addEventListener('keydown', e => {
  if (!/^#\/(p|t)\//.test(location.hash) || document.querySelector('dialog[open]') || e.target.closest?.('input, textarea, .slides, .shelf-track') || e.altKey || e.metaKey || e.ctrlKey) return;
  if (e.key === 'ArrowRight') step('next', -1); else if (e.key === 'ArrowLeft') step('prev', 1);
});
function step(dir, dx) {
  const a = $(`[data-pn=${dir}]`); if (!a) return;
  let done = false;
  const go = () => { if (done) return; done = true; location.replace(a.getAttribute('href')); };
  // The page slides out the way the finger went; a timer makes sure it moves on even if animations are paused.
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) app.animate?.([{ transform: 'none', opacity: 1 }, { transform: `translateX(${dx < 0 ? -48 : 48}px)`, opacity: 0 }], { duration: 160, easing: 'ease-in' });
  haptic();
  setTimeout(go, 170);
}


// ---------------------------------------------------------------- identify a plant from a photo
// The photo is shrunk on the device, sent to /api/identify (Pl@ntNet, key kept on the server), and each
// match is tied to a library plant or an iNaturalist species so it opens a Kaadu plant page.
let idShot = null; // { url, state: 'looking' | 'done' | 'error', matches, error }
document.addEventListener('click', e => { if (e.target.closest('[data-identify]')) { e.preventDefault(); $('#idFile').value = ''; $('#idFile').click(); } });
$('#idFile').addEventListener('change', e => { const f = e.target.files?.[0]; if (f) identify(f); });
async function shrink(file, max = 1280) {
  try {
    const bmp = await createImageBitmap(file), k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', .86)) || file;
  } catch { return file; } // e.g. a format the browser can't draw: send it as it is
}
async function matchTaxon(sci) {
  const two = sci.split(' ').slice(0, 2).join(' ').toLowerCase();
  const p = PLANTS.find(x => x.sci.toLowerCase() === sci.toLowerCase() || x.sci.toLowerCase().split(' ').slice(0, 2).join(' ') === two);
  if (p) return { plant: p };
  try {
    const r = await api(`/taxa?q=${encodeURIComponent(sci)}&taxon_id=47126&per_page=5&is_active=true${isTa() ? '&locale=ta' : ''}`);
    const t = r.results.find(x => x.name.toLowerCase() === sci.toLowerCase()) || r.results.find(x => x.name.toLowerCase().startsWith(two)) || null;
    return t ? (byId[t.id] ? { plant: byId[t.id] } : { taxon: t }) : {};
  } catch { return {}; }
}
async function identify(file) {
  if (idShot?.url) URL.revokeObjectURL(idShot.url);
  idShot = { url: URL.createObjectURL(file), state: 'looking' };
  if (location.hash !== '#/identify') location.hash = '#/identify'; else viewIdentify();
  try {
    const fd = new FormData(); fd.append('image', await shrink(file), 'plant.jpg'); fd.append('lang', lang);
    const r = await fetch('api/identify', { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'fail'), { code: j.error });
    if (!lib) await loadLibrary().catch(() => {});
    const top = (j.results || []).slice(0, 5);
    const linked = await Promise.all(top.map(async x => ({ ...x, ...(await matchTaxon(x.sci)) })));
    const ids = linked.filter(x => x.taxon).map(x => x.taxon.id), ta = isTa() && ids.length ? await taNames(ids) : {};
    idShot = { ...idShot, state: 'done', matches: linked.map(x => ({ ...x, ta: x.taxon ? ta[x.taxon.id] : null })) };
  } catch (err) {
    idShot = { ...idShot, state: 'error', error: err.code === 'not_configured' ? 'id_off' : err.code === 'quota' ? 'id_quota' : 'id_fail' };
  }
  if (location.hash === '#/identify') viewIdentify();
}
function idMatch(m) {
  const p = m.plant, t = m.taxon;
  const name = p ? nm(p) : (isTa() && m.ta) || cap(t?.preferred_common_name || m.common[0] || m.sci);
  const nameTa = p ? hasTa(p) : isTa() && !!m.ta;
  const h = p ? `#/p/${p.key}` : t ? `#/t/${t.id}` : `#/search/${encodeURIComponent(m.sci)}`;
  const photo = p ? photoOf(p) : t?.default_photo?.medium_url;
  return { name, nameTa, h, photo, sci: m.sci, pct: Math.round(m.score * 100) };
}
function viewIdentify() {
  const s = idShot;
  const pick = (cls = 'btn accent') => `<button class="${cls}" type="button" data-identify>${icon('camera')}<span>${tr(s ? 'id_again' : 'id_pick')}</span></button>`;
  const head = `<div class="page-head"><span class="eyebrow">${tr('id_card')}</span><h1 class="h-display">${tr('id_title')}</h1><p class="lede">${tr('id_lede')}</p></div>`;
  if (!s) {
    app.innerHTML = `${head}<div class="id-start">${pick()}<p class="note">${icon('leaf')} ${tr('id_tips')}</p><p class="id-privacy">${tr('id_privacy')}</p></div>`;
    return;
  }
  let body = '';
  if (s.state === 'looking') body = `<div class="id-status" role="status"><div class="spinner"></div><span>${tr('id_looking')}</span></div><div class="skeleton id-skel"></div>`;
  else if (s.state === 'error') body = `<div class="empty"><b>${tr(s.error)}</b></div>`;
  else if (!s.matches.length) body = `<div class="empty"><b>${tr('id_none')}</b></div>`;
  else {
    const [best, ...rest] = s.matches.map(idMatch);
    body = `${best.pct < 15 ? `<p class="id-warn" role="status">${tr('id_unsure')}</p>` : ''}
      <section class="id-best" aria-labelledby="idBest">
        <span class="eyebrow" id="idBest">${tr('id_best')}</span>
        <a class="id-best-card" href="${best.h}">${best.photo ? `<img src="${best.photo}" alt="">` : '<span class="id-ph"></span>'}
          <div><div class="name-row"><h2${best.nameTa ? ' lang="ta"' : ''}>${esc(best.name)}</h2>${sayBtn(best.name, best.nameTa)}</div><p class="sci">${esc(best.sci)}</p>
            <div class="id-meter" role="img" aria-label="${esc(tr('id_sure', { n: best.pct }))}"><i style="width:${best.pct}%"></i></div><small>${tr('id_sure', { n: best.pct })}</small>
            <span class="btn accent id-open"${langAttr()}>${esc(tr('id_open', { name: best.name }))} ${icon('arrow')}</span></div></a>
      </section>
      ${rest.length ? `<section class="id-rest"><h2 class="h-section">${tr('id_others')}</h2><ul>${rest.map(m => `<li><a href="${m.h}">${m.photo ? `<img src="${m.photo.replace('/medium.', '/square.')}" alt="">` : '<span class="id-ph"></span>'}<span><b${m.nameTa ? ' lang="ta"' : ''}>${esc(m.name)}</b><i>${esc(m.sci)}</i></span><small>${tr('id_sure', { n: m.pct })}</small></a></li>`).join('')}</ul></section>` : ''}`;
  }
  app.innerHTML = `${head}<div class="id-layout"><figure class="id-photo"><img src="${s.url}" alt="${tr('id_your')}"><figcaption>${tr('id_your')}</figcaption></figure><div class="id-results">${body}<div class="id-acts">${pick('btn outline')}</div><p class="id-privacy">${tr('id_privacy')}</p></div></div>`;
}

// ---------------------------------------------------------------- routing
function setTab(tab) { m3?.setActive?.(tab || null); if (IOS && tab) KolamIOS.tabBar.select(tab); document.querySelectorAll('[data-tab]').forEach(a => a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')); }
function route({ keep = false } = {}) {
  route.current = location.hash || '';
  io?.disconnect(); io = null;
  window.speechSynthesis?.cancel(); clearTimeout(announceTimer); clearTimeout(autoNextTimer);
  if (pendingSay) { const t = pendingSay; pendingSay = null; setTimeout(() => say(t.n, null, t.ta), 80); }
  let h = location.hash.slice(1) || '/';
  try { h = decodeURIComponent(h); } catch {}
  const [, a, b] = h.split('/');
  if (!keep) window.scrollTo(0, 0);
  const input = $('#searchInput');
  if (a !== 'search' && input.value && document.activeElement !== input) input.value = '';
  if (!['p', 't'].includes(a)) { lastList = location.hash || '#/'; document.title = 'Kaadu · every kind of plant'; }
  document.body.classList.toggle('hero-page', !a);
  document.body.classList.toggle('search-page', a === 'search');
  solidTop();
  // The app bar's title and where its Back goes (main tabs have none); plant and branch pages set their own name.
  const game = gameByKey[b];
  const ab = { '': ['Kaadu'], g: [groupByKey[b] ? gLabel(groupByKey[b]) : 'Kaadu', '#/', true], types: [tr('nav_groups')], saved: [tr('my_list')],
    search: [tr('search_title'), IOS ? null : '#/'], identify: [tr('id_title'), '#/search'], explore: [tr('nav_tree'), b ? '#/explore' : null], game: [game ? tr(game.t) : tr('games_title'), game ? '#/game' : null],
    p: [byKey[b] ? nm(byKey[b]) : '', lastList, !!(byKey[b] && hasTa(byKey[b]))], t: ['', lastList] }[a || ''] || ['Kaadu'];
  appBar(ab[0], ab[1] || null, ab[2] && isTa());
  document.documentElement.classList.toggle('searching', !!APP && a === 'search');
  if (!a) { setTab('home'); return viewHome(); }
  if (a === 'g' && groupByKey[b]) { setTab('home'); return viewHome(b); }
  if (a === 'types') { setTab('types'); return viewTypes(); }
  if (a === 'saved') { setTab('saved'); return viewSaved(); }
  if (a === 'explore') { setTab('explore'); return viewExplore(+b || PLANTAE); }
  if (a === 'game') {
    setTab('game');
    if (b && !game) return location.replace('#/game');
    if (round.done >= ROUND || round.mode !== b) round = { mode: null }; // coming back to a game starts a fresh round
    return { name: viewNameGame, group: viewGroupGame, odd: viewOddGame, find: viewFindGame, memory: viewMemoryGame, fv: viewFvGame }[b]?.() ?? viewGameHub();
  }
  if (a === 'identify') { setTab('search'); return viewIdentify(); }
  if (a === 'search' && b) { setTab('search'); return viewSearch(h.slice(8)); }
  if (a === 'search') { setTab('search'); return viewSearchHome(); }
  if (a === 'p' && byKey[b]) { setTab(''); return viewDetail({ plant: byKey[b] }); }
  if (a === 't' && +b) { setTab(''); return byId[+b] ? location.replace(`#/p/${byId[+b].key}`) : viewDetail({ id: +b }); }
  location.replace('#/');
}
let moved = false;
addEventListener('hashchange', () => { moved = true; route(); });
document.addEventListener('click', e => { const a = e.target.closest('[data-back]'); if (a && moved && history.length > 1) { e.preventDefault(); history.back(); } });
$('#searchForm').addEventListener('submit', e => { e.preventDefault(); const q = $('#searchInput').value.trim(); if (q) { location.hash = '#/search/' + encodeURIComponent(q); $('#searchInput').blur(); } });
let typing;
$('#searchInput').addEventListener('input', e => { clearTimeout(typing); const q = e.target.value.trim(); if (q.length >= 3) typing = setTimeout(() => { location.replace('#/search/' + encodeURIComponent(q)); }, 450); });
$('#langBtn').onclick = () => { lang = isTa() ? 'en' : 'ta'; store.set('kd.lang', lang); syncLang(); toast(tr('lang_toast')); route({ keep: true }); };
// The header sits see-through over a page's billboard and turns solid once the page scrolls.
const solidTop = () => $('.top').classList.toggle('solid', !document.body.classList.contains('hero-page') || scrollY > 40);
addEventListener('scroll', solidTop, { passive: true });
// Profile panel: language, My list and game stars live here, out of the top bar.
const pBtn = $('#profileBtn'), pPanel = $('#profilePanel');
// In the Android / iPhone apps the top bar is the app bar, so the panel hangs from its profile button instead.
if (APP) { document.body.appendChild(pPanel); pPanel.classList.add('in-app'); }
function setProfile(open) {
  pPanel.hidden = !open; pBtn.setAttribute('aria-expanded', open); $('#abProfile')?.setAttribute('aria-expanded', open);
  if (open) {
    $('#ppSaved').textContent = saved().length || '';
    $('#ppStars').textContent = GAMES.reduce((n, g) => n + (scores[g.key].stars || 0), 0) || '';
    $('#langBtn').focus();
  }
}
pBtn.onclick = e => { e.stopPropagation(); setProfile(pPanel.hidden); };
document.addEventListener('click', e => { if (e.target.closest('#abProfile')) { e.stopPropagation(); setProfile(pPanel.hidden); } }, true);
document.addEventListener('click', e => { if (!pPanel.hidden && !e.target.closest('.profile, #profilePanel, #abProfile')) setProfile(false); });
pPanel.addEventListener('click', e => { if (e.target.closest('.pp-link')) setProfile(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pPanel.hidden) { setProfile(false); pBtn.focus(); } });
const setTop = () => document.documentElement.style.setProperty('--top-h', `${$('.top').offsetHeight}px`);
setTop(); addEventListener('resize', setTop);

// ---------------------------------------------------------------- app mode: app bar, search, Back
// The app bar title and back for the current screen (main tabs have none).
let m3 = null;
function appBar(title, up, ta) {
  if (!APP) return;
  if (ANDROID) {
    m3.setTitle(title);
    const t = m3.appBar?.querySelector('.md-top-app-bar__title'); if (t) ta ? t.setAttribute('lang', 'ta') : t.removeAttribute('lang');
    if (up) m3.setBack(up); // where Back goes when the page was opened on a deep link
    return;
  }
  // iPhone: large title on the main tabs; Back + centred title below them (the back label says where it goes).
  const upName = up && ({ '#/': tr('nav_home'), '#/explore': tr('nav_tree'), '#/game': tr('games_title'), '#/types': tr('nav_groups'), '#/saved': tr('my_list') }[up] || tr('back'));
  const actions = [{ id: 'abProfile', icon: icon('user', 'ios-icon'), label: tr('profile') }];
  if (up) KolamIOS.navBar.set({ title, back: { label: upName, onClick: () => (moved && history.length > 1 ? history.back() : (location.hash = up)) }, actions, keepTitle: true });
  else KolamIOS.navBar.set({ title, large: true, actions, keepTitle: true });
  document.querySelectorAll('.ios-navbar-title, .ios-largetitle').forEach(e => (ta ? e.setAttribute('lang', 'ta') : e.removeAttribute('lang')));
  const pb = $('#abProfile'); pb.setAttribute('aria-haspopup', 'true'); pb.setAttribute('aria-controls', 'profilePanel'); pb.setAttribute('aria-expanded', String(!pPanel.hidden));
}
if (APP) document.documentElement.classList.add('app');
if (ANDROID) {
  // App bar, navigation bar, ripples, snackbar and Back come from the kit. No back arrow in the bar:
  // the phone's own Back button goes back (Back on another main tab returns to Discover, then leaves).
  const html = document.documentElement;
  const actions = () => [{ id: 'abProfile', icon: 'account_circle', label: tr('profile') }];
  m3 = KolamM3.init({
    primary: '#7cc6a3', title: 'Kaadu', back: false,
    destinations: [
      { id: 'home', label: tr('nav_home'), icon: 'home', href: '#/' },
      { id: 'explore', label: tr('nav_explore'), icon: 'account_tree', href: '#/explore' },
      { id: 'game', label: tr('nav_games'), icon: 'sports_esports', href: '#/game' },
      { id: 'search', label: tr('nav_search'), icon: 'search', href: '#/search' },
      { id: 'saved', label: tr('my_list'), icon: 'bookmark', href: '#/saved' },
    ],
    actions: actions(), hide: ['.tabbar'],
    onBack: () => {
      if (!pPanel.hidden) { setProfile(false); return true; }
      if (html.classList.contains('searching') && !location.hash.startsWith('#/search')) { $('#searchClose').click(); return true; }
    },
  });
  m3.relabel = () => {
    const keys = { home: 'nav_home', explore: 'nav_explore', game: 'nav_games', search: 'nav_search', saved: 'my_list' };
    // Five destinations leave ~72dp per label: two Tamil labels get a shorter word (the full one stays as the name).
    const shortTa = { game: 'ஆட்டம்', saved: 'பட்டியல்' };
    document.querySelectorAll('.md-nav-item').forEach(el => {
      const l = el.querySelector('.md-nav-label'), full = tr(keys[el.dataset.dest]);
      l.textContent = (isTa() && shortTa[el.dataset.dest]) || full; l.lang = isTa() ? 'ta' : 'en';
      el.setAttribute('aria-label', full);
    });
    m3.setActions(actions());
    $('#abProfile')?.setAttribute('aria-haspopup', 'true'); $('#abProfile')?.setAttribute('aria-controls', 'profilePanel'); $('#abProfile')?.setAttribute('aria-expanded', String(!pPanel.hidden));
  };
  m3.relabel();
  $('#langBtn').addEventListener('click', () => setTimeout(m3.relabel));
}
if (IOS) {
  // Navigation bar, tab bar (4 tabs + the trailing Search tab, as in iOS 26), sheets and haptics from the kit.
  const keys = { home: 'nav_home', explore: 'nav_explore', game: 'nav_games', saved: 'my_list', search: 'nav_search' };
  const ic = { home: 'house', explore: icon('branch', 'ios-icon'), game: icon('game', 'ios-icon'), saved: 'bookmark', search: 'magnifyingglass' };
  const href = { home: '#/', explore: '#/explore', game: '#/game', saved: '#/saved', search: '#/search' };
  KolamIOS.init({
    appName: 'Kaadu', uaTokens: ['Kaadu-iOS'], tint: { light: '#1D6B45', dark: '#7CC6A3', onDark: '#0E0E0E' },
    navBar: { title: 'Kaadu', large: true },
    tabs: Object.keys(keys).map(id => ({ id, label: tr(keys[id]), icon: ic[id], href: href[id], role: id === 'search' ? 'search' : undefined })),
    currentTab: 'home',
  });
  // The search field sits under the bar on the Search tab, like an iOS search controller.
  const lt = document.querySelector('.ios-largetitle'); lt.after($('#searchForm'));
  const relabel = () => {
    const shortTa = { game: 'ஆட்டம்', saved: 'பட்டியல்' };
    document.querySelectorAll('.ios-tab').forEach(el => { const s = el.querySelector('span'), full = tr(keys[el.dataset.tab]); s.textContent = (isTa() && shortTa[el.dataset.tab]) || full; s.lang = isTa() ? 'ta' : 'en'; el.setAttribute('aria-label', full); });
    document.querySelector('.ios-tabbar-search')?.setAttribute('aria-label', tr('nav_search'));
  };
  relabel();
  $('#langBtn').addEventListener('click', () => setTimeout(relabel));
}
if (APP) {
  // Search opens as a full-width search field over the app bar (the Search page).
  const html = document.documentElement;
  $('#searchForm').insertAdjacentHTML(IOS ? 'beforeend' : 'afterbegin', `<button type="button" class="ab-btn" id="searchClose" aria-label="${tr('cancel')}" data-cancel="${tr('cancel')}">${ANDROID ? KolamM3.icon('arrow_back') : icon('back')}</button>`);
  $('#searchClose').onclick = () => { $('#searchInput').value = ''; html.classList.remove('searching'); moved ? history.back() : (location.hash = '#/'); };
}
syncLang();
route();
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !/localhost|127\.0\.0\.1/.test(location.hostname)) navigator.serviceWorker.register('sw.js').catch(() => {});
