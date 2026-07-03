# SEO Dashboard — Greenpro Group

Dashboard รายงาน SEO รายสัปดาห์ แบบ **ไฟล์เดียวจบ** (`index.html`) ไม่มี build step, ไม่มี framework
Deploy ด้วย GitHub Pages — push ขึ้น `main` แล้วหน้าเว็บอัปเดตเองใน 1–2 นาที

## สถาปัตยกรรม (สำคัญ — อ่านก่อนแก้อะไร)

ไฟล์ `index.html` ไฟล์เดียว แบ่งเป็น 3 ส่วน:

1. **ข้อมูลรายงาน** — JSON ฝังใน `<script type="application/json" id="report-data">`
   โครงสร้าง: `sites[] → weeks[] → {metrics, findings, actions, tracked, quickWins, content, technical, competitors, history, summaryHtml}`
   อัปเดตตัวเลข Ahrefs รายสัปดาห์ = แก้ JSON ก้อนนี้ (เพิ่ม week ใหม่ไว้หน้าสุดของ `weeks[]`)

2. **Firebase config** — `<script>` เล็ก ๆ ใน `<head>` มีบรรทัด `window.FIREBASE_CONFIG = {...}`
   ⚠️ **ห้ามลบ/ห้ามแก้ก้อนนี้เด็ดขาด** — ถ้าเป็น `null` dashboard จะตกไปโหมด localStorage
   (เครื่องใครเครื่องมัน) ทันที สังเกตจากป้ายมุมขวาบน: 🟢 = เชื่อม Firebase อยู่, ⚪ = โหมดเครื่องนี้

3. **โค้ดทั้งหมด** — IIFE ใน `<script>` ท้ายไฟล์ + CSS ใน `<style>` บนหัวไฟล์ (ใช้ CSS variables จาก `:root`)

## ลิงก์แยกต่อเว็บไซต์ (deep link)

แต่ละเว็บมี URL ของตัวเองด้วย hash ต่อท้าย — เปิดแล้วเข้าเว็บนั้นทันที และกดแท็บเมื่อไหร่ URL เปลี่ยนตาม:
- `#kspasiafin` → KSP AsiaFin
- `#greenproksp` → Greenpro KSP
- `#perfectblending` → Perfect Blending

hash = `site.id` ใน JSON `report-data` — **ถ้าเพิ่มเว็บไซต์ใหม่ใน JSON ลิงก์จะใช้ได้เองอัตโนมัติ** (ดูฟังก์ชัน `siteFromHash()` และ `selectSite()`)

## ข้อมูลทีมอยู่ใน Firebase ไม่ได้อยู่ในไฟล์

สถานะงาน (todo/doing/done), ผู้รับผิดชอบ, กำหนดเสร็จ, โน้ต, การปิดงาน ของทีม
เก็บใน **Firebase Realtime Database** — การ push โค้ดใหม่**ไม่กระทบข้อมูลทีม**

โครงสร้างใน RTDB:
- `overrides/{siteId}/{weekId}/actions/{actionId}` → `{stage, owner, due, closed, note, log[]}`
  (log entry: `{stage, at, by}` — `by` คือชื่อคนแก้)
- `activity` → feed "ใครทำอะไรเมื่อไหร่" (push แบบ append, หน้าเว็บอ่าน `limitToLast(80)`)

## กติกาเวลาเพิ่มฟีเจอร์

- **ทุกอย่างต้องจบในไฟล์เดียว** — ห้ามแยกไฟล์ .js/.css เพิ่ม, ห้ามใส่ build step
  (library ภายนอกใช้ CDN `<script src>` ได้ เหมือน Chart.js กับ Firebase ที่มีอยู่)
- ฟิลด์ใหม่ที่ให้ผู้ใช้แก้ได้ ต้องเดินผ่านทางเดิมเสมอ:
  `saveOverrides(site, week, changedAction)` (บันทึก local + sync Firebase ต่อ action)
  และเรียก `logActivity(action, "ข้อความภาษาไทย")` เพื่อลงประวัติพร้อมชื่อคนทำ
  ถ้าเพิ่มฟิลด์ใน action ต้องเพิ่มใน `packAction()`, `saveOverrides()` และ `applyOverrides()` ให้ครบทั้งสามจุด
- ชื่อคนแก้: ใช้ `editorName()` (ถามครั้งแรก เก็บใน localStorage key `greenpro-seo-editor-name`)
- ข้อความ UI เป็น**ภาษาไทย**ทั้งหมด สไตล์สีเขียว Greenpro (ตัวแปรใน `:root`)
- ระวัง XSS: ข้อความที่ผู้ใช้พิมพ์ (ชื่อ, โน้ต) ต้องผ่าน `esc()` ก่อนใส่ innerHTML
- render ทั้งหมดรวมที่ `renderAll()` — ข้อมูลจาก Firebase เข้ามาทาง listener ที่เรียก `safeRender()`
  (กันไม่ให้ re-render ทับขณะผู้ใช้กำลังพิมพ์)

## วิธีทดสอบ

เปิด `index.html` ในเบราว์เซอร์ตรง ๆ ได้เลย (ดับเบิลคลิก หรือ `python -m http.server`)
— จะต่อ Firebase ตัวจริง เห็นข้อมูลจริงของทีม เช็คว่าป้ายเป็น 🟢 และ console ไม่มี error

## อื่น ๆ

- ปุ่ม "Export HTML" = สำรองข้อมูลลงไฟล์เท่านั้น (มรดกจาก workflow เก่า) — เก็บไว้ อย่าลบ
- คู่มือตั้งค่า Firebase ครั้งแรกอยู่ที่ `SETUP-FIREBASE.md`
- Workflow ทีม: ทีมแก้ข้อมูลผ่านหน้าเว็บอย่างเดียว / thanakorn เป็นคนเดียวที่แก้โค้ดและ push
  — **Pull ก่อนแก้เสมอ** กันทับฟีเจอร์ที่เพิ่มไว้แล้ว
