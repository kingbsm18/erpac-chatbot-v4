const express = require("express");
const { google } = require("googleapis");
const fs = require('fs');
const path = require('path');
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

// ── CONFIGURATION GOOGLE SHEETS ─────────────────────────────────────────────
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1XiLalbZsdD34IXsyZ3VcgX2kYgeHk5LOmOKfbNz1y5I";
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;

let sheets = null;

async function initGoogleSheets() {
  if (!SPREADSHEET_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.log('⚠️ Google Sheets non configuré - variables manquantes');
    console.log('   Ajouter: SPREADSHEET_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY');
    return false;
  }
  
  try {
    const privateKey = GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
    
    const auth = new google.auth.JWT(
      GOOGLE_CLIENT_EMAIL,
      null,
      privateKey,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    
    sheets = google.sheets({ version: 'v4', auth });
    
    await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    console.log('✅ Google Sheets connecté avec succès');
    return true;
  } catch (error) {
    console.error('❌ Erreur connexion Sheets:', error.message);
    return false;
  }
}

async function addLeadToSheet(clientData, estimateData, ttcValue) {
  if (!sheets) {
    console.log('⚠️ Google Sheets non disponible - sauvegarde locale uniquement');
    return false;
  }
  
  const now = new Date().toLocaleString('fr-MA', { timeZone: 'Africa/Casablanca' });
  
  const values = [[
    now,
    clientData.nom || '',
    clientData.telephone || '',
    clientData.email || '',
    estimateData.project_type || '',
    estimateData.city || '',
    estimateData.surface || '',
    estimateData.floors || 1,
    estimateData.standing || 'Moyen',
    estimateData.basement ? 'Oui' : 'Non',
    estimateData.soil === 'rocheux' ? 'Rocheux (+25k DH)' : 'Normal',
    estimateData.pool ? 'Oui (+130k DH)' : 'Non',
    estimateData.ac === 'gainable' ? 'Oui (+500 DH/m²)' : 'Non',
    estimateData.home_automation ? 'Oui (+800 DH/m²)' : 'Non',
    ttcValue,
    `https://wa.me/${clientData.telephone.replace(/[^0-9]/g, '')}`,
    'Nouveau - À contacter'
  ]];
  
  try {
    try {
      await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Feuil1!A1:Q1',
      });
    } catch {
      const headers = [[
        'Date/Heure', 'Nom Client', 'Téléphone', 'Email',
        'Type Projet', 'Ville', 'Surface (m²)', 'Niveaux',
        'Standing', 'Sous-sol', 'Terrain', 'Piscine',
        'Clim Gainable', 'Domotique', 'Montant TTC', 'Lien WhatsApp', 'Statut'
      ]];
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Feuil1!A1:Q1',
        valueInputOption: 'USER_ENTERED',
        resource: { values: headers },
      });
      console.log('✅ En-tête créé dans Google Sheets');
    }
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Feuil1!A:Q',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values },
    });
    
    console.log(`✅ Lead ajouté à Google Sheets: ${clientData.nom}`);
    return true;
  } catch (error) {
    console.error('❌ Erreur ajout lead Sheets:', error.message);
    return false;
  }
}

// ── STOCKAGE LOCAL DES LEADS (fallback) ─────────────────────────────────────
const LEADS_FILE = path.join(__dirname, 'leads.json');

function saveLeadToFile(clientData, estimateData, ttcValue) {
  const lead = {
    timestamp: new Date().toISOString(),
    date_fr: new Date().toLocaleString('fr-MA', { timeZone: 'Africa/Casablanca' }),
    client: clientData,
    project: {
      type: estimateData.project_type || '',
      city: estimateData.city || '',
      surface: estimateData.surface || '',
      floors: estimateData.floors || 1,
      standing: estimateData.standing || 'Moyen',
      basement: estimateData.basement || false,
      soil: estimateData.soil || 'normal',
      pool: estimateData.pool || false,
      ac: estimateData.ac || 'none',
      home_automation: estimateData.home_automation || false
    },
    amount: ttcValue,
    status: 'Nouveau - À contacter'
  };
  
  let leads = [];
  if (fs.existsSync(LEADS_FILE)) {
    try {
      leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    } catch(e) { leads = []; }
  }
  leads.push(lead);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
  console.log(`✅ Lead sauvegardé localement: ${clientData.nom}`);
  return true;
}

async function sendLeadNotification(clientData, estimateData, ttcValue) {
  saveLeadToFile(clientData, estimateData, ttcValue);
  await addLeadToSheet(clientData, estimateData, ttcValue);
}

