import {
  num,
  arr,
  str,
  metrics,
  scoreAll,
  ratingScale,
  computeChanges,
  todayParis,
  effectiveMonthly,
  isRestricted,
} from './score.js';

const state = {
  data: null,
  isSample: false,
  history: null,
  config: {
    owner: 'sirjface-itchy',
    repo: 'comparateur-auto-fr',
    appUrl: 'https://sirjface-itchy.github.io/comparateur-auto-fr/',
    ntfyTopic: 'comparateur-auto-fr-sirjface-7h',
    alertEmail: 'sirjface@gmail.com',
  },
  scores: new Map(),
  changes: { prevDate: null, drops: [], ups: [], newOffers: [], newVehicles: [] },
  filters: {
    q: '',
    quick: 'all', // all | suv-familial | suv-compact | suv-citadin | compacte | citadine | lease450 | BEV | PHEV | HEV | chinese | bonus
    maxBudget: '',
    maxMonthly: '450',
    minRange: '',
    minTrunk: '',
    sort: 'score', // score | netAsc | monthlyAsc | discountDesc | rangeDesc
    viewMode: 'byType', // byType | flat
  },
  compareIds: [],
  tco: {
    kmPerYear: 15000,
    years: 4,
    homeChargeShare: 80,
    elecHomeEur: 0.21,
    elecPublicEur: 0.49,
    petrolEur: 1.78,
    summerWeeks: 3,
    summerWeekCostEur: 620,
    mode: 'lease', // cash | lease
    compactId: '',
    suvId: '',
    thirdId: '',
  },
};

/* ---------- Utilitaires de formatage ---------- */
const eur = (v) => {
  const n = num(v);
  return n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} €`;
};

const esc = (s) =>
  str(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const safeUrl = (u, fallback = '#') => {
  const s = str(u).trim();
  return /^https?:\/\//i.test(s) ? s : fallback;
};

function toast(msg) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3400);
}

function loadLocalState() {
  try {
    const theme = localStorage.getItem('av_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    const icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';

    const cmp = JSON.parse(localStorage.getItem('av_compare') || '[]');
    if (Array.isArray(cmp)) state.compareIds = cmp.slice(0, 4);

    const savedTco = JSON.parse(localStorage.getItem('av_tco') || 'null');
    if (savedTco && typeof savedTco === 'object') {
      state.tco = { ...state.tco, ...savedTco };
    }
  } catch {
    // ignore storage errors
  }
}

function saveCompare() {
  try {
    localStorage.setItem('av_compare', JSON.stringify(state.compareIds));
  } catch {}
  updateCompareBadges();
}

function isCompactGab(v) {
  const seg = str(v?.segment).toLowerCase();
  const len = num(v?.specs?.lengthMm) || 0;
  return !v?.isSUV && (seg.includes('citadine') || seg.includes('compacte') || seg.includes('berline') || (len > 0 && len <= 4450));
}

function ensureDefaultCompareAndTco() {
  const vehicles = arr(state.data?.vehicles);
  if (!vehicles.length) return;

  // Pré-remplir le comparateur d'office avec un duel homogène par motorisation (SUV Full Hybrides HEV non rechargeables)
  const validIds = new Set(vehicles.map((v) => v.id));
  state.compareIds = state.compareIds.filter((id) => validIds.has(id));
  if (state.compareIds.length === 0) {
    const defaultHevSuvs = ['mg-ehs-hybrid-plus', 'renault-symbioz-e-tech-145', 'jaecoo-7-shs-hev', 'dacia-duster-hybrid-140'].filter((id) =>
      validIds.has(id)
    );
    state.compareIds = defaultHevSuvs.length >= 2 ? defaultHevSuvs : vehicles.slice(0, 4).map((v) => v.id);
    comparatorEnergyFilter = 'HEV';
    saveCompare();
  }

  // Pré-remplir le simulateur TCO (Compacte type Clio/Mégane vs SUV familial)
  if (!validIds.has(state.tco.compactId)) {
    const compact =
      vehicles.find((v) => /clio|megane|mégane|r5|208|308|golf|mg4|dolphin/i.test(`${v.brand} ${v.model}`)) ||
      vehicles.find((v) => isCompactGab(v)) ||
      vehicles[0];
    state.tco.compactId = compact?.id || '';
  }
  if (!validIds.has(state.tco.suvId)) {
    const suv =
      vehicles.find((v) => v.isSUV && /familial|seal u|scenic|scénic|3008|model y|tiguan|austral|ev3/i.test(`${v.brand} ${v.model} ${v.segment}`)) ||
      vehicles.find((v) => v.isSUV) ||
      vehicles[Math.min(1, vehicles.length - 1)];
    state.tco.suvId = suv?.id || '';
  }
  if (!validIds.has(state.tco.thirdId)) {
    const third = vehicles.find((v) => v.id !== state.tco.compactId && v.id !== state.tco.suvId) || vehicles[0];
    state.tco.thirdId = third?.id || '';
  }
}

function updateCompareBadges() {
  const badge = document.getElementById('nav-cmp-badge');
  if (badge) badge.textContent = String(state.compareIds.length);

  const dock = document.getElementById('compare-dock');
  if (!dock) return;
  const hash = location.hash || '#/';
  if (state.compareIds.length === 0 || hash.startsWith('#/comparateur')) {
    dock.classList.add('hidden');
    return;
  }
  const vehicles = arr(state.data?.vehicles);
  const names = state.compareIds
    .map((id) => vehicles.find((v) => v.id === id))
    .filter(Boolean)
    .map((v) => esc(fullModelName(v).split('(')[0].trim()));

  dock.classList.remove('hidden');
  dock.innerHTML = `
    <span style="font-size:0.84rem;font-weight:600;">⚖️ Comparateur (${state.compareIds.length}/4) : ${names.join(' · ')}</span>
    <a href="#/comparateur" class="btn btn-primary btn-sm">Comparer côte à côte →</a>
  `;
}

/* ---------- Chargement des données ---------- */
async function loadData() {
  const bust = todayParis();
  try {
    const cfgRes = await fetch(`./config.json?v=${bust}`);
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      state.config = { ...state.config, ...cfg };
    }
  } catch {}

  try {
    const res = await fetch(`./data/vehicles.json?v=${bust}`);
    if (!res.ok) throw new Error('missing vehicles.json');
    state.data = await res.json();
    state.isSample = false;
  } catch {
    const resSample = await fetch(`./data/vehicles.sample.json?v=${bust}`);
    state.data = await resSample.json();
    state.isSample = true;
    const banner = document.getElementById('sample-banner');
    if (banner) banner.classList.remove('hidden');
  }

  try {
    const hRes = await fetch(`./data/history.json?v=${bust}`);
    if (hRes.ok) state.history = await hRes.json();
  } catch {}

  const vehicles = arr(state.data?.vehicles);
  state.scores = scoreAll(vehicles);
  state.changes = computeChanges(vehicles, state.history, todayParis());

  ensureDefaultCompareAndTco();
  updateCompareBadges();

  const footerMeta = document.getElementById('footer-meta');
  if (footerMeta) {
    const dt = state.data?.updatedAt ? new Date(state.data.updatedAt).toLocaleString('fr-FR') : todayParis();
    footerMeta.textContent = `${vehicles.length} véhicules analysés · Dernière actualisation : ${dt} · Source : ${str(state.data?.source || 'Constructeurs France')}`;
  }
}

/* ---------- Composants Cartes & Badges ---------- */
function fullModelName(v) {
  const b = str(v?.brand).trim();
  const m = str(v?.model).trim();
  if (!b) return m;
  if (m.toLowerCase().startsWith(b.toLowerCase())) return m;
  return `${b} ${m}`;
}

function isCutoutImage(url) {
  return /carPicker|clearcut|day-exterior|navigation\/|compare-section|cosySec|DerivativeIntroductionModule|RangeFilterModule|odm\/vignettes|_next\/image/i.test(str(url));
}

function formatDeadlineInfo(validUntil) {
  const s = str(validUntil).trim();
  if (!s) return { label: 'Jusqu\'au 30/11/2026', urgent: false, daysLeft: 22 };
  const target = new Date(`${s}T23:59:59`);
  const ref = new Date('2026-11-08T12:00:00');
  const diffDays = Math.max(0, Math.ceil((target - ref) / (1000 * 60 * 60 * 24)));
  const [y, m, d] = s.split('-');
  const frDate = d && m && y ? `${d}/${m}/${y}` : s;
  const urgent = diffDays <= 16;
  return {
    frDate,
    daysLeft: diffDays,
    urgent,
    label: diffDays <= 25 ? `⏳ Fin le ${frDate} (J−${diffDays})` : `⏳ Jusqu'au ${frDate}`,
  };
}

function energyTag(energy) {
  const e = str(energy).toUpperCase();
  if (e === 'BEV') return `<span class="tag tag-bev">⚡ 100% Électrique (BEV)</span>`;
  if (e === 'PHEV') return `<span class="tag tag-phev">🔌 Hybride Rech. (PHEV)</span>`;
  if (e === 'HEV') return `<span class="tag tag-hev">🌿 Hybride Non-Rech. (HEV)</span>`;
  return `<span class="tag">${esc(e)}</span>`;
}

