#!/usr/bin/env node
/**
 * build-content-map.js — สร้าง/อัปเดตข้อมูล Content Map ให้ตรงกับเว็บจริง
 *
 * ทำอะไร:
 *   1. ดึง URL ทั้งหมดจาก sitemap ของทั้ง 3 เว็บ (หน้า noindex ไม่อยู่ใน sitemap อยู่แล้ว)
 *   2. crawl ทุกหน้า เก็บ: focus keyword (Rank Math), path, วันที่อัปเดต, internal link จริง
 *   3. เก็บหมวดหมู่ (cat) ของหน้าเดิมไว้ — หน้าใหม่จัดหมวดจาก path/slug
 *   4. เขียนผลลัพธ์กลับเข้า <script id="content-map-data"> ใน index.html
 *
 * ใช้:  node build-content-map.js            (อัปเดต index.html เลย)
 *       node build-content-map.js --dry      (ดูผลอย่างเดียว ไม่เขียนไฟล์)
 */
const fs = require("fs");
const path = require("path");

const SITES = [
  { id: "greenproksp", domain: "www.greenproksp.com" },
  { id: "perfectblending", domain: "www.perfectblending.com" },
  { id: "kspasiafin", domain: "www.kspasiafin.com" },
];
const CONCURRENCY = 4;   // ลดลงเพื่อไม่ให้เซิร์ฟเวอร์ตอบ 503
const HTML_FILE = path.join(__dirname, "index.html");
const DRY = process.argv.includes("--dry");

const norm = (u) =>
  String(u).replace(/^http:/, "https:").replace(/#.*$/, "").replace(/\?.*$/, "").replace(/\/+$/, "") + "/";
const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** ดึงหน้าเว็บ พร้อม retry เมื่อเจอ 429/503 (เซิร์ฟเวอร์กันยิงถี่) */
async function get(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "GreenproContentMap/1.0" }, redirect: "follow" });
      if (res.ok) return await res.text();
      if ((res.status === 429 || res.status >= 500) && i < tries) { await sleep(1500 * i); continue; }
      throw new Error("HTTP " + res.status);
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(1500 * i);
    }
  }
}

/* ---------- 1. sitemap ---------- */
async function sitemapUrls(site) {
  const idx = await get(`https://${site.domain}/sitemap_index.xml`);
  const subs = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => !/category/i.test(u));
  const out = new Map();
  for (const sm of subs) {
    const xml = await get(sm);
    const blocks = xml.split("<url>").slice(1);
    for (const b of blocks) {
      const loc = (b.match(/<loc>([^<]+)<\/loc>/) || [])[1];
      if (!loc) continue;
      const mod = (b.match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1] || "";
      out.set(norm(loc), mod.slice(0, 10));
    }
  }
  return out;
}

/* ---------- 2. crawl หน้าเดียว ---------- */
function extractFocusKw(html) {
  // 1) schema JSON-LD ของ Rank Math (BlogPosting/Article) -> "keywords":"..."
  const m = html.match(/"keywords"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m) {
    try { return JSON.parse('"' + m[1] + '"').trim(); } catch (e) { return m[1].trim(); }
  }
  // 2) schema แบบ array -> "keywords":["a","b"]
  const arr = html.match(/"keywords"\s*:\s*\[([^\]]*)\]/);
  if (arr) {
    try { return JSON.parse('[' + arr[1] + ']').join(', ').trim(); } catch (e) {}
  }
  // 3) meta keywords (บางธีม/ปลั๊กอินยังส่งออก)
  const meta = html.match(/<meta[^>]+name=["']keywords["'][^>]*content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']keywords["']/i);
  if (meta) return meta[1].trim();
  // 4) ไม่มีในหน้า — Rank Math ไม่ได้ส่ง focus keyword ออก HTML ทุกหน้า
  //    (หน้าที่ schema เป็น VideoObject/Service/WebPage จะไม่มี keywords ติดมา)
  return "";
}
/**
 * ดึงลิงก์ภายในทั้งหมดของหน้า (ยังไม่กรองเมนู/footer — กรองทีหลังด้วยความถี่)
 * เว็บใช้ Elementor ไม่มี <header>/<footer>/<main> มาตรฐาน จึงแยกด้วยโครงสร้างไม่ได้
 * วิธีที่แม่นกว่า: ลิงก์ที่โผล่ซ้ำแทบทุกหน้า = เมนู/footer/sidebar (boilerplate) → ตัดออก
 */
function extractInternalLinks(html, domain) {
  const set = new Set();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["']/gi)) {
    let href = m[1];
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    if (href.startsWith("/")) href = `https://${domain}${href}`;
    if (!href.includes(domain)) continue;             // เอาเฉพาะลิงก์ภายในเว็บเดียวกัน
    if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4)$/i.test(href)) continue;
    if (/\/(wp-content|wp-json|feed|author|tag|category|page)\//i.test(href)) continue;
    set.add(norm(href));
  }
  return [...set];
}

