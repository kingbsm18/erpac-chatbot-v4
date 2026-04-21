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

async function addLeadToSheet(clientData, estimateData, ttcValue) {
  if (!sheets) return false;
  const now = new Date().toLocaleString("fr-MA", { timeZone: "Africa/Casablanca" });
  const values = [[
    now,
    clientData.nom || "",
    clientData.telephone || "",
    clientData.email || "",
    estimateData.project_type || "",
    estimateData.city || "",
    estimateData.surface || "",
    estimateData.floors || 1,
    estimateData.standing || "Moyen",
    estimateData.basement ? "Oui" : "Non",
    estimateData.soil === "rocheux" ? "Rocheux (+25k DH)" : "Normal",
    estimateData.pool ? "Oui (+130k DH)" : "Non",
    estimateData.ac === "gainable" ? "Oui (+500 DH/m²)" : "Non",
    estimateData.home_automation ? "Oui (+800 DH/m²)" : "Non",
    ttcValue,
    `https://wa.me/${clientData.telephone.replace(/[^0-9]/g, "")}`,
    "Nouveau - À contacter"
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
function saveLeadToFile(clientData, estimateData, ttcValue) {
  const lead = {
    timestamp: new Date().toISOString(),
    date_fr: new Date().toLocaleString("fr-MA", { timeZone: "Africa/Casablanca" }),
    client: clientData,
    project: {
      type: estimateData.project_type || "",
      city: estimateData.city || "",
      surface: estimateData.surface || "",
      floors: estimateData.floors || 1,
      standing: estimateData.standing || "Moyen",
      basement: estimateData.basement || false,
      soil: estimateData.soil || "normal",
      pool: estimateData.pool || false,
      ac: estimateData.ac || "none",
      home_automation: estimateData.home_automation || false,
    },
    amount: ttcValue,
    status: "Nouveau - À contacter",
  };
  let leads = [];
  if (fs.existsSync(LEADS_FILE)) {
    try { leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8")); } catch(e) { leads = []; }
  }
  leads.push(lead);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
  console.log(`✅ Lead sauvegardé localement: ${clientData.nom}`);
}

async function notifyLead(clientData, estimateData, ttcValue) {
  saveLeadToFile(clientData, estimateData, ttcValue);
  await addLeadToSheet(clientData, estimateData, ttcValue);
}

// ─────────────────────────────────────────────────────────────────────────────
//  KNOWLEDGE BASE (ENRICHED)
// ─────────────────────────────────────────────────────────────────────────────
const KB = {
  name: "ERPAC (Entreprise de Réalisation de Projets d'Aménagement et de Construction)",
  phones: ["+212 669 078 556", "+212 537 222 222"],
  email: "info@erpac.ma",
  location: "Rue Dakar, Imm N°5 Appt 1, Océan – Rabat",
  presentation: "ERPAC est une entreprise de BTP qualifiée par le ministère de l'Habitat. Experts en Gros Œuvre, Aménagement et Étanchéité depuis plus de 10 ans.",
  services: [
    { id: 1, name: "📐 Études & Conception", desc: "Plans, faisabilité, permis de construire, assistance MOE." },
    { id: 2, name: "🏗️ Construction Générale", desc: "Villas, immeubles, plateaux bureaux, cliniques." },
    { id: 3, name: "🏗️ Gros Œuvre", desc: "Structure porteuse, fondations, béton armé, charpente." },
    { id: 4, name: "🔧 Lots Techniques (Second Œuvre)", desc: "Plomberie, électricité, revêtements, finitions." },
    { id: 5, name: "🎨 Aménagement & Décoration", desc: "Design intérieur/extérieur, agencement sur-mesure." },
    { id: 6, name: "💧 Étanchéité", desc: "Toitures, terrasses, sous-sols, piscines – garantie 10 ans." },
    { id: 7, name: "🏊 Construction de Piscines", desc: "Piscines clés en main (débordement, traditionnelles, intérieures)." },
    { id: 8, name: "🔄 Rénovation & Réhabilitation", desc: "Rénovation complète ou partielle, mise aux normes." },
    { id: 9, name: "🪑 Mobilier sur Mesure", desc: "Conception et fabrication de meubles personnalisés." },
    { id: 10, name: "🪚 Menuiserie", desc: "Menuiserie bois, aluminium, PVC – portes, fenêtres, agencements." },
    { id: 11, name: "🧱 Cloisonnement & Faux Plafonds", desc: "Cloisons intérieures, doublages, faux plafonds, isolation." }
  ],
  engagements: "Qualité technique, respect des délais, accompagnement personnalisé.",
  luxury: "Villas Haut Standing : domotique, piscine à débordement, marbre, zellige, bois exotique. Rabat, Casablanca, Marrakech."
};

// ─────────────────────────────────────────────────────────────────────────────
//  EXPANDED FAQ SYSTEM
// ─────────────────────────────────────────────────────────────────────────────
const FAQ = [
  { pattern: /\b(etancheite|étanchéité|fuite|humidite|infiltration)\b/i, reply: "L'étanchéité est notre cœur de métier : membranes haute qualité (Sika, Soprema), garantie 10 ans. Souhaitez-vous un devis pour vos travaux d'étanchéité ?" },
  { pattern: /\b(hangar|industriel|depot|entrepôt|dépôt)\b/i, reply: "Hangars en charpente métallique ou béton, dallage industriel haute résistance. Pouvons-nous vous établir une estimation ?" },
  { pattern: /\b(architecte|plan|permis|autorisation|pc)\b/i, reply: "Nous vous accompagnons avec nos architectes partenaires pour les plans, le dépôt du permis et le suivi administratif." },
  { pattern: /\b(villa haut standing|villa luxe|premium|marbre|zellige)\b/i, reply: `${KB.luxury}\nNos clients Premium bénéficient d'un chef de projet dédié. Puis-je vous faire une proposition ?` },
  { pattern: /\b(delai|retard|plannification|quand|combien de temps)\b/i, reply: "Délais moyens : Villa (6-8 mois), Immeuble R+2 (10-12 mois), Rénovation (2-4 mois). Planning sur-mesure." },
  { pattern: /\b(garantie|decennale|assurance|fiabilité)\b/i, reply: "Assurance décennale obligatoire + garantie de parfait achèvement 1 an. Tranquillité d'esprit totale." },
  { pattern: /\b(mobilier sur mesure|meuble|armoire|cuisine sur mesure)\b/i, reply: "Nos ateliers conçoivent des meubles sur mesure (bois, MDF, laqué). Étude gratuite. Voulez-vous un devis pour votre mobilier ?" },
  { pattern: /\b(menuiserie|fenêtre|porte|bois|aluminium|pvc)\b/i, reply: "Menuiserie haut de gamme : bois massif, aluminium thermolaqué, PVC haute performance. Isolation et esthétique garanties. Souhaitez-vous un devis ?" },
  { pattern: /\b(rénovation|renovation|réhabilitation|remise à neuf)\b/i, reply: "Rénovation complète ou partielle : nous transformons votre espace (appartement, villa, bureau). Devis gratuit sur étude." },
  { pattern: /\b(cloison|faux plafond|doublage|placo|isolation)\b/i, reply: "Cloisons, faux plafonds, doublages techniques : nous utilisons des matériaux certifiés (placo, laine de roche). Demandez un chiffrage rapide." },
  { pattern: /\b(etude|plan|permis|feasibilité)\b/i, reply: "Études d’aménagement et de construction, plans 2D/3D, obtention du permis de construire. Nous simplifions vos démarches administratives." }
];

// ─────────────────────────────────────────────────────────────────────────────
//  IMPROVED INTENT DETECTION
// ─────────────────────────────────────────────────────────────────────────────
const INTENT_MAP = [
  { intent: "devis",    pattern: /\b(devis?|prix|estimation|combien|tarif|cout|coût|facture|budget)\b/i },
  { intent: "services", pattern: /\b(services?|prestations?|offres?|travaux|construction|amenagement|étanchéité|piscines?|charpente|hangars?|menuiserie|mobilier|cloison|renovation|etude|plans)\b/i },
  { intent: "projets",  pattern: /\b(projets?|réalisations?|references?|villas?|restaurants?|cliniques?|hangars?|chantiers?)\b/i },
  { intent: "contact",  pattern: /\b(contacts?|téléphones?|telephones?|emails?|adresses?|joindre|appeler|whatsapp)\b/i },
  { intent: "info",     pattern: /\b(qui|erpac|société|entreprise|experience|présent|histoire|presentation)\b/i },
  { intent: "human",    pattern: /\b(humains?|conseillers?|agents?|parler|personnes?|appel|rdv|rencontrer)\b/i },
  { intent: "luxury",   pattern: /\b(luxe|premium|haut standing|marbre|zellige|domotique|standing)\b/i },
  { intent: "features", pattern: /\b(fonctionnalités?|capacités?|platform|système|chatbot|intelligence|faq|simulation|rdv|notification|historique|widget|embarquable)\b/i },
  { intent: "rdv",      pattern: /\b(rdv|rendez-vous|rencontrer|disponibilité|créneau|prendre rendez-vous|appointment)\b/i }
];

// ─────────────────────────────────────────────────────────────────────────────
//  PLATFORM FEATURES
// ─────────────────────────────────────────────────────────────────────────────
const FEATURES = {
  faq_automation: true,
  quote_simulation: true,
  appointment_booking: true,
  human_escalation: true,
  notifications: true,
  conversation_history: true,
  analytics: true,
  responsive_ui: true,
  embeddable_widget: true
};

// ─────────────────────────────────────────────────────────────────────────────
//  NLU HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const CITY_MAP = [
  { pattern: /\b(casa|casablanca|kaza|ddar|bouskoura|ain diab|anfa)\b/i,   city: "Casablanca", zone: "A" },
  { pattern: /\b(rabat|rbat|agdal|souissi|iberia|harhoura)\b/i,           city: "Rabat",       zone: "A" },
  { pattern: /\b(mohammedia)\b/i,                                           city: "Mohammedia",  zone: "A" },
  { pattern: /\b(marrakech|mre|kech|gueliz|hivernage)\b/i,                 city: "Marrakech",   zone: "B" },
  { pattern: /\b(tanger|tanjah|tanja|malabata)\b/i,                        city: "Tanger",      zone: "B" },
  { pattern: /\b(kenitra)\b/i,                                              city: "Kénitra",     zone: "B" },
  { pattern: /\b(agadir|gadir|agdz)\b/i,                                   city: "Agadir",      zone: "C" },
  { pattern: /\b(fes|fez|f[eè]s)\b/i,                                      city: "Fès",         zone: "C" },
  { pattern: /\b(meknes|mekn[eè]s)\b/i,                                    city: "Meknès",      zone: "C" },
  { pattern: /\b(oujda)\b/i,                                                city: "Oujda",       zone: "C" },
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

  const surfM = text.match(/(?<!\d)\b(\d{2,4})\s*m[²2]/i);
  if (surfM) out.surface = parseFloat(surfM[1]);
  const justNumber = text.match(/^\s*(\d{2,4})\s*$/);
  if (justNumber && !surfM) out.surface = parseFloat(justNumber[1]);

  const floorsM = text.match(/[rR]\+(\d)/);
  if (floorsM) out.floors = parseInt(floorsM[1]) + 1;
  if (/\brdc\b/i.test(text)) out.floors = 1;
  if (/\brénovation\b/i.test(text) && floorsM) delete out.floors;

  if (/sous[\s-]?sol/i.test(text)) out.basement = true;
  if (/pas de sous[\s-]?sol/i.test(text)) out.basement = false;
  if (/\bsans sous[\s-]?sol\b/i.test(text)) out.basement = false;

  if (/\bpiscine\b/i.test(text) && !/villa|immeuble/i.test(text)) out.pool = true;
  if (/sans piscine/i.test(text)) out.pool = false;

  if (/\bgainable\b/i.test(text)) out.ac = "gainable";
  else if (/\bsplit\b/i.test(text)) out.ac = "split";
  else if (/\bclim\b/i.test(text) && !/\bclimat\b/i.test(text)) out.ac = "split";

  if (/domotique|smart home/i.test(text)) out.home_automation = true;

  if (/\b(rocheux|roche|dur|roc|pierreux)\b/i.test(text)) out.soil = "rocheux";
  if (/\bterrain normal\b|\bsol normal\b/i.test(text)) out.soil = "normal";

  const ptM = t.match(/\b(villa|immeuble|appartement|rénovation|renovation|industriel|hangar)\b/);
  if (ptM) {
    const map = { villa:"villa", immeuble:"immeuble", appartement:"immeuble", "rénovation":"renovation", renovation:"renovation", industriel:"industriel", hangar:"industriel" };
    out.project_type = map[ptM[1]] || ptM[1];
  }

  if (/\béconom/i.test(text) && !/\béconomie\b/.test(t)) out.standing = "economique";
  else if (/\b(moyen|standard|milieu)\b/i.test(text)) out.standing = "moyen";
  else if (/\b(haut|luxe|premium|standing)\b/i.test(text)) out.standing = "haut";

  if (/\boui\b|\byes\b|\b(si|ok|d'accord)\b/i.test(t) && Object.keys(out).length === 0) out._yes = true;
  if (/\bnon\b|\bno\b|\bnope\b/i.test(t) && Object.keys(out).length === 0) out._no = true;

  const cityR = detectCity(text);
  if (cityR) { out.city = cityR.city; out.zone = cityR.zone; }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  CALCULATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────
const ZONES = { A: 1.15, B: 1.10, C: 1.05, D: 1.00 };
const RATES = {
  economique: { gros: 3000, fin: 900 },
  moyen:      { gros: 5500, fin: 1600 },
  haut:       { gros: 10000, fin: 3000 },
};
const PROJ_COEFF = { villa:1.00, immeuble:1.05, renovation:0.60, industriel:0.80 };
const TVA = 0.20, IMPREVU = 0.07, HONO = 0.08;
const ADD = { basement:2000, soil:25000, pool:130000, ac_gainable:500, home_auto:800 };

function fmt(n) { return Math.round(n).toLocaleString("fr-MA") + " DH"; }

function calculate_estimate(d) {
  const zf = ZONES[d.zone] || 1.00;
  const r = RATES[d.standing] || RATES.moyen;
  const pc = PROJ_COEFF[d.project_type] || 1.00;
  const s = d.surface, f = d.floors || 1;

  let gros = r.gros * zf * pc * s * f;
  if (d.basement) gros += ADD.basement * s;
  if (d.soil === "rocheux") gros += ADD.soil;

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
  const standing_labels = { economique:"Économique", moyen:"Moyen", haut:"Haut Standing" };
  return [
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📊 AVANT-MÉTRÉ ERPAC 2026`,
    `${d.project_type.toUpperCase()} | ${d.city} | Zone ${d.zone} | ${standing_labels[d.standing]}`,
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

// ─────────────────────────────────────────────────────────────────────────────
//  STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────
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
    err: "Répondez 1 (Villa), 2 (Immeuble), 3 (Rénovation) ou 4 (Industriel/Hangar).",
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
    err: "Entrez le nom de la ville (ex: Rabat, Casablanca, Marrakech).",
    multi: true,
  },
  {
    key: "surface",
    ask: () => "Surface couverte totale (m²) ?",
    resolve(text, ents) {
      if (ents.surface) return ents.surface;
      const n = parseFloat(text.replace(/[^\d.]/g, ""));
      return n > 0 && n < 10000 ? n : null;
    },
    err: "Entrez une surface valide en m². Ex : 250",
  },
  {
    key: "floors",
    ask: () => "Nombre de niveaux ? (ex: RDC = 1, R+1 = 2, R+2 = 3)",
    resolve(text, ents) {
      if (ents.floors) return ents.floors;
      const t = norm(text);
      if (t === "rdc" || t === "0" || t === "r+0") return 1;
      const m = text.match(/r\+?\s*(\d)/i);
      if (m) return parseInt(m[1]) + 1;
      const n = parseInt(text.replace(/[^\d]/g, ""));
      return n > 0 && n < 10 ? n : null;
    },
    err: "Entrez un nombre de niveaux. Ex : RDC, R+1, R+2",
  },
  {
    key: "basement",
    ask: () => "Sous-sol prévu ? (Oui / Non)",
    resolve(text, ents) {
      if (ents.basement !== undefined) return ents.basement;
      if (ents._yes) return true;
      if (ents._no)  return false;
      const t = norm(text);
      if (/^(oui|o|yes|1)$/.test(t)) return true;
      if (/^(non|n|no|0)$/.test(t))  return false;
      return null;
    },
    err: "Répondez Oui ou Non.",
  },
  {
    key: "standing",
    ask: () => "Standing souhaité ?\n1. Économique (3 000 DH/m²)\n2. Moyen (5 500 DH/m²)\n3. Haut Standing (10 000+ DH/m²)",
    resolve(text, ents) {
      if (ents.standing) return ents.standing;
      const t = norm(text);
      if (t === "1" || /eco/.test(t)) return "economique";
      if (t === "2" || /moy|stand/.test(t)) return "moyen";
      if (t === "3" || /haut|lux|prem|standing/.test(t)) return "haut";
      return null;
    },
    err: "Répondez 1 (Éco), 2 (Moyen) ou 3 (Haut Standing).",
  },
  {
    key: "soil",
    ask: () => "Nature du terrain ?\n1. Normal (meuble, sable)\n2. Rocheux (nécessite terrassement spécial)",
    resolve(text, ents) {
      if (ents.soil) return ents.soil;
      const t = norm(text);
      if (t === "1" || /norm|meuble|sable/.test(t)) return "normal";
      if (t === "2" || /roch|dur|roc/.test(t)) return "rocheux";
      return null;
    },
    err: "Répondez 1 (Normal) ou 2 (Rocheux).",
  },
  {
    key: "options",
    ask: (data) => {
      const base = "Options complémentaires ? (0 = aucune)\n1. Piscine (+130 000 DH)\n2. Clim gainable (+500 DH/m²)\n3. Domotique (+800 DH/m²)\n\nEx: 1,2 ou 1,3 ou 2,3";
      if (data.standing === "haut") return base + "\n💡 Recommandation Haut Standing : piscine + clim gainable + domotique pour une villa premium.";
      return base;
    },
    resolve(text, ents) {
      const t = norm(text);
      const hasDigit = /\b[123]\b/.test(t);
      const hasPool = t.includes("piscine") || t.includes("1");
      const hasAc = t.includes("gainable") || t.includes("2");
      const hasHa = t.includes("domotique") || t.includes("3");
      if (t === "0" || /aucun|non|rien/.test(t)) return { pool: false, ac: "none", home_automation: false };
      if (!hasDigit && !hasPool && !hasAc && !hasHa) return null;
      return { pool: hasPool, ac: hasAc ? "gainable" : "none", home_automation: hasHa };
    },
    multi: true,
    err: "Répondez 0, 1, 2, 3 ou combinaison (ex: 1,2).",
  },
];

const CONTACT_STEPS = [
  { key: "nom",       ask: () => "Pour finaliser, quel est votre nom complet ?" },
  { key: "telephone", ask: () => "Votre numéro de téléphone ?" },
  { key: "email",     ask: () => "Votre adresse email ?" },
];

// ─────────────────────────────────────────────────────────────────────────────
//  CHITCHAT & INTERRUPTS
// ─────────────────────────────────────────────────────────────────────────────
const CHITCHAT = [
  { pattern: /\b(salut|bonjour|salam|hello|hi|hey)\b/i, reply: "Bonjour ! Je suis votre conseiller commercial virtuel ERPAC. Comment puis-je vous aider ?" },
  { pattern: /\b(ca va|cava|labas|labess|comment vas tu)\b/i, reply: "Je vais très bien, merci ! Prêt à concrétiser vos projets de construction." },
  { pattern: /\b(merci|shokran|chokran)\b/i, reply: "Je vous en prie ! Nous restons à votre disposition." },
  { pattern: /\b(au revoir|bye|a plus|bslama)\b/i, reply: "Au revoir ! Merci d'avoir contacté ERPAC. À très bientôt." }
];

function checkInterrupt(text) {
  const isQuestion = /[?]|pourquoi|comment|c.est quoi|qu.est.ce|expliqu|défin|peux.tu|pouvez.vous/i.test(text);
  if (!isQuestion) return null;
  const interrupts = [
    { re: /\broche\b|\brocheux\b|\bterrain dur\b/i, ans: "Terrain rocheux : terrassement spécial (+25 000 DH forfait). Nos équipes sont équipées." },
    { re: /\bpiscine\b/i, ans: "Piscine béton armé, revêtement carrelage ou liner. Forfait base 130 000 DH (8x4m). Options sur devis." },
    { re: /\bgainable\b/i, ans: "Clim gainable idéale >150m². +500 DH/m². Installation dans faux-plafonds." },
    { re: /\bdomotique\b/i, ans: "Domotique : pilotage éclairage, volets, clim, alarme. Devis personnalisé." },
    { re: /\bgarantie\b|\bdecennale\b/i, ans: "Garantie décennale (10 ans) sur tous nos chantiers, conforme loi marocaine." }
  ];
  for (const { re, ans } of interrupts) if (re.test(text)) return ans;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  STATIC RESPONSES
// ─────────────────────────────────────────────────────────────────────────────
const STATIC = {
  services: () => `🏗️ **SERVICES ERPAC**\n\n${KB.services.map(s => `✅ ${s.name} : ${s.desc}`).join("\n")}\n\n${KB.engagements}`,
  contact: () => `📞 **CONTACT ERPAC**\n\nTél: ${KB.phones.join(" / ")}\n✉️ Email: ${KB.email}\n📍 Adresse: ${KB.location}\n\n⏰ Disponible 7j/7 sur WhatsApp.`,
  projets: () => `🏆 **RÉALISATIONS ERPAC**\n\n${KB.projets}\n\nPlus de détails sur nos villas de luxe et projets industriels sur demande.`,
  info: () => `🏢 **QUI SOMMES-NOUS ?**\n\n${KB.presentation}\n\n${KB.engagements}\n\n${KB.projets}`,
  human: () => `👨‍💼 **CONTACT COMMERCIAL**\n\nUn conseiller vous rappelle sous 30 min.\n📞 ${KB.phones[0]}\n✉️ ${KB.email}\nHeures : 8h30-18h00 (Lun-Ven)`,
  luxury: () => `✨ **PRESTIGE ERPAC**\n\n${KB.luxury}\n\nDemandez notre brochure "Villas d'Exception".`,
  features: () => `🤖 **FONCTIONNALITÉS DE NOTRE ASSISTANT INTELLIGENT**\n\n• FAQ automatisée 24/7\n• Simulation de devis en temps réel\n• Prise de rendez-vous en ligne\n• Escalade vers un conseiller humain\n• Notifications par email/WhatsApp\n• Historique des conversations\n• Tableau de bord analytique\n• Interface responsive\n• Widget intégrable sur votre site\n\nTout pour transformer vos prospects en clients.`,
  fallback: () => "Je suis votre conseiller ERPAC. Je peux vous aider avec :\n• DEVIS personnalisé\n• SERVICES\n• PROJETS\n• CONTACT\n• INFO\n• FEATURES (fonctionnalités)\n• RENDEZ-VOUS\n\nQue souhaitez-vous ?",
};

// ─────────────────────────────────────────────────────────────────────────────
//  SESSIONS & HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const sessions = {};

function getSession(id) {
  if (!sessions[id]) sessions[id] = { data: {}, step: null, contact_idx: null, contact_data: {} };
  return sessions[id];
}

function nextMissingStep(data) {
  for (const s of STEPS) {
    if (s.key === "options") {
      if (data.options === undefined && (data.pool === undefined && data.ac === undefined && data.home_automation === undefined)) return s;
    } else if (data[s.key] === undefined) return s;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PROCESS MESSAGE
// ─────────────────────────────────────────────────────────────────────────────
function processMessage(sessionId, raw) {
  const msg = raw.trim();
  const sess = getSession(sessionId);
  const ents = extractEntities(msg);

  // 1. Chitchat
  if (sess.step === null && sess.contact_idx === null) {
    for (const chat of CHITCHAT) {
      if (chat.pattern.test(msg)) return reply(chat.reply, "idle", {});
    }
  }

  // 2. FAQ
  for (const item of FAQ) {
    if (item.pattern.test(msg)) return reply(item.reply, "idle", {});
  }

  // 3. Interrupt during devis
  if (sess.step !== STEPS.findIndex(s => s.key === "options")) {
    const interrupt = checkInterrupt(msg);
    if (interrupt) {
      const currentStep = sess.step !== null ? STEPS[sess.step] : null;
      if (currentStep) return reply(`${interrupt}\n\nPour revenir à votre devis : ${currentStep.ask(sess.data)}`, "devis", sess.data);
      return reply(interrupt, "idle", sess.data);
    }
  }

  // 4. Contact collection
  if (sess.contact_idx !== null) {
    const idx = sess.contact_idx;
    if (idx < CONTACT_STEPS.length) {
      sess.contact_data[CONTACT_STEPS[idx].key] = msg;
      sess.contact_idx++;
      if (sess.contact_idx < CONTACT_STEPS.length) return reply(CONTACT_STEPS[sess.contact_idx].ask(), "contact", sess.data);

      const cd = sess.contact_data;
      const ed = sess.data;
      const fullEstimate = { ...ed, pool: ed.pool || false, ac: ed.ac || "none", home_automation: ed.home_automation || false };
      const estimateResult = calculate_estimate(fullEstimate);
      const ttcValue = fmt(estimateResult.ttc);
      notifyLead(cd, ed, ttcValue);

      const summary = `✅ **DEMANDE ENREGISTRÉE**\n\n📋 Client: ${cd.nom}\n📞 Tél: ${cd.telephone}\n✉️ Email: ${cd.email}\n\n🏗️ Projet: ${ed.project_type}\n📍 Ville: ${ed.city}\n📐 Surface: ${ed.surface} m²\n💰 Montant estimé: ${ttcValue}\n\n👨‍💼 Un ingénieur vous contacte sous 24h.\n📞 ${KB.phones[0]}`;
      delete sessions[sessionId];
      return reply(summary, "idle", {});
    }
  }

  // 5. Active devis tunnel
  if (sess.step !== null) {
    const step = STEPS[sess.step];
    const intent = detectIntent(msg);
    if (intent && intent !== "devis" && Object.keys(ents).filter(k => !k.startsWith("_")).length === 0) {
      const staticReply = STATIC[intent] ? STATIC[intent]() : STATIC.fallback();
      return reply(`${staticReply}\n\n─────────\n${step.ask(sess.data)}`, "devis", sess.data);
    }

    let val = step.resolve(msg, ents);
    if (val === null) return reply(`❌ ${step.err}\n\n${step.ask(sess.data)}`, "devis", sess.data);

    if (step.key === "options") {
      sess.data.options = val;
      if (val.pool !== undefined) sess.data.pool = val.pool;
      if (val.ac !== undefined) sess.data.ac = val.ac;
      if (val.home_automation !== undefined) sess.data.home_automation = val.home_automation;
    } else if (step.multi && typeof val === "object") Object.assign(sess.data, val);
    else sess.data[step.key] = val;

    const next = nextMissingStep(sess.data);
    if (next) {
      sess.step = STEPS.indexOf(next);
      return reply(next.ask(sess.data), "devis", sess.data);
    }

    const estimate = renderEstimate({ ...sess.data, pool: sess.data.pool || false, ac: sess.data.ac || "none", home_automation: sess.data.home_automation || false });
    sess.contact_idx = 0;
    sess.step = null;
    return reply(`${estimate}\n\n${CONTACT_STEPS[0].ask()}`, "contact", sess.data);
  }

  // 6. Intent detection (idle)
  const intent = detectIntent(msg);
  if (intent && STATIC[intent]) return reply(STATIC[intent](), "idle", {});

  // 7. Auto-start devis
  if (intent === "devis" || Object.keys(ents).some(k => ["project_type","surface","city"].includes(k))) {
    const data = {};
    if (ents.project_type) data.project_type = ents.project_type;
    if (ents.city) { data.city = ents.city; data.zone = ents.zone; }
    if (ents.surface) data.surface = ents.surface;
    if (ents.floors) data.floors = ents.floors;
    if (ents.standing) data.standing = ents.standing;
    if (ents.basement !== undefined) data.basement = ents.basement;
    if (ents.soil) data.soil = ents.soil;
    if (ents.pool !== undefined || ents.ac || ents.home_automation !== undefined) {
      data.options = { pool: ents.pool||false, ac: ents.ac||"none", home_automation: ents.home_automation||false };
      data.pool = ents.pool||false;
      data.ac = ents.ac||"none";
      data.home_automation = ents.home_automation||false;
    }
    sess.data = data;
    const next = nextMissingStep(sess.data);
    if (next) {
      sess.step = STEPS.indexOf(next);
      return reply(`🏗️ **Simulation de devis ERPAC**\n\n${next.ask(sess.data)}`, "devis", sess.data);
    }
    const estimate = renderEstimate(sess.data);
    sess.contact_idx = 0;
    return reply(`${estimate}\n\n${CONTACT_STEPS[0].ask()}`, "contact", sess.data);
  }

  // 8. RDV / appointment booking
  if (intent === "rdv") {
    sess.contact_idx = 0;
    return reply(`📅 **Prise de rendez-vous**\n\nMerci ! Pour vous proposer un créneau, indiquez-moi vos disponibilités (jour et heure approximative).\n\n${CONTACT_STEPS[0].ask()}`, "contact", sess.data);
  }

  return reply(STATIC.fallback(), "idle", {});
}

function reply(text, next_step, data) {
  return { reply: text, next_step, data };
}

// ─────────────────────────────────────────────────────────────────────────────
//  WHATSAPP SENDER & WEBHOOKS
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

app.post("/estimate", (req, res) => {
  try { res.json({ result: calculate_estimate(req.body), formatted: renderEstimate(req.body) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/leads", (req, res) => {
  if (fs.existsSync(LEADS_FILE)) {
    const leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
    res.json({ count: leads.length, leads });
  } else {
    res.json({ count: 0, leads: [] });
  }
});

app.get("/health", (_, res) => res.json({ status: "ok", version: "6.0-commercial" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 ERPAC Commercial Bot v6.0 sur le port ${PORT}`);
  await initGoogleSheets();
  console.log(`📝 Leads sauvegardés localement dans ${LEADS_FILE}`);
  console.log(`📊 Voir les leads: /leads`);
});
