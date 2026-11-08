#!/usr/bin/env node
// Script d'actualisation quotidienne des offres véhicules via Gemini 2.5 Flash + Google Search
// et d'archivage des snapshots quotidiens dans data/history.json (90 jours conservés).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arr, num, str, makeSnapshot, todayParis } from '../assets/score.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VEHICLES_PATH = path.join(ROOT, 'data', 'vehicles.json');
const SAMPLE_PATH = path.join(ROOT, 'data', 'vehicles.sample.json');
const HISTORY_PATH = path.join(ROOT, 'data', 'history.json');

const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const SLEEP_MS = Number(process.env.GEMINI_DELAY_MS || 2200);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readJsonSafe(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function extractJsonBlock(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

async function fetchVehicleOffersFromGemini(vehicle, today) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(API_KEY)}`;
  const prompt = `Nous sommes le ${today} en France. Recherche sur Google les offres constructeurs et concessions actuelles en France pour le véhicule "${vehicle.brand} ${vehicle.model}" (${vehicle.energy}, site officiel : ${vehicle.officialUrl || ''}).
Renvoie UNIQUEMENT un bloc JSON valide (entouré de \`\`\`json ... \`\`\`) au format exact suivant :
\`\`\`json
{
  "priceFromEur": 29990,
  "dealerBehavior": "Synthèse courte (1-2 phrases) sur la politique de remise actuelle en concession France.",
  "offers": [
    {
      "type": "LLD",
      "title": "Intitulé précis de l'offre en cours",
      "monthlyEur": 249,
      "durationMonths": 37,
      "downPaymentEur": 3000,
      "kmPerYear": 10000,
      "discountEur": 3000,
      "priceAfterEur": 26990,
      "validUntil": "2026-12-31",
      "conditions": "Conditions principales de l'offre",
      "sourceUrl": "${vehicle.officialUrl || ''}"
    }
  ]
}
\`\`\``;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.2 },
    }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} (${res.statusText})`);
  }

  const payload = await res.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || '';
  const groundingUrl =
    payload?.candidates?.[0]?.groundingMetadata?.groundingChunks?.find((c) => c?.web?.uri)?.web?.uri ||
    vehicle.officialUrl;

  const parsed = extractJsonBlock(text);
  if (!parsed || typeof parsed !== 'object') return null;

  return { parsed, groundingUrl };
}

function mergeVehicleUpdate(vehicle, updateResult, today) {
  if (!updateResult?.parsed) return false;
  const { parsed, groundingUrl } = updateResult;
  let changed = false;

  const newPrice = num(parsed.priceFromEur);
  if (newPrice != null && newPrice >= 10000 && newPrice <= 150000) {
    vehicle.priceFromEur = Math.round(newPrice);
    changed = true;
  }

  if (typeof parsed.dealerBehavior === 'string' && parsed.dealerBehavior.trim().length >= 15) {
    vehicle.dealerBehavior = parsed.dealerBehavior.trim().slice(0, 420);
    changed = true;
  }

  if (Array.isArray(parsed.offers) && parsed.offers.length > 0) {
    const validOffers = parsed.offers
      .filter((o) => o && typeof o === 'object' && str(o.title).trim().length > 2)
      .map((o) => ({
        type: str(o.type || 'Offre').slice(0, 40),
        title: str(o.title).slice(0, 160),
        monthlyEur: num(o.monthlyEur),
        durationMonths: num(o.durationMonths),
        downPaymentEur: num(o.downPaymentEur),
        kmPerYear: num(o.kmPerYear),
        discountEur: num(o.discountEur),
        priceAfterEur: num(o.priceAfterEur),
        validUntil: o.validUntil ? str(o.validUntil).slice(0, 20) : null,
        conditions: str(o.conditions || '').slice(0, 320),
        sourceUrl: /^https?:\/\//i.test(str(o.sourceUrl)) ? str(o.sourceUrl) : groundingUrl || vehicle.officialUrl,
      }));

    if (validOffers.length > 0) {
      vehicle.offers = validOffers;
      changed = true;
    }
  }

  vehicle.lastChecked = today;
  return changed;
}

async function main() {
  const today = todayParis();
  let hasMainCatalog = true;
  let catalog = await readJsonSafe(VEHICLES_PATH, null);

  if (!catalog) {
    hasMainCatalog = false;
    catalog = await readJsonSafe(SAMPLE_PATH, { vehicles: [] });
    console.log('ℹ️ data/vehicles.json absent, lecture de data/vehicles.sample.json.');
  }

  const vehicles = arr(catalog?.vehicles);
  console.log(`🚗 Catalogue chargé : ${vehicles.length} véhicules (date Paris : ${today}).`);

  if (API_KEY) {
    console.log(`🔍 Clé GEMINI_API_KEY détectée — actualisation live via ${MODEL} + Google Search…`);
    let updatedCount = 0;
    for (const v of vehicles) {
      try {
        process.stdout.write(`  ↻ Vérification ${v.brand} ${v.model}… `);
        const res = await fetchVehicleOffersFromGemini(v, today);
        if (mergeVehicleUpdate(v, res, today)) {
          updatedCount++;
          console.log('OK (mis à jour)');
        } else {
          console.log('inchangé');
        }
      } catch (err) {
        console.log(`ignoré (${err.message})`);
      }
      await sleep(SLEEP_MS);
    }
    catalog.updatedAt = new Date().toISOString();
    if (hasMainCatalog) {
      await fs.writeFile(VEHICLES_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
      console.log(`✅ data/vehicles.json mis à jour (${updatedCount}/${vehicles.length} véhicules actualisés).`);
    }
  } else {
    console.log('ℹ️ Aucune clé GEMINI_API_KEY définie : conservation des offres actuelles et mise à jour du snapshot d\'historique uniquement.');
  }

  // Mise à jour du snapshot dans data/history.json (conservation 90 jours)
  const history = (await readJsonSafe(HISTORY_PATH, null)) || { updatedAt: null, snapshots: [] };
  const snap = makeSnapshot(vehicles, today);
  const filteredSnaps = arr(history.snapshots).filter((s) => s && s.date && s.date !== today);
  filteredSnaps.push(snap);
  filteredSnaps.sort((a, b) => a.date.localeCompare(b.date));

  history.updatedAt = new Date().toISOString();
  history.snapshots = filteredSnaps.slice(-90);

  await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  await fs.writeFile(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n', 'utf8');
  console.log(`📈 Snapshot du ${today} enregistré dans data/history.json (${history.snapshots.length} jour(s) d'historique).`);
}

main().catch((err) => {
  console.error('❌ Erreur dans update-offers.mjs :', err);
  process.exitCode = 1;
});
