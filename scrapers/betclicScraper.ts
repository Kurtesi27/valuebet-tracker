import { chromium, type Browser, type Locator, type Page } from "playwright";
import { prisma } from "@/lib/db";
import { normalizeTeamName } from "@/lib/normalizeTeam";
import {
	calculateExpectedValue,
	calculateMatchProbabilities,
} from "@/lib/math/bettingEngine";
import { resolveMatch, resolveTeam } from "@/lib/services/matchResolver";

const BETCLIC_URL = "https://www.betclic.pt/futebol-s1/primeira-liga-c32";
const LEAGUE = "Primeira Liga";
const BOOKMAKER = "BETCLIC";
type BetclicOdds = {
	home: number;
	draw: number;
	away: number;
};

type ScrapedMatch = {
	homeTeam: string;
	awayTeam: string;
	startTime: Date;
	odds: BetclicOdds;
};

export type BetclicScrapeSummary = {
	success: boolean;
	matchesProcessed: number;
	errors: string[];
};

function parseEventStartTime(dateHeader: string, timeText: string): Date {
	const timeMatch = timeText.match(/\b(\d{1,2}):(\d{2})\b/);
	const now = new Date();
	if (!timeMatch) {
		return now;
	}

	const [, hour, minute] = timeMatch;
	const normalizedHeader = dateHeader
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLocaleLowerCase("pt-PT");
	const numericDate = dateHeader.match(
		/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/,
	);
	let date = new Date(now);

	if (numericDate) {
		const [, day, month, rawYear] = numericDate;
		let year = rawYear
			? Number(rawYear.length === 2 ? `20${rawYear}` : rawYear)
			: now.getFullYear();
		date = new Date(year, Number(month) - 1, Number(day));
		if (!rawYear && date.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
			year += 1;
			date = new Date(year, Number(month) - 1, Number(day));
		}
	} else if (normalizedHeader.includes("amanha")) {
		date.setDate(date.getDate() + 1);
	} else if (!normalizedHeader.includes("hoje")) {
		const weekday = normalizedHeader.match(
			/\b(dom|domingo|seg|segunda|ter|terca|qua|quarta|qui|quinta|sex|sexta|sab|sabado)\b/,
		)?.[1];
		const weekdayNumbers: Record<string, number> = {
			dom: 0,
			domingo: 0,
			seg: 1,
			segunda: 1,
			ter: 2,
			terca: 2,
			qua: 3,
			quarta: 3,
			qui: 4,
			quinta: 4,
			sex: 5,
			sexta: 5,
			sab: 6,
			sabado: 6,
		};
		if (weekday) {
			const daysAhead =
				(weekdayNumbers[weekday] - now.getDay() + 7) % 7 || 7;
			date.setDate(date.getDate() + daysAhead);
		}
	}

	date.setHours(Number(hour), Number(minute), 0, 0);
	return date;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Erro desconhecido.";
}

async function handleCookieConsent(page: Page): Promise<void> {
	const cookieOverlaySelector = [
		"#onetrust-banner-sdk",
		"#onetrust-consent-sdk",
		'[class*="cookie"][class*="modal"]',
		'[class*="cookie"][class*="overlay"]',
		'[class*="consent"][class*="modal"]',
		'[class*="consent"][class*="overlay"]',
	].join(", ");
	const selectors = [
		"#onetrust-accept-btn-handler",
		'button[id*="accept" i]',
		'button[id*="cookie" i]',
		'button:has-text("Aceitar todos")',
		'button:has-text("Aceitar tudo")',
		'button:has-text("Aceitar")',
		'button:has-text("Concordar")',
		'[role="button"]:has-text("Aceitar todos")',
		'[role="button"]:has-text("Aceitar tudo")',
		'[role="button"]:has-text("Aceitar")',
		'[role="button"]:has-text("Concordar")',
	];
	const deadline = Date.now() + 5_000;

	while (Date.now() < deadline) {
		for (const selector of selectors) {
			const candidates = page.locator(selector);
			const count = await candidates.count();
			for (let index = 0; index < count; index += 1) {
				const button = candidates.nth(index);
				if (!(await button.isVisible().catch(() => false))) {
					continue;
				}
				try {
					await button.click({ timeout: 1_000 });
				} catch {
					await button.click({ timeout: 1_000, force: true });
				}
				console.info("[BETCLIC] Consentimento de cookies tratado.");
				const overlay = page.locator(cookieOverlaySelector).first();
				if ((await overlay.count()) > 0) {
					await overlay
						.waitFor({ state: "hidden", timeout: 2_000 })
						.catch(() => page.waitForTimeout(1_000));
				} else {
					await page.waitForTimeout(1_000);
				}
				return;
			}
		}
		await page.waitForTimeout(250);
	}

	const overlay = page.locator(cookieOverlaySelector).first();
	if (
		(await overlay.count()) > 0 &&
		(await overlay.isVisible().catch(() => false))
	) {
		console.warn(
			"[BETCLIC] Popup de cookies visível, mas não foi encontrado um botão de consentimento.",
		);
	}
}

