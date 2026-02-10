export function createICS(title: string, datetimeISO: string) {
  // Minimal ICS; good enough for demo
  const dt = datetimeISO.replace(/[-:]/g, "").split(".")[0] + "Z";
  const uid = `aegis-${Date.now()}@local`;

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AegisDesk//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dt}`,
    `DTSTART:${dt}`,
    `DTEND:${dt}`,
    `SUMMARY:${title}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return { ics };
}