// ── KB ENRICHIE ─────────────────────────────────────────────────────────────
const KB = {
  name: "ERPAC (Entreprise de Réalisation de Projets d'Aménagement et de Construction)",
  phones: ["+212 669 078 556", "+212 537 222 222"],
  email: "info@erpac.ma",
  location: "Rue Dakar, Imm N°5 Appt 1, Océan – Rabat",
  presentation: "ERPAC est une entreprise de BTP qualifiée par le ministère de l'Habitat. Nous sommes experts en Gros Œuvre, Aménagement et Étanchéité depuis plus de 10 ans.",
  services: "• Construction de Villas & Immeubles\n• Étanchéité (Toitures, Terrasses, Sous-sols)\n• Aménagement intérieur & Décoration de luxe\n• Charpente Métallique & Hangars Industriels\n• Construction de Piscines & Espaces verts",
  projets: "Nous avons réalisé plus de 456 projets, dont la Clinique d'Agdal, des Hangars à Mohammedia et des Villas de haut standing à Harhoura et Rabat.",
  engagements: "Qualité technique, Respect des délais, et Accompagnement architectural personnalisé.",
  luxury: "Nos Villas Haut Standing : finitions premium, domotique intégrée, piscine à débordement, matériaux nobles (marbre, zellige, bois exotique)."
};

// ── SMALL TALK ──────────────────────────────────────────────────────────────
const CHITCHAT = [
  { pattern: /\b(salut|bonjour|salam|hello|hi|hey)\b/i, reply: "Bonjour ! Ravi de vous accueillir chez ERPAC. Je suis votre conseiller commercial virtuel. Comment puis-je vous aider ?" },
  { pattern: /\b(merci|shokran|chokran)\b/i, reply: "Je vous en prie ! Nous restons à votre entière disposition." },
  { pattern: /\b(au revoir|bye|a plus|bslama)\b/i, reply: "Au revoir ! Merci d'avoir contacté ERPAC. À très bientôt !" }
];

const FAQ = [
  { pattern: /\b(etancheite|étanchéité|fuite|humidite)\b/i, reply: "L'étanchéité est notre spécialité avec garantie 10 ans. Souhaitez-vous un devis ?" },
  { pattern: /\b(hangar|industriel|depot)\b/i, reply: "Nous réalisons des hangars industriels sur mesure. Pouvons-nous vous établir une estimation ?" },
  { pattern: /\b(garantie|decennale)\b/i, reply: "Tous nos chantiers sont couverts par une assurance décennale (10 ans)." }
];

// ── NLU ─────────────────────────────────────────────────────────────────────
const CITY_MAP = [
  { pattern: /\b(casa|casablanca)\b/i, city: "Casablanca", zone: "A" },
  { pattern: /\b(rabat|rbat)\b/i, city: "Rabat", zone: "A" },
  { pattern: /\b(marrakech|mre|kech)\b/i, city: "Marrakech", zone: "B" },
  { pattern: /\b(tanger|tanjah)\b/i, city: "Tanger", zone: "B" },
];

const INTENT_MAP = [
  { intent: "devis", pattern: /\b(devis|prix|estimation|combien|tarif)\b/i },
  { intent: "services", pattern: /\b(services|prestations|travaux|construction)\b/i },
  { intent: "projets", pattern: /\b(projets|réalisations|references)\b/i },
  { intent: "contact", pattern: /\b(contact|téléphone|email|adresse|whatsapp)\b/i },
  { intent: "info", pattern: /\b(qui|erpac|société|entreprise|experience)\b/i },
];

function norm(s) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function detectCity(text) {
  for (const { pattern, city, zone } of CITY_MAP) {
    if (pattern.test(text)) return { city, zone };
  }
  return null;
}

function detectIntent(text) {
  for (const { intent, pattern } of INTENT_MAP) {
    if (pattern.test(text)) return intent;
  }
  return null;
}

function extractEntities(text) {
  const t = norm(text);
  const out = {};

  const surfM = text.match(/(\d{2,4})\s*m[²2]/i);
  if (surfM) out.surface = parseFloat(surfM[1]);

  const justNumber = text.match(/^\s*(\d{2,4})\s*$/);
  if (justNumber && !surfM) out.surface = parseFloat(justNumber[1]);

  if (/\bvilla\b/i.test(text)) out.project_type = "villa";
  if (/\bimmeuble\b/i.test(text)) out.project_type = "immeuble";
  if (/\brénovation\b/i.test(text)) out.project_type = "renovation";
  if (/\bindustriel|hangar\b/i.test(text)) out.project_type = "industriel";

  const cityR = detectCity(text);
  if (cityR) { out.city = cityR.city; out.zone = cityR.zone; }

  return out;
}

