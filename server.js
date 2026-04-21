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

const WA_TOKEN = process.env.WA_TOKEN;
const WA_PHONE_ID = process.env.WA_PHONE_ID;
const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || "erpac_verify";

// ── LEADS STOCKAGE LOCAL ─────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const LEADS_FILE = path.join(__dirname, 'leads.json');

function saveLeadToFile(clientData, estimateData, ttcValue) {
  const lead = {
    timestamp: new Date().toISOString(),
    date_fr: new Date().toLocaleString('fr-MA', { timeZone: 'Africa/Casablanca' }),
    client: clientData,
    project: {
      service: estimateData.service || estimateData.project_type || '',
      surface: estimateData.surface || '',
      budget: estimateData.budget || '',
      terrain: estimateData.terrain || ''
    },
    amount: ttcValue,
    status: 'Nouveau'
  };
  
  let leads = [];
  if (fs.existsSync(LEADS_FILE)) {
    try {
      leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    } catch(e) { leads = []; }
  }
  leads.push(lead);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
  console.log(`✅ Lead sauvegardé: ${clientData.nom} - ${clientData.telephone}`);
  return true;
}

// ── BASE DE CONNAISSANCES ERPAC ─────────────────────────────────────────────
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
    { id: 1, name_fr: "Études des Projets", name_ar: "دراسة المشاريع", name_en: "Project Studies" },
    { id: 2, name_fr: "Construction Générale", name_ar: "البناء العام", name_en: "General Construction" },
    { id: 3, name_fr: "Aménagement & Décoration", name_ar: "التهيئة والديكور", name_en: "Interior Design" },
    { id: 4, name_fr: "Lots Techniques", name_ar: "الأشغال التقنية", name_en: "Technical Works" },
    { id: 5, name_fr: "Étanchéité", name_ar: "العزل المائي", name_en: "Waterproofing" },
    { id: 6, name_fr: "Construction de Piscines", name_ar: "بناء المسابح", name_en: "Pool Construction" },
    { id: 7, name_fr: "Gros Œuvre", name_ar: "الأشغال الكبرى", name_en: "Structural Work" },
    { id: 8, name_fr: "Aménagement & Réhabilitation", name_ar: "التهيئة وإعادة التأهيل", name_en: "Renovation" },
    { id: 9, name_fr: "Mobilier sur Mesure", name_ar: "الأثاث حسب الطلب", name_en: "Custom Furniture" },
    { id: 10, name_fr: "Menuiserie", name_ar: "النجارة", name_en: "Carpentry" },
    { id: 11, name_fr: "Cloisonnement", name_ar: "الفواصل", name_en: "Partitioning" }
  ],
  contacts: {
    phone: ["+212 669 078 556", "+212 537 222 222"],
    email: "info@erpac.ma",
    website: "www.erpac.ma"
  }
};