function renderVehicleCard(v) {
  const sc = state.scores.get(v.id) || { score: 50, metrics: metrics(v) };
  const m = sc.metrics;
  const inCmp = state.compareIds.includes(v.id);
  const margin = arr(v.negotiationMarginPct);
  const marginTxt = margin.length >= 2 ? `${margin[0]} à ${margin[1]} %` : margin.length === 1 ? `~${margin[0]} %` : '4 à 7 %';
  const official = safeUrl(v.officialUrl);
  const offer0 = arr(v.offers)[0] || {};
  const offerUrl = safeUrl(offer0.sourceUrl, official);
  const dl = formatDeadlineInfo(v.validUntil || offer0.validUntil);
  const imgUrl = safeUrl(v.imageUrl, '');
  const cutoutCls = isCutoutImage(imgUrl) ? 'is-cutout' : '';
  const discEur = num(offer0.discountEur) || m.maxDiscount || 0;
  const bonusEur = num(v.aids?.bonusEur) || 0;
  const officialMonthly = num(offer0.officialMonthlyEur);

  return `
    <article class="vehicle-card" data-vid="${esc(v.id)}">
      <div>
        ${
          imgUrl
            ? `
          <a href="#/vehicule/${encodeURIComponent(v.id)}" class="card-media" style="margin-bottom:0.75rem;text-decoration:none;">
            <img src="${esc(imgUrl)}" alt="${esc(fullModelName(v))}" class="card-photo ${cutoutCls}" loading="lazy" onerror="this.closest('.card-media').style.display='none'" />
            <div class="card-media-overlay">
              <span class="promo-pill ${dl.urgent ? 'urgent' : ''}">${esc(dl.label)}</span>
              ${m.bonus > 0 ? `<span class="tag tag-bonus" style="box-shadow:0 2px 8px rgba(0,0,0,0.4);">🎁 CEE/Bonus −${eur(m.bonus)}</span>` : ''}
            </div>
          </a>`
            : ''
        }

        <div class="card-top">
          <div class="badge-row">
            ${energyTag(v.energy)}
            <span class="tag">${esc(v.segment || (v.isSUV ? 'SUV' : 'Berline'))}</span>
            <span class="tag ${v.chineseBrand ? 'tag-cn' : ''}">📍 ${esc(v.origin || 'Europe')}${v.chineseBrand ? ' · Marque CN' : ''}</span>
          </div>
          <div class="score-badge" title="Score global d'opportunité sur 100">
            <span class="score-num">${sc.score}</span>
            <span class="score-lbl">/100</span>
          </div>
        </div>

        <div class="card-title-group">
          <div class="card-brand">${esc(v.brand)} · Fabriqué : ${esc(v.madeIn || v.origin || 'NC')}</div>
          <h3 class="card-title">
            <a href="#/vehicule/${encodeURIComponent(v.id)}">${esc(fullModelName(v))}</a>
          </h3>
        </div>

        ${
          v.promoName
            ? `
          <div class="promo-banner-box" style="margin-top:0.55rem;">
            <strong style="color:var(--amber);font-size:0.78rem;">${esc(v.promoName)}</strong>
            <span class="tag ${dl.urgent ? 'tag-cn' : ''}" style="font-size:0.7rem;">${esc(dl.label)}</span>
          </div>`
            : ''
        }
      </div>

      <!-- Décomposition transparente du Prix & du Loyer -->
      <div class="price-box">
        <div class="price-col">
          <span class="price-lbl">Prix net remise & aides déduites</span>
          <span class="price-main">${eur(m.bestNet ?? m.price)}</span>
          <div style="font-size:0.71rem;color:var(--text-secondary);margin-top:0.2rem;line-height:1.35;">
            Catalogue : <strong>${eur(v.priceFromEur)}</strong><br/>
            ${discEur > 0 ? `<span style="color:var(--amber);">− Remise officielle : ${eur(discEur)}</span><br/>` : ''}
            ${bonusEur > 0 ? `<span style="color:var(--emerald);">− Bonus/CEE : ${eur(bonusEur)}</span><br/>` : ''}
            ${
              v.officialSiteFromEur && v.officialSiteFromEur !== (m.bestNet ?? m.price)
                ? `<span class="muted">1er prix site ${esc(v.brand)} : ${eur(v.officialSiteFromEur)}</span>`
                : ''
            }
          </div>
        </div>
        <div class="price-col" style="border-left:1px solid var(--border);padding-left:0.65rem;">
          <span class="price-lbl">Votre loyer (0 € apport · 15 000 km/an)</span>
          <span class="price-lease">${m.bestMonthly ? `${eur(m.bestMonthly)}/mois` : 'Sur devis'}</span>
          <div style="font-size:0.71rem;color:var(--text-secondary);margin-top:0.2rem;line-height:1.35;">
            ${
              officialMonthly
                ? `<strong>Affiché site ${esc(v.brand)} : ${eur(officialMonthly)}/mois</strong><br/><span class="muted">${esc(offer0.officialLeaseTerms || 'Base 10 000 km/an')}</span>`
                : `0 € d'apport · 15 000 km/an · 48 mois`
            }
          </div>
        </div>
      </div>

      ${
        v.priceExplanation
          ? `
        <div class="price-explain-note">
          <strong>🔍 Pourquoi ce prix sur le site ${esc(v.brand)} ?</strong> ${esc(v.priceExplanation)}
        </div>`
          : ''
      }

      <div class="specs-mini">
        <div class="spec-pill">
          <span class="spec-pill-val">${m.range ? `${m.range} km` : '—'}</span>
          <span class="spec-pill-lbl">${v.energy === 'PHEV' && v.specs?.electricRangeKm ? `dont ${v.specs.electricRangeKm} EV` : 'Autonomie'}</span>
        </div>
        <div class="spec-pill">
          <span class="spec-pill-val">${v.specs?.trunkL ? `${v.specs.trunkL} L` : '—'}</span>
          <span class="spec-pill-lbl">Coffre</span>
        </div>
        <div class="spec-pill">
          <span class="spec-pill-val">${v.specs?.powerHp ? `${v.specs.powerHp} ch` : '—'}</span>
          <span class="spec-pill-lbl">Puissance</span>
        </div>
        <div class="spec-pill">
          <span class="spec-pill-val">−${esc(marginTxt)}</span>
          <span class="spec-pill-lbl">Négo. stock</span>
        </div>
      </div>

      <div class="card-actions">
        <a href="#/vehicule/${encodeURIComponent(v.id)}" class="btn btn-primary btn-sm">Fiche & Détail Prix</a>
        <button type="button" class="btn btn-outline btn-sm js-compare-rivals" data-id="${esc(v.id)}" title="Comparer directement aux modèles ${esc(v.energy)} concurrents">
          ⚖️ Duel ${esc(v.energy)}
        </button>
        <button type="button" class="btn btn-outline btn-sm js-toggle-cmp" data-id="${esc(v.id)}">
          ${inCmp ? '✓ Comparé' : '+ Comparer'}
        </button>
        <a href="${esc(offerUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm" title="Voir l'offre vérifiée sur le site officiel ${esc(v.brand)}">
          Offre ${esc(v.brand)} ↗
        </a>
      </div>
    </article>
  `;
}

const VEHICLE_TYPE_GROUPS = [
  {
    id: 'suv-familial',
    title: '🚙 SUV Familiaux (Spacieux & Longs Trajets)',
    subtitle: 'Gabarit 4,45 m à 4,78 m · Grand coffre (450 à 850 L) — ex : MG EHS PHEV / Hybrid+, Jaecoo 7 SHS, Renault Scénic E-Tech, BYD Seal U DM-i, Peugeot 3008…',
    match: (v) => str(v.segment).toLowerCase() === 'suv familial',
  },
  {
    id: 'suv-compact',
    title: '🚙 SUV Compacts (Polyvalents Ville & Route)',
    subtitle: 'Gabarit 4,30 m à 4,45 m — ex : Jaecoo 5 SHS / EV, Kia EV3, Renault Symbioz, Dacia Duster Hybrid, Hyundai Kona, MG ZS Hybrid+, Skoda Elroq…',
    match: (v) => str(v.segment).toLowerCase() === 'suv compact',
  },
  {
    id: 'suv-citadin',
    title: '🚙 SUV Citadins & Urbains (Format Compact Surélevé)',
    subtitle: 'Gabarit 3,82 m à 4,30 m — ex : Peugeot e-2008, Renault 4 E-Tech, Captur E-Tech, Toyota Yaris Cross, Citroën ë-C3 Aircross, Volvo EX30…',
    match: (v) => str(v.segment).toLowerCase() === 'suv citadin',
  },
  {
    id: 'compacte',
    title: '🚗 Compactes & Berlines (Gabarit type Mégane + Option Location Été)',
    subtitle: 'Berlines compactes & familiales à faible consommation — ex : Renault Mégane E-Tech, MG4 EV, VW ID.3, BYD Dolphin, Tesla Model 3…',
    match: (v) => !v.isSUV && ['compacte', 'berline'].includes(str(v.segment).toLowerCase()),
  },
  {
    id: 'citadine',
    title: '🚗 Citadines (Gabarit type Clio / R5 + Option Location Été)',
    subtitle: 'Agiles au quotidien et loyers ultra-réduits — ex : Renault Clio E-Tech, MG3 Hybrid+, R5 E-Tech, Peugeot e-208, Citroën ë-C3, Dacia Spring…',
    match: (v) => !v.isSUV && str(v.segment).toLowerCase() === 'citadine',
  },
];

/* ---------- Vue 1 : Tableau de bord & Offres (#/) ---------- */
function filterAndSortVehicles() {
  const vehicles = arr(state.data?.vehicles);
  const f = state.filters;
  const qNorm = f.q
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const filtered = vehicles.filter((v) => {
    const m = state.scores.get(v.id)?.metrics || metrics(v);
    if (qNorm) {
      const hay = `${v.brand} ${v.model} ${v.segment} ${v.energy} ${v.origin} ${v.promoName || ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      if (!hay.includes(qNorm)) return false;
    }
    const segLower = str(v.segment).toLowerCase();
    if (f.quick === 'suv' && !v.isSUV) return false;
    if (f.quick === 'suv-familial' && segLower !== 'suv familial') return false;
    if (f.quick === 'suv-compact' && segLower !== 'suv compact') return false;
    if (f.quick === 'suv-citadin' && segLower !== 'suv citadin') return false;
    if (f.quick === 'compacte' && !(!v.isSUV && ['compacte', 'berline'].includes(segLower))) return false;
    if (f.quick === 'citadine' && !(!v.isSUV && segLower === 'citadine')) return false;
    if (f.quick === 'compact' && !isCompactGab(v)) return false;
    if (['BEV', 'PHEV', 'HEV'].includes(f.quick) && v.energy !== f.quick) return false;
    if (f.quick === 'chinese' && !v.chineseBrand) return false;
    if (f.quick === 'bonus' && !(v.aids?.ecoScoreEligible || (num(v.aids?.bonusEur) || 0) > 0)) return false;
    if (f.quick === 'urgent') {
      const dl = formatDeadlineInfo(v.validUntil || v.offers?.[0]?.validUntil);
      if (dl.daysLeft > 22 && !(m.maxDiscount >= 3000)) return false;
    }

    const maxB = num(f.maxBudget);
    if (maxB != null && maxB > 0 && (m.bestNet ?? m.price ?? 999999) > maxB) return false;

    const maxM = num(f.maxMonthly);
    if (maxM != null && maxM > 0 && (m.bestMonthly ?? 99999) > maxM) return false;

    const minR = num(f.minRange);
    if (minR != null && minR > 0 && (m.range ?? 0) < minR) return false;

    const minT = num(f.minTrunk);
    if (minT != null && minT > 0 && (num(v.specs?.trunkL) ?? 0) < minT) return false;

    return true;
  });

  filtered.sort((a, b) => {
    const sa = state.scores.get(a.id) || { score: 0, metrics: metrics(a) };
    const sb = state.scores.get(b.id) || { score: 0, metrics: metrics(b) };
    if (f.sort === 'netAsc') return (sa.metrics.bestNet ?? 999999) - (sb.metrics.bestNet ?? 999999);
    if (f.sort === 'monthlyAsc') return (sa.metrics.bestMonthly ?? 99999) - (sb.metrics.bestMonthly ?? 99999);
    if (f.sort === 'discountDesc') return (sb.metrics.maxDiscount ?? 0) - (sa.metrics.maxDiscount ?? 0);
    if (f.sort === 'rangeDesc') return (sb.metrics.range ?? 0) - (sa.metrics.range ?? 0);
    return sb.score - sa.score;
  });

  return filtered;
}

