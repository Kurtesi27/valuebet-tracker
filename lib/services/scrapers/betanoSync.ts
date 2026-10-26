import { prisma } from "@/lib/db";
import { calculateExpectedValue, devigOdds } from "@/lib/math/bettingEngine";
import {
	scrapeBetanoPrimeiraLiga,
	type ScrapedMatch,
} from "@/lib/services/scrapers/betanoScraper";
import { resolveMatch } from "@/lib/services/matchResolver";
import { normalizeTeamName } from "@/lib/normalizeTeam";

type MatchProbabilities = {
	homeProb: number;
	drawProb: number;
	awayProb: number;
};

async function persistMatch(
	scrapedMatch: ScrapedMatch,
	probabilities: MatchProbabilities,
): ReturnType<typeof resolveMatch> {
	return resolveMatch({
		homeTeamName: normalizeTeamName(
			scrapedMatch.homeTeam,
			"PRIMEIRA_LIGA",
		),
		awayTeamName: normalizeTeamName(
			scrapedMatch.awayTeam,
			"PRIMEIRA_LIGA",
		),
		league: scrapedMatch.league,
		date: scrapedMatch.startTime,
		probabilities,
		preserveExistingProbabilities: true,
	});
}

async function upsertBetanoMarketOdd(
	matchId: string,
	scrapedMatch: ScrapedMatch,
	probabilities: MatchProbabilities,
): Promise<void> {
	const data = {
		homeOdd: scrapedMatch.odds.home,
		drawOdd: scrapedMatch.odds.draw,
		awayOdd: scrapedMatch.odds.away,
		expectedValueHome: calculateExpectedValue(
			scrapedMatch.odds.home,
			probabilities.homeProb,
		).expectedValue,
		expectedValueDraw: calculateExpectedValue(
			scrapedMatch.odds.draw,
			probabilities.drawProb,
		).expectedValue,
		expectedValueAway: calculateExpectedValue(
			scrapedMatch.odds.away,
			probabilities.awayProb,
		).expectedValue,
	};
	const existing = await prisma.marketOdd.findMany({
		where: { matchId, bookmaker: { in: ["BETANO", "Betano"] } },
		select: { id: true },
		orderBy: { updatedAt: "desc" },
	});

	const keeper = existing[0];
	await prisma.$transaction(async (transaction) => {
		if (keeper) {
			await transaction.marketOdd.update({
				where: { id: keeper.id },
				data: { ...data, bookmaker: "BETANO" },
			});
			const duplicateIds = existing.slice(1).map((odd) => odd.id);
			if (duplicateIds.length > 0) {
				await transaction.marketOdd.deleteMany({
					where: { id: { in: duplicateIds } },
				});
			}
		} else {
			await transaction.marketOdd.create({
				data: { ...data, matchId, bookmaker: "BETANO" },
			});
		}
	});
}

function validateScrapedMatch(match: ScrapedMatch): string | null {
	if (!match.homeTeam.trim() || !match.awayTeam.trim() || !match.league.trim()) {
		return "Nomes das equipas ou liga em falta.";
	}
	if (
		!(match.startTime instanceof Date) ||
		!Number.isFinite(match.startTime.getTime())
	) {
		return "Data de início inválida.";
	}
	if (
		![match.odds.home, match.odds.draw, match.odds.away].every(
			(odd) => Number.isFinite(odd) && odd > 1,
		)
	) {
		return "Odds 1X2 inválidas.";
	}
	return null;
}

export type BetanoSyncSummary = {
	success: boolean;
	matchesProcessed: number;
	errors: string[];
};

export async function syncBetanoMatches(): Promise<BetanoSyncSummary> {
	const errors: string[] = [];
	let scrapedMatches: ScrapedMatch[];

	try {
		scrapedMatches = await scrapeBetanoPrimeiraLiga();
	} catch (error) {
		return {
			success: false,
			matchesProcessed: 0,
			errors: [
				error instanceof Error
					? `Falha ao recolher jogos da Betano: ${error.message}`
					: "Falha desconhecida ao recolher jogos da Betano.",
			],
		};
	}

	if (scrapedMatches.length === 0) {
		return {
			success: false,
			matchesProcessed: 0,
			errors: ["O scraper da Betano não devolveu jogos."],
		};
	}

	let matchesProcessed = 0;
	for (const scrapedMatch of scrapedMatches) {
		const normalizedMatch: ScrapedMatch = {
			...scrapedMatch,
			bookmaker: "BETANO",
			homeTeam: normalizeTeamName(
				scrapedMatch.homeTeam,
				"PRIMEIRA_LIGA",
			),
			awayTeam: normalizeTeamName(
				scrapedMatch.awayTeam,
				"PRIMEIRA_LIGA",
			),
		};
		if (normalizedMatch.startTime.getTime() <= Date.now()) {
			continue;
		}

		const validationError = validateScrapedMatch(normalizedMatch);
		if (validationError) {
			errors.push(
				`${normalizedMatch.homeTeam || "Casa"} vs ${normalizedMatch.awayTeam || "Fora"}: ${validationError}`,
			);
			continue;
		}

		try {
			const fair = devigOdds(
				normalizedMatch.odds.home,
				normalizedMatch.odds.draw,
				normalizedMatch.odds.away,
			);
			const scrapedProbabilities: MatchProbabilities = {
				homeProb: fair.fairHomeProb,
				drawProb: fair.fairDrawProb,
				awayProb: fair.fairAwayProb,
			};
			const resolved = await persistMatch(
				normalizedMatch,
				scrapedProbabilities,
			);
			await upsertBetanoMarketOdd(
				resolved.matchId,
				normalizedMatch,
				resolved.probabilities,
			);
			matchesProcessed += 1;
		} catch (error) {
			errors.push(
				`${normalizedMatch.homeTeam} vs ${normalizedMatch.awayTeam}: ${error instanceof Error ? error.message : "Erro desconhecido na persistência."}`,
			);
		}
	}

	return {
		success: errors.length === 0,
		matchesProcessed,
		errors,
	};
}