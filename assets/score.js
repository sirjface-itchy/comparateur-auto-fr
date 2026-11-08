// Fonctions de calcul partagées entre la webapp (navigateur) et les scripts Node.
// Aucune dépendance : module ESM pur.

/** Convertit une valeur en nombre fini, ou null. Accepte "12 990 €", "4,5". */
export function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.replace(/[\s\u202f\u00a0€]/g, '').replace(',', '.');
    if (s && /^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  }
  return null;
}

export const arr = (v) => (Array.isArray(v) ? v : []);
export const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Offre réservée (leasing social…) : affichée mais exclue des « meilleures » offres. */
export function isRestricted(o) {
  return /social/i.test(`${str(o?.type)} ${str(o?.title)}`);
}

export function isLeaseOffer(o) {
  return (num(o?.monthlyEur) ?? 0) > 0;
}

/** Mensualité « effective » : loyer + apport lissé sur la durée. */
export function effectiveMonthly(o) {
  const m = num(o?.monthlyEur);
  if (m == null || m <= 0) return null;
  const dur = num(o?.durationMonths) || 37;
  const down = num(o?.downPaymentEur) || 0;
  return m + down / dur;
}

/** Clé courte et stable d'une offre (détection des nouvelles offres). */
export function offerKey(o) {
  const s = [str(o?.type), str(o?.title), num(o?.monthlyEur) ?? '', num(o?.priceAfterEur) ?? '', num(o?.discountEur) ?? '']
    .join('|')
    .toLowerCase();
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Indicateurs clés d'un véhicule (défensif : tout peut être null). */
export function metrics(v) {
  const price = num(v?.priceFromEur);
  const aids = v?.aids || {};
  const bonus = aids.ecoScoreEligible === false ? 0 : num(aids.bonusEur) || 0;
  const malus = num(aids.malusEur) || 0;
  const offers = arr(v?.offers).filter((o) => o && typeof o === 'object');

  // Prix net d'achat
  const netCandidates = [];
  if (price != null) netCandidates.push({ value: price - bonus + malus, offer: null });
  let maxDiscount = 0;
  for (const o of offers) {
    if (isRestricted(o)) continue;
    const after = num(o.priceAfterEur);
    const disc = num(o.discountEur);
    if (after != null && after > 0) {
      netCandidates.push({ value: after + malus, offer: o });
      if (price != null && price > after) maxDiscount = Math.max(maxDiscount, price - after);
    } else if (disc != null && disc > 0 && price != null) {
      netCandidates.push({ value: price - disc - bonus + malus, offer: o });
    }
    if (disc != null && disc > 0) maxDiscount = Math.max(maxDiscount, disc);
  }
  netCandidates.sort((a, b) => a.value - b.value);
  const bestNetC = netCandidates[0] || null;

  // Meilleure mensualité (LLD / LOA)
  let bestMonthlyOffer = null;
  let bestEff = null;
  for (const o of offers) {
    if (isRestricted(o) || !isLeaseOffer(o)) continue;
    const e = effectiveMonthly(o);
    if (e != null && (bestEff == null || e < bestEff)) {
      bestEff = e;
      bestMonthlyOffer = o;
    }
  }

  const s = v?.specs || {};
  const range = num(s.rangeKm) ?? num(s.electricRangeKm);
  const r = v?.ratings || {};
  const rVals = ['value', 'range', 'comfort', 'equipment'].map((k) => num(r[k])).filter((x) => x != null);
  const ratingAvg = rVals.length ? rVals.reduce((a, b) => a + b, 0) / rVals.length : null;

  return {
    price,
    bonus,
    malus,
    bestNet: bestNetC ? Math.round(bestNetC.value) : null,
    bestNetOffer: bestNetC?.offer || null,
    bestMonthly: bestMonthlyOffer ? num(bestMonthlyOffer.monthlyEur) : null,
    bestMonthlyEffective: bestEff != null ? Math.round(bestEff) : null,
    bestMonthlyOffer,
    maxDiscount: maxDiscount || null,
    discountPct: price && maxDiscount ? maxDiscount / price : null,
    range,
    ratingAvg,
    offersCount: offers.length,
  };
}

/** Échelle des notes (5 ou 10) déduite des données. */
export function ratingScale(vehicles) {
  let max = 0;
  for (const v of arr(vehicles)) for (const x of Object.values(v?.ratings || {})) max = Math.max(max, num(x) || 0);
  return max > 5 ? 10 : 5;
}

/** Score global 0-100 normalisé sur l'ensemble du catalogue. */
export function scoreAll(vehicles) {
  const list = arr(vehicles).filter((v) => v && v.id);
  const ms = list.map((v) => ({ v, m: metrics(v) }));
  const crit = [
    { key: 'bestNet', w: 0.3, low: true },
    { key: 'bestMonthlyEffective', w: 0.25, low: true },
    { key: 'range', w: 0.15, low: false },
    { key: 'ratingAvg', w: 0.2, low: false },
    { key: 'discountPct', w: 0.1, low: false },
  ];
  const bounds = {};
  for (const c of crit) {
    const vals = ms.map((x) => x.m[c.key]).filter((x) => x != null);
    bounds[c.key] = vals.length ? [Math.min(...vals), Math.max(...vals)] : null;
  }
  const out = new Map();
  for (const { v, m } of ms) {
    let total = 0;
    const parts = {};
    for (const c of crit) {
      const val = m[c.key];
      const b = bounds[c.key];
      let n;
      if (c.key === 'discountPct' && val == null) n = 0;
      else if (val == null || !b) n = 0.35;
      else if (b[1] === b[0]) n = 0.7;
      else n = (val - b[0]) / (b[1] - b[0]);
      if (c.low && val != null && b && b[1] !== b[0]) n = 1 - n;
      parts[c.key] = n;
      total += n * c.w;
    }
    out.set(v.id, { score: Math.round(total * 100), parts, metrics: m });
  }
  return out;
}

/** Snapshot compact pour data/history.json */
export function makeSnapshot(vehicles, date) {
  return {
    date,
    items: arr(vehicles)
      .filter((v) => v && v.id)
      .map((v) => {
        const m = metrics(v);
        return {
          id: v.id,
          p: m.price,
          n: m.bestNet,
          m: m.bestMonthly,
          k: arr(v.offers).map(offerKey),
        };
      }),
  };
}

/** Compare l'état courant au dernier snapshot antérieur à `today` (YYYY-MM-DD). */
export function computeChanges(vehicles, history, today) {
  const snaps = arr(history?.snapshots)
    .filter((s) => s && typeof s.date === 'string')
    .sort((a, b) => a.date.localeCompare(b.date));
  const prev = [...snaps].reverse().find((s) => s.date < today);
  const res = { prevDate: prev?.date || null, drops: [], ups: [], newOffers: [], newVehicles: [] };
  if (!prev) return res;
  const old = new Map(arr(prev.items).map((i) => [i.id, i]));
  const fields = [
    ['n', 'bestNet', 'Prix net estimé'],
    ['m', 'bestMonthly', 'Mensualité'],
    ['p', 'price', 'Prix catalogue'],
  ];
  for (const v of arr(vehicles)) {
    if (!v?.id) continue;
    const o = old.get(v.id);
    if (!o) {
      res.newVehicles.push(v);
      continue;
    }
    const m = metrics(v);
    for (const [k, mk, label] of fields) {
      const a = num(o[k]);
      const b = m[mk];
      if (a == null || b == null) continue;
      if (b < a - 1) res.drops.push({ v, field: mk, label, old: a, now: b, delta: b - a });
      else if (b > a + 1) res.ups.push({ v, field: mk, label, old: a, now: b, delta: b - a });
    }
    if (Array.isArray(o.k)) {
      const known = new Set(o.k);
      for (const off of arr(v.offers)) if (off && !known.has(offerKey(off))) res.newOffers.push({ v, offer: off });
    }
  }
  res.drops.sort((a, b) => a.delta / a.old - b.delta / b.old);
  return res;
}

export function todayParis(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
