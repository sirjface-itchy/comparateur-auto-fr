#!/usr/bin/env node
// Génération et envoi du rapport quotidien (6h30 Email HTML + 7h00 Notification Push ntfy.sh)
// Options CLI :
//   --dry-run : écrit out/digest.html sans envoyer d'email
//   --push    : envoie la notification matinale sur ntfy.sh

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arr, num, str, metrics, scoreAll, computeChanges, todayParis } from '../assets/score.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const isDryRun = args.has('--dry-run');
const isPush = args.has('--push');

async function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

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

function isCompact(v) {
  const seg = str(v?.segment).toLowerCase();
  return !v?.isSUV && (seg.includes('citadine') || seg.includes('compacte') || seg.includes('berline'));
}

function buildDigestHtml({ catalog, config, scores, changes, today }) {
  const appUrl = (process.env.APP_URL || config.appUrl || 'https://sirjface-itchy.github.io/comparateur-auto-fr/').replace(/\/?$/, '/');
  const vehicles = arr(catalog?.vehicles);
  const ranked = [...vehicles]
    .map((v) => ({ v, s: scores.get(v.id)?.score || 0, m: scores.get(v.id)?.metrics || metrics(v) }))
    .sort((a, b) => b.s - a.s);

  const top10 = ranked.slice(0, 10);
  const topSuv = ranked.filter((x) => x.v.isSUV).slice(0, 5);
  const topCompact = ranked.filter((x) => isCompact(x.v)).slice(0, 5);

  const renderRow = (item, idx) => {
    const { v, s, m } = item;
    const detailLink = `${appUrl}#/vehicule/${encodeURIComponent(v.id)}`;
    const officialLink = v.officialUrl || detailLink;
    const offerLink = m.bestNetOffer?.sourceUrl || m.bestMonthlyOffer?.sourceUrl || officialLink;
    return `
      <tr>
        <td style="padding:12px 10px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0284c7;">#${idx + 1} (${s}/100)</td>
        <td style="padding:12px 10px;border-bottom:1px solid #e2e8f0;">
          <a href="${esc(officialLink)}" style="font-weight:700;color:#0f172a;text-decoration:none;font-size:15px;">${esc(v.brand)} ${esc(v.model)} ↗</a>
          <div style="font-size:12px;color:#64748b;margin-top:2px;">${esc(v.energy)} · ${esc(v.segment)} · Origine : ${esc(v.origin)}</div>
        </td>
        <td style="padding:12px 10px;border-bottom:1px solid #e2e8f0;">
          <strong style="color:#059669;font-size:15px;">${eur(m.bestNet ?? m.price)}</strong>
          ${m.maxDiscount ? `<div style="font-size:11px;color:#059669;">Remise −${eur(m.maxDiscount)}</div>` : ''}
          ${m.bonus ? `<div style="font-size:11px;color:#0284c7;">Bonus −${eur(m.bonus)}</div>` : ''}
        </td>
        <td style="padding:12px 10px;border-bottom:1px solid #e2e8f0;">
          ${m.bestMonthly ? `<strong style="color:#0284c7;">${eur(m.bestMonthly)}/mois</strong>` : '—'}
          ${m.range ? `<div style="font-size:11px;color:#64748b;">Autonomie : ${m.range} km</div>` : ''}
        </td>
        <td style="padding:12px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;">
          <a href="${esc(detailLink)}" style="color:#0284c7;font-weight:600;text-decoration:none;">Fiche Webapp</a> ·
          <a href="${esc(offerLink)}" style="color:#059669;font-weight:600;text-decoration:none;">Site ${esc(v.brand)} ↗</a>
        </td>
      </tr>
    `;
  };

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>AutoVeille FR — Rapport Quotidien du ${esc(today)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <div style="max-width:780px;margin:24px auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #cbd5e1;">
    <div style="background:linear-gradient(135deg,#0f172a,#0284c7);color:#ffffff;padding:26px 28px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;opacity:0.85;">AutoVeille France · Veille Quotidienne 06h30</div>
      <h1 style="margin:6px 0 8px;font-size:24px;">🏆 Meilleures Offres Véhicules du ${esc(today)}</h1>
      <p style="margin:0;font-size:14px;opacity:0.9;">
        ${vehicles.length} modèles analysés (BEV, PHEV, HEV) · SUV & Compactes · Remises constructeurs, bonus CEE et concessions.
      </p>
      <div style="margin-top:16px;">
        <a href="${esc(appUrl)}" style="display:inline-block;background:#10b981;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;">
          Ouvrir le Comparateur Interactif ↗
        </a>
        <a href="${esc(appUrl)}#/simulateur" style="display:inline-block;background:rgba(255,255,255,0.16);color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;margin-left:8px;">
          Simulateur Compacte + Location Été vs SUV ↗
        </a>
      </div>
    </div>

    <div style="padding:24px 28px;">
      <!-- Baisses & Nouvelles offres -->
      <h2 style="font-size:18px;margin:0 0 10px;color:#0f172a;">📡 Alertes & Variations détectées</h2>
      ${
        changes.drops.length > 0 || changes.newOffers.length > 0
          ? `<ul style="padding-left:18px;margin:0 0 22px;font-size:14px;line-height:1.6;">
              ${changes.drops
                .map(
                  (d) =>
                    `<li><strong>📉 ${esc(d.v.brand)} ${esc(d.v.model)}</strong> — ${esc(d.label)} : ${eur(d.old)} → <strong style="color:#059669;">${eur(d.now)} (${eur(d.delta)})</strong> (<a href="${esc(d.v.officialUrl || appUrl)}">Site officiel ↗</a>)</li>`
                )
                .join('')}
              ${changes.newOffers
                .map(
                  (n) =>
                    `<li><strong>🆕 ${esc(n.v.brand)} ${esc(n.v.model)}</strong> — Nouvelle offre : ${esc(n.offer.title)} (<a href="${esc(n.offer.sourceUrl || n.v.officialUrl || appUrl)}">Voir l'offre ↗</a>)</li>`
                )
                .join('')}
            </ul>`
          : `<p style="font-size:13px;color:#64748b;margin:0 0 22px;">Pas de variation brusque par rapport au dernier snapshot (${esc(changes.prevDate || 'initial')}). Retrouvez ci-dessous le Top 10 des offres actives.</p>`
      }

      <!-- Top 10 Global -->
      <h2 style="font-size:18px;margin:0 0 12px;color:#0f172a;">🥇 Top 10 des Meilleures Offres du Jour</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:26px;">
        <thead>
          <tr style="background:#f8fafc;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase;">
            <th style="padding:10px;">Rang</th>
            <th style="padding:10px;">Modèle (clic = site officiel)</th>
            <th style="padding:10px;">Prix Net</th>
            <th style="padding:10px;">Meilleure LLD/LOA</th>
            <th style="padding:10px;">Accès directs</th>
          </tr>
        </thead>
        <tbody>
          ${top10.map(renderRow).join('')}
        </tbody>
      </table>

      <!-- Focus Duel : SUV vs Citadine/Compacte -->
      <h2 style="font-size:18px;margin:0 0 10px;color:#0f172a;">⚖️ Focus : Top SUV vs Top Citadines & Compactes (type Clio / Mégane)</h2>
      <p style="font-size:13px;color:#475569;margin:0 0 14px;">
        Comparez l'achat d'un SUV familial toute l'année face à une compacte agile au quotidien complétée par une location estivale sur <a href="${esc(appUrl)}#/simulateur" style="color:#0284c7;font-weight:600;">le simulateur TCO 4 ans</a>.
      </p>

      <h3 style="font-size:15px;color:#0284c7;margin:14px 0 8px;">🚙 Top 5 SUV (Citadins, Compacts & Familiaux)</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <tbody>${topSuv.map(renderRow).join('')}</tbody>
      </table>

      <h3 style="font-size:15px;color:#059669;margin:14px 0 8px;">🚗 Top 5 Citadines & Compactes (Gabarit Clio / Mégane / R5)</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tbody>${topCompact.map(renderRow).join('')}</tbody>
      </table>

      <!-- Comportement concessions -->
      <div style="background:#f8fafc;border-left:4px solid #f59e0b;padding:14px 16px;border-radius:8px;font-size:13px;color:#334155;">
        <strong>🤝 Conseil Négociation & Concessions du moment :</strong>
        <p style="margin:6px 0 0;">
          Les marques chinoises (BYD, MG, Leapmotor, Xpeng) compensent les droits de douane UE sur les BEV par d'importantes remises sur stock (4 000 à 7 000 €) et poussent leurs SUV hybrides/PHEV non surtaxés (BYD Seal U DM-i, MG ZS Hybrid+). Chez les constructeurs européens et coréens (Renault, Peugeot, Kia, Hyundai, VW), ciblez les véhicules en stock livrables avant fin de mois pour obtenir 5 à 10 % de remise additionnelle.
        </p>
      </div>
    </div>

    <div style="background:#f8fafc;padding:16px 28px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;text-align:center;">
      Rapport généré automatiquement par AutoVeille FR · <a href="${esc(appUrl)}" style="color:#0284c7;">${esc(appUrl)}</a>
    </div>
  </div>
</body>
</html>`;
}

async function sendPushNotification({ catalog, config, scores, changes, today }) {
  const topic = process.env.NTFY_TOPIC || config.ntfyTopic || 'comparateur-auto-fr-sirjface-7h';
  const appUrl = process.env.APP_URL || config.appUrl || 'https://sirjface-itchy.github.io/comparateur-auto-fr/';
  const vehicles = arr(catalog?.vehicles);
  const top3 = [...vehicles]
    .map((v) => ({ v, s: scores.get(v.id)?.score || 0, m: scores.get(v.id)?.metrics || metrics(v) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3);

  const lines = top3.map(
    (x, i) =>
      `${i + 1}. ${x.v.brand} ${x.v.model} (${x.v.energy}) : net ${eur(x.m.bestNet)}${
        x.m.bestMonthly ? ` | LLD ${eur(x.m.bestMonthly)}/mois` : ''
      }`
  );
  if (changes.drops.length > 0) {
    lines.push(`📉 ${changes.drops.length} baisse(s) de prix détectée(s) ce matin !`);
  }
  lines.push(`👉 Ouvrir le comparateur : ${appUrl}`);

  const res = await fetch('https://ntfy.sh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic,
      title: `AutoVeille 7h00 — Top Offres Auto du ${today}`,
      message: lines.join('\n'),
      click: appUrl,
      tags: ['car', 'chart_with_downwards_trend'],
      priority: 3,
    }),
  });

  if (!res.ok) {
    console.warn(`⚠️ Avertissement ntfy.sh : HTTP ${res.status}`);
  } else {
    console.log(`📲 Notification push 7h00 envoyée sur https://ntfy.sh/${topic}`);
  }
}

