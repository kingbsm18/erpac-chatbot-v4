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

// ========================= CONFIGURATION =========================
const WA_TOKEN = process.env.WA_TOKEN;
const WA_PHONE_ID = process.env.WA_PHONE_ID;
const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || "erpac_verify";

// ========================= GOOGLE SHEETS =========================
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

async function addLeadToSheet(clientData, projectData, total, scoreLabel) {
  if (!sheets) return false;
  const now = new Date().toLocaleString("fr-MA", { timeZone: "Africa/Casablanca" });
  const values = [[
    now,
    clientData.nom || "",
    clientData.telephone || "",
    clientData.email || "",
    projectData.type || "",
    projectData.city || "",
    projectData.surface || "",
    projectData.pool ? `Oui (${projectData.poolSurface || "?"} m²)` : "Non",
    total,
    scoreLabel,
    "Nouveau"
  ]];
  try {
    try {
      await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "Feuil1!A1:K1" });
    } catch {
      const headers = [[
        "Date/Heure", "Nom", "Téléphone", "Email", "Type Projet", "Ville",
        "Surface (m²)", "Piscine", "Montant TTC", "Score Lead", "Statut"
      ]];
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: "Feuil1!A1:K1",
        valueInputOption: "USER_ENTERED",
        resource: { values: headers },
      });
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Feuil1!A:K",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      resource: { values },
    });
    console.log(`✅ Lead Sheets: ${clientData.nom} (${scoreLabel})`);
    return true;
  } catch (error) {
    console.error("❌ Sheets error:", error.message);
    return false;
  }
}