// ── MULTILINGUISME ─────────────────────────────────────────────────────────
const lang = {
  fr: {
    welcome: "Bonjour ! Je suis l'assistant virtuel d'ERPAC. Comment puis-je vous aider ?\n\n🇫🇷 Français | 🇬🇧 English | 🇸🇦 العربية\n\nTapez :\n• SERVICES\n• DEVIS\n• CONTACT\n• PROJETS\n• HORAIRES",
    services: "📋 **Nos 11 services :**\n\n" + KB.services.map(s => `${s.id}. ${s.name_fr}`).join("\n"),
    devis_start: "📊 Je vais vous aider à obtenir un devis gratuit. Quel service vous intéresse ?\n\n" + KB.services.map(s => `${s.id}. ${s.name_fr}`).join("\n"),
    contact: `📞 **Nous contacter**\n\nTél: ${KB.contacts.phone.join(" / ")}\n✉️ Email: ${KB.contacts.email}\n📍 ${KB.company.location}\n⏰ ${KB.company.hours}`,
    surface: "📐 Quelle est la surface approximative (m²) ?",
    budget: "💰 Quel est votre budget estimatif ?",
    terrain: "🏞️ Avez-vous déjà un terrain ? (Oui/Non)",
    name: "👤 Votre nom complet ?",
    phone: "📞 Votre numéro de téléphone ?",
    email: "✉️ Votre adresse email ?",
    projects: "🏆 **NOS RÉALISATIONS**\n\n• Villas de luxe: Rabat, Casablanca, Marrakech\n• Clinique d'Agdal\n• Hangars à Mohammedia\n• Restaurants à Marrakech\n\n📸 Visitez www.erpac.ma pour voir la galerie complète.",
    hours: `⏰ **Horaires ERPAC**\n${KB.company.hours}`,
    info: `🏢 **ERPAC SARL**\n\nCréation: 2020\nCEO: Mustapha ESSARHANI\nProjets: 456+\nClients: 513+\nExpérience: 10+ ans\nValeurs: Excellence, Confiance, Ambition, Convivialité, Proximité`,
    confirm: "✅ Votre demande a bien été enregistrée !",
    fallback: "Je n'ai pas compris. Tapez : SERVICES, DEVIS, CONTACT, PROJETS, HORAIRES ou INFO"
  },
  ar: {
    welcome: "مرحباً! أنا المساعد الافتراضي لشركة إيرباك.\n\n🇫🇷 Français | 🇬🇧 English | 🇸🇦 العربية\n\nاكتب:\n• SERVICES\n• DEVIS\n• CONTACT\n• PROJETS\n• HORAIRES",
    services: "📋 **خدماتنا:**\n\n" + KB.services.map(s => `${s.id}. ${s.name_ar}`).join("\n"),
    devis_start: "📊 ما الخدمة التي تهمك؟\n\n" + KB.services.map(s => `${s.id}. ${s.name_ar}`).join("\n"),
    contact: `📞 **اتصل بنا**\n\nهاتف: ${KB.contacts.phone.join(" / ")}\n✉️ بريد: ${KB.contacts.email}\n📍 ${KB.company.location}\n⏰ ${KB.company.hours}`,
    surface: "📐 ما هي المساحة التقريبية (م²)؟",
    budget: "💰 ما هي ميزانيتك التقديرية؟",
    terrain: "🏞️ هل لديك أرض بالفعل؟ (نعم/لا)",
    name: "👤 الاسم الكامل؟",
    phone: "📞 رقم الهاتف؟",
    email: "✉️ البريد الإلكتروني؟",
    projects: "🏆 **مشاريعنا**\n\n• فلل فاخرة: الرباط، الدار البيضاء، مراكش\n• عيادة أكدال\n• مستودعات في المحمدية\n• مطاعم في مراكش\n\n📸 تفضل بزيارة موقعنا للمعرض الكامل: www.erpac.ma",
    hours: `⏰ **مواعيد إيرباك**\n${KB.company.hours}`,
    info: `🏢 **إيرباك**\n\nالتأسيس: 2020\nالمدير: مصطفى الصحراني\nالمشاريع: 456+\nالعملاء: 513+\nالخبرة: 10+ سنوات`,
    confirm: "✅ تم تسجيل طلبك بنجاح!",
    fallback: "لم أفهم. اكتب: SERVICES, DEVIS, CONTACT, PROJETS, HORAIRES"
  },
  en: {
    welcome: "Hello! I'm ERPAC's virtual assistant.\n\n🇫🇷 Français | 🇬🇧 English | 🇸🇦 العربية\n\nType:\n• SERVICES\n• QUOTE\n• CONTACT\n• PROJECTS\n• HOURS",
    services: "📋 **Our 11 services:**\n\n" + KB.services.map(s => `${s.id}. ${s.name_en}`).join("\n"),
    devis_start: "📊 Which service interests you?\n\n" + KB.services.map(s => `${s.id}. ${s.name_en}`).join("\n"),
    contact: `📞 **Contact us**\n\nPhone: ${KB.contacts.phone.join(" / ")}\n✉️ Email: ${KB.contacts.email}\n📍 ${KB.company.location}\n⏰ ${KB.company.hours}`,
    surface: "📐 What is the approximate area (m²)?",
    budget: "💰 What is your estimated budget?",
    terrain: "🏞️ Do you already have land? (Yes/No)",
    name: "👤 Your full name?",
    phone: "📞 Your phone number?",
    email: "✉️ Your email address?",
    projects: "🏆 **OUR PROJECTS**\n\n• Luxury villas: Rabat, Casablanca, Marrakech\n• Agdal Clinic\n• Warehouses in Mohammedia\n• Restaurants in Marrakech\n\n📸 Visit www.erpac.ma for the full gallery.",
    hours: `⏰ **ERPAC Hours**\n${KB.company.hours}`,
    info: `🏢 **ERPAC SARL**\n\nFounded: 2020\nCEO: Mustapha ESSARHANI\nProjects: 456+\nClients: 513+\nExperience: 10+ years`,
    confirm: "✅ Your request has been saved!",
    fallback: "I didn't understand. Type: SERVICES, QUOTE, CONTACT, PROJECTS, HOURS"
  }
};

