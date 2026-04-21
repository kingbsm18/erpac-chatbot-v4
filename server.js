const express = require("express");
const nodemailer = require("nodemailer");
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

// ── CONFIGURATION EMAIL (Alertes dirigeant) ─────────────────────────────────
const EMAIL_FOUNDER = process.env.EMAIL_FOUNDER || "adam@erpac.ma";
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

let transporter = null;
if (EMAIL_USER && EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  });
  console.log("✅ Email alert system configured");
} else {
  console.warn("⚠️ Email credentials missing - alerts disabled");
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
  console.log(`✅ Lead sauvegardé localement: ${clientData.nom} - ${clientData.telephone}`);
  return true;
}

// ── KB ENRICHIE (Version Commerciale) ───────────────────────────────────────
const KB = {
  name: "ERPAC (Entreprise de Réalisation de Projets d'Aménagement et de Construction)",
  phones: ["+212 669 078 556", "+212 537 222 222"],
  email: "info@erpac.ma",
  location: "Rue Dakar, Imm N°5 Appt 1, Océan – Rabat",
  presentation: "ERPAC est une entreprise de BTP qualifiée par le ministère de l'Habitat. Nous sommes experts en Gros Œuvre, Aménagement et Étanchéité depuis plus de 10 ans.",
  services: "• Construction de Villas & Immeubles\n• Étanchéité (Toitures, Terrasses, Sous-sols)\n• Aménagement intérieur & Décoration de luxe\n• Charpente Métallique & Hangars Industriels\n• Construction de Piscines & Espaces verts",
  projets: "Nous avons réalisé plus de 456 projets, dont la Clinique d'Agdal, des Hangars à Mohammedia et des Villas de haut standing à Harhoura et Rabat.",
  engagements: "Qualité technique, Respect des délais, et Accompagnement architectural personnalisé.",
  luxury: "Nos Villas Haut Standing : finitions premium, domotique intégrée, piscine à débordement, matériaux nobles (marbre, zellige, bois exotique). Réalisations à Rabat, Casablanca, Marrakech."
};

// ── SMALL TALK & QUESTIONS COMMERCIALES ──────────────────────────────────────
const CHITCHAT = [
  { pattern: /\b(salut|bonjour|salam|hello|hi|hey)\b/i, reply: "Bonjour ! Ravi de vous accueillir chez ERPAC. Je suis votre conseiller commercial virtuel. Comment puis-je vous aider ?" },
  { pattern: /\b(ca va|cava|labas|labess|comment vas tu)\b/i, reply: "Je vais très bien, merci ! Prêt à concrétiser vos projets de construction. Que puis-je faire pour vous ?" },
  { pattern: /\b(merci|shokran|chokran)\b/i, reply: "Je vous en prie ! Nous restons à votre entière disposition pour transformer vos plans en réalité." },
  { pattern: /\b(au revoir|bye|a plus|bslama)\b/i, reply: "Au revoir ! Merci d'avoir contacté ERPAC. À très bientôt pour vos futurs chantiers." }
];

const FAQ = [
  { pattern: /\b(etancheite|étanchéité|fuite|humidite|infiltration)\b/i, reply: "L'étanchéité est l'une de nos grandes spécialités (terrasses, piscines, sous-sols). Nous utilisons des membranes de haute qualité (Sika, Soprema) avec garantie 10 ans. Souhaitez-vous un devis pour vos travaux d'étanchéité ?" },
  { pattern: /\b(hangar|industriel|depot|entrepôt|dépôt)\b/i, reply: "Pour le secteur industriel, nous réalisons des hangars en charpente métallique ou béton avec dallage industriel haute résistance (charge 5T/m²). Pouvons-nous vous établir une estimation ?" },
  { pattern: /\b(architecte|plan|permis|autorisation|pc)\b/i, reply: "Nous vous accompagnons dès la phase de conception avec nos partenaires architectes agréés. Nous gérons le dépôt du permis de construire et le suivi administratif." },
  { pattern: /\b(villa haut standing|villa luxe|premium|marbre|zellige)\b/i, reply: `${KB.luxury}\n\nNos clients haut standing bénéficient d'un suivi personnalisé avec un chef de projet dédié. Puis-je vous faire une proposition ?` },
  { pattern: /\b(delai|retard|plannification|quand|combien de temps)\b/i, reply: "Nos délais moyens : Villa (6-8 mois), Immeuble R+2 (10-12 mois), Rénovation (2-4 mois). Chaque projet a son planning sur-mesure." },
  { pattern: /\b(garantie|decennale|assurance|fiabilité)\b/i, reply: "Tous nos chantiers sont couverts par une assurance décennale. Nous offrons une garantie de parfait achèvement d'un an et une garantie biennale sur les équipements." }
];

