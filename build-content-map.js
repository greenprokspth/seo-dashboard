#!/usr/bin/env node
/**
 * build-content-map.js — สร้าง/อัปเดตข้อมูล Content Map ให้ตรงกับเว็บจริง
 *
 * ทำอะไร:
 *   1. ดึงรายการหน้าจาก WordPress REST API (แหล่งหลัก ครบ+สด) + sitemap + ไล่ลิงก์จากหน้าจริง
 *      แล้วคัดหน้า noindex ออกด้วยการอ่าน <meta name="robots"> ของแต่ละหน้า
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

let lastFinalUrl = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** ดึงหน้าเว็บ พร้อม retry เมื่อเจอ 429/503 (เซิร์ฟเวอร์กันยิงถี่) */
async function get(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "GreenproContentMap/1.0" }, redirect: "follow" });
      if (res.ok) { const t = await res.text(); t.__finalUrl = res.url; lastFinalUrl = res.url; return t; }
      if ((res.status === 429 || res.status >= 500) && i < tries) { await sleep(1500 * i); continue; }
      throw new Error("HTTP " + res.status);
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(1500 * i);
    }
  }
}

/* ---------- 1. รายการหน้าทั้งหมดของเว็บ ---------- */
/**
 * WordPress REST API — แหล่งข้อมูลหลัก (ตรงจากฐานข้อมูลเว็บ ครบและสดที่สุด)
 * ดีกว่า sitemap เพราะ sitemap มักอัปเดตช้า/แคช ทำให้หน้าใหม่ตกหล่น
 * คืน Map: url -> { mod, status, type }
 */
