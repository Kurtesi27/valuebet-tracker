import { chromium, Browser } from "playwright";
import { normalizeTeamName } from "@/lib/normalizeTeam";

export interface ScrapedMatch {
  bookmaker: "BETANO";
  homeTeam: string;
  awayTeam: string;
  startTime: Date;
  league: string;
  odds: {
    home: number;
    draw: number;
    away: number;
  };
}

export async function scrapeBetanoPrimeiraLiga(): Promise<ScrapedMatch[]> {
  // Lança o Chromium real renderizado fora da área visível do monitor
  const browser: Browser = await chromium.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--window-position=-2400,-2400",
      "--window-size=1366,768",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const matches: ScrapedMatch[] = [];

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "pt-PT",
      viewport: { width: 1366, height: 768 },
    });

    const page = await context.newPage();
    let competitionData: any = null;

    page.on("response", async (res) => {
      const url = res.url();
      if (url.includes("/competicoes/portugal/11382") && res.status() === 200) {
        try {
          const json = await res.json();
          const d = json.data || json;
          if (d.blocks || d.events) {
            competitionData = d;
          }
        } catch {}
      }
    });

    await page.goto("https://www.betano.pt/sport/futebol/competicoes/portugal/11382/", {
      waitUntil: "domcontentloaded",
      timeout: 35000,
    });

    await page.waitForTimeout(2000);

    // Remove modais e pop-ups promocionais do DOM
    await page.evaluate(() => {
      const overlays = document.querySelectorAll(
        "[class*='modal'], [class*='overlay'], [class*='backdrop'], #onetrust-banner-sdk"
      );
      overlays.forEach((el) => el.remove());
    });

    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Clica no separador 'Jogos'
    await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll("div, button, a, span"));
      const jogosElement = elements.find(
        (el) => el.textContent?.trim() === "Jogos" && el.children.length === 0
      );
      if (jogosElement) {
        (jogosElement as HTMLElement).click();
        jogosElement.parentElement?.click();
      }
    });

    // Aguarda o pacote de rede
    for (let i = 0; i < 20; i++) {
      if (competitionData) break;
      await page.waitForTimeout(500);
    }

    if (competitionData) {
      const findEvents = (obj: any): any[] => {
        if (!obj || typeof obj !== "object") return [];
        if (Array.isArray(obj.events) && obj.events.length > 0) return obj.events;
        if (Array.isArray(obj)) {
          for (const item of obj) {
            const found = findEvents(item);
            if (found.length > 0) return found;
          }
        }
        for (const key of Object.keys(obj)) {
          if (typeof obj[key] === "object") {
            const found = findEvents(obj[key]);
            if (found.length > 0) return found;
          }
        }
        return [];
      };

      const events = findEvents(competitionData);

      for (const ev of events) {
        const home = ev.participants?.[0]?.name || ev.name?.split(" - ")?.[0];
        const away = ev.participants?.[1]?.name || ev.name?.split(" - ")?.[1];

        if (!home || !away) continue;

        const m1x2 = ev.markets?.find(
          (m: any) =>
            m.name?.toLowerCase().includes("resultado") ||
            m.name?.toLowerCase().includes("1x2") ||
            m.type === "MRES"
        );

        if (!m1x2?.selections || m1x2.selections.length < 3) continue;

        let homeOdd = 0;
        let drawOdd = 0;
        let awayOdd = 0;

        for (const s of m1x2.selections) {
          const sName = s.name?.trim();
          if (sName === "1") homeOdd = Number(s.price);
          else if (sName === "X" || sName === "x") drawOdd = Number(s.price);
          else if (sName === "2") awayOdd = Number(s.price);
        }

        if (homeOdd && drawOdd && awayOdd) {
          matches.push({
            bookmaker: "BETANO",
            homeTeam: normalizeTeamName(home, "PRIMEIRA_LIGA"),
            awayTeam: normalizeTeamName(away, "PRIMEIRA_LIGA"),
            startTime: new Date(ev.startTime),
            league: "Primeira Liga",
            odds: { home: homeOdd, draw: drawOdd, away: awayOdd },
          });
        }
      }
    }
  } finally {
    await browser.close();
  }

  return matches;
}