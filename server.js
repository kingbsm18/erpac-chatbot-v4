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

// ========================= GOOGLE SHEETS (optionnel, fallback local) =========================
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
let sheets = null;
let googleSheetsEnabled = false;

async function initGoogleSheets() {
  if (!SPREADSHEET_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.log("⚠️ Google Sheets non configuré -> leads.json");
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
    googleSheetsEnabled = true;
    console.log("✅ Google Sheets connecté");
    return true;
  } catch (error) {
    console.error("❌ Erreur Sheets:", error.message);
    return false;
  }
}

async function addLeadToSheet(clientData, projectData, total, scoreLabel) {
  if (!googleSheetsEnabled || !sheets) return false;
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
    // create headers if needed
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
    console.error("❌ Erreur ajout lead Sheets:", error.message);
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

// ========================= TARIFS ERPAC =========================
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

// ========================= MOTEUR DE CALCUL DEVIS =========================
function calculerDevis(projet) {
  let sousTotal = 0, details = [];

  // Construction générale (villa, immeuble, appartement, local commercial)
  if (["Construction", "Villa", "Immeuble", "Appartement", "Local commercial"].includes(projet.type) && projet.surface && projet.floors) {
    const prixGO = projet.structure === "post-tension" ? PRICES.grosOeuvrePostTension : PRICES.grosOeuvreHourdis;
    const surfaceGO = projet.surface * projet.floors;
    const coutGO = surfaceGO * prixGO;
    details.push(`🏗️ Gros œuvre (${projet.structure === "post-tension" ? "post-tension" : "hourdis"}) : ${surfaceGO} m² × ${prixGO} DH = ${coutGO.toLocaleString()} DH`);
    sousTotal += coutGO;

    const surfaceFin = projet.surface * projet.floors;
    const coutFin = surfaceFin * PRICES.finition;
    details.push(`🎨 Finition : ${surfaceFin} m² × ${PRICES.finition} DH = ${coutFin.toLocaleString()} DH`);
    sousTotal += coutFin;
  }
  // Rénovation
  else if (projet.type === "Rénovation" && projet.surface) {
    const cout = projet.surface * PRICES.renovation;
    details.push(`🔄 Rénovation : ${projet.surface} m² × ${PRICES.renovation} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }
  // Étanchéité
  else if (projet.type === "Étanchéité") {
    const type = projet.etancheiteType || "terrasse";
    const prix = PRICES.etancheite[type] || PRICES.etancheite.terrasse;
    let qte = (type === "sdb") ? 1 : (projet.surface || 0);
    const cout = qte * prix;
    details.push(`💧 Étanchéité ${type} : ${qte} ${(type === "voile" ? "m" : "m²")} × ${prix} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }
  // Piscine clés en main
  else if (projet.type === "Piscine clés en main" && projet.poolSurface) {
    const cout = projet.poolSurface * PRICES.piscine;
    details.push(`🏊 Piscine clés en main : ${projet.poolSurface} m² × ${PRICES.piscine} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }
  // Mur de clôture
  else if (projet.type === "Mur de clôture" && projet.clotureLength) {
    const cout = projet.clotureLength * PRICES.murCloture;
    details.push(`🧱 Mur de clôture : ${projet.clotureLength} m × ${PRICES.murCloture} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }
  // Études de projet
  else if (projet.type === "Études de projet" && projet.surface) {
    const cout = projet.surface * PRICES.etudes;
    details.push(`📐 Études de projet : ${projet.surface} m² × ${PRICES.etudes} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }

  // Option piscine (ajoutée à tout projet sauf si déjà piscine)
  if (projet.pool && projet.type !== "Piscine clés en main" && projet.poolSurface) {
    const cout = projet.poolSurface * PRICES.piscine;
    details.push(`🏊 Option piscine : ${projet.poolSurface} m² × ${PRICES.piscine} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }

  const marge = sousTotal * PRICES.marge;
  const total = sousTotal + marge;
  return { sousTotal, marge, total, details };
}

// ========================= INTENT DETECTION & SMALL TALK =========================
const GREETINGS = [
  "bonjour", "bonsoir", "salut", "salam", "slm", "hey", "yo", "coucou",
  "bsr", "bjr", "hello", "hi", "cava", "ça va", "labas", "labass"
];
const SMALL_TALK = {
  "merci": ["Avec plaisir 😊", "Je vous en prie !", "Service ❤️"],
  "cv|cava|ça va|labas": ["Très bien merci 😊 Et vous ?", "Ça roule ! Et vous ?"],
  "tu es qui|t'es qui|qui es-tu|ton nom": ["Je suis l'assistant virtuel ERPAC 🤖", "ERPAC Assistant, à votre service"],
  "robot|bot|intelligent": ["Je suis votre assistant commercial ERPAC, sans IA externe mais très malin 😉"],
  "open today|ouvert aujourd'hui": ["Nous sommes ouverts du lundi au samedi de 8h30 à 16h30."],
  "aide|help|assistance": ["🤝 Je peux vous aider à obtenir un devis, découvrir nos services, ou planifier un rendez-vous."]
};

function checkGreeting(text) {
  const lower = text.trim().toLowerCase();
  return GREETINGS.some(g => lower === g || lower.startsWith(g));
}

function checkSmallTalk(text) {
  const lower = text.toLowerCase();
  for (const [key, replies] of Object.entries(SMALL_TALK)) {
    if (new RegExp(key, "i").test(lower)) {
      return Array.isArray(replies) ? replies[Math.floor(Math.random() * replies.length)] : replies;
    }
  }
  return null;
}

function detectIntent(text) {
  const t = text.toLowerCase();
  if (/\b(menu|accueil|retour|annuler|recommencer|stop|home|début)\b/i.test(t)) return "menu";
  if (/\b(devis|estimation|estimer|prix|tarif|coût|cout|quote)\b/i.test(t)) return "devis";
  if (/\b(service|services|offre|prestations)\b/i.test(t)) return "services";
  if (/\b(rendez-vous|rdv|rendezvous|appointment|visite|rencontre)\b/i.test(t)) return "rdv";
  if (/\b(projets|réalisations|portfolio|references|exemples)\b/i.test(t)) return "projets";
  if (/\b(conseiller|agent|commercial|humain|parler à|appel|téléphone|contact)\b/i.test(t)) return "conseiller";
  if (/\b(spécialités|specialites|specialité)\b/i.test(t)) return "specialites";
  return null;
}

// ========================= EXTRACTION AUTOMATIQUE =========================
const CITIES = ["casablanca","rabat","marrakech","tanger","fès","fes","meknès","meknes",
                "agadir","oujda","témara","temara","salé","sale","mohammedia","kenitra"];
function extractCity(text) {
  const lower = text.toLowerCase();
  for (const c of CITIES) {
    if (lower.includes(c)) return c.charAt(0).toUpperCase() + c.slice(1);
  }
  return null;
}

function extractSurface(text) {
  let m = text.match(/(\d{2,4})\s*m[²2]?/i);
  if (m) return parseInt(m[1]);
  m = text.match(/\b(\d{2,4})\b/);
  if (m) {
    const n = parseInt(m[1]);
    if (n >= 10 && n <= 5000) return n;
  }
  return null;
}

function extractFloors(text) {
  let m = text.match(/r\+(\d)/i);
  if (m) return parseInt(m[1]) + 1;
  if (/\brdc\b/i.test(text)) return 1;
  if (/\br\+0\b/.test(text)) return 1;
  const t = text.toLowerCase();
  if (t.includes("r+1")) return 2;
  if (t.includes("r+2")) return 3;
  return null;
}

function extractBasement(text) {
  return /sous[\s-]?sol/i.test(text);
}

function extractPool(text) {
  const has = /piscine/i.test(text);
  if (!has) return false;
  let surface = null;
  const m = text.match(/piscine[^0-9]*(\d+)\s*m/i);
  if (m) surface = parseInt(m[1]);
  return { pool: true, poolSurface: surface };
}

function extractStructure(text) {
  if (/post[ -]?tension/i.test(text)) return "post-tension";
  if (/hourdis/i.test(text)) return "hourdis";
  return null;
}

function detectProjectTypeFromText(text) {
  const lower = text.toLowerCase();
  if (/villa|maison|résidence/i.test(lower)) return { type: "Construction", subtype: "Villa" };
  if (/immeuble|appartement/i.test(lower)) return { type: "Construction", subtype: "Immeuble" };
  if (/local commercial|bureau|commerce/i.test(lower)) return { type: "Construction", subtype: "Local commercial" };
  if (/renovation|rénovation/i.test(lower)) return { type: "Rénovation" };
  if (/piscine/i.test(lower) && !/construction/i.test(lower)) return { type: "Piscine clés en main" };
  if (/etancheite|étanchéité|fuite/i.test(lower)) return { type: "Étanchéité" };
  if (/mur de cloture|cloture/i.test(lower)) return { type: "Mur de clôture" };
  if (/etude|étude|plan|permis/i.test(lower)) return { type: "Études de projet" };
  return null;
}

// Extraction intelligente d'un message libre (ex: "Villa 300m² Rabat R+1 piscine")
function extractFullProject(text) {
  const data = {};
  const city = extractCity(text);
  if (city) data.city = city;
  const surface = extractSurface(text);
  if (surface) data.surface = surface;
  const floors = extractFloors(text);
  if (floors !== null) data.floors = floors;
  const basement = extractBasement(text);
  if (basement) data.basement = true;
  const poolInfo = extractPool(text);
  if (poolInfo.pool) {
    data.pool = true;
    if (poolInfo.poolSurface) data.poolSurface = poolInfo.poolSurface;
  }
  const structure = extractStructure(text);
  if (structure) data.structure = structure;
  const typeInfo = detectProjectTypeFromText(text);
  if (typeInfo) {
    data.type = typeInfo.type;
    if (typeInfo.subtype) data.subtype = typeInfo.subtype;
  }
  return data;
}

// ========================= SESSIONS =========================
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
  delete sessions[id];
  getSession(id); // fresh
}
setInterval(() => {
  const now = Date.now();
  for (const id of Object.keys(sessions)) {
    if (now - sessions[id].lastActivity > SESSION_TIMEOUT_MS) delete sessions[id];
  }
}, 10 * 60 * 1000);

// ========================= TEXTS & MENUS =========================
const MAIN_MENU = `Bonjour 👋
Bienvenue chez ERPAC Construction.

1️⃣ Demander un devis
2️⃣ Découvrir nos services
3️⃣ Voir nos projets réalisés
4️⃣ Prendre rendez-vous
5️⃣ Nos spécialités`;

const SERVICES_TEXT = `🏗️ SERVICES ERPAC

✅ 📐 Études & Conception : Plans, faisabilité, permis de construire, assistance MOE.
✅ 🏗️ Construction Générale : Villas, immeubles, plateaux bureaux, cliniques.
✅ 🏗️ Gros Œuvre : Structure porteuse, fondations, béton armé, charpente.
✅ 🔧 Lots Techniques (Second Œuvre) : Plomberie, électricité, revêtements, finitions.
✅ 🎨 Aménagement & Décoration : Design intérieur/extérieur, agencement sur-mesure.
✅ 💧 Étanchéité : Toitures, terrasses, sous-sols, piscines – garantie 10 ans.
✅ 🏊 Construction de Piscines : Piscines clés en main (débordement, traditionnelles, intérieures).
✅ 🔄 Rénovation & Réhabilitation : Rénovation complète ou partielle, mise aux normes.
✅ 🪑 Mobilier sur Mesure : Conception et fabrication de meubles personnalisés.
✅ 🪚 Menuiserie : Menuiserie bois, aluminium, PVC – portes, fenêtres, agencements.
✅ 🧱 Cloisonnement & Faux Plafonds : Cloisons intérieures, doublages, faux plafonds, isolation.

Qualité technique, respect des délais, accompagnement personnalisé.

Souhaitez-vous :
1️⃣ Demander un devis
2️⃣ Retour au menu`;

const SPECIALITES_MENU = `🔧 Nos spécialités

1️⃣ Villas
2️⃣ Immeubles
3️⃣ Piscines
4️⃣ Rénovation
5️⃣ Locaux commerciaux
6️⃣ Étanchéité

Tapez le numéro ou "menu" pour revenir.`;

const SPECIALITES_DETAIL = {
  "1": "🏡 Villas : Construction sur mesure R+1/R+2, finitions haut standing, piscine, étanchéité, domotique.",
  "2": "🏢 Immeubles : Résidentiel R+2 à R+5, structure béton armé, ascenseurs, étanchéité des terrasses.",
  "3": "🏊 Piscines : Clés en main (débordement, traditionnelles, intérieures) – 3500 DH/m².",
  "4": "🔄 Rénovation : Complète ou partielle, villas, appartements, locaux – 6000 DH/m².",
  "5": "🏬 Locaux commerciaux : Bureaux, restaurants, cliniques, boutiques, aménagement complet.",
  "6": "💧 Étanchéité : Terrasses (365 DH/m²), SDB (90 DH), piscine (120 DH/m²), voile (160 DH/m) – garantie 10 ans."
};

const RDV_QUESTIONS = [
  { field: "nom", prompt: "👤 Votre nom complet ?" },
  { field: "telephone", prompt: "📞 Numéro de téléphone ?" },
  { field: "ville", prompt: "📍 Ville du projet ?" },
  { field: "type", prompt: "🏗️ Type de projet ?" },
  { field: "date", prompt: "📅 Date souhaitée ?" },
  { field: "heure", prompt: "⏰ Heure souhaitée ?" },
  { field: "description", prompt: "📝 Description rapide du besoin ?" }
];

const DEVIS_QUESTIONS = [
  { key: "type", q: "📋 Type de projet ?\n- Villa\n- Immeuble\n- Appartement\n- Local commercial\n- Piscine\n- Étanchéité\n- Rénovation\n- Mur de clôture\n- Études de projet" },
  { key: "city", q: "📍 Ville du projet ?" },
  { key: "surface", q: "📐 Surface totale en m² ?" },
  { key: "floors", q: "🏢 Nombre d’étages ? (RDC, R+1, R+2...)" },
  { key: "basement", q: "🏚️ Sous-sol ? (Oui/Non)" },
  { key: "structure", q: "🧱 Type de structure ?\n- Hourdis\n- Post-tension" },
  { key: "materiaux", q: "📦 Matériaux inclus ? (Oui/Non)" },
  { key: "pool_choice", q: "🏊 Option piscine ? (Oui/Non)" },
  { key: "pool_surface", q: "🏊 Surface piscine (m²) ? (ex: 32)", condition: (d) => d.pool_choice === "Oui" },
  { key: "detail_level", q: "🎯 Estimation rapide ou détaillée ?\n- Rapide\n- Détaillée" }
];

// ========================= FLOWS =========================
function startDevis(sess, prefill = {}) {
  sess.flow = "devis";
  sess.collectedData = { ...prefill };
  return gotoNextDevisStep(sess);
}

function gotoNextDevisStep(sess) {
  const d = sess.collectedData;
  for (let step of DEVIS_QUESTIONS) {
    if (step.condition && !step.condition(d)) continue;
    if (d[step.key] === undefined || d[step.key] === "") {
      sess.stage = step.key;
      return step.q;
    }
  }
  return computeAndShowDevis(sess);
}

function processDevisInput(sess, msg, sessionId) {
  const stepKey = sess.stage;
  const d = sess.collectedData;

  if (stepKey === "type") {
    const detected = detectProjectTypeFromText(msg);
    if (detected) {
      d.type = detected.type;
      if (detected.subtype) d.subtype = detected.subtype;
    } else if (/villa/i.test(msg)) d.type = "Construction", d.subtype = "Villa";
    else if (/immeuble/i.test(msg)) d.type = "Construction", d.subtype = "Immeuble";
    else if (/appartement/i.test(msg)) d.type = "Construction", d.subtype = "Appartement";
    else if (/local commercial/i.test(msg)) d.type = "Construction", d.subtype = "Local commercial";
    else if (/piscine/i.test(msg)) d.type = "Piscine clés en main";
    else if (/renovation|rénovation/i.test(msg)) d.type = "Rénovation";
    else if (/etancheite|étanchéité/i.test(msg)) d.type = "Étanchéité";
    else if (/mur de cloture|cloture/i.test(msg)) d.type = "Mur de clôture";
    else if (/etude|étude|plan|permis/i.test(msg)) d.type = "Études de projet";
    else {
      if (!sess.retryCount[stepKey]) sess.retryCount[stepKey] = 0;
      sess.retryCount[stepKey]++;
      if (sess.retryCount[stepKey] >= 2) {
        d.type = "Construction";
        d.subtype = "Villa";
      } else return "Type non reconnu. Exemples : Villa, Rénovation, Piscine...";
    }
    return gotoNextDevisStep(sess);
  }

  if (stepKey === "city") {
    d.city = msg.trim();
    return gotoNextDevisStep(sess);
  }

  if (stepKey === "surface") {
    let surf = parseInt(msg.replace(/[^0-9]/g, ""));
    if (isNaN(surf) || surf < 5) {
      if ((sess.retryCount[stepKey] = (sess.retryCount[stepKey]||0)+1) >= 2) d.surface = 150;
      else return "Surface en m² ? (ex: 250)";
    } else d.surface = surf;
    return gotoNextDevisStep(sess);
  }

  if (stepKey === "floors") {
    let floors = 1;
    if (/rdc/i.test(msg)) floors = 1;
    else {
      let m = msg.match(/(\d+)/);
      if (m) floors = parseInt(m[1]) + 1;
    }
    d.floors = floors;
    return gotoNextDevisStep(sess);
  }

  if (stepKey === "basement") {
    d.basement = /oui|o|yes|y|1/.test(msg);
    if (d.basement && d.floors) d.floors += 1;
    return gotoNextDevisStep(sess);
  }

  if (stepKey === "structure") {
    d.structure = /post[ -]?tension/i.test(msg) ? "post-tension" : "hourdis";
    return gotoNextDevisStep(sess);
  }

  if (stepKey === "materiaux") {
    d.materiaux = /oui|o|yes|y|1/.test(msg);
    return gotoNextDevisStep(sess);
  }

  if (stepKey === "pool_choice") {
    d.pool = /oui|o|yes|y|1/.test(msg);
    return gotoNextDevisStep(sess);
  }

  if (stepKey === "pool_surface") {
    let ps = parseInt(msg.replace(/[^0-9]/g, ""));
    d.poolSurface = (ps >= 5 && ps <= 500) ? ps : 32;
    return gotoNextDevisStep(sess);
  }

  if (stepKey === "detail_level") {
    d.detailLevel = /détaillé|detail|complet/i.test(msg) ? "détaillé" : "rapide";
    return computeAndShowDevis(sess);
  }
  return null;
}

function computeAndShowDevis(sess) {
  const d = sess.collectedData;
  const projet = {
    type: d.type,
    subtype: d.subtype,
    surface: d.surface,
    floors: d.floors || 1,
    structure: d.structure,
    pool: d.pool,
    poolSurface: d.poolSurface,
    clotureLength: d.surface, // pour mur de clôture
    etancheiteType: "terrasse"
  };
  const { sousTotal, marge, total, details } = calculerDevis(projet);
  d.estimate_total = total;
  sess.stage = "result";

  let reply = "";
  if (d.detailLevel === "détaillé") {
    reply = `📊 ESTIMATION ERPAC\n\n`;
    reply += `🏗️ Type : ${d.subtype || d.type}\n`;
    if (d.city) reply += `📍 Ville : ${d.city}\n`;
    if (d.surface) reply += `📐 Surface : ${d.surface} m²\n`;
    if (d.floors) reply += `📏 Niveaux : ${d.floors}\n`;
    if (d.structure) reply += `🧱 Structure : ${d.structure === "post-tension" ? "Post-tension" : "Hourdis"}\n`;
    reply += `━━━━━━━━━━━━━━━━━\n\n`;
    details.forEach(d => reply += d + "\n\n");
    reply += `━━━━━━━━━━━━━━━━━\n\n`;
    reply += `Sous-total : ${sousTotal.toLocaleString()} DH\n`;
    reply += `Marge ERPAC 15% : ${marge.toLocaleString()} DH\n`;
    reply += `💰 TOTAL ESTIMATIF : ${total.toLocaleString()} DH TTC\n\n`;
    reply += `⚠️ Estimation approximative avant visite technique.\n\n`;
  } else {
    reply = `📊 *Estimation rapide ERPAC*\n\n🏗️ ${d.subtype || d.type}\n📍 ${d.city || "?"}\n📐 ${d.surface || "?"} m²\n💰 Total estimatif : ${total.toLocaleString()} DH TTC\n\n⚠️ Estimation indicative.`;
  }
  reply += `\nSouhaitez-vous :\n1️⃣ Être contacté\n2️⃣ Envoyer photos/plans\n3️⃣ Modifier\n4️⃣ Menu`;
  return reply;
}

function handleDevisResult(sess, msg, sessionId) {
  const opt = msg.trim().toLowerCase();
  if (opt === "1" || /contact|conseiller/i.test(msg)) return startContactCollection(sess, "devis");
  if (opt === "2" || /photo|plan/i.test(msg)) return "📎 Envoyez vos photos/plans ici. Un conseiller vous recontactera.";
  if (opt === "3" || /modifier|recommencer/i.test(msg)) return startDevis(sess, {});
  if (opt === "4" || /menu|accueil/i.test(msg)) { resetSession(sessionId); return MAIN_MENU; }
  if (/oui|yes/i.test(msg)) return startContactCollection(sess, "devis");
  return "Répondez 1, 2, 3 ou 4.";
}

function startContactCollection(sess, origin) {
  sess.flow = "contact";
  sess.stage = "nom";
  sess.collectedData.contact = {};
  return `Pour être contacté :\n👤 Votre nom complet ?`;
}

function processContactInput(sess, msg, sessionId) {
  const stage = sess.stage;
  const contact = sess.collectedData.contact;
  if (stage === "nom") {
    if (msg.trim().length < 2) return "Votre nom complet ?";
    contact.nom = msg.trim();
    sess.stage = "telephone";
    return "📞 Numéro de téléphone ?";
  }
  if (stage === "telephone") {
    const cleaned = msg.replace(/[\s\-]/g, "");
    if (!/[0-9]{8,}/.test(cleaned)) return "Numéro invalide. Format: 0612345678";
    contact.telephone = msg.trim();
    sess.stage = "email";
    return "📧 Email ? (tapez 'non' pour ignorer)";
  }
  if (stage === "email") {
    contact.email = /non|skip|rien/i.test(msg) ? "non fourni" : msg.trim();
    const client = { nom: contact.nom, telephone: contact.telephone, email: contact.email };
    const errors = validateLead(client);
    if (errors.length) return `Erreur: ${errors.join(", ")}`;
    const project = {
      type: sess.collectedData.type || "",
      city: sess.collectedData.city || "",
      surface: sess.collectedData.surface || "",
      pool: sess.collectedData.pool
    };
    const total = sess.collectedData.estimate_total || "À définir";
    const score = estimateLeadScore(client, project, total);
    notifyLead(client, project, total, score.label);
    delete sessions[sessionId];
    return `✅ *Merci ${contact.nom} !*\n\nVotre demande est enregistrée.\nUn conseiller vous contactera sous 24h.\n\nBonne journée 😊`;
  }
  return null;
}

function startRdv(sess) {
  sess.flow = "rdv";
  sess.rdvStep = 0;
  sess.rdvData = {};
  return `Très bien 😊\nPour organiser votre rendez-vous avec ERPAC :\n\n${RDV_QUESTIONS[0].prompt}`;
}

function processRdvInput(sess, msg, sessionId) {
  if (sess.flow !== "rdv") return null;
  const step = sess.rdvStep;
  if (step >= RDV_QUESTIONS.length) {
    const rdv = sess.rdvData;
    if (!rdv.nom || !rdv.telephone || !rdv.ville || !rdv.type) {
      // redemander le premier champ manquant
      if (!rdv.nom) sess.rdvStep = 0;
      else if (!rdv.telephone) sess.rdvStep = 1;
      else if (!rdv.ville) sess.rdvStep = 2;
      else if (!rdv.type) sess.rdvStep = 3;
      return RDV_QUESTIONS[sess.rdvStep].prompt;
    }
    const client = { nom: rdv.nom, telephone: rdv.telephone, email: "" };
    const project = { type: rdv.type, city: rdv.ville };
    const score = estimateLeadScore(client, project, "RDV");
    notifyLead(client, project, "RDV", score.label);
    const recap = `Merci 🙏 Votre rendez-vous a bien été enregistré.

📌 Récapitulatif :
👤 ${rdv.nom}
📞 ${rdv.telephone}
📍 ${rdv.ville}
🏗️ ${rdv.type}
📅 ${rdv.date || "non précisée"}
⏰ ${rdv.heure || "non précisée"}
📝 ${rdv.description || ""}

Un conseiller ERPAC vous contactera pour confirmer.

Souhaitez-vous :
1️⃣ Retour menu
2️⃣ Demander un devis
3️⃣ Contacter un conseiller`;
    delete sessions[sessionId];
    return recap;
  }
  const current = RDV_QUESTIONS[step];
  let val = msg.trim();
  if (val === "") return current.prompt;
  sess.rdvData[current.field] = val;
  sess.rdvStep++;
  if (sess.rdvStep < RDV_QUESTIONS.length) return RDV_QUESTIONS[sess.rdvStep].prompt;
  return processRdvInput(sess, "", sessionId);
}

function startServices(sess) {
  sess.flow = "services";
  sess.stage = "services_menu";
  return SERVICES_TEXT;
}

function processServicesInput(sess, msg, sessionId) {
  const opt = msg.trim();
  if (opt === "1") {
    resetSession(sessionId);
    return startDevis(getSession(sessionId), {});
  }
  if (opt === "2") {
    resetSession(sessionId);
    return MAIN_MENU;
  }
  return "Option non reconnue. 1️⃣ Devis, 2️⃣ Menu.";
}

function startSpecialites(sess) {
  sess.flow = "specialites";
  sess.stage = "specialites_menu";
  return SPECIALITES_MENU;
}

function processSpecialitesInput(sess, msg, sessionId) {
  const opt = msg.trim();
  if (opt === "menu") {
    resetSession(sessionId);
    return MAIN_MENU;
  }
  if (SPECIALITES_DETAIL[opt]) {
    sess.stage = "specialites_followup";
    sess.tempSpecialite = opt;
    return `${SPECIALITES_DETAIL[opt]}\n\nSouhaitez-vous un devis pour cette spécialité ? (Oui/Non)`;
  }
  return "Tapez 1 à 6 ou 'menu'.";
}

function processSpecialitesFollowup(sess, msg, sessionId) {
  if (/oui|yes|o|y|devis|estimation/.test(msg)) {
    resetSession(sessionId);
    const newSess = getSession(sessionId);
    newSess.collectedData = { type: "Construction" };
    if (sess.tempSpecialite === "1") newSess.collectedData.subtype = "Villa";
    else if (sess.tempSpecialite === "2") newSess.collectedData.subtype = "Immeuble";
    else if (sess.tempSpecialite === "3") newSess.collectedData.type = "Piscine clés en main";
    else if (sess.tempSpecialite === "4") newSess.collectedData.type = "Rénovation";
    else if (sess.tempSpecialite === "5") newSess.collectedData.subtype = "Local commercial";
    else if (sess.tempSpecialite === "6") newSess.collectedData.type = "Étanchéité";
    return startDevis(newSess, newSess.collectedData);
  }
  resetSession(sessionId);
  return MAIN_MENU;
}

// ========================= MAIN PROCESSOR =========================
function processMessage(sessionId, raw) {
  if (!raw || !raw.trim()) return { reply: MAIN_MENU, next_step: "menu" };
  const msg = raw.trim();
  const sess = getSession(sessionId);

  // 1. Small talk / salutations (prioritaires, sauf si en plein flow important)
  if (!sess.flow || sess.flow === "services" || sess.flow === "specialites" || sess.flow === "menu") {
    const small = checkSmallTalk(msg);
    if (small) return { reply: small, next_step: sess.flow || "menu" };
    if (checkGreeting(msg)) return { reply: "Bonjour 👋 Bienvenue chez ERPAC Construction.\n\n" + MAIN_MENU, next_step: "menu" };
  }

  // 2. Intents globaux (toujours actifs)
  const intent = detectIntent(msg);
  if (intent) {
    if (intent === "menu") { resetSession(sessionId); return { reply: MAIN_MENU, next_step: "menu" }; }
    if (intent === "devis") { resetSession(sessionId); return { reply: startDevis(getSession(sessionId), {}), next_step: "devis" }; }
    if (intent === "rdv") { resetSession(sessionId); return { reply: startRdv(getSession(sessionId)), next_step: "rdv" }; }
    if (intent === "services") { resetSession(sessionId); return { reply: startServices(getSession(sessionId)), next_step: "services" }; }
    if (intent === "specialites") { resetSession(sessionId); return { reply: startSpecialites(getSession(sessionId)), next_step: "specialites" }; }
    if (intent === "conseiller") { resetSession(sessionId); return { reply: startContactCollection(getSession(sessionId), "direct"), next_step: "contact" }; }
    if (intent === "projets") {
      return { reply: `🔗 Nos réalisations : https://www.erpac.ma/projects.cfm\n\nSouhaitez-vous une estimation personnalisée ? (Oui/Non)`, next_step: "projects_redirect" };
    }
  }

  // 3. Redirection projets
  if (sess.stage === "projects_redirect") {
    if (/oui|yes|o|y/.test(msg)) {
      resetSession(sessionId);
      return { reply: startDevis(getSession(sessionId), {}), next_step: "devis" };
    }
    resetSession(sessionId);
    return { reply: MAIN_MENU, next_step: "menu" };
  }

  // 4. Flows actifs
  if (sess.flow === "devis") {
    if (sess.stage === "result") {
      const reply = handleDevisResult(sess, msg, sessionId);
      if (reply) return { reply, next_step: "devis_result" };
    } else {
      const reply = processDevisInput(sess, msg, sessionId);
      if (reply) return { reply, next_step: sess.stage };
    }
  }
  if (sess.flow === "contact") {
    const reply = processContactInput(sess, msg, sessionId);
    if (reply) return { reply, next_step: "contact" };
  }
  if (sess.flow === "rdv") {
    const reply = processRdvInput(sess, msg, sessionId);
    if (reply) return { reply, next_step: "rdv" };
  }
  if (sess.flow === "services") {
    const reply = processServicesInput(sess, msg, sessionId);
    if (reply) return { reply, next_step: "services" };
  }
  if (sess.flow === "specialites") {
    if (sess.stage === "specialites_menu") {
      const reply = processSpecialitesInput(sess, msg, sessionId);
      if (reply) return { reply, next_step: "specialites" };
    } else if (sess.stage === "specialites_followup") {
      const reply = processSpecialitesFollowup(sess, msg, sessionId);
      if (reply) return { reply, next_step: "specialites_followup" };
    }
  }

  // 5. Menu principal par numéro
  const num = msg.trim();
  if (num === "1") return { reply: startDevis(sess, {}), next_step: "devis" };
  if (num === "2") return { reply: startServices(sess), next_step: "services" };
  if (num === "3") return { reply: `🔗 Nos réalisations : https://www.erpac.ma/projects.cfm\n\nSouhaitez-vous une estimation ? (Oui/Non)`, next_step: "projects_redirect" };
  if (num === "4") return { reply: startRdv(sess), next_step: "rdv" };
  if (num === "5") return { reply: startSpecialites(sess), next_step: "specialites" };

  // 6. Extraction automatique d'un projet depuis le texte libre
  const extracted = extractFullProject(msg);
  if (extracted.surface || extracted.city || extracted.type) {
    resetSession(sessionId);
    const newSess = getSession(sessionId);
    newSess.collectedData = extracted;
    const firstMissing = DEVIS_QUESTIONS.find(q => newSess.collectedData[q.key] === undefined);
    if (firstMissing) return { reply: startDevis(newSess, extracted), next_step: "devis" };
    return { reply: computeAndShowDevis(newSess), next_step: "devis_result" };
  }

  // 7. Fallback intelligent
  return { reply: `Je n'ai pas bien compris 😅\n\n` + MAIN_MENU, next_step: "menu" };
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

app.get("/health", (_, res) => res.json({ status: "ok", version: "erpac-premium-v1" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🏗️ ERPAC Premium Bot sur port ${PORT}`);
  await initGoogleSheets();
  console.log(`📝 Leads: ${LEADS_FILE}`);
});
