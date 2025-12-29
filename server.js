// 1️⃣ Imports
const express = require("express");
const axios = require("axios");

// ===== DATABASE INIT (CRM) =====
const sqlite3 = require("sqlite3").verbose();

// crm.db file isi Backend folder me ban jayegi
const db = new sqlite3.Database("./crm.db", (err) => {
  if (err) {
    console.error("❌ DB Connection Error:", err.message);
  } else {
    console.log("✅ Connected to CRM database");
  }
});

// Table create (first time only)
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});


// 2️⃣ App init
const app = express();
app.use(express.json());

// 3️⃣ Root test route
app.get("/", (req, res) => {
  res.send("Server is running");
});

// 4️⃣ Webhook verification (Meta ke liye)
// ===== RULES =====
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

// ===== RULE MATCHER =====
function matchRule(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const rule of RULES) {
    for (const keyword of rule.keywords) {
      if (lower.includes(keyword)) {
        return rule;
      }
    }
  }
  return null;
}
async function aiReply(userText) {
  return "📘 Syllabus ko step-by-step plan ke saath complete karaya jata hai, regular tests aur doubt sessions ke through, taaki concept strong ho aur exam-oriented preparation ho.";
}

function sendFeeFollowUps() {
  const query = `
    SELECT id, phone, message, created_at 
    FROM messages
    WHERE interest_type = 'fees'
      AND followup_sent = 0
      AND datetime(created_at) <= datetime('now', '-24 hours')
  `;

  db.all(query, [], async (err, rows) => {
    if (err) {
      console.error("Follow-up query error:", err.message);
      return;
    }

    for (const row of rows) {
      try {
        await axios.post(
          `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: row.phone,
            text: {
              body: "👋 Hi! Kal aapne fees ke baare me poocha tha. Agar koi doubt ho to bataiye 😊",
            },
          },
          {
            headers: {
              Authorization: `Bearer ${ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );

        db.run(
          "UPDATE messages SET followup_sent = 1 WHERE id = ?",
          [row.id]
        );

        console.log("📤 Follow-up sent to:", row.phone);
      } catch (e) {
        console.error("Follow-up send error:", e.response?.data || e.message);
      }
    }
  });
}


// 5️⃣ Incoming message + Auto-reply
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (messages && messages.length > 0) {
      const from = messages[0].from;
      const text = messages[0].text?.body;
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
const interestType = detectInterest(text);
console.log("🎯 Interest Type:", interestType);


      console.log("📩 Message from:", from);
      console.log("💬 Text:", text);
      let replyText = "";
      const rule = matchRule(text);

console.log("RULE MATCHED:", rule ? rule.keywords : "NO RULE → AI");
// ===== SAVE MESSAGE TO CRM =====
db.run(
  "INSERT INTO messages (phone, message, interest_type) VALUES (?, ?, ?)",
  [from, text, interestType],
  (err) => {
    if (err) {
      console.error("❌ DB Save Error:", err.message);
    } else {
      console.log("✅ Saved to CRM:", from, "|", interestType);
    }
  }
);



if (rule) {
  replyText = rule.reply;
} else {
  replyText = await aiReply(text);
}



      // 🔐 WhatsApp API details (TERE WALE)
      const PHONE_NUMBER_ID = "867795156424720";
      const ACCESS_TOKEN = "EAAUoAa5iznIBQcQWQ2FlnwkNkcfKrUSIwZB1Yz9yEhsYVRNS83YUW3rESQglSOLLsqWujzTEGEPGZBnjIcTG1ZBTzQRhX8cGdeAx0mzQjlWr5Fk4RUPAgdE04ssMJZBmaS1xQcGmw943YRcoKNk3gBv0tgkohdQ44XpkUrJ1Md54xGGU3ZBHTsv9v1F1B3ukSCU9tj2cfSDOLSFcTg68IhUniz53o5PI0oAop2z3Fp8eukZAprgCB9QMffJcgM2tay3g4txLyuoZAOyducREt5m";

      await axios.post(
        `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: {
            body: replyText,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.error(
      "❌ Error:",
      error.response?.data || error.message
    );
    res.sendStatus(500);
  }
});

// 6️⃣ Server start
setInterval(sendFeeFollowUps, 60 * 60 * 1000); // every 1 hour
app.listen(3000, () => {
  console.log("🚀 Server started on port 3000");
});
