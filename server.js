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

// ========================= GOOGLE SHEETS (optional) =========================
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
let sheets = null;
let googleSheetsEnabled = false;

async function initGoogleSheets() {
  if (!SPREADSHEET_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) return false;
  try {
    const privateKey = GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
    const auth = new google.auth.JWT(GOOGLE_CLIENT_EMAIL, null, privateKey, ["https://www.googleapis.com/auth/spreadsheets"]);
    sheets = google.sheets({ version: "v4", auth });
    await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    googleSheetsEnabled = true;
    console.log("✅ Google Sheets connecté");
    return true;
  } catch (error) {
    console.error("❌ Sheets error:", error.message);
    return false;
  }
}

async function addLeadToSheet(clientData, projectData, total, scoreLabel) {
  if (!googleSheetsEnabled) return false;
  const now = new Date().toLocaleString("fr-MA", { timeZone: "Africa/Casablanca" });
  const values = [[
    now, clientData.nom || "", clientData.telephone || "", clientData.email || "",
    projectData.type || "", projectData.city || "", projectData.surface || "",
    projectData.pool ? `Oui (${projectData.poolSurface || "?"} m²)` : "Non",
    total, scoreLabel, "Nouveau"
  ]];
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Leads!A:K",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      resource: { values },
    });
    return true;
  } catch (err) { return false; }
}

const LEADS_FILE = path.join(__dirname, "leads.json");
function saveLeadToFile(clientData, projectData, total, scoreLabel) {
  const lead = { timestamp: new Date().toISOString(), client: clientData, project: projectData, amount: total, score: scoreLabel };
  let leads = [];
  if (fs.existsSync(LEADS_FILE)) try { leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8")); } catch(e) { leads = []; }
  leads.push(lead);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

async function notifyLead(clientData, projectData, total, scoreLabel) {
  saveLeadToFile(clientData, projectData, total, scoreLabel);
  await addLeadToSheet(clientData, projectData, total, scoreLabel);
}

function estimateLeadScore(clientData, projectData, total) {
  let score = 0;
  if ((clientData.nom || "").length > 2) score += 20;
  if (/^(\+212|0)[0-9]{9,}$/.test((clientData.telephone || "").replace(/[\s\-]/g, ""))) score += 25;
  if (projectData.city) score += 10;
  if (projectData.surface) score += 10;
  if (projectData.type) score += 10;
  let label = "Froid";
  if (score >= 70) label = "Chaud 🔥";
  else if (score >= 45) label = "Tiède 🌡️";
  return { score, label };
}

// ========================= PRICING =========================
const PRICES = {
  etudes: 60, grosOeuvreHourdis: 1200, grosOeuvrePostTension: 1600, murCloture: 400,
  finition: 3000, renovation: 6000, etancheite: { terrasse: 365, sdb: 90, piscine: 120, voile: 160 },
  piscine: 3500, marge: 0.15
};

function calculerDevis(projet) {
  let sousTotal = 0, details = [];
  if (["Construction","Villa","Immeuble","Appartement","Local commercial"].includes(projet.type) && projet.surface && projet.floors) {
    const goPrice = projet.structure === "post-tension" ? PRICES.grosOeuvrePostTension : PRICES.grosOeuvreHourdis;
    const go = projet.surface * projet.floors * goPrice;
    details.push(`🏗️ Gros œuvre (${projet.structure === "post-tension" ? "post-tension" : "hourdis"}) : ${projet.surface} m² × ${projet.floors} niveaux × ${goPrice} DH = ${go.toLocaleString()} DH`);
    sousTotal += go;
    const fin = projet.surface * projet.floors * PRICES.finition;
    details.push(`🎨 Finition : ${projet.surface} m² × ${projet.floors} niveaux × ${PRICES.finition} DH = ${fin.toLocaleString()} DH`);
    sousTotal += fin;
  } else if (projet.type === "Rénovation" && projet.surface) {
    const cost = projet.surface * PRICES.renovation;
    details.push(`🔄 Rénovation : ${projet.surface} m² × ${PRICES.renovation} DH = ${cost.toLocaleString()} DH`);
    sousTotal += cost;
  } else if (projet.type === "Étanchéité") {
    const type = projet.etancheiteType || "terrasse";
    const qty = type === "sdb" ? 1 : (projet.surface || 0);
    const cost = qty * (PRICES.etancheite[type] || 365);
    details.push(`💧 Étanchéité ${type} : ${qty} ${type==="voile"?"m":"m²"} × ${PRICES.etancheite[type]} DH = ${cost.toLocaleString()} DH`);
    sousTotal += cost;
  } else if (projet.type === "Piscine clés en main" && projet.poolSurface) {
    const cost = projet.poolSurface * PRICES.piscine;
    details.push(`🏊 Piscine clés en main : ${projet.poolSurface} m² × ${PRICES.piscine} DH = ${cost.toLocaleString()} DH`);
    sousTotal += cost;
  } else if (projet.type === "Mur de clôture" && projet.clotureLength) {
    const cost = projet.clotureLength * PRICES.murCloture;
    details.push(`🧱 Mur de clôture : ${projet.clotureLength} m × ${PRICES.murCloture} DH = ${cost.toLocaleString()} DH`);
    sousTotal += cost;
  } else if (projet.type === "Études de projet" && projet.surface) {
    const cost = projet.surface * PRICES.etudes;
    details.push(`📐 Études de projet : ${projet.surface} m² × ${PRICES.etudes} DH = ${cost.toLocaleString()} DH`);
    sousTotal += cost;
  }
  if (projet.pool && projet.type !== "Piscine clés en main" && projet.poolSurface) {
    const cost = projet.poolSurface * PRICES.piscine;
    details.push(`🏊 Option piscine : ${projet.poolSurface} m² × ${PRICES.piscine} DH = ${cost.toLocaleString()} DH`);
    sousTotal += cost;
  }
  const marge = sousTotal * PRICES.marge;
  const total = sousTotal + marge;
  return { sousTotal, marge, total, details };
}

// ========================= SESSION =========================
const sessions = {};
const SESSION_TIMEOUT = 30 * 60 * 1000;
function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = {
      flow: null, stage: null, collected: {}, retry: {}, lastActive: Date.now(),
      pendingQuestion: null, smallTalkExpected: false
    };
  }
  sessions[id].lastActive = Date.now();
  return sessions[id];
}
function resetSession(id) { delete sessions[id]; getSession(id); }
setInterval(() => {
  const now = Date.now();
  for (const id of Object.keys(sessions)) if (now - sessions[id].lastActive > SESSION_TIMEOUT) delete sessions[id];
}, 10 * 60 * 1000);