async function getRowTeamNames(
	row: Locator,
): Promise<[string, string] | null> {
	const eventBlock = row.locator("div.event").first();
	const scoreboard = row.locator("scoreboards-scoreboard").first();
	const selectors = [
		".scoreboard_contestant",
		'[class*="contestant"]',
		'[class*="team"]',
	];
	const sources: Locator[] = [];
	if ((await eventBlock.count()) > 0) sources.push(eventBlock);
	if ((await scoreboard.count()) > 0) sources.push(scoreboard);
	sources.push(row);

	for (const source of sources) {
		for (const selector of selectors) {
			const participants = source.locator(selector);
			const count = await participants.count();
			const names: string[] = [];
			for (let index = 0; index < count; index += 1) {
				const participant = participants.nth(index);
				if ((await participant.locator(selector).count()) > 0) continue;
				const name = (await participant.innerText())
					.replace(/\s+/g, " ")
					.trim();
				if (
					name &&
					!/^\d{1,2}:\d{2}$/.test(name) &&
					!/^\d{1,3}[,.]\d{1,3}$/.test(name) &&
					!names.includes(name)
				) {
					names.push(name);
				}
			}
			if (names.length === 2 && names[0].toLowerCase() !== names[1].toLowerCase()) {
				return [names[0], names[1]];
			}
		}
	}

	if ((await eventBlock.count()) === 0) return null;
	const eventLines = (await eventBlock.innerText())
		.split(/\n/)
		.map((line) => line.replace(/\s+/g, " ").trim())
		.filter(Boolean);
	const timeIndex = eventLines.findIndex((line) => /^\d{1,2}:\d{2}$/.test(line));
	if (timeIndex <= 0 || timeIndex >= eventLines.length - 1) return null;
	const homeTeam = eventLines.slice(0, timeIndex).join(" ").trim();
	const awayTeam = eventLines
		.slice(timeIndex + 1)
		.filter(
			(line) =>
				!/^\d{1,3}[,.]\d{1,3}$/.test(line) &&
				!/^(1|x|2|empate|draw)$/i.test(line),
		)
		.join(" ")
		.trim();
	if (
		!homeTeam ||
		!awayTeam ||
		homeTeam.toLowerCase() === awayTeam.toLowerCase()
	) {
		return null;
	}
	return [homeTeam, awayTeam];
}

async function getDateHeaderForRow(
	row: Locator,
): Promise<string> {
	const headerPattern =
		/^(hoje|amanh[aã]|(?:seg(?:unda)?|ter(?:ça)?|qua(?:rta)?|qui(?:nta)?|sex(?:ta)?|s[aá]b(?:ado)?|dom(?:ingo)?)(?:\s+\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?)?|\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?)$/i;
	let current = row;
	for (let depth = 0; depth < 6; depth += 1) {
		const siblings = current.locator("xpath=preceding-sibling::*");
		for (let index = (await siblings.count()) - 1; index >= 0; index -= 1) {
			const text = (await siblings.nth(index).innerText())
				.replace(/\s+/g, " ")
				.trim();
			if (headerPattern.test(text)) return text;
		}
		const parent = current.locator("xpath=..");
		if ((await parent.count()) === 0) break;
		current = parent;
	}
	return new Date().toLocaleDateString("pt-PT");
}

