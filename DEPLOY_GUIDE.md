# CQB-SIM Online — วิธี Deploy ขึ้น Render.com (ฉบับมือใหม่)

ทำตามทีละขั้น ไม่ต้องรู้เรื่อง Git/GitHub มาก่อน

---

## ขั้น 1 — สร้างบัญชี GitHub (จำเป็น แม้ไม่อยากใช้ก็ต้องมี)

Render.com ต้องดึงโค้ดจาก GitHub เป็นวิธีที่ง่ายที่สุด (อัปโหลดไฟล์ตรงทำได้ยุ่งยากกว่า)

1. ไปที่ https://github.com/signup
2. กรอก email, password, username → ยืนยันตามขั้นตอน
3. เสร็จแล้วจะได้หน้า Dashboard ของ GitHub

---

## ขั้น 2 — สร้าง Repository (ที่เก็บโค้ด) ใหม่

1. คลิกปุ่ม **+** มุมขวาบน → **New repository**
2. ตั้งชื่อ เช่น `cqb-sim-online`
3. เลือก **Public** (ฟรี ใช้งานได้)
4. **ไม่ต้อง** ติ๊ก "Add a README file"
5. กด **Create repository**

---

## ขั้น 3 — อัปโหลดไฟล์ขึ้น GitHub (ไม่ต้องใช้คำสั่ง Git)

GitHub มีวิธีอัปโหลดผ่านหน้าเว็บตรงๆ ได้ ไม่ต้องติดตั้งโปรแกรมอะไรเพิ่ม

1. ในหน้า repository ที่สร้างไว้ จะเห็นปุ่ม **uploading an existing file** (หรือ "Add file" → "Upload files")
2. **ลากไฟล์ทั้งหมด** จากโฟลเดอร์ `cqb-sim-online` ไปวาง:
   - `server.js`
   - `package.json`
   - โฟลเดอร์ `public` ทั้งโฟลเดอร์ (ลากทั้งโฟลเดอร์เข้าไปได้เลย หรือลากไฟล์ข้างในทีละไฟล์ถ้าลากโฟลเดอร์ไม่ได้)

   **สำคัญ:** โครงสร้างไฟล์บน GitHub ต้องตรงกับนี้เป๊ะ
   ```
   cqb-sim-online/
   ├── server.js
   ├── package.json
   └── public/
       ├── index.html
       ├── network.js
       ├── scene.js
       ├── mapeditor.js
       ├── units.js
       ├── formations.js
       ├── controls.js
       ├── main.js
       └── three.min.js
   ```

3. เลื่อนลงล่าง กด **Commit changes**

---

## ขั้น 4 — สมัครบัญชี Render.com

1. ไปที่ https://render.com
2. กด **Get Started** → เลือก **Sign up with GitHub** (เชื่อมกับบัญชี GitHub ที่สร้างไว้เลย ง่ายสุด)
3. อนุญาตให้ Render เข้าถึง GitHub ของคุณ

---

## ขั้น 5 — สร้าง Web Service ใหม่บน Render

1. ในหน้า Render Dashboard กด **New +** → **Web Service**
2. เลือก repository `cqb-sim-online` ที่สร้างไว้ (ถ้าไม่เห็น กด "Configure account" เพื่อให้สิทธิ์ Render เข้าถึง repo นั้น)
3. ตั้งค่าตามนี้:

| ช่อง | ค่าที่ใส่ |
|---|---|
| Name | `cqb-sim-online` (หรือชื่อใดก็ได้) |
| Region | เลือกใกล้ที่สุด (Singapore ถ้ามี) |
| Branch | `main` |
| Root Directory | เว้นว่างไว้ |
| Runtime | `Node` |
| Build Command | `npm install` |
| Start Command | `node server.js` |
| Instance Type | **Free** |

4. กด **Create Web Service**

---

## ขั้น 6 — รอ Deploy เสร็จ

- Render จะแสดง log การติดตั้งแบบ real-time
- รอจนเห็นคำว่า **"Live"** สีเขียวที่ด้านบน (ใช้เวลาประมาณ 1-3 นาที)
- จะได้ URL แบบ `https://cqb-sim-online.onrender.com`

---

## ขั้น 7 — ทดสอบ

1. เปิด URL ที่ได้ในเบราว์เซอร์ → ควรเห็นหน้า "CQB-SIM ONLINE" พร้อมปุ่ม Create/Join Room
2. กด **CREATE ROOM** → ได้รหัสห้อง 6 ตัว
3. ส่ง **URL เดียวกัน** ให้เพื่อน → เพื่อนกด **JOIN ROOM** ใส่รหัสที่ได้
4. ทั้งสองคนควรเห็นแมพและ unit เดียวกัน ขยับแล้วเห็นพร้อมกันได้

---

## ข้อควรรู้เกี่ยวกับ Free Tier ของ Render

- **Server จะ "หลับ" ถ้าไม่มีคนใช้นานเกิน 15 นาที** — ตอนเข้าใหม่ครั้งแรกอาจช้าประมาณ 30-50 วินาที (รอให้ server ตื่นก่อน)
- ห้องที่สร้างไว้จะ **หายไปถ้า server restart** (เพราะข้อมูลเก็บใน memory ไม่ได้เก็บถาวร) — ถ้าอยากเล่นใหม่ก็สร้างห้องใหม่ได้เรื่อยๆ ไม่มีปัญหา
- เหมาะกับการเล่นทดสอบกับเพื่อนกลุ่มเล็ก ไม่ใช่ production scale

---

## ถ้าทำพลาด หรือ Deploy ไม่ผ่าน

อาการที่พบบ่อยและวิธีแก้:

| ปัญหา | สาเหตุที่เป็นไปได้ |
|---|---|
| Build failed: "Cannot find package.json" | โครงสร้างไฟล์บน GitHub ผิด — package.json ต้องอยู่ "นอก" โฟลเดอร์ public ไม่ใช่ข้างใน |
| หน้าเว็บขึ้นแต่กด Create Room ไม่ตอบสนอง | เช็ค Render Logs ว่า server crash หรือไม่ (อาจพิมพ์ error ออกมาให้เห็น) |
| "Application failed to respond" | รอสักครู่ — server free tier ตื่นช้าหลัง sleep |

ถ้าติดขั้นไหน ส่ง screenshot ของ error message มาได้เลย จะช่วยไล่ปัญหาต่อให้
