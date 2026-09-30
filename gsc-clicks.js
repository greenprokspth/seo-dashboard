#!/usr/bin/env node
/**
 * gsc-clicks.js — ดึง "คลิกจริง" จาก Google Search Console ตรง ๆ (ไม่ผ่าน Ahrefs)
 *
 * ทำอะไร: ใช้ service account อ่านคลิกรายวันของทั้ง 3 เว็บ แล้วรวม 30 วันล่าสุด
 *          (พร้อม % เทียบ 30 วันก่อนหน้า)
 *          นับถอยหลังจากวันสุดท้ายที่ Google มีข้อมูล (ข้อมูล final ช้ากว่าจริง ~2-3 วัน)
 *
 * ใช้:  node gsc-clicks.js            (แสดงผลอย่างเดียว)
 *       node gsc-clicks.js --write    (เขียนการ์ด "คลิกจริง (GSC) ..." ลงสัปดาห์ล่าสุดใน index.html)
 *       node gsc-clicks.js --sites    (ดูว่า service account เข้าถึง property ไหนได้บ้าง)
 *
 * ไฟล์ key: ใส่ path ใน env GSC_KEY หรือวางไฟล์ .json ของ service account ไว้โฟลเดอร์แม่ของ repo
 *          ⚠️ ห้ามวาง key ไว้ในโฟลเดอร์ repo — repo เป็น public
 * ไม่ต้องติดตั้ง package เพิ่ม (ใช้ crypto + fetch ของ Node 18+)
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HTML_FILE = path.join(__dirname, "index.html");
const WINDOW = 30;
const SITES = [
  { id: "greenproksp", domain: "greenproksp.com" },
  { id: "perfectblending", domain: "perfectblending.com" },
  { id: "kspasiafin", domain: "kspasiafin.com" },
];
const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function findKeyFile() {
  if (process.env.GSC_KEY) return process.env.GSC_KEY;
  const dir = path.join(__dirname, "..");
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const k = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (k.type === "service_account" && k.private_key) return path.join(dir, f);
    } catch (e) { /* ไม่ใช่ไฟล์ key */ }
  }
  throw new Error("ไม่เจอไฟล์ key ของ service account ในโฟลเดอร์แม่ของ repo (หรือตั้ง env GSC_KEY)");
}

const b64url = (s) => Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

async function getToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: key.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const sig = crypto.createSign("RSA-SHA256").update(head + "." + claim).sign(key.private_key, "base64")
    .replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: head + "." + claim + "." + sig }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("ขอ token ไม่ได้: " + JSON.stringify(j));
  return j.access_token;
}

async function api(token, url, body) {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json();
  if (!res.ok) throw new Error("HTTP " + res.status + ": " + JSON.stringify(j.error || j).slice(0, 300));
  return j;
}

/** เลือก property ของเว็บ: ชอบ domain property (sc-domain:) ก่อน เพราะรวมทุก subdomain/protocol */
function pickProperty(list, domain) {
  const ok = list.filter((s) => s.permissionLevel !== "siteUnverifiedUser");
  return (ok.find((s) => s.siteUrl === "sc-domain:" + domain) ||
    ok.find((s) => s.siteUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") === domain) || {}).siteUrl;
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
function thRange(a, b) {
  const [ya, ma, da] = a.split("-").map(Number), [yb, mb, db] = b.split("-").map(Number);
  return (ya === yb && ma === mb) ? `${da}–${db} ${TH_MONTH[mb - 1]}` : `${da} ${TH_MONTH[ma - 1]}–${db} ${TH_MONTH[mb - 1]}`;
}

async function main() {
  const key = JSON.parse(fs.readFileSync(findKeyFile(), "utf8"));
  const token = await getToken(key);
  const list = (await api(token, "https://www.googleapis.com/webmasters/v3/sites")).siteEntry || [];

  if (process.argv.includes("--sites")) {
    console.log("service account:", key.client_email);
    list.forEach((s) => console.log(" ", s.siteUrl, "·", s.permissionLevel));
    return;
  }

  const today = iso(new Date());
  const out = {};
  for (const s of SITES) {
    const prop = pickProperty(list, s.domain);
    if (!prop) { console.log(`[${s.id}] ❌ ไม่มีสิทธิ์เข้า GSC ของ ${s.domain} — เพิ่มอีเมล ${key.client_email} ใน Users and permissions`); continue; }
    const r = await api(token, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(prop)}/searchAnalytics/query`,
      { startDate: addDays(today, -75), endDate: today, dimensions: ["date"], type: "web", rowLimit: 1000 });
    const byDate = Object.fromEntries((r.rows || []).map((x) => [x.keys[0], x.clicks]));
    const dates = Object.keys(byDate).sort();
    if (!dates.length) { console.log(`[${s.id}] ⚠️ ${prop} ไม่มีข้อมูล`); continue; }
    const end = dates[dates.length - 1], start = addDays(end, -(WINDOW - 1));
    const total = (a, z) => { let n = 0; for (let d = a; d <= z; d = addDays(d, 1)) n += byDate[d] || 0; return n; };
    const clicks = total(start, end);
    /* % บนการ์ด = เทียบกับ 30 วันก่อนหน้า (ช่วงยาวเท่ากัน ต่อกันพอดี) — ถ้าข้อมูลย้อนไม่ถึงก็ไม่แสดง % */
    const prevStart = addDays(start, -WINDOW), prevEnd = addDays(start, -1);
    const prev = dates[0] <= prevStart ? total(prevStart, prevEnd) : null;
    out[s.id] = { property: prop, start, end, clicks, prev, label: `คลิกจริง (GSC) ${thRange(start, end)}` };
    console.log(`[${s.id}] ${prop} · ${start} → ${end} · ${clicks.toLocaleString()} คลิก · 30 วันก่อนหน้า (${prevStart} → ${prevEnd}) ${prev == null ? "ไม่มีข้อมูล" : prev.toLocaleString()} · ป้าย "${out[s.id].label}"`);
  }

  if (process.argv.includes("--write")) {
    const RE = /(<script id="report-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
    let h = fs.readFileSync(HTML_FILE, "utf8");
    const d = JSON.parse(h.match(RE)[2]);
    for (const site of d.sites) {
      const g = out[site.id]; if (!g) continue;
      const w = site.weeks[0], i = w.metrics.findIndex((m) => String(m.label).startsWith("คลิกจริง (GSC)"));
      const card = { label: g.label, value: g.clicks, fmt: "int" };
      if (g.prev != null) card.prev = g.prev;
      if (i >= 0) w.metrics[i] = card; else {
        const j = w.metrics.findIndex((m) => m.label === "คำติด Top 3");
        w.metrics.splice(j >= 0 ? j + 1 : w.metrics.length, 0, card);
      }
      console.log(`  เขียนการ์ด ${site.id} (สัปดาห์ ${w.id})`);
    }
    h = h.replace(RE, (m, a, b, c) => a + JSON.stringify(d) + c);
    fs.writeFileSync(HTML_FILE, h);
    console.log("✓ เขียน index.html แล้ว");
  }
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
