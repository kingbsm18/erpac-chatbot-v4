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
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
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
    clientData.rdv_date || "",
    clientData.rdv_hour || "",
    total,
    "Nouveau"
  ]];
  try {
    // ensure headers
    try {
      await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "Feuil1!A1:K1" });
    } catch {
      const headers = [[
        "Date/Heure", "Nom", "Téléphone", "Email", "Type Projet", "Ville",
        "Surface", "Date RDV", "Heure RDV", "Montant TTC", "Statut"
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
    console.log(`✅ Lead ajouté Sheets: ${clientData.nom}`);
    return true;
  } catch (error) {
    console.error("❌ Erreur ajout lead Sheets:", error.message);
    return false;
  }
}

// Local backup
const LEADS_FILE = path.join(__dirname, "leads.json");
function saveLeadToFile(clientData, projectData, total) {
  const lead = {
    timestamp: new Date().toISOString(),
    client: clientData,
    project: projectData,
    total,
  };
  let leads = [];
  if (fs.existsSync(LEADS_FILE)) {
    try { leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8")); } catch(e) { leads = []; }
  }
  leads.push(lead);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
  console.log(`✅ Lead sauvegardé localement: ${clientData.nom}`);
}

// ========================= PRICING RULES (EXACT FROM FILE) =========================
const PRICING = {
  etudes: 60,          // DH/m²
  gros_oeuvre_hourdis: 1200,
  gros_oeuvre_post_tension: 1600,
  mur_cloture: 400,    // DH/m
  finition: 3000,
  renovation: 6000,
  etancheite: {
    terrasse: 365,
    sdb: 90,
    piscine: 120,
    voile: 160
  },
  piscine: 3500,       // DH/m²
  marge: 0.15
};

function calculerEstimation(projet) {
  let sousTotal = 0;
  let details = [];

  // --- Construction (gros œuvre + finition) ---
  if (projet.type === "Construction") {
    const surface = projet.surface;
    if (surface) {
      const grosOeuvre = projet.postTension ? PRICING.gros_oeuvre_post_tension : PRICING.gros_oeuvre_hourdis;
      const coutGO = grosOeuvre * surface;
      details.push(`1️⃣ Gros œuvre ${projet.postTension ? "post tension" : "hourdis"} : ${surface} m² × ${grosOeuvre} DH = ${coutGO.toLocaleString()} DH`);
      sousTotal += coutGO;

      const coutFinition = PRICING.finition * surface;
      details.push(`2️⃣ Finition : ${surface} m² × ${PRICING.finition} DH = ${coutFinition.toLocaleString()} DH`);
      sousTotal += coutFinition;
    }
  }
  // --- Rénovation ---
  else if (projet.type === "Rénovation") {
    const surface = projet.surface;
    if (surface) {
      const cout = PRICING.renovation * surface;
      details.push(`🔨 Rénovation : ${surface} m² × ${PRICING.renovation} DH = ${cout.toLocaleString()} DH`);
      sousTotal += cout;
    }
  }
  // --- Finition seule ---
  else if (projet.type === "Finition") {
    const surface = projet.surface;
    if (surface) {
      const cout = PRICING.finition * surface;
      details.push(`🎨 Finition : ${surface} m² × ${PRICING.finition} DH = ${cout.toLocaleString()} DH`);
      sousTotal += cout;
    }
  }
  // --- Étanchéité ---
  else if (projet.type === "Étanchéité") {
    // On peut avoir plusieurs sous-types, on se base sur la description pour simplifier
    let surface = projet.surface || 0;
    let typeEtancheite = projet.etancheiteType || "terrasse";
    let prix = PRICING.etancheite[typeEtancheite] || PRICING.etancheite.terrasse;
    let cout = prix * surface;
    details.push(`💧 Étanchéité ${typeEtancheite} : ${surface} m² × ${prix} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }
  // --- Piscine clés en main ---
  else if (projet.type === "Piscine clés en main") {
    const piscineSurface = projet.piscineSurface || (projet.surface || 0);
    const cout = PRICING.piscine * piscineSurface;
    details.push(`🏊 Piscine clés en main : ${piscineSurface} m² × ${PRICING.piscine} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }
  // --- Mur de clôture ---
  else if (projet.type === "Mur de clôture") {
    const longueur = projet.clotureLength || (projet.surface || 0);
    const cout = PRICING.mur_cloture * longueur;
    details.push(`🧱 Mur de clôture : ${longueur} m × ${PRICING.mur_cloture} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }
  // --- Études de projet ---
  else if (projet.type === "Études de projet") {
    const surface = projet.surface || 0;
    const cout = PRICING.etudes * surface;
    details.push(`📐 Études de projet : ${surface} m² × ${PRICING.etudes} DH = ${cout.toLocaleString()} DH`);
    sousTotal += cout;
  }
  // --- Autre / personnalisé ---
  else if (projet.type === "Autre") {
    details.push(`📌 ${projet.description || "Prestation sur mesure"} : prix à établir après étude`);
    sousTotal = 0; // on ne calcule pas de marge
  }

  // Ajout d'une piscine en option (si présente en plus)
  if (projet.pool && projet.type !== "Piscine clés en main") {
    const poolSurface = projet.poolSurface || 32;
    const poolCost = PRICING.piscine * poolSurface;
    details.push(`🏊 Option piscine : ${poolSurface} m² × ${PRICING.piscine} DH = ${poolCost.toLocaleString()} DH`);
    sousTotal += poolCost;
  }

  const marge = sousTotal * PRICING.marge;
  const total = sousTotal + marge;
  return { sousTotal, marge, total, details };
}

// ========================= SESSION & FLOW =========================
const sessions = {};

function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = {
      step: null,
      data: {},
      contact_idx: null,
      contact_data: {},
    };
  }
  return sessions[id];
}

// ========================= MESSAGES & MENUS =========================
const MAIN_MENU = `Bonjour,
Merci de nous avoir contactés. Nous sommes la société ERPAC. Comment pouvons-nous vous aider ?

Vous pouvez choisir :
1️⃣ Demander un devis estimatif
2️⃣ Découvrir nos services
3️⃣ Voir nos projets réalisés
4️⃣ Prendre rendez-vous`;

const SERVICE_DETAILS = {
  villas: "🏡 Villas modernes R+1 et R+2\n✔️ Gros œuvre hourdis ou post tension\n✔️ Finition haut standing\n✔️ Piscine, étanchéité, aménagement extérieur\n✔️ Clôture et menuiserie sur mesure",
  immeubles: "🏢 Immeubles résidentiels\n✔️ Structure béton armé\n✔️ Façades modernes\n✔️ Étanchéité terrasses\n✔️ Finitions haut de gamme",
  piscines: "🏊 Piscines clés en main\n📐 Forfait 3500 DH/m²\n✔️ Béton armé, carrelage ou liner\n✔️ Système de filtration, pompe\n✔️ Étanchéité garantie 10 ans",
  renovation: "🔄 Rénovation complète ou partielle\n✔️ Gros œuvre, finition, étanchéité\n✔️ Prix : 6000 DH/m²\n✔️ Devis gratuit sur étude",
  commerciaux: "🏬 Locaux commerciaux et bureaux\n✔️ Aménagement intérieur\n✔️ Cloisons, faux plafonds\n✔️ Plomberie, électricité, CVC\n✔️ Finitions professionnelles",
  etancheite: "💧 Étanchéité tous types\n✔️ Terrasse : 365 DH/m²\n✔️ SDB : 90 DH/m²\n✔️ Piscine : 120 DH/m²\n✔️ Voile : 160 DH/m\n✔️ Garantie 10 ans"
};

function showServiceSubmenu() {
  return `🔧 **Nos spécialités**\n\n1️⃣ Villas\n2️⃣ Immeubles\n3️⃣ Piscines\n4️⃣ Rénovation\n5️⃣ Locaux commerciaux\n6️⃣ Étanchéité\n\nTapez le numéro pour plus de détails ou "menu" pour revenir.`;
}

function getServiceDetail(choice) {
  const map = {
    "1": "villas",
    "2": "immeubles",
    "3": "piscines",
    "4": "renovation",
    "5": "commerciaux",
    "6": "etancheite"
  };
  const key = map[choice];
  if (key) return SERVICE_DETAILS[key] + `\n\nSouhaitez-vous une estimation pour ce type de projet ? (Oui/Non)`;
  return null;
}

// ========================= DEVIS FLOW =========================
const DEVIS_QUESTIONS = [
  { key: "type", question: "📋 1. Quel est le type de projet ?\n- Construction\n- Rénovation\n- Finition\n- Étanchéité\n- Piscine clés en main\n- Mur de clôture\n- Études de projet\n- Autre" },
  { key: "city", question: "📍 2. Où se situe le projet ? (Ville / quartier)" },
  { key: "surface", question: "📐 3. Quelle est la surface approximative en m² ?" },
  { key: "description", question: "🛠️ 4. Pouvez-vous décrire les travaux souhaités ?\nEx: gros œuvre, finition, piscine, étanchéité terrasse, etc." },
  { key: "plans", question: "📎 5. Avez-vous des plans, photos ou autorisation ? (Oui/Non)" },
  { key: "delai", question: "🗓️ 6. Quand voulez-vous commencer les travaux ?" }
];

function startDevis(sess) {
  sess.step = "devis_q1";
  sess.data = {};
  return DEVIS_QUESTIONS[0].question;
}

function processDevis(sess, message) {
  const step = sess.step;
  if (step === "devis_q1") {
    sess.data.type = message;
    sess.step = "devis_q2";
    return DEVIS_QUESTIONS[1].question;
  }
  if (step === "devis_q2") {
    sess.data.city = message;
    sess.step = "devis_q3";
    return DEVIS_QUESTIONS[2].question;
  }
  if (step === "devis_q3") {
    let surf = parseFloat(message.replace(/[^\d.,]/g, "").replace(",", "."));
    if (isNaN(surf)) return "❌ Surface non valide. Veuillez entrer un nombre (ex: 200).";
    sess.data.surface = surf;
    sess.step = "devis_q4";
    return DEVIS_QUESTIONS[3].question;
  }
  if (step === "devis_q4") {
    sess.data.description = message;
    sess.step = "devis_q5";
    return DEVIS_QUESTIONS[4].question;
  }
  if (step === "devis_q5") {
    sess.data.plans = message;
    sess.step = "devis_q6";
    return DEVIS_QUESTIONS[5].question;
  }
  if (step === "devis_q6") {
    sess.data.delai = message;

    // Préparer l'objet projet pour calcul
    let projet = {
      type: sess.data.type,
      surface: sess.data.surface,
      description: sess.data.description
    };
    // Détection piscine optionnelle
    if (projet.description.toLowerCase().includes("piscine") && projet.type !== "Piscine clés en main") {
      projet.pool = true;
      let match = projet.description.match(/(\d+)\s*m/i);
      projet.poolSurface = match ? parseFloat(match[1]) : 32;
    }
    // Détection post tension
    if (projet.type === "Construction" && projet.description.toLowerCase().includes("post tension")) {
      projet.postTension = true;
    }
    // Détection type d'étanchéité
    if (projet.type === "Étanchéité") {
      if (projet.description.toLowerCase().includes("terrasse")) projet.etancheiteType = "terrasse";
      else if (projet.description.toLowerCase().includes("sdb")) projet.etancheiteType = "sdb";
      else if (projet.description.toLowerCase().includes("voile")) projet.etancheiteType = "voile";
      else if (projet.description.toLowerCase().includes("piscine")) projet.etancheiteType = "piscine";
    }

    const { sousTotal, marge, total, details } = calculerEstimation(projet);

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
    if (opt === "1" || opt === "1️⃣" || opt.includes("contacté")) {
      sess.contact_idx = 0;
      sess.contact_data = {};
      return `📞 Pour être contacté par un conseiller, veuillez me donner :\n\n1️⃣ Nom complet\n2️⃣ Téléphone\n3️⃣ Email (facultatif)`;
    }
    if (opt === "2" || opt.includes("photo") || opt.includes("plan")) {
      return `📎 Vous pouvez envoyer vos photos ou plans ici même (WhatsApp). Un conseiller les étudiera et vous recontactera rapidement. Souhaitez-vous laisser vos coordonnées ? (Oui/Non)`;
    }
    if (opt === "3" || opt.includes("modifier")) {
      sess.step = "devis_q1";
      sess.data = {};
      return DEVIS_QUESTIONS[0].question;
    }
    if (opt === "4" || opt.includes("menu")) {
      delete sessions[sess.id];
      return MAIN_MENU;
    }
    return "Option non reconnue. Répondez 1, 2, 3 ou 4.";
  }
  return null;
}

// ========================= COLLECT CONTACT (après devis) =========================
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
      addLeadToSheet(client, project, total);
      saveLeadToFile(client, project, total);
      delete sessions[sessionId];
      return `✅ Merci ${client.nom} ! Votre demande a bien été enregistrée. Un conseiller ERPAC vous contactera sous 24h.\n\n📞 ${client.telephone}\n\nSouhaitez-vous retourner au menu principal ? (Oui/Non)`;
    }
  }
  return null;
}

// ========================= RENDEZ-VOUS FLOW =========================
function startRdv(sess) {
  sess.contact_data = { rdv_step: 0 };
  sess.contact_idx = 99; // hack pour identifier le flow rdv
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
      "Date souhaitée (ex: lundi 10 mai)",
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
    addLeadToSheet(client, project, "RDV");
    saveLeadToFile(client, project, "RDV");
    const recapitulatif = `✅ Rendez-vous enregistré !

👤 Nom : ${sess.contact_data.nom}
📞 Tél : ${sess.contact_data.telephone}
📍 Ville : ${sess.contact_data.ville}
🏗️ Projet : ${sess.contact_data.type}
📅 Date : ${sess.contact_data.date}
⏰ Heure : ${sess.contact_data.heure}
📝 Besoin : ${sess.contact_data.description}

Un conseiller ERPAC vous contactera pour confirmer.

Souhaitez-vous :
1️⃣ Retour au menu principal
2️⃣ Demander une estimation
3️⃣ Contacter directement un conseiller`;
    delete sessions[sessionId];
    return recapitulatif;
  }
  return null;
}

// ========================= AUTO-EXTRACTION POUR DEVIS RAPIDE =========================
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

// ========================= MAIN PROCESSOR =========================
function processMessage(sessionId, raw) {
  const msg = raw.trim();
  if (!msg) return { reply: MAIN_MENU, next_step: "menu" };
  const sess = getSession(sessionId);
  sess.id = sessionId;

  // 1. Gestion flows spéciaux : rendez-vous
  if (sess.contact_idx === 99) {
    const reply = processRdv(sess, msg, sessionId);
    if (reply) return { reply, next_step: "rdv" };
  }

  // 2. Collecte contact après devis
  if (sess.contact_idx !== null && sess.contact_idx !== undefined && sess.contact_idx < 3 && sess.contact_idx !== 99) {
    const reply = processContact(sess, msg, sessionId);
    if (reply) return { reply, next_step: "contact" };
  }

  // 3. Tunnel devis actif
  if (sess.step && sess.step.startsWith("devis")) {
    const reply = processDevis(sess, msg);
    if (reply) return { reply, next_step: sess.step };
  }

  // 4. Sous-menu services
  if (sess.step === "service_submenu") {
    if (msg === "menu") {
      delete sessions[sessionId];
      return { reply: MAIN_MENU, next_step: "menu" };
    }
    const detail = getServiceDetail(msg);
    if (detail) {
      sess.step = "service_detail";
      return { reply: detail, next_step: "service_detail" };
    }
    return { reply: "Option non reconnue. Tapez 1 à 6 ou 'menu'.", next_step: "service_submenu" };
  }
  if (sess.step === "service_detail") {
    if (/oui|yes|o|yeah|ok/i.test(msg)) {
      // Lancer devis avec type présélectionné (on garde la dernière sélection)
      sess.step = "devis_q1";
      sess.data = { type: "Construction" }; // par défaut, mais on pourrait mieux faire
      return { reply: DEVIS_QUESTIONS[0].question, next_step: "devis_q1" };
    }
    delete sessions[sessionId];
    return { reply: MAIN_MENU, next_step: "menu" };
  }

  // 5. Menu principal ou interaction libre
  const lowerMsg = msg.toLowerCase();
  // Reconnaissance des choix principaux
  if (lowerMsg === "1" || lowerMsg === "1️⃣" || lowerMsg.includes("devis") || lowerMsg === "devis") {
    return { reply: startDevis(sess), next_step: "devis_q1" };
  }
  if (lowerMsg === "2" || lowerMsg === "2️⃣" || lowerMsg.includes("service") || lowerMsg.includes("découvrir")) {
    sess.step = "service_submenu";
    return { reply: showServiceSubmenu(), next_step: "service_submenu" };
  }
  if (lowerMsg === "3" || lowerMsg === "3️⃣" || lowerMsg.includes("projet") || lowerMsg.includes("réalisations")) {
    return { reply: `🔗 Nos réalisations : https://www.erpac.ma/projects.cfm\n\nSouhaitez-vous une estimation pour un projet similaire ? (Oui/Non)`, next_step: "projects" };
  }
  if (lowerMsg === "4" || lowerMsg === "4️⃣" || lowerMsg.includes("rdv") || lowerMsg.includes("rendez-vous")) {
    return { reply: startRdv(sess), next_step: "rdv" };
  }
  if (lowerMsg === "menu" || lowerMsg === "accueil" || lowerMsg === "bonjour" || lowerMsg === "salut") {
    delete sessions[sessionId];
    return { reply: MAIN_MENU, next_step: "menu" };
  }

  // Tentative d'extraction automatique pour devis
  const extracted = extractProjectFromMessage(msg);
  if (extracted.surface && (extracted.type || extracted.pool)) {
    sess.data = extracted;
    sess.data.description = msg;
    sess.data.plans = "non spécifié";
    sess.data.delai = "à préciser";
    sess.step = "devis_q6";
    const reply = processDevis(sess, "quickcalc");
    if (reply) return { reply, next_step: "devis_result" };
  }

  // Par défaut, afficher le menu
  return { reply: MAIN_MENU, next_step: "menu" };
}

// ========================= WHATSAPP & SERVER =========================
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
  const result = processMessage(session_id, message);
  return res.json(result);
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

app.get("/health", (_, res) => res.json({ status: "ok", version: "erpac-advanced" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🏗️ ERPAC Advanced Bot sur le port ${PORT}`);
  await initGoogleSheets();
  console.log(`📝 Leads sauvegardés dans ${LEADS_FILE}`);
});