function renderDashboard(main) {
  const vehicles = arr(state.data?.vehicles);
  const allMetrics = vehicles.map((v) => ({ v, s: state.scores.get(v.id)?.score || 0, m: state.scores.get(v.id)?.metrics || metrics(v) }));

  const bestDiscountItem = [...allMetrics].sort((a, b) => (b.m.maxDiscount || 0) - (a.m.maxDiscount || 0))[0];
  const bestLeaseItem = [...allMetrics].filter((x) => x.m.bestMonthly != null).sort((a, b) => a.m.bestMonthly - b.m.bestMonthly)[0];
  const top3 = [...allMetrics].sort((a, b) => b.s - a.s).slice(0, 3);

  const ch = state.changes;
  const hasChanges = ch.drops.length > 0 || ch.newOffers.length > 0 || ch.newVehicles.length > 0;

  main.innerHTML = `
    <!-- Bandeau KPI -->
    <section class="kpi-grid" aria-label="Indicateurs clés du marché">
      <div class="kpi-card">
        <span class="kpi-label">Catalogue vérifié (liens & photos)</span>
        <span class="kpi-value">${vehicles.length} modèles</span>
        <span class="kpi-sub">${vehicles.filter((v) => v.isSUV).length} SUV · ${vehicles.filter((v) => isCompactGab(v)).length} Citadines/Compactes</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Plus forte remise officielle</span>
        <span class="kpi-value" style="color:var(--emerald);">−${eur(bestDiscountItem?.m.maxDiscount || 0)}</span>
        <span class="kpi-sub">${bestDiscountItem ? `${esc(fullModelName(bestDiscountItem.v))}` : '—'}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Meilleur loyer (0 € apport · 15k km)</span>
        <span class="kpi-value" style="color:var(--accent);">${bestLeaseItem ? `${eur(bestLeaseItem.m.bestMonthly)}/mois` : '—'}</span>
        <span class="kpi-sub">${bestLeaseItem ? `${esc(fullModelName(bestLeaseItem.v))}` : '—'}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Comparatifs Dédiés par Énergie</span>
        <span class="kpi-value" style="font-size:1.15rem;">🌿 HEV · 🔌 PHEV · ⚡ BEV</span>
        <span class="kpi-sub"><a href="#/comparateur">Ouvrir les duels par motorisation →</a></span>
      </div>
    </section>

    <!-- Encadré explicatif : Pourquoi les prix diffèrent parfois du 1er prix affiché chez le constructeur -->
    <section class="panel-card" style="margin-bottom:1.25rem;border-left:4px solid var(--amber);padding:1rem 1.25rem;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;">
        <div style="max-width:920px;">
          <strong style="color:var(--amber);font-size:0.95rem;">💡 Pourquoi nos prix et loyers diffèrent parfois du 1er chiffre d'appel sur le site constructeur ?</strong>
          <p class="muted" style="font-size:0.82rem;margin-top:0.3rem;line-height:1.45;">
            Sur chaque fiche ci-dessous, nous affichons désormais <strong>les deux tarifs côte à côte</strong> pour une transparence totale :
            <br/>1️⃣ <strong>Motorisation comparée :</strong> Le « 1er prix » d'une page constructeur (ex. Clio à 19 900 € ou Duster à 19 990 €) concerne souvent la version <em>essence/GPL de base</em>, alors que nous comparons la vraie version <strong>Hybride (HEV/PHEV) ou Électrique autonomie confort</strong>.
            <br/>2️⃣ <strong>Aides d'État (Prime CEE) :</strong> Certains constructeurs (Peugeot, Volvo, Kia) déduisent dans leur loyer d'appel une <em>Prime Coup de pouce CEE majorée de 6 000 € à 7 000 €</em> réservée aux revenus très modestes (déciles D1–D3). Nous précisons le prix avec bonus/CEE standard (4 000 €) et la remise constructeur réelle.
            <br/>3️⃣ <strong>Kilométrage & Apport LLD :</strong> Les loyers constructeurs sont presque toujours calculés pour <strong>10 000 km/an (et parfois 3 000 € d'apport)</strong>. Nous affichons l'offre officielle du site <u>ET</u> le loyer recalculé pour votre besoin réel : <strong>0 € d'apport · 15 000 km/an</strong>.
          </p>
        </div>
        <a href="#/comparateur" class="btn btn-primary btn-sm">⚖️ Comparer par motorisation (HEV / PHEV / BEV) →</a>
      </div>
    </section>

    <!-- Section Alertes & Offres Ponctuelles à Date Limite -->
    <section class="alerts-strip" aria-label="Offres ponctuelles et dates de fin">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
        <div>
          <strong style="color:var(--emerald);">⏳ Offres Ponctuelles Constructeurs & Dates Limites de Commande</strong>
          <span class="muted" style="font-size:0.84rem;margin-left:0.5rem;">
            Opérations spéciales vérifiées sur les sites officiels (Novembre – Décembre 2026)
          </span>
        </div>
        <a href="#/alertes" class="btn btn-outline btn-sm">Alertes 6h30 & 7h00</a>
      </div>
      <div class="alerts-list">
        <div class="alert-item">
          <div>
            <strong>🔥 MG EHS PHEV & EHS Hybrid+ (« À Saisir »)</strong>
            <div class="muted" style="font-size:0.78rem;"><strong>−6 000 €</strong> (4 000 € Avantage MG + 2 000 € stock) → dès 26 490 € / 31 990 €</div>
          </div>
          <a href="#/vehicule/mg-ehs-phev" class="tag tag-cn">⏳ Fin 15/11 (J−7)</a>
        </div>
        <div class="alert-item">
          <div>
            <strong>🔥 Hyundai Inster 49 kWh au prix du 42 kWh</strong>
            <div class="muted" style="font-size:0.78rem;">Grande batterie 370 km WLTP facturée au tarif 42 kWh (−3 250 € cumulés)</div>
          </div>
          <a href="#/vehicule/hyundai-inster-electric-49" class="tag tag-cn">⏳ Fin 23/11 (J−15)</a>
        </div>
        <div class="alert-item">
          <div>
            <strong>🔥 BYD Seal U DM-i PHEV & Dolphin</strong>
            <div class="muted" style="font-size:0.78rem;">Remise officielle <strong>−6 360 € à −7 365 €</strong> → Seal U DM-i dès 32 630 €</div>
          </div>
          <a href="#/vehicule/byd-seal-u-dm-i-boost" class="tag tag-bonus">⏳ Fin 30/11</a>
        </div>
        <div class="alert-item">
          <div>
            <strong>🔥 Gamme Jaecoo 7 & 5 (LLD 0 € d'apport)</strong>
            <div class="muted" style="font-size:0.78rem;">Jaecoo 5 Hybride 299 €/mois · Jaecoo 7 Hybride 349 € · PHEV 419 €</div>
          </div>
          <a href="#/vehicule/jaecoo-7-shs-phev" class="tag tag-bev">⏳ Offre T4 2026</a>
        </div>
      </div>
    </section>

    <!-- Podium Top 3 Meilleures Offres du jour -->
    <div class="section-header">
      <div>
        <h2 class="section-title">🏆 Podium des Meilleures Offres du Jour</h2>
        <p class="section-subtitle">Classement algorithmique (/100) combinant prix net après aides, loyer effectif, autonomie, équipements et remise concession.</p>
      </div>
      <a href="#/simulateur" class="btn btn-outline btn-sm">💡 Simuler Compacte + Location été vs SUV →</a>
    </div>

    <section class="podium-grid">
      ${top3
        .map(
          (item, idx) => `
        <div class="podium-card">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span class="podium-rank">#${idx + 1} Meilleure Offre · Score ${item.s}/100</span>
            ${energyTag(item.v.energy)}
          </div>
          <div>
            <h3 style="font-family:'Space Grotesk',sans-serif;font-size:1.25rem;margin-bottom:0.25rem;">
              <a href="#/vehicule/${encodeURIComponent(item.v.id)}" style="color:var(--text);">${esc(fullModelName(item.v))}</a>
            </h3>
            <p class="muted" style="font-size:0.83rem;">
              Prix net : <strong style="color:var(--emerald);">${eur(item.m.bestNet)}</strong>
              ${item.m.maxDiscount ? `(Remise −${eur(item.m.maxDiscount)})` : ''}
              ${item.m.bestMonthly ? ` · 0 € apport / 15k km : <strong style="color:var(--accent);">${eur(item.m.bestMonthly)}/mois</strong>` : ''}
            </p>
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <a href="#/vehicule/${encodeURIComponent(item.v.id)}" class="btn btn-primary btn-sm">Fiche & Explication Prix</a>
            <a href="${esc(safeUrl(item.v.officialUrl))}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm">Site ${esc(item.v.brand)} ↗</a>
          </div>
        </div>
      `
        )
        .join('')}
    </section>

    <!-- Filtres & Recherche -->
    <section class="filter-panel" aria-label="Recherche et filtres">
      <div class="filter-top">
        <div class="search-input-wrap">
          <input id="f-q" type="search" class="search-input" placeholder="🔍 Rechercher une marque ou modèle (ex: MG EHS, Jaecoo, Clio, Mégane, Scénic, BYD, Kia EV3, 3008…)" value="${esc(state.filters.q)}" />
        </div>
        <select id="f-sort" class="select-input" aria-label="Trier par">
          <option value="score" ${state.filters.sort === 'score' ? 'selected' : ''}>Trier : Meilleur score (/100)</option>
          <option value="netAsc" ${state.filters.sort === 'netAsc' ? 'selected' : ''}>Trier : Prix net croissant</option>
          <option value="monthlyAsc" ${state.filters.sort === 'monthlyAsc' ? 'selected' : ''}>Trier : Mensualité croissante (0 € apport)</option>
          <option value="discountDesc" ${state.filters.sort === 'discountDesc' ? 'selected' : ''}>Trier : Remise max</option>
          <option value="rangeDesc" ${state.filters.sort === 'rangeDesc' ? 'selected' : ''}>Trier : Autonomie décroissante</option>
        </select>
        <div style="display:flex;gap:0.4rem;">
          <button id="f-view-toggle" type="button" class="btn btn-outline btn-sm" title="Basculer entre la présentation par type de véhicule et la grille globale">
            ${state.filters.viewMode === 'byType' ? '🗂️ Vue : Par type de véhicule' : '📋 Vue : Grille globale'}
          </button>
          <button id="f-reset" type="button" class="btn btn-ghost btn-sm">Tout afficher (sans limite loyer)</button>
        </div>
      </div>

      <div style="font-size:0.78rem;color:var(--text-muted);margin:0.5rem 0 0.35rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">
        1. Filtrer directement par motorisation, type de véhicule ou offre ponctuelle :
      </div>
      <div class="quick-pills" id="quick-pills">
        ${[
          ['all', '🗂️ Tous les types (groupés)'],
          ['HEV', '🌿 Hybrides Non-Rechargeables (HEV)'],
          ['PHEV', '🔌 Hybrides Rechargeables (PHEV)'],
          ['BEV', '⚡ 100% Électriques (BEV)'],
          ['urgent', '⏳ Offres ponctuelles & Fortes remises'],
          ['suv-familial', '🚙 SUV Familiaux (EHS, Jaecoo 7, Scénic, Seal U…)'],
          ['suv-compact', '🚙 SUV Compacts (Jaecoo 5, EV3, Symbioz, Duster…)'],
          ['suv-citadin', '🚙 SUV Citadins (e-2008, R4, Captur, Yaris Cross…)'],
          ['compacte', '🚗 Compactes & Berlines (type Mégane, MG4, ID.3…)'],
          ['citadine', '🚗 Citadines (type Clio, MG3, R5, e-208, ë-C3…)'],
          ['chinese', '🐉 Marques chinoises (MG, Jaecoo, BYD, Xpeng, Leapmotor)'],
          ['bonus', '🎁 Éligible Bonus / CEE'],
        ]
          .map(
            ([key, label]) =>
              `<button type="button" class="pill-btn ${state.filters.quick === key ? 'active' : ''}" data-quick="${key}">${label}</button>`
          )
          .join('')}
      </div>

      <div class="filter-sliders">
        <div class="filter-field">
          <label for="f-budget">Budget achat net max (€)</label>
          <input id="f-budget" type="number" step="1000" placeholder="Ex: 38000" class="number-input" value="${esc(state.filters.maxBudget)}" />
        </div>
        <div class="filter-field">
          <label for="f-monthly">Loyer max (€/mois · 0 € apport · 15 000 km/an)</label>
          <input id="f-monthly" type="number" step="10" placeholder="Ex: 450" class="number-input" value="${esc(state.filters.maxMonthly)}" />
        </div>
        <div class="filter-field">
          <label for="f-range">Autonomie min (km)</label>
          <input id="f-range" type="number" step="50" placeholder="Ex: 400" class="number-input" value="${esc(state.filters.minRange)}" />
        </div>
        <div class="filter-field">
          <label for="f-trunk">Coffre min (Litres)</label>
          <input id="f-trunk" type="number" step="20" placeholder="Ex: 400" class="number-input" value="${esc(state.filters.minTrunk)}" />
        </div>
      </div>
    </section>

    <div class="section-header" style="margin-top:0.5rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.75rem;">
      <div id="results-count" class="section-subtitle"></div>
      <div id="type-jump-bar" style="display:flex;gap:0.4rem;flex-wrap:wrap;"></div>
    </div>

    <div id="vehicles-container"></div>
  `;

  const updateGridOnly = () => {
    const list = filterAndSortVehicles();
    const countEl = document.getElementById('results-count');
    const jumpBar = document.getElementById('type-jump-bar');
    const maxM = num(state.filters.maxMonthly);
    if (countEl) {
      countEl.innerHTML = `<strong>${list.length}</strong> véhicule${list.length > 1 ? 's' : ''} affiché${list.length > 1 ? 's' : ''} · Base financement : <strong>0 € d'apport · 15 000 km/an</strong>${
        maxM ? ` · Plafond actif : <strong>≤ ${eur(maxM)}/mois</strong>` : ''
      }`;
    }
    const container = document.getElementById('vehicles-container');
    if (!container) return;
    if (!list.length) {
      if (jumpBar) jumpBar.innerHTML = '';
      container.innerHTML = `
        <div class="panel-card" style="text-align:center;">
          <p>Aucun véhicule ne correspond à ces filtres.</p>
          <button type="button" class="btn btn-primary btn-sm" style="margin-top:0.75rem;" id="empty-reset">Réinitialiser les filtres (0 € apport · ≤ 450 €/mois)</button>
        </div>
      `;
      document.getElementById('empty-reset')?.addEventListener('click', () => {
        state.filters = { q: '', quick: 'all', maxBudget: '', maxMonthly: '450', minRange: '', minTrunk: '', sort: 'score', viewMode: 'byType' };
        renderDashboard(main);
      });
      return;
    }

    if (state.filters.viewMode === 'byType') {
      const groupsHtml = [];
      const jumpLinks = [];
      for (const grp of VEHICLE_TYPE_GROUPS) {
        const items = list.filter(grp.match);
        if (!items.length) continue;
        jumpLinks.push(
          `<a href="# group-${grp.id}" data-jump="group-${grp.id}" class="tag" style="text-decoration:none;cursor:pointer;">${esc(grp.title.split('(')[0].trim())} (${items.length})</a>`
        );
        groupsHtml.push(`
          <section id="group-${grp.id}" class="type-group-section" style="margin-bottom:2.25rem;">
            <div class="panel-card" style="margin-bottom:1rem;padding:1rem 1.25rem;border-left:4px solid var(--accent);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
              <div>
                <h3 style="font-family:'Space Grotesk',sans-serif;font-size:1.2rem;margin:0 0 0.2rem;">${esc(grp.title)}</h3>
                <p class="muted" style="font-size:0.83rem;margin:0;">${esc(grp.subtitle)}</p>
              </div>
              <span class="tag tag-bev" style="font-size:0.82rem;">${items.length} modèle${items.length > 1 ? 's' : ''}</span>
            </div>
            <div class="vehicles-grid">
              ${items.map(renderVehicleCard).join('')}
            </div>
          </section>
        `);
      }
      if (jumpBar) {
        jumpBar.innerHTML = jumpLinks.join('');
        jumpBar.querySelectorAll('[data-jump]').forEach((a) => {
          a.addEventListener('click', (ev) => {
            ev.preventDefault();
            const target = document.getElementById(a.getAttribute('data-jump'));
            target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        });
      }
      container.innerHTML = groupsHtml.join('');
    } else {
      if (jumpBar) jumpBar.innerHTML = '';
      container.innerHTML = `<section class="vehicles-grid">${list.map(renderVehicleCard).join('')}</section>`;
    }
  };

  updateGridOnly();

  document.getElementById('f-q')?.addEventListener('input', (e) => {
    state.filters.q = e.target.value;
    updateGridOnly();
  });
  document.getElementById('f-sort')?.addEventListener('change', (e) => {
    state.filters.sort = e.target.value;
    updateGridOnly();
  });
  document.getElementById('f-view-toggle')?.addEventListener('click', () => {
    state.filters.viewMode = state.filters.viewMode === 'byType' ? 'flat' : 'byType';
    renderDashboard(main);
  });
  document.getElementById('f-budget')?.addEventListener('input', (e) => {
    state.filters.maxBudget = e.target.value;
    updateGridOnly();
  });
  document.getElementById('f-monthly')?.addEventListener('input', (e) => {
    state.filters.maxMonthly = e.target.value;
    updateGridOnly();
  });
  document.getElementById('f-range')?.addEventListener('input', (e) => {
    state.filters.minRange = e.target.value;
    updateGridOnly();
  });
  document.getElementById('f-trunk')?.addEventListener('input', (e) => {
    state.filters.minTrunk = e.target.value;
    updateGridOnly();
  });
  document.getElementById('f-reset')?.addEventListener('click', () => {
    state.filters = { q: '', quick: 'all', maxBudget: '', maxMonthly: '', minRange: '', minTrunk: '', sort: 'score', viewMode: 'byType' };
    renderDashboard(main);
  });
  document.getElementById('quick-pills')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-quick]');
    if (!btn) return;
    state.filters.quick = btn.getAttribute('data-quick');
    document.querySelectorAll('#quick-pills .pill-btn').forEach((b) => b.classList.toggle('active', b === btn));
    updateGridOnly();
  });
}

