# SEO Dashboard — Greenpro Group

Dashboard รายงาน SEO รายสัปดาห์ แบบ **ไฟล์เดียวจบ** (`index.html`) ไม่มี build step, ไม่มี framework
Deploy ด้วย GitHub Pages — push ขึ้น `main` แล้วหน้าเว็บอัปเดตเองใน 1–2 นาที

## สถาปัตยกรรม (สำคัญ — อ่านก่อนแก้อะไร)

ไฟล์ `index.html` ไฟล์เดียว แบ่งเป็น 4 ส่วน:

1. **ข้อมูลรายงาน** — JSON ฝังใน `<script type="application/json" id="report-data">`
   โครงสร้าง: `sites[] → weeks[] → {metrics, findings, actions, tracked, quickWins, content, technical, competitors, history, summaryHtml}`
   อัปเดตตัวเลข Ahrefs รายสัปดาห์ = แก้ JSON ก้อนนี้ (เพิ่ม week ใหม่ไว้หน้าสุดของ `weeks[]`)

2. **ข้อมูล Content Map** — JSON ฝังใน `<script type="application/json" id="content-map-data">`
   โครงสร้าง: `{nodes[], links[], stats, generated}` · node = `{id, t: hub|blog|svc, label, cat, site, url, deg}`
   link = `{s, t, k: struct|plan_p|plan_s}` (struct = หน้า→hub ของคลัสเตอร์)

3. **Firebase config** — `<script>` เล็ก ๆ ใน `<head>` มีบรรทัด `window.FIREBASE_CONFIG = {...}`
   ⚠️ **ห้ามลบ/ห้ามแก้ก้อนนี้เด็ดขาด** — ถ้าเป็น `null` dashboard จะตกไปโหมด localStorage
   (เครื่องใครเครื่องมัน) ทันที สังเกตจากป้ายมุมขวาบน: 🟢 = เชื่อม Firebase อยู่, ⚪ = โหมดเครื่องนี้

4. **โค้ดทั้งหมด** — IIFE ใน `<script>` ท้ายไฟล์ + CSS ใน `<style>` บนหัวไฟล์ (ใช้ CSS variables จาก `:root`)
   ส่วนของ Content Map: CSS ทุก selector scope ใต้ `#cmView`, JS ทั้งหมดอยู่ใน `initContentMap()` (init ครั้งเดียวแบบ lazy)

## Routing (deep link)

- **URL เปล่า (ไม่มี #)** → หน้า **Content Map** (แผนที่คอนเทนต์ทั้ง 3 เว็บ, D3 force graph + list view)
- `#kspasiafin` / `#greenproksp` / `#perfectblending` → dashboard รายเว็บ (กดแท็บแล้ว URL เปลี่ยนตาม)
- hash = `site.id` ใน JSON `report-data` — เพิ่มเว็บใหม่ใน JSON แล้วลิงก์ใช้ได้เอง (ดู `siteFromHash()`, `showMap()`, `showSite()`)
- ห้ามทำ path แยกเป็นโฟลเดอร์ (เช่น /content-map/) — เคยมีแล้วถูกยุบรวมเข้า index.html เมื่อ 1 ก.ย. 2026

## การอัปเดตข้อมูล Content Map (ทำเป็นระยะเมื่อหน้าเว็บจริงเปลี่ยน)

ข้อมูลต้องตรงกับ sitemap จริงของทั้ง 3 เว็บ วิธี regenerate ที่ถูกต้อง (แบบ reconcile — อย่า generate ทับทั้งก้อน):
1. ดึง URL ทั้งหมดจาก `https://www.{greenproksp,kspasiafin,perfectblending}.com/sitemap_index.xml`
   (ตาม post-sitemap + page-sitemap, ข้าม category-sitemap)
2. หน้าที่มีอยู่แล้วใน `content-map-data` → **เก็บ node เดิมไว้ทั้งดวง** (รักษา cat/label ที่จัดไว้แล้ว)
3. หน้าที่หายจาก sitemap → ลบ node + links ของมัน · หน้าใหม่ → เพิ่ม node จัด cat จาก path/slug
   (greenproksp: `/services/`→svc gp_service, `/blog/accounting|tax|business/`→gp_acc/gp_tax/gp_register, slug มี license→gp_license, audit→gp_audit)
4. สร้าง struct link หน้า→hub ทุกหน้า, เก็บ plan_* links ที่สองปลายยังอยู่, อัปเดต `generated` เป็นวันที่ทำ

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
