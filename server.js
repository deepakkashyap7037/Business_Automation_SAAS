// =====================
// 1️⃣ Imports + ENV
// =====================
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();

// =====================
// 2️⃣ App Init
// =====================
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  next();
});

// =====================
// 3️⃣ ENV Vars (SINGLE SOURCE)
// =====================
const ACCESS_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// =====================
// 4️⃣ Database Init
// =====================
const db = new sqlite3.Database("./crm.db", (err) => {
  if (err) console.error("❌ DB Error:", err.message);
  else console.log("✅ Connected to CRM database");
});

// =====================
// 5️⃣ Tables + Migrations
// =====================
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      phone TEXT,
      message TEXT,
      interest_type TEXT,
      followup_sent INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT,
      phone TEXT,
      admission_date TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// =====================
// 6️⃣ Root
// =====================
app.get("/", (req, res) => {
  res.send("Server is running");
});

// =====================
// 7️⃣ Webhook Verification
// =====================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// =====================
// 8️⃣ Rules + Helpers
// =====================
const RULES = [
  { keywords: ["fees", "fee", "price"], reply: "💰 Fees: ₹25,000 (installments available)." },
  { keywords: ["batch", "timing"], reply: "🕒 Batch Timings: Morning 7–9 AM | Evening 5–7 PM." },
  { keywords: ["admission", "join"], reply: "📝 Admission open. Please share your details." },
];

function matchRule(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  return RULES.find((r) => r.keywords.some((k) => t.includes(k))) || null;
}

function detectInterest(text) {
  if (!text) return "other";
  const t = text.toLowerCase();
  if (t.includes("fee")) return "fees";
  if (t.includes("admission")) return "admission";
  if (t.includes("batch")) return "batch";
  return "other";
}

async function aiReply() {
  return "📘 Syllabus step-by-step cover hota hai with tests & doubt sessions.";
}

// =====================
// 9️⃣ Students APIs
// =====================
app.post("/api/students", (req, res) => {
  const { user_id, name, phone, admission_date, notes } = req.body;
  if (!user_id || !name || !phone)
    return res.status(400).json({ error: "Missing fields" });

  db.run(
    `INSERT INTO students (user_id, name, phone, admission_date, notes)
     VALUES (?, ?, ?, ?, ?)`,
    [user_id, name, phone, admission_date || null, notes || null],
    function (err) {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json({ success: true });
    }
  );
});

app.get("/api/students/:userId", (req, res) => {
  db.all(
    `SELECT * FROM students WHERE user_id = ? ORDER BY created_at DESC`,
    [req.params.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json(rows);
    }
  );
});

// =====================
// 🔟 Dashboard Stats
// =====================
app.get("/api/dashboard/:userId", (req, res) => {
  const uid = req.params.userId;
  const stats = {};

  db.get(`SELECT COUNT(*) c FROM students WHERE user_id=?`, [uid], (_, r1) => {
    stats.total_students = r1?.c || 0;

    db.get(`SELECT COUNT(*) c FROM messages WHERE user_id=?`, [uid], (_, r2) => {
      stats.total_leads = r2?.c || 0;

      db.get(
        `SELECT COUNT(*) c FROM messages WHERE user_id=? AND interest_type='fees'`,
        [uid],
        (_, r3) => {
          stats.fees_leads = r3?.c || 0;
          res.json(stats);
        }
      );
    });
  });
});

// =====================
// 1️⃣1️⃣ Leads API
// =====================
app.get("/api/leads/:userId", (req, res) => {
  db.all(
    `SELECT phone, message, interest_type, created_at
     FROM messages WHERE user_id=? ORDER BY created_at DESC`,
    [req.params.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json(rows);
    }
  );
});

// =====================
// 1️⃣2️⃣ WhatsApp Webhook (POST)
// =====================
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body || "";
    const interest = detectInterest(text);
    const userId = 1; // MVP mapping

    db.run(
      `INSERT INTO messages (user_id, phone, message, interest_type)
       VALUES (?, ?, ?, ?)`,
      [userId, from, text, interest]
    );

    const rule = matchRule(text);
    const reply = rule ? rule.reply : await aiReply();

    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply },
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.sendStatus(200);
  } catch (e) {
    console.error("❌ Webhook Error:", e.response?.data || e.message);
    res.sendStatus(500);
  }
});

// =====================
// 1️⃣3️⃣ Server Start
// =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
