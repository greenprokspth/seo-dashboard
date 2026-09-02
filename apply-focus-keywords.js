#!/usr/bin/env node
/**
 * apply-focus-keywords.js — เอา focus keyword จากไฟล์ CSV (export จาก WordPress/Rank Math)
 * มาใส่ทับข้อมูล Content Map ใน index.html
 *
 * เหตุผลที่ต้องมีสคริปต์นี้: Rank Math ไม่ได้ส่ง focus keyword ออกมาใน HTML ทุกหน้า
 * (หน้าที่ schema ไม่มีฟิลด์ keywords จะ crawl ไม่เจอ) — ใช้ CSV เป็นแหล่งข้อมูลหลักแทน
 *
 * ใช้:  node apply-focus-keywords.js <ไฟล์.csv> [siteId]
 *       siteId ปกติ = greenproksp (ถ้าไม่ระบุ)
 *
 * CSV ต้องมีคอลัมน์: slug, focus_keyword (และ/หรือ focus_keyword_primary)
 */
const fs = require("fs");
const path = require("path");

const CSV = process.argv[2];
const SITE = process.argv[3] || "greenproksp";
const HTML_FILE = path.join(__dirname, "index.html");
if (!CSV || !fs.existsSync(CSV)) {
  console.error("ใช้: node apply-focus-keywords.js <ไฟล์.csv> [siteId]");
  process.exit(1);
}

/* CSV parser รองรับ comma ใน quotes */
function parseCSV(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c !== "\r") cur += c;
    }
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
const lastSeg = (p) => dec(String(p || "").replace(/\/+$/, "").split("/").pop() || "");

let raw = fs.readFileSync(CSV, "utf8");
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);          // ตัด BOM
const rows = parseCSV(raw).filter((r) => r.length > 3);
const head = rows[0].map((h) => h.trim());
const iSlug = head.indexOf("slug");
const iKw = head.indexOf("focus_keyword");
const iKwP = head.indexOf("focus_keyword_primary");
if (iSlug < 0 || (iKw < 0 && iKwP < 0)) {
  console.error("CSV ต้องมีคอลัมน์ slug และ focus_keyword"); process.exit(1);
}

const bySlug = new Map();
for (const r of rows.slice(1)) {
  const slug = dec((r[iSlug] || "").trim()).replace(/\/+$/, "");
  const kw = ((iKwP >= 0 ? r[iKwP] : "") || "").trim() || ((iKw >= 0 ? r[iKw] : "") || "").trim();
  if (slug && kw) bySlug.set(slug, kw);
}
console.log("อ่าน CSV:", bySlug.size, "แถวที่มี slug + focus keyword");

const html = fs.readFileSync(HTML_FILE, "utf8");
const m = html.match(/(<script type="application\/json" id="content-map-data">)([\s\S]*?)(<\/script>)/);
if (!m) { console.error("ไม่พบ content-map-data ใน index.html"); process.exit(1); }
const cm = JSON.parse(m[2]);

let filled = 0, changed = 0, same = 0;
const miss = [];
for (const n of cm.nodes) {
  if (n.site !== SITE || n.t === "hub" || n.t === "plan") continue;
  let kw = bySlug.get(lastSeg(n.path));
  if (!kw && (n.path === "/" || !n.path)) kw = bySlug.get(lastSeg("หน้าแรก")) || bySlug.get("หน้าแรก");
  if (!kw) { miss.push(n.path); continue; }
  if (!n.kw) { n.kw = kw; filled++; }
  else if (n.kw !== kw) { n.kw = kw; changed++; }
  else same++;
}
cm.kwSource = path.basename(CSV) + " (" + new Date().toISOString().slice(0, 10) + ")";

fs.writeFileSync(HTML_FILE, html.replace(m[0], m[1] + "\n" + JSON.stringify(cm).replace(/<\//g, "<\\/") + "\n" + m[3]));
console.log("เติมที่ยังว่าง:", filled, "| แก้ค่าที่ต่างจาก CSV:", changed, "| ตรงกันอยู่แล้ว:", same);
console.log("ไม่มีใน CSV:", miss.length, "หน้า", miss.length ? "→ " + miss.slice(0, 10).join(", ") : "");
console.log("✓ เขียนลง index.html แล้ว");