// ========================= SMALL TALK & GREETINGS =========================
const GREETING_WORDS = ["bonjour","bonsoir","salut","salam","slm","hey","yo","coucou","bsr","bjr","hello","hi","labas","labass"];
const SMALL_TALK_RESPONSES = {
  "merci": ["Avec plaisir 😊", "Je vous en prie !"],
  "cava|ça va|comment vas-tu|labas": "Très bien merci 😊 Et vous ?",
  "bien|good|all good|fine|ok|oui|yes|ça va bien|très bien": "Tant mieux 😊 Comment puis-je vous aider ?",
  "tu es qui|t'es qui|qui es-tu": "Je suis l'assistant virtuel ERPAC 🤖",
  "robot|bot|ia": "Je suis votre assistant commercial ERPAC, 100% local 😊",
  "ouvert|heure|horaires": "Nous sommes ouverts du lundi au samedi de 8h30 à 16h30.",
  "aide|help|assistance": "🤝 Je peux vous aider : devis, services, rendez-vous."
};
function matchSmallTalk(text) {
  const lower = text.toLowerCase();
  if (/^(bien|good|all good|ok|ça va bien)$/i.test(lower)) return SMALL_TALK_RESPONSES["bien|good|all good|fine|ok|oui|yes|ça va bien|très bien"];
  for (const [key, val] of Object.entries(SMALL_TALK_RESPONSES)) {
    if (new RegExp(`\\b${key}\\b`, "i").test(lower)) return Array.isArray(val) ? val[Math.floor(Math.random()*val.length)] : val;
  }
  return null;
}
function isGreeting(text) {
  const lower = text.trim().toLowerCase();
  return GREETING_WORDS.some(g => lower === g || lower.startsWith(g));
}