// ── DÉTECTION ─────────────────────────────────────────────────────────────
function detectLang(text) {
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/bonjour|salut|merci|devis|service|contact|projet|prix|combien|comment|travaux|construction/i.test(text)) return 'fr';
  return 'en';
}

function detectService(text, l) {
  const t = text.toLowerCase();
  for (let i = 0; i < KB.services.length; i++) {
    const s = KB.services[i];
    const names = [s.name_fr.toLowerCase(), s.name_ar.toLowerCase(), s.name_en.toLowerCase()];
    if (names.some(n => t.includes(n))) return s;
  }
  const numMatch = t.match(/\b([1-9]|10|11)\b/);
  if (numMatch) {
    const num = parseInt(numMatch[1]);
    return KB.services.find(s => s.id === num);
  }
  return null;
}

function detectIntent(text, l) {
  const t = text.toLowerCase();
  if (/devis|prix|estimation|combien|quote|عرض سعر/.test(t)) return "devis";
  if (/service|prestation|offre|خدمات/.test(t)) return "services";
  if (/contact|telephone|email|whatsapp|اتصل/.test(t)) return "contact";
  if (/projet|realisation|villa|immeuble|مشاريع/.test(t)) return "projects";
  if (/horaire|heure|ouverture|مواعيد/.test(t)) return "hours";
  if (/info|entreprise|societe|qui|شركة/.test(t)) return "info";
  return null;
}

// ── SESSIONS ────────────────────────────────────────────────────────────────
const sessions = {};

function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = { lang: 'fr', step: null, data: {}, contact_idx: null, contact_data: {} };
  }
  return sessions[id];
}

const DEVIS_STEPS = ["service", "surface", "budget", "terrain"];
const CONTACT_STEPS = ["nom", "telephone", "email"];

