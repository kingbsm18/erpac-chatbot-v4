const express = require("express");
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const WA_TOKEN        = process.env.WA_TOKEN;
const WA_PHONE_ID     = process.env.WA_PHONE_ID;
const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || "erpac_verify";

// ── KB ENRICHIE (Version Commerciale) ───────────────────────────────────────
const KB = {
  name: "ERPAC (Entreprise de Réalisation de Projets d'Aménagement et de Construction)",
  phones: ["+212 669 078 556", "+212 537 222 222"],
  email:  "info@erpac.ma",
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

const INTENT_MAP = [
  { intent: "devis",    pattern: /\b(devis?|prix|estimation|combien|tarif|cout|coût|facture|budget)\b/i },
  { intent: "services", pattern: /\b(services?|prestations?|offres?|travaux|construction|amenagement|étanchéité|piscines?|charpente|hangars?)\b/i },
  { intent: "projets",  pattern: /\b(projets?|réalisations?|references?|villas?|restaurants?|cliniques?|hangars?|chantiers?)\b/i },
  { intent: "contact",  pattern: /\b(contacts?|téléphones?|telephones?|emails?|adresses?|joindre|appeler|whatsapp)\b/i },
  { intent: "info",     pattern: /\b(qui|erpac|société|entreprise|experience|présent|histoire|presentation)\b/i },
  { intent: "human",    pattern: /\b(humains?|conseillers?|agents?|parler|personnes?|appel|rdv|rencontrer)\b/i },
  { intent: "luxury",   pattern: /\b(luxe|premium|haut standing|marbre|zellige|domotique|standing)\b/i },
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
  const t   = norm(text);
  const out = {};

  const surfM = text.match(/(?<!\d)\b(\d{2,4})\s*m[²2]/i);
  if (surfM) out.surface = parseFloat(surfM[1]);
  
  const justNumber = text.match(/^\s*(\d{2,4})\s*$/);
  if (justNumber && !surfM) out.surface = parseFloat(justNumber[1]);

  const floorsM = text.match(/[rR]\+(\d)/);
  if (floorsM) out.floors = parseInt(floorsM[1]) + 1;
  if (/\brdc\b/i.test(text)) out.floors = 1;
  if (/\brénovation\b/i.test(text) && floorsM) delete out.floors;

  if (/sous[\s-]?sol/i.test(text))      out.basement = true;
  if (/pas de sous[\s-]?sol/i.test(text)) out.basement = false;
  if (/\bsans sous[\s-]?sol\b/i.test(text)) out.basement = false;

  if (/\bpiscine\b/i.test(text) && !/villa|immeuble/i.test(text)) out.pool = true;
  if (/sans piscine/i.test(text))        out.pool = false;

  if (/\bgainable\b/i.test(text))        out.ac = "gainable";
  else if (/\bsplit\b/i.test(text))      out.ac = "split";
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

// ── CALCULATION ENGINE ───────────────────────────────────────────────────────
const ZONES = { A: 1.15, B: 1.10, C: 1.05, D: 1.00 };
const RATES = {
  economique: { gros: 3000,  fin: 900  },
  moyen:      { gros: 5500,  fin: 1600 },
  haut:       { gros: 10000, fin: 3000 },
};
const PROJ_COEFF = { villa:1.00, immeuble:1.05, renovation:0.60, industriel:0.80 };
const TVA = 0.20, IMPREVU = 0.07, HONO = 0.08;
const ADD = { basement:2000, soil:25000, pool:130000, ac_gainable:500, home_auto:800 };

function fmt(n) { return Math.round(n).toLocaleString("fr-MA") + " DH"; }

function calculate_estimate(d) {
  const zf  = ZONES[d.zone] || 1.00;
  const r   = RATES[d.standing] || RATES.moyen;
  const pc  = PROJ_COEFF[d.project_type] || 1.00;
  const s   = d.surface, f = d.floors || 1;

  let gros = r.gros * zf * pc * s * f;
  if (d.basement)         gros += ADD.basement * s;
  if (d.soil === "rocheux") gros += ADD.soil;

  let fin = r.fin * zf * s * f;
  let opts = 0;
  if (d.pool)                     opts += ADD.pool;
  if (d.ac === "gainable")        opts += ADD.ac_gainable * s;
  if (d.home_automation)          opts += ADD.home_auto * s;

  const base  = gros + fin;
  const hono  = base * HONO;
  const ht    = base + opts + hono;
  const imp   = ht * IMPREVU;
  const tva   = (ht + imp) * TVA;
  const ttc   = ht + imp + tva;

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
      if (t === "1" || /eco/.test(t))          return "economique";
      if (t === "2" || /moy|stand/.test(t))    return "moyen";
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
      if (t === "2" || /roch|dur|roc/.test(t))      return "rocheux";
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
      
      let reply = "";
      if (hasPool) reply += "✅ Piscine ajoutée\n";
      if (hasAc) reply += "✅ Clim gainable ajoutée\n";
      if (hasHa) reply += "✅ Domotique ajoutée\n";
      if (reply) console.log("Options retenues:\n" + reply);
      
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
  { key: "nom",       ask: () => "Pour finaliser, quel est votre nom complet ?" },
  { key: "telephone", ask: () => "Votre numéro de téléphone ?" },
  { key: "email",     ask: () => "Votre adresse email ?" },
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
  contact:  () => `📞 **CONTACT ERPAC**\n\nTél: ${KB.phones.join(" / ")}\n✉️ Email: ${KB.email}\n📍 Adresse: ${KB.location}\n\n⏰ Disponible 7j/7 sur WhatsApp.`,
  projets:  () => `🏆 **RÉALISATIONS ERPAC**\n\n${KB.projets}\n\nPlus de détails sur nos villas de luxe et projets industriels sur demande.`,
  info:     () => `🏢 **QUI SOMMES-NOUS ?**\n\n${KB.presentation}\n\n${KB.engagements}\n\n${KB.projets}`,
  human:    () => `👨‍💼 **CONTACT COMMERCIAL**\n\nUn conseiller ERPAC vous rappelle sous 30 min.\n📞 ${KB.phones[0]}\n✉️ ${KB.email}\n\nHeures ouvrables : 8h30 - 18h00 (Lun-Ven)`,
  luxury:   () => `✨ **PRESTIGE ERPAC**\n\n${KB.luxury}\n\nDemandez notre brochure "Villas d'Exception" pour découvrir nos réalisations.`,
  fallback: () => "Je suis votre conseiller ERPAC. Je peux vous aider avec :\n• Un DEVIS personnalisé\n• Nos SERVICES\n• Nos PROJETS de référence\n• Nos coordonnées (CONTACT)\n• Les informations sur l'entreprise (INFO)\n\nQue souhaitez-vous ?",
};

// ── PROCESS PRINCIPAL AVEC PRIORITÉ COMMERCIALE ──────────────────────────────
function processMessage(sessionId, raw) {
  const msg  = raw.trim();
  const sess = getSession(sessionId);
  const ents = extractEntities(msg);
  
  // 1. PRIORITÉ : Salutations (hors tunnel devis/contact)
  if (sess.step === null && sess.contact_idx === null) {
    for (const chat of CHITCHAT) {
      if (chat.pattern.test(msg)) {
        return reply(chat.reply, "idle", {});
      }
    }
  }

  // 2. FAQ Techniques (réponses expertes)
  for (const item of FAQ) {
    if (item.pattern.test(msg)) {
      return reply(item.reply, "idle", {});
    }
  }

  // 3. Interruptions pendant le devis
  if (sess.step !== STEPS.findIndex(s => s.key === "options")) {
    const interrupt = checkInterrupt(msg);
    if (interrupt) {
      const currentStep = sess.step !== null ? STEPS[sess.step] : null;
      if (currentStep) {
        return reply(`${interrupt}\n\nPour revenir à votre devis : ${currentStep.ask(sess.data)}`, "devis", sess.data);
      }
      return reply(interrupt, "idle", sess.data);
    }
  }

  // 4. Phase de collecte contact
  if (sess.contact_idx !== null) {
    const idx = sess.contact_idx;
    if (idx < CONTACT_STEPS.length) {
      sess.contact_data[CONTACT_STEPS[idx].key] = msg;
      sess.contact_idx++;
      
      if (sess.contact_idx < CONTACT_STEPS.length) {
        return reply(CONTACT_STEPS[sess.contact_idx].ask(), "contact", sess.data);
      }
      
      const cd = sess.contact_data;
      delete sessions[sessionId];
      return reply(
        `✅ **VOTRE DEMANDE EST ENREGISTRÉE**\n\n` +
        `📋 Client : ${cd.nom}\n` +
        `📞 Tél : ${cd.telephone}\n` +
        `✉️ Email : ${cd.email}\n\n` +
        `🏗️ **Récapitulatif du projet :**\n` +
        `• Type : ${sess.data.project_type}\n` +
        `• Ville : ${sess.data.city}\n` +
        `• Surface : ${sess.data.surface} m²\n` +
        `• Niveaux : ${sess.data.floors}\n` +
        `• Standing : ${sess.data.standing}\n\n` +
        `👨‍💼 **Un ingénieur ERPAC vous contacte sous 24h.**\n` +
        `📞 ${KB.phones[0]} pour toute urgence.`,
        "idle", {}
      );
    }
  }

  // 5. Tunnel Devis actif
  if (sess.step !== null) {
    const step = STEPS[sess.step];

    const intent = detectIntent(msg);
    if (intent && intent !== "devis" && Object.keys(ents).filter(k => !k.startsWith("_")).length === 0) {
      const staticReply = STATIC[intent] ? STATIC[intent]() : STATIC.fallback();
      return reply(`${staticReply}\n\n─────────\n${step.ask(sess.data)}`, "devis", sess.data);
    }

    let val = step.resolve(msg, ents);
    if (val === null) {
      return reply(`❌ ${step.err}\n\n${step.ask(sess.data)}`, "devis", sess.data);
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
      return reply(next.ask(sess.data), "devis", sess.data);
    }

    const estimate = renderEstimate({
      ...sess.data,
      pool: sess.data.pool || false,
      ac: sess.data.ac || "none",
      home_automation: sess.data.home_automation || false,
    });
    
    sess.contact_idx = 0;
    sess.step = null;
    return reply(
      `${estimate}\n\n` +
      `─────────────────────────\n` +
      `💡 **Besoin d'une version détaillée avec les matériaux ?**\n` +
      `Notre équipe vous envoie un devis PDF complet.\n\n` +
      `${CONTACT_STEPS[0].ask()}`,
      "contact", sess.data
    );
  }

  // 6. Pas de flow actif - Détection d'intent
  const intent = detectIntent(msg);
  
  if (intent && STATIC[intent]) {
    return reply(STATIC[intent](), "idle", {});
  }
  
  // 7. Démarrage automatique d'un devis
  if (intent === "devis" || Object.keys(ents).some(k => ["project_type","surface","city"].includes(k))) {
    const data = {};
    if (ents.project_type) data.project_type = ents.project_type;
    if (ents.city)         { data.city = ents.city; data.zone = ents.zone; }
    if (ents.surface)      data.surface = ents.surface;
    if (ents.floors)       data.floors = ents.floors;
    if (ents.standing)     data.standing = ents.standing;
    if (ents.basement !== undefined) data.basement = ents.basement;
    if (ents.soil)         data.soil = ents.soil;
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
      return reply(
        `🏗️ **Bienvenue chez ERPAC - Simulation de devis**\n\n` +
        `${next.ask(sess.data)}`,
        "devis", sess.data
      );
    }
    
    const estimate = renderEstimate(sess.data);
    sess.contact_idx = 0;
    return reply(
      `${estimate}\n\n` +
      `─────────────────────────\n` +
      `${CONTACT_STEPS[0].ask()}`,
      "contact", sess.data
    );
  }

  return reply(STATIC.fallback(), "idle", {});
}

function reply(text, next_step, data) {
  return { reply: text, next_step, data };
}

// ── WHATSAPP SENDER ─────────────────────────────────────────────────────────
async function sendWhatsApp(to, text) {
  if (!WA_TOKEN || !WA_PHONE_ID) return;
  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${WA_TOKEN}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
    });
    if (!r.ok) console.error("WA Error:", await r.text());
  } catch (e) { console.error("WhatsApp send error:", e); }
}

// ── ROUTES ───────────────────────────────────────────────────────────────────
app.post("/webhook", (req, res) => {
  const { session_id, message } = req.body;
  if (!session_id || !message) return res.status(400).json({ error: "session_id and message required" });
  return res.json(processMessage(session_id, message));
});

app.get("/webhook/whatsapp", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
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
  } catch (e) { console.error("WA webhook error:", e); }
});

app.post("/estimate", (req, res) => {
  try { res.json({ result: calculate_estimate(req.body), formatted: renderEstimate(req.body) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/health", (_, res) => res.json({ status: "ok", version: "4.0-commercial" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🏗️ ERPAC Commercial v4.0 en ligne sur le port ${PORT}`));
