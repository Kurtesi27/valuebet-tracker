import { prisma } from "@/lib/db";
import { normalizeTeamName as normalizeLeagueTeamName } from "@/lib/normalizeTeam";

const MATCH_TIME_TOLERANCE_MS = 18 * 60 * 60 * 1000;
const TEAM_SUFFIX_TOKENS = new Set([
	"fc",
	"sc",
	"ac",
	"cf",
	"sad",
	"f",
	"c",
	"s",
	"a",
	"d",
]);
const DEFAULT_TEAM_AVERAGES = {
	homeGoalsAvg: 1.4,
	awayGoalsAvg: 1.1,
	homeConcededAvg: 1.1,
	awayConcededAvg: 1.4,
};

export type MatchProbabilities = {
	homeProb: number;
	drawProb: number;
	awayProb: number;
};

export type ResolveMatchInput = {
	homeTeamName: string;
	awayTeamName: string;
	league: string;
	date: Date;
	probabilities: MatchProbabilities;
	preserveExistingProbabilities?: boolean;
};

export type ResolveMatchResult = {
	matchId: string;
	probabilities: MatchProbabilities;
	created: boolean;
};

export function normalizeTeamName(name: string): string {
	return name
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLocaleLowerCase("pt-PT")
		.split(/[^a-z0-9]+/)
		.filter((token) => token && !TEAM_SUFFIX_TOKENS.has(token))
		.join(" ");
}

function getLeagueCode(league: string): string {
	return league
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toUpperCase()
		.trim()
		.replace(/[^A-Z0-9]+/g, "_");
}

function normalizeTeamNameForLeague(name: string, league: string): string {
	return normalizeTeamName(normalizeLeagueTeamName(name, getLeagueCode(league)));
}

function hasValidProbabilities(match: {
	estimatedProbHome: number;
	estimatedProbDraw: number;
	estimatedProbAway: number;
}): boolean {
	const values = [
		match.estimatedProbHome,
		match.estimatedProbDraw,
		match.estimatedProbAway,
	];
	const total = values.reduce((sum, value) => sum + value, 0);

	return (
		values.every(
			(value) => Number.isFinite(value) && value > 0 && value <= 1,
		) && Math.abs(total - 1) < 0.01
	);
}

async function findMatchingMatch(input: ResolveMatchInput) {
	const candidates = await prisma.match.findMany({
		where: {
			date: {
				gte: new Date(input.date.getTime() - MATCH_TIME_TOLERANCE_MS),
				lte: new Date(input.date.getTime() + MATCH_TIME_TOLERANCE_MS),
			},
		},
		include: { homeTeam: true, awayTeam: true },
	});
	const normalizedHome = normalizeTeamNameForLeague(
		input.homeTeamName,
		input.league,
	);
	const normalizedAway = normalizeTeamNameForLeague(
		input.awayTeamName,
		input.league,
	);

	return (
		candidates
			.filter(
				(match) =>
					normalizeTeamNameForLeague(match.homeTeam.name, input.league) ===
						normalizedHome &&
					normalizeTeamNameForLeague(match.awayTeam.name, input.league) ===
						normalizedAway,
			)
			.sort(
				(first, second) =>
					Math.abs(first.date.getTime() - input.date.getTime()) -
					Math.abs(second.date.getTime() - input.date.getTime()),
			)[0] ?? null
	);
}

export async function resolveTeam(name: string, league: string) {
	const leagueCode = getLeagueCode(league);
	const canonicalName = normalizeLeagueTeamName(name, leagueCode);
	const normalizedName = normalizeTeamName(canonicalName);
	const teams = await prisma.team.findMany();
	const existing = teams.find(
		(team) =>
			normalizeTeamNameForLeague(team.name, league) === normalizedName,
	);

	if (existing) {
		return existing;
	}

	return prisma.team.upsert({
		where: { name: canonicalName },
		update: { league },
		create: { name: canonicalName, league, ...DEFAULT_TEAM_AVERAGES },
	});
}

export async function resolveMatch(
	input: ResolveMatchInput,
): Promise<ResolveMatchResult> {
	if (!Number.isFinite(input.date.getTime())) {
		throw new Error("A data do jogo é inválida.");
	}

	const existing = await findMatchingMatch(input);
	if (existing) {
		const useExistingProbabilities =
			input.preserveExistingProbabilities && hasValidProbabilities(existing);
		const probabilities = useExistingProbabilities
			? {
					homeProb: existing.estimatedProbHome,
					drawProb: existing.estimatedProbDraw,
					awayProb: existing.estimatedProbAway,
				}
			: input.probabilities;

		await prisma.match.update({
			where: { id: existing.id },
			data: {
				date: input.date,
				league: input.league,
				estimatedProbHome: probabilities.homeProb,
				estimatedProbDraw: probabilities.drawProb,
				estimatedProbAway: probabilities.awayProb,
			},
		});

		return { matchId: existing.id, probabilities, created: false };
	}

	const homeTeam = await resolveTeam(input.homeTeamName, input.league);
	const awayTeam = await resolveTeam(input.awayTeamName, input.league);
	const match = await prisma.match.create({
		data: {
			date: input.date,
			league: input.league,
			homeTeamId: homeTeam.id,
			awayTeamId: awayTeam.id,
			estimatedProbHome: input.probabilities.homeProb,
			estimatedProbDraw: input.probabilities.drawProb,
			estimatedProbAway: input.probabilities.awayProb,
		},
	});

	return {
		matchId: match.id,
		probabilities: input.probabilities,
		created: true,
	};
}