// ========================= INTENT DETECTION =========================
function detectIntent(text) {
  const t = text.toLowerCase();
  if (/^(menu|accueil|retour|annuler|stop|home|recommencer)$/.test(t)) return "menu";
  if (/devis|estimation|prix|tarif|coût|quote|combien/.test(t)) return "devis";
  if (/service|services|offre|prestations/.test(t)) return "services";
  if (/rdv|rendez-vous|appointment|visite|rencontrer/.test(t)) return "rdv";
  if (/projets|réalisations|references/.test(t)) return "projets";
  if (/conseiller|agent|humain|parler à|appel|contact/.test(t)) return "conseiller";
  if (/spécialités|specialites/.test(t)) return "specialites";
  return null;
}

// ========================= EXTRACTION INTELLIGENTE =========================
const CITIES = ["casablanca","rabat","marrakech","tanger","fès","meknès","agadir","oujda","témara","salé","mohammedia","kenitra"];
function extractCity(text) {
  const lower = text.toLowerCase();
  for (const c of CITIES) if (lower.includes(c)) return c.charAt(0).toUpperCase() + c.slice(1);
  return null;
}
function extractSurface(text) {
  let m = text.match(/(\d{2,4})\s*m[²2]?/i);
  if (!m) m = text.match(/\b(\d{2,4})\b/);
  if (m && m[1] >= 10 && m[1] <= 5000) return parseInt(m[1]);
  return null;
}
function extractFloors(text) {
  const m = text.match(/r\+(\d)/i);
  if (m) return parseInt(m[1]) + 1;
  if (/rdc/i.test(text)) return 1;
  return null;
}
function extractBasement(text) { return /sous[\s-]?sol/i.test(text); }
function extractPool(text) {
  if (!/piscine/i.test(text)) return { pool: false };
  const m = text.match(/piscine[^0-9]*(\d+)\s*m/i);
  return { pool: true, poolSurface: m ? parseInt(m[1]) : null };
}
function extractStructure(text) {
  if (/post[ -]?tension/i.test(text)) return "post-tension";
  if (/hourdis/i.test(text)) return "hourdis";
  return null;
}
function extractProjectType(text) {
  const t = text.toLowerCase();
  if (/villa|maison|résidence/.test(t)) return { type: "Construction", subtype: "Villa" };
  if (/immeuble|appartement/.test(t)) return { type: "Construction", subtype: "Immeuble" };
  if (/local commercial|bureau|commerce/.test(t)) return { type: "Construction", subtype: "Local commercial" };
  if (/renovation|rénovation/.test(t)) return { type: "Rénovation" };
  if (/piscine/.test(t)) return { type: "Piscine clés en main" };
  if (/etancheite|étanchéité|fuite/.test(t)) return { type: "Étanchéité" };
  if (/mur de cloture|cloture/.test(t)) return { type: "Mur de clôture" };
  if (/etude|étude|plan|permis/.test(t)) return { type: "Études de projet" };
  return null;
}
function extractFullProject(text) {
  const out = {};
  const city = extractCity(text); if (city) out.city = city;
  const surf = extractSurface(text); if (surf) out.surface = surf;
  const floors = extractFloors(text); if (floors !== null) out.floors = floors;
  if (extractBasement(text)) out.basement = true;
  const poolInfo = extractPool(text); if (poolInfo.pool) { out.pool = true; if (poolInfo.poolSurface) out.poolSurface = poolInfo.poolSurface; }
  const structure = extractStructure(text); if (structure) out.structure = structure;
  const typeInfo = extractProjectType(text); if (typeInfo) { out.type = typeInfo.type; if (typeInfo.subtype) out.subtype = typeInfo.subtype; }
  return out;
}

// ========================= FLOW TEXTES =========================
const MAIN_MENU = `Bonjour 👋 Bienvenue chez ERPAC Construction.

1️⃣ Demander un devis
2️⃣ Découvrir nos services
3️⃣ Voir nos projets réalisés
4️⃣ Prendre rendez-vous
5️⃣ Nos spécialités`;

