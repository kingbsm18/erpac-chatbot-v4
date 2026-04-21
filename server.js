const express = require("express");
const { google } = require("googleapis");
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

// ── GOOGLE SHEETS CONFIGURATION ─────────────────────────────────────────────
const SPREADSHEET_ID = "1XiLalbZsdD34IXsyZ3VcgX2kYgeHk5LOmOKfbNz1y5I";

const GOOGLE_CREDENTIALS = {
  client_email: "erpac-bot-leads@fabled-variety-494013-j9.iam.gserviceaccount.com",
  private_key: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCbYnb6EVOeLHFn
JKejRjcGXuKZrS4SjCbxsDi0gRh3F76z0pa++HZgFEUfU+BwHZT8KiLhbBjUGVJR
X6SEpNBodoNYPG1Y4DAyrv5yOBcoRMrSe2u6G283ogqumJ9LwZAW1ATDemjIQAsG
vfNabhLZtqB369LCMfLYRB1sfE+UXesZx4hhIwSSxkJIpp6nqaKbushGmdYiFG3j
HswfVDm8wIdXDlewPYM6flqZaXl8ZLhfF7FbX5wnYAfW/ZNaI+z9tz4zHVbX4frb
9/4xfy7VdGmssth0iI0yf3FwrloN3auujh+dCzA8iba4kkoJXuZ+YgwKqp0yZhJ5
RvtI1je7AgMBAAECggEAOI4qqtMSocAgWH/Nak6cqXtws6mGWubbJ93RjdVs/6/L
T+0mxARwJYFLNV9Ukcoal3uIrY6oLM64mPicS1Enr9Xu8Xcw/4e90zzBTPZga146
iki0yYzBuriGdc0EMdEWblCmGTYdHEG/IamSgQgOYWKo3m0djWQbtR55rSpD1saV
HpNXo3wRPQycOIjJYCaQs7/ukzLckt0Vtt0CkHXc2eyo+/HxTlpliqg58uMqQKl9
krYdIFz/6pPwduitbiCdAAwDGFpdFMpksKxCfDdd//ZHmeJC0riiBsrm72V6sFCw
eNbq9lM+qf3kgxdzF7A+MXEIo95No8clxbpQvw+loQKBgQDKqRz8TPGpO7LayVw1
Gl60W5/AKIZR6fASl+jZ4F6Eaz7ddMlCJ8abpvcXD+zCw4N0ixJve289t9F58fT3
Jgr4+igD50HGT/QhyA94wQbjuQ15qwfnxogxM9ABUrivZziDZ0p22XXKDCSxiZCb
yKdeLf+O5EzWG8cTSWu14uEjmwKBgQDER/x9jKNIJlZVJiYtE6ejBRPB1h9+/CW+
33OvFDQeL02MlBpTDVZfAj0XtKPY3lPHtrmdAd4LyrOQUP9w9dWTQDkVmV2r5XiV
QUuSeqwjYztBwzJ8PxnVuxLHJXvbAGpu4pOA3rDbiZmQoIFPpa0g/6vDDhG8GQWi
KsjdnTPOYQKBgQC/Y55gFzpSHHL4dBmEfPbbVXw0uRDA4zE6HgRlXqNkYvPnqJc4
xt+lt7S6Luvls0a+FWi/p86Sdrp5c6tojKDoKTcJGKjhZDimfo09+O1MukKjmIXK
nuY99B/V0im6oF88jKbUFMLEwsu8kS0oqFQEazE4A4FJAEdObv0bdavo76QKBgGpY
ZmDPthf9TYFM7ho2L/mPYqj/DomKrBjCkLcnRyWjk2y7QZgF/en0GI2jfbKeot3u
DpsWy+uvo6JpgDz/tPvXLBabxbjA15hmjD+M33884Ho8/Dl9Js46UW48zOJXU1NI
x4pnHYOVBfLqQ6WXqjnazIEeOlWjaP34GGSaK9uBAoGBAJrEbseAD802xn4KyRe7
pglY16p3zc9bgwwlgTtx7lPrGtjO12S+RlJxNkFNOASYtXPV3CExc3O1aWp3ncaL
6szjZGUHg36ncopsip2Fdm+exqGEigYYZFwQUxDk0FwuiEora0VnqAFgixEjnVM/
wJ7Gz3ijWz4jBMdiEFbU7oTN
-----END PRIVATE KEY-----\n`,
};

let sheets = null;

async function initGoogleSheets() {
  try {
    const auth = new google.auth.JWT(
      GOOGLE_CREDENTIALS.client_email,
      null,
      GOOGLE_CREDENTIALS.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    console.log('✅ Google Sheets connecté');
  } catch (error) {
    console.error('❌ Erreur Sheets:', error.message);
  }
}

async function addLeadToSheet(clientData, estimateData, ttcValue) {
  if (!sheets) return;
  const now = new Date().toLocaleString('fr-MA', { timeZone: 'Africa/Casablanca' });
  const values = [[
    now, clientData.nom, clientData.telephone, clientData.email,
    clientData.service || estimateData.project_type || '',
    clientData.surface || '', clientData.budget || '',
    ttcValue, clientData.rdv || '', clientData.lang || 'fr', 'Nouveau'
  ]];
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Leads!A:K',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values },
    });
    console.log(`✅ Lead ajouté: ${clientData.nom}`);
  } catch (error) {
    console.error('❌ Erreur ajout:', error.message);
  }
}

// ── BASE DE CONNAISSANCES ERPAC (Conforme CDC) ──────────────────────────────
const KB = {
  company: {
    name: "ERPAC SARL",
    founded: 2020,
    location: "Rue Dakar, Imm N°5 Appt 1, Océan – Rabat",
    ceo: "Mustapha ESSARHANI (Ingénieur Génie Civil)",
    cfo: "Maroua ZITOUNI (Architecte d'Intérieur)",
    projects: 456,
    clients: 513,
    engineers: 53,
    experience: "10+ ans",
    hours: "Lundi – Samedi : 8h30 – 16h30 | Dimanche : Fermé"
  },
  values: ["Excellence", "Confiance", "Ambition", "Convivialité", "Proximité"],
  services: [
    { id: 1, name_fr: "Études des Projets", name_ar: "دراسة المشاريع", name_en: "Project Studies", desc_fr: "Études d'aménagement et de construction (plans, faisabilité, permis)", desc_ar: "دراسات التهيئة والبناء (مخططات، جدوى، رخص)", desc_en: "Development and construction studies (plans, feasibility, permits)" },
    { id: 2, name_fr: "Construction Générale", name_ar: "البناء العام", name_en: "General Construction", desc_fr: "Bâtiments résidentiels (villas, immeubles) et commerciaux", desc_ar: "المباني السكنية (فلل، عمارات) والتجارية", desc_en: "Residential (villas, buildings) and commercial buildings" },
    { id: 3, name_fr: "Aménagement & Décoration", name_ar: "التهيئة والديكور", name_en: "Interior Design", desc_fr: "Aménagement et décoration d'espaces intérieurs et extérieurs", desc_ar: "تهيئة وديكور المساحات الداخلية والخارجية", desc_en: "Interior and exterior decoration" },
    { id: 4, name_fr: "Lots Techniques (Second Œuvre)", name_ar: "الأشغال التقنية", name_en: "Technical Works", desc_fr: "Revêtements, plomberie, électricité, finitions", desc_ar: "الكساء، السباكة، الكهرباء، التشطيبات", desc_en: "Coatings, plumbing, electricity, finishes" },
    { id: 5, name_fr: "Étanchéité", name_ar: "العزل المائي", name_en: "Waterproofing", desc_fr: "Solutions d'étanchéité pour toitures, murs, fondations et terrasses", desc_ar: "حلول العزل المائي للأسطح والجدران والأساسات والتراسات", desc_en: "Waterproofing solutions for roofs, walls, foundations and terraces" },
    { id: 6, name_fr: "Construction de Piscines", name_ar: "بناء المسابح", name_en: "Pool Construction", desc_fr: "Piscines clés en main", desc_ar: "مسابح جاهزة", desc_en: "Turnkey swimming pools" },
    { id: 7, name_fr: "Gros Œuvre", name_ar: "الأشغال الكبرى", name_en: "Structural Work", desc_fr: "Structure porteuse du bâtiment", desc_ar: "الهيكل الحامل للمبنى", desc_en: "Building load-bearing structure" },
    { id: 8, name_fr: "Aménagement & Réhabilitation", name_ar: "التهيئة وإعادة التأهيل", name_en: "Renovation", desc_fr: "Réhabilitation d'espaces existants", desc_ar: "إعادة تأهيل المساحات القائمة", desc_en: "Renovation of existing spaces" },
    { id: 9, name_fr: "Mobilier sur Mesure", name_ar: "الأثاث حسب الطلب", name_en: "Custom Furniture", desc_fr: "Conception et fabrication de mobilier personnalisé", desc_ar: "تصميم وتصنيع أثاث مخصص", desc_en: "Custom furniture design and manufacturing" },
    { id: 10, name_fr: "Menuiserie", name_ar: "النجارة", name_en: "Carpentry", desc_fr: "Menuiserie bois, aluminium, PVC", desc_ar: "نجارة الخشب، الألمنيوم، PVC", desc_en: "Wood, aluminum, PVC carpentry" },
    { id: 11, name_fr: "Cloisonnement", name_ar: "الفواصل", name_en: "Partitioning", desc_fr: "Cloisons intérieures, doublages, faux plafonds", desc_ar: "الفواصل الداخلية، التكسية، الأسقف المستعارة", desc_en: "Interior partitions, linings, false ceilings" }
  ],
  projects_gallery: {
    fr: { villas: "Villas de luxe à Harhoura, Rabat, Casablanca", commercial: "Clinique d'Agdal, Plateaux bureaux", industrial: "Hangars à Mohammedia", restaurants: "Restaurants à Marrakech" },
    ar: { villas: "فلل فاخرة في هرهرة، الرباط، الدار البيضاء", commercial: "عيادة أكدال، مكاتب إدارية", industrial: "مستودعات في المحمدية", restaurants: "مطاعم في مراكش" },
    en: { villas: "Luxury villas in Harhoura, Rabat, Casablanca", commercial: "Agdal Clinic, Office spaces", industrial: "Warehouses in Mohammedia", restaurants: "Restaurants in Marrakech" }
  },
  contacts: {
    phone: ["+212 669 078 556", "+212 537 222 222"],
    email: "info@erpac.ma",
    website: "www.erpac.ma"
  }
};

// ── MULTILINGUISME COMPLET (Français, Arabe, Anglais) ───────────────────────
const lang = {
  fr: {
    code: 'fr',
    name: 'Français',
    welcome: "Bonjour ! Je suis l'assistant virtuel d'ERPAC. Comment puis-je vous aider ?\n\n🇫🇷 Français | 🇬🇧 English | 🇸🇦 العربية\n\nTapez :\n• SERVICES\n• DEVIS\n• CONTACT\n• PROJETS\n• HORAIRES",
    services: "📋 **Nos services :**\n\n" + KB.services.map(s => `${s.id}. ${s.name_fr}\n   ${s.desc_fr}`).join("\n\n"),
    devis_start: "📊 Je vais vous aider à obtenir un devis gratuit. Quel service vous intéresse ?\n\n" + KB.services.map(s => `${s.id}. ${s.name_fr}`).join("\n"),
    rdv: "📅 Quel créneau vous arrange ? (ex: lundi 10h, mercredi 14h)",
    contact: `📞 **Nous contacter**\n\nTél: ${KB.contacts.phone.join(" / ")}\n✉️ Email: ${KB.contacts.email}\n📍 ${KB.company.location}\n⏰ ${KB.company.hours}\n🌐 ${KB.contacts.website}`,
    bye: "Merci d'avoir contacté ERPAC ! À bientôt.",
    fallback: "Je n'ai pas compris. Tapez :\n• SERVICES\n• DEVIS\n• CONTACT\n• PROJETS\n• HORAIRES\n• INFO",
    surface: "📐 Quelle est la surface approximative (m²) ?",
    budget: "💰 Quel est votre budget estimatif ?",
    terrain: "🏞️ Avez-vous déjà un terrain ? (Oui/Non)",
    name: "👤 Votre nom complet ?",
    phone: "📞 Votre numéro de téléphone ?",
    email: "✉️ Votre adresse email ?",
    rdv_day: "📅 Quel jour souhaitez-vous ? (ex: lundi, mardi)",
    rdv_time: "⏰ Quelle heure ? (ex: 10h, 14h30)",
    confirm: "✅ Votre demande a bien été enregistrée !"
  },
  ar: {
    code: 'ar',
    name: 'العربية',
    welcome: "مرحباً! أنا المساعد الافتراضي لشركة إيرباك. كيف يمكنني مساعدتك؟\n\n🇫🇷 Français | 🇬🇧 English | 🇸🇦 العربية\n\nاكتب:\n• SERVICES الخدمات\n• DEVIS عرض سعر\n• CONTACT اتصل بنا\n• PROJETS مشاريعنا\n• HORAIRES ساعات العمل",
    services: "📋 **خدماتنا:**\n\n" + KB.services.map(s => `${s.id}. ${s.name_ar}\n   ${s.desc_ar}`).join("\n\n"),
    devis_start: "📊 سأساعدك في الحصول على عرض أسعار مجاني. ما الخدمة التي تهمك؟\n\n" + KB.services.map(s => `${s.id}. ${s.name_ar}`).join("\n"),
    rdv: "📅 ما هو الموعد المناسب لك؟ (مثال: الاثنين 10 صباحاً)",
    contact: `📞 **اتصل بنا**\n\nهاتف: ${KB.contacts.phone.join(" / ")}\n✉️ بريد: ${KB.contacts.email}\n📍 ${KB.company.location}\n⏰ ${KB.company.hours}\n🌐 ${KB.contacts.website}`,
    bye: "شكراً لتواصلك مع إيرباك! إلى اللقاء.",
    fallback: "لم أفهم. اكتب:\n• SERVICES الخدمات\n• DEVIS عرض سعر\n• CONTACT اتصل بنا\n• PROJETS مشاريعنا\n• HORAIRES ساعات العمل\n• INFO معلومات",
    surface: "📐 ما هي المساحة التقريبية (م²)؟",
    budget: "💰 ما هي ميزانيتك التقديرية؟",
    terrain: "🏞️ هل لديك أرض بالفعل؟ (نعم/لا)",
    name: "👤 الاسم الكامل؟",
    phone: "📞 رقم الهاتف؟",
    email: "✉️ البريد الإلكتروني؟",
    rdv_day: "📅 أي يوم تفضل؟ (مثال: الاثنين، الثلاثاء)",
    rdv_time: "⏰ أي ساعة؟ (مثال: 10 صباحاً، 2 ظهراً)",
    confirm: "✅ تم تسجيل طلبك بنجاح!"
  },
  en: {
    code: 'en',
    name: 'English',
    welcome: "Hello! I'm ERPAC's virtual assistant. How can I help you?\n\n🇫🇷 Français | 🇬🇧 English | 🇸🇦 العربية\n\nType:\n• SERVICES\n• QUOTE\n• CONTACT\n• PROJECTS\n• HOURS",
    services: "📋 **Our services:**\n\n" + KB.services.map(s => `${s.id}. ${s.name_en}\n   ${s.desc_en}`).join("\n\n"),
    devis_start: "📊 I'll help you get a free quote. Which service are you interested in?\n\n" + KB.services.map(s => `${s.id}. ${s.name_en}`).join("\n"),
    rdv: "📅 What time works for you? (e.g., Monday 10am, Wednesday 2pm)",
    contact: `📞 **Contact us**\n\nPhone: ${KB.contacts.phone.join(" / ")}\n✉️ Email: ${KB.contacts.email}\n📍 ${KB.company.location}\n⏰ ${KB.company.hours}\n🌐 ${KB.contacts.website}`,
    bye: "Thank you for contacting ERPAC! See you soon.",
    fallback: "I didn't understand. Type:\n• SERVICES\n• QUOTE\n• CONTACT\n• PROJECTS\n• HOURS\n• INFO",
    surface: "📐 What is the approximate area (m²)?",
    budget: "💰 What is your estimated budget?",
    terrain: "🏞️ Do you already have land? (Yes/No)",
    name: "👤 Your full name?",
    phone: "📞 Your phone number?",
    email: "✉️ Your email address?",
    rdv_day: "📅 Which day works for you? (e.g., Monday, Tuesday)",
    rdv_time: "⏰ What time? (e.g., 10am, 2pm)",
    confirm: "✅ Your request has been saved successfully!"
  }
};

// Détection automatique de la langue (Français, Arabe, Anglais)
function detectLang(text) {
  const arabicPattern = /[\u0600-\u06FF]/;
  if (arabicPattern.test(text)) return 'ar';
  const frenchPattern = /\b(bonjour|salut|merci|devis|service|contact|projet|prix|combien|comment|pourquoi|quel|quelle|travaux|construction)\b/i;
  if (frenchPattern.test(text)) return 'fr';
  return 'en';
}

// ── NLU ──────────────────────────────────────────────────────────────────────
const SERVICE_KEYWORDS = {
  fr: {
    "etudes|plan|faisabilité|permis|étude|projet": 1,
    "construction|villa|immeuble|bâtiment|residentiel|maison": 2,
    "aménagement|décoration|interieur|exterieur|design": 3,
    "second oeuvre|revêtement|plomberie|électricité|finitions": 4,
    "etancheite|étanchéité|toiture|terrasse|infiltration|eau": 5,
    "piscine|piscines|swimming|pisciniste": 6,
    "gros oeuvre|structure|porteur|fondation": 7,
    "réhabilitation|renovation|rénovation|rehabilitation": 8,
    "mobilier|meuble|sur mesure|armoire": 9,
    "menuiserie|bois|aluminium|pvc|porte|fenêtre": 10,
    "cloisonnement|cloison|faux plafond|doublage|placo": 11
  },
  en: {
    "study|plan|feasibility|permit|project|design": 1,
    "construction|villa|building|residential|house|home": 2,
    "interior|decoration|design|furnishing|renovation": 3,
    "coating|plumbing|electricity|finishing|flooring|tiling": 4,
    "waterproofing|roof|terrace|leak|damp|moisture": 5,
    "pool|swimming|swimming pool|spa": 6,
    "structural|foundation|frame|concrete|steel": 7,
    "rehabilitation|renovation|remodeling|refurbishment": 8,
    "furniture|custom|cabinet|wardrobe|kitchen": 9,
    "carpentry|wood|aluminum|pvc|door|window": 10,
    "partition|drywall|ceiling|plasterboard|gypsum": 11
  },
  ar: {
    "دراسة|مخطط|جدوى|رخصة|تصميم": 1,
    "بناء|فيلا|عمارة|مبنى|سكني|منزل": 2,
    "تهيئة|ديكور|داخلية|خارجية|تصميم": 3,
    "كساء|سباكة|كهرباء|تشطيب|بلاط": 4,
    "عزل|تسرب|رطوبة|سطح|تراس": 5,
    "مسبح|مسابح|حمام سباحة|piscine": 6,
    "هيكل|أساسات|خرسانة|حديد": 7,
    "ترميم|تأهيل|تجديد": 8,
    "أثاث|مفروشات|خزائن|مطبخ": 9,
    "نجارة|خشب|المنيوم|باب|شباك": 10,
    "فواصل|جص|أسقف|مستعارة": 11
  }
};

function detectService(text, l) {
  const lower = text.toLowerCase();
  const keywords = SERVICE_KEYWORDS[l] || SERVICE_KEYWORDS.fr;
  for (const [pattern, id] of Object.entries(keywords)) {
    if (new RegExp(pattern, 'i').test(lower)) {
      return KB.services.find(s => s.id === id);
    }
  }
  return null;
}

function detectIntent(text, l) {
  const t = text.toLowerCase();
  const patterns = {
    fr: { devis: /devis|prix|estimation|combien|tarif|cout|coût|budget/, services: /service|prestation|offre|travaux/, contact: /contact|téléphone|email|adresse|whatsapp/, projects: /projet|réalisation|référence|chantier/, hours: /horaire|heure|ouverture|fermeture/, rdv: /rdv|rencontre|rendez-vous/, info: /qui|erpac|société|entreprise|histoire/, bye: /au revoir|bye|salut|à plus/ },
    en: { devis: /quote|price|estimation|how much|cost|budget/, services: /service|offer|work/, contact: /contact|phone|email|address|whatsapp/, projects: /project|achievement|reference/, hours: /hour|opening|closing|schedule/, rdv: /appointment|meeting|rdv/, info: /who|erpac|company|history/, bye: /goodbye|bye|see you/ },
    ar: { devis: /عرض سعر|سعر|تكلفة|تقييم|ميزانية/, services: /خدمات|اعمال/, contact: /اتصل|هاتف|بريد|عنوان/, projects: /مشاريع|انجازات/, hours: /ساعات|مواعيد/, rdv: /موعد|لقاء/, info: /من|إيرباك|شركة/, bye: /مع السلامة|وداعا/ }
  };
  const p = patterns[l] || patterns.fr;
  for (const [intent, pattern] of Object.entries(p)) {
    if (pattern.test(t)) return intent;
  }
  return null;
}

// ── SESSIONS ─────────────────────────────────────────────────────────────────
const sessions = {};

function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = {
      lang: 'fr',
      step: null,
      data: {},
      contact_idx: null,
      contact_data: {},
      rdv_step: null
    };
  }
  return sessions[id];
}

const DEVIS_STEPS = [
  { key: "service", askKey: "devis_start" },
  { key: "surface", askKey: "surface" },
  { key: "budget", askKey: "budget" },
  { key: "terrain", askKey: "terrain" }
];

const CONTACT_STEPS = [
  { key: "nom", askKey: "name" },
  { key: "telephone", askKey: "phone" },
  { key: "email", askKey: "email" }
];

const RDV_STEPS = [
  { key: "rdv_date", askKey: "rdv_day" },
  { key: "rdv_time", askKey: "rdv_time" }
];

// ── RÉPONSES STATIQUES MULTILINGUES ─────────────────────────────────────────
function getServicesReply(l) {
  return lang[l].services;
}

function getProjectsReply(l) {
  const gallery = KB.projects_gallery[l];
  if (l === 'fr') {
    return `🏆 **NOS RÉALISATIONS**\n\n• Villas de luxe: ${gallery.villas}\n• Projets commerciaux: ${gallery.commercial}\n• Projets industriels: ${gallery.industrial}\n• Restaurants: ${gallery.restaurants}\n\n📸 Visitez ${KB.contacts.website} pour voir la galerie complète.`;
  } else if (l === 'ar') {
    return `🏆 **مشاريعنا**\n\n• فلل فاخرة: ${gallery.villas}\n• مشاريع تجارية: ${gallery.commercial}\n• مشاريع صناعية: ${gallery.industrial}\n• مطاعم: ${gallery.restaurants}\n\n📸 تفضل بزيارة موقعنا للمعرض الكامل: ${KB.contacts.website}`;
  } else {
    return `🏆 **OUR PROJECTS**\n\n• Luxury villas: ${gallery.villas}\n• Commercial projects: ${gallery.commercial}\n• Industrial projects: ${gallery.industrial}\n• Restaurants: ${gallery.restaurants}\n\n📸 Visit ${KB.contacts.website} for the full gallery.`;
  }
}

function getHoursReply(l) {
  return l === 'fr' ? `⏰ **Horaires ERPAC**\n${KB.company.hours}` : (l === 'ar' ? `⏰ **مواعيد إيرباك**\n${KB.company.hours}` : `⏰ **ERPAC Hours**\n${KB.company.hours}`);
}

function getCompanyInfo(l) {
  if (l === 'fr') {
    return `🏢 **ERPAC SARL**\n\nCréation: ${KB.company.founded}\nCEO: ${KB.company.ceo}\nCFO: ${KB.company.cfo}\nProjets: ${KB.company.projects}+\nClients: ${KB.company.clients}+\nIngénieurs: ${KB.company.engineers}+\nExpérience: ${KB.company.experience}\n\nValeurs: ${KB.values.join(", ")}`;
  } else if (l === 'ar') {
    return `🏢 **إيرباك**\n\nالتأسيس: ${KB.company.founded}\nالمدير العام: ${KB.company.ceo}\nالمدير المالي: ${KB.company.cfo}\nالمشاريع: ${KB.company.projects}+\nالعملاء: ${KB.company.clients}+\nالمهندسون: ${KB.company.engineers}+\nالخبرة: ${KB.company.experience}`;
  } else {
    return `🏢 **ERPAC SARL**\n\nFounded: ${KB.company.founded}\nCEO: ${KB.company.ceo}\nCFO: ${KB.company.cfo}\nProjects: ${KB.company.projects}+\nClients: ${KB.company.clients}+\nEngineers: ${KB.company.engineers}+\nExperience: ${KB.company.experience}\n\nValues: ${KB.values.join(", ")}`;
  }
}

// ── PROCESS PRINCIPAL ───────────────────────────────────────────────────────
function processMessage(sessionId, raw) {
  const msg = raw.trim();
  const sess = getSession(sessionId);
  
  // Détection automatique de la langue si aucune session active
  if (sess.step === null && sess.contact_idx === null && sess.rdv_step === null && !sess.data.service) {
    sess.lang = detectLang(msg);
  }
  
  const l = sess.lang;

  // Intent detection
  const intent = detectIntent(msg, l);

  // Changement de langue manuel
  if (/français|french|fr|🇫🇷/i.test(msg) && !/services|devis|contact/.test(msg.toLowerCase())) {
    sess.lang = 'fr';
    return reply(lang.fr.welcome, "idle", sess.data);
  }
  if (/english|anglais|en|🇬🇧/i.test(msg) && !/services|devis|contact/.test(msg.toLowerCase())) {
    sess.lang = 'en';
    return reply(lang.en.welcome, "idle", sess.data);
  }
  if (/عربية|arabic|arabe|ar|🇸🇦/i.test(msg) && !/services|devis|contact/.test(msg.toLowerCase())) {
    sess.lang = 'ar';
    return reply(lang.ar.welcome, "idle", sess.data);
  }

  // Salutations
  if (/bonjour|salut|hello|مرحبا|salam|hi|hey/.test(msg) && sess.step === null && sess.contact_idx === null && sess.rdv_step === null) {
    return reply(lang[l].welcome, "idle", sess.data);
  }

  if (intent === "bye") {
    delete sessions[sessionId];
    return reply(lang[l].bye, "idle", {});
  }

  // Phase de prise de RDV
  if (sess.rdv_step !== null && sess.rdv_step !== undefined) {
    const step = RDV_STEPS[sess.rdv_step];
    if (step) {
      sess.data[step.key] = msg;
      sess.rdv_step++;
      if (sess.rdv_step < RDV_STEPS.length) {
        return reply(lang[l][RDV_STEPS[sess.rdv_step].askKey], "rdv", sess.data);
      }
      const rdvText = l === 'fr' 
        ? `✅ Rendez-vous enregistré pour le ${sess.data.rdv_date} à ${sess.data.rdv_time}\n\nUn conseiller vous confirmera par email dans les 24h.`
        : (l === 'ar' 
          ? `✅ تم تسجيل موعدك يوم ${sess.data.rdv_date} الساعة ${sess.data.rdv_time}\n\nسيتم تأكيد الموعد عبر البريد الإلكتروني خلال 24 ساعة.`
          : `✅ Appointment scheduled for ${sess.data.rdv_date} at ${sess.data.rdv_time}\n\nA consultant will confirm by email within 24 hours.`);
      delete sessions[sessionId];
      return reply(rdvText, "idle", {});
    }
  }

  // Phase de collecte contact (après devis)
  if (sess.contact_idx !== null && sess.contact_idx !== undefined) {
    const idx = sess.contact_idx;
    if (idx < CONTACT_STEPS.length) {
      sess.contact_data[CONTACT_STEPS[idx].key] = msg;
      sess.contact_idx++;
      if (sess.contact_idx < CONTACT_STEPS.length) {
        return reply(lang[l][CONTACT_STEPS[idx].askKey], "contact", sess.data);
      }
      // Fin du formulaire - Enregistrement lead
      const cd = sess.contact_data;
      const ed = sess.data;
      cd.lang = l;
      
      addLeadToSheet(cd, ed, "Devis sur étude");
      
      const summary = l === 'fr'
        ? `✅ **Votre demande a bien été enregistrée !**\n\n📋 Client: ${cd.nom}\n📞 Tél: ${cd.telephone}\n✉️ Email: ${cd.email}\n\n🏗️ Service: ${ed.service || 'Non spécifié'}\n📐 Surface: ${ed.surface || '?'} m²\n💰 Budget: ${ed.budget || 'Non spécifié'}\n\n👨‍💼 **Un ingénieur ERPAC vous contacte sous 24h.**\n📞 ${KB.contacts.phone[0]}`
        : (l === 'ar'
          ? `✅ **تم تسجيل طلبك بنجاح!**\n\n📋 العميل: ${cd.nom}\n📞 الهاتف: ${cd.telephone}\n✉️ البريد: ${cd.email}\n\n🏗️ الخدمة: ${ed.service || 'غير محدد'}\n📐 المساحة: ${ed.surface || '?'} م²\n💰 الميزانية: ${ed.budget || 'غير محدد'}\n\n👨‍💼 **سيتم التواصل معكم خلال 24 ساعة.**\n📞 ${KB.contacts.phone[0]}`
          : `✅ **Your request has been saved!**\n\n📋 Client: ${cd.nom}\n📞 Phone: ${cd.telephone}\n✉️ Email: ${cd.email}\n\n🏗️ Service: ${ed.service || 'Not specified'}\n📐 Area: ${ed.surface || '?'} m²\n💰 Budget: ${ed.budget || 'Not specified'}\n\n👨‍💼 **An ERPAC engineer will contact you within 24 hours.**\n📞 ${KB.contacts.phone[0]}`);
      
      delete sessions[sessionId];
      return reply(summary, "idle", {});
    }
  }

  // Tunnel Devis actif
  if (sess.step !== null && sess.step !== undefined) {
    const step = DEVIS_STEPS[sess.step];
    if (step) {
      if (step.key === "service") {
        const detected = detectService(msg, l);
        sess.data[step.key] = detected ? (l === 'fr' ? detected.name_fr : (l === 'ar' ? detected.name_ar : detected.name_en)) : msg;
      } else {
        sess.data[step.key] = msg;
      }
      sess.step++;
      
      if (sess.step < DEVIS_STEPS.length) {
        return reply(lang[l][DEVIS_STEPS[sess.step].askKey], "devis", sess.data);
      }
      
      sess.contact_idx = 0;
      sess.step = null;
      const summary = l === 'fr'
        ? `📊 **Récapitulatif de votre demande :**\n\nService: ${sess.data.service}\nSurface: ${sess.data.surface} m²\nBudget: ${sess.data.budget}\nTerrain: ${sess.data.terrain}\n\n${lang[l].name}`
        : (l === 'ar'
          ? `📊 **ملخص طلبك:**\n\nالخدمة: ${sess.data.service}\nالمساحة: ${sess.data.surface} م²\nالميزانية: ${sess.data.budget}\nالأرض: ${sess.data.terrain}\n\n${lang[l].name}`
          : `📊 **Request summary:**\n\nService: ${sess.data.service}\nArea: ${sess.data.surface} m²\nBudget: ${sess.data.budget}\nLand: ${sess.data.terrain}\n\n${lang[l].name}`);
      return reply(summary, "contact", sess.data);
    }
  }

  // Réponses directes aux intents
  if (intent === "services") {
    return reply(getServicesReply(l), "idle", sess.data);
  }
  
  if (intent === "projects") {
    return reply(getProjectsReply(l), "idle", sess.data);
  }
  
  if (intent === "hours") {
    return reply(getHoursReply(l), "idle", sess.data);
  }
  
  if (intent === "contact") {
    return reply(lang[l].contact, "idle", sess.data);
  }
  
  if (intent === "info") {
    return reply(getCompanyInfo(l), "idle", sess.data);
  }
  
  if (intent === "rdv") {
    sess.rdv_step = 0;
    sess.data = {};
    return reply(lang[l][RDV_STEPS[0].askKey], "rdv", sess.data);
  }
  
  if (intent === "devis") {
    sess.step = 0;
    sess.data = {};
    return reply(lang[l].devis_start, "devis", sess.data);
  }

  // Détection automatique d'un service
  const detectedService = detectService(msg, l);
  if (detectedService && sess.step === null && sess.contact_idx === null && sess.rdv_step === null) {
    const serviceName = l === 'fr' ? detectedService.name_fr : (l === 'ar' ? detectedService.name_ar : detectedService.name_en);
    const serviceDesc = l === 'fr' ? detectedService.desc_fr : (l === 'ar' ? detectedService.desc_ar : detectedService.desc_en);
    const replyText = l === 'fr'
      ? `📌 **${serviceName}**\n\n${serviceDesc}\n\nSouhaitez-vous un devis gratuit pour ce service ? (Oui/Non)`
      : (l === 'ar'
        ? `📌 **${serviceName}**\n\n${serviceDesc}\n\nهل ترغب في الحصول على عرض سعر مجاني لهذه الخدمة؟ (نعم/لا)`
        : `📌 **${serviceName}**\n\n${serviceDesc}\n\nWould you like a free quote for this service? (Yes/No)`);
    return reply(replyText, "idle", { service: serviceName });
  }

  // Oui/Non après présentation d'un service
  if (/oui|نعم|yes|o|y/.test(msg) && sess.data.service && !sess.step) {
    sess.step = 0;
    sess.data = { service: sess.data.service };
    return reply(lang[l][DEVIS_STEPS[0].askKey], "devis", sess.data);
  }

  return reply(lang[l].fallback, "idle", sess.data);
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
  } catch (e) { console.error("WhatsApp error:", e); }
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
  } catch (e) { console.error("Webhook error:", e); }
});

app.get("/health", (_, res) => res.json({ status: "ok", version: "5.0-multilingual" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🌍 ERPAC Multilingual Bot v5.0 sur le port ${PORT}`);
  console.log(`   Support: Français | العربية | English`);
  await initGoogleSheets();
});
