export function tomorrow3pmETISO() {
  // Hackathon-safe: assume ET = -05:00 (Feb is EST). Good for your current date (Feb 9, 2026).
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const y = tomorrow.getFullYear();
  const m = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getDate()).padStart(2, "0");

  // 3:00 PM ET with -05:00 offset
  return `${y}-${m}-${d}T15:00:00-05:00`;
}