async function scrapeRenderedMatches(page: Page): Promise<ScrapedMatch[]> {
	await page.goto(BETCLIC_URL, {
		waitUntil: "domcontentloaded",
		timeout: 30_000,
		referer: "https://www.betclic.pt/",
	});
	await page.waitForTimeout(2_500);
	await handleCookieConsent(page);
	await page.waitForSelector("bcdk-bet-button-odds-animated", {
		state: "visible",
		timeout: 15_000,
	});

	const matches = new Map<string, ScrapedMatch>();
	let previousHeight = 0;
	let unchangedHeightAttempts = 0;

	for (let step = 0; step < 120; step += 1) {
		const oddsElements = page.locator("bcdk-bet-button-odds-animated");
		const oddsCount = await oddsElements.count();
		const processedRows = new Set<string>();

		for (let index = 0; index < oddsCount; index += 1) {
			const oddsElement = oddsElements.nth(index);
			if (!(await oddsElement.isVisible().catch(() => false))) continue;

			let row = oddsElement.locator("xpath=..");
			let matchRow: typeof row | null = null;
			for (let depth = 0; depth < 10; depth += 1) {
				const rowOddsCount = await row
					.locator("bcdk-bet-button-odds-animated")
					.count();
				const hasEventBlock = (await row.locator("div.event").count()) > 0;
				if (rowOddsCount === 3 && hasEventBlock) {
					matchRow = row;
					break;
				}
				const parent = row.locator("xpath=..");
				if ((await parent.count()) === 0) break;
				row = parent;
			}
			if (!matchRow) continue;

			const rowText = (await matchRow.innerText()).replace(/\s+/g, " ").trim();
			if (processedRows.has(rowText)) continue;
			processedRows.add(rowText);

			const rowOdds = matchRow.locator("bcdk-bet-button-odds-animated");
			const odds: number[] = [];
			for (let oddIndex = 0; oddIndex < 3; oddIndex += 1) {
				const rawOdd = (await rowOdds.nth(oddIndex).innerText()).trim();
				const odd = Number(rawOdd.replace(",", "."));
				if (!Number.isFinite(odd) || odd <= 1) {
					odds.length = 0;
					break;
				}
				odds.push(odd);
			}
			if (odds.length !== 3) continue;

			const names = await getRowTeamNames(matchRow);
			if (!names) continue;
			const eventBlock = matchRow.locator("div.event").first();
			const timeText = (await eventBlock.innerText()).match(
				/\b\d{1,2}:\d{2}\b/,
			)?.[0];
			if (!timeText) continue;

			const dateHeader = await getDateHeaderForRow(matchRow);
			const startTime = parseEventStartTime(dateHeader, timeText);
			if (!Number.isFinite(startTime.getTime())) continue;

			const match: ScrapedMatch = {
				homeTeam: normalizeTeamName(names[0], "PRIMEIRA_LIGA"),
				awayTeam: normalizeTeamName(names[1], "PRIMEIRA_LIGA"),
				startTime,
				odds: { home: odds[0], draw: odds[1], away: odds[2] },
			};
			const key = `${match.homeTeam}|${match.awayTeam}|${startTime.toISOString()}`;
			matches.set(key, match);
		}

		const pageState = (await page.evaluate(
			"({ height: document.documentElement.scrollHeight, atBottom: window.scrollY + window.innerHeight >= document.documentElement.scrollHeight })",
		)) as { height: number; atBottom: boolean };
		if (pageState.height === previousHeight) {
			unchangedHeightAttempts += 1;
		} else {
			unchangedHeightAttempts = 0;
		}
		previousHeight = pageState.height;

		if (pageState.atBottom && unchangedHeightAttempts >= 3) break;
		await page.mouse.wheel(0, 600);
		await page.waitForTimeout(500);
	}

	return Array.from(matches.values());
}