// ── NLU (Amélioré avec pluriels) ────────────────────────────────────────────
const CITY_MAP = [
  { pattern: /\b(casa|casablanca|kaza|ddar|bouskoura|ain diab|anfa)\b/i, city: "Casablanca", zone: "A" },
  { pattern: /\b(rabat|rbat|agdal|souissi|iberia|harhoura)\b/i, city: "Rabat", zone: "A" },
  { pattern: /\b(mohammedia)\b/i, city: "Mohammedia", zone: "A" },
  { pattern: /\b(marrakech|mre|kech|gueliz|hivernage)\b/i, city: "Marrakech", zone: "B" },
  { pattern: /\b(tanger|tanjah|tanja|malabata)\b/i, city: "Tanger", zone: "B" },
  { pattern: /\b(kenitra)\b/i, city: "Kénitra", zone: "B" },
  { pattern: /\b(agadir|gadir|agdz)\b/i, city: "Agadir", zone: "C" },
  { pattern: /\b(fes|fez|f[eè]s)\b/i, city: "Fès", zone: "C" },
  { pattern: /\b(meknes|mekn[eè]s)\b/i, city: "Meknès", zone: "C" },
  { pattern: /\b(oujda)\b/i, city: "Oujda", zone: "C" },
];

const INTENT_MAP = [
  { intent: "devis", pattern: /\b(devis?|prix|estimation|combien|tarif|cout|coût|facture|budget)\b/i },
  { intent: "services", pattern: /\b(services?|prestations?|offres?|travaux|construction|amenagement|étanchéité|piscines?|charpente|hangars?)\b/i },
  { intent: "projets", pattern: /\b(projets?|réalisations?|references?|villas?|restaurants?|cliniques?|hangars?|chantiers?)\b/i },
  { intent: "contact", pattern: /\b(contacts?|téléphones?|telephones?|emails?|adresses?|joindre|appeler|whatsapp)\b/i },
  { intent: "info", pattern: /\b(qui|erpac|société|entreprise|experience|présent|histoire|presentation)\b/i },
  { intent: "human", pattern: /\b(humains?|conseillers?|agents?|parler|personnes?|appel|rdv|rencontrer)\b/i },
  { intent: "luxury", pattern: /\b(luxe|premium|haut standing|marbre|zellige|domotique|standing)\b/i },
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
    const map = { villa: "villa", immeuble: "immeuble", appartement: "immeuble", "rénovation": "renovation", renovation: "renovation", industriel: "industriel", hangar: "industriel" };
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
  const standing_labels = { economique: "Économique", moyen: "Moyen", haut: "Haut Standing" };
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

// ── ALERTE DIRIGEANT PAR EMAIL ──────────────────────────────────────────────
async function sendLeadToFounder(clientData, estimateData, ttcValue) {
  // Sauvegarde locale toujours active
  saveLeadToFile(clientData, estimateData, ttcValue);
  
  if (!transporter) {
    console.log("Email alerts disabled - missing credentials");
    return;
  }

  const mailOptions = {
    from: `"ERPAC Bot" <${EMAIL_USER}>`,
    to: EMAIL_FOUNDER,
    subject: `🚨 NOUVEAU LEAD DEVIS - ${clientData.nom}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .header { background: #1a472a; color: white; padding: 20px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { padding: 20px; }
          .section { margin-bottom: 25px; border-bottom: 1px solid #eee; padding-bottom: 15px; }
          .section h2 { color: #1a472a; font-size: 18px; margin-bottom: 10px; }
          .info-row { display: flex; margin-bottom: 8px; }
          .info-label { font-weight: bold; width: 120px; }
          .info-value { flex: 1; }
          .total { background: #e8f5e9; padding: 15px; border-radius: 8px; text-align: center; margin-top: 20px; }
          .total .amount { font-size: 28px; font-weight: bold; color: #1a472a; }
          .footer { background: #f9f9f9; padding: 15px; text-align: center; font-size: 12px; color: #666; }
          .badge { display: inline-block; background: #ff6b35; color: white; padding: 5px 10px; border-radius: 5px; font-size: 12px; margin-left: 10px; }
          .contact-btn { display: inline-block; background: #25D366; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏗️ NOUVEAU LEAD ERPAC</h1>
            <p>Devis généré automatiquement</p>
          </div>
          <div class="content">
            <div class="section">
              <h2>📋 Informations Client</h2>
              <div class="info-row"><div class="info-label">Nom :</div><div class="info-value">${clientData.nom}</div></div>
              <div class="info-row"><div class="info-label">Téléphone :</div><div class="info-value"><a href="tel:${clientData.telephone}">${clientData.telephone}</a></div></div>
              <div class="info-row"><div class="info-label">Email :</div><div class="info-value"><a href="mailto:${clientData.email}">${clientData.email}</a></div></div>
            </div>
            
            <div class="section">
              <h2>🏠 Détails du Projet</h2>
              <div class="info-row"><div class="info-label">Type :</div><div class="info-value">${estimateData.project_type?.toUpperCase() || 'Non spécifié'}</div></div>
              <div class="info-row"><div class="info-label">Ville :</div><div class="info-value">${estimateData.city || 'Non spécifiée'}</div></div>
              <div class="info-row"><div class="info-label">Surface :</div><div class="info-value">${estimateData.surface || '?'} m²</div></div>
              <div class="info-row"><div class="info-label">Niveaux :</div><div class="info-value">${estimateData.floors || 1}</div></div>
              <div class="info-row"><div class="info-label">Standing :</div><div class="info-value">${estimateData.standing || 'Moyen'} ${estimateData.standing === 'haut' ? '<span class="badge">PREMIUM</span>' : ''}</div></div>
              <div class="info-row"><div class="info-label">Sous-sol :</div><div class="info-value">${estimateData.basement ? '✅ Oui' : '❌ Non'}</div></div>
              <div class="info-row"><div class="info-label">Terrain :</div><div class="info-value">${estimateData.soil === 'rocheux' ? 'Rocheux (+25000 DH)' : 'Normal'}</div></div>
            </div>
            
            <div class="section">
              <h2>🔧 Options</h2>
              <div class="info-row"><div class="info-label">Piscine :</div><div class="info-value">${estimateData.pool ? '✅ Oui (+130k DH)' : '❌ Non'}</div></div>
              <div class="info-row"><div class="info-label">Clim gainable :</div><div class="info-value">${estimateData.ac === 'gainable' ? '✅ Oui' : '❌ Non'}</div></div>
              <div class="info-row"><div class="info-label">Domotique :</div><div class="info-value">${estimateData.home_automation ? '✅ Oui' : '❌ Non'}</div></div>
            </div>
            
            <div class="total">
              <div>💰 MONTANT TOTAL TTC</div>
              <div class="amount">${ttcValue}</div>
              <a href="https://wa.me/${clientData.telephone.replace(/[^0-9]/g, '')}" class="contact-btn">📞 Contacter ce client sur WhatsApp</a>
            </div>
          </div>
          <div class="footer">
            Email généré automatiquement par le Bot Commercial ERPAC<br>
            ${new Date().toLocaleString('fr-MA')}
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Email alert sent to ${EMAIL_FOUNDER} for lead ${clientData.nom}`);
  } catch (error) {
    console.error("❌ Email sending error:", error.message);
  }
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
      if (ents._no) return false;
      const t = norm(text);
      if (/^(oui|o|yes|1)$/.test(t)) return true;
      if (/^(non|n|no|0)$/.test(t)) return false;
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
      if (data.standing === "haut") {
        return base + "\n💡 Recommandation Haut Standing : piscine + clim gainable + domotique pour une villa premium.";
      }
      return base;
    },
    resolve(text, ents) {
      const t = norm(text);
      
      const hasDigit = /\b[123]\b/.test(t);
      const hasPool = t.includes("piscine") || t.includes("1");
      const hasAc = t.includes("gainable") || t.includes("2");
      const hasHa = t.includes("domotique") || t.includes("3");
      
      if (t === "0" || /aucun|non|rien/.test(t)) {
        return { pool: false, ac: "none", home_automation: false };
      }
      
      if (!hasDigit && !hasPool && !hasAc && !hasHa) {
        return null;
      }
      
      return {
        pool: hasPool,
        ac: hasAc ? "gainable" : "none",
        home_automation: hasHa
      };
    },
    multi: true,
    err: "Répondez 0, 1, 2, 3 ou combinaison (ex: 1,2).",
  },
];

