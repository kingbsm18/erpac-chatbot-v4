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
//  GOOGLE SHEETS & LOCAL STORAGE (identique à la version riche)
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
    `https://wa.me/${clientData.telephone.replace(/[^0-9]/g, "")}`,
    "Nouveau"
  ]];
  try {
    try {
      await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "Feuil1!A1:Q1" });
    } catch {
      const headers = [[
        "Date/Heure", "Nom Client", "Téléphone", "Email", "Type Projet", "Ville",
        "Surface (m²)", "Niveaux", "Standing", "Sous-sol", "Terrain", "Piscine",
        "Clim Gainable", "Domotique", "Montant TTC", "Lien WhatsApp", "Statut"
      ]];
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: "Feuil1!A1:Q1",
        valueInputOption: "USER_ENTERED",
        resource: { values: headers },
      });
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Feuil1!A:Q",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      resource: { values },
    });
    console.log(`✅ Lead ajouté Sheets: ${clientData.nom}`);
    return true;
  } catch (error) {
    console.error("❌ Erreur ajout lead Sheets:", error.message);
    return false;
  }
}

const LEADS_FILE = path.join(__dirname, "leads.json");
function saveLeadToFile(clientData, projectData, total) {
  const lead = {
    timestamp: new Date().toISOString(),
    date_fr: new Date().toLocaleString("fr-MA", { timeZone: "Africa/Casablanca" }),
    client: clientData,
    project: projectData,
    amount: total,
    status: "Nouveau",
  };
  let leads = [];
  if (fs.existsSync(LEADS_FILE)) {
    try { leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8")); } catch(e) { leads = []; }
  }
  leads.push(lead);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
  console.log(`✅ Lead sauvegardé localement: ${clientData.nom}`);
}

async function notifyLead(clientData, projectData, total) {
  saveLeadToFile(clientData, projectData, total);
  await addLeadToSheet(clientData, projectData, total);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PRICING (exactement du fichier prix construction chatbot.txt)
// ─────────────────────────────────────────────────────────────────────────────
const PRICES = {
  etudes: 60,                // DH/m² couvert
  grosOeuvreHourdis: 1200,   // DH/m²
  grosOeuvrePostTension: 1600,
  murCloture: 400,           // DH/m
  finition: 3000,            // DH/m²
  renovation: 6000,          // DH/m²
  etancheite: {
    terrasse: 365,
    sdb: 90,
    piscine: 120,
    voile: 160
  },
  piscine: 3500,             // DH/m²
  marge: 0.15                // 15%
};

function calculerDevis(projet) {
  let sousTotal = 0;
  let details = [];

  // 1. Études de projet
  if (projet.type === "Études de projet" && projet.surface) {
    const cout = projet.surface * PRICES.etudes;
    details.push(`📐 Études de projet : ${projet.surface} m² × ${PRICES.etudes} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }

  // 2. Construction (gros œuvre + finition)
  if (projet.type === "Construction" && projet.surface) {
    const goPrice = projet.postTension ? PRICES.grosOeuvrePostTension : PRICES.grosOeuvreHourdis;
    const coutGO = projet.surface * goPrice;
    details.push(`🏗️ Gros œuvre (${projet.postTension ? "post-tension" : "hourdis"}) : ${projet.surface} m² × ${goPrice} DH = ${coutGO.toLocaleString()} DH`);
    sousTotal += coutGO;

    const coutFinition = projet.surface * PRICES.finition;
    details.push(`🎨 Finition : ${projet.surface} m² × ${PRICES.finition} DH = ${coutFinition.toLocaleString()} DH`);
    sousTotal += coutFinition;
  }

  // 3. Rénovation
  if (projet.type === "Rénovation" && projet.surface) {
    const cout = projet.surface * PRICES.renovation;
    details.push(`🔄 Rénovation : ${projet.surface} m² × ${PRICES.renovation} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }

  // 4. Finition seule
  if (projet.type === "Finition" && projet.surface) {
    const cout = projet.surface * PRICES.finition;
    details.push(`🎨 Finition : ${projet.surface} m² × ${PRICES.finition} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }

  // 5. Étanchéité (plusieurs sous-types)
  if (projet.type === "Étanchéité") {
    const type = projet.etancheiteType || "terrasse";
    let prix = PRICES.etancheite[type] || PRICES.etancheite.terrasse;
    let unite = (type === "voile") ? "m" : "m²";
    const cout = (projet.surface || 0) * prix;
    details.push(`💧 Étanchéité ${type} : ${projet.surface || 0} ${unite} × ${prix} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }

  // 6. Piscine clés en main
  if (projet.type === "Piscine clés en main" && projet.piscineSurface) {
    const cout = projet.piscineSurface * PRICES.piscine;
    details.push(`🏊 Piscine clés en main : ${projet.piscineSurface} m² × ${PRICES.piscine} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }

  // 7. Mur de clôture
  if (projet.type === "Mur de clôture" && projet.clotureLength) {
    const cout = projet.clotureLength * PRICES.murCloture;
    details.push(`🧱 Mur de clôture : ${projet.clotureLength} m × ${PRICES.murCloture} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }

  // 8. Option piscine supplémentaire (dans tout type sauf Piscine clés en main)
  if (projet.pool && projet.type !== "Piscine clés en main" && projet.poolSurface) {
    const cout = projet.poolSurface * PRICES.piscine;
    details.push(`🏊 Option piscine : ${projet.poolSurface} m² × ${PRICES.piscine} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }

  const marge = sousTotal * PRICES.marge;
  const total = sousTotal + marge;
  return { sousTotal, marge, total, details };
}

// ─────────────────────────────────────────────────────────────────────────────
//  CONVERSATION FLOW (menu, devis, services, rendez-vous)
// ─────────────────────────────────────────────────────────────────────────────
const sessions = {};

function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = {
      step: null,          // null = menu, "devis_q1..q6", "service_submenu", "rdv_collect"
      data: {},
      contact_idx: null,
      contact_data: {},
    };
  }
  return sessions[id];
}

// Menu principal (exactement celui du fichier fn)
const MAIN_MENU = `Bonjour,
Merci de nous avoir contactés. Nous sommes la société ERPAC. Comment pouvons-nous vous aider ?

Vous pouvez choisir :
1️⃣ Demander un devis estimatif
2️⃣ Découvrir nos services
3️⃣ Voir nos projets réalisés
4️⃣ Prendre rendez-vous`;

// Sous-menu services enrichi
const SERVICES_DETAIL = {
  "1": "🏡 **Villas** : Construction R+1/R+2, finition haut standing, piscine, étanchéité, clôture.\n👉 Devis personnalisé sur étude.",
  "2": "🏢 **Immeubles** : Résidentiel R+2 à R+5, structure béton, finitions modernes, étanchéité terrasses.",
  "3": "🏊 **Piscines** : Clés en main (3500 DH/m²). Béton armé, carrelage/liner, système de filtration.",
  "4": "🔄 **Rénovations** : Complète ou partielle (6000 DH/m²). Devis gratuit.",
  "5": "🏬 **Locaux commerciaux** : Aménagement, cloisons, plomberie, électricité, CVC.",
  "6": "💧 **Étanchéité** : Terrasse (365 DH/m²), SDB (90 DH), piscine (120 DH), voile (160 DH/m). Garantie 10 ans."
};

function getServicesSubmenu() {
  return `🔧 **Nos spécialités**\n\n1️⃣ Villas\n2️⃣ Immeubles\n3️⃣ Piscines\n4️⃣ Rénovation\n5️⃣ Locaux commerciaux\n6️⃣ Étanchéité\n\nTapez le numéro pour plus de détails ou "menu" pour revenir.`;
}

// Questions du devis (6 étapes, comme dans le fichier fn)
const DEVIS_QUESTIONS = [
  { key: "type", q: "1️⃣ Quel est le type de projet ?\n- Construction\n- Rénovation\n- Finition\n- Étanchéité\n- Piscine clés en main\n- Mur de clôture\n- Études de projet\n- Autre" },
  { key: "city", q: "2️⃣ Où se situe le projet ? (Ville / quartier)" },
  { key: "surface", q: "3️⃣ Quelle est la surface approximative en m² ?" },
  { key: "description", q: "4️⃣ Pouvez-vous décrire les travaux souhaités ?\nExemple : gros œuvre, finition, rénovation complète, étanchéité terrasse, piscine clés en main" },
  { key: "plans", q: "5️⃣ Avez-vous des plans, photos ou autorisation ?\nOui / Non" },
  { key: "delai", q: "6️⃣ Quand voulez-vous commencer les travaux ?" }
];

function startDevis(sess) {
  sess.step = "devis_q1";
  sess.data = {};
  return DEVIS_QUESTIONS[0].q;
}

function processDevisStep(sess, message) {
  const step = sess.step;
  if (step === "devis_q1") {
    sess.data.type = message;
    sess.step = "devis_q2";
    return DEVIS_QUESTIONS[1].q;
  }
  if (step === "devis_q2") {
    sess.data.city = message;
    sess.step = "devis_q3";
    return DEVIS_QUESTIONS[2].q;
  }
  if (step === "devis_q3") {
    let surf = parseFloat(message.replace(/[^\d.,]/g, "").replace(",", "."));
    if (isNaN(surf)) return "❌ Surface non valide. Veuillez entrer un nombre (ex: 200).";
    sess.data.surface = surf;
    sess.step = "devis_q4";
    return DEVIS_QUESTIONS[3].q;
  }
  if (step === "devis_q4") {
    sess.data.description = message;
    sess.step = "devis_q5";
    return DEVIS_QUESTIONS[4].q;
  }
  if (step === "devis_q5") {
    sess.data.plans = message;
    sess.step = "devis_q6";
    return DEVIS_QUESTIONS[5].q;
  }
  if (step === "devis_q6") {
    sess.data.delai = message;
    // Construire l'objet projet pour le calcul
    let projet = {
      type: sess.data.type,
      surface: sess.data.surface,
      description: sess.data.description,
      pool: false,
      postTension: false,
      etancheiteType: "terrasse"
    };
    // Détection piscine optionnelle
    if (projet.description.toLowerCase().includes("piscine") && projet.type !== "Piscine clés en main") {
      projet.pool = true;
      let match = projet.description.match(/(\d+)\s*m/i);
      projet.poolSurface = match ? parseFloat(match[1]) : 32;
    }
    // Détection post-tension
    if (projet.type === "Construction" && projet.description.toLowerCase().includes("post tension")) {
      projet.postTension = true;
    }
    // Type d'étanchéité
    if (projet.type === "Étanchéité") {
      if (projet.description.includes("sdb")) projet.etancheiteType = "sdb";
      else if (projet.description.includes("piscine")) projet.etancheiteType = "piscine";
      else if (projet.description.includes("voile")) projet.etancheiteType = "voile";
    }
    // Surface de piscine si type "Piscine clés en main"
    if (projet.type === "Piscine clés en main") {
      projet.piscineSurface = projet.surface;
    }
    // Longueur de mur de clôture
    if (projet.type === "Mur de clôture") {
      projet.clotureLength = projet.surface;
    }

    const { sousTotal, marge, total, details } = calculerDevis(projet);
    let reponse = "📊 **Estimation ERPAC**\n\n";
    details.forEach(d => { reponse += d + "\n\n"; });
    if (sousTotal > 0) {
      reponse += `Sous-total : ${sousTotal.toLocaleString()} DH\n\n`;
      reponse += `Marge ERPAC 15% : ${marge.toLocaleString()} DH\n\n`;
      reponse += `💰 **Total estimatif : ${total.toLocaleString()} DH**\n\n`;
    } else {
      reponse += `💰 **Total : à définir après étude**\n\n`;
    }
    reponse += `⚠️ Ce devis est une estimation approximative. Le prix final sera confirmé après visite technique et étude du projet.\n\n`;
    reponse += `Souhaitez-vous :\n1️⃣ Être contacté par un conseiller\n2️⃣ Envoyer des photos/plans\n3️⃣ Modifier les informations\n4️⃣ Retour au menu principal`;
    sess.data.estimate_total = total;
    sess.step = "devis_result";
    return reponse;
  }
  if (step === "devis_result") {
    const opt = message.trim().toLowerCase();
    if (opt === "1" || opt.includes("contacté")) {
      sess.contact_idx = 0;
      sess.contact_data = {};
      return `📞 Pour être contacté par un conseiller, veuillez me donner :\n\n1️⃣ Nom complet ?`;
    }
    if (opt === "2" || opt.includes("photo") || opt.includes("plan")) {
      return `📎 Vous pouvez envoyer vos photos ou plans ici même (WhatsApp). Un conseiller les étudiera et vous recontactera rapidement. Souhaitez-vous laisser vos coordonnées ? (Oui/Non)`;
    }
    if (opt === "3" || opt.includes("modifier")) {
      sess.step = "devis_q1";
      sess.data = {};
      return DEVIS_QUESTIONS[0].q;
    }
    if (opt === "4" || opt.includes("menu")) {
      delete sessions[sess.id];
      return MAIN_MENU;
    }
    return "Option non reconnue. Répondez 1, 2, 3 ou 4.";
  }
  return null;
}

// Rendez-vous flow (7 questions)
function startRdv(sess) {
  sess.contact_data = { rdv_step: 0 };
  sess.contact_idx = 99; // marqueur pour le flow rdv
  return `📅 Prise de rendez-vous\n\nMerci de me donner :\n1️⃣ Nom complet ?`;
}

function processRdv(sess, message, sessionId) {
  const fields = ["nom", "telephone", "ville", "type", "date", "heure", "description"];
  if (!sess.contact_data.rdv_step) sess.contact_data.rdv_step = 0;
  const step = sess.contact_data.rdv_step;
  if (step < fields.length) {
    sess.contact_data[fields[step]] = message;
    sess.contact_data.rdv_step++;
    const nextPrompts = [
      "Nom complet",
      "Numéro de téléphone",
      "Ville du projet",
      "Type de projet",
      "Date souhaitée",
      "Heure souhaitée",
      "Description rapide du besoin"
    ];
    if (sess.contact_data.rdv_step < fields.length) {
      return `${sess.contact_data.rdv_step+1}️⃣ ${nextPrompts[sess.contact_data.rdv_step]} ?`;
    }
    // Tous collectés
    const client = {
      nom: sess.contact_data.nom,
      telephone: sess.contact_data.telephone,
      email: ""
    };
    const project = {
      type: sess.contact_data.type,
      city: sess.contact_data.ville,
      surface: ""
    };
    const recapitulatif = `✅ **Rendez-vous enregistré !**\n\n👤 Nom : ${sess.contact_data.nom}\n📞 Tél : ${sess.contact_data.telephone}\n📍 Ville : ${sess.contact_data.ville}\n🏗️ Projet : ${sess.contact_data.type}\n📅 Date : ${sess.contact_data.date}\n⏰ Heure : ${sess.contact_data.heure}\n📝 Besoin : ${sess.contact_data.description}\n\nUn conseiller ERPAC vous contactera pour confirmer.\n\nSouhaitez-vous :\n1️⃣ Retour au menu principal\n2️⃣ Demander une estimation\n3️⃣ Contacter directement un conseiller`;
    notifyLead(client, project, "RDV");
    delete sessions[sessionId];
    return recapitulatif;
  }
  return null;
}

// Collecte des coordonnées après devis (nom, téléphone, email)
function processContact(sess, message, sessionId) {
  if (!sess.contact_idx) sess.contact_idx = 0;
  const steps = ["nom", "telephone", "email"];
  const idx = sess.contact_idx;
  if (idx < steps.length) {
    sess.contact_data[steps[idx]] = message;
    sess.contact_idx++;
    if (idx === 0) return "2️⃣ Numéro de téléphone ?";
    if (idx === 1) return "3️⃣ Email (facultatif) ?";
    if (idx === 2) {
      const client = {
        nom: sess.contact_data.nom,
        telephone: sess.contact_data.telephone,
        email: sess.contact_data.email || "non fourni"
      };
      const project = {
        type: sess.data.type,
        city: sess.data.city,
        surface: sess.data.surface
      };
      const total = sess.data.estimate_total || "0";
      notifyLead(client, project, total);
      delete sessions[sessionId];
      return `✅ **Merci ${client.nom}** ! Votre demande a bien été enregistrée. Un conseiller ERPAC vous contactera sous 24h.\n\n📞 ${client.telephone}\n\nSouhaitez-vous retourner au menu principal ? (Oui/Non)`;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PROCESS MESSAGE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
function processMessage(sessionId, raw) {
  const msg = raw.trim();
  if (!msg) return { reply: MAIN_MENU, next_step: "menu" };
  const sess = getSession(sessionId);
  sess.id = sessionId;

  // 1. Flow Rendez-vous (contact_idx === 99)
  if (sess.contact_idx === 99) {
    const reply = processRdv(sess, msg, sessionId);
    if (reply) return { reply, next_step: "rdv" };
  }

  // 2. Flow collecte contact après devis
  if (sess.contact_idx !== null && sess.contact_idx !== undefined && sess.contact_idx < 3 && sess.contact_idx !== 99) {
    const reply = processContact(sess, msg, sessionId);
    if (reply) return { reply, next_step: "contact" };
  }

  // 3. Flow devis actif
  if (sess.step && sess.step.startsWith("devis")) {
    const reply = processDevisStep(sess, msg);
    if (reply) return { reply, next_step: sess.step };
  }

  // 4. Sous-menu services
  if (sess.step === "service_submenu") {
    if (msg.toLowerCase() === "menu") {
      delete sessions[sessionId];
      return { reply: MAIN_MENU, next_step: "menu" };
    }
    const detail = SERVICES_DETAIL[msg];
    if (detail) {
      sess.step = "service_detail";
      return { reply: detail + "\n\nSouhaitez-vous une estimation pour ce type de projet ? (Oui/Non)", next_step: "service_detail" };
    }
    return { reply: "Option non reconnue. Tapez 1 à 6 ou 'menu'.", next_step: "service_submenu" };
  }
  if (sess.step === "service_detail") {
    if (/oui|yes|o|yeah|ok/i.test(msg)) {
      // Lancer devis avec le type prédéfini (Construction par défaut, mais on pourrait affiner)
      sess.step = "devis_q1";
      sess.data = { type: "Construction" }; // à améliorer selon le choix
      return { reply: DEVIS_QUESTIONS[0].q, next_step: "devis_q1" };
    }
    delete sessions[sessionId];
    return { reply: MAIN_MENU, next_step: "menu" };
  }

  // 5. Menu principal / intentions simples
  const lowerMsg = msg.toLowerCase();
  if (lowerMsg === "1" || lowerMsg === "1️⃣" || lowerMsg.includes("devis")) {
    return { reply: startDevis(sess), next_step: "devis_q1" };
  }
  if (lowerMsg === "2" || lowerMsg === "2️⃣" || lowerMsg.includes("service")) {
    sess.step = "service_submenu";
    return { reply: getServicesSubmenu(), next_step: "service_submenu" };
  }
  if (lowerMsg === "3" || lowerMsg === "3️⃣" || lowerMsg.includes("projet") || lowerMsg.includes("réalisations")) {
    return { reply: `🔗 **Nos réalisations** : https://www.erpac.ma/projects.cfm\n\nSouhaitez-vous une estimation pour un projet similaire ? (Oui/Non)`, next_step: "projects_redirect" };
  }
  if (lowerMsg === "4" || lowerMsg === "4️⃣" || lowerMsg.includes("rdv") || lowerMsg.includes("rendez-vous")) {
    return { reply: startRdv(sess), next_step: "rdv" };
  }
  if (lowerMsg === "menu" || lowerMsg === "accueil" || lowerMsg === "bonjour" || lowerMsg === "salut") {
    delete sessions[sessionId];
    return { reply: MAIN_MENU, next_step: "menu" };
  }

  // 6. Détection automatique d'un projet (ex: "villa 200m² Rabat piscine")
  const extracted = extractProjectFromMessage(msg);
  if (extracted.surface && (extracted.type || extracted.pool)) {
    sess.data = extracted;
    sess.data.description = msg;
    sess.data.plans = "non spécifié";
    sess.data.delai = "à préciser";
    sess.step = "devis_q6";
    const reply = processDevisStep(sess, "calcul auto");
    if (reply) return { reply, next_step: "devis_result" };
  }

  // 7. Par défaut, afficher le menu
  return { reply: MAIN_MENU, next_step: "menu" };
}

// Aide à l'extraction de projet depuis un message libre
function extractProjectFromMessage(text) {
  const data = {};
  let surfaceMatch = text.match(/(\d+(?:[.,]\d+)?)\s*m[²2]?/i);
  if (!surfaceMatch) surfaceMatch = text.match(/\b(\d{2,4})\b/);
  if (surfaceMatch) data.surface = parseFloat(surfaceMatch[1].replace(",", "."));
  const cities = ["casablanca","rabat","marrakech","tanger","fès","meknès","agadir","oujda","témara","salé","mohammedia","kenitra"];
  for (let c of cities) {
    if (text.toLowerCase().includes(c)) {
      data.city = c.charAt(0).toUpperCase() + c.slice(1);
      break;
    }
  }
  if (/villa/i.test(text)) data.type = "Construction";
  else if (/renovation|rénovation/i.test(text)) data.type = "Rénovation";
  else if (/piscine/i.test(text)) data.type = "Piscine clés en main";
  else if (/finition/i.test(text)) data.type = "Finition";
  else if (/etancheite|étanchéité/i.test(text)) data.type = "Étanchéité";
  else if (/cloture|mur/i.test(text)) data.type = "Mur de clôture";
  else if (/etude|plan/i.test(text)) data.type = "Études de projet";
  if (/piscine/i.test(text) && !data.type) data.pool = true;
  return data;
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

app.get("/health", (_, res) => res.json({ status: "ok", version: "erpac-production" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🏗️ ERPAC Official Bot (tarifs métier) sur le port ${PORT}`);
  await initGoogleSheets();
  console.log(`📝 Leads sauvegardés localement dans ${LEADS_FILE}`);
  console.log(`📊 Voir les leads: /leads`);
});
