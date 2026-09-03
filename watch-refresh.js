#!/usr/bin/env node
/**
 * watch-refresh.js — เฝ้าดูคำขอ "อัปเดตข้อมูลตอนนี้" จากหน้า dashboard แล้วทำงานให้อัตโนมัติ
 *
 * ใช้แทน GitHub Actions (GitHub ไม่ยอมให้เครื่องมืออัตโนมัติสร้างไฟล์ workflow
 * ถ้า token ไม่มีสิทธิ์ workflow — ดู README ท้ายไฟล์)
 *
 * ทำอะไร: ทุก 60 วินาที จะไปดูใน Firebase ว่ามีคนกดปุ่มในหน้าเว็บไหม
 *          ถ้ามี -> รัน build-content-map.js -> git commit -> git push -> บอกสถานะกลับหน้าเว็บ
 *
 * วิธีใช้:  node watch-refresh.js
 *          (เปิดค้างไว้ ปิดหน้าต่างเมื่อไหร่ก็หยุด · กด Ctrl+C เพื่อหยุด)
 */
const { execSync } = require("child_process");
const path = require("path");

const DB = "https://greenpro-seo-default-rtdb.asia-southeast1.firebasedatabase.app";
const POLL_MS = 60 * 1000;        // เช็คทุก 1 นาที
const MIN_GAP_MS = 10 * 60 * 1000; // กันรันถี่: เว้นอย่างน้อย 10 นาที
const DIR = __dirname;

const log = (...a) => console.log(new Date().toLocaleTimeString("th-TH"), ...a);
const sh = (cmd) => execSync(cmd, { cwd: DIR, stdio: "pipe", encoding: "utf8" });

async function patch(obj, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(`${DB}/mapRefresh.json`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(obj),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return;
      throw new Error("HTTP " + res.status);
    } catch (e) {
      if (i >= tries) { log("อัปเดตสถานะไม่สำเร็จ:", e.message); return; }
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

async function runOnce() {
  let st;
  try {
    const res = await fetch(`${DB}/mapRefresh.json`);
    st = (await res.json()) || {};
  } catch (e) { log("อ่าน Firebase ไม่ได้:", e.message); return; }

  const req = Number(st.requestedAt || 0), started = Number(st.startedAt || 0);
  if (!req || req <= started) return;                                  // ไม่มีคำขอใหม่
  if (Date.now() - started < MIN_GAP_MS) { log("เพิ่งรันไป — ข้ามไว้ก่อน"); return; }

  log("พบคำขอจาก:", st.by || "(ไม่ระบุชื่อ)", "— เริ่มอัปเดต");
  await patch({ startedAt: Date.now(), state: "running" });

  try {
    log("  กำลัง crawl เว็บจริง 3 เว็บ (ราว 3-5 นาที)...");
    sh("node build-content-map.js");

    let changed = true;
    try { sh("git diff --quiet -- index.html"); changed = false; } catch (e) { changed = true; }

    if (changed) {
      sh("git add index.html");
      const d = new Date().toISOString().slice(0, 16).replace("T", " ");
      sh(`git commit -m "อัปเดต Content Map อัตโนมัติ (${d})"`);
      // ดึงของใหม่จาก GitHub มารวมก่อน push (เผื่อมีคนอื่น/เครื่องอื่น push แทรกไว้)
      try { sh("git fetch mygithub -q"); sh("git -c core.editor=true rebase mygithub/main"); }
      catch (e) { sh("git rebase --abort"); throw new Error("รวมกับของใหม่บน GitHub ไม่ได้ — ต้องแก้ด้วยมือ"); }
      sh("git push mygithub main");
      log("  ✅ อัปเดตและ push ขึ้นเว็บแล้ว (Pages ใช้เวลาอีก 1-2 นาที)");
    } else {
      log("  ข้อมูลไม่เปลี่ยน — ไม่ต้อง commit");
    }
    await patch({ finishedAt: Date.now(), state: "done" });
  } catch (e) {
    log("  ❌ ผิดพลาด:", (e.stdout || e.message || "").toString().slice(0, 300));
    await patch({ finishedAt: Date.now(), state: "error" });
  }
}

log("เริ่มเฝ้าดูคำขออัปเดต Content Map — เช็คทุก 1 นาที (กด Ctrl+C เพื่อหยุด)");
runOnce();
setInterval(runOnce, POLL_MS);