// ── PROCESS MESSAGE ─────────────────────────────────────────────────────────
function processMessage(sessionId, raw) {
  const msg = raw.trim();
  const sess = getSession(sessionId);
  
  // Détection langue au début de la session
  if (sess.step === null && sess.contact_idx === null) {
    sess.lang = detectLang(msg);
  }
  const l = sess.lang;

  // Changement de langue manuel
  if (/^français$|^french$|^fr$|^🇫🇷$/i.test(msg)) { 
    sess.lang = 'fr'; 
    return { reply: lang.fr.welcome, next_step: "idle", data: {} };
  }
  if (/^english$|^anglais$|^en$|^🇬🇧$/i.test(msg)) { 
    sess.lang = 'en'; 
    return { reply: lang.en.welcome, next_step: "idle", data: {} };
  }
  if (/^عربية$|^arabic$|^ar$|^🇸🇦$/i.test(msg)) { 
    sess.lang = 'ar'; 
    return { reply: lang.ar.welcome, next_step: "idle", data: {} };
  }

  // Salutations
  if (/^(bonjour|salut|hello|مرحبا|salam|hi|hey)$/i.test(msg) && sess.step === null && sess.contact_idx === null) {
    return { reply: lang[l].welcome, next_step: "idle", data: {} };
  }

  // Détection d'intention
  const intent = detectIntent(msg, l);

  // Phase de collecte des coordonnées
  if (sess.contact_idx !== null) {
    const idx = sess.contact_idx;
    if (idx < CONTACT_STEPS.length) {
      sess.contact_data[CONTACT_STEPS[idx]] = msg;
      sess.contact_idx++;
      if (sess.contact_idx < CONTACT_STEPS.length) {
        return { reply: lang[l][CONTACT_STEPS[idx]], next_step: "contact", data: sess.data };
      }
      
      // Fin du formulaire - Sauvegarde du lead
      const cd = sess.contact_data;
      const ed = sess.data;
      saveLeadToFile(cd, ed, "Devis sur étude");
      
      const summary = l === 'fr'
        ? `✅ **Votre demande a bien été enregistrée !**\n\n📋 Client: ${cd.nom}\n📞 Tél: ${cd.telephone}\n✉️ Email: ${cd.email}\n\n🏗️ Service: ${ed.service || 'Non spécifié'}\n📐 Surface: ${ed.surface || '?'} m²\n💰 Budget: ${ed.budget || 'Non spécifié'}\n\n👨‍💼 **Un ingénieur ERPAC vous contacte sous 24h.**\n📞 ${KB.contacts.phone[0]}`
        : (l === 'ar'
          ? `✅ **تم تسجيل طلبك بنجاح!**\n\n📋 العميل: ${cd.nom}\n📞 الهاتف: ${cd.telephone}\n✉️ البريد: ${cd.email}\n\n🏗️ الخدمة: ${ed.service || 'غير محدد'}\n📐 المساحة: ${ed.surface || '?'} م²\n💰 الميزانية: ${ed.budget || 'غير محدد'}\n\n👨‍💼 **سيتم التواصل معكم خلال 24 ساعة.**`
          : `✅ **Your request has been saved!**\n\n📋 Client: ${cd.nom}\n📞 Phone: ${cd.telephone}\n✉️ Email: ${cd.email}\n\n🏗️ Service: ${ed.service || 'Not specified'}\n📐 Area: ${ed.surface || '?'} m²\n💰 Budget: ${ed.budget || 'Not specified'}\n\n👨‍💼 **An ERPAC engineer will contact you within 24 hours.**`);
      
      delete sessions[sessionId];
      return { reply: summary, next_step: "idle", data: {} };
    }
  }

  // Tunnel de devis
  if (sess.step !== null) {
    const stepKey = DEVIS_STEPS[sess.step];
    if (stepKey === "service") {
      const detected = detectService(msg, l);
      sess.data[stepKey] = detected ? (l === 'fr' ? detected.name_fr : (l === 'ar' ? detected.name_ar : detected.name_en)) : msg;
    } else {
      sess.data[stepKey] = msg;
    }
    sess.step++;
    
    if (sess.step < DEVIS_STEPS.length) {
      return { reply: lang[l][DEVIS_STEPS[sess.step]], next_step: "devis", data: sess.data };
    }
    
    // Fin du devis - passer à la collecte des coordonnées
    sess.contact_idx = 0;
    sess.step = null;
    return { reply: `${lang[l].confirm}\n\n${lang[l].name}`, next_step: "contact", data: sess.data };
  }

  // Réponses directes aux intentions
  if (intent === "services") {
    return { reply: lang[l].services, next_step: "idle", data: {} };
  }
  if (intent === "projects") {
    return { reply: lang[l].projects, next_step: "idle", data: {} };
  }
  if (intent === "hours") {
    return { reply: lang[l].hours, next_step: "idle", data: {} };
  }
  if (intent === "contact") {
    return { reply: lang[l].contact, next_step: "idle", data: {} };
  }
  if (intent === "info") {
    return { reply: lang[l].info, next_step: "idle", data: {} };
  }
  if (intent === "devis") {
    sess.step = 0;
    sess.data = {};
    return { reply: lang[l].devis_start, next_step: "devis", data: {} };
  }

  // Détection automatique d'un service
  const service = detectService(msg, l);
  if (service && sess.step === null && sess.contact_idx === null) {
    const name = l === 'fr' ? service.name_fr : (l === 'ar' ? service.name_ar : service.name_en);
    return { reply: `📌 **${name}**\n\nSouhaitez-vous un devis ? (Oui/Non)`, next_step: "idle", data: { service: name } };
  }

  // Réponse Oui/Non après présentation d'un service
  if (/^(oui|نعم|yes|o|y)$/i.test(msg) && sess.data.service && !sess.step && sess.contact_idx === null) {
    sess.step = 0;
    sess.data = { service: sess.data.service };
    return { reply: lang[l][DEVIS_STEPS[0]], next_step: "devis", data: sess.data };
  }

  // Réponse par défaut
  return { reply: lang[l].fallback, next_step: "idle", data: {} };
}

