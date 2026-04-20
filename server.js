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

// ── KB ───────────────────────────────────────────────────────────────────────
const KB = {
  phones: ["+212 669 078 556", "+212 537 222 222"],
  email:  "info@erpac.ma",
  location: "Rue Dakar, Imm N°5 Appt 1, Océan – Rabat",
  services: "Construction · Aménagement · Étanchéité · Piscines",
  projects: "456+ projets : villas, restaurants, cliniques, hangars",
  experience: "10+ ans d'expérience BTP au Maroc",
};

// ── NLU ──────────────────────────────────────────────────────────────────────
const CITY_MAP = [
  { pattern: /\b(casa|casablanca|kaza|ddar|bouskoura|ain diab|anfa)\b/i,   city: "Casablanca", zone: "A" },
  { pattern: /\b(rabat|rbat|agdal|souissi|iberia)\b/i,                     city: "Rabat",       zone: "A" },
  { pattern: /\b(mohammedia)\b/i,                                           city: "Mohammedia",  zone: "A" },
  { pattern: /\b(marrakech|mre|kech|gueliz|hivernage)\b/i,                 city: "Marrakech",   zone: "B" },
  { pattern: /\b(tanger|tanjah|tanja|malabata)\b/i,                        city: "Tanger",      zone: "B" },
  { pattern: /\b(kenitra)\b/i,                                              city: "Kénitra",     zone: "B" },
  { pattern: /\b(agadir|gadir|agdz)\b/i,                                   city: "Agadir",      zone: "C" },
  { pattern: /\b(fes|fez|f[eè]s)\b/i,                                      city: "Fès",         zone: "C" },
  { pattern: /\b(meknes|mekn[eè]s)\b/i,                                    city: "Meknès",      zone: "C" },
  { pattern: /\b(oujda)\b/i,                                                city: "Oujda",       zone: "C" },
];

