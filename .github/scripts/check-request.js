/**
 * เช็คว่ามีคนกดปุ่ม "อัปเดตข้อมูลตอนนี้" ในหน้า dashboard ไหม
 * อ่านจาก Firebase path: mapRefresh  ->  { requestedAt, by, startedAt, finishedAt }
 *
 * เงื่อนไขที่จะรัน:
 *   - กดรันเองจากหน้า Actions (workflow_dispatch) -> รันเสมอ
 *   - มี requestedAt ใหม่กว่า startedAt ล่าสุด    -> รัน
 *   - กันรันถี่: ถ้าเพิ่งรันไปไม่ถึง 20 นาที จะไม่รันซ้ำ
 */
const fs = require("fs");
const DB = (process.env.DB || "").replace(/\/+$/, "");
const MANUAL = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
const out = (k, v) => fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
const MIN_GAP_MS = 20 * 60 * 1000;

(async () => {
  if (MANUAL) { console.log("กดรันเองจากหน้า Actions — รันเลย"); return out("should_run", "true"); }
  if (!DB) { console.log("ยังไม่ได้ตั้ง secret FIREBASE_DB_URL — ข้าม"); return out("should_run", "false"); }

  let st = {};
  try {
    const res = await fetch(`${DB}/mapRefresh.json`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    st = (await res.json()) || {};
  } catch (e) {
    console.log("อ่าน Firebase ไม่ได้:", e.message, "— ข้ามรอบนี้");
    return out("should_run", "false");
  }

  const req = Number(st.requestedAt || 0);
  const started = Number(st.startedAt || 0);
  if (!req) { console.log("ยังไม่มีใครกดปุ่ม"); return out("should_run", "false"); }
  if (req <= started) { console.log("คำขอนี้รันไปแล้ว"); return out("should_run", "false"); }
  if (Date.now() - started < MIN_GAP_MS) {
    console.log("เพิ่งรันไปไม่ถึง 20 นาที — ข้ามไว้ก่อน กันรันถี่เกิน");
    return out("should_run", "false");
  }

  console.log("พบคำขอจาก:", st.by || "(ไม่ระบุชื่อ)");
  // จองคิวทันที กันรอบถัดไปรันซ้ำ
  await fetch(`${DB}/mapRefresh.json`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startedAt: Date.now(), state: "running" }),
  }).catch(() => {});
  out("should_run", "true");
})();