const SERVICES_TEXT = `🏗️ SERVICES ERPAC

✅ 📐 Études & Conception
✅ 🏗️ Construction Générale
✅ 🏗️ Gros Œuvre
✅ 🔧 Lots Techniques (Second Œuvre)
✅ 🎨 Aménagement & Décoration
✅ 💧 Étanchéité (garantie 10 ans)
✅ 🏊 Construction de Piscines
✅ 🔄 Rénovation & Réhabilitation
✅ 🪑 Mobilier sur Mesure
✅ 🪚 Menuiserie
✅ 🧱 Cloisonnement & Faux Plafonds

Qualité, délais, accompagnement personnalisé.

1️⃣ Demander un devis
2️⃣ Retour menu`;

const SPECIALITES_MENU = `🔧 Nos spécialités

1️⃣ Villas
2️⃣ Immeubles
3️⃣ Piscines
4️⃣ Rénovation
5️⃣ Locaux commerciaux
6️⃣ Étanchéité

Tapez le numéro ou "menu" pour revenir.`;

const SPECIALITES_DETAIL = {
  "1": "🏡 Villas : construction sur mesure R+1/R+2, finitions haut standing, piscine, étanchéité.",
  "2": "🏢 Immeubles : résidentiel R+2 à R+5, structure béton armé, ascenseurs.",
  "3": "🏊 Piscines : clés en main, débordement, traditionnelles, intérieures – 3500 DH/m².",
  "4": "🔄 Rénovation : complète ou partielle, villas, appartements, locaux – 6000 DH/m².",
  "5": "🏬 Locaux commerciaux : bureaux, restaurants, cliniques, boutiques.",
  "6": "💧 Étanchéité : terrasses (365 DH/m²), SDB (90 DH), piscine (120 DH/m²), voile (160 DH/m)."
};

const DEVIS_QUESTIONS = [
  { key: "type", q: "📋 Type de projet ?\n- Villa\n- Immeuble\n- Appartement\n- Local commercial\n- Piscine\n- Étanchéité\n- Rénovation\n- Mur de clôture\n- Études de projet" },
  { key: "city", q: "📍 Ville du projet ?" },
  { key: "surface", q: "📐 Surface totale en m² ?" },
  { key: "floors", q: "🏢 Nombre d’étages ? (RDC, R+1, R+2...)" },
  { key: "basement", q: "🏚️ Sous-sol ? (Oui/Non)" },
  { key: "structure", q: "🧱 Type de structure ?\n- Hourdis\n- Post-tension" },
  { key: "materiaux", q: "📦 Matériaux inclus ? (Oui/Non)" },
  { key: "pool_choice", q: "🏊 Option piscine ? (Oui/Non)" },
  { key: "pool_surface", q: "🏊 Surface piscine (m²) ? (ex: 32)", condition: d => d.pool_choice === "Oui" },
  { key: "detail_level", q: "🎯 Estimation rapide ou détaillée ?\n- Rapide\n- Détaillée" }
];

const RDV_QUESTIONS = [
  { field: "nom", prompt: "👤 Votre nom complet ?" },
  { field: "telephone", prompt: "📞 Numéro de téléphone ?" },
  { field: "ville", prompt: "📍 Ville du projet ?" },
  { field: "type", prompt: "🏗️ Type de projet ?" },
  { field: "date", prompt: "📅 Date souhaitée ?" },
  { field: "heure", prompt: "⏰ Heure souhaitée ?" },
  { field: "description", prompt: "📝 Description rapide du besoin ?" }
];