// CORRECTION: Patterns avec pluriels (s? = optionnel)
const INTENT_MAP = [
  { intent: "devis",    pattern: /\b(devis?|prix|estimation|combien|tarif|cout|coût)\b/i },
  { intent: "services", pattern: /\b(services?|prestations?|offres?|travaux|construction|amenagement|étanchéité|piscines?)\b/i },
  { intent: "projets",  pattern: /\b(projets?|réalisations?|references?|villas?|restaurants?|cliniques?|hangars?)\b/i },
  { intent: "contact",  pattern: /\b(contacts?|téléphones?|telephones?|emails?|adresses?|joindre|appeler)\b/i },
  { intent: "info",     pattern: /\b(qui|erpac|société|entreprise|experience|présent)\b/i },
  { intent: "human",    pattern: /\b(humains?|conseillers?|agents?|parler|personnes?)\b/i },
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

  // Surface
  const surfM = text.match(/(?<!\d)\b(\d{2,4})\s*m[²2]/i);
  if (surfM) out.surface = parseFloat(surfM[1]);
  
  const justNumber = text.match(/^\s*(\d{2,4})\s*$/);
  if (justNumber && !surfM) out.surface = parseFloat(justNumber[1]);

  // Floors
  const floorsM = text.match(/[rR]\+(\d)/);
  if (floorsM) out.floors = parseInt(floorsM[1]) + 1;
  if (/\brdc\b/i.test(text)) out.floors = 1;
  if (/\brénovation\b/i.test(text) && floorsM) delete out.floors;

  // Basement
  if (/sous[\s-]?sol/i.test(text))      out.basement = true;
  if (/pas de sous[\s-]?sol/i.test(text)) out.basement = false;
  if (/\bsans sous[\s-]?sol\b/i.test(text)) out.basement = false;

  // Pool
  if (/\bpiscine\b/i.test(text) && !/villa|immeuble/i.test(text)) out.pool = true;
  if (/sans piscine/i.test(text))        out.pool = false;

  // AC
  if (/\bgainable\b/i.test(text))        out.ac = "gainable";
  else if (/\bsplit\b/i.test(text))      out.ac = "split";
  else if (/\bclim\b/i.test(text) && !/\bclimat\b/i.test(text)) out.ac = "split";

  // Home automation
  if (/domotique|smart home/i.test(text)) out.home_automation = true;

  // Soil
  if (/\b(rocheux|roche|dur|roc|pierreux)\b/i.test(text)) out.soil = "rocheux";
  if (/\bterrain normal\b|\bsol normal\b/i.test(text)) out.soil = "normal";

  // Project type
  const ptM = t.match(/\b(villa|immeuble|appartement|rénovation|renovation|industriel)\b/);
  if (ptM) {
    const map = { villa:"villa", immeuble:"immeuble", appartement:"immeuble", "rénovation":"renovation", renovation:"renovation", industriel:"industriel" };
    out.project_type = map[ptM[1]] || ptM[1];
  }

  // Standing
  if (/\béconom/i.test(text) && !/\béconomie\b/.test(t)) out.standing = "economique";
  else if (/\b(moyen|standard|milieu)\b/i.test(text)) out.standing = "moyen";
  else if (/\b(haut|luxe|premium|standing)\b/i.test(text)) out.standing = "haut";

  // Yes/No
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
    ask: () => "Type de projet ?\n1. Villa\n2. Immeuble\n3. Rénovation\n4. Industriel",
    resolve(text, ents) {
      if (ents.project_type) return ents.project_type;
      const t = norm(text);
      if (t === "1" || t === "villa") return "villa";
      if (t === "2" || t === "immeuble") return "immeuble";
      if (t === "3" || /rénov|renov/.test(t)) return "renovation";
      if (t === "4" || t === "industriel") return "industriel";
      return null;
    },
    err: "Répondez 1 (Villa), 2 (Immeuble), 3 (Rénovation) ou 4 (Industriel).",
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
    err: "Entrez le nom de la ville (ex: Rabat, Casablanca).",
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
    err: "Entrez une surface valide. Ex : 250",
  },
  {
    key: "floors",
    ask: () => "Nombre de niveaux ? (ex: R+0, R+1, R+2…)",
    resolve(text, ents) {
      if (ents.floors) return ents.floors;
      const t = norm(text);
      if (t === "rdc" || t === "0" || t === "r+0") return 1;
      const m = text.match(/r\+?\s*(\d)/i);
      if (m) return parseInt(m[1]) + 1;
      const n = parseInt(text.replace(/[^\d]/g, ""));
      return n > 0 && n < 10 ? n : null;
    },
    err: "Entrez un nombre de niveaux. Ex : R+1",
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
    ask: () => "Standing ?\n1. Économique (3 000 DH/m²)\n2. Moyen (5 500 DH/m²)\n3. Haut (10 000+ DH/m²)",
    resolve(text, ents) {
      if (ents.standing) return ents.standing;
      const t = norm(text);
      if (t === "1" || /eco/.test(t))          return "economique";
      if (t === "2" || /moy|stand/.test(t))    return "moyen";
      if (t === "3" || /haut|lux|prem/.test(t))return "haut";
      return null;
    },
    err: "Répondez 1, 2 ou 3.",
  },
  {
    key: "soil",
    ask: () => "Nature du terrain ?\n1. Normal\n2. Rocheux",
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
      const base = "Options ? (0 = aucune, ou numéros séparés par virgule)\n1. Piscine (+130 000 DH)\n2. Clim gainable (+500 DH/m²)\n3. Domotique (+800 DH/m²)";
      return data.standing === "haut" ? base + "\n💡 Recommandés pour Haut Standing : 2, 3" : base;
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
    err: "Répondez 0 (aucune), 1 (Piscine), 2 (Clim), 3 (Domotique), ou séparés par virgule (ex: 1,2).",
  },
];

