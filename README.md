# 🚗 AutoVeille FR — Comparateur d'Offres Véhicules (BEV · PHEV · HEV) & Veille Concessions

Application web statique et agent quotidien automatisé permettant de comparer les **meilleures offres constructeurs et concessions en France** sur les véhicules **100 % électriques (BEV)**, **hybrides rechargeables (PHEV)** et **hybrides simples (HEV)** :
- **SUV** (citadins, compacts, familiaux) vs **Citadines & Compactes** (gabarit type Renault Clio, Mégane E-Tech, R5, Peugeot 208/308, MG4…)
- **Analyse spécifique de l'offensive des marques chinoises** (BYD, MG, Leapmotor, Xpeng) face aux droits de douane européens (fortes remises sur les BEV en stock et bascule vers les hybrides/PHEV non surtaxés comme le BYD Seal U DM-i ou le MG ZS Hybrid+)
- **Simulateur TCO 4 ans** intégrant le scénario **« Citadine/Compacte au quotidien + location d'un grand véhicule l'été (2 à 3 semaines) » face à un SUV toute l'année**
- **Comportement des concessions & générateur d'argumentaire de négociation** en 1 clic
- **Accès direct aux sites officiels constructeurs** sur chaque carte et en-tête de fiche véhicule

🔗 **Application en ligne :** `https://sirjface-itchy.github.io/comparateur-auto-fr/`

---

## ✨ Fonctionnalités principales

1. **Tableau de bord & Offres (`#/`)**
   - Bandeau KPI en temps réel (nombre de modèles, plus forte remise constatée, meilleur loyer LLD/LOA, statut des alertes).
   - **Alertes & Baisses du jour** comparées automatiquement à l'historique (`data/history.json`).
   - **Podium des Meilleures Offres du jour** notées sur `/100` via un algorithme multi-critères (`assets/score.js` : prix net remisé et aides déduites 30 %, mensualité lissée 25 %, autonomie 15 %, notes 20 %, % de remise 10 %).
   - Filtres instantanés : recherche texte, filtres rapides (*SUV*, *Citadine & Compacte type Clio/Mégane*, *BEV*, *PHEV*, *HEV*, *Marques chinoises*, *Éligible aides CEE*), budget max, mensualité max, autonomie min, volume de coffre min.
2. **Fiche véhicule détaillée (`#/vehicule/<id>`)**
   - **Bouton principal et titre cliquables** ouvrant directement la page du modèle sur le **site officiel du constructeur** (`officialUrl`) + lien vers le configurateur officiel.
   - Détail complet des offres LLD / LOA / Remises / Primes reprise avec conditions et validité.
   - Encadré **Comportement des concessions & Négociation** : fourchette de remise constatée en concession et **générateur en 1 clic d'un email de négociation personnalisé**.
   - Équipements de série compris, comparatif des finitions/versions, caractéristiques techniques complètes, aides d'État 2026, points forts/faibles.
3. **Comparateur côte à côte (`#/comparateur`)**
   - Compare jusqu'à **4 véhicules simultanément** (pré-rempli automatiquement avec 3 modèles phares si vide).
   - Mise en évidence automatique des meilleures valeurs en **vert** et des moins favorables en **ambre**.
4. **Simulateur TCO 4 ans & Scénario « Compacte + Location Été vs SUV » (`#/simulateur`)**
   - Calcule le coût réel sur 4 ans (achat avec décote ou LLD/LOA, électricité domicile/borne vs essence, assurance, entretien).
   - Compare directement l'option **Compacte au quotidien + X semaines de location d'un grand véhicule l'été** face à la détention d'un **SUV familial toute l'année**.
5. **Marché & Concessions (`#/marche`)**
   - Décryptage des droits de douane européens sur les BEV chinois, bascule PHEV/HEV, aides françaises 2026 et guide tactique de négociation en concession.