// ========================= FLOW DEVIS =========================
function startDevis(sess, prefill = {}) {
  sess.flow = "devis";
  sess.collected = { ...prefill };
  sess.stage = null;
  return gotoNextDevisStep(sess);
}
function gotoNextDevisStep(sess) {
  const d = sess.collected;
  for (let step of DEVIS_QUESTIONS) {
    if (step.condition && !step.condition(d)) continue;
    if (d[step.key] === undefined || d[step.key] === "") {
      sess.stage = step.key;
      return step.q;
    }
  }
  return computeDevis(sess);
}
function processDevisInput(sess, msg, sessionId) {
  const key = sess.stage;
  const d = sess.collected;
  if (key === "type") {
    const detected = extractProjectType(msg);
    if (detected) { d.type = detected.type; if (detected.subtype) d.subtype = detected.subtype; }
    else if (/villa/i.test(msg)) d.type = "Construction", d.subtype = "Villa";
    else if (/immeuble/i.test(msg)) d.type = "Construction", d.subtype = "Immeuble";
    else if (/appartement/i.test(msg)) d.type = "Construction", d.subtype = "Appartement";
    else if (/local commercial/i.test(msg)) d.type = "Construction", d.subtype = "Local commercial";
    else if (/piscine/i.test(msg)) d.type = "Piscine clés en main";
    else if (/renovation/i.test(msg)) d.type = "Rénovation";
    else if (/etancheite/i.test(msg)) d.type = "Étanchéité";
    else if (/mur de cloture/i.test(msg)) d.type = "Mur de clôture";
    else if (/etude|étude/i.test(msg)) d.type = "Études de projet";
    else return "Type non reconnu. Exemples : Villa, Rénovation, Piscine...";
    return gotoNextDevisStep(sess);
  }
  if (key === "city") { d.city = msg.trim(); return gotoNextDevisStep(sess); }
  if (key === "surface") {
    let s = parseInt(msg.replace(/[^0-9]/g, ""));
    if (isNaN(s) || s < 5) return "Surface en m² ? (ex: 250)";
    d.surface = s;
    return gotoNextDevisStep(sess);
  }
  if (key === "floors") {
    let f = 1;
    if (/rdc/i.test(msg)) f = 1;
    else { let m = msg.match(/(\d+)/); if (m) f = parseInt(m[1]) + 1; }
    d.floors = f;
    return gotoNextDevisStep(sess);
  }
  if (key === "basement") { d.basement = /oui|o|yes|1/.test(msg); if (d.basement && d.floors) d.floors++; return gotoNextDevisStep(sess); }
  if (key === "structure") { d.structure = /post[ -]?tension/i.test(msg) ? "post-tension" : "hourdis"; return gotoNextDevisStep(sess); }
  if (key === "materiaux") { d.materiaux = /oui|o|yes|1/.test(msg); return gotoNextDevisStep(sess); }
  if (key === "pool_choice") { d.pool = /oui|o|yes|1/.test(msg); return gotoNextDevisStep(sess); }
  if (key === "pool_surface") {
    let ps = parseInt(msg.replace(/[^0-9]/g, ""));
    d.poolSurface = (ps >= 5 && ps <= 500) ? ps : 32;
    return gotoNextDevisStep(sess);
  }
  if (key === "detail_level") {
    d.detailLevel = /détaillé|detail/.test(msg) ? "détaillé" : "rapide";
    return computeDevis(sess);
  }
  return null;
}
function computeDevis(sess) {
  const d = sess.collected;
  const projet = {
    type: d.type, subtype: d.subtype, surface: d.surface, floors: d.floors || 1,
    structure: d.structure, pool: d.pool, poolSurface: d.poolSurface,
    clotureLength: d.surface, etancheiteType: "terrasse"
  };
  const { sousTotal, marge, total, details } = calculerDevis(projet);
  d.estimate_total = total;
  sess.stage = "result";
  let reply = "";
  if (d.detailLevel === "détaillé") {
    reply = `📊 ESTIMATION ERPAC\n\n🏗️ ${d.subtype || d.type}\n📍 ${d.city || "?"}\n📐 ${d.surface || "?"} m²\n📏 Niveaux : ${d.floors || 1}\n🧱 Structure : ${d.structure === "post-tension" ? "Post-tension" : "Hourdis"}\n━━━━━━━━━━━━━━━\n\n`;
    details.forEach(d => reply += d + "\n\n");
    reply += `━━━━━━━━━━━━━━━\n\nSous-total : ${sousTotal.toLocaleString()} DH\nMarge 15% : ${marge.toLocaleString()} DH\n💰 TOTAL ESTIMATIF : ${total.toLocaleString()} DH TTC\n\n⚠️ Estimation approximative avant visite technique.\n`;
  } else {
    reply = `📊 Estimation rapide ERPAC\n\n🏗️ ${d.subtype || d.type}\n📍 ${d.city || "?"}\n📐 ${d.surface || "?"} m²\n💰 Total estimatif : ${total.toLocaleString()} DH TTC\n\n⚠️ Estimation indicative.`;
  }
  reply += `\n\nSouhaitez-vous :\n1️⃣ Être contacté\n2️⃣ Envoyer photos/plans\n3️⃣ Modifier\n4️⃣ Menu`;
  return reply;
}
function handleDevisResult(sess, msg, sessionId) {
  const opt = msg.trim().toLowerCase();
  if (opt === "1" || /contact|conseiller|rappel/.test(msg)) return startContact(sess, "devis");
  if (opt === "2" || /photo|plan/.test(msg)) return "📎 Envoyez vos photos/plans ici. Un conseiller vous recontactera.";
  if (opt === "3") return startDevis(sess, sess.collected);
  if (opt === "4" || /menu|accueil/.test(msg)) { resetSession(sessionId); return MAIN_MENU; }
  return "Répondez 1, 2, 3 ou 4.";
}