/* ---------- Vue 2 : Fiche Véhicule Détaillée (#/vehicule/<id>) ---------- */
function buildNegotiationEmail(v, m) {
  const margin = arr(v.negotiationMarginPct);
  const targetPct = margin.length >= 2 ? Math.round((margin[0] + margin[1]) / 2) : 6;
  const basePrice = m.bestNet ?? m.price ?? 30000;
  const targetPrice = Math.round((basePrice * (100 - Math.min(targetPct, 5))) / 100 / 100) * 100;
  return `Objet : Demande de proposition commerciale — ${v.brand} ${v.model} (achat / financement rapide sur stock)

Bonjour,

Je finalise actuellement mon projet d'acquisition d'un véhicule ${v.energy} et le modèle ${v.brand} ${v.model} figure parmi mes deux finalistes.

J'ai pris connaissance de votre offre actuelle (${m.bestNetOffer?.title || `tarif affiché autour de ${eur(basePrice)}`}${m.bestMonthly ? ` / loyer dès ${eur(m.bestMonthly)}/mois` : ''}).
Disposant d'un dossier de financement prêt et pouvant me positionner rapidement sur un véhicule en stock ou en arrivage sur ce trimestre, je souhaiterais obtenir votre meilleure proposition commerciale « clé en main » (frais de mise à la route et accessoires inclus).

Au vu des conditions pratiquées actuellement sur le segment (objectif autour de ${eur(targetPrice)} TTC net ou loyer optimisé avec entretien/câble inclus), quelle remise sur stock ou avantage client complémentaire pourriez-vous m'accorder pour conclure cette semaine ?

Je reste joignable par téléphone ou disponible pour un essai en concession.

Cordialement,`;
}

