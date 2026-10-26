import axios from "axios";
import { prisma } from "@/lib/db";
import {
	calculateExpectedValue,
	devigOdds,
	type MatchProbabilities,
} from "@/lib/math/bettingEngine";
import { resolveMatch } from "@/lib/services/matchResolver";

const DEFAULT_SPORT_KEY = "soccer_portugal_primeira_liga";
const FALLBACK_SPORT_KEY = "soccer_epl";
const ALLOWED_BOOKMAKERS = ["Betclic", "Betclic (FR)", "Betano"] as const;

type OddsApiOutcome = {
	name: string;
	price: number;
};

type OddsApiMarket = {
	key: string;
	outcomes: OddsApiOutcome[];
};

type OddsApiBookmaker = {
	key?: string;
	title?: string;
	markets?: OddsApiMarket[];
};

type OddsApiEvent = {
	commence_time: string;
	home_team: string;
	away_team: string;
	sport_title?: string;
	bookmakers?: OddsApiBookmaker[];
};

type MarketOdds = {
	homeOdd: number;
	drawOdd: number;
	awayOdd: number;
};

export type MarketConsensusSource = "PINNACLE" | "CONSENSUS";

export type MarketConsensus = {
	fairHomeProb: number;
	fairDrawProb: number;
	fairAwayProb: number;
	source: MarketConsensusSource;
};

export type OddsSyncSummary = {
	syncedMatches: number;
	errorCount: number;
	errors: string[];
};

function errorMessage(error: unknown): string {
	if (axios.isAxiosError(error)) {
		const apiMessage = error.response?.data?.message;
		return typeof apiMessage === "string" ? apiMessage : error.message;
	}

	return error instanceof Error ? error.message : "Unknown error";
}

async function fetchOddsForSport(
	sportKey: string,
	apiKey: string,
): Promise<OddsApiEvent[]> {
	const response = await axios.get<OddsApiEvent[]>(
		`https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportKey)}/odds/`,
		{
			params: {
				apiKey,
				regions: "eu",
				markets: "h2h",
				oddsFormat: "decimal",
			},
			timeout: 15_000,
		},
	);

	if (!Array.isArray(response.data)) {
		throw new Error("A The Odds API devolveu uma resposta inválida.");
	}

	return response.data;
}

async function fetchOddsWithFallback(
	sportKey: string,
	apiKey: string,
	errors: string[],
): Promise<{ events: OddsApiEvent[]; resolvedSportKey: string }> {
	let events: OddsApiEvent[];
	let resolvedSportKey = sportKey;

	try {
		events = await fetchOddsForSport(sportKey, apiKey);
	} catch (error) {
		if (sportKey === FALLBACK_SPORT_KEY) {
			throw error;
		}

		errors.push(`Falha ao consultar ${sportKey}: ${errorMessage(error)}`);
		resolvedSportKey = FALLBACK_SPORT_KEY;
		events = await fetchOddsForSport(FALLBACK_SPORT_KEY, apiKey);
	}

	if (events.length === 0 && resolvedSportKey !== FALLBACK_SPORT_KEY) {
		errors.push(
			`Sem jogos disponíveis para ${resolvedSportKey}; a tentar ${FALLBACK_SPORT_KEY}.`,
		);
		resolvedSportKey = FALLBACK_SPORT_KEY;
		events = await fetchOddsForSport(FALLBACK_SPORT_KEY, apiKey);
	}

	return { events, resolvedSportKey };
}