// ========================= CONTACT FLOW =========================
function startContact(sess, origin) {
  sess.flow = "contact";
  sess.stage = "nom";
  sess.collected.contact = {};
  return `Pour être contacté :\n👤 Votre nom complet ?`;
}
function processContact(sess, msg, sessionId) {
  const stage = sess.stage;
  const cont = sess.collected.contact;
  if (stage === "nom") {
    if (msg.trim().length < 2) return "Votre nom complet ?";
    cont.nom = msg.trim();
    sess.stage = "telephone";
    return "📞 Numéro de téléphone ?";
  }
  if (stage === "telephone") {
    const cleaned = msg.replace(/[\s\-]/g, "");
    if (!/[0-9]{8,}/.test(cleaned)) return "Numéro invalide (ex: 0612345678)";
    cont.telephone = msg.trim();
    sess.stage = "email";
    return "📧 Email ? (tapez 'non' pour ignorer)";
  }
  if (stage === "email") {
    cont.email = /non|skip|rien/.test(msg) ? "non fourni" : msg.trim();
    const client = { nom: cont.nom, telephone: cont.telephone, email: cont.email };
    const project = { type: sess.collected.type || "", city: sess.collected.city || "", surface: sess.collected.surface || "" };
    const score = estimateLeadScore(client, project, sess.collected.estimate_total || "À définir");
    notifyLead(client, project, sess.collected.estimate_total || "À définir", score.label);
    delete sessions[sessionId];
    return `✅ Merci ${client.nom} ! Votre demande est enregistrée. Un conseiller vous contactera sous 24h.\n\nBonne journée 😊`;
  }
  return null;
}