function renderVehicleDetail(main, id) {
  const vehicles = arr(state.data?.vehicles);
  const v = vehicles.find((x) => x.id === id);
  if (!v) {
    main.innerHTML = `
      <div class="panel-card">
        <h2>Véhicule introuvable</h2>
        <p class="muted">L'identifiant <code>${esc(id)}</code> n'existe pas dans le catalogue.</p>
        <a href="#/" class="btn btn-primary" style="margin-top:1rem;">← Retour au catalogue</a>
      </div>
    `;
    return;
  }

  const sc = state.scores.get(v.id) || { score: 50, metrics: metrics(v) };
  const m = sc.metrics;
  const official = safeUrl(v.officialUrl);
  const configUrl = v.configuratorUrl ? safeUrl(v.configuratorUrl, '') : '';
  const offer0 = arr(v.offers)[0] || {};
  const offerUrl = safeUrl(offer0.sourceUrl, official);
  const dl = formatDeadlineInfo(v.validUntil || offer0.validUntil);
  const imgUrl = safeUrl(v.imageUrl, '');
  const cutoutCls = isCutoutImage(imgUrl) ? 'is-cutout' : '';
  const margin = arr(v.negotiationMarginPct);
  const marginStr = margin.length >= 2 ? `${margin[0]} % à ${margin[1]} %` : '4 % à 8 %';
  const scale = ratingScale(vehicles);
  const inCmp = state.compareIds.includes(v.id);
  const s = v.specs || {};
  const discEur = num(offer0.discountEur) || m.maxDiscount || 0;
  const bonusEur = num(v.aids?.bonusEur) || 0;
  const officialMonthly = num(offer0.officialMonthlyEur);

  main.innerHTML = `
    <div style="margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
      <a href="#/" class="btn btn-ghost btn-sm">← Retour à toutes les offres</a>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
        <button type="button" class="btn btn-primary btn-sm js-compare-rivals" data-id="${esc(v.id)}">
          ⚖️ Comparer aux concurrents ${esc(v.energy)} directs
        </button>
        <button type="button" class="btn btn-outline btn-sm js-toggle-cmp" data-id="${esc(v.id)}">
          ${inCmp ? '✓ Dans le comparateur' : '+ Ajouter au comparateur'}
        </button>
        <a href="#/simulateur" class="btn btn-outline btn-sm">🧮 Simuler le TCO 4 ans</a>
      </div>
    </div>

    <section class="detail-hero">
      <div class="detail-hero-top">
        ${
          imgUrl
            ? `
          <div class="detail-photo-frame">
            <img src="${esc(imgUrl)}" alt="${esc(fullModelName(v))}" class="detail-photo ${cutoutCls}" />
          </div>`
            : ''
        }
        <div style="flex:1;min-width:260px;">
          <div class="badge-row">
            ${energyTag(v.energy)}
            <span class="tag">${esc(v.segment)}</span>
            <span class="tag ${v.chineseBrand ? 'tag-cn' : ''}">📍 Origine : ${esc(v.origin)} (${esc(v.madeIn || v.origin)})</span>
            ${v.aids?.ecoScoreEligible ? `<span class="tag tag-bonus">✓ Éco-score ADEME validé</span>` : ''}
            <span class="tag ${dl.urgent ? 'tag-cn' : 'tag-bonus'}">${esc(dl.label)}</span>
          </div>
          <h1 class="detail-title">
            <a href="${esc(official)}" target="_blank" rel="noopener noreferrer" title="Ouvrir la page officielle ${esc(fullModelName(v))}">
              ${esc(fullModelName(v))} ↗
            </a>
          </h1>
          <p class="muted">
            Prix catalogue de réf. : <strong>${eur(v.priceFromEur)}</strong> ${v.priceToEur ? `à ${eur(v.priceToEur)}` : ''}
            · Prix net (remise & aides déduites) : <strong style="color:var(--emerald);font-size:1.15rem;">${eur(m.bestNet ?? m.price)}</strong>
            ${m.bestMonthly ? ` · Votre loyer (0 € apport · 15 000 km/an) : <strong style="color:var(--accent);font-size:1.1rem;">${eur(m.bestMonthly)}/mois</strong>` : ''}
          </p>
          ${
            v.promoName
              ? `
            <div class="promo-banner-box" style="margin-top:0.75rem;">
              <strong>${esc(v.promoName)}</strong>
              <span class="tag ${dl.urgent ? 'tag-cn' : ''}">${esc(dl.label)}</span>
            </div>`
              : ''
          }
        </div>

        <div class="score-badge" style="width:70px;height:70px;">
          <span class="score-num" style="font-size:1.45rem;">${sc.score}</span>
          <span class="score-lbl">Score /100</span>
        </div>
      </div>

      <!-- Bannière d'accès direct au site officiel de la marque et de l'offre -->
      <div class="official-cta-bar">
        <div>
          <strong>🔗 Liens officiels vérifiés — ${esc(v.brand)} France</strong>
          <p class="muted" style="font-size:0.84rem;">Accédez directement à la page modèle, aux offres promotionnelles en cours et au configurateur ${esc(fullModelName(v))}.</p>
        </div>
        <div style="display:flex;gap:0.65rem;flex-wrap:wrap;">
          <a href="${esc(official)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
            Page Modèle ${esc(v.brand)} ↗
          </a>
          <a href="${esc(offerUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-emerald">
            Page Offre Promotionnelle ${esc(v.brand)} ↗
          </a>
          ${
            configUrl && configUrl !== official
              ? `<a href="${esc(configUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline">Configurateur ${esc(v.brand)} ↗</a>`
              : ''
          }
        </div>
      </div>
    </section>

    <div class="detail-grid">
      <div>
        <!-- Explication détaillée du prix & comparaison avec le site constructeur -->
        <section class="panel-card" style="border-left:4px solid var(--accent);">
          <h3>🔍 Explication Transparente du Prix, des Remises & du Financement</h3>
          ${
            v.priceExplanation
              ? `<div class="price-explain-note" style="font-size:0.86rem;margin-bottom:1rem;padding:0.75rem 1rem;">
                  <strong>Pourquoi ce tarif et comment le retrouver sur le site ${esc(v.brand)} ?</strong><br/>
                  ${esc(v.priceExplanation)}
                </div>`
              : ''
          }
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem;">
            <div class="price-waterfall">
              <strong style="font-size:0.85rem;color:var(--accent);margin-bottom:0.25rem;">1. Décomposition du prix d'achat TTC</strong>
              <div class="waterfall-row">
                <span class="muted">Prix catalogue officiel (version réf.)</span>
                <strong>${eur(v.priceFromEur)}</strong>
              </div>
              <div class="waterfall-row">
                <span class="muted">− Remise / Avantage officiel ${esc(v.brand)}</span>
                <strong style="color:var(--amber);">−${eur(discEur)}</strong>
              </div>
              <div class="waterfall-row">
                <span class="muted">− Bonus Écologique / Prime CEE 2026</span>
                <strong style="color:var(--emerald);">−${eur(bonusEur)}</strong>
              </div>
              <div class="waterfall-row net-row">
                <span>= Prix net remise & aides déduites</span>
                <span style="color:var(--emerald);font-size:1.05rem;">${eur(m.bestNet ?? m.price)}</span>
              </div>
              ${
                v.officialSiteFromEur
                  ? `<div class="waterfall-row" style="margin-top:0.2rem;font-size:0.75rem;">
                      <span class="muted">1er prix « À partir de » affiché sur site ${esc(v.brand)}</span>
                      <span>${eur(v.officialSiteFromEur)}</span>
                    </div>`
                  : ''
              }
            </div>

            <div class="price-waterfall">
              <strong style="font-size:0.85rem;color:var(--accent);margin-bottom:0.25rem;">2. Loyer Site Officiel vs Votre Profil (15 000 km/an)</strong>
              <div class="waterfall-row">
                <span class="muted">Loyer d'appel affiché sur site ${esc(v.brand)}</span>
                <strong>${officialMonthly ? `${eur(officialMonthly)}/mois` : '—'}</strong>
              </div>
              <div class="waterfall-row">
                <span class="muted">Conditions de l'offre site officiel</span>
                <span style="text-align:right;font-size:0.74rem;">${esc(offer0.officialLeaseTerms || 'Base 10 000 km/an')}</span>
              </div>
              <div class="waterfall-row net-row">
                <span>= Votre loyer recalculé (0 € apport · 15 000 km/an)</span>
                <span style="color:var(--accent);font-size:1.05rem;">${m.bestMonthly ? `${eur(m.bestMonthly)}/mois` : '—'}</span>
              </div>
              <div class="waterfall-row" style="margin-top:0.2rem;font-size:0.75rem;">
                <span class="muted">Date de fin de l'offre ponctuelle</span>
                <strong style="color:var(--amber);">${esc(dl.label)}</strong>
              </div>
            </div>
          </div>
        </section>

        <!-- Offres tarifaires actuelles -->
        <section class="panel-card">
          <h3>🏷️ Offres ponctuelles & Financements vérifiés (LLD / LOA / Remises)</h3>
          <div class="offers-stack">
            ${
              arr(v.offers).length
                ? arr(v.offers)
                    .map(
                      (o) => `
                  <div class="offer-item">
                    <div style="max-width:520px;">
                      <div class="badge-row" style="margin-bottom:0.3rem;">
                        <span class="tag tag-bev">${esc(o.type || 'Offre')}</span>
                        ${isRestricted(o) ? `<span class="tag tag-cn">Sous conditions de revenus</span>` : ''}
                        <span class="tag ${dl.urgent ? 'tag-cn' : 'tag-bonus'}">${esc(dl.label)}</span>
                      </div>
                      <strong style="font-size:1rem;display:block;">${esc(o.title)}</strong>
                      <p class="muted" style="font-size:0.83rem;margin-top:0.25rem;">${esc(o.conditions || '')}</p>
                    </div>
                    <div style="text-align:right;">
                      ${
                        o.monthlyEur
                          ? `<div style="font-family:'Space Grotesk',sans-serif;font-size:1.35rem;font-weight:800;color:var(--accent);">${eur(o.monthlyEur)}/mois</div>
                             <div class="muted" style="font-size:0.78rem;">0 € d'apport · ${o.durationMonths || 48} mois · ${
                              o.kmPerYear ? `${Number(o.kmPerYear).toLocaleString('fr-FR')} km/an` : '15 000 km/an'
                            }</div>
                             ${
                               o.officialMonthlyEur
                                 ? `<div style="font-size:0.75rem;color:var(--amber);margin-top:0.15rem;">(Affiché site ${esc(v.brand)} : ${eur(o.officialMonthlyEur)}/mois en 10 000 km/an)</div>`
                                 : ''
                             }`
                          : ''
                      }
                      ${
                        o.priceAfterEur
                          ? `<div style="font-weight:700;color:var(--emerald);margin-top:0.2rem;">Prix net : ${eur(o.priceAfterEur)}</div>`
                          : ''
                      }
                      ${o.discountEur ? `<div class="tag tag-bonus" style="margin-top:0.25rem;">Remise officielle −${eur(o.discountEur)}</div>` : ''}
                      <div style="margin-top:0.5rem;">
                        <a href="${esc(safeUrl(o.sourceUrl, official))}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">
                          Vérifier l'offre sur ${esc(v.brand)} ↗
                        </a>
                      </div>
                    </div>
                  </div>
                `
                    )
                    .join('')
                : `<p class="muted">Aucune offre promotionnelle spécifique répertoriée. Consultez le site officiel.</p>`
            }
          </div>
        </section>

        <!-- Comportement des concessions & Négociation -->
        <section class="panel-card negotiation-box">
          <h3>🤝 Comportement des concessions & Argumentaire de négociation</h3>
          <p style="margin-bottom:0.75rem;">${esc(v.dealerBehavior || 'Négociation possible sur les véhicules en stock en fin de mois/trimestre.')}</p>
          <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;">
            <div class="spec-pill" style="padding:0.6rem 1rem;">
              <span class="spec-pill-lbl">Marge de négociation supplémentaire en concession</span>
              <span class="spec-pill-val" style="color:var(--amber);font-size:1.05rem;">−${esc(marginStr)}</span>
            </div>
            <div class="spec-pill" style="padding:0.6rem 1rem;">
              <span class="spec-pill-lbl">Prix cible négocié sur stock</span>
              <span class="spec-pill-val" style="color:var(--emerald);font-size:1.05rem;">
                ${
                  m.bestNet && margin.length
                    ? `${eur(m.bestNet * (1 - (margin[1] || margin[0]) / 200))} à ${eur(m.bestNet)}`
                    : eur(m.bestNet)
                }
              </span>
            </div>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
              <strong style="font-size:0.88rem;">✉️ Modèle d'email de négociation personnalisé (prêt à envoyer à la concession) :</strong>
              <button type="button" id="copy-nego-btn" class="btn btn-emerald btn-sm">📋 Copier l'argumentaire en 1 clic</button>
            </div>
            <textarea id="nego-email-text" class="email-template-area">${esc(buildNegotiationEmail(v, m))}</textarea>
          </div>
        </section>

        <!-- Comparatif des finitions / versions -->
        <section class="panel-card">
          <h3>🎚️ Versions & Finitions disponibles (Tarifs Catalogue Officiels)</h3>
          <div class="offers-stack">
            ${arr(v.versions)
              .map(
                (ver) => `
              <div class="offer-item">
                <div>
                  <strong>${esc(ver.name)}</strong>
                  <div class="badge-row" style="margin-top:0.35rem;">
                    ${arr(ver.highlights)
                      .map((h) => `<span class="tag">${esc(h)}</span>`)
                      .join('')}
                  </div>
                </div>
                <div style="font-family:'Space Grotesk',sans-serif;font-size:1.15rem;font-weight:700;">
                  ${eur(ver.priceEur)}
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </section>

        <!-- Ce qui est compris de série -->
        <section class="panel-card">
          <h3>✅ Ce qui est compris (Équipements de série)</h3>
          <ul class="equip-list">
            ${arr(v.standardEquipment)
              .map((eq) => `<li>✓ ${esc(eq)}</li>`)
              .join('')}
          </ul>
        </section>
      </div>

      <!-- Colonne latérale : Caractéristiques, Aides, Avis -->
      <div>
        <section class="panel-card">
          <h3>📐 Caractéristiques techniques</h3>
          <table class="specs-table">
            <tbody>
              <tr><th>Motorisation / Énergie</th><td>${esc(v.energy)} · ${s.powerHp ? `${s.powerHp} ch` : '—'}</td></tr>
              <tr><th>Batterie utile</th><td>${s.batteryKwh ? `${s.batteryKwh} kWh` : '—'}</td></tr>
              <tr><th>Autonomie WLTP</th><td>${s.rangeKm ? `${s.rangeKm} km` : '—'}${s.electricRangeKm && v.energy === 'PHEV' ? ` (${s.electricRangeKm} km EV)` : ''}</td></tr>
              <tr><th>Consommation mixte</th><td>${esc(s.consumption || '—')}</td></tr>
              <tr><th>Recharge DC / AC</th><td>${s.dcChargeKw ? `${s.dcChargeKw} kW DC` : 'Pas de DC'} / ${s.acChargeKw ? `${s.acChargeKw} kW AC` : '—'}</td></tr>
              <tr><th>10 à 80 % (charge rapide)</th><td>${s.charge10to80min ? `${s.charge10to80min} min` : '—'}</td></tr>
              <tr><th>Gabarit (L × l)</th><td>${s.lengthMm ? `${(s.lengthMm / 1000).toFixed(2)} m` : '—'} × ${s.widthMm ? `${(s.widthMm / 1000).toFixed(2)} m` : '—'}</td></tr>
              <tr><th>Volume de coffre</th><td>${s.trunkL ? `${s.trunkL} L` : '—'} (${s.seats || 5} places)</td></tr>
              <tr><th>0 à 100 km/h</th><td>${s.zeroTo100s ? `${s.zeroTo100s} s` : '—'}</td></tr>
              <tr><th>Capacité de remorquage</th><td>${s.towingKg != null ? `${s.towingKg} kg` : '—'}</td></tr>
              <tr><th>Émissions CO₂</th><td>${s.co2gkm != null ? `${s.co2gkm} g/km` : '0 g/km'}</td></tr>
              <tr><th>Garantie véhicule</th><td>${esc(s.warranty || '2 ans')}</td></tr>
              <tr><th>Garantie batterie</th><td>${esc(s.batteryWarranty || '8 ans / 160 000 km')}</td></tr>
            </tbody>
          </table>
        </section>

        <section class="panel-card">
          <h3>🇫🇷 Aides d'État & Fiscalité 2026</h3>
          <table class="specs-table">
            <tbody>
              <tr><th>Éco-score ADEME</th><td>${v.aids?.ecoScoreEligible ? '✅ Éligible' : '❌ Non éligible'}</td></tr>
              <tr><th>Bonus / Prime CEE estimée</th><td style="color:var(--emerald);">${eur(v.aids?.bonusEur || 0)}</td></tr>
              <tr><th>Malus CO₂ / Poids</th><td>${eur(v.aids?.malusEur || 0)}</td></tr>
              <tr><th>Leasing social</th><td>${esc(str(v.aids?.socialLeasing || 'Non renseigné'))}</td></tr>
            </tbody>
          </table>
        </section>

        <section class="panel-card">
          <h3>⚖️ Points forts & Points faibles</h3>
          <div style="margin-bottom:0.85rem;">
            <strong style="color:var(--emerald);font-size:0.86rem;">Points forts (+)</strong>
            <ul style="margin-top:0.35rem;padding-left:1.1rem;font-size:0.85rem;">
              ${arr(v.pros)
                .map((p) => `<li>${esc(p)}</li>`)
                .join('')}
            </ul>
          </div>
          <div>
            <strong style="color:var(--rose);font-size:0.86rem;">Points faibles (−)</strong>
            <ul style="margin-top:0.35rem;padding-left:1.1rem;font-size:0.85rem;">
              ${arr(v.cons)
                .map((c) => `<li>${esc(c)}</li>`)
                .join('')}
            </ul>
          </div>
        </section>

        <section class="panel-card">
          <h3>⭐ Notes détaillées (sur ${scale})</h3>
          <table class="specs-table">
            <tbody>
              <tr><th>Rapport qualité / prix</th><td>${num(v.ratings?.value) ?? '—'} / ${scale}</td></tr>
              <tr><th>Autonomie & Efficience</th><td>${num(v.ratings?.range) ?? '—'} / ${scale}</td></tr>
              <tr><th>Confort & Habitabilité</th><td>${num(v.ratings?.comfort) ?? '—'} / ${scale}</td></tr>
              <tr><th>Équipements & Techno</th><td>${num(v.ratings?.equipment) ?? '—'} / ${scale}</td></tr>
            </tbody>
          </table>
        </section>
      </div>
    </div>
  `;

  document.getElementById('copy-nego-btn')?.addEventListener('click', async () => {
    const txt = document.getElementById('nego-email-text')?.value || '';
    try {
      await navigator.clipboard.writeText(txt);
      toast('Argumentaire de négociation copié dans le presse-papiers !');
    } catch {
      toast('Texte sélectionné — utilisez Ctrl+C / Cmd+C pour copier.');
    }
  });
}

/* ---------- Vue 3 : Comparateur Dédié par Motorisation & Catégorie (#/comparateur) ---------- */
const COMPARATOR_PRESETS = [
  {
    id: 'suv-hev',
    title: '🌿 Duel SUV Hybrides Non-Rechargeables (HEV)',
    subtitle: 'Sans contrainte de branchement · MG EHS Hybrid+ vs Renault Symbioz vs Jaecoo 7 SHS-H vs Dacia Duster Hybrid',
    energy: 'HEV',
    ids: ['mg-ehs-hybrid-plus', 'renault-symbioz-e-tech-145', 'jaecoo-7-shs-hev', 'dacia-duster-hybrid-140'],
  },
  {
    id: 'suv-phev',
    title: '🔌 Duel SUV Hybrides Rechargeables (PHEV)',
    subtitle: '75 à 100 km en électrique au quotidien + 1 000 km sur autoroute · MG EHS PHEV vs BYD Seal U DM-i vs Jaecoo 7 PHEV vs Kia Sportage',
    energy: 'PHEV',
    ids: ['mg-ehs-phev', 'byd-seal-u-dm-i-boost', 'jaecoo-7-shs-phev', 'kia-sportage-hybrid-215'],
  },
  {
    id: 'suv-bev-fam',
    title: '⚡ Duel Grands SUV 100% Électriques Familiaux (BEV)',
    subtitle: 'Autonomie 500 à 625 km WLTP · Renault Scénic E-Tech vs Peugeot e-3008 vs Škoda Elroq vs Tesla Model Y',
    energy: 'BEV',
    ids: ['renault-scenic-e-tech-87', 'peugeot-e-3008-210', 'skoda-elroq-85', 'tesla-model-y-propulsion'],
  },
  {
    id: 'suv-bev-comp',
    title: '⚡ Duel SUV Compacts & Citadins Électriques (BEV)',
    subtitle: 'Loyers 219 à 397 €/mois sans apport · Kia EV3 vs Volvo EX30 vs Renault 4 E-Tech vs Peugeot e-2008',
    energy: 'BEV',
    ids: ['kia-ev3-81kwh', 'volvo-ex30-single-motor', 'renault-4-e-tech-150', 'peugeot-e-2008-156'],
  },
  {
    id: 'citadine-hev',
    title: '🌿 Duel Citadines & Urbains Full Hybrides (HEV)',
    subtitle: 'Sobriété record (4,2 à 4,6 L/100) · Renault Clio E-Tech vs MG3 Hybrid+ 195 ch vs Toyota Yaris Cross vs Captur E-Tech',
    energy: 'HEV',
    ids: ['renault-clio-e-tech-145', 'mg3-hybrid-plus', 'toyota-yaris-cross-116', 'renault-captur-e-tech-145'],
  },
  {
    id: 'compacte-bev',
    title: '⚡ Duel Citadines & Compactes 100% Électriques (BEV)',
    subtitle: 'Format quotidien agile · Renault 5 E-Tech vs Renault Mégane E-Tech vs MG4 EV vs Peugeot e-208',
    energy: 'BEV',
    ids: ['renault-5-e-tech-150', 'renault-megane-e-tech-ev60', 'mg4-electric-64', 'peugeot-e-208-156'],
  },
  {
    id: 'chinois-top',
    title: '🐉 Duel SUV Marques Chinoises (0 € apport · ≤ 450 €/mois)',
    subtitle: 'Suréquipés et garantis 6 à 7 ans · MG EHS PHEV vs Jaecoo 7 PHEV vs BYD Seal U DM-i vs MG ZS Hybrid+',
    energy: 'ALL',
    ids: ['mg-ehs-phev', 'jaecoo-7-shs-phev', 'byd-seal-u-dm-i-boost', 'mg-zs-hybrid-plus'],
  },
];

let comparatorEnergyFilter = 'ALL'; // ALL | HEV | PHEV | BEV

function renderComparator(main) {
  const vehicles = arr(state.data?.vehicles);
  const selected = state.compareIds.map((id) => vehicles.find((v) => v.id === id)).filter(Boolean);

  const activePreset = COMPARATOR_PRESETS.find(
    (p) => p.ids.length === state.compareIds.length && p.ids.every((id) => state.compareIds.includes(id))
  );

  const filteredSelectorVehicles = vehicles.filter((v) => {
    if (state.compareIds.includes(v.id)) return false;
    if (comparatorEnergyFilter !== 'ALL' && v.energy !== comparatorEnergyFilter) return false;
    return true;
  });

  const rows = [
    {
      label: 'Score global (/100)',
      val: (v) => state.scores.get(v.id)?.score ?? null,
      fmt: (x) => (x != null ? `${x} / 100` : '—'),
      lowBetter: false,
    },
    {
      label: 'Énergie & Catégorie',
      val: () => null,
      render: (v) => `${energyTag(v.energy)} <span class="tag">${esc(v.segment)}</span>`,
    },
    {
      label: 'Offre ponctuelle & Date de fin',
      val: (v) => formatDeadlineInfo(v.validUntil || v.offers?.[0]?.validUntil).daysLeft,
      render: (v) => {
        const dl = formatDeadlineInfo(v.validUntil || v.offers?.[0]?.validUntil);
        return `<div><strong style="color:var(--amber);font-size:0.8rem;">${esc(v.promoName || 'Offre constructeur')}</strong><br/><span class="tag ${dl.urgent ? 'tag-cn' : 'tag-bonus'}" style="margin-top:0.25rem;">${esc(dl.label)}</span></div>`;
      },
      lowBetter: null,
    },
    {
      label: 'Prix catalogue officiel',
      val: (v) => num(v.priceFromEur),
      fmt: eur,
      lowBetter: true,
    },
    {
      label: 'Remise officielle + Bonus/CEE',
      val: (v) => {
        const m = state.scores.get(v.id)?.metrics || metrics(v);
        return (m.maxDiscount || 0) + (m.bonus || 0);
      },
      render: (v) => {
        const o0 = arr(v.offers)[0] || {};
        const d = num(o0.discountEur) || 0;
        const b = num(v.aids?.bonusEur) || 0;
        const tot = d + b;
        return tot > 0
          ? `<strong>−${eur(tot)}</strong><div class="muted" style="font-size:0.74rem;">Remise −${eur(d)}${b > 0 ? ` · Bonus −${eur(b)}` : ''}</div>`
          : '0 €';
      },
      lowBetter: false,
    },
    {
      label: 'Prix net (remise & aides déduites)',
      val: (v) => (state.scores.get(v.id)?.metrics || metrics(v)).bestNet,
      fmt: eur,
      lowBetter: true,
    },
    {
      label: 'Votre loyer (0 € apport · 15 000 km/an)',
      val: (v) => (state.scores.get(v.id)?.metrics || metrics(v)).bestMonthly,
      fmt: (x) => (x != null ? `${eur(x)}/mois` : '—'),
      lowBetter: true,
    },
    {
      label: 'Loyer affiché sur le site officiel',
      val: (v) => num(v.offers?.[0]?.officialMonthlyEur),
      render: (v) => {
        const o0 = arr(v.offers)[0] || {};
        return o0.officialMonthlyEur
          ? `<strong>${eur(o0.officialMonthlyEur)}/mois</strong><div class="muted" style="font-size:0.73rem;">${esc(o0.officialLeaseTerms || '')}</div>`
          : '—';
      },
      lowBetter: true,
    },
    {
      label: 'Explication du prix constructeur',
      val: () => null,
      render: (v) => `<div style="font-size:0.76rem;line-height:1.38;color:var(--text-secondary);">${esc(v.priceExplanation || '—')}</div>`,
    },
    {
      label: 'Autonomie WLTP',
      val: (v) => (state.scores.get(v.id)?.metrics || metrics(v)).range,
      fmt: (x, v) => (x != null ? `${x} km${v.energy === 'PHEV' && v.specs?.electricRangeKm ? ` (dont ${v.specs.electricRangeKm} km EV)` : ''}` : '—'),
      lowBetter: false,
    },
    {
      label: 'Consommation mixte',
      val: () => null,
      render: (v) => `<strong>${esc(v.specs?.consumption || '—')}</strong>`,
    },
    {
      label: 'Batterie & Charge 10-80%',
      val: (v) => num(v.specs?.charge10to80min),
      fmt: (x, v) => `${v.specs?.batteryKwh ? `${v.specs.batteryKwh} kWh` : '—'} · ${x ? `${x} min (${v.specs?.dcChargeKw || '?'} kW)` : 'Sans charge DC'}`,
      lowBetter: true,
    },
    {
      label: 'Volume de coffre',
      val: (v) => num(v.specs?.trunkL),
      fmt: (x) => (x != null ? `${x} L` : '—'),
      lowBetter: false,
    },
    {
      label: 'Longueur × Largeur',
      val: (v) => num(v.specs?.lengthMm),
      fmt: (x, v) => (x != null ? `${(x / 1000).toFixed(2)} m × ${v.specs?.widthMm ? (v.specs.widthMm / 1000).toFixed(2) : '—'} m` : '—'),
      lowBetter: null,
    },
    {
      label: 'Puissance & Garantie',
      val: (v) => num(v.specs?.powerHp),
      render: (v) => `<strong>${v.specs?.powerHp || '—'} ch</strong> · Garantie ${esc(v.specs?.warranty || '2 ans')}`,
      lowBetter: false,
    },
    {
      label: 'Marge négo. concession (%)',
      val: (v) => {
        const m = arr(v.negotiationMarginPct);
        return m.length ? m[m.length - 1] : null;
      },
      fmt: (_, v) => {
        const m = arr(v.negotiationMarginPct);
        return m.length >= 2 ? `−${m[0]} à −${m[1]} %` : '−4 à −7 %';
      },
      lowBetter: false,
    },
    {
      label: 'Équipements de série clés',
      val: (v) => arr(v.standardEquipment).length,
      render: (v) => `<ul style="padding-left:1rem;font-size:0.78rem;">${arr(v.standardEquipment).slice(0, 5).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`,
      lowBetter: false,
    },
  ];

  main.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">⚖️ Comparateur Dédié par Motorisation & Catégorie (jusqu'à 4 modèles)</h1>
        <p class="section-subtitle">
          Comparez directement des modèles <strong>de même technologie</strong> (Hybrides non-rechargeables HEV entre eux, Hybrides rechargeables PHEV entre eux, ou 100 % Électriques BEV entre eux).
        </p>
      </div>
    </div>

    <!-- 1. Duels pré-configurés par motorisation en 1 clic -->
    <section class="panel-card" style="margin-bottom:1.25rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.75rem;">
        <h3 style="margin:0;">🎯 1. Choisissez un comparatif dédié en 1 clic (par motorisation & usage) :</h3>
        <span class="muted" style="font-size:0.8rem;">Cliquez sur une carte pour charger automatiquement les 4 véhicules face à face</span>
      </div>
      <div class="cmp-presets-grid" id="cmp-presets-grid">
        ${COMPARATOR_PRESETS.map(
          (p) => `
          <button type="button" class="cmp-preset-card ${activePreset?.id === p.id ? 'active' : ''}" data-preset="${esc(p.id)}">
            <div class="cmp-preset-title">
              <span>${esc(p.title)}</span>
              ${activePreset?.id === p.id ? `<span class="tag tag-bonus">Actif</span>` : ''}
            </div>
            <div class="cmp-preset-sub">${esc(p.subtitle)}</div>
          </button>
        `
        ).join('')}
      </div>

      <!-- 2. Filtre par motorisation pour composer son propre comparatif homogène -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.75rem;padding-top:0.85rem;border-top:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:0.45rem;flex-wrap:wrap;">
          <span style="font-size:0.8rem;font-weight:700;color:var(--muted);">Filtrer l'ajout par énergie :</span>
          ${[
            ['ALL', 'Toutes énergies'],
            ['HEV', '🌿 Hybrides non-rechargeables (HEV)'],
            ['PHEV', '🔌 Hybrides rechargeables (PHEV)'],
            ['BEV', '⚡ 100 % Électriques (BEV)'],
          ]
            .map(
              ([k, lbl]) =>
                `<button type="button" class="pill-btn ${comparatorEnergyFilter === k ? 'active' : ''}" data-cmp-energy="${k}">${lbl}</button>`
            )
            .join('')}
        </div>

        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
          <select id="cmp-add-select" class="select-input">
            <option value="">+ Ajouter un modèle ${comparatorEnergyFilter !== 'ALL' ? comparatorEnergyFilter : ''} au tableau (${filteredSelectorVehicles.length} dispo)…</option>
            ${filteredSelectorVehicles
              .map(
                (v) =>
                  `<option value="${esc(v.id)}">[${esc(v.energy)}] ${esc(fullModelName(v))} — ${eur((state.scores.get(v.id)?.metrics || metrics(v)).bestNet)} (${
                    (state.scores.get(v.id)?.metrics || metrics(v)).bestMonthly || '?'
                  } €/mois)</option>`
              )
              .join('')}
          </select>
        </div>
      </div>
    </section>

    <div class="compare-table-wrap">
      <table class="compare-table">
        <thead>
          <tr>
            <th>Critères comparés</th>
            ${selected
              .map((v) => {
                const imgUrl = safeUrl(v.imageUrl, '');
                const cutoutCls = isCutoutImage(imgUrl) ? 'is-cutout' : '';
                const o0 = arr(v.offers)[0] || {};
                const offerUrl = safeUrl(o0.sourceUrl, safeUrl(v.officialUrl));
                return `
              <th>
                ${
                  imgUrl
                    ? `<div class="cmp-photo-wrap">
                        <img src="${esc(imgUrl)}" alt="${esc(fullModelName(v))}" class="cmp-photo ${cutoutCls}" loading="lazy" />
                      </div>`
                    : ''
                }
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;">
                  <div>
                    <div class="muted" style="font-size:0.74rem;text-transform:uppercase;">${esc(v.brand)} · ${esc(v.energy)}</div>
                    <a href="#/vehicule/${encodeURIComponent(v.id)}" style="font-family:'Space Grotesk',sans-serif;font-size:1rem;font-weight:700;color:var(--text);">
                      ${esc(fullModelName(v))}
                    </a>
                  </div>
                  <button type="button" class="btn-icon js-remove-cmp" data-id="${esc(v.id)}" title="Retirer" style="width:28px;height:28px;font-size:0.75rem;">✕</button>
                </div>
                <div style="margin-top:0.5rem;display:flex;gap:0.4rem;flex-wrap:wrap;">
                  <a href="${esc(offerUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">Offre ${esc(v.brand)} ↗</a>
                  <a href="#/vehicule/${encodeURIComponent(v.id)}" class="btn btn-outline btn-sm">Détail Prix</a>
                </div>
              </th>
            `;
              })
              .join('')}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row) => {
              const nums = selected.map((v) => row.val(v));
              const valid = nums.filter((n) => n != null);
              const min = valid.length > 1 ? Math.min(...valid) : null;
              const max = valid.length > 1 ? Math.max(...valid) : null;

              return `
                <tr>
                  <th>${esc(row.label)}</th>
                  ${selected
                    .map((v, i) => {
                      const val = nums[i];
                      let cls = '';
                      if (row.lowBetter != null && val != null && min != null && max != null && min !== max) {
                        const best = row.lowBetter ? min : max;
                        const worst = row.lowBetter ? max : min;
                        if (val === best) cls = 'cell-best';
                        else if (val === worst) cls = 'cell-worst';
                      }
                      const content = row.render ? row.render(v) : esc(row.fmt(val, v));
                      return `<td class="${cls}">${content}</td>`;
                    })
                    .join('')}
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('cmp-presets-grid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset]');
    if (!btn) return;
    const pid = btn.getAttribute('data-preset');
    const preset = COMPARATOR_PRESETS.find((x) => x.id === pid);
    if (!preset) return;
    state.compareIds = [...preset.ids];
    comparatorEnergyFilter = preset.energy || 'ALL';
    saveCompare();
    renderComparator(main);
    toast(`Comparatif chargé : ${preset.title}`);
  });

  main.querySelectorAll('[data-cmp-energy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      comparatorEnergyFilter = btn.getAttribute('data-cmp-energy') || 'ALL';
      renderComparator(main);
    });
  });

  document.getElementById('cmp-add-select')?.addEventListener('change', (e) => {
    const id = e.target.value;
    if (!id) return;
    if (state.compareIds.length >= 4) {
      state.compareIds.shift();
    }
    if (!state.compareIds.includes(id)) {
      state.compareIds.push(id);
      saveCompare();
      renderComparator(main);
    }
  });

  main.querySelectorAll('.js-remove-cmp').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      state.compareIds = state.compareIds.filter((x) => x !== id);
      saveCompare();
      renderComparator(main);
    });
  });
}