// ── CALCULATION ENGINE ───────────────────────────────────────────────────────
const ZONES = { A: 1.15, B: 1.10, C: 1.05, D: 1.00 };
const RATES = {
  economique: { gros: 3000, fin: 900 },
  moyen: { gros: 5500, fin: 1600 },
  haut: { gros: 10000, fin: 3000 },
};
const PROJ_COEFF = { villa: 1.00, immeuble: 1.05, renovation: 0.60, industriel: 0.80 };
const TVA = 0.20, IMPREVU = 0.07, HONO = 0.08;
const ADD = { basement: 2000, soil: 25000, pool: 130000, ac_gainable: 500, home_auto: 800 };

function fmt(n) { return Math.round(n).toLocaleString("fr-MA") + " DH"; }

function calculate_estimate(d) {
  const zf = ZONES[d.zone] || 1.00;
  const r = RATES[d.standing] || RATES.moyen;
  const pc = PROJ_COEFF[d.project_type] || 1.00;
  const s = d.surface, f = d.floors || 1;

  let gros = r.gros * zf * pc * s * f;
  let fin = r.fin * zf * s * f;
  let opts = 0;
  if (d.pool) opts += ADD.pool;
  if (d.ac === "gainable") opts += ADD.ac_gainable * s;
  if (d.home_automation) opts += ADD.home_auto * s;

  const base = gros + fin;
  const hono = base * HONO;
  const ht = base + opts + hono;
  const imp = ht * IMPREVU;
  const tva = (ht + imp) * TVA;
  const ttc = ht + imp + tva;

  return { gros, fin, opts, hono, ht, imp, tva, ttc };
}

function renderEstimate(d) {
  const e = calculate_estimate(d);
  const standing_labels = { economique: "Économique", moyen: "Moyen", haut: "Haut Standing" };
  return [
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📊 AVANT-MÉTRÉ ERPAC 2026`,
    `${d.project_type?.toUpperCase() || 'PROJET'} | ${d.city || 'Ville'} | Zone ${d.zone || 'B'} | ${standing_labels[d.standing] || 'Moyen'}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🏗  Gros Œuvre        : ${fmt(e.gros)}`,
    `🪟  Second Œuvre      : ${fmt(e.fin)}`,
    `🔧  Options           : ${fmt(e.opts)}`,
    `📐  Honoraires (8%)   : ${fmt(e.hono)}`,
    `    ────────────────────────`,
    `💰  Total HT          : ${fmt(e.ht)}`,
    `🛡   Imprévus (7%)    : ${fmt(e.imp)}`,
    `🧾  TVA 20%           : ${fmt(e.tva)}`,
    `    ────────────────────────`,
    `✅  TOTAL TTC         : ${fmt(e.ttc)}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `⚠️  Indicatif – fer & ciment volatils 2026.`,
    `📞 ${KB.phones[0]}  ✉️ ${KB.email}`,
  ].join("\n");
}

