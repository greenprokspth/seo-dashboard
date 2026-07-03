# วิธีเชื่อม Dashboard เข้ากับระบบกลาง (Firebase) — ทำครั้งเดียวจบ

เมื่อเชื่อมแล้ว: ทุกคนแก้สถานะงาน / ลากการ์ดไป Doing–Done / ใส่ชื่อผู้รับผิดชอบ / เขียนโน้ต
**ในหน้า dashboard ได้เลย และเห็นถึงกันทันที** พร้อมชื่อคนทำ + เวลา ในกล่อง "ประวัติการอัปเดต"
ไม่ต้องกด Export HTML ส่งไฟล์ให้ใครอีก

ใช้เวลาตั้งค่าประมาณ 10 นาที ใช้บัญชี Google (Gmail) ที่มีอยู่แล้ว ฟรี ไม่มีค่าใช้จ่าย

---

## ขั้นที่ 1 — สร้างโปรเจกต์ Firebase

1. เข้า <https://console.firebase.google.com> แล้วล็อกอินด้วย Gmail ของบริษัท
2. กด **Create a project** (หรือ "เพิ่มโปรเจกต์")
3. ตั้งชื่อ เช่น `greenpro-seo` → กด Continue
4. หน้า Google Analytics: **ปิด** (ไม่จำเป็น) → กด Create project → รอสักครู่ → Continue

## ขั้นที่ 2 — สร้าง Realtime Database

1. เมนูซ้าย: **Build → Realtime Database** → กด **Create Database**
2. เลือก location: **Singapore (asia-southeast1)** (ใกล้ไทยที่สุด)
3. เลือก **Start in test mode** → กด Enable
4. ไปที่แท็บ **Rules** แล้ววางแทนของเดิมทั้งหมด จากนั้นกด **Publish**:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

> หมายเหตุ: กติกานี้คือ "ใครที่รู้ที่อยู่ database ก็อ่าน/เขียนได้" เหมาะกับ dashboard
> ภายในทีมที่ไม่มีข้อมูลลับ ถ้าอนาคตอยากล็อกให้เฉพาะทีม ค่อยเพิ่มระบบล็อกอินทีหลังได้

## ขั้นที่ 3 — เอาค่า config มาวางในไฟล์

1. กดไอคอน **⚙ (Project settings)** มุมซ้ายบน
2. เลื่อนลงหา **Your apps** → กดไอคอน **`</>` (Web)**
3. ตั้งชื่อ app เช่น `seo-dashboard` → กด Register app (ไม่ต้องติ๊ก Hosting)
4. จะเห็นโค้ด `const firebaseConfig = { apiKey: "...", ... }` — คัดลอกเฉพาะก้อน `{ ... }` ไว้
5. เปิดไฟล์ `index.html` หาบรรทัด (อยู่ช่วงบนของไฟล์ ประมาณบรรทัดที่ 25):

```js
window.FIREBASE_CONFIG = null;
```

แก้เป็น (วางก้อนที่คัดลอกมา):

```js
window.FIREBASE_CONFIG = {
  apiKey: "AIza....",
  authDomain: "greenpro-seo.firebaseapp.com",
  databaseURL: "https://greenpro-seo-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "greenpro-seo",
  storageBucket: "greenpro-seo.appspot.com",
  messagingSenderId: "....",
  appId: "...."
};
```

> **สำคัญ:** ต้องมีบรรทัด `databaseURL` ด้วย — ถ้าก้อนที่คัดลอกมาไม่มี ให้ดูที่หน้า
> Realtime Database จะเห็น URL ขึ้นต้นด้วย `https://...firebasedatabase.app` เอามาเติมเอง

## ขั้นที่ 4 — push ขึ้น GitHub แล้วเปิด GitHub Pages

1. commit + push ไฟล์ `index.html` ที่แก้แล้วขึ้น GitHub (ทำผ่านหน้าเว็บ GitHub ก็ได้:
   เปิด repo → กดไฟล์ index.html → ไอคอนดินสอ ✏ → วางเนื้อหาใหม่ → Commit changes)
2. เปิด GitHub Pages: ที่ repo → **Settings → Pages** → Source เลือก **Deploy from a branch**
   → Branch เลือก `main` / `(root)` → Save
3. รอ 1–2 นาที จะได้ลิงก์ `https://thanakorn-greenpro-th.github.io/seo-dashboard/`
   → ส่งลิงก์นี้ให้ทีม ทุกคนเปิดดูได้เลยโดยไม่ต้องมี account อะไรทั้งนั้น

## เช็คว่าสำเร็จ

- เปิดหน้า dashboard แล้วป้ายมุมขวาบนเปลี่ยนจาก ⚪ "โหมดเครื่องนี้" เป็น 🟢 "เชื่อมต่อแล้ว"
- ครั้งแรกที่เปิด ถ้าเครื่องนั้นมีข้อมูลที่เคยแก้ค้างไว้ ระบบจะถามว่าอัปโหลดขึ้นระบบกลางไหม
  → **ให้กดตกลงจากเครื่องที่มีข้อมูลล่าสุดที่สุดเท่านั้น** (เครื่องอื่นกดยกเลิก)
- ลองลากการ์ดไป Doing จากเครื่องหนึ่ง แล้วรีเฟรชอีกเครื่อง → ต้องเห็นเหมือนกัน
  พร้อมชื่อคนทำในกล่อง "ประวัติการอัปเดต"

## การใช้งานหลังจากนี้

| เรื่อง | วิธี |
|---|---|
| ทีมอัปเดตสถานะงาน/โน้ต | แก้ในหน้า dashboard ได้เลย บันทึกอัตโนมัติ ไม่ต้อง Export |
| ใส่ชื่อคนทำ | ระบบถามชื่อครั้งแรกครั้งเดียว (เปลี่ยนได้ที่ปุ่ม 👤 มุมขวาบน) |
| อัปเดตตัวเลข Ahrefs รายสัปดาห์ / เพิ่มฟีเจอร์ | แก้ `index.html` แล้ว push ขึ้น GitHub เหมือนเดิม — ข้อมูลสถานะงานของทีมอยู่ใน Firebase ไม่หายไม่ทับกัน |
| ปุ่ม Export HTML | ยังใช้ได้ เอาไว้สำรองข้อมูลลงไฟล์เป็นระยะ |