/* ---------- Vue 4 : Simulateur TCO 4 ans & Compacte + Location Été vs SUV (#/simulateur) ---------- */
function estimateEnergyCost4Y(v, tco) {
  const totalKm = tco.kmPerYear * tco.years;
  const elecRate = (tco.homeChargeShare / 100) * tco.elecHomeEur + (1 - tco.homeChargeShare / 100) * tco.elecPublicEur;
  const consStr = str(v?.specs?.consumption);

  if (v?.energy === 'BEV') {
    const kwhMatch = consStr.match(/(\d+[.,]?\d*)\s*kwh/i);
    const kwh100 = kwhMatch ? parseFloat(kwhMatch[1].replace(',', '.')) : v.isSUV ? 17.2 : 15.0;
    return Math.round((totalKm / 100) * kwh100 * elecRate);
  }
  if (v?.energy === 'PHEV') {
    // 60 % des km quotidiens en électrique + 40 % en hybride thermique
    const kwh100 = 17.5;
    const l100 = 6.0;
    const elecPart = (totalKm * 0.6 / 100) * kwh100 * elecRate;
    const fuelPart = (totalKm * 0.4 / 100) * l100 * tco.petrolEur;
    return Math.round(elecPart + fuelPart);
  }
  // HEV
  const lMatch = consStr.match(/(\d+[.,]?\d*)\s*l/i);
  const l100 = lMatch ? parseFloat(lMatch[1].replace(',', '.')) : v?.isSUV ? 5.6 : 4.6;
  return Math.round((totalKm / 100) * l100 * tco.petrolEur);
}

function computeVehicleTco(v, tco, includeSummerRental = false) {
  if (!v) return null;
  const m = state.scores.get(v.id)?.metrics || metrics(v);
  const months = tco.years * 12;
  const netBuy = m.bestNet ?? m.price ?? 32000;

  let capitalOrLeaseCost = 0;
  let residualValue = 0;
  if (tco.mode === 'lease' && m.bestMonthlyEffective) {
    capitalOrLeaseCost = Math.round(m.bestMonthlyEffective * months);
  } else {
    // Achat comptant/crédit avec décote à 4 ans (résiduel ~47 % BEV, ~52 % HEV/PHEV)
    const retention = v.energy === 'BEV' ? 0.47 : 0.52;
    residualValue = Math.round(netBuy * retention);
    capitalOrLeaseCost = netBuy - residualValue;
  }

  const energyCost = estimateEnergyCost4Y(v, tco);
  const maintenancePerYear = v.energy === 'BEV' ? 240 : 440;
  const insurancePerYear = v.isSUV ? 860 : 680;
  const maintInsCost = (maintenancePerYear + insurancePerYear) * tco.years;
  const summerCost = includeSummerRental ? tco.summerWeeks * tco.summerWeekCostEur * tco.years : 0;

  const total4Y = capitalOrLeaseCost + energyCost + maintInsCost + summerCost;
  return {
    v,
    netBuy,
    residualValue,
    capitalOrLeaseCost,
    energyCost,
    maintInsCost,
    summerCost,
    total4Y,
    monthlyReal: Math.round(total4Y / months),
  };
}

