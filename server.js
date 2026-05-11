const express = require("express");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const WA_TOKEN = process.env.WA_TOKEN;
const WA_PHONE_ID = process.env.WA_PHONE_ID;
const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || "erpac_verify";

// ─────────────────────────────────────────────────────────────────────────────
//  GOOGLE SHEETS & LOCAL STORAGE
// ─────────────────────────────────────────────────────────────────────────────
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1XiLalbZsdD34IXsyZ3VcgX2kYgeHk5LOmOKfbNz1y5I";
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
let sheets = null;

async function initGoogleSheets() {
  if (!SPREADSHEET_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.log("⚠️ Google Sheets non configuré");
    return false;
  }
  try {
    const privateKey = GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
    const auth = new google.auth.JWT(
      GOOGLE_CLIENT_EMAIL,
      null,
      privateKey,
      ["https://www.googleapis.com/auth/spreadsheets"]
    );
    sheets = google.sheets({ version: "v4", auth });
    await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    console.log("✅ Google Sheets connecté");
    return true;
  } catch (error) {
    console.error("❌ Erreur Sheets:", error.message);
    return false;
  }
}

async function addLeadToSheet(clientData, projectData, total) {
  if (!sheets) return false;
  const now = new Date().toLocaleString("fr-MA", { timeZone: "Africa/Casablanca" });
  const score = estimateLeadScore(clientData, projectData, total);
  const values = [[
    now,
    clientData.nom || "",
    clientData.telephone || "",
    clientData.email || "",
    projectData.type || "",
    projectData.city || "",
    projectData.surface || "",
    projectData.floors || "",
    projectData.standing || "",
    projectData.basement || "",
    projectData.soil || "",
    projectData.pool || "",
    projectData.ac || "",
    projectData.home_automation || "",
    total,
    clientData.telephone ? `https://wa.me/${String(clientData.telephone).replace(/[^0-9]/g, "")}` : "",
    "Nouveau",
    score.label
  ]];
  try {
    try {
      await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "Feuil1!A1:R1" });
    } catch {
      const headers = [[
        "Date/Heure", "Nom Client", "Téléphone", "Email", "Type Projet", "Ville",
        "Surface (m²)", "Niveaux", "Standing", "Sous-sol", "Terrain", "Piscine",
        "Clim Gainable", "Domotique", "Montant TTC", "Lien WhatsApp", "Statut", "Score Lead"
      ]];
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: "Feuil1!A1:R1",
        valueInputOption: "USER_ENTERED",
        resource: { values: headers },
      });
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Feuil1!A:R",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      resource: { values },
    });
    console.log(`✅ Lead ajouté Sheets: ${clientData.nom} [Score: ${score.label}]`);
    return true;
  } catch (error) {
    console.error("❌ Erreur ajout lead Sheets:", error.message);
    return false;
  }
}

