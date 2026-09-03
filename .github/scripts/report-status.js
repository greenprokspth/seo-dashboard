/** บอกผลกลับไปที่ Firebase เพื่อให้หน้า dashboard แสดงสถานะได้ */
const DB = (process.env.DB || "").replace(/\/+$/, "");
const ok = (process.env.STATUS || "").toLowerCase() === "success";
(async () => {
  if (!DB) return;
  await fetch(`${DB}/mapRefresh.json`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ finishedAt: Date.now(), state: ok ? "done" : "error" }),
  }).catch((e) => console.log("อัปเดตสถานะไม่สำเร็จ:", e.message));
})();