const CONTACT_STEPS = [
  { key: "nom",       ask: () => "Votre nom complet ?" },
  { key: "telephone", ask: () => "Votre téléphone ?"   },
  { key: "email",     ask: () => "Votre email ?"        },
];

// ── INTERRUPTS ──────────────────────────────────────────────────────────────
function checkInterrupt(text) {
  const isQuestion = /[?]|pourquoi|comment|c.est quoi|qu.est.ce|expliqu|défin/i.test(text);
  if (!isQuestion) return null;
  
  const interrupts = [
    { re: /\broche\b|\brocheux\b|\bterrain dur\b/i, ans: "Le terrain rocheux nécessite un terrassement spécial (+25 000 DH forfait)." },
    { re: /\bpiscine\b/i, ans: "Piscine : +130 000 DH forfait (hors équipements optionnels)." },
    { re: /\bgainable\b/i, ans: "Clim gainable : +500 DH/m². Idéal pour surface >150m²." },
    { re: /\bdomotique\b/i, ans: "Domotique : +800 DH/m². Pilotage éclairage, volets, clim." },
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

// ── STATIC REPLIES ────────────────────────────────────────────────────────────
const STATIC = {
  services: () => `Nos services :\n• ${KB.services.split("·").map(s=>s.trim()).join("\n• ")}`,
  contact:  () => `📞 ${KB.phones.join(" / ")}\n✉️ ${KB.email}\n📍 ${KB.location}`,
  projets:  () => KB.projects,
  info:     () => `ERPAC – BTP Maroc.\n${KB.experience}.\n${KB.projects}.`,
  human:    () => `Un conseiller vous contacte sous 30 min.\n📞 ${KB.phones[0]}\n✉️ ${KB.email}`,
  fallback: () => "Je n'ai pas compris.\nEssayez : devis, services, contact, projets.",
};

// ── PROCESS ──────────────────────────────────────────────────────────────────
function processMessage(sessionId, raw) {
  const msg  = raw.trim();
  const sess = getSession(sessionId);
  const ents = extractEntities(msg);
  
  // Interrupt (hors options step)
  if (sess.step !== STEPS.findIndex(s => s.key === "options")) {
    const interrupt = checkInterrupt(msg);
    if (interrupt) return reply(interrupt, "devis", sess.data);
  }

  // Contact collection phase
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
        `✅ Dossier enregistré !\n\nNom    : ${cd.nom}\nTél    : ${cd.telephone}\nEmail  : ${cd.email}\n\nIngénieur ERPAC vous contacte sous 24h.\n📞 ${KB.phones[0]}`,
        "idle", {}
      );
    }
  }

  // Devis flow active
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
    return reply(`${estimate}\n\n─────────────────────────\n${CONTACT_STEPS[0].ask()}`, "contact", sess.data);
  }

  // No active flow
  const intent = detectIntent(msg);
  
  // Réponse directe pour services, projets, etc.
  if (intent && STATIC[intent]) {
    return reply(STATIC[intent](), "idle", {});
  }
  
  // Démarrage devis
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
      return reply(next.ask(sess.data), "devis", sess.data);
    }
    
    const estimate = renderEstimate(sess.data);
    sess.contact_idx = 0;
    return reply(`${estimate}\n\n─────────────────────────\n${CONTACT_STEPS[0].ask()}`, "contact", sess.data);
  }

  return reply(STATIC.fallback(), "idle", {});
}

function reply(text, next_step, data) {
  return { reply: text, next_step, data };
}

// ── WA SENDER ────────────────────────────────────────────────────────────────
async function sendWhatsApp(to, text) {
  if (!WA_TOKEN || !WA_PHONE_ID) return;
  const r = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${WA_TOKEN}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
  });
  if (!r.ok) console.error("WA Error:", await r.text());
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

app.get("/health", (_, res) => res.json({ status: "ok", version: "4.0-final" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ ERPAC v4 final on port ${PORT}`));