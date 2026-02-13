export function getTodayPrefix() {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" })
  );

  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  return `sms-${yyyy}-${mm}-${dd}`;
}
