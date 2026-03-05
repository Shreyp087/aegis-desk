import { QueueAction, SessionEvent } from "./types";

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function rand(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export type ScenarioName = "NORMAL_FAN" | "SUSPICIOUS_USER" | "BOT_BURST";

export async function runScenario(
  name: ScenarioName,
  push: (action: QueueAction, meta?: SessionEvent["meta"]) => void | Promise<void>
) {
  if (name === "NORMAL_FAN") {
    await push("JOIN");
    await delay(rand(650, 1200));
    await push("REFRESH");
    await delay(rand(900, 1700));
    await push("REFRESH");
    await delay(rand(800, 1800));
    await push("CHECKOUT");
    return;
  }

  if (name === "SUSPICIOUS_USER") {
    await push("JOIN", { multiTab: false, tokenReuse: false });
    await delay(rand(180, 320));
    await push("REFRESH");
    await delay(rand(120, 220));
    await push("REFRESH");
    await delay(rand(90, 180));
    await push("REFRESH", { uaFlip: true });
    await delay(rand(120, 220));
    await push("CHECKOUT");
    return;
  }

  await push("JOIN", { multiTab: true, tokenReuse: true });
  for (let i = 0; i < 10; i++) {
    await delay(rand(60, 120));
    await push("REFRESH", { multiTab: true, tokenReuse: true });
  }
  await delay(rand(70, 140));
  await push("CHECKOUT", { multiTab: true, tokenReuse: true, uaFlip: true });
}
