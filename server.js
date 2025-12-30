// =====================
// 1️⃣ Imports
// =====================
const express = require("express");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();

// =====================
// 2️⃣ App Init
// =====================
const app = express();
app.use(express.json());

// =====================
// 3️⃣ ENV Vars (NO HARDCODE)
// =====================
const ACCESS_TOKEN = (process.env.ACCESS_TOKEN || "").trim();
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// =====================
// 4️⃣ Database Init (SINGLE SOURCE OF TRUTH)
// =====================
const db = new sqlite3.Database("./crm.db", (err) => {
  if (err) {
    console.error("❌ DB Connection Error:", err.message);
  } else {
    console.log("✅ Connected to CRM database");
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      message TEXT,
      interest_type TEXT,
      followup_sent INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// =====================
// 5️⃣ Root Test Route
// =====================
app.get("/", (req, res) => {
  res.send("Server is running");
});

// =====================
// 6️⃣ Webhook Verification (GET)
// =====================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified by Meta");
    return res.status(200).send(challenge);
  }
  console.log("❌ Webhook verification failed");
  return res.sendStatus(403);
});

// =====================
// 7️⃣ Rules + Helpers
// =====================
const RULES = [
  {
    keywords: ["fees", "fee", "charges", "price"],
    reply: "💰 Fees: ₹25,000 (installment available).",
  },
  {
    keywords: ["batch", "timing", "time", "schedule"],
    reply: "🕒 Batch Timings: Morning 7–9 AM | Evening 5–7 PM.",
  },
  {
    keywords: ["location", "address", "where"],
    reply: "📍 Location: XYZ Coaching, Main Road.",
  },
  {
    keywords: ["admission", "join", "enroll"],
    reply: "📝 Admission open! Share your name & class.",
  },
];

function matchRule(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const rule of RULES) {
    for (const k of rule.keywords) {
      if (lower.includes(k)) return rule;
    }
  }
  return null;
}

function detectInterest(text) {
  if (!text) return "other";
  const msg = text.toLowerCase();

  if (msg.includes("fee") || msg.includes("fees") || msg.includes("price"))
    return "fees";
  if (msg.includes("admission") || msg.includes("join") || msg.includes("enroll"))
    return "admission";
  if (msg.includes("syllabus") || msg.includes("course"))
    return "syllabus";
  if (msg.includes("batch") || msg.includes("timing") || msg.includes("time"))
    return "batch";

  return "other";
}

// Simple AI fallback (placeholder)
async function aiReply(_) {
  return "📘 Syllabus step-by-step cover hota hai with regular tests aur doubt sessions, taaki preparation exam-oriented rahe.";
}

// =====================
// 8️⃣ Incoming Messages (POST)
// =====================

console.log("TOKEN LENGTH:", ACCESS_TOKEN.length);
console.log("TOKEN START:", ACCESS_TOKEN.slice(0, 10));
console.log("TOKEN END:", ACCESS_TOKEN.slice(-10));


app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      return res.sendStatus(200);
    }

    const from = messages[0].from;
    const text = messages[0].text?.body || "";

    console.log("📩 Message from:", from);
    console.log("💬 Text:", text);

    const interestType = detectInterest(text);
    console.log("🎯 Interest Type:", interestType);

    // Save to CRM
    db.run(
      "INSERT INTO messages (phone, message, interest_type) VALUES (?, ?, ?)",
      [from, text, interestType],
      (err) => {
        if (err) console.error("❌ DB Save Error:", err.message);
        else console.log("✅ Saved to CRM:", from, "|", interestType);
      }
    );

    // Reply logic
    const rule = matchRule(text);
    console.log("RULE MATCHED:", rule ? rule.keywords : "NO RULE → AI");
    const replyText = rule ? rule.reply : await aiReply(text);

    // Send WhatsApp reply
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: replyText },
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res.sendStatus(200);
  } catch (error) {
    console.error("❌ Error:", error.response?.data || error.message);
    return res.sendStatus(500);
  }
});

// =====================
// 9️⃣ Server Start
// =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server started on port", PORT);
});
