const express = require("express");
const path = require("path");
const crypto = require("crypto");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const WEBAPP_URL = process.env.WEBAPP_URL || "http://localhost:${PORT}";

// Demo memory storage. Add a database before public launch.
const players = new Map();
const paymentOrders = new Map();

function getPlayer(id, name = "City Mayor") {
id = String(id);

if (!players.has(id)) {
players.set(id, {
id,
name,
coins: 100,
dailyStreak: 0,
lastDailyDate: "",
visitors: 0,
buildings: [
{
id: "starter-farm",
type: "farm",
tile: 55,
level: 1,
free: true
},
{
id: "starter-house",
type: "starter_house",
tile: 44,
level: 1,
free: true
}
]
});
}

return players.get(id);
}

function timingSafeEqual(a, b) {
const x = Buffer.from(a);
const y = Buffer.from(b);

return x.length === y.length &&
crypto.timingSafeEqual(x, y);
}

// Verify Telegram Mini App initData on the server.
function verifyTelegramData(initData) {
if (!BOT_TOKEN || !initData) return null;

const params = new URLSearchParams(initData);
const receivedHash = params.get("hash");

if (!receivedHash) return null;

params.delete("hash");

const dataCheckString = [...params.entries()]
.sort(([a], [b]) => a.localeCompare(b))
.map(([key, value]) => "${key}=${value}")
.join("\n");

const secretKey = crypto
.createHmac("sha256", "WebAppData")
.update(BOT_TOKEN)
.digest();

const calculatedHash = crypto
.createHmac("sha256", secretKey)
.update(dataCheckString)
.digest("hex");

if (!timingSafeEqual(calculatedHash, receivedHash)) {
return null;
}

const authDate = Number(params.get("auth_date") || 0);
const now = Math.floor(Date.now() / 1000);

if (
!authDate ||
now - authDate > 86400 ||
authDate > now + 60
) {
return null;
}

try {
const user = JSON.parse(params.get("user") || "{}");
return user.id ? user : null;
} catch {
return null;
}
}

function authenticate(req, res, next) {
const initData =
req.get("X-Telegram-Init-Data") || "";

// Local testing only. This is disabled in production.
if (
!BOT_TOKEN &&
process.env.NODE_ENV !== "production"
) {
req.player = getPlayer(
"local-demo-player",
"Demo Mayor"
);
return next();
}

const user = verifyTelegramData(initData);

if (!user) {
return res.status(401).json({
error:
"Telegram authentication failed. Open the game through your bot."
});
}

const name = [
user.first_name,
user.last_name
].filter(Boolean).join(" ");

req.player = getPlayer(user.id, name);
next();
}

app.get("/api/health", (req, res) => {
res.json({
ok: true,
game: "SkyCity",
mode: BOT_TOKEN ? "telegram" : "local-demo"
});
});

app.get("/api/me", authenticate, (req, res) => {
res.json({ player: req.player });
});

// Create a pending payment request.
// Coins are NOT credited by this endpoint.
app.post(
"/api/payment/request",
authenticate,
(req, res) => {
const grams = Number(req.body?.grams);

if (
  !Number.isFinite(grams) ||
  grams < 0.1 ||
  grams > 1000
) {
  return res.status(400).json({
    error: "Enter an amount from 0.1 to 1000 gram."
  });
}

const order = {
  id: crypto.randomUUID(),
  playerId: req.player.id,
  grams,
  coinsReference: Math.round(grams * 1000),
  status: "pending_verification",
  createdAt: Date.now()
};

paymentOrders.set(order.id, order);

res.json({
  ok: true,
  order,
  message:
    "Payment awaits verification. No coins have been credited."
});

}
);

app.get(
"/api/payment/:id",
authenticate,
(req, res) => {
const order = paymentOrders.get(req.params.id);

if (
  !order ||
  order.playerId !== req.player.id
) {
  return res.status(404).json({
    error: "Payment request not found."
  });
}

res.json({ order });

}
);

// Telegram bot integration.
if (BOT_TOKEN) {
const bot = new TelegramBot(BOT_TOKEN, {
polling: true
});

bot.onText(/^/start(?:\s+.*)?$/, async (msg) => {
await bot.sendMessage(
msg.chat.id,
"Welcome to SkyCity! Build your city, welcome visitors, and expand your districts.",
{
reply_markup: {
inline_keyboard: [[
{
text: "🏙️ Open SkyCity",
web_app: { url: WEBAPP_URL }
}
]]
}
}
);
});

bot.on("polling_error", (err) => {
console.error("Telegram error:", err.message);
});
}

app.get("*", (req, res) => {
res.sendFile(
path.join(__dirname, "public", "index.html")
);
});

app.listen(PORT, () => {
console.log("SkyCity running on port ${PORT}");
});