// ── WHATSAPP SENDER (CORRIGÉ) ───────────────────────────────────────────────
async function sendWhatsApp(to, text) {
  if (!WA_TOKEN || !WA_PHONE_ID) {
    console.log('⚠️ WhatsApp non configuré - variables manquantes');
    return false;
  }
  
  if (!text || text.trim() === '') {
    console.log('❌ Tentative d\'envoi d\'un message vide');
    return false;
  }
  
  try {
    const response = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": `Bearer ${WA_TOKEN}`
      },
      body: JSON.stringify({ 
        messaging_product: "whatsapp", 
        to: to, 
        type: "text", 
        text: { body: text.substring(0, 4096) } // Limite WhatsApp
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ WA Error:", errorText);
      return false;
    }
    
    console.log(`✅ Message envoyé à ${to} (${text.length} caractères)`);
    return true;
  } catch (e) { 
    console.error("❌ WhatsApp send error:", e); 
    return false;
  }
}

// ── ROUTES ───────────────────────────────────────────────────────────────────

// Webhook générique (pour test)
app.post("/webhook", (req, res) => {
  const { session_id, message } = req.body;
  if (!session_id || !message) {
    return res.status(400).json({ error: "session_id and message required" });
  }
  const result = processMessage(session_id, message);
  return res.json(result);
});

// Webhook WhatsApp Business
app.get("/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  
  if (mode === "subscribe" && token === WA_VERIFY_TOKEN) {
    console.log("✅ Webhook WhatsApp vérifié");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook/whatsapp", async (req, res) => {
  // Répondre immédiatement à WhatsApp
  res.sendStatus(200);
  
  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;
    const message = messages?.[0];
    
    if (!message || message.type !== "text") {
      console.log("⚠️ Message non textuel ou absent");
      return;
    }
    
    const from = message.from;
    const text = message.text.body;
    
    console.log(`📩 Message reçu de ${from}: ${text.substring(0, 100)}`);
    
    const response = processMessage(from, text);
    
    if (response && response.reply && response.reply.trim() !== '') {
      await sendWhatsApp(from, response.reply);
    } else {
      console.log("❌ Aucune réponse générée");
      await sendWhatsApp(from, "Je n'ai pas compris. Tapez : SERVICES, DEVIS, CONTACT, PROJETS");
    }
    
  } catch (error) {
    console.error("❌ Erreur webhook:", error);
  }
});

// Route pour voir les leads sauvegardés
app.get("/leads", (req, res) => {
  if (fs.existsSync(LEADS_FILE)) {
    const leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    res.json({ count: leads.length, leads: leads });
  } else {
    res.json({ count: 0, leads: [] });
  }
});

// Route de test
app.get("/test", (req, res) => {
  const testMessage = req.query.q || "Bonjour, je veux construire une villa";
  const result = processMessage("test_user", testMessage);
  res.json({ 
    input: testMessage, 
    output: result,
    hasReply: !!(result && result.reply)
  });
});

app.get("/health", (req, res) => res.json({ status: "ok", version: "5.0-final", timestamp: new Date().toISOString() }));

// ── DÉMARRAGE ───────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 ERPAC Bot v5.0 démarré sur le port ${PORT}`);
  console.log(`🌍 Support: Français | العربية | English`);
  console.log(`📝 Leads sauvegardés dans: ${LEADS_FILE}`);
  console.log(`🔗 Webhook WhatsApp: /webhook/whatsapp`);
  console.log(`📊 Voir les leads: /leads\n`);
});