function getMarketOdds(
	bookmaker: OddsApiBookmaker,
	homeTeamName: string,
	awayTeamName: string,
): MarketOdds | null {
	const market = bookmaker.markets?.find(({ key }) => key === "h2h");
	if (!market) {
		return null;
	}

	const normalizeName = (name: string) => name.trim().toLocaleLowerCase("en");
	const homeOutcome = market.outcomes.find(
		({ name }) => normalizeName(name) === normalizeName(homeTeamName),
	);
	const awayOutcome = market.outcomes.find(
		({ name }) => normalizeName(name) === normalizeName(awayTeamName),
	);
	const drawOutcome = market.outcomes.find(
		({ name }) => normalizeName(name) === "draw",
	);

	if (
		!homeOutcome ||
		!drawOutcome ||
		!awayOutcome ||
		![homeOutcome.price, drawOutcome.price, awayOutcome.price].every(
			(price) => Number.isFinite(price) && price > 1,
		)
	) {
		return null;
	}

	return {
		homeOdd: homeOutcome.price,
		drawOdd: drawOutcome.price,
		awayOdd: awayOutcome.price,
	};
}

function getAllowedBookmakerName(
	bookmaker: OddsApiBookmaker,
): "Betclic" | "Betano" | null {
	const names = [bookmaker.title, bookmaker.key]
		.filter((name): name is string => Boolean(name))
		.map((name) => name.trim().toLocaleLowerCase("en"));
	const allowedName = ALLOWED_BOOKMAKERS.find((name) =>
		names.includes(name.toLocaleLowerCase("en")),
	);

	if (!allowedName) {
		return null;
	}

	return allowedName === "Betclic (FR)" ? "Betclic" : allowedName;
}

export function calculateMarketConsensus(
	bookmakers: readonly OddsApiBookmaker[],
	homeTeamName: string,
	awayTeamName: string,
): MarketConsensus | null {
	const pinnacle = bookmakers.find(({ key, title }) =>
		`${key ?? ""} ${title ?? ""}`.toLocaleLowerCase("en").includes("pinnacle"),
	);
	const pinnacleOdds = pinnacle
		? getMarketOdds(pinnacle, homeTeamName, awayTeamName)
		: null;
	let selectedOdds: MarketOdds;
	let source: MarketConsensusSource;

	if (pinnacleOdds) {
		selectedOdds = pinnacleOdds;
		source = "PINNACLE";
	} else {
		const availableOdds = bookmakers.flatMap((bookmaker) => {
			const odds = getMarketOdds(bookmaker, homeTeamName, awayTeamName);
			return odds ? [odds] : [];
		});
		if (availableOdds.length === 0) {
			return null;
		}

		const totals = availableOdds.reduce(
			(sum, odds) => ({
				homeOdd: sum.homeOdd + odds.homeOdd,
				drawOdd: sum.drawOdd + odds.drawOdd,
				awayOdd: sum.awayOdd + odds.awayOdd,
			}),
			{ homeOdd: 0, drawOdd: 0, awayOdd: 0 },
		);
		selectedOdds = {
			homeOdd: totals.homeOdd / availableOdds.length,
			drawOdd: totals.drawOdd / availableOdds.length,
			awayOdd: totals.awayOdd / availableOdds.length,
		};
		source = "CONSENSUS";
	}

	const fair = devigOdds(
		selectedOdds.homeOdd,
		selectedOdds.drawOdd,
		selectedOdds.awayOdd,
	);
	const probabilities = [
		fair.fairHomeProb,
		fair.fairDrawProb,
		fair.fairAwayProb,
	];
	if (
		!probabilities.every(
			(probability) => Number.isFinite(probability) && probability > 0,
		)
	) {
		return null;
	}

	return {
		fairHomeProb: fair.fairHomeProb,
		fairDrawProb: fair.fairDrawProb,
		fairAwayProb: fair.fairAwayProb,
		source,
	};
}