function renderSimulator(main) {
  const vehicles = arr(state.data?.vehicles);
  const t = state.tco;

  main.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">🧮 Simulateur TCO 4 ans & Scénario « Compacte + Location Été vs SUV »</h1>
        <p class="section-subtitle">
          Faut-il acheter/louer un grand SUV toute l'année, ou choisir un gabarit type <strong>Clio / Mégane / R5</strong> au quotidien et louer un grand véhicule familial l'été ?
        </p>
      </div>
    </div>

    <div class="tco-grid">
      <form id="tco-form" class="panel-card" style="margin-bottom:0;">
        <h3>⚙️ Vos paramètres d'usage</h3>

        <div class="filter-field" style="margin-bottom:0.8rem;">
          <label>Mode de détention (sur 4 ans / 48 mois)</label>
          <select name="mode" class="select-input">
            <option value="cash" ${t.mode === 'cash' ? 'selected' : ''}>Achat (Prix net − valeur de revente à 4 ans)</option>
            <option value="lease" ${t.mode === 'lease' ? 'selected' : ''}>Location LLD / LOA (Loyers + apport lissé sur 48 mois)</option>
          </select>
        </div>

        <div class="filter-field" style="margin-bottom:0.8rem;">
          <label>Kilométrage annuel (km/an)</label>
          <input type="number" name="kmPerYear" step="1000" class="number-input" value="${t.kmPerYear}" />
        </div>

        <div class="filter-field" style="margin-bottom:0.8rem;">
          <label>Part de recharge à domicile (%) — Tarif ${t.elecHomeEur} €/kWh vs ${t.elecPublicEur} €/kWh borne</label>
          <input type="number" name="homeChargeShare" min="0" max="100" step="5" class="number-input" value="${t.homeChargeShare}" />
        </div>

        <hr style="border:none;border-top:1px solid var(--border);margin:1rem 0;" />
        <h3>🏖️ Option « Location Grand Véhicule l'Été »</h3>
        <p class="muted" style="font-size:0.78rem;margin-bottom:0.75rem;">
          Ajoutée uniquement au Scénario 1 (Citadine/Compacte) pour partir en vacances avec un grand coffre.
        </p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.65rem;margin-bottom:1rem;">
          <div class="filter-field">
            <label>Semaines louées / été</label>
            <input type="number" name="summerWeeks" min="0" max="8" class="number-input" value="${t.summerWeeks}" />
          </div>
          <div class="filter-field">
            <label>Coût location (€/semaine)</label>
            <input type="number" name="summerWeekCostEur" step="50" class="number-input" value="${t.summerWeekCostEur}" />
          </div>
        </div>

        <hr style="border:none;border-top:1px solid var(--border);margin:1rem 0;" />
        <h3>🚗 Modèles comparés</h3>

        <div class="filter-field" style="margin-bottom:0.75rem;">
          <label>Scénario 1 : Gabarit Citadine / Compacte (+ location été)</label>
          <select name="compactId" class="select-input">
            ${vehicles
              .map((v) => `<option value="${esc(v.id)}" ${v.id === t.compactId ? 'selected' : ''}>${esc(v.brand)} ${esc(v.model)} (${esc(v.segment)})</option>`)
              .join('')}
          </select>
        </div>

        <div class="filter-field" style="margin-bottom:0.75rem;">
          <label>Scénario 2 : SUV Familial / Compact toute l'année</label>
          <select name="suvId" class="select-input">
            ${vehicles
              .map((v) => `<option value="${esc(v.id)}" ${v.id === t.suvId ? 'selected' : ''}>${esc(v.brand)} ${esc(v.model)} (${esc(v.segment)})</option>`)
              .join('')}
          </select>
        </div>

        <div class="filter-field">
          <label>Scénario 3 : Alternative au choix (sans location été)</label>
          <select name="thirdId" class="select-input">
            ${vehicles
              .map((v) => `<option value="${esc(v.id)}" ${v.id === t.thirdId ? 'selected' : ''}>${esc(v.brand)} ${esc(v.model)} (${esc(v.segment)})</option>`)
              .join('')}
          </select>
        </div>
      </form>

      <div id="tco-results-area"></div>
    </div>
  `;

  const renderResults = () => {
    const vCompact = vehicles.find((v) => v.id === state.tco.compactId) || vehicles[0];
    const vSuv = vehicles.find((v) => v.id === state.tco.suvId) || vehicles[1] || vehicles[0];
    const vThird = vehicles.find((v) => v.id === state.tco.thirdId) || vehicles[2] || vehicles[0];

    const r1 = computeVehicleTco(vCompact, state.tco, true);
    const r2 = computeVehicleTco(vSuv, state.tco, false);
    const r3 = computeVehicleTco(vThird, state.tco, false);

    const diffCompactVsSuv = r2.total4Y - r1.total4Y;
    const minTotal = Math.min(r1.total4Y, r2.total4Y, r3.total4Y);

    const box = document.getElementById('tco-results-area');
    if (!box) return;

    box.innerHTML = `
      <div class="panel-card" style="border-left:4px solid ${diffCompactVsSuv >= 0 ? 'var(--emerald)' : 'var(--accent)'};">
        <h3>💡 Verdict « Compacte au quotidien + Location l'été » vs « SUV toute l'année »</h3>
        <p style="font-size:0.95rem;">
          ${
            diffCompactVsSuv >= 0
              ? `En choisissant <strong>${esc(vCompact.brand)} ${esc(vCompact.model)}</strong> au quotidien et en louant un grand véhicule pendant <strong>${state.tco.summerWeeks} semaines chaque été</strong> (${eur(r1.summerCost)} sur 4 ans), vous <strong>économisez <span style="color:var(--emerald);font-size:1.15rem;">${eur(diffCompactVsSuv)}</span> sur 4 ans</strong> (soit <strong>${eur(Math.round(diffCompactVsSuv / 48))}/mois</strong>) par rapport à <strong>${esc(vSuv.brand)} ${esc(vSuv.model)}</strong> !`
              : `Avec ces paramètres et les fortes remises sur <strong>${esc(vSuv.brand)} ${esc(vSuv.model)}</strong>, le SUV revient <strong>${eur(Math.abs(diffCompactVsSuv))} moins cher sur 4 ans</strong> que la formule Compacte + ${state.tco.summerWeeks} sem./an de location estivale.`
          }
        </p>
      </div>

      <div class="tco-cards">
        ${[
          { title: 'Scénario 1 · Compacte + Location Été', r: r1, withSummer: true },
          { title: 'Scénario 2 · SUV toute l\'année', r: r2, withSummer: false },
          { title: 'Scénario 3 · Alternative directe', r: r3, withSummer: false },
        ]
          .map(
            ({ title, r, withSummer }) => `
          <div class="tco-result-card ${r.total4Y === minTotal ? 'winner' : ''}">
            <div class="badge-row" style="margin-bottom:0.4rem;">
              <span class="tag ${r.total4Y === minTotal ? 'tag-bonus' : ''}">${esc(title)}</span>
              ${r.total4Y === minTotal ? `<span class="tag tag-bonus">🏆 Le plus économique</span>` : ''}
            </div>
            <h4 style="font-family:'Space Grotesk',sans-serif;font-size:1.15rem;">
              <a href="#/vehicule/${encodeURIComponent(r.v.id)}" style="color:var(--text);">${esc(r.v.brand)} ${esc(r.v.model)}</a>
            </h4>
            <div style="margin:0.85rem 0;padding:0.75rem;background:var(--bg-elevated);border-radius:8px;">
              <div class="muted" style="font-size:0.75rem;">Coût de revient total sur 4 ans</div>
              <div style="font-family:'Space Grotesk',sans-serif;font-size:1.55rem;font-weight:800;color:var(--emerald);">${eur(r.total4Y)}</div>
              <div class="muted" style="font-size:0.8rem;">Soit <strong>${eur(r.monthlyReal)} / mois</strong> tout compris</div>
            </div>
            <table class="specs-table">
              <tbody>
                <tr><th>Prix net achat</th><td>${eur(r.netBuy)}</td></tr>
                <tr><th>${state.tco.mode === 'lease' ? 'Loyers 48 mois' : 'Décote 4 ans (achat − revente)'}</th><td>${eur(r.capitalOrLeaseCost)}</td></tr>
                <tr><th>Énergie (${(state.tco.kmPerYear * 4).toLocaleString('fr-FR')} km)</th><td>${eur(r.energyCost)}</td></tr>
                <tr><th>Assurance & Entretien 4 ans</th><td>${eur(r.maintInsCost)}</td></tr>
                <tr><th>Location grand véhicule l'été</th><td>${withSummer ? eur(r.summerCost) : '0 € (pas nécessaire)'}</td></tr>
              </tbody>
            </table>
            <div style="margin-top:0.85rem;display:flex;gap:0.5rem;">
              <a href="${esc(safeUrl(r.v.officialUrl))}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm" style="flex:1;">Site ${esc(r.v.brand)} ↗</a>
              <a href="#/vehicule/${encodeURIComponent(r.v.id)}" class="btn btn-outline btn-sm">Fiche</a>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  };

  renderResults();

  document.getElementById('tco-form')?.addEventListener('input', (e) => {
    const fd = new FormData(e.currentTarget);
    state.tco.mode = fd.get('mode') || 'cash';
    state.tco.kmPerYear = Number(fd.get('kmPerYear')) || 14000;
    state.tco.homeChargeShare = Number(fd.get('homeChargeShare')) || 80;
    state.tco.summerWeeks = Number(fd.get('summerWeeks')) || 0;
    state.tco.summerWeekCostEur = Number(fd.get('summerWeekCostEur')) || 600;
    state.tco.compactId = fd.get('compactId') || state.tco.compactId;
    state.tco.suvId = fd.get('suvId') || state.tco.suvId;
    state.tco.thirdId = fd.get('thirdId') || state.tco.thirdId;
    try {
      localStorage.setItem('av_tco', JSON.stringify(state.tco));
    } catch {}
    renderResults();
  });
}

/* ---------- Vue 5 : Marché & Concessions (#/marche) ---------- */
function renderMarket(main) {
  const insights = arr(state.data?.marketInsights);
  const inc = state.data?.incentives || {};
  const chineseVehicles = arr(state.data?.vehicles).filter((v) => v.chineseBrand);

  main.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">📊 Analyse du Marché Français, Marques Chinoises & Concessions</h1>
        <p class="section-subtitle">Décryptage des droits de douane UE, de la bascule vers les hybrides (HEV/PHEV), des aides CEE 2026 et des marges en concession.</p>
      </div>
    </div>

    <div class="detail-grid">
      <div>
        <section class="panel-card">
          <h3>🔍 Tendances Macro & Comportement des Concessions</h3>
          <div class="offers-stack">
            ${insights
              .map(
                (ins) => `
              <div class="offer-item" style="align-items:flex-start;">
                <div>
                  <div class="badge-row" style="margin-bottom:0.35rem;">
                    ${arr(ins.brands).map((b) => `<span class="tag tag-bev">${esc(b)}</span>`).join('')}
                  </div>
                  <strong style="font-size:1.05rem;">${esc(ins.title)}</strong>
                  <p class="muted" style="font-size:0.86rem;margin-top:0.35rem;">${esc(ins.content)}</p>
                  ${ins.impact ? `<div class="tag tag-bonus" style="margin-top:0.5rem;">Impact acheteur : ${esc(ins.impact)}</div>` : ''}
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </section>

        <section class="panel-card">
          <h3>🐉 Focus : Offensive des constructeurs chinois (BYD, MG, Leapmotor, Xpeng)</h3>
          <p class="muted" style="font-size:0.88rem;margin-bottom:1rem;">
            Alors que l'Union Européenne applique des droits de douane additionnels sur les voitures 100 % électriques (BEV) produites en Chine (en plus des 10 % de base), les constructeurs chinois activent trois leviers majeurs en France :
          </p>
          <ul class="equip-list" style="margin-bottom:1rem;">
            <li><strong>1. Hybrides & PHEV non surtaxés :</strong> Les hybrides (MG ZS Hybrid+, MG3 Hybrid+) et hybrides rechargeables (BYD Seal U DM-i) échappent aux surtaxes BEV et offrent un rapport équipement/prix imbattable.</li>
            <li><strong>2. Primes constructeurs massives sur BEV :</strong> Pour compenser la perte du bonus écologique français, MG, BYD et Xpeng absorbent la taxe via des remises immédiates de 4 000 € à 7 000 € sur stock.</li>
            <li><strong>3. Assemblage européen & co-entreprises :</strong> Leapmotor (via Stellantis) et BYD (usines européennes) accélèrent l'implantation locale.</li>
          </ul>
          <div class="offers-stack">
            ${chineseVehicles
              .map((v) => {
                const m = state.scores.get(v.id)?.metrics || metrics(v);
                return `
                  <div class="offer-item">
                    <div>
                      <strong><a href="#/vehicule/${encodeURIComponent(v.id)}">${esc(v.brand)} ${esc(v.model)}</a></strong>
                      <span class="tag tag-cn" style="margin-left:0.4rem;">${esc(v.energy)}</span>
                      <div class="muted" style="font-size:0.8rem;margin-top:0.2rem;">${esc(v.dealerBehavior || '')}</div>
                    </div>
                    <div style="text-align:right;">
                      <strong style="color:var(--emerald);">${eur(m.bestNet)}</strong>
                      <div style="margin-top:0.3rem;">
                        <a href="${esc(safeUrl(v.officialUrl))}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm">Site ${esc(v.brand)} ↗</a>
                      </div>
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>
        </section>
      </div>

      <div>
        <section class="panel-card">
          <h3>🇫🇷 Aides & Fiscalité France 2026</h3>
          <p class="muted" style="font-size:0.85rem;margin-bottom:0.9rem;">${esc(inc.summary || '')}</p>
          <div class="offers-stack">
            ${arr(inc.items)
              .map(
                (it) => `
              <div class="offer-item">
                <div>
                  <strong>${esc(it.name)}</strong>
                  <div class="muted" style="font-size:0.8rem;margin-top:0.2rem;">${esc(it.conditions)}</div>
                  ${it.url ? `<a href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer" style="font-size:0.78rem;">Source officielle ↗</a>` : ''}
                </div>
                <span class="tag tag-bonus">${it.amountEur ? eur(it.amountEur) : 'Exonération'}</span>
              </div>
            `
              )
              .join('')}
          </div>
        </section>

        <section class="panel-card negotiation-box">
          <h3>🎯 Guide tactique de négociation en concession</h3>
          <ol style="padding-left:1.1rem;font-size:0.86rem;display:flex;flex-direction:column;gap:0.55rem;">
            <li><strong>Ciblez les véhicules en stock physique :</strong> Une concession préfère céder 6 à 10 % sur un véhicule déjà sur parc plutôt que sur une commande usine à 4 mois.</li>
            <li><strong>Fin de mois & fin de trimestre :</strong> Les vendeurs et chefs des ventes débloquent leurs primes constructeurs sur les immatriculations avant le 28 du mois.</li>
            <li><strong>Négociez le coût global et les frais annexes :</strong> Faites supprimer les « packs mise à la route / gravage » facultatifs (souvent facturés 450 € à 690 €) et demandez la Wallbox ou le câble T2 offert.</li>
            <li><strong>Comparez LOA/LLD avec achat :</strong> Parfois la remise est plus forte en LLD grâce à une valeur résiduelle bonifiée par la captive financière du constructeur.</li>
          </ol>
        </section>
      </div>
    </div>
  `;
}

/* ---------- Vue 6 : Alertes & Agent Quotidien (#/alertes) ---------- */
function renderAlertsPage(main) {
  const actionsUrl = `https://github.com/${encodeURIComponent(state.config.owner)}/${encodeURIComponent(state.config.repo)}/actions/workflows/daily.yml`;
  const ntfyUrl = `https://ntfy.sh/${encodeURIComponent(state.config.ntfyTopic)}`;

  main.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">🔔 Alertes Automatiques (6h30 Email · 7h00 Notification) & Vérification à la demande</h1>
        <p class="section-subtitle">Votre agent autonome scrute chaque matin les offres constructeurs et met à jour le comparateur.</p>
      </div>
    </div>

    <div class="podium-grid">
      <!-- 1. Alerte Email 6h30 -->
      <section class="panel-card" style="margin-bottom:0;">
        <h3>📧 1. Rapport Email Quotidien à 06h30</h3>
        <p class="muted" style="font-size:0.86rem;margin-bottom:0.85rem;">
          Chaque matin à <strong>06h30 (heure de Paris)</strong>, le workflow GitHub Actions interroge Gemini + Google Search pour actualiser les offres, puis envoie le rapport complet HTML à :
        </p>
        <div class="spec-pill" style="padding:0.65rem;margin-bottom:0.85rem;text-align:left;">
          <span class="spec-pill-lbl">Destinataire configuré</span>
          <span class="spec-pill-val mono">${esc(state.config.alertEmail)}</span>
        </div>
        <p class="muted" style="font-size:0.8rem;">
          Contient : Top 10 des offres du jour, focus SUV vs Citadines/Compactes, baisses de prix détectées, et liens directs vers les sites officiels des constructeurs.
        </p>
      </section>

      <!-- 2. Notification Push 7h00 -->
      <section class="panel-card" style="margin-bottom:0;">
        <h3>📲 2. Notification Matinale à 07h00</h3>
        <p class="muted" style="font-size:0.86rem;margin-bottom:0.85rem;">
          À <strong>07h00 (heure de Paris)</strong>, une notification push résumant le Top 3 du matin est envoyée sur votre canal <strong>ntfy.sh</strong> (gratuit, sans inscription sur iOS/Android/Desktop) :
        </p>
        <div class="spec-pill" style="padding:0.65rem;margin-bottom:0.85rem;text-align:left;">
          <span class="spec-pill-lbl">Canal ntfy.sh public dédié</span>
          <span class="spec-pill-val mono">${esc(state.config.ntfyTopic)}</span>
        </div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <a href="${esc(ntfyUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">
            🔔 S'abonner en 1 clic sur ntfy.sh ↗
          </a>
          <button type="button" id="btn-test-ntfy" class="btn btn-outline btn-sm">
            Envoyer une notification test maintenant
          </button>
          <button type="button" id="btn-web-notif" class="btn btn-outline btn-sm">
            Activer notif navigateur
          </button>
        </div>
      </section>

      <!-- 3. Vérification sur demande -->
      <section class="panel-card" style="margin-bottom:0;">
        <h3>⚡ 3. Vérification sur demande</h3>
        <p class="muted" style="font-size:0.86rem;margin-bottom:0.85rem;">
          Vous souhaitez vérifier les tarifs constructeurs immédiatement sans attendre 06h30 ? Déclenchez le workflow GitHub Actions ou lancez un scan live Gemini ci-dessous :
        </p>
        <div style="display:flex;flex-direction:column;gap:0.6rem;">
          <a href="${esc(actionsUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-emerald">
            🚀 Lancer une vérification maintenant (GitHub Actions) ↗
          </a>
          <button type="button" id="btn-reload-json" class="btn btn-outline btn-sm">
            ↻ Recharger les données JSON du serveur
          </button>
        </div>
      </section>
    </div>

    <!-- Scan Live Gemini dans le navigateur (optionnel) -->
    <section class="panel-card" style="margin-top:1.5rem;">
      <h3>🤖 Scan Live Gemini + Google Search depuis le navigateur (Test instantané)</h3>
      <p class="muted" style="font-size:0.86rem;margin-bottom:0.85rem;">
        Entrez optionnellement une clé API Gemini (stockée uniquement en mémoire locale si souhaité) pour interroger en direct <code>gemini-2.5-flash</code> avec recherche Google sur un modèle du catalogue :
      </p>
      <div style="display:flex;gap:0.65rem;flex-wrap:wrap;align-items:center;">
        <input id="live-gemini-key" type="password" class="search-input" style="max-width:320px;" placeholder="Clé GEMINI_API_KEY (AIza...)" />
        <select id="live-vehicle-id" class="select-input">
          ${arr(state.data?.vehicles)
            .map((v) => `<option value="${esc(v.id)}">${esc(v.brand)} ${esc(v.model)}</option>`)
            .join('')}
        </select>
        <button type="button" id="btn-live-gemini" class="btn btn-primary">🔍 Vérifier l'offre en direct</button>
      </div>
      <div id="live-gemini-output" class="muted" style="margin-top:0.85rem;font-size:0.86rem;"></div>
    </section>
  `;

  document.getElementById('btn-test-ntfy')?.addEventListener('click', async () => {
    const top = [...arr(state.data?.vehicles)]
      .sort((a, b) => (state.scores.get(b.id)?.score || 0) - (state.scores.get(a.id)?.score || 0))
      .slice(0, 3);
    const lines = top.map((v, i) => {
      const m = state.scores.get(v.id)?.metrics || metrics(v);
      return `${i + 1}. ${v.brand} ${v.model} : ${eur(m.bestNet)}${m.bestMonthly ? ` (${eur(m.bestMonthly)}/mois)` : ''}`;
    });
    try {
      const res = await fetch('https://ntfy.sh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: state.config.ntfyTopic,
          title: 'AutoVeille FR — Test Notification Top 3 Offres',
          message: lines.join('\n'),
          click: state.config.appUrl,
          tags: ['car', 'france'],
        }),
      });
      if (res.ok) toast(`Notification push envoyée sur ntfy.sh/${state.config.ntfyTopic} !`);
      else toast('Impossible de joindre ntfy.sh depuis ce réseau.');
    } catch {
      toast('Erreur réseau lors de l\'envoi ntfy.sh.');
    }
  });

  document.getElementById('btn-web-notif')?.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      toast('Les notifications Web ne sont pas supportées par ce navigateur.');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      new Notification('AutoVeille FR — Notifications activées', {
        body: 'Vous recevrez les alertes de baisses de prix et meilleures offres.',
      });
      toast('Notifications navigateur activées !');
    } else {
      toast('Permission de notification refusée.');
    }
  });

  document.getElementById('btn-reload-json')?.addEventListener('click', async () => {
    await loadData();
    route();
    toast('Catalogue et historique rechargés !');
  });

  document.getElementById('btn-live-gemini')?.addEventListener('click', async () => {
    const key = document.getElementById('live-gemini-key')?.value.trim();
    const vid = document.getElementById('live-vehicle-id')?.value;
    const out = document.getElementById('live-gemini-output');
    const v = arr(state.data?.vehicles).find((x) => x.id === vid);
    if (!key) {
      toast('Veuillez saisir une clé GEMINI_API_KEY ou utiliser le bouton GitHub Actions.');
      return;
    }
    if (!v || !out) return;
    out.innerHTML = `⏳ Recherche en direct des offres France pour <strong>${esc(v.brand)} ${esc(v.model)}</strong> via Gemini 2.5 Flash + Google Search…`;
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `En France aujourd'hui, quelles sont les offres promotionnelles, remises, bonus/prime CEE et loyers LLD/LOA en cours sur le site officiel ${v.brand} pour le modèle "${v.brand} ${v.model}" ? Résume en 4 points clairs avec les montants en euros.`,
                  },
                ],
              },
            ],
            tools: [{ google_search: {} }],
          }),
        }
      );
      const json = await resp.json();
      const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || JSON.stringify(json);
      out.innerHTML = `<div class="panel-card" style="margin-top:0.5rem;white-space:pre-wrap;">${esc(text)}</div>`;
    } catch (err) {
      out.textContent = `Erreur lors de l'appel Gemini : ${err.message}`;
    }
  });
}