async function persistMarketOdds(
	matchId: string,
	odds: BetclicOdds,
	probabilities: { homeProb: number; drawProb: number; awayProb: number },
): Promise<void> {
	const data = {
		homeOdd: odds.home,
		drawOdd: odds.draw,
		awayOdd: odds.away,
		expectedValueHome: calculateExpectedValue(
			odds.home,
			probabilities.homeProb,
		).expectedValue,
		expectedValueDraw: calculateExpectedValue(
			odds.draw,
			probabilities.drawProb,
		).expectedValue,
		expectedValueAway: calculateExpectedValue(
			odds.away,
			probabilities.awayProb,
		).expectedValue,
	};
	const existing = await prisma.marketOdd.findFirst({
		where: { matchId, bookmaker: { in: [BOOKMAKER, "Betclic"] } },
		select: { id: true },
	});

	if (existing) {
		await prisma.marketOdd.update({
			where: { id: existing.id },
			data: { ...data, bookmaker: BOOKMAKER },
		});
	} else {
		await prisma.marketOdd.create({
			data: { ...data, matchId, bookmaker: BOOKMAKER },
		});
	}
}

export async function scrapeBetclicOdds(): Promise<BetclicScrapeSummary> {
	const errors: string[] = [];
	let browser: Browser | undefined;

	try {
		console.info("[BETCLIC] A abrir a página da Primeira Liga.");
		browser = await chromium.launch({
			headless: true,
			args: [
				"--disable-blink-features=AutomationControlled",
				"--no-sandbox",
				"--disable-setuid-sandbox",
			],
		});
		const context = await browser.newContext({
			userAgent:
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
			locale: "pt-PT",
			viewport: { width: 1920, height: 1080 },
		});
		const page = await context.newPage();
		page.setDefaultTimeout(8_000);
		await page.addInitScript(() => {
			Object.defineProperty(navigator, "webdriver", {
				get: () => undefined,
			});
		});
		const matches = await scrapeRenderedMatches(page);

		if (matches.length === 0) {
			return {
				success: false,
				matchesProcessed: 0,
				errors: ["Não foram encontrados jogos completos no DOM da Betclic."],
			};
		}

		let matchesProcessed = 0;
		for (const scrapedMatch of matches) {
			const { homeTeam, awayTeam, startTime, odds } = scrapedMatch;
			if (startTime.getTime() <= Date.now()) {
				continue;
			}

			console.log(
				`[BETCLIC] ${homeTeam} vs ${awayTeam} -> 1:${odds.home} | X: ${odds.draw} | 2:${odds.away}`,
			);

			try {
				const homeTeamRecord = await resolveTeam(homeTeam, LEAGUE);
				const awayTeamRecord = await resolveTeam(awayTeam, LEAGUE);
				const probabilities = calculateMatchProbabilities(
					(homeTeamRecord.homeGoalsAvg + awayTeamRecord.awayConcededAvg) / 2,
					(awayTeamRecord.awayGoalsAvg + homeTeamRecord.homeConcededAvg) / 2,
				);
				const resolved = await resolveMatch({
					homeTeamName: homeTeam,
					awayTeamName: awayTeam,
					league: LEAGUE,
					date: startTime,
					probabilities,
					preserveExistingProbabilities: true,
				});
				await persistMarketOdds(
					resolved.matchId,
					odds,
					resolved.probabilities,
				);
				matchesProcessed += 1;
				console.info(`[BETCLIC] Sincronizado: ${homeTeam} vs ${awayTeam}.`);
			} catch (error) {
				errors.push(
					`${homeTeam} vs ${awayTeam}: falha ao guardar os dados: ${getErrorMessage(error)}`,
				);
			}
		}

		console.info(`[BETCLIC] Jogos sincronizados: ${matchesProcessed}.`);
		return { success: errors.length === 0, matchesProcessed, errors };
	} catch (error) {
		const message = `Falha ao recolher dados da Betclic: ${getErrorMessage(error)}`;
		console.error(`[BETCLIC] ${message}`);
		return { success: false, matchesProcessed: 0, errors: [message] };
	} finally {
		if (browser) {
			await browser.close();
		}
	}
}

if (require.main === module || process.argv[1]?.includes("betclicScraper")) {
	scrapeBetclicOdds()
		.then((result) => {
			console.log("\n--- Resultado Betclic ---");
			console.log(`Sucesso: ${result.success}`);
			console.log(`Jogos Processados: ${result.matchesProcessed}`);
			if (result.errors.length > 0) {
				console.warn("Avisos/Erros:", result.errors);
			}
		})
		.catch((error: unknown) => {
			console.error("[BETCLIC] Erro fatal:", error);
			process.exitCode = 1;
		});
}