const LEADS_FILE = path.join(__dirname, "leads.json");
function saveLeadToFile(clientData, projectData, total) {
  const score = estimateLeadScore(clientData, projectData, total);
  const lead = {
    timestamp: new Date().toISOString(),
    date_fr: new Date().toLocaleString("fr-MA", { timeZone: "Africa/Casablanca" }),
    client: clientData,
    project: projectData,
    amount: total,
    status: "Nouveau",
    lead_score: score,
  };
  let leads = [];
  if (fs.existsSync(LEADS_FILE)) {
    try { leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8")); } catch(e) { leads = []; }
  }
  leads.push(lead);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
  console.log(`✅ Lead sauvegardé localement: ${clientData.nom} [Score: ${score.label}]`);
}

async function notifyLead(clientData, projectData, total) {
  saveLeadToFile(clientData, projectData, total);
  await addLeadToSheet(clientData, projectData, total);
}

// ─────────────────────────────────────────────────────────────────────────────
//  LEAD QUALITY SCORING
// ─────────────────────────────────────────────────────────────────────────────
function estimateLeadScore(clientData, projectData, total) {
  let score = 0;
  const nom = clientData.nom || "";
  const tel = clientData.telephone || "";
  const email = clientData.email || "";

  // Completeness
  if (nom.trim().length > 2) score += 20;
  if (/^(\+212|0)[0-9]{9,}$/.test(tel.replace(/[\s\-]/g, ""))) score += 25;
  if (email && email !== "non fourni" && /@/.test(email)) score += 10;
  if (projectData.city) score += 10;
  if (projectData.surface) score += 10;
  if (projectData.type) score += 10;

  // Budget quality
  const amt = parseFloat(String(total).replace(/[^0-9.]/g, "")) || 0;
  if (amt > 500000) score += 10;
  if (amt > 1000000) score += 5;

  let label = "Froid";
  if (score >= 70) label = "Chaud 🔥";
  else if (score >= 45) label = "Tiède 🌡️";
  return { score, label };
}

function validateLead(clientData) {
  const errors = [];
  const nom = (clientData.nom || "").trim();
  const tel = (clientData.telephone || "").trim();
  if (nom.length < 2) errors.push("nom invalide");
  if (!/[0-9]{8,}/.test(tel.replace(/[\s\-+]/g, ""))) errors.push("téléphone invalide");
  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PRICING ENGINE (unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────
const PRICES = {
  etudes: 60,
  grosOeuvreHourdis: 1200,
  grosOeuvrePostTension: 1600,
  murCloture: 400,
  finition: 3000,
  renovation: 6000,
  etancheite: {
    terrasse: 365,
    sdb: 90,
    piscine: 120,
    voile: 160
  },
  piscine: 3500,
  marge: 0.15
};

function calculerDevis(projet) {
  let sousTotal = 0;
  let details = [];

  if (projet.type === "Études de projet" && projet.surface) {
    const cout = projet.surface * PRICES.etudes;
    details.push(`📐 Études de projet : ${projet.surface} m² × ${PRICES.etudes} DH = ${fmt(cout)} DH`);
    sousTotal += cout;
  }
  if (projet.type === "Construction" && projet.surface) {
    const goPrice = projet.postTension ? PRICES.grosOeuvrePostTension : PRICES.grosOeuvreHourdis;
    const coutGO = projet.surface * goPrice;
    details.push(`🏗️ Gros œuvre (${projet.postTension ? "post-tension" : "hourdis"}) : ${projet.surface} m² × ${goPrice} DH = ${fmt(coutGO)} DH`);
    sousTotal += coutGO;
    const coutFinition = projet.surface * PRICES.finition;
    details.push(`🎨 Finition : ${projet.surface} m² × ${PRICES.finition} DH = ${fmt(coutFinition)} DH`);
    sousTotal += coutFinition;
  }
  if (projet.type === "Rénovation" && projet.surface) {
    const cout = projet.surface * PRICES.renovation;
    details.push(`🔄 Rénovation : ${projet.surface} m² × ${PRICES.renovation} DH = ${fmt(cout)} DH`);
    sousTotal += cout;
  }
  if (projet.type === "Finition" && projet.surface) {
    const cout = projet.surface * PRICES.finition;
    details.push(`🎨 Finition : ${projet.surface} m² × ${PRICES.finition} DH = ${fmt(cout)} DH`);
    sousTotal += cout;
  }
  if (projet.type === "Étanchéité") {
    const type = projet.etancheiteType || "terrasse";
    let prix = PRICES.etancheite[type] || PRICES.etancheite.terrasse;
    let unite = (type === "voile") ? "m" : "m²";
    const cout = (projet.surface || 0) * prix;
    details.push(`💧 Étanchéité ${type} : ${projet.surface || 0} ${unite} × ${prix} DH = ${fmt(cout)} DH`);
    sousTotal += cout;
  }
  if (projet.type === "Piscine clés en main" && projet.piscineSurface) {
    const cout = projet.piscineSurface * PRICES.piscine;
    details.push(`🏊 Piscine clés en main : ${projet.piscineSurface} m² × ${PRICES.piscine} DH = ${fmt(cout)} DH`);
    sousTotal += cout;
  }
  if (projet.type === "Mur de clôture" && projet.clotureLength) {
    const cout = projet.clotureLength * PRICES.murCloture;
    details.push(`🧱 Mur de clôture : ${projet.clotureLength} m × ${PRICES.murCloture} DH = ${fmt(cout)} DH`);
    sousTotal += cout;
  }
  // Pool option (separate surface, NEVER reuse building surface)
  if (projet.pool && projet.type !== "Piscine clés en main" && projet.poolSurface) {
    const cout = projet.poolSurface * PRICES.piscine;
    details.push(`🏊 Option piscine : ${projet.poolSurface} m² × ${PRICES.piscine} DH = ${fmt(cout)} DH`);
    sousTotal += cout;
  }

  const marge = sousTotal * PRICES.marge;
  const total = sousTotal + marge;
  return { sousTotal, marge, total, details };
}

// Format numbers with spaces as thousands separator (Moroccan style)
// Format numbers with spaces as thousands separator (Moroccan style: 1 094 800)
function fmt(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
}

// ─────────────────────────────────────────────────────────────────────────────
//  GLOBAL INTENT SYSTEM
// ─────────────────────────────────────────────────────────────────────────────
const GREETINGS = /^(bonjour|bonsoir|salut|salam|hello|hi|ahlan|coucou|hey|yo)\b/i;

const INTENT_MAP = [
  { intent: "menu",       pattern: /\b(menu|accueil|retour accueil|recommencer|annuler|stop|début|debut|home)\b/i },
  { intent: "devis",      pattern: /\b(devis|estimation|estimer|prix|tarif|coût|cout|quote)\b/i },
  { intent: "services",   pattern: /\b(service|services|offre|prestations|spécialité)\b/i },
  { intent: "rdv",        pattern: /\b(rendez-vous|rdv|rendezvous|appointment|visite|rencontre)\b/i },
  { intent: "projets",    pattern: /\b(projets|réalisations|portfolio|references|exemples)\b/i },
  { intent: "conseiller", pattern: /\b(conseiller|agent|commercial|humain|parler à|appel|téléphone|contact)\b/i },
  { intent: "specialites",  pattern: /\b(spécialités|specialites|specialité|specialite|nos spécialités)\b/i },
];

function detectIntent(text) {
  const t = text.trim();
  if (GREETINGS.test(t)) return "greeting";
  for (const { intent, pattern } of INTENT_MAP) {
    if (pattern.test(t)) return intent;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  CONTEXTUAL ENTITY EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────
const CITIES = [
  "casablanca","rabat","marrakech","tanger","fès","fes","meknès","meknes",
  "agadir","oujda","témara","temara","salé","sale","mohammedia","kenitra",
  "berrechid","settat","benslimane","el jadida","laayoune","dakhla"
];

const PROJECT_TYPES = [
  { pattern: /\b(villa|maison|résidence|residence|habitation|domicile)\b/i, type: "Construction" },
  { pattern: /\b(immeuble|résidentiel|appartement|batiment|bâtiment)\b/i, type: "Construction" },
  { pattern: /\b(renovation|rénovation|rénover|refaire|moderniser)\b/i, type: "Rénovation" },
  { pattern: /\b(finition|peinture|carrelage|enduit|revêtement)\b/i, type: "Finition" },
  { pattern: /\b(etancheite|étanchéité|étanche|fuite|imperméable)\b/i, type: "Étanchéité" },
  { pattern: /\b(piscine)\b/i, type: "Piscine clés en main" },
  { pattern: /\b(cloture|clôture|mur de cloture|mur périphérique|enceinte)\b/i, type: "Mur de clôture" },
  { pattern: /\b(etude|étude|plan|plans|architecte|permis)\b/i, type: "Études de projet" },
];

function extractSurface(text) {
  // Try with unit first
  let m = text.match(/(\d+(?:[.,]\d+)?)\s*m[²2]?/i);
  if (m) return parseFloat(m[1].replace(",", "."));
  // Natural phrasing: "environ 450", "je pense 600", "autour de 300"
  m = text.match(/(?:environ|autour|vers|à peu près|je pense|peut-être|approximately|around)\s+(\d{2,4})\b/i);
  if (m) return parseFloat(m[1]);
  // Last resort: lone 2-4 digit number
  m = text.match(/\b(\d{2,4})\b/);
  if (m) {
    const n = parseFloat(m[1]);
    if (n >= 10 && n <= 9999) return n;
  }
  return null;
}

function extractPoolSurface(text) {
  // Explicit pool size
  let m = text.match(/piscine[^0-9]*(\d+)\s*m[²2]?/i);
  if (m) return parseFloat(m[1]);
  m = text.match(/(\d+)\s*m[²2]?\s*(?:de\s+)?piscine/i);
  if (m) return parseFloat(m[1]);
  return null;
}

function extractProjectFromMessage(text) {
  const data = {};

  // Surface
  const surf = extractSurface(text);
  if (surf) data.surface = surf;

  // City
  for (const c of CITIES) {
    if (text.toLowerCase().includes(c)) {
      data.city = c.charAt(0).toUpperCase() + c.slice(1);
      break;
    }
  }

  // Project type
  for (const { pattern, type } of PROJECT_TYPES) {
    if (pattern.test(text)) {
      data.type = type;
      break;
    }
  }

  // Pool as extra (when construction)
  if (/\bpiscine\b/i.test(text) && data.type && data.type !== "Piscine clés en main") {
    data.pool = true;
    const ps = extractPoolSurface(text);
    data.poolSurface = ps || null; // null = need to ask
  }

  // Additional flags
  if (/\bsous-sol\b/i.test(text)) data.basement = true;
  if (/\bpost.?tension\b/i.test(text)) data.postTension = true;
  if (/\b(sdb|salle de bain|salle d'eau)\b/i.test(text) && data.type === "Étanchéité") data.etancheiteType = "sdb";
  if (/\bvoile\b/i.test(text) && data.type === "Étanchéité") data.etancheiteType = "voile";

  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SESSION MANAGEMENT (with inactivity cleanup)
// ─────────────────────────────────────────────────────────────────────────────
const sessions = {};
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = createFreshSession();
  }
  sessions[id].lastActivity = Date.now();
  return sessions[id];
}

function createFreshSession() {
  return {
    flow: null,       // "devis" | "contact" | "rdv" | "service_submenu" | "service_detail"
    stage: null,      // stage within the flow
    collectedData: {},
    retryCount: {},   // per-stage retry counters
    lastActivity: Date.now(),
  };
}

function resetSession(id) {
  sessions[id] = createFreshSession();
  return sessions[id];
}

// Cleanup stale sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const id of Object.keys(sessions)) {
    if (now - sessions[id].lastActivity > SESSION_TIMEOUT_MS) {
      delete sessions[id];
      console.log(`🗑️ Session expirée nettoyée: ${id}`);
    }
  }
}, 10 * 60 * 1000);

// ─────────────────────────────────────────────────────────────────────────────
//  CONTENT STRINGS
// ─────────────────────────────────────────────────────────────────────────────
const MAIN_MENU = `Bonjour,
Merci de nous avoir contactés. Nous sommes la société ERPAC. Comment pouvons-nous vous aider ?

1️⃣ Demander un devis
2️⃣ Découvrir nos services
3️⃣ Nos spécialités`;

const SMART_FALLBACK = `Je n'ai pas bien compris 😊

Souhaitez-vous :
1️⃣ Demander un devis
2️⃣ Découvrir nos services
3️⃣ Nos spécialités`;

// ── Option 2: Services page (full catalogue) ──────────────────────────────
const SERVICES_PAGE = `🏗️ *SERVICES ERPAC*

✅ 📐 Études & Conception :
Plans, faisabilité, permis de construire, assistance MOE.

✅ 🏗️ Construction Générale :
Villas, immeubles, plateaux bureaux, cliniques.

✅ 🏗️ Gros Œuvre :
Structure porteuse, fondations, béton armé, charpente.

✅ 🔧 Lots Techniques (Second Œuvre) :
Plomberie, électricité, revêtements, finitions.

✅ 🎨 Aménagement & Décoration :
Design intérieur/extérieur, agencement sur-mesure.

✅ 💧 Étanchéité :
Toitures, terrasses, sous-sols, piscines – garantie 10 ans.

✅ 🏊 Construction de Piscines :
Piscines clés en main (débordement, traditionnelles, intérieures).

✅ 🔄 Rénovation & Réhabilitation :
Rénovation complète ou partielle, mise aux normes.

✅ 🪑 Mobilier sur Mesure :
Conception et fabrication de meubles personnalisés.

✅ 🪚 Menuiserie :
Menuiserie bois, aluminium, PVC – portes, fenêtres, agencements.

✅ 🧱 Cloisonnement & Faux Plafonds :
Cloisons intérieures, doublages, faux plafonds, isolation.

Qualité technique, respect des délais, accompagnement personnalisé.`;

// ── Option 5: Nos spécialités ─────────────────────────────────────────────
const SPECIALITES_MENU = `🔧 Nos spécialités

1️⃣ Villas
2️⃣ Immeubles
3️⃣ Piscines
4️⃣ Rénovation
5️⃣ Locaux commerciaux
6️⃣ Étanchéité

Tapez le numéro ou "menu" pour revenir`;

const SPECIALITES_DETAIL = {
  "1": `🏡 Villas :
Construction de villas modernes et haut standing :
• Gros œuvre
• Finition premium
• Piscines
• Étanchéité
• Domotique
• Aménagement extérieur`,

  "2": `🏢 Immeubles :
Construction résidentielle et professionnelle :
• R+2 à R+5
• Béton armé
• Plateaux bureaux
• Ascenseurs
• Étanchéité
• Parties communes`,

  "3": `🏊 Piscines :
Piscines clés en main :
• Débordement
• Traditionnelles
• Intérieures
• Filtration
• Revêtement premium`,

  "4": `🔄 Rénovation :
Rénovation complète ou partielle :
• Villas
• Appartements
• Locaux commerciaux
• Mise aux normes
• Modernisation`,

  "5": `🏬 Locaux commerciaux :
Aménagement professionnel :
• Boutiques
• Restaurants
• Plateaux bureaux
• Cliniques
• Espaces professionnels`,

  "6": `💧 Étanchéité :
Solutions professionnelles :
• Toitures
• Terrasses
• Sous-sols
• Piscines
• Voiles béton
• Garantie 10 ans`,
};

const SPECIALITES_FOLLOW_UP = `\n\nSouhaitez-vous une estimation ou un rendez-vous ?`;

function getServicesSubmenu() {
  return SPECIALITES_MENU;
}

// ─────────────────────────────────────────────────────────────────────────────
//  DEVIS FLOW — exact step-by-step state machine per scenario spec
// ─────────────────────────────────────────────────────────────────────────────

function startDevis(sess, prefilled = {}) {
  sess.flow = "devis";
  sess.collectedData = { ...prefilled };
  sess.retryCount = {};

  // If we can infer type from prefilled free-text, skip straight to the right stage
  return advanceDevis(sess);
}

// ── STAGE ROUTER ──────────────────────────────────────────────────────────────
// Each type has its own ordered pipeline of stages. advanceDevis always moves
// to the first stage that still needs an answer.
function advanceDevis(sess) {
  const d = sess.collectedData;

  // ── Stage 1: service type ───────────────────────────────────────────────
  if (!d.type) {
    sess.stage = "type";
    return `Très bien. Pour préparer une estimation correcte, décrivez-moi votre projet.\n\nQuel est le type de service souhaité ?\n\n1️⃣ Construction / Gros œuvre\n2️⃣ Finition\n3️⃣ Rénovation\n4️⃣ Étanchéité\n5️⃣ Piscine clés en main\n6️⃣ Mur de clôture\n7️⃣ Études de projet`;
  }

  // ── Type-specific pipelines ─────────────────────────────────────────────

  // CONSTRUCTION pipeline
  if (d.type === "Construction") {
    if (!d.city)          { sess.stage = "city";         return `Parfait 👌\nDans quelle ville se situe le projet ?`; }
    if (!d.surface)       { sess.stage = "surface";       return `Quelle est la surface couverte approximative en m² ?`; }
    if (!d.structure)     { sess.stage = "structure";     return `Quel type de structure souhaitez-vous pour le gros œuvre ?\n\n1️⃣ Hourdis\n2️⃣ Post-tension`; }
    if (d.withFinition === undefined) { sess.stage = "finition_yn"; return `Souhaitez-vous inclure la finition complète ?\n\n1️⃣ Oui\n2️⃣ Non`; }
    if (d.pool === undefined)         { sess.stage = "pool_yn";     return `Avez-vous une piscine dans le projet ?\n\n1️⃣ Oui\n2️⃣ Non`; }
    if (d.pool && !d.poolDimensions)  { sess.stage = "pool_dims";   return `Parfait 👌\nMerci de renseigner les dimensions approximatives de la piscine.\n\n📏 Longueur :\n📏 Largeur :\n\nExemple : 8m × 4m`; }
    if (d.withMarge === undefined)    { sess.stage = "marge_yn";    return `Souhaitez-vous inclure les matériaux et la marge ERPAC 15% dans l'estimation ?\n\n1️⃣ Oui\n2️⃣ Non`; }
    if (!d.plans)         { sess.stage = "plans";         return `Avez-vous des plans, photos ou autorisation ?\n\n1️⃣ Oui\n2️⃣ Non`; }
    if (!d.delai)         { sess.stage = "delai";         return `Quand souhaitez-vous commencer les travaux ?`; }
    return computeAndShowDevis(sess);
  }

  // FINITION pipeline
  if (d.type === "Finition") {
    if (!d.surface)   { sess.stage = "surface";   return `Très bien 👌\nQuelle est la surface concernée ?`; }
    if (!d.standing)  { sess.stage = "standing";  return `Quel niveau de finition souhaitez-vous ?\n\n1️⃣ Standard\n2️⃣ Moyen standing\n3️⃣ Haut standing`; }
    if (!d.finitionDetails) {
      sess.stage = "finition_details";
      return `Souhaitez-vous inclure :\n\n• peinture\n• faux plafond\n• menuiserie\n• carrelage\n• cuisine\n• salles de bain ?`;
    }
    return computeAndShowDevis(sess);
  }

  // RÉNOVATION pipeline
  if (d.type === "Rénovation") {
    if (!d.city)          { sess.stage = "city";          return `Parfait 👌\nDans quelle ville se situe le projet ?`; }
    if (!d.surface)       { sess.stage = "surface";       return `Quelle est la surface à rénover ?`; }
    if (!d.renovationType){ sess.stage = "renov_type";    return `Quel type de rénovation souhaitez-vous ?\n\n1️⃣ Légère\n2️⃣ Complète`; }
    return computeAndShowDevis(sess);
  }

  // ÉTANCHÉITÉ pipeline
  if (d.type === "Étanchéité") {
    if (!d.etancheiteType) { sess.stage = "etanch_type"; return `Très bien 👌\nQuel type d'étanchéité ?\n\n1️⃣ Terrasse\n2️⃣ Salle de bain\n3️⃣ Piscine\n4️⃣ Voile béton`; }
    if (!d.surface)        { sess.stage = "surface";      return `Quelle est la surface de la ${d.etancheiteType} ?`; }
    return computeAndShowDevis(sess);
  }

  // PISCINE pipeline
  if (d.type === "Piscine clés en main") {
    if (!d.poolDimensions) {
      sess.stage = "pool_dims";
      return `Parfait 👌\nMerci de renseigner les dimensions approximatives.\n\n📏 Longueur ?\n📏 Largeur ?`;
    }
    return computeAndShowDevis(sess);
  }

  // MUR DE CLÔTURE pipeline
  if (d.type === "Mur de clôture") {
    if (!d.clotureLength) { sess.stage = "cloture_length"; return `Très bien 👌\nQuelle est la longueur approximative du mur ?`; }
    return computeAndShowDevis(sess);
  }

  // ÉTUDES DE PROJET pipeline
  if (d.type === "Études de projet") {
    if (!d.surface) { sess.stage = "surface"; return `Parfait 👌\nQuelle est la surface couverte approximative ?`; }
    return computeAndShowDevis(sess);
  }

  return computeAndShowDevis(sess);
}

// ── INPUT PROCESSOR ───────────────────────────────────────────────────────────
function processDevisInput(sess, msg) {
  const stage = sess.stage;
  const d = sess.collectedData;
  const t = msg.trim();
  const lo = t.toLowerCase();

  // ── type ──────────────────────────────────────────────────────────────────
  if (stage === "type") {
    // Try numbered shortcut first (clean single char)
    const map = { "1": "Construction", "2": "Finition", "3": "Rénovation",
                  "4": "Étanchéité",   "5": "Piscine clés en main",
                  "6": "Mur de clôture", "7": "Études de projet" };
    let detected = map[t] || detectProjectType(t);

    if (detected) {
      d.type = detected;
      sess.retryCount["type"] = 0;

      // Pre-fill sub-flags from free text
      if (detected === "Construction") {
        if (/finition/i.test(t))              d.withFinition = true;
        if (/piscine/i.test(t))               d.pool = true;
        if (/post.?tension/i.test(t))         d.structure = "Post-tension";
        else if (/hourdis/i.test(t))          d.structure = "Hourdis";
      }
      if (detected === "Étanchéité") {
        if (/terrasse/i.test(t))              d.etancheiteType = "Terrasse";
        else if (/sdb|salle de bain/i.test(t)) d.etancheiteType = "Salle de bain";
        else if (/voile/i.test(t))            d.etancheiteType = "Voile béton";
        else if (/piscine/i.test(t))          d.etancheiteType = "Piscine";
      }
      // NOTE: Do NOT carry city/surface from this message — it's the type question answer only.
      return advanceDevis(sess);
    }

    sess.retryCount["type"] = (sess.retryCount["type"] || 0) + 1;
    if (sess.retryCount["type"] >= 2) { d.type = "Construction"; return advanceDevis(sess); }
    return `Je n'ai pas reconnu ce type. Choisissez 1 à 7 ou décrivez votre projet.`;
  }

  // ── city ──────────────────────────────────────────────────────────────────
  if (stage === "city") {
    d.city = t;
    return advanceDevis(sess);
  }

  // ── surface ───────────────────────────────────────────────────────────────
  if (stage === "surface") {
    const surf = extractSurface(t);
    if (surf && surf >= 1 && surf <= 99999) {
      d.surface = surf;
      sess.retryCount["surface"] = 0;
      return advanceDevis(sess);
    }
    sess.retryCount["surface"] = (sess.retryCount["surface"] || 0) + 1;
    if (sess.retryCount["surface"] >= 2) { d.surface = 100; return advanceDevis(sess); }
    return `Je n'ai pas saisi la surface. Entrez un nombre en m² :\nEx: 200, 350m², "environ 400"`;
  }

  // ── structure (hourdis / post-tension) ────────────────────────────────────
  if (stage === "structure") {
    if (t === "1" || /hourdis/i.test(t))       d.structure = "Hourdis";
    else if (t === "2" || /post.?tension/i.test(t)) d.structure = "Post-tension";
    else d.structure = "Hourdis"; // default
    return advanceDevis(sess);
  }

  // ── finition yn ───────────────────────────────────────────────────────────
  if (stage === "finition_yn") {
    d.withFinition = !(t === "2" || /non/i.test(t));
    return advanceDevis(sess);
  }

  // ── pool yn ───────────────────────────────────────────────────────────────
  if (stage === "pool_yn") {
    d.pool = !(t === "2" || /non/i.test(t));
    return advanceDevis(sess);
  }

  // ── pool dimensions ───────────────────────────────────────────────────────
  if (stage === "pool_dims") {
    // Parse "8 × 4", "8x4", "10 × 5", "L:8 l:4", etc.
    const m = t.match(/(\d+(?:[.,]\d+)?)\s*[×xX*par]\s*(\d+(?:[.,]\d+)?)/);
    if (m) {
      const longueur = parseFloat(m[1].replace(",", "."));
      const largeur  = parseFloat(m[2].replace(",", "."));
      d.poolDimensions = { longueur, largeur };
      d.poolSurface = longueur * largeur;
      // If this stage is part of Construction flow, confirm surface and continue
      if (d.type === "Construction") {
        const confirmMsg = `Merci 🙏\n🏊 Surface piscine calculée : ${longueur} × ${largeur} = ${d.poolSurface} m².`;
        // Move to next stage
        const next = advanceDevis(sess);
        return confirmMsg + "\n\n" + next;
      }
      // Standalone piscine flow → go straight to estimate
      return advanceDevis(sess);
    }
    // Try single number (surface directly)
    const s = extractSurface(t);
    if (s && s >= 1) {
      d.poolSurface = s;
      d.poolDimensions = { longueur: s, largeur: 1 }; // sentinel
      if (d.type === "Construction") {
        const next = advanceDevis(sess);
        return `Merci 🙏\n🏊 Surface piscine calculée : ${s} m².\n\n` + next;
      }
      return advanceDevis(sess);
    }
    return `Merci de saisir les dimensions sous la forme longueur × largeur.\nExemple : 8 × 4`;
  }

  // ── marge yn ──────────────────────────────────────────────────────────────
  if (stage === "marge_yn") {
    d.withMarge = !(t === "2" || /non/i.test(t));
    return advanceDevis(sess);
  }

  // ── plans ─────────────────────────────────────────────────────────────────
  if (stage === "plans") {
    d.plans = t;
    return advanceDevis(sess);
  }

  // ── delai ─────────────────────────────────────────────────────────────────
  if (stage === "delai") {
    d.delai = t;
    return advanceDevis(sess);
  }

  // ── finition details (inclure éléments) ───────────────────────────────────
  if (stage === "finition_details") {
    d.finitionDetails = t;
    return advanceDevis(sess);
  }

  // ── standing ──────────────────────────────────────────────────────────────
  if (stage === "standing") {
    if (t === "1" || /standard/i.test(t))       d.standing = "Standard";
    else if (t === "2" || /moyen/i.test(t))      d.standing = "Moyen standing";
    else if (t === "3" || /haut/i.test(t))       d.standing = "Haut standing";
    else d.standing = "Standard";
    return advanceDevis(sess);
  }

  // ── renov type ────────────────────────────────────────────────────────────
  if (stage === "renov_type") {
    if (t === "1" || /légère|legere/i.test(t))   d.renovationType = "Légère";
    else if (t === "2" || /complète|complete/i.test(t)) d.renovationType = "Complète";
    else d.renovationType = "Complète";
    return advanceDevis(sess);
  }

  // ── etanch type ───────────────────────────────────────────────────────────
  if (stage === "etanch_type") {
    // Detect type from direct input or free-text message
    if (t === "1" || /terrasse/i.test(t))           d.etancheiteType = "Terrasse";
    else if (t === "2" || /sdb|salle de bain/i.test(t)) d.etancheiteType = "Salle de bain";
    else if (t === "3" || /piscine/i.test(t))        d.etancheiteType = "Piscine";
    else if (t === "4" || /voile/i.test(t))          d.etancheiteType = "Voile béton";
    else d.etancheiteType = "Terrasse";
    return advanceDevis(sess);
  }

  // ── cloture length ────────────────────────────────────────────────────────
  if (stage === "cloture_length") {
    const len = extractSurface(t);
    if (len && len >= 1) { d.clotureLength = len; return advanceDevis(sess); }
    return `Longueur en mètres ? (ex: 45, 80m)`;
  }

  // ── post-estimate actions ─────────────────────────────────────────────────
  if (stage === "result") {
    return handleDevisResult(sess, t);
  }

  return null;
}

function detectProjectType(text) {
  const t = text.toLowerCase().trim();

  // ── Specific types FIRST (before generic "construction/villa") ───────────
  if (/rénov|renov|réhabilit/.test(t))                    return "Rénovation";
  if (/étanchéit|etancheit/.test(t))                      return "Étanchéité";
  if (/piscine/.test(t) && !/construction|villa|maison/.test(t)) return "Piscine clés en main";
  if (/clôture|cloture/.test(t))                          return "Mur de clôture";
  if (/étude|etude|architecte|permis/.test(t))            return "Études de projet";

  // Finition: explicit "finition" word, NOT combined with construction keywords
  if (/finition|finitions|finir/.test(t) && !/construction|gros.?oeuvre|gros.?œuvre/.test(t)) return "Finition";

  // Construction (generic: villa, maison, immeuble, construction, gros œuvre)
  if (/construction|construire|gros.?oeuvre|gros.?œuvre|villa|maison|immeuble/.test(t)) return "Construction";

  // PROJECT_TYPES patterns as fallback
  for (const { pattern, type } of PROJECT_TYPES) {
    if (pattern.test(text)) return type;
  }

  // Numbered
  const map = { "1": "Construction", "2": "Finition", "3": "Rénovation",
                "4": "Étanchéité",   "5": "Piscine clés en main",
                "6": "Mur de clôture", "7": "Études de projet" };
  return map[t] || null;
}

// ── RECAP + ESTIMATE ──────────────────────────────────────────────────────────
function computeAndShowDevis(sess) {
  const d = sess.collectedData;
  sess.stage = "result";

  // ── Build pricing ─────────────────────────────────────────────────────────
  let lines = [];
  let sousTotal = 0;
  let idx = 1;

  if (d.type === "Construction") {
    const goPrice = (d.structure === "Post-tension") ? PRICES.grosOeuvrePostTension : PRICES.grosOeuvreHourdis;
    const goLabel = (d.structure === "Post-tension") ? "post-tension" : "hourdis";
    const goAmt   = d.surface * goPrice;
    lines.push(`${idx++}️⃣ Gros œuvre ${goLabel}\n${d.surface} × ${fmt(goPrice)} DH = ${fmt(goAmt)} DH`);
    sousTotal += goAmt;

    if (d.withFinition !== false) {
      const finAmt = d.surface * PRICES.finition;
      lines.push(`${idx++}️⃣ Finition complète\n${d.surface} × ${fmt(PRICES.finition)} DH = ${fmt(finAmt)} DH`);
      sousTotal += finAmt;
    }

    if (d.pool && d.poolSurface) {
      const piscineAmt = d.poolSurface * PRICES.piscine;
      lines.push(`${idx++}️⃣ Piscine clés en main\n${d.poolSurface} × ${fmt(PRICES.piscine)} DH = ${fmt(piscineAmt)} DH`);
      sousTotal += piscineAmt;
    }
  }

  if (d.type === "Finition") {
    const amt = d.surface * PRICES.finition;
    lines.push(`🎨 Finition complète :\n${d.surface} × ${fmt(PRICES.finition)} = ${fmt(amt)} DH`);
    sousTotal += amt;
  }

  if (d.type === "Rénovation") {
    const amt = d.surface * PRICES.renovation;
    lines.push(`🛠️ Rénovation complète :\n${d.surface} × ${fmt(PRICES.renovation)} = ${fmt(amt)} DH`);
    sousTotal += amt;
  }

  if (d.type === "Étanchéité") {
    const typeKey = (d.etancheiteType || "Terrasse").toLowerCase().replace(" ", "");
    const priceMap = { terrasse: 365, salledebain: 90, piscine: 120, voilebéton: 160, voile: 160 };
    const prix = priceMap[typeKey] || 365;
    const label = d.etancheiteType || "Terrasse";
    const amt = d.surface * prix;
    lines.push(`💧 Étanchéité ${label.toLowerCase()} :\n${d.surface} × ${prix} = ${fmt(amt)} DH`);
    sousTotal += amt;
  }

  if (d.type === "Piscine clés en main") {
    const surf = d.poolSurface || d.surface;
    const amt  = surf * PRICES.piscine;
    lines.push(`🏊 Piscine clés en main :\n${surf} × ${fmt(PRICES.piscine)} = ${fmt(amt)} DH`);
    sousTotal += amt;
  }

  if (d.type === "Mur de clôture") {
    const amt = d.clotureLength * PRICES.murCloture;
    lines.push(`🧱 Mur de clôture :\n${d.clotureLength} × ${PRICES.murCloture} = ${fmt(amt)} DH`);
    sousTotal += amt;
  }

  if (d.type === "Études de projet") {
    const amt = d.surface * PRICES.etudes;
    lines.push(`📐 Étude de projet :\n${d.surface} × ${PRICES.etudes} = ${fmt(amt)} DH`);
    sousTotal += amt;
  }

  const includeMarge = (d.withMarge !== false);
  const marge = includeMarge ? Math.round(sousTotal * PRICES.marge) : 0;
  const total = sousTotal + marge;
  d.estimate_total = total;

  // ── Build recap (Construction only — full recap per spec) ─────────────────
  let recap = "";
  if (d.type === "Construction") {
    const poolDim = d.poolDimensions
      ? `${d.poolDimensions.longueur}m × ${d.poolDimensions.largeur}m = ${d.poolSurface} m²`
      : (d.poolSurface ? `${d.poolSurface} m²` : "Non");
    recap = `Merci 🙏 Je récapitule votre demande :\n\n` +
      `📌 Type de projet : Construction villa avec finition${d.pool ? " et piscine" : ""}\n` +
      `📍 Ville : ${d.city || ""}\n` +
      `📐 Surface couverte : ${d.surface} m²\n` +
      `🏗️ Structure : Gros œuvre ${d.structure || "hourdis"}\n` +
      `🎨 Finition : ${d.withFinition !== false ? "Oui" : "Non"}\n` +
      (d.pool ? `🏊 Piscine : ${poolDim}\n` : "") +
      `📦 Matériaux + marge ERPAC : ${includeMarge ? "Oui" : "Non"}\n` +
      `📎 Plans : ${d.plans || "Non"}\n` +
      `🗓️ Démarrage souhaité : ${d.delai || "Non précisé"}\n\n` +
      `Je vais maintenant préparer une estimation approximative.\n\n`;
  }

  // ── Build estimate block ──────────────────────────────────────────────────
  let est = `📊 Estimation ERPAC\n\n`;
  est += lines.join("\n\n") + "\n\n";
  est += `━━━━━━━━━━━━━━━\n\n`;

  if (includeMarge && lines.length > 1) {
    est += `Sous-total :\n${lines.map(() => "").join(" + ")}${fmt(sousTotal)} DH\n\n`;
    est += `Marge ERPAC 15% :\n${fmt(sousTotal)} × 15% = ${fmt(marge)} DH\n\n`;
    est += `━━━━━━━━━━━━━━━\n\n`;
  }

  est += `💰 Total estimatif : ${fmt(total)} DH\n\n`;

  // Type-specific disclaimer
  const disclaimers = {
    "Construction":        `⚠️ Ce devis est une estimation approximative. Le prix final sera confirmé après visite technique, étude des plans, choix des matériaux et contraintes du chantier.`,
    "Finition":            `⚠️ Le prix final dépendra des matériaux choisis.`,
    "Rénovation":          `⚠️ Le prix peut varier selon l'état du bien.`,
    "Étanchéité":          `⚠️ Une visite technique peut être nécessaire avant validation.`,
    "Piscine clés en main":`⚠️ Le prix final dépendra du revêtement et des équipements choisis.`,
    "Mur de clôture":      `⚠️ Le prix peut varier selon la hauteur et la finition du mur.`,
    "Études de projet":    `⚠️ L'étude finale dépendra des plans architecturaux et techniques.`,
  };
  est += (disclaimers[d.type] || `⚠️ Estimation approximative, confirmée après visite technique.`) + "\n\n";
  est += `Souhaitez-vous :\n1️⃣ Être contacté par un conseiller\n2️⃣ Envoyer des photos/plans\n3️⃣ Faire une autre estimation\n4️⃣ Retour menu`;

  return recap + est;
}

function handleDevisResult(sess, msg, sessionId) {
  const opt = msg.trim().toLowerCase();
  if (opt === "1" || /contact|conseiller|rappel|appel/i.test(msg)) {
    return startContactCollection(sess, "devis");
  }
  if (opt === "2" || /photo|plan/i.test(msg)) {
    return `📎 Envoyez vos photos ou plans ici (WhatsApp). Un conseiller les étudiera rapidement.\n\nSouhaitez-vous laisser vos coordonnées ? (Oui/Non)`;
  }
  if (opt === "3" || /autre|nouvelle estimation|recommencer|modifier/i.test(msg)) {
    return startDevis(sess, {});
  }
  if (opt === "4" || /menu|accueil/i.test(msg)) {
    return null; // triggers menu reset in caller
  }
  if (/oui|yes/i.test(msg)) {
    return startContactCollection(sess, "devis");
  }
  return `Répondez 1, 2, 3 ou 4 😊`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  CONTACT COLLECTION FLOW
// ─────────────────────────────────────────────────────────────────────────────
function startContactCollection(sess, origin) {
  sess.flow = "contact";
  sess.stage = "nom";
  sess.collectedData.contact_origin = origin;
  sess.collectedData.contact = {};
  return `Pour qu'un conseiller vous contacte :\n\n👤 Votre nom complet ?`;
}

function processContactInput(sess, msg, sessionId) {
  const stage = sess.stage;
  const contact = sess.collectedData.contact || {};
  sess.collectedData.contact = contact;

  if (stage === "nom") {
    if (msg.trim().length < 2) return `Votre nom complet s'il vous plaît 😊`;
    contact.nom = msg.trim();
    sess.stage = "telephone";
    return `📞 Numéro de téléphone ?`;
  }

  if (stage === "telephone") {
    const cleaned = msg.replace(/[\s\-]/g, "");
    if (!/[0-9]{8,}/.test(cleaned)) {
      return `Numéro non valide. Format: 0612345678 ou +212612345678`;
    }
    contact.telephone = msg.trim();
    sess.stage = "email";
    return `📧 Email ? (optionnel, tapez "non" pour ignorer)`;
  }

  if (stage === "email") {
    contact.email = /non|skip|pas|rien/i.test(msg) ? "non fourni" : msg.trim();

    const client = { nom: contact.nom, telephone: contact.telephone, email: contact.email };
    const errors = validateLead(client);
    if (errors.length > 0) {
      return `Problème détecté : ${errors.join(", ")}. Merci de corriger.`;
    }

    const project = {
      type: sess.collectedData.type || "",
      city: sess.collectedData.city || "",
      surface: sess.collectedData.surface || "",
    };
    const total = sess.collectedData.estimate_total || "À définir";
    notifyLead(client, project, total);

    const origin = sess.collectedData.contact_origin || "devis";
    delete sessions[sessionId];

    return `✅ *Merci ${contact.nom} !*\n\nVotre demande a été enregistrée. Un conseiller ERPAC vous contactera sous 24h.\n\n📞 ${contact.telephone}\n\nBonne journée ! 😊`;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  RDV FLOW
// ─────────────────────────────────────────────────────────────────────────────
function startRdv(sess) {
  sess.flow = "rdv";
  sess.stage = "rdv_nom";
  sess.collectedData.rdv = {};
  return `📅 *Prise de rendez-vous*\n\n👤 Votre nom complet ?`;
}

const RDV_STAGES = [
  { stage: "rdv_nom",       field: "nom",         next: "rdv_tel",         prompt: "📞 Numéro de téléphone ?" },
  { stage: "rdv_tel",       field: "telephone",   next: "rdv_ville",       prompt: "📍 Ville du projet ?" },
  { stage: "rdv_ville",     field: "ville",       next: "rdv_type",        prompt: "🏗️ Type de projet ?" },
  { stage: "rdv_type",      field: "type",        next: "rdv_date",        prompt: "📅 Date souhaitée ?" },
  { stage: "rdv_date",      field: "date",        next: "rdv_heure",       prompt: "⏰ Heure souhaitée ?" },
  { stage: "rdv_heure",     field: "heure",       next: "rdv_description", prompt: "📝 Décrivez brièvement votre besoin." },
  { stage: "rdv_description", field: "description", next: "done",         prompt: null },
];

function processRdvInput(sess, msg, sessionId) {
  // Guard: if flow is already done, don't process further
  if (sess.stage === "rdv_done") return null;

  const currentStageConfig = RDV_STAGES.find(s => s.stage === sess.stage);
  if (!currentStageConfig) return null;

  const rdv = sess.collectedData.rdv || {};
  sess.collectedData.rdv = rdv;
  rdv[currentStageConfig.field] = msg.trim();

  if (currentStageConfig.next === "done") {
    const client = { nom: rdv.nom, telephone: rdv.telephone, email: "" };
    const project = { type: rdv.type, city: rdv.ville, surface: "" };
    notifyLead(client, project, "RDV");

    const recap = `✅ *Rendez-vous enregistré !*\n\n👤 ${rdv.nom}\n📞 ${rdv.telephone}\n📍 ${rdv.ville}\n🏗️ ${rdv.type}\n📅 ${rdv.date} à ${rdv.heure}\n📝 ${rdv.description}\n\nUn conseiller vous contactera pour confirmer 😊\n\nTapez "menu" pour revenir à l'accueil.`;

    // Mark done before deleting — prevents any re-entry
    sess.stage = "rdv_done";
    sess.flow = null;
    // Safe reset: clear rdv data but keep session alive for the "menu" reply
    sess.collectedData = {};
    return recap;
  }

  sess.stage = currentStageConfig.next;
  const nextConfig = RDV_STAGES.find(s => s.stage === currentStageConfig.next);
  return nextConfig ? nextConfig.prompt : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SMART INTERRUPTION HANDLER
//  Called before any flow-specific logic — handles global intents at any stage
// ─────────────────────────────────────────────────────────────────────────────
function handleGlobalIntent(intent, sess, sessionId) {
  switch (intent) {
    case "greeting":
      // If in a flow, acknowledge and continue
      if (sess.flow) {
        return `Bonjour ! 😊 Continuons — ` + resumeCurrentStep(sess);
      }
      return MAIN_MENU;

    case "menu":
      resetSession(sessionId);
      return MAIN_MENU;

    case "devis":
      // Switch to devis flow, preserving already-extracted data
      const extracted = sess.collectedData || {};
      resetSession(sessionId);
      const newSess = getSession(sessionId);
      return startDevis(newSess, extracted);

    case "rdv":
      resetSession(sessionId);
      return startRdv(getSession(sessionId));

    case "services":
      resetSession(sessionId);
      return SERVICES_PAGE;

    case "specialites":
      resetSession(sessionId);
      const sp = getSession(sessionId);
      sp.flow = "specialites";
      sp.stage = "specialites_selection";
      return SPECIALITES_MENU;

    case "conseiller":
      resetSession(sessionId);
      return startContactCollection(getSession(sessionId), "direct");

    case "aide":
      return SMART_FALLBACK;

    default:
      return null;
  }
}

function resumeCurrentStep(sess) {
  if (sess.flow === "devis") return advanceDevis(sess);
  if (sess.flow === "rdv") {
    const cfg = RDV_STAGES.find(s => s.stage === sess.stage);
    return cfg ? cfg.prompt : MAIN_MENU;
  }
  return MAIN_MENU;
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN PROCESS MESSAGE
// ─────────────────────────────────────────────────────────────────────────────
function processMessage(sessionId, raw) {
  if (!raw || !raw.trim()) return { reply: MAIN_MENU, next_step: "menu" };
  const msg = raw.trim();
  const sess = getSession(sessionId);
  sess.id = sessionId;

  // 1. Global intent detection (works at ANY step)
  const intent = detectIntent(msg);
  if (intent && !(intent === "greeting" && !sess.flow)) {
    // For greetings without active flow → fall through to menu logic
    if (intent !== "greeting" || sess.flow) {
      const intentReply = handleGlobalIntent(intent, sess, sessionId);
      if (intentReply) return { reply: intentReply, next_step: intent };
    }
  }

  // 2. Active flow routing
  if (sess.flow === "devis") {
    // Auto-extract entities from free text before processing step
    if (sess.stage && ["type", "surface", "city", "description"].includes(sess.stage)) {
      const extracted = extractProjectFromMessage(msg);
      // Pre-fill missing fields from free-text entity extraction
      if (!sess.collectedData.type && extracted.type) sess.collectedData.type = extracted.type;
      if (!sess.collectedData.city && extracted.city) sess.collectedData.city = extracted.city;
    }
    const reply = processDevisInput(sess, msg);
    if (reply === null) {
      // User chose menu from result step
      resetSession(sessionId);
      return { reply: MAIN_MENU, next_step: "menu" };
    }
    if (reply) return { reply, next_step: `devis_${sess.stage}` };
  }

  if (sess.flow === "contact") {
    const reply = processContactInput(sess, msg, sessionId);
    if (reply) return { reply, next_step: "contact" };
  }

  if (sess.flow === "rdv") {
    const reply = processRdvInput(sess, msg, sessionId);
    if (reply) return { reply, next_step: "rdv" };
    // rdv_done or null falls through to menu
  }

  // ── Spécialités flow (option 5) ──────────────────────────────────────────
  if (sess.flow === "specialites") {
    if (sess.stage === "specialites_selection") {
      const key = msg.trim();
      const detail = SPECIALITES_DETAIL[key];
      if (detail) {
        sess.stage = "specialites_followup";
        sess.collectedData.lastSpecialite = key;
        return { reply: detail + SPECIALITES_FOLLOW_UP, next_step: "specialites_followup" };
      }
      return { reply: `Tapez 1 à 6 ou "menu" pour revenir 😊`, next_step: "specialites_selection" };
    }
    if (sess.stage === "specialites_followup") {
      const opt = msg.toLowerCase();
      if (/devis|estimation|prix/i.test(opt) || opt === "1") {
        resetSession(sessionId);
        return { reply: startDevis(getSession(sessionId)), next_step: "devis" };
      }
      if (/rdv|rendez|visite/i.test(opt) || opt === "2") {
        resetSession(sessionId);
        return { reply: startRdv(getSession(sessionId)), next_step: "rdv" };
      }
      if (/oui|yes|ok/i.test(opt)) {
        resetSession(sessionId);
        return { reply: startDevis(getSession(sessionId)), next_step: "devis" };
      }
      resetSession(sessionId);
      return { reply: MAIN_MENU, next_step: "menu" };
    }
  }

  // ── Services page (option 2) ─────────────────────────────────────────────
  // No sub-flow needed: services page is a static display, then fallback to menu
  if (sess.flow === "services_page") {
    resetSession(sessionId);
    return { reply: MAIN_MENU, next_step: "menu" };
  }

  // Legacy: kept for safety during any stale sessions
  if (sess.flow === "service_submenu") {
    const key = msg.trim();
    const detail = SPECIALITES_DETAIL[key];
    if (detail) {
      sess.flow = "specialites";
      sess.stage = "specialites_followup";
      return { reply: detail + SPECIALITES_FOLLOW_UP, next_step: "specialites_followup" };
    }
    return { reply: `Tapez 1 à 6 ou "menu" pour revenir 😊`, next_step: "service_submenu" };
  }

  if (sess.flow === "service_detail") {
    if (/oui|yes|ok|o\b/i.test(msg)) {
      resetSession(sessionId);
      return { reply: startDevis(getSession(sessionId)), next_step: "devis" };
    }
    resetSession(sessionId);
    return { reply: MAIN_MENU, next_step: "menu" };
  }

  // 3. Menu shortcuts
  const lowerMsg = msg.toLowerCase();
  if (lowerMsg === "1" || lowerMsg === "1️⃣") {
    return { reply: startDevis(sess), next_step: "devis" };
  }
  if (lowerMsg === "2" || lowerMsg === "2️⃣") {
    sess.flow = "services_page";
    sess.stage = "services_page";
    return { reply: SERVICES_PAGE, next_step: "services_page" };
  }
  if (lowerMsg === "3" || lowerMsg === "3️⃣" || lowerMsg.includes("spécialités") || lowerMsg.includes("specialites")) {
    sess.flow = "specialites";
    sess.stage = "specialites_selection";
    return { reply: SPECIALITES_MENU, next_step: "specialites" };
  }

  // 4. Free-text project detection ("Villa 300m² Casablanca piscine")
  const extracted = extractProjectFromMessage(msg);
  if (extracted.surface && (extracted.type || extracted.pool)) {
    resetSession(sessionId);
    const newSess = getSession(sessionId);
    return { reply: startDevis(newSess, extracted), next_step: "devis" };
  }

  // 5. Greetings → menu
  if (intent === "greeting" || /^(bonjour|salam|hello|salut|bonsoir)/i.test(msg)) {
    return { reply: MAIN_MENU, next_step: "menu" };
  }

  // 6. Smart fallback
  return { reply: SMART_FALLBACK, next_step: "menu" };
}

// ─────────────────────────────────────────────────────────────────────────────
//  WHATSAPP & WEBHOOKS
// ─────────────────────────────────────────────────────────────────────────────
async function sendWhatsApp(to, text) {
  if (!WA_TOKEN || !WA_PHONE_ID) return;
  if (!text || text.trim() === "") return;
  try {
    const response = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${WA_TOKEN}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
    });
    if (!response.ok) console.error("WA Error:", await response.text());
    else console.log(`✅ Message envoyé à ${to}`);
  } catch (e) { console.error("WhatsApp error:", e); }
}

app.post("/webhook", (req, res) => {
  const { session_id, message } = req.body;
  if (!session_id || !message) return res.status(400).json({ error: "session_id and message required" });
  return res.json(processMessage(session_id, message));
});

app.get("/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === WA_VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

app.post("/webhook/whatsapp", async (req, res) => {
  res.sendStatus(200);
  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== "text") return;
    const { reply } = processMessage(message.from, message.text.body);
    await sendWhatsApp(message.from, reply);
  } catch (e) { console.error("Webhook error:", e); }
});

app.get("/leads", (req, res) => {
  if (fs.existsSync(LEADS_FILE)) {
    const leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
    res.json({ count: leads.length, leads });
  } else {
    res.json({ count: 0, leads: [] });
  }
});

app.get("/sessions", (req, res) => {
  const summary = Object.entries(sessions).map(([id, s]) => ({
    id,
    flow: s.flow,
    stage: s.stage,
    lastActivity: new Date(s.lastActivity).toLocaleString("fr-MA", { timeZone: "Africa/Casablanca" }),
  }));
  res.json({ count: summary.length, sessions: summary });
});

app.get("/health", (_, res) => res.json({ status: "ok", version: "erpac-smart-v4" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🏗️ ERPAC Smart Bot v2 sur le port ${PORT}`);
  await initGoogleSheets();
  console.log(`📝 Leads: ${LEADS_FILE}`);
  console.log(`📊 /leads  |  🔍 /sessions  |  ❤️ /health`);
});