/* ---------- Routeur Hash ---------- */
function route() {
  const main = document.getElementById('app-main');
  if (!main || !state.data) return;

  const rawHash = location.hash || '#/';
  const clean = rawHash.replace(/^#\/?/, '');
  const [seg, param] = clean.split('/');

  document.querySelectorAll('.main-nav .nav-link').forEach((link) => {
    const navKey = link.getAttribute('data-nav');
    const isActive = (seg === 'vehicule' && navKey === '') || seg === navKey || (!seg && navKey === '');
    link.classList.toggle('active', isActive);
  });

  updateCompareBadges();

  if (seg === 'vehicule' && param) {
    renderVehicleDetail(main, decodeURIComponent(param));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (seg === 'comparateur') {
    renderComparator(main);
  } else if (seg === 'simulateur') {
    renderSimulator(main);
  } else if (seg === 'marche') {
    renderMarket(main);
  } else if (seg === 'alertes') {
    renderAlertsPage(main);
  } else {
    renderDashboard(main);
  }
}

/* ---------- Initialisation & Événements globaux ---------- */
document.addEventListener('click', (e) => {
  const rivalsBtn = e.target.closest('.js-compare-rivals');
  if (rivalsBtn) {
    e.preventDefault();
    const id = rivalsBtn.getAttribute('data-id');
    const vehicles = arr(state.data?.vehicles);
    const target = vehicles.find((v) => v.id === id);
    if (!target) return;
    const sameEnergySameSeg = vehicles
      .filter((v) => v.id !== id && v.energy === target.energy && v.segment === target.segment)
      .sort((a, b) => (state.scores.get(b.id)?.score || 0) - (state.scores.get(a.id)?.score || 0));
    const sameEnergyOther = vehicles
      .filter((v) => v.id !== id && v.energy === target.energy && v.segment !== target.segment && v.isSUV === target.isSUV)
      .sort((a, b) => (state.scores.get(b.id)?.score || 0) - (state.scores.get(a.id)?.score || 0));
    const sameEnergyAny = vehicles
      .filter((v) => v.id !== id && v.energy === target.energy)
      .sort((a, b) => (state.scores.get(b.id)?.score || 0) - (state.scores.get(a.id)?.score || 0));
    const picks = [target.id];
    for (const cand of [...sameEnergySameSeg, ...sameEnergyOther, ...sameEnergyAny]) {
      if (picks.length < 4 && !picks.includes(cand.id)) picks.push(cand.id);
    }
    state.compareIds = picks;
    comparatorEnergyFilter = target.energy;
    saveCompare();
    location.hash = '#/comparateur';
    toast(`Comparatif ${target.energy} ouvert autour de ${fullModelName(target)} !`);
    return;
  }

  const cmpBtn = e.target.closest('.js-toggle-cmp');
  if (cmpBtn) {
    e.preventDefault();
    const id = cmpBtn.getAttribute('data-id');
    if (!id) return;
    const idx = state.compareIds.indexOf(id);
    if (idx >= 0) {
      state.compareIds.splice(idx, 1);
      toast('Véhicule retiré du comparateur.');
    } else {
      if (state.compareIds.length >= 4) {
        toast('Comparateur complet (4 véhicules max).');
        return;
      }
      state.compareIds.push(id);
      toast('Véhicule ajouté au comparateur !');
    }
    saveCompare();
    route();
  }
});

document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = next === 'dark' ? '☀️' : '🌙';
  try {
    localStorage.setItem('av_theme', next);
  } catch {}
});

window.addEventListener('hashchange', route);

(async function init() {
  loadLocalState();
  await loadData();
  route();
})();