/** ลิงก์ที่ปรากฏในหน้ามากกว่า BOILERPLATE_RATIO ของหน้าทั้งหมด = เมนู/footer */
const BOILERPLATE_RATIO = 0.6;
function findBoilerplate(results) {
  const freq = new Map();
  let pages = 0;
  for (const r of results.values()) {
    if (!r.ok) continue;
    pages++;
    for (const l of r.links) freq.set(l, (freq.get(l) || 0) + 1);
  }
  const cut = Math.max(3, Math.ceil(pages * BOILERPLATE_RATIO));
  const set = new Set();
  freq.forEach((c, l) => { if (c >= cut) set.add(l); });
  return { set, pages, cut };
}
async function crawlPage(url, domain) {
  try {
    const html = await get(url);
    return { ok: true, kw: extractFocusKw(html), links: extractInternalLinks(html, domain) };
  } catch (e) {
    return { ok: false, kw: "", links: [], err: e.message };
  }
}

/* ---------- 3. จัดหมวดหมู่หน้าใหม่ ---------- */
function classify(url, siteId) {
  const p = url.replace(/https?:\/\/[^\/]+/, "");
  const slug = dec(p.split("/").filter(Boolean).pop() || "หน้าแรก");
  const label = slug.replace(/-/g, " ");
  if (siteId === "greenproksp") {
    if (p.startsWith("/services/")) return { t: "svc", cat: "gp_service", label };
    if (/audit|ตรวจสอบบัญชี|สอบบัญชี/i.test(slug)) return { t: "blog", cat: "gp_audit", label };
    if (p.startsWith("/blog/accounting/")) return { t: "blog", cat: "gp_acc", label };
    if (p.startsWith("/blog/tax/")) return { t: "blog", cat: "gp_tax", label };
    if (p.startsWith("/blog/business/"))
      return /license|permit|อนุญาต/i.test(slug) ? { t: "blog", cat: "gp_license", label } : { t: "blog", cat: "gp_register", label };
    return { t: "blog", cat: "gp_other", label };
  }
  if (siteId === "perfectblending") {
    if (/รับวาง|ให้บริการ/.test(slug)) return { t: "svc", cat: "pb_impl", label };
    if (/odoo/i.test(slug)) return { t: "blog", cat: "pb_overview", label };
    if (/^ระบบ/.test(slug)) return { t: "blog", cat: "pb_module", label };
    return { t: "blog", cat: "pb_other", label };
  }
  if (/rpa|อัตโนมัติ|หุ่นยนต์|บอท/i.test(slug)) return { t: "blog", cat: "ka_rpa", label };
  if (/ocr|เอกสาร|ข้อมูล|ฟอร์ม|สแกน/i.test(slug)) return { t: "blog", cat: "ka_ocr", label };
  if (/บัญชี|การเงิน|หนี้|ภาษี|เจ้าหนี้|ลูกหนี้/.test(slug)) return { t: "blog", cat: "ka_fin", label };
  if (/ai|cloud|big.?data|api|ดิจิทัล|deep|machine/i.test(slug)) return { t: "blog", cat: "ka_ai", label };
  return { t: "blog", cat: "ka_other", label };
}

