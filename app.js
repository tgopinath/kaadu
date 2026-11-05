import { PLANTS, GROUPS } from './data.js';
import { TA_NAMES } from './data-ta.js';
import { STR, TA_GROUPS, GROUP_BLURB } from './i18n.js';

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
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}

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
let lib = store.get('kd.lib.v1', null);
async function loadLibrary() {
  if (lib && Date.now() - lib.t < 864e5) return lib.map;
  const ids = PLANTS.map(p => p.id).filter(Boolean), map = {};
  for (let i = 0; i < ids.length; i += 30) {
    const r = await api(`/taxa/${ids.slice(i, i + 30).join(',')}`);
    for (const t of r.results) map[t.id] = { url: t.default_photo?.medium_url, by: t.default_photo?.attribution, obs: t.observations_count };
  }
  lib = { t: Date.now(), map }; store.set('kd.lib.v1', lib);
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
const sayBtn = (name, ta, cls = 'say-name') => `<button class="${cls}" type="button" data-say="${esc(name)}"${ta ? ' data-ta="1"' : ''} aria-label="${esc(tr('say_name', { name }))}" title="${esc(tr('say_name', { name }))}">${icon('speak')}</button>`;
document.addEventListener('click', e => {
  const b = e.target.closest('[data-say]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  say(b.dataset.say, b, !!b.dataset.ta);
}, true);

// ---------------------------------------------------------------- cards
const img = (url, alt, lazy = true) => url ? `<img src="${url}" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ''} decoding="async" onload="this.classList.add('loaded')" onerror="this.remove()">` : '';
const FORM_KEYS = ['tree', 'shrub', 'vine', 'herb', 'grass', 'fern', 'succulent', 'aquatic', 'moss', 'palm', 'conifer'];
const formTag = forms => { const f = forms.find(x => FORM_KEYS.includes(x)); return f ? `<span class="tagform"${langAttr()}>${icon('f-' + f)}${esc(gLabel(groupByKey[f]))}</span>` : ''; };
// Photo with the name (and its speaker) laid over the bottom, Zoorassic Park style.
const card = ({ h, url, name, sub, forms = [], ta = false }) => `<a class="card" href="${h}" data-n="${esc(name)}">
    <div class="card-img">${img(url, name)}${formTag(forms)}</div>
    <div class="card-meta"><div><div class="name-row"><h3 class="card-name"${ta ? ' lang="ta"' : ''}>${esc(name)}</h3>${sayBtn(name, ta)}</div><div class="card-sub">${esc(sub)}</div></div></div></a>`;
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

async function viewHome(gk = 'all') {
  const g = groupByKey[gk] || GROUPS[0];
  if (!lib) { app.innerHTML = skeleton(8); await loadLibrary().catch(() => {}); }
  if (route.current !== location.hash) return;
  const list = PLANTS.filter(p => inGroup(p, g)).sort(byName);
  let head;
  if (g.key === 'all') {
    const f = plantOfDay(), fh = `#/p/${f.key}`, fs = isSaved(fh), fta = isTa() && !!TA_NAMES[f.key];
    const mine = saved();
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
    if (w.url) $('#wikiBtn').outerHTML = `<a class="hero-btn" href="${w.url}" target="_blank" rel="noopener">${icon('book')}<span>${tr('wikipedia')}</span></a>`;
    src.push(`${tr('src_wiki')}: <a href="${w.url}" target="_blank" rel="noopener">${wTa ? 'Tamil ' : ''}Wikipedia</a>`);
  } else wikiEl.innerHTML = p && isTa() ? `<p class="d-bio">${esc(p.about)}</p>` : '';
  $('#srcLine').innerHTML = src.join(' · ');
  document.title = `${name} · Kaadu`;

  if (!store.get('kd.swipeHint', false) && matchMedia('(pointer: coarse)').matches) { store.set('kd.swipeHint', true); setTimeout(() => toast(tr('swipe_hint')), 900); }
}

// ---------------------------------------------------------------- swipe and keys for previous / next
let sx = 0, sy = 0, st = 0;
app.addEventListener('touchstart', e => { const p = e.touches[0]; sx = p.clientX; sy = p.clientY; st = Date.now(); }, { passive: true });
app.addEventListener('touchend', e => {
  if (!/^#\/(p|t)\//.test(location.hash) || document.querySelector('dialog[open]') || e.target.closest?.('.slides, .thumbs, .shelf-track, .filters')) return;
  const p = e.changedTouches[0], dx = p.clientX - sx, dy = p.clientY - sy;
  if (sx < 24 || Date.now() - st > 600 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * .6) return;
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
  setTimeout(go, 170);
}

// ---------------------------------------------------------------- routing
function setTab(tab) { document.querySelectorAll('[data-tab]').forEach(a => a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')); }
function route({ keep = false } = {}) {
  route.current = location.hash || '';
  io?.disconnect(); io = null;
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
  if (!a) { setTab('home'); return viewHome(); }
  if (a === 'g' && groupByKey[b]) { setTab('home'); return viewHome(b); }
  if (a === 'types') { setTab('types'); return viewTypes(); }
  if (a === 'saved') { setTab('saved'); return viewSaved(); }
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
const setTop = () => document.documentElement.style.setProperty('--top-h', `${$('.top').offsetHeight}px`);
setTop(); addEventListener('resize', setTop);
syncLang();
route();
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !/localhost|127\.0\.0\.1/.test(location.hostname)) navigator.serviceWorker.register('sw.js').catch(() => {});