const LEADS_FILE = path.join(__dirname, "leads.json");
function saveLeadToFile(clientData, projectData, total, scoreLabel) {
  const lead = {
    timestamp: new Date().toISOString(),
    date_fr: new Date().toLocaleString("fr-MA", { timeZone: "Africa/Casablanca" }),
    client: clientData,
    project: projectData,
    amount: total,
    score: scoreLabel,
  };
  let leads = [];
  if (fs.existsSync(LEADS_FILE)) {
    try { leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8")); } catch(e) { leads = []; }
  }
  leads.push(lead);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
  console.log(`✅ Lead local: ${clientData.nom} (${scoreLabel})`);
}

async function notifyLead(clientData, projectData, total, scoreLabel) {
  saveLeadToFile(clientData, projectData, total, scoreLabel);
  await addLeadToSheet(clientData, projectData, total, scoreLabel);
}

// ========================= LEAD SCORING =========================
function estimateLeadScore(clientData, projectData, total) {
  let score = 0;
  const nom = clientData.nom || "";
  const tel = clientData.telephone || "";
  const email = clientData.email || "";
  if (nom.trim().length > 2) score += 20;
  if (/^(\+212|0)[0-9]{9,}$/.test(tel.replace(/[\s\-]/g, ""))) score += 25;
  if (email && email !== "non fourni" && /@/.test(email)) score += 10;
  if (projectData.city) score += 10;
  if (projectData.surface) score += 10;
  if (projectData.type) score += 10;
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

// ========================= PRICING ENGINE =========================
const PRICES = {
  etudes: 60,
  grosOeuvreHourdis: 1200,
  grosOeuvrePostTension: 1600,
  murCloture: 400,
  finition: 3000,
  renovation: 6000,
  etancheite: { terrasse: 365, sdb: 90, piscine: 120, voile: 160 },
  piscine: 3500,
  marge: 0.15
};

function calculerDevis(projet) {
  let sousTotal = 0, details = [];
  if (projet.type === "Études de projet" && projet.surface) {
    const cout = projet.surface * PRICES.etudes;
    details.push(`📐 Études : ${projet.surface} m² × ${PRICES.etudes} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }
  if (projet.type === "Construction" && projet.surface) {
    const goPrice = projet.postTension ? PRICES.grosOeuvrePostTension : PRICES.grosOeuvreHourdis;
    const go = projet.surface * goPrice;
    details.push(`🏗️ Gros œuvre ${projet.postTension ? "post-tension" : "hourdis"} : ${projet.surface} m² × ${goPrice} DH = ${go.toLocaleString()} DH`);
    sousTotal += go;
    const fin = projet.surface * PRICES.finition;
    details.push(`🎨 Finition : ${projet.surface} m² × ${PRICES.finition} DH = ${fin.toLocaleString()} DH`);
    sousTotal += fin;
  }
  if (projet.type === "Rénovation" && projet.surface) {
    const cout = projet.surface * PRICES.renovation;
    details.push(`🔄 Rénovation : ${projet.surface} m² × ${PRICES.renovation} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }
  if (projet.type === "Finition" && projet.surface) {
    const cout = projet.surface * PRICES.finition;
    details.push(`🎨 Finition seule : ${projet.surface} m² × ${PRICES.finition} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }
  if (projet.type === "Étanchéité") {
    const type = projet.etancheiteType || "terrasse";
    const prix = PRICES.etancheite[type] || PRICES.etancheite.terrasse;
    const cout = (projet.surface || 0) * prix;
    details.push(`💧 Étanchéité ${type} : ${projet.surface || 0} ${type === "voile" ? "m" : "m²"} × ${prix} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }
  if (projet.type === "Piscine clés en main" && projet.piscineSurface) {
    const cout = projet.piscineSurface * PRICES.piscine;
    details.push(`🏊 Piscine clés en main : ${projet.piscineSurface} m² × ${PRICES.piscine} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }
  if (projet.type === "Mur de clôture" && projet.clotureLength) {
    const cout = projet.clotureLength * PRICES.murCloture;
    details.push(`🧱 Mur de clôture : ${projet.clotureLength} m × ${PRICES.murCloture} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }
  if (projet.pool && projet.type !== "Piscine clés en main" && projet.poolSurface) {
    const cout = projet.poolSurface * PRICES.piscine;
    details.push(`🏊 Option piscine : ${projet.poolSurface} m² × ${PRICES.piscine} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }
  const marge = sousTotal * PRICES.marge;
  const total = sousTotal + marge;
  return { sousTotal, marge, total, details };
}

// ========================= INTENT & ENTITY EXTRACTION =========================
const GREETINGS = /^(bonjour|bonsoir|salut|salam|hello|hi|ahlan|coucou|hey|yo)\b/i;

const INTENT_MAP = [
  { intent: "menu",       pattern: /\b(menu|accueil|retour accueil|recommencer|annuler|stop|début|home)\b/i },
  { intent: "devis",      pattern: /\b(devis|estimation|estimer|prix|tarif|coût|cout|quote)\b/i },
  { intent: "services",   pattern: /\b(service|services|offre|prestations|spécialité)\b/i },
  { intent: "rdv",        pattern: /\b(rendez-vous|rdv|rendezvous|appointment|visite|rencontre)\b/i },
  { intent: "projets",    pattern: /\b(projets|réalisations|portfolio|references|exemples)\b/i },
  { intent: "conseiller", pattern: /\b(conseiller|agent|commercial|humain|parler à|appel|téléphone|contact)\b/i },
  { intent: "specialites",pattern: /\b(spécialités|specialites|specialité)\b/i },
];

function detectIntent(text) {
  const t = text.trim();
  if (GREETINGS.test(t)) return "greeting";
  for (const { intent, pattern } of INTENT_MAP) {
    if (pattern.test(t)) return intent;
  }
  return null;
}

const CITIES = [
  "casablanca","rabat","marrakech","tanger","fès","fes","meknès","meknes",
  "agadir","oujda","témara","temara","salé","sale","mohammedia","kenitra",
  "berrechid","settat","benslimane","el jadida","laayoune","dakhla"
];

const PROJECT_TYPES = [
  { pattern: /\b(villa|maison|résidence|residence|habitation)\b/i, type: "Construction" },
  { pattern: /\b(immeuble|résidentiel|appartement|batiment|bâtiment)\b/i, type: "Construction" },
  { pattern: /\b(renovation|rénovation|rénover|refaire|moderniser)\b/i, type: "Rénovation" },
  { pattern: /\b(finition|peinture|carrelage|enduit|revêtement)\b/i, type: "Finition" },
  { pattern: /\b(etancheite|étanchéité|étanche|fuite|imperméable)\b/i, type: "Étanchéité" },
  { pattern: /\b(piscine)\b/i, type: "Piscine clés en main" },
  { pattern: /\b(cloture|clôture|mur de cloture|mur périphérique|enceinte)\b/i, type: "Mur de clôture" },
  { pattern: /\b(etude|étude|plan|plans|architecte|permis)\b/i, type: "Études de projet" },
];

function extractSurface(text) {
  let m = text.match(/(\d+(?:[.,]\d+)?)\s*m[²2]?/i);
  if (m) return parseFloat(m[1].replace(",", "."));
  m = text.match(/(?:environ|autour|vers|à peu près|je pense|peut-être|approximately|around)\s+(\d{2,4})\b/i);
  if (m) return parseFloat(m[1]);
  m = text.match(/\b(\d{2,4})\b/);
  if (m) {
    const n = parseFloat(m[1]);
    if (n >= 10 && n <= 9999) return n;
  }
  return null;
}

function extractPoolSurface(text) {
  let m = text.match(/piscine[^0-9]*(\d+)\s*m[²2]?/i);
  if (m) return parseFloat(m[1]);
  m = text.match(/(\d+)\s*m[²2]?\s*(?:de\s+)?piscine/i);
  if (m) return parseFloat(m[1]);
  return null;
}

function extractProjectFromMessage(text) {
  const data = {};
  const surf = extractSurface(text);
  if (surf) data.surface = surf;
  for (const c of CITIES) {
    if (text.toLowerCase().includes(c)) {
      data.city = c.charAt(0).toUpperCase() + c.slice(1);
      break;
    }
  }
  for (const { pattern, type } of PROJECT_TYPES) {
    if (pattern.test(text)) {
      data.type = type;
      break;
    }
  }
  if (/\bpiscine\b/i.test(text) && data.type !== "Piscine clés en main") {
    data.pool = true;
    const ps = extractPoolSurface(text);
    data.poolSurface = ps || null;
  }
  if (/\bsous-sol\b/i.test(text)) data.basement = true;
  if (/\bpost.?tension\b/i.test(text)) data.postTension = true;
  if (/\b(sdb|salle de bain)\b/i.test(text) && data.type === "Étanchéité") data.etancheiteType = "sdb";
  if (/\bvoile\b/i.test(text) && data.type === "Étanchéité") data.etancheiteType = "voile";
  return data;
}

function detectProjectType(text) {
  for (const { pattern, type } of PROJECT_TYPES) {
    if (pattern.test(text)) return type;
  }
  const t = text.toLowerCase();
  if (t.includes("construction")) return "Construction";
  if (t.includes("rénovation") || t.includes("renovation")) return "Rénovation";
  if (t.includes("finition")) return "Finition";
  if (t.includes("étanchéité") || t.includes("etancheite")) return "Étanchéité";
  if (t.includes("piscine")) return "Piscine clés en main";
  if (t.includes("clôture") || t.includes("cloture") || t.includes("mur")) return "Mur de clôture";
  if (t.includes("étude") || t.includes("etude") || t.includes("plan")) return "Études de projet";
  if (t === "1") return "Construction";
  if (t === "2") return "Rénovation";
  if (t === "3") return "Finition";
  if (t === "4") return "Étanchéité";
  if (t === "5") return "Piscine clés en main";
  if (t === "6") return "Mur de clôture";
  if (t === "7") return "Études de projeto";
  return null;
}

// ========================= SESSION MANAGEMENT =========================
const sessions = {};
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = {
      flow: null,
      stage: null,
      collectedData: {},
      retryCount: {},
      lastActivity: Date.now(),
    };
  }
  sessions[id].lastActivity = Date.now();
  return sessions[id];
}

function resetSession(id) {
  sessions[id] = {
    flow: null,
    stage: null,
    collectedData: {},
    retryCount: {},
    lastActivity: Date.now(),
  };
  return sessions[id];
}

setInterval(() => {
  const now = Date.now();
  for (const id of Object.keys(sessions)) {
    if (now - sessions[id].lastActivity > SESSION_TIMEOUT_MS) {
      delete sessions[id];
      console.log(`🗑️ Session expirée: ${id}`);
    }
  }
}, 10 * 60 * 1000);

// ========================= TEXTS & MENUS =========================
const MAIN_MENU = `Bonjour,
Merci de nous avoir contactés. Nous sommes ERPAC.

1️⃣ Demander un devis
2️⃣ Découvrir nos services
3️⃣ Voir nos projets réalisés
4️⃣ Prendre rendez-vous
5️⃣ Nos spécialités`;

const SERVICES_PAGE = `🏗️ *SERVICES ERPAC*

✅ Études & Conception
✅ Construction générale (villas, immeubles)
✅ Gros œuvre
✅ Lots techniques (plomberie, électricité, finitions)
✅ Aménagement & décoration
✅ Étanchéité (garantie 10 ans)
✅ Piscines clés en main
✅ Rénovation & réhabilitation
✅ Mobilier sur mesure
✅ Menuiserie
✅ Cloisonnement & faux plafonds

Qualité, délais, accompagnement personnalisé.`;

const SPECIALITES_MENU = `🔧 *Nos spécialités*

1️⃣ Villas
2️⃣ Immeubles
3️⃣ Piscines
4️⃣ Rénovation
5️⃣ Locaux commerciaux
6️⃣ Étanchéité

Tapez le numéro ou "menu" retour.`;

const SPECIALITES_DETAIL = {
  "1": `🏡 Villas : construction haut standing, finition premium, piscine, étanchéité, domotique.`,
  "2": `🏢 Immeubles : R+2 à R+5, béton armé, parties communes, ascenseurs.`,
  "3": `🏊 Piscines : clés en main, débordement, traditionnelles, intérieures.`,
  "4": `🔄 Rénovation : complète ou partielle, villas, appartements, locaux.`,
  "5": `🏬 Locaux commerciaux : bureaux, restaurants, cliniques, boutiques.`,
  "6": `💧 Étanchéité : terrasses, sous-sols, toitures, piscines, garantie 10 ans.`,
};

const SPECIALITES_FOLLOW_UP = `\n\nSouhaitez-vous une estimation ou un rendez-vous ?`;

const SMART_FALLBACK = `Je n'ai pas bien compris 😊

Souhaitez-vous :
1️⃣ Devis
2️⃣ Services
3️⃣ Rendez-vous
4️⃣ Spécialités`;

// ========================= FLOWS =========================
// ----- Devis (inchangé, fiable) -----
function startDevis(sess, prefilled = {}) {
  sess.flow = "devis";
  sess.collectedData = { ...prefilled };
  return advanceDevis(sess);
}

function advanceDevis(sess) {
  const d = sess.collectedData;
  if (!d.type) {
    sess.stage = "type";
    return `Quel type de projet ?\n- Construction\n- Rénovation\n- Finition\n- Étanchéité\n- Piscine clés en main\n- Mur de clôture\n- Études de projet`;
  }
  if (!d.city) {
    sess.stage = "city";
    return `Où se situe le projet ? (ville/quartier)`;
  }
  if (!d.surface && d.type !== "Mur de clôture") {
    sess.stage = "surface";
    return `Surface approximative en m² ?`;
  }
  if (d.type === "Mur de clôture" && !d.clotureLength) {
    sess.stage = "cloture_length";
    return `Longueur du mur en mètres ?`;
  }
  if (d.pool && d.poolSurface === null) {
    sess.stage = "pool_surface";
    return `Quelle surface pour la piscine ? (ex: 32 m²)`;
  }
  if (!d.description) {
    sess.stage = "description";
    return `Décrivez brièvement les travaux (ex: gros œuvre + finition, rénovation, étanchéité terrasse)`;
  }
  if (!d.plans) {
    sess.stage = "plans";
    return `Avez-vous des plans, photos ou autorisation ? (Oui/Non)`;
  }
  if (!d.delai) {
    sess.stage = "delai";
    return `Quand souhaitez-vous démarrer ?`;
  }
  return computeAndShowDevis(sess);
}

function processDevisInput(sess, msg, sessionId) {
  const stage = sess.stage;
  const d = sess.collectedData;

  if (stage === "type") {
    const detected = detectProjectType(msg);
    if (detected) {
      d.type = detected;
      sess.retryCount.type = 0;
    } else {
      sess.retryCount.type = (sess.retryCount.type || 0) + 1;
      if (sess.retryCount.type >= 2) {
        d.type = "Construction";
        return `Je retiens "Construction". ` + advanceDevis(sess);
      }
      return `Type non reconnu. Choisissez parmi : Construction, Rénovation, Finition, Étanchéité, Piscine clés en main, Mur de clôture, Études de projet.`;
    }
    return advanceDevis(sess);
  }

  if (stage === "city") {
    d.city = msg.trim();
    return advanceDevis(sess);
  }

  if (stage === "surface") {
    const surf = extractSurface(msg);
    if (surf && surf >= 5 && surf <= 50000) {
      d.surface = surf;
      sess.retryCount.surface = 0;
      return advanceDevis(sess);
    }
    sess.retryCount.surface = (sess.retryCount.surface || 0) + 1;
    if (sess.retryCount.surface >= 2) {
      d.surface = 150;
      return `Pas de surface exacte ? Je prends 150 m² par défaut. ` + advanceDevis(sess);
    }
    return `Surface non reconnue. Entrez un nombre (ex: 200) ou "passer".`;
  }

  if (stage === "cloture_length") {
    const len = extractSurface(msg);
    if (len && len >= 1) {
      d.clotureLength = len;
      return advanceDevis(sess);
    }
    return `Longueur en mètres ?`;
  }

  if (stage === "pool_surface") {
    const ps = extractSurface(msg);
    if (ps && ps >= 5 && ps <= 500) d.poolSurface = ps;
    else d.poolSurface = 32;
    return advanceDevis(sess);
  }

  if (stage === "description") {
    d.description = msg.trim();
    if (/\bpiscine\b/i.test(msg) && d.type !== "Piscine clés en main") {
      d.pool = true;
      const ps = extractPoolSurface(msg);
      if (ps) d.poolSurface = ps;
      else if (!d.poolSurface) d.poolSurface = null;
    }
    if (/post.?tension/i.test(msg)) d.postTension = true;
    if (d.type === "Étanchéité") {
      if (/sdb|salle de bain/i.test(msg)) d.etancheiteType = "sdb";
      else if (/piscine/i.test(msg)) d.etancheiteType = "piscine";
      else if (/voile/i.test(msg)) d.etancheiteType = "voile";
      else d.etancheiteType = "terrasse";
    }
    return advanceDevis(sess);
  }

  if (stage === "plans") {
    d.plans = msg.trim();
    return advanceDevis(sess);
  }

  if (stage === "delai") {
    d.delai = msg.trim();
    return advanceDevis(sess);
  }

  if (stage === "result") {
    return handleDevisResult(sess, msg, sessionId);
  }
  return null;
}

function computeAndShowDevis(sess) {
  const d = sess.collectedData;
  const projet = {
    type: d.type,
    surface: d.surface,
    pool: d.pool || false,
    poolSurface: d.poolSurface || 32,
    postTension: d.postTension || false,
    etancheiteType: d.etancheiteType || "terrasse",
    piscineSurface: d.type === "Piscine clés en main" ? d.surface : undefined,
    clotureLength: d.type === "Mur de clôture" ? d.clotureLength : undefined,
  };
  const { sousTotal, marge, total, details } = calculerDevis(projet);
  d.estimate_total = total;
  sess.stage = "result";
  let reply = `📊 *Estimation ERPAC*\n\n`;
  details.forEach(d => reply += d + "\n");
  reply += `\nSous-total : ${sousTotal.toLocaleString()} DH\nMarge ERPAC 15% : ${marge.toLocaleString()} DH\n💰 *Total estimatif : ${total.toLocaleString()} DH*\n\n⚠️ Estimation indicative, validation après visite technique.\n\nSouhaitez-vous :\n1️⃣ Être contacté\n2️⃣ Envoyer photos/plans\n3️⃣ Modifier\n4️⃣ Menu`;
  return reply;
}

function handleDevisResult(sess, msg, sessionId) {
  const opt = msg.trim().toLowerCase();
  if (opt === "1" || /contact|conseiller|rappel|appel/i.test(msg)) {
    return startContactCollection(sess, "devis");
  }
  if (opt === "2" || /photo|plan/i.test(msg)) {
    return `📎 Envoyez vos photos/plans ici. Un conseiller vous recontactera. Souhaitez-vous laisser vos coordonnées ? (Oui/Non)`;
  }
  if (opt === "3" || /modifi|recommencer|changer/i.test(msg)) {
    return startDevis(sess, {});
  }
  if (opt === "4" || /menu|accueil/i.test(msg)) {
    resetSession(sessionId);
    return MAIN_MENU;
  }
  if (/oui|yes/i.test(msg)) return startContactCollection(sess, "devis");
  return `Répondez 1, 2, 3 ou 4.`;
}

// ----- Contact (simple, OK) -----
function startContactCollection(sess, origin) {
  sess.flow = "contact";
  sess.stage = "nom";
  sess.collectedData.contact_origin = origin;
  sess.collectedData.contact = {};
  return `Pour être contacté :\n👤 Votre nom complet ?`;
}

function processContactInput(sess, msg, sessionId) {
  const stage = sess.stage;
  const contact = sess.collectedData.contact || {};
  sess.collectedData.contact = contact;

  if (stage === "nom") {
    if (msg.trim().length < 2) return `Nom complet s'il vous plaît.`;
    contact.nom = msg.trim();
    sess.stage = "telephone";
    return `📞 Numéro de téléphone ?`;
  }
  if (stage === "telephone") {
    const cleaned = msg.replace(/[\s\-]/g, "");
    if (!/[0-9]{8,}/.test(cleaned)) return `Numéro invalide. Format: 0612345678 ou +212612345678`;
    contact.telephone = msg.trim();
    sess.stage = "email";
    return `📧 Email ? (tapez "non" pour ignorer)`;
  }
  if (stage === "email") {
    contact.email = /non|skip|pas|rien/i.test(msg) ? "non fourni" : msg.trim();
    const client = { nom: contact.nom, telephone: contact.telephone, email: contact.email };
    const errors = validateLead(client);
    if (errors.length) return `Erreur: ${errors.join(", ")}. Merci de corriger.`;
    const project = {
      type: sess.collectedData.type || "",
      city: sess.collectedData.city || "",
      surface: sess.collectedData.surface || "",
      pool: sess.collectedData.pool,
      poolSurface: sess.collectedData.poolSurface,
    };
    const total = sess.collectedData.estimate_total || "À définir";
    const score = estimateLeadScore(client, project, total);
    notifyLead(client, project, total, score.label);
    delete sessions[sessionId];
    return `✅ *Merci ${contact.nom} !*\n\nVotre demande est enregistrée. Un conseiller vous contactera sous 24h.\n\n📞 ${contact.telephone}\n\nBonne journée 😊`;
  }
  return null;
}

// ----- RDV : version CORRIGÉE (avec tableau d'étapes) -----
const RDV_STEPS = [
  { field: "nom",         prompt: "👤 Votre nom complet ?",           validate: (v) => v.trim().length >= 2, default: "Client" },
  { field: "telephone",   prompt: "📞 Numéro de téléphone ?",         validate: (v) => /[0-9]{8,}/.test(v.replace(/[\s\-]/g, "")), default: "non fourni" },
  { field: "ville",       prompt: "📍 Ville du projet ?",             validate: (v) => v.trim().length >= 2, default: "non précisée" },
  { field: "type",        prompt: "🏗️ Type de projet ? (ex: villa, rénovation, piscine, étanchéité)", validate: (v) => v.trim().length >= 2, default: "non spécifié" },
  { field: "date",        prompt: "📅 Date souhaitée (ex: lundi 15 mai ou 'à déterminer') ?", validate: () => true, default: "à déterminer" },
  { field: "heure",       prompt: "⏰ Heure souhaitée (ex: 10h, 14h30) ?", validate: () => true, default: "à préciser" },
  { field: "description", prompt: "📝 Décrivez brièvement votre besoin (quelques mots) :", validate: () => true, default: "non renseigné" },
];

function startRdv(sess) {
  sess.flow = "rdv";
  sess.rdvStep = 0;
  sess.rdvData = {};
  sess.rdvRetry = {};
  return RDV_STEPS[0].prompt;
}

function processRdvInput(sess, msg, sessionId) {
  if (sess.flow !== "rdv") return null;
  const step = sess.rdvStep;
  if (step >= RDV_STEPS.length) {
    // Finalisation : enregistrement et récapitulatif
    const rdv = sess.rdvData;
    const client = { nom: rdv.nom, telephone: rdv.telephone, email: "" };
    const project = { type: rdv.type, city: rdv.ville, surface: "" };
    const score = estimateLeadScore(client, project, "RDV");
    notifyLead(client, project, "RDV", score.label);
    const recap = `✅ *Rendez-vous enregistré !*\n\n👤 Nom : ${rdv.nom}\n📞 Tél : ${rdv.telephone}\n📍 Ville : ${rdv.ville}\n🏗️ Projet : ${rdv.type}\n📅 Date : ${rdv.date}\n⏰ Heure : ${rdv.heure}\n📝 Besoin : ${rdv.description}\n\nUn conseiller ERPAC vous contactera pour confirmer.\n\nSouhaitez-vous :\n1️⃣ Retour au menu principal\n2️⃣ Demander une estimation\n3️⃣ Contacter directement un conseiller`;
    delete sessions[sessionId];
    return recap;
  }

  const current = RDV_STEPS[step];
  let value = msg.trim();
  const isValid = current.validate(value);
  if (!isValid) {
    if (!sess.rdvRetry[step]) sess.rdvRetry[step] = 0;
    sess.rdvRetry[step]++;
    if (sess.rdvRetry[step] >= 2) {
      value = current.default;
      sess.rdvData[current.field] = value;
      sess.rdvStep++;
      if (sess.rdvStep >= RDV_STEPS.length) {
        return processRdvInput(sess, "", sessionId);
      }
      return RDV_STEPS[sess.rdvStep].prompt;
    }
    return current.prompt;
  }
  sess.rdvData[current.field] = value;
  sess.rdvStep++;
  if (sess.rdvStep >= RDV_STEPS.length) {
    return processRdvInput(sess, "", sessionId);
  }
  return RDV_STEPS[sess.rdvStep].prompt;
}

// ----- Spécialités (OK) -----
function processSpecialites(sess, msg, sessionId) {
  if (sess.stage === "specialites_selection") {
    const key = msg.trim();
    if (SPECIALITES_DETAIL[key]) {
      sess.stage = "specialites_followup";
      sess.collectedData.lastSpecialite = key;
      return SPECIALITES_DETAIL[key] + SPECIALITES_FOLLOW_UP;
    }
    return `Tapez 1 à 6 ou "menu".`;
  }
  if (sess.stage === "specialites_followup") {
    const opt = msg.toLowerCase();
    if (/devis|estimation|prix|1/.test(opt)) {
      resetSession(sessionId);
      return startDevis(getSession(sessionId), {});
    }
    if (/rdv|rendez|visite|2/.test(opt)) {
      resetSession(sessionId);
      return startRdv(getSession(sessionId));
    }
    resetSession(sessionId);
    return MAIN_MENU;
  }
  return null;
}

// ========================= MAIN PROCESSOR =========================
function processMessage(sessionId, raw) {
  if (!raw || !raw.trim()) return { reply: MAIN_MENU, next_step: "menu" };
  const msg = raw.trim();
  const sess = getSession(sessionId);
  sess.id = sessionId;

  // 1. Interception des intentions globales
  const intent = detectIntent(msg);
  if (intent && intent !== "greeting") {
    switch (intent) {
      case "menu":
        resetSession(sessionId);
        return { reply: MAIN_MENU, next_step: "menu" };
      case "devis":
        resetSession(sessionId);
        return { reply: startDevis(getSession(sessionId), {}), next_step: "devis" };
      case "rdv":
        resetSession(sessionId);
        return { reply: startRdv(getSession(sessionId)), next_step: "rdv" };
      case "services":
        resetSession(sessionId);
        return { reply: SERVICES_PAGE, next_step: "services" };
      case "specialites":
        resetSession(sessionId);
        const spSess = getSession(sessionId);
        spSess.flow = "specialites";
        spSess.stage = "specialites_selection";
        return { reply: SPECIALITES_MENU, next_step: "specialites" };
      case "conseiller":
        resetSession(sessionId);
        return { reply: startContactCollection(getSession(sessionId), "direct"), next_step: "contact" };
      case "projets":
        sess.stage = "projects_redirect";
        sess.flow = null;
        return { reply: `🔗 *Nos réalisations* : https://www.erpac.ma/projects.cfm\n\nSouhaitez-vous une estimation pour un projet similaire ? (Oui/Non)`, next_step: "projects_redirect" };
      default:
        // continuer
    }
  }

  // 2. Gestion des étapes spéciales (projects_redirect)
  if (sess.stage === "projects_redirect") {
    if (/oui|yes|ok|o/i.test(msg)) {
      resetSession(sessionId);
      return { reply: startDevis(getSession(sessionId), {}), next_step: "devis" };
    }
    resetSession(sessionId);
    return { reply: MAIN_MENU, next_step: "menu" };
  }

  // 3. Routage des flows actifs
  if (sess.flow === "devis") {
    const reply = processDevisInput(sess, msg, sessionId);
    if (reply === null) {
      resetSession(sessionId);
      return { reply: MAIN_MENU, next_step: "menu" };
    }
    if (reply) return { reply, next_step: sess.stage || "devis" };
  }

  if (sess.flow === "contact") {
    const reply = processContactInput(sess, msg, sessionId);
    if (reply) return { reply, next_step: "contact" };
  }

  if (sess.flow === "rdv") {
    const reply = processRdvInput(sess, msg, sessionId);
    if (reply) return { reply, next_step: "rdv" };
  }

  if (sess.flow === "specialites") {
    const reply = processSpecialites(sess, msg, sessionId);
    if (reply) return { reply, next_step: "specialites" };
  }

  // 4. Menu principal par numéro
  const lower = msg.toLowerCase();
  if (lower === "1" || lower === "1️⃣") {
    return { reply: startDevis(sess, {}), next_step: "devis" };
  }
  if (lower === "2" || lower === "2️⃣") {
    sess.flow = null;
    return { reply: SERVICES_PAGE, next_step: "services" };
  }
  if (lower === "3" || lower === "3️⃣") {
    sess.stage = "projects_redirect";
    return { reply: `🔗 *Nos réalisations* : https://www.erpac.ma/projects.cfm\n\nSouhaitez-vous une estimation ? (Oui/Non)`, next_step: "projects_redirect" };
  }
  if (lower === "4" || lower === "4️⃣") {
    return { reply: startRdv(sess), next_step: "rdv" };
  }
  if (lower === "5" || lower === "5️⃣") {
    sess.flow = "specialites";
    sess.stage = "specialites_selection";
    return { reply: SPECIALITES_MENU, next_step: "specialites" };
  }

  // 5. Détection automatique d'un projet par texte libre
  const extracted = extractProjectFromMessage(msg);
  if (extracted.surface && (extracted.type || extracted.pool)) {
    resetSession(sessionId);
    const newSess = getSession(sessionId);
    return { reply: startDevis(newSess, extracted), next_step: "devis" };
  }

  // 6. Fallback intelligent
  return { reply: SMART_FALLBACK, next_step: "menu" };
}

// ========================= WHATSAPP WEBHOOKS =========================
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

app.get("/health", (_, res) => res.json({ status: "ok", version: "erpac-final-v2" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🏗️ ERPAC Smart Bot (RDV corrigé) sur port ${PORT}`);
  await initGoogleSheets();
  console.log(`📝 Leads: ${LEADS_FILE}`);
  console.log(`📊 /leads | 🔍 /sessions | ❤️ /health`);
});