/* ---------- main ---------- */
(async () => {
  const html = fs.readFileSync(HTML_FILE, "utf8");
  const cmMatch = html.match(/(<script type="application\/json" id="content-map-data">)([\s\S]*?)(<\/script>)/);
  if (!cmMatch) { console.error("ไม่พบ content-map-data ใน index.html"); process.exit(1); }
  const old = JSON.parse(cmMatch[2]);
  const oldByUrl = new Map();
  old.nodes.filter((n) => n.url).forEach((n) => oldByUrl.set(norm(n.url), n));

  const nodes = [], allLinks = [];
  const urlToId = new Map();
  const stats = { crawled: 0, failed: 0, kwFound: 0, boilerplate: 0 };

  for (const site of SITES) {
    process.stderr.write(`\n[${site.id}] ดึง sitemap...`);
    const urls = await sitemapUrls(site);
    process.stderr.write(` ${urls.size} หน้า\n`);

    const list = [...urls.keys()];
    const results = new Map();
    let i = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (i < list.length) {
          const u = list[i++];
          const r = await crawlPage(u, site.domain);
          results.set(u, r);
          stats.crawled++;
          if (!r.ok) stats.failed++;
          if (r.kw) stats.kwFound++;
          if (stats.crawled % 25 === 0) process.stderr.write(`  crawl ${stats.crawled} หน้า...\n`);
        }
      })
    );

    for (const u of list) {
      const oldNode = oldByUrl.get(u);
      const c = oldNode ? { t: oldNode.t, cat: oldNode.cat, label: oldNode.label } : classify(u, site.id);
      const slug = dec(u.replace(/\/$/, "").split("/").pop() || "home");
      const id = oldNode ? oldNode.id : (c.t === "svc" ? "svc:" : "b:") + slug;
      const r = results.get(u) || { kw: "", links: [] };
      const p = u.replace(/https?:\/\/[^\/]+/, "");
      const n = {
        id, t: c.t, label: c.label, cat: c.cat, site: site.id,
        url: u, path: p, kw: r.kw || "", mod: urls.get(u) || "", st: 2, deg: 0,
      };
      if (oldNode && oldNode.plan) n.plan = oldNode.plan;
      if (oldNode && oldNode.obs) n.obs = oldNode.obs;
      nodes.push(n);
      urlToId.set(u, id);
    }
    /* ตัดลิงก์เมนู/footer ออกก่อนนับ */
    const bp = findBoilerplate(results);
    process.stderr.write(`  ตัดลิงก์เมนู/footer: ${bp.set.size} URL (โผล่ตั้งแต่ ${bp.cut}/${bp.pages} หน้าขึ้นไป)\n`);
    stats.boilerplate += bp.set.size;
    for (const u of list) {
      const r = results.get(u);
      if (!r || !r.ok) continue;
      const from = urlToId.get(u);
      for (const target of r.links) {
        if (bp.set.has(target)) continue;             // เมนู/footer — ไม่นับ
        const to = urlToId.get(target);
        if (to && to !== from) allLinks.push({ s: from, t: to, k: "real" });
      }
    }
  }

  /* hubs + struct links (โครงคลัสเตอร์ — ยังคงไว้ตามเดิม) */
  const oldHubs = new Map();
  old.nodes.filter((n) => n.t === "hub").forEach((h) => oldHubs.set(h.site + ":" + h.cat, h));
  const hubKeys = new Set(nodes.map((n) => n.site + ":" + n.cat));
  const hubs = [];
  hubKeys.forEach((k) => {
    const h = oldHubs.get(k);
    if (h) hubs.push(h);
    else { const [site, cat] = k.split(":"); hubs.push({ id: "hub:" + site + ":" + cat, t: "hub", label: "● " + cat, cat, site, url: "", st: 2, deg: 0 }); }
  });
  const ids = new Set([...hubs, ...nodes].map((n) => n.id));
  const structLinks = nodes.map((n) => ({ s: n.id, t: "hub:" + n.site + ":" + n.cat, k: "struct" })).filter((l) => ids.has(l.t));

  /* ลิงก์จริง: ตัดซ้ำ + นับ deg (ลิงก์เข้า) */
  const seen = new Set(), realLinks = [];
  for (const l of allLinks) {
    const key = l.s + ">" + l.t;
    if (seen.has(key)) continue;
    seen.add(key); realLinks.push(l);
  }
  const inDeg = {};
  realLinks.forEach((l) => { inDeg[l.t] = (inDeg[l.t] || 0) + 1; });
  nodes.forEach((n) => { n.deg = inDeg[n.id] || 0; });

  /* แผน internal link เดิม: เก็บเฉพาะที่สองปลายยังอยู่จริง */
  const planLinks = old.links.filter((l) => l.k && l.k.startsWith("plan") && ids.has(l.s) && ids.has(l.t));

  const out = {
    nodes: [...hubs, ...nodes],
    links: [...structLinks, ...realLinks, ...planLinks],
    stats: {
      total: nodes.length,
      blogs: nodes.filter((n) => n.t === "blog").length,
      svcs: nodes.filter((n) => n.t === "svc").length,
      realLinks: realLinks.length,
      orphans: nodes.filter((n) => n.deg === 0).length,
    },
    generated: new Date().toISOString().slice(0, 10) + " (crawl หน้าจริง)",
  };

  console.log("\n=== สรุป ===");
  console.log("หน้าทั้งหมด:", out.stats.total, "| crawl สำเร็จ:", stats.crawled - stats.failed, "| ล้มเหลว:", stats.failed);
  console.log("เจอ focus keyword:", stats.kwFound, "หน้า");
  console.log("internal link ในเนื้อหา:", out.stats.realLinks, "เส้น (ไม่นับเมนู/footer)",
    "| หน้าที่ไม่มีลิงก์เข้า (orphan):", out.stats.orphans);
  SITES.forEach((s) => {
    const ns = nodes.filter((n) => n.site === s.id);
    console.log(`  ${s.id}: ${ns.length} หน้า · มี kw ${ns.filter((n) => n.kw).length} · orphan ${ns.filter((n) => n.deg === 0).length}`);
  });

  if (DRY) { console.log("\n(--dry: ไม่เขียนไฟล์)"); return; }
  const json = JSON.stringify(out).replace(/<\//g, "<\\/");
  fs.writeFileSync(HTML_FILE, html.replace(cmMatch[0], cmMatch[1] + "\n" + json + "\n" + cmMatch[3]));
  console.log("\n✓ เขียนข้อมูลใหม่ลง index.html แล้ว");
})();