// ========================= RDV FLOW =========================
function startRdv(sess) {
  sess.flow = "rdv";
  sess.rdvStep = 0;
  sess.rdvData = {};
  return `Très bien 😊\nPour organiser votre rendez-vous avec ERPAC :\n\n${RDV_QUESTIONS[0].prompt}`;
}
function processRdv(sess, msg, sessionId) {
  const step = sess.rdvStep;
  if (step >= RDV_QUESTIONS.length) {
    const rdv = sess.rdvData;
    if (!rdv.nom || !rdv.telephone || !rdv.ville || !rdv.type) {
      if (!rdv.nom) sess.rdvStep = 0;
      else if (!rdv.telephone) sess.rdvStep = 1;
      else if (!rdv.ville) sess.rdvStep = 2;
      else if (!rdv.type) sess.rdvStep = 3;
      return RDV_QUESTIONS[sess.rdvStep].prompt;
    }
    const client = { nom: rdv.nom, telephone: rdv.telephone, email: "" };
    const project = { type: rdv.type, city: rdv.ville };
    const score = estimateLeadScore(client, project, "Rendez-vous");
    notifyLead(client, project, "Rendez-vous", score.label);
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
  const curr = RDV_QUESTIONS[step];
  const val = msg.trim();
  if (val === "") return curr.prompt;
  sess.rdvData[curr.field] = val;
  sess.rdvStep++;
  if (sess.rdvStep < RDV_QUESTIONS.length) return RDV_QUESTIONS[sess.rdvStep].prompt;
  return processRdv(sess, "", sessionId);
}

// ========================= SERVICES & SPECIALITES =========================
function startServices(sess) {
  sess.flow = "services";
  sess.stage = "services_menu";
  return SERVICES_TEXT;
}
function processServices(sess, msg) {
  if (msg === "1") { resetSession(sess.id); return startDevis(getSession(sess.id), {}); }
  if (msg === "2") { resetSession(sess.id); return MAIN_MENU; }
  return "Option non reconnue. 1️⃣ Devis, 2️⃣ Menu.";
}
function startSpecialites(sess) {
  sess.flow = "specialites";
  sess.stage = "specialites_menu";
  return SPECIALITES_MENU;
}
function processSpecialites(sess, msg, sessionId) {
  if (msg === "menu") { resetSession(sessionId); return MAIN_MENU; }
  if (SPECIALITES_DETAIL[msg]) {
    sess.stage = "specialites_followup";
    sess.tempSpecialite = msg;
    return `${SPECIALITES_DETAIL[msg]}\n\nSouhaitez-vous un devis pour cette spécialité ? (Oui/Non)`;
  }
  return "Tapez 1 à 6 ou 'menu'.";
}
function processSpecialitesFollowup(sess, msg, sessionId) {
  if (/oui|yes|o|devis/.test(msg)) {
    resetSession(sessionId);
    const newSess = getSession(sessionId);
    let type = "Construction", subtype = "";
    switch (sess.tempSpecialite) {
      case "1": subtype = "Villa"; break;
      case "2": subtype = "Immeuble"; break;
      case "3": type = "Piscine clés en main"; break;
      case "4": type = "Rénovation"; break;
      case "5": subtype = "Local commercial"; break;
      case "6": type = "Étanchéité"; break;
    }
    return startDevis(newSess, { type, subtype });
  }
  resetSession(sessionId);
  return MAIN_MENU;
}

// ========================= MAIN PROCESSOR =========================
function processMessage(sessionId, raw) {
  if (!raw || !raw.trim()) return { reply: MAIN_MENU, next_step: "menu" };
  const msg = raw.trim();
  const sess = getSession(sessionId);
  sess.id = sessionId;

  // 1. Intents globaux PRIORITAIRES (menu, stop, annuler...)
  const intent = detectIntent(msg);
  if (intent === "menu") { resetSession(sessionId); return { reply: MAIN_MENU, next_step: "menu" }; }
  if (intent === "stop" || intent === "annuler") { resetSession(sessionId); return { reply: "D’accord 👍 Retour au menu principal.\n\n" + MAIN_MENU, next_step: "menu" }; }

  // 2. Small talk & salutations (sauf si en plein devis ou rdv, mais on les autorise quand même avec reprise)
  const small = matchSmallTalk(msg);
  if (small) {
    // Si on est dans un flow actif, on répond au small talk puis on reprend le flow
    if (sess.flow && sess.stage) {
      const rep = small + "\n\n" + (sess.flow === "devis" ? "🏗️ " + DEVIS_QUESTIONS.find(q => q.key === sess.stage)?.q || "Continue ?" : (sess.flow === "rdv" ? RDV_QUESTIONS[sess.rdvStep]?.prompt : MAIN_MENU));
      return { reply: rep, next_step: sess.flow };
    }
    return { reply: small, next_step: "idle" };
  }
  if (isGreeting(msg)) {
    if (sess.flow && sess.stage) {
      const rep = "Bonjour 👋 " + (sess.flow === "devis" ? DEVIS_QUESTIONS.find(q => q.key === sess.stage)?.q : (sess.flow === "rdv" ? RDV_QUESTIONS[sess.rdvStep]?.prompt : MAIN_MENU));
      return { reply: rep, next_step: sess.flow };
    }
    return { reply: MAIN_MENU, next_step: "menu" };
  }

  // 3. Autres intents (devis, rdv, services, specialites, conseiller, projets)
  if (intent === "devis") { resetSession(sessionId); return { reply: startDevis(getSession(sessionId), {}), next_step: "devis" }; }
  if (intent === "rdv") { resetSession(sessionId); return { reply: startRdv(getSession(sessionId)), next_step: "rdv" }; }
  if (intent === "services") { resetSession(sessionId); return { reply: startServices(getSession(sessionId)), next_step: "services" }; }
  if (intent === "specialites") { resetSession(sessionId); return { reply: startSpecialites(getSession(sessionId)), next_step: "specialites" }; }
  if (intent === "conseiller") { resetSession(sessionId); return { reply: startContact(getSession(sessionId), "direct"), next_step: "contact" }; }
  if (intent === "projets") {
    return { reply: `🔗 Nos réalisations : https://www.erpac.ma/projects.cfm\n\nSouhaitez-vous une estimation personnalisée ? (Oui/Non)`, next_step: "projects_redirect" };
  }

  // 4. Redirection projets
  if (sess.stage === "projects_redirect") {
    if (/oui|yes|o/.test(msg)) { resetSession(sessionId); return { reply: startDevis(getSession(sessionId), {}), next_step: "devis" }; }
    resetSession(sessionId);
    return { reply: MAIN_MENU, next_step: "menu" };
  }

  // 5. Flows actifs
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
    const reply = processContact(sess, msg, sessionId);
    if (reply) return { reply, next_step: "contact" };
  }
  if (sess.flow === "rdv") {
    const reply = processRdv(sess, msg, sessionId);
    if (reply) return { reply, next_step: "rdv" };
  }
  if (sess.flow === "services") {
    const reply = processServices(sess, msg);
    if (reply) return { reply, next_step: "services" };
  }
  if (sess.flow === "specialites") {
    if (sess.stage === "specialites_menu") {
      const reply = processSpecialites(sess, msg, sessionId);
      if (reply) return { reply, next_step: "specialites" };
    } else if (sess.stage === "specialites_followup") {
      const reply = processSpecialitesFollowup(sess, msg, sessionId);
      if (reply) return { reply, next_step: "specialites_followup" };
    }
  }

  // 6. Extraction automatique directe (ex: "villa 300m r+1 casa piscine")
  const extracted = extractFullProject(msg);
  if (extracted.surface || extracted.city || extracted.type) {
    resetSession(sessionId);
    const newSess = getSession(sessionId);
    newSess.collected = extracted;
    const missing = DEVIS_QUESTIONS.find(q => newSess.collected[q.key] === undefined);
    if (missing) return { reply: startDevis(newSess, extracted), next_step: "devis" };
    return { reply: computeDevis(newSess), next_step: "result" };
  }

  // 7. Menu numérique
  const num = msg.trim();
  if (num === "1") return { reply: startDevis(sess, {}), next_step: "devis" };
  if (num === "2") return { reply: startServices(sess), next_step: "services" };
  if (num === "3") return { reply: `🔗 Nos réalisations : https://www.erpac.ma/projects.cfm\n\nSouhaitez-vous une estimation ? (Oui/Non)`, next_step: "projects_redirect" };
  if (num === "4") return { reply: startRdv(sess), next_step: "rdv" };
  if (num === "5") return { reply: startSpecialites(sess), next_step: "specialites" };

  // 8. Fallback premium
  return { reply: `Je n'ai pas bien compris 😅\n\n` + MAIN_MENU, next_step: "menu" };
}

// ========================= WHATSAPP WEBHOOKS =========================
async function sendWhatsApp(to, text) {
  if (!WA_TOKEN || !WA_PHONE_ID) return;
  if (!text || text.trim() === "") return;
  try {
    const resp = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${WA_TOKEN}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
    });
    if (!resp.ok) console.error("WA Error:", await resp.text());
  } catch(e) { console.error("WhatsApp error:", e); }
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
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg || msg.type !== "text") return;
    const { reply } = processMessage(msg.from, msg.text.body);
    await sendWhatsApp(msg.from, reply);
  } catch(e) { console.error("Webhook error:", e); }
});

app.get("/leads", (req, res) => {
  if (fs.existsSync(LEADS_FILE)) res.json(JSON.parse(fs.readFileSync(LEADS_FILE, "utf8")));
  else res.json([]);
});

app.get("/health", (_, res) => res.json({ status: "ok", version: "erpac-premium-final" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🏗️ ERPAC Premium Bot sur port ${PORT}`);
  await initGoogleSheets();
});