const CONTACT_STEPS = [
  { key: "nom", ask: () => "Pour finaliser, quel est votre nom complet ?" },
  { key: "telephone", ask: () => "Votre numéro de téléphone ?" },
  { key: "email", ask: () => "Votre adresse email ?" },
];

// ── INTERRUPTS COMMERCIAUX ──────────────────────────────────────────────────
function checkInterrupt(text) {
  const isQuestion = /[?]|pourquoi|comment|c.est quoi|qu.est.ce|expliqu|défin|peux.tu|pouvez.vous/i.test(text);
  if (!isQuestion) return null;
  
  const interrupts = [
    { re: /\broche\b|\brocheux\b|\bterrain dur\b/i, ans: "Le terrain rocheux nécessite un terrassement spécial (+25 000 DH forfait) et parfois du minage. Nos équipes sont équipées pour ce type de sol." },
    { re: /\bpiscine\b/i, ans: "Nos piscines sont construites en béton armé avec revêtement carrelage ou liner. Forfait base : 130 000 DH (8x4m). Options : système de nage à contre-courant, chauffage, hivernage." },
    { re: /\bgainable\b/i, ans: "La clim gainable est idéale pour les surfaces >150m². Installation dans les faux-plafonds + bouches discrètes. +500 DH/m²." },
    { re: /\bdomotique\b/i, ans: "Domotique : pilotage éclairage, volets roulants, climatisation, alarme depuis smartphone. Devis sur étude." },
    { re: /\bgarantie\b|\bdecennale\b/i, ans: "Nous offrons une garantie décennale (10 ans) sur tous nos chantiers, conforme à la loi marocaine. Une tranquillité d'esprit totale." }
  ];
  
  for (const { re, ans } of interrupts) {
    if (re.test(text)) return ans;
  }
  return null;
}

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

// ── STATIC REPLIES ENRICHIES ─────────────────────────────────────────────────
const STATIC = {
  services: () => `🏗️ **SERVICES ERPAC**\n\n${KB.services}\n\n${KB.engagements}`,
  contact: () => `📞 **CONTACT ERPAC**\n\nTél: ${KB.phones.join(" / ")}\n✉️ Email: ${KB.email}\n📍 Adresse: ${KB.location}\n\n⏰ Disponible 7j/7 sur WhatsApp.`,
  projets: () => `🏆 **RÉALISATIONS ERPAC**\n\n${KB.projets}\n\nPlus de détails sur nos villas de luxe et projets industriels sur demande.`,
  info: () => `🏢 **QUI SOMMES-NOUS ?**\n\n${KB.presentation}\n\n${KB.engagements}\n\n${KB.projets}`