async function wpApiUrls(site) {
  const out = new Map();
  for (const type of ["posts", "pages"]) {
    for (let page = 1; page <= 20; page++) {
      let arr;
      try {
        const txt = await get(
          `https://${site.domain}/wp-json/wp/v2/${type}?per_page=100&page=${page}&status=publish&_fields=link,modified,status`
        );
        arr = JSON.parse(txt);
      } catch (e) { break; }
      if (!Array.isArray(arr) || !arr.length) break;
      for (const p of arr) {
        if (!p.link) continue;
        out.set(norm(p.link), { mod: (p.modified || "").slice(0, 10), type });
      }
      if (arr.length < 100) break;
    }
  }
  return out;
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
 * ตัดเฉพาะ "โซนเนื้อหา" ของหน้าออกมา (ตัดเมนู/header/footer ทิ้ง)
 *
 * เดิมใช้วิธีนับความถี่ (ลิงก์ที่โผล่เกิน 60% ของหน้า = เมนู) ซึ่ง **ผิด** สำหรับเว็บนี้:
 * เว็บเอาหน้าบริการทั้ง 36 หน้าใส่ไว้ในเมนู ทำให้หน้าบริการถูกขึ้นบัญชีดำทั้งหมด
 * แล้วลิงก์ที่ชี้ไปหาหน้าบริการ "จากในเนื้อหาบทความ" ก็ถูกตัดทิ้งไปด้วย
 * ผลคือหน้าบริการทุกหน้าแสดง deg=0 ทั้งที่จริงมีบทความลิงก์มาหาเพียบ
 *
 * วิธีใหม่: ตัดตามตำแหน่งใน HTML แทน เว็บใช้ Elementor ซึ่งมี marker ชัดเจน
 *   data-elementor-type="header"                    -> ส่วนหัว
 *   data-elementor-type="single|wp-page|wp-post|archive" -> เริ่มเนื้อหา
 *   data-elementor-type="footer"                    -> ส่วนท้าย
 * ลิงก์เดียวกันที่อยู่ในเมนูจะไม่ถูกนับ แต่ถ้าอยู่ในเนื้อหาจะนับ — ตรงตามที่ต้องการ
 */
function contentZone(html) {
  let start = 0, end = html.length;
  const single = html.search(/data-elementor-type=["'](single|wp-page|wp-post|archive|product)/i);
  const header = html.search(/data-elementor-type=["']header/i);
  const footer = html.search(/data-elementor-type=["']footer/i);
  // หน้าบริการบางหน้าไม่มี marker เนื้อหาของ Elementor เลย (มีแค่ header/footer)
  // จึงต้องหาจุดเริ่มเนื้อหาจากโครง HTML มาตรฐานแทน: <main> / #content / .site-main / .entry-content
  const mainRe = /<main[\s>]|id=["']content["']|class=["'][^"']*site-main|class=["'][^"']*entry-content/i;
  const main = html.search(mainRe);
  if (single >= 0) start = single;
  else if (header >= 0) {
    // ไม่มี landmark ใด ๆ — ข้ามทั้งบล็อก <header>...</header> (เดิมใช้ indexOf(">") ซึ่งข้ามแค่แท็กเปิด
    // ทำให้เมนูทั้งก้อนยังอยู่ในโซนเนื้อหา และถูกนับเป็น internal link ผิด ๆ)
    const close = html.toLowerCase().indexOf("</header>", header);
    const after = close > 0 ? close + 9 : html.indexOf(">", header);
    start = after > 0 ? after : header;
    if (main > start) start = main;                 // มี <main>/.site-main อยู่ถัดจาก header -> แม่นกว่า
  } else if (main >= 0) start = main;
  if (footer > start) end = footer;
  const zone = html.slice(start, end);
  // กันเหนียว: ใช้เฉพาะกรณี "หา landmark ไม่เจอเลย" เท่านั้น
  // (เดิมเช็ค < 5% ของหน้า ซึ่งพังกับหน้าบริการที่เมนูยาวมาก: เนื้อหาจริง 9KB จากหน้า 198KB = 4.6%
  //  ถูกตีว่าผิดปกติแล้วคืนทั้งหน้า -> ลิงก์เมนู 45 เส้นถูกนับเป็น internal link ทั้งหมด)
  // ถ้ายังตัดหัวไม่ได้เลย (ไม่เจอทั้ง single/main/header) แต่รู้จุดจบ footer -> อย่างน้อยตัดท้ายทิ้ง
  const found = start > 0 || end < html.length;
  if (!found || zone.length < 200) return { zone: html, sliced: false };   // 200 พอกันเคสตัดพลาดจริง ๆ
  // (หน้ารวมบริการอย่าง /services/ มีเนื้อหาจริงแค่ ~490 ตัวอักษร เพราะเป็นหน้าสารบัญ — ต้องไม่ตีว่าผิดปกติ)
  return { zone, sliced: true };
}

/**
 * ดึงลิงก์ภายในทั้งหมดของหน้า
 * onlyContent=true -> นับเฉพาะลิงก์ในเนื้อหา (ตัดเมนู/header/footer ออกแล้ว)
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
/** อ่าน <meta name="robots"> — ใช้คัดหน้า noindex ออก */
function isNoIndex(html) {
  const m = html.match(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']+)["']/i);
  return m ? /noindex/i.test(m[1]) : false;
}
async function crawlPage(url, domain) {
  try {
    const html = await get(url);
    const finalUrl = norm(lastFinalUrl || url);
    const cz = contentZone(html);
    return {
      ok: true,
      finalUrl,
      kw: extractFocusKw(html),
      links: extractInternalLinks(cz.zone, domain),   // เฉพาะลิงก์ในเนื้อหา (ตัดเมนู/footer แล้ว)
      allLinks: extractInternalLinks(html, domain),   // ทั้งหน้า — ไว้เทียบตอนตรวจ
      sliced: cz.sliced,
      noindex: isNoIndex(html),
      title: (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "",
    };
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
  const stats = { crawled: 0, failed: 0, kwFound: 0, boilerplate: 0, discovered: 0, noindexSkipped: 0, redirects: 0, archives: 0 };

  for (const site of SITES) {
    process.stderr.write(`\n[${site.id}] ดึงรายการหน้าจาก WordPress API...`);
    const wp = await wpApiUrls(site);                       // แหล่งหลัก: ครบ + สด
    const urls = new Map();
    wp.forEach((v, k) => urls.set(k, v.mod));
    process.stderr.write(` ${urls.size} หน้า\n`);
    try {                                                    // เสริมด้วย sitemap เผื่อมีหน้าที่ API ไม่คืน
      const sm = await sitemapUrls(site);
      let extra = 0;
      sm.forEach((mod, u) => { if (!urls.has(u)) { urls.set(u, mod); extra++; } });
      if (extra) process.stderr.write(`  + จาก sitemap อีก ${extra} หน้า\n`);
    } catch (e) { process.stderr.write("  (อ่าน sitemap ไม่ได้ — ใช้ข้อมูลจาก API อย่างเดียว)\n"); }

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

    /* ---- รอบเก็บตก: หา URL ที่ไม่อยู่ใน sitemap (sitemap มักอัปเดตช้า) ---- */
    {
      const known = new Set(list);
      const found = new Set();
      for (const r of results.values()) {
        if (!r.ok) continue;
        for (const l of r.links) if (!known.has(l)) found.add(l);
      }
      const extra = [...found];
      if (extra.length) {
        process.stderr.write(`  เจอหน้าที่ไม่อยู่ใน sitemap ${extra.length} URL — กำลังตรวจ...\n`);
        let j = 0, added = 0;
        await Promise.all(
          Array.from({ length: CONCURRENCY }, async () => {
            while (j < extra.length) {
              const u = extra[j++];
              const r = await crawlPage(u, site.domain);
              stats.crawled++;
              if (!r.ok) { stats.failed++; continue; }
              if (r.noindex) { stats.noindexSkipped++; continue; }   // หน้า noindex ไม่เอา
              results.set(u, r);
              list.push(u);
              urls.set(u, "");
              added++;
              if (r.kw) stats.kwFound++;
            }
          })
        );
        stats.discovered += added;
        process.stderr.write(`  เพิ่มหน้าที่ sitemap ยังไม่มี: ${added} หน้า\n`);
      }
    }

    for (const u of list) {
      const rr = results.get(u);
      if (rr && rr.ok && rr.noindex) { stats.noindexSkipped++; continue; }  // หน้า noindex — ไม่แสดงใน map
      // URL ที่ redirect ไปหน้าอื่น = URL เก่า/ซ้ำ ไม่ใช่หน้าจริง
      if (rr && rr.ok && rr.finalUrl && rr.finalUrl !== u) { stats.redirects++; continue; }
      // หน้ารวมหมวดหมู่ (/blog/, /blog/tax/) ไม่ใช่หน้าเนื้อหา
      if (/^\/(blog|th)\/?$/.test(u.replace(/https?:\/\/[^\/]+/, "")) ||
          /^\/blog\/[^\/]+\/$/.test(u.replace(/https?:\/\/[^\/]+/, ""))) { stats.archives++; continue; }
      const oldNode = oldByUrl.get(u);
      const c = oldNode ? { t: oldNode.t, cat: oldNode.cat, label: oldNode.label } : classify(u, site.id);
      const slug = dec(u.replace(/\/$/, "").split("/").pop() || "home");
      const id = oldNode ? oldNode.id : (c.t === "svc" ? "svc:" : "b:") + site.id + ":" + slug;
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


    /* นับเฉพาะลิงก์ในเนื้อหา — r.links ถูกตัดเมนู/header/footer ออกแล้วตั้งแต่ตอน crawl
       (เลิกใช้ findBoilerplate ที่นับความถี่ เพราะตัดหน้าบริการทิ้งทั้งหมด ดูคอมเมนต์ที่ contentZone) */
    let slicedOk = 0, slicedFail = 0, cut = 0;
    for (const u of list) {
      const r = results.get(u);
      if (!r || !r.ok) continue;
      r.sliced ? slicedOk++ : slicedFail++;
      cut += Math.max(0, (r.allLinks || []).length - r.links.length);
      const from = urlToId.get(u);
      if (!from) continue;                            // หน้านี้ถูกกรองทิ้ง (noindex/redirect) — ไม่มีโหนด
      for (const target of r.links) {
        const to = urlToId.get(target);
        if (to && to !== from) allLinks.push({ s: from, t: to, k: "real" });
      }
    }
    process.stderr.write(`  แยกโซนเนื้อหาได้ ${slicedOk} หน้า` +
      (slicedFail ? ` (ใช้ทั้งหน้า ${slicedFail} หน้า — ไม่เจอ marker)` : "") +
      ` · ตัดลิงก์เมนู/footer ออกเฉลี่ย ${slicedOk ? Math.round(cut / slicedOk) : 0} ลิงก์/หน้า\n`);
    stats.boilerplate += cut;
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
  /* ตัดลิงก์ที่หาโหนดปลายทางไม่เจอ (กัน d3.forceLink พัง) */
  const validLinks = realLinks.filter((l) => ids.has(l.s) && ids.has(l.t));
  const dropped = realLinks.length - validLinks.length;
  if (dropped) console.log("  (ตัดลิงก์ที่หาโหนดไม่เจอ", dropped, "เส้น)");
  realLinks.length = 0; realLinks.push(...validLinks);
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
  console.log("เจอเพิ่มจากการไล่ลิงก์:", stats.discovered,
    "| ข้าม noindex:", stats.noindexSkipped, "| ข้าม URL ที่ redirect ซ้ำ:", stats.redirects, "| ข้ามหน้ารวมหมวดหมู่:", stats.archives);
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