async function syncMarketOdd(
	matchId: string,
	bookmaker: string,
	odds: MarketOdds,
	probabilities: MatchProbabilities,
): Promise<void> {
	const data = {
		...odds,
		expectedValueHome: calculateExpectedValue(
			odds.homeOdd,
			probabilities.homeProb,
		).expectedValue,
		expectedValueDraw: calculateExpectedValue(
			odds.drawOdd,
			probabilities.drawProb,
		).expectedValue,
		expectedValueAway: calculateExpectedValue(
			odds.awayOdd,
			probabilities.awayProb,
		).expectedValue,
	};
	const existing = await prisma.marketOdd.findFirst({
		where: { matchId, bookmaker },
		select: { id: true },
	});

	if (existing) {
		await prisma.marketOdd.update({
			where: { id: existing.id },
			data,
		});
	} else {
		await prisma.marketOdd.create({
			data: { ...data, bookmaker, matchId },
		});
	}
}

export async function fetchAndSyncOdds(
	sportKey = DEFAULT_SPORT_KEY,
): Promise<OddsSyncSummary> {
	const summary: OddsSyncSummary = {
		syncedMatches: 0,
		errorCount: 0,
		errors: [],
	};
	const apiKey = process.env.ODDS_API_KEY;

	if (!apiKey) {
		summary.errors.push("A variável de ambiente ODDS_API_KEY não está definida.");
		summary.errorCount = summary.errors.length;
		return summary;
	}

	let events: OddsApiEvent[];
	let resolvedSportKey: string;
	try {
		({ events, resolvedSportKey } = await fetchOddsWithFallback(
			sportKey,
			apiKey,
			summary.errors,
		));
	} catch (error) {
		summary.errors.push(
			`Falha ao obter odds de ${sportKey} ou do fallback ${FALLBACK_SPORT_KEY}: ${errorMessage(error)}`,
		);
		summary.errorCount = summary.errors.length;
		return summary;
	}

	if (events.length === 0) {
		summary.errors.push(`A API não devolveu jogos para ${resolvedSportKey}.`);
		summary.errorCount = summary.errors.length;
		return summary;
	}

	for (const event of events) {
		try {
			if (!event.home_team || !event.away_team) {
				throw new Error("O evento não inclui os nomes das duas equipas.");
			}

			const commenceTime = new Date(event.commence_time);
			if (!Number.isFinite(commenceTime.getTime())) {
				throw new Error("O evento tem uma data de início inválida.");
			}

			const consensus = calculateMarketConsensus(
				event.bookmakers ?? [],
				event.home_team,
				event.away_team,
			);
			if (!consensus) {
				summary.errors.push(
					`${event.home_team} vs ${event.away_team}: nenhuma odd 1X2 válida para calcular consenso.`,
				);
				continue;
			}

			const probabilities: MatchProbabilities = {
				homeProb: consensus.fairHomeProb,
				drawProb: consensus.fairDrawProb,
				awayProb: consensus.fairAwayProb,
			};
			const league = event.sport_title?.trim() || resolvedSportKey;
			const resolvedMatch = await resolveMatch({
				homeTeamName: event.home_team,
				awayTeamName: event.away_team,
				league,
				date: commenceTime,
				probabilities,
			});

			for (const bookmaker of event.bookmakers ?? []) {
				const storedBookmaker = getAllowedBookmakerName(bookmaker);
				if (!storedBookmaker) {
					continue;
				}

				const odds = getMarketOdds(
					bookmaker,
					event.home_team,
					event.away_team,
				);
				if (!odds) {
					continue;
				}

				try {
					await syncMarketOdd(
						resolvedMatch.matchId,
						storedBookmaker,
						odds,
						probabilities,
					);
				} catch (error) {
					summary.errors.push(
						`${event.home_team} vs ${event.away_team}, ${bookmaker.title || bookmaker.key || "Unknown bookmaker"}: ${errorMessage(error)}`,
					);
				}
			}

			summary.syncedMatches += 1;
		} catch (error) {
			summary.errors.push(
				`${event.home_team || "Equipa desconhecida"} vs ${event.away_team || "Equipa desconhecida"}: ${errorMessage(error)}`,
			);
		}
	}

	summary.errorCount = summary.errors.length;
	return summary;
}