6. **Alertes & Agent Quotidien (`#/alertes`)**
   - **06h30 (heure de Paris)** : Actualisation des offres et envoi du rapport complet par email à `sirjface@gmail.com`.
   - **07h00 (heure de Paris)** : Notification push matinale sur smartphone/desktop via **ntfy.sh** (`https://ntfy.sh/comparateur-auto-fr-sirjface-7h`).
   - **Vérification sur demande** en 1 clic via GitHub Actions ou en direct dans le navigateur avec une clé API Gemini.

---

## 🛠️ Architecture du projet

```text
├── index.html                  # Application SPA (français, thème sombre/clair)
├── config.json                 # Configuration du dépôt, URL Pages, topic ntfy et email
├── package.json                # Scripts Node ESM + dépendance nodemailer
├── assets/
│   ├── style.css               # Design éditorial automobile responsive
│   ├── score.js                # Module ESM partagé (calcul des scores, prix nets, diff historique)
│   └── app.js                  # Logique SPA (6 vues, filtres, TCO, comparateur, alertes)
├── data/
│   ├── vehicles.json           # Catalogue complet des véhicules et offres France
│   ├── vehicles.sample.json    # Catalogue de secours (3 véhicules)
│   └── history.json            # Historique quotidien sur 90 jours glissants
├── scripts/
│   ├── update-offers.mjs       # Actualisation via Gemini 2.5 Flash (Google Search) + snapshot
│   └── send-digest.mjs         # Génération rapport HTML, envoi email SMTP Gmail et push ntfy.sh
└── .github/workflows/
    ├── daily.yml               # Automatisation 06h30 (email) & 07h00 (push) + workflow_dispatch
    └── pages.yml               # Déploiement continu sur GitHub Pages
```

---

## 🔐 Configuration des Secrets GitHub Actions

Dans votre dépôt GitHub (`Settings > Secrets and variables > Actions`), configurez les secrets suivants (tous sont optionnels : les workflows fonctionnent sans erreur même si certains secrets ne sont pas encore renseignés) :

| Secret | Description |
| :--- | :--- |
| `GEMINI_API_KEY` | Clé API Google Gemini ([Google AI Studio](https://aistudio.google.com/)) utilisée par `scripts/update-offers.mjs` pour interroger `gemini-2.5-flash` avec Google Search grounding. |
| `GMAIL_USER` | Adresse Gmail expéditrice (ex: `sirjface@gmail.com`). |
| `GMAIL_APP_PASSWORD` | **Mot de passe d'application Google** (16 caractères, généré dans *Compte Google > Sécurité > Validation en deux étapes > Mots de passe des applications*). |
| `DIGEST_TO` | *(Optionnel)* Destinataire du rapport quotidien (défaut : `sirjface@gmail.com`). |
| `NTFY_TOPIC` | *(Optionnel)* Canal ntfy.sh pour la notification de 7h00 (défaut : `comparateur-auto-fr-sirjface-7h`). |

---

## 📲 Recevoir la notification de 07h00 sur téléphone (sans compte requis)

1. Installez l'application gratuite **ntfy** ([iOS App Store](https://apps.apple.com/app/ntfy/id1625396347) / [Google Play](https://play.google.com/store/apps/details?id=io.heckel.ntfy)) ou ouvrez directement `https://ntfy.sh/comparateur-auto-fr-sirjface-7h` dans votre navigateur.
2. Abonnez-vous au sujet (`topic`) : **`comparateur-auto-fr-sirjface-7h`**.
3. Vous recevrez chaque matin à 07h00 (heure de Paris) le résumé du Top 3 des meilleures offres avec lien direct vers la webapp.

---

## 💻 Tester en local

```bash
# 1. Installer les dépendances (nodemailer)
npm install

# 2. Vérifier la génération du rapport HTML quotidien (écrit out/digest.html)
npm run digest:dry

# 3. Tester l'envoi d'une notification push sur ntfy.sh
npm run digest:push

# 4. Lancer un serveur statique local
npx serve .
# ou : python3 -m http.server 8080
```