async function main() {
  const today = todayParis();
  const config = (await readJsonSafe(path.join(ROOT, 'config.json'), {})) || {};
  const catalog =
    (await readJsonSafe(path.join(ROOT, 'data', 'vehicles.json'), null)) ||
    (await readJsonSafe(path.join(ROOT, 'data', 'vehicles.sample.json'), { vehicles: [] }));
  const history = await readJsonSafe(path.join(ROOT, 'data', 'history.json'), { snapshots: [] });

  const vehicles = arr(catalog?.vehicles);
  const scores = scoreAll(vehicles);
  const changes = computeChanges(vehicles, history, today);

  if (isPush) {
    await sendPushNotification({ catalog, config, scores, changes, today });
    return;
  }

  const html = buildDigestHtml({ catalog, config, scores, changes, today });
  const outPath = path.join(ROOT, 'out', 'digest.html');
  const publicDigestPath = path.join(ROOT, 'digest.html');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, html, 'utf8');
  await fs.writeFile(publicDigestPath, html, 'utf8');
  console.log(`📝 Rapport HTML généré dans ${outPath} et ${publicDigestPath}`);

  if (isDryRun) {
    console.log('✅ Mode --dry-run terminé avec succès.');
    return;
  }

  const gmailUser = process.env.GMAIL_USER || '';
  const gmailPass = process.env.GMAIL_APP_PASSWORD || '';
  const to = process.env.DIGEST_TO || config.alertEmail || 'sirjface@gmail.com';

  if (!gmailUser || !gmailPass) {
    console.log(
      `ℹ️ Secrets GMAIL_USER / GMAIL_APP_PASSWORD non configurés : l'email à ${to} n'a pas été envoyé (le rapport HTML reste disponible dans digest.html).`
    );
    return;
  }

  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.default.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass.replace(/\s+/g, '') },
  });

  try {
    await transporter.sendMail({
      from: `"AutoVeille FR" <${gmailUser}>`,
      to,
      subject: `🚗 AutoVeille 6h30 — Meilleures Offres & Remises du ${today}`,
      html,
    });
    console.log(`📧 Email quotidien envoyé avec succès à ${to} !`);
  } catch (err) {
    console.warn(`⚠️ Envoi SMTP Gmail refusé (${err.responseCode || err.code || err.message}).`);
    console.warn(
      `👉 Gmail exige un "Mot de passe d'application" de 16 lettres (https://myaccount.google.com/apppasswords) au lieu du mot de passe principal du compte lorsque la validation à 2 facteurs est active.`
    );
    console.log(`📲 Envoi automatique d'une notification de secours avec lien vers le rapport HTML en ligne…`);
    await sendPushNotification({ catalog, config, scores, changes, today });
  }
}

main().catch((err) => {
  console.error('❌ Erreur dans send-digest.mjs :', err);
  process.exitCode = 1;
});