// ── STATE MACHINE ────────────────────────────────────────────────────────────
const STEPS = [
  {
    key: "project_type",
    ask: () => "Type de projet ?\n1. Villa\n2. Immeuble\n3. Rénovation\n4. Industriel/Hangar",
    resolve(text, ents) {
      if (ents.project_type) return ents.project_type;
      const t = norm(text);
      if (t === "1" || t === "villa") return "villa";
      if (t === "2" || t === "immeuble") return "immeuble";
      if (t === "3" || /rénov|renov/.test(t)) return "renovation";
      if (t === "4" || t === "industriel" || t === "hangar") return "industriel";
      return null;
    },
    err: "Répondez 1, 2, 3 ou 4",
  },
  {
    key: "city",
    ask: () => "Ville du projet ?",
    resolve(text, ents) {
      if (ents.city) return { city: ents.city, zone: ents.zone };
      const w = text.trim();
      if (w.length >= 3) return { city: w, zone: "D" };
      return null;
    },
    err: "Entrez le nom de la ville",
    multi: true,
  },
  {
    key: "surface",
    ask: () => "Surface (m²) ?",
    resolve(text, ents) {
      if (ents.surface) return ents.surface;
      const n = parseFloat(text.replace(/[^\d.]/g, ""));
      return n > 0 && n < 10000 ? n : null;
    },
    err: "Entrez une surface valide",
  },
  {
    key: "floors",
    ask: () => "Nombre de niveaux ? (RDC=1, R+1=2)",
    resolve(text, ents) {
      if (ents.floors) return ents.floors;
      const t = norm(text);
      if (t === "rdc" || t === "0" || t === "r+0") return 1;
      const m = text.match(/r\+?\s*(\d)/i);
      if (m) return parseInt(m[1]) + 1;
      const n = parseInt(text.replace(/[^\d]/g, ""));
      return n > 0 && n < 10 ? n : null;
    },
    err: "Entrez un nombre de niveaux",
  },
  {
    key: "standing",
    ask: () => "Standing ?\n1. Économique\n2. Moyen\n3. Haut Standing",
    resolve(text, ents) {
      if (ents.standing) return ents.standing;
      const t = norm(text);
      if (t === "1" || /eco/.test(t)) return "economique";
      if (t === "2" || /moy/.test(t)) return "moyen";
      if (t === "3" || /haut|lux/.test(t)) return "haut";
      return null;
    },
    err: "Répondez 1, 2 ou 3",
  },
  {
    key: "options",
    ask: () => "Options ? (0=aucune)\n1. Piscine\n2. Clim gainable\n3. Domotique",
    resolve(text, ents) {
      const t = norm(text);
      const hasPool = t.includes("piscine") || t.includes("1");
      const hasAc = t.includes("gainable") || t.includes("2");
      const hasHa = t.includes("domotique") || t.includes("3");
      if (t === "0" || /aucun/.test(t)) {
        return { pool: false, ac: "none", home_automation: false };
      }
      if (!hasPool && !hasAc && !hasHa) return null;
      return { pool: hasPool, ac: hasAc ? "gainable" : "none", home_automation: hasHa };
    },
    multi: true,
    err: "Répondez 0, 1, 2 ou 3",
  },
];

const CONTACT_STEPS = [
  { key: "nom", ask: () => "Votre nom complet ?" },
  { key: "telephone", ask: () => "Votre téléphone ?" },
  { key: "email", ask: () => "Votre email ?" },
];

// ── SESSIONS ─────────────────────────────────────────────────────────────────
const sessions = {};

function getSession(id) {
  if (!sessions[id]) sessions[id] = { data: {}, step: null, contact_idx: null, contact_data: {} };
  return sessions[id];
}

function nextMissingStep(data) {
  for (const s of STEPS) {
    if (s.key === "options") {
      if (data.options === undefined && (data.pool === undefined && data.ac === undefined && data.home_automation === undefined)) {
        return s;
      }
    } else if (data[s.key] === undefined) {
      return s;
    }
  }
  return null;
}

// ── STATIC REPLIES ───────────────────────────────────────────────────────────
const STATIC = {
  services: () => `🏗️ SERVICES ERPAC\n\n${KB.services}`,
  contact: () => `📞 CONTACT\nTél: ${KB.phones.join(" / ")}\n✉️ ${KB.email}`,
  projets: () => `🏆 RÉALISATIONS\n${KB.projets}`,
  info: () => `🏢 QUI SOMMES-NOUS ?\n${KB.presentation}`,
  fallback: () => "Je peux vous aider avec: DEVIS, SERVICES, PROJETS, CONTACT, INFO",
};

// ── PROCESS MESSAGE ──────────────────────────────────────────────────────────
function processMessage(sessionId, raw) {
  const msg = raw.trim();
  const sess = getSession(sessionId);
  const ents = extractEntities(msg);

  // Salutations
  if (sess.step === null && sess.contact_idx === null) {
    for (const chat of CHITCHAT) {
      if (chat.pattern.test(msg)) {
        return { reply: chat.reply, next_step: "idle", data: {} };
      }
    }
  }

  // FAQ
  for (const item of FAQ) {
    if (item.pattern.test(msg)) {
      return { reply: item.reply, next_step: "idle", data: {} };
    }
  }

  // Collecte contact
  if (sess.contact_idx !== null) {
    const idx = sess.contact_idx;
    if (idx < CONTACT_STEPS.length) {
      sess.contact_data[CONTACT_STEPS[idx].key] = msg;
      sess.contact_idx++;
      if (sess.contact_idx < CONTACT_STEPS.length) {
        return { reply: CONTACT_STEPS[sess.contact_idx].ask(), next_step: "contact", data: sess.data };
      }

      const cd = sess.contact_data;
      const ed = sess.data;
      const fullEstimate = {
        ...ed,
        pool: ed.pool || false,
        ac: ed.ac || "none",
        home_automation: ed.home_automation || false,
      };
      const estimateResult = calculate_estimate(fullEstimate);
      const ttcValue = fmt(estimateResult.ttc);

      // Envoi vers Google Sheets + fichier local
      sendLeadNotification(cd, ed, ttcValue);

      const summary = `✅ DEMANDE ENREGISTRÉE\n\n📋 Client: ${cd.nom}\n📞 Tél: ${cd.telephone}\n✉️ Email: ${cd.email}\n\n🏗️ Projet: ${ed.project_type || '?'}\n💰 Montant: ${ttcValue}\n\n👨‍💼 Un conseiller vous contacte sous 24h.`;

      delete sessions[sessionId];
      return { reply: summary, next_step: "idle", data: {} };
    }
  }

  // Tunnel Devis
  if (sess.step !== null) {
    const step = STEPS[sess.step];
    const intent = detectIntent(msg);
    
    if (intent && intent !== "devis" && Object.keys(ents).filter(k => !k.startsWith("_")).length === 0) {
      const staticReply = STATIC[intent] ? STATIC[intent]() : STATIC.fallback();
      return { reply: `${staticReply}\n\n─────────\n${step.ask()}`, next_step: "devis", data: sess.data };
    }

    let val = step.resolve(msg, ents);
    if (val === null) {
      return { reply: `❌ ${step.err}\n\n${step.ask()}`, next_step: "devis", data: sess.data };
    }

    if (step.key === "options") {
      sess.data.options = val;
      if (val.pool !== undefined) sess.data.pool = val.pool;
      if (val.ac !== undefined) sess.data.ac = val.ac;
      if (val.home_automation !== undefined) sess.data.home_automation = val.home_automation;
    } else if (step.multi && typeof val === "object") {
      Object.assign(sess.data, val);
    } else {
      sess.data[step.key] = val;
    }

    const next = nextMissingStep(sess.data);
    if (next) {
      sess.step = STEPS.indexOf(next);
      return { reply: next.ask(), next_step: "devis", data: sess.data };
    }

    const estimate = renderEstimate({
      ...sess.data,
      pool: sess.data.pool || false,
      ac: sess.data.ac || "none",
      home_automation: sess.data.home_automation || false,
    });

    sess.contact_idx = 0;
    sess.step = null;
    return { reply: `${estimate}\n\n${CONTACT_STEPS[0].ask()}`, next_step: "contact", data: sess.data };
  }

  // Pas de flow actif
  const intent = detectIntent(msg);
  
  if (intent && STATIC[intent]) {
    return { reply: STATIC[intent](), next_step: "idle", data: {} };
  }

  if (intent === "devis" || Object.keys(ents).some(k => ["project_type", "surface", "city"].includes(k))) {
    const data = {};
    if (ents.project_type) data.project_type = ents.project_type;
    if (ents.city) { data.city = ents.city; data.zone = ents.zone; }
    if (ents.surface) data.surface = ents.surface;
    
    sess.data = data;
    const next = nextMissingStep(sess.data);
    if (next) {
      sess.step = STEPS.indexOf(next);
      return { reply: `🏗️ Simulation de devis\n\n${next.ask()}`, next_step: "devis", data: sess.data };
    }
    
    const estimate = renderEstimate(sess.data);
    sess.contact_idx = 0;
    return { reply: `${estimate}\n\n${CONTACT_STEPS[0].ask()}`, next_step: "contact", data: sess.data };
  }

  return { reply: STATIC.fallback(), next_step: "idle", data: {} };
}

// ── WHATSAPP SENDER ─────────────────────────────────────────────────────────
async function sendWhatsApp(to, text) {
  if (!WA_TOKEN || !WA_PHONE_ID) {
    console.log('⚠️ WhatsApp non configuré');
    return;
  }
  if (!text || text.trim() === '') return;
  
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

// ── ROUTES ───────────────────────────────────────────────────────────────────
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
    const leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    res.json({ count: leads.length, leads });
  } else {
    res.json({ count: 0, leads: [] });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok", version: "5.0-google-sheets" }));

// ── DÉMARRAGE ───────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`\n🚀 ERPAC Bot v5.0 (Google Sheets) démarré sur le port ${PORT}`);
  await initGoogleSheets();
  console.log(`📝 Leads sauvegardés dans: ${LEADS_FILE}`);
  console.log(`🔗 Webhook WhatsApp: /webhook/whatsapp`);
  console.log(`📊 Voir les leads: /leads\n`);
});
