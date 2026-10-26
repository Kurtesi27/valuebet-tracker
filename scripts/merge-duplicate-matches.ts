import { prisma } from "@/lib/db";
import { normalizeTeamName } from "@/lib/services/matchResolver";

const MATCH_TIME_TOLERANCE_MS = 18 * 60 * 60 * 1000;
const applyChanges = process.argv.includes("--apply");

async function loadMatches() {
	return prisma.match.findMany({
		include: {
			homeTeam: true,
			awayTeam: true,
			odds: true,
			bets: true,
		},
		orderBy: { createdAt: "asc" },
	});
}

type MatchRecord = Awaited<ReturnType<typeof loadMatches>>[number];

function normalizeLeague(league: string): string {
	return normalizeTeamName(league)
		.replace(/\bportugal\b/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function isSameFixture(first: MatchRecord, second: MatchRecord): boolean {
	const sameTeams =
		normalizeTeamName(first.homeTeam.name) ===
			normalizeTeamName(second.homeTeam.name) &&
		normalizeTeamName(first.awayTeam.name) ===
			normalizeTeamName(second.awayTeam.name);
	const sameLeague =
		normalizeLeague(first.league) === normalizeLeague(second.league);
	const closeInTime =
		Math.abs(first.date.getTime() - second.date.getTime()) <=
		MATCH_TIME_TOLERANCE_MS;

	return sameTeams && sameLeague && closeInTime;
}

function findDuplicateGroups(matches: MatchRecord[]): MatchRecord[][] {
	const groups: MatchRecord[][] = [];

	for (const match of matches) {
		const group = groups.find((candidateGroup) =>
			candidateGroup.some((candidate) => isSameFixture(candidate, match)),
		);
		if (group) {
			group.push(match);
		} else {
			groups.push([match]);
		}
	}

	return groups.filter((group) => group.length > 1);
}

function canonicalScore(match: MatchRecord): number {
	const distinctBookmakers = new Set(match.odds.map((odd) => odd.bookmaker)).size;
	return distinctBookmakers * 10 + match.bets.length * 3;
}

function chooseCanonical(group: MatchRecord[]): MatchRecord {
	return [...group].sort(
		(first, second) =>
			canonicalScore(second) - canonicalScore(first) ||
			first.createdAt.getTime() - second.createdAt.getTime(),
	)[0];
}

async function mergeGroup(group: MatchRecord[]): Promise<number> {
	const canonical = chooseCanonical(group);
	let oddsMoved = 0;

	await prisma.$transaction(async (transaction) => {
		for (const duplicate of group) {
			if (duplicate.id === canonical.id) {
				continue;
			}

			for (const duplicateOdd of duplicate.odds) {
				const canonicalOdd = await transaction.marketOdd.findFirst({
					where: {
						matchId: canonical.id,
						bookmaker: duplicateOdd.bookmaker,
					},
				});

				if (!canonicalOdd) {
					await transaction.marketOdd.update({
						where: { id: duplicateOdd.id },
						data: { matchId: canonical.id },
					});
					oddsMoved += 1;
					continue;
				}

				if (duplicateOdd.updatedAt > canonicalOdd.updatedAt) {
					await transaction.marketOdd.update({
						where: { id: canonicalOdd.id },
						data: {
							homeOdd: duplicateOdd.homeOdd,
							drawOdd: duplicateOdd.drawOdd,
							awayOdd: duplicateOdd.awayOdd,
							expectedValueHome: duplicateOdd.expectedValueHome,
							expectedValueDraw: duplicateOdd.expectedValueDraw,
							expectedValueAway: duplicateOdd.expectedValueAway,
						},
					});
				}

				await transaction.marketOdd.delete({
					where: { id: duplicateOdd.id },
				});
			}

			await transaction.betLog.updateMany({
				where: { matchId: duplicate.id },
				data: { matchId: canonical.id },
			});
			await transaction.match.delete({ where: { id: duplicate.id } });
		}
	});

	return oddsMoved;
}

async function main(): Promise<void> {
	try {
		const matches = await loadMatches();
		const duplicateGroups = findDuplicateGroups(matches);
		const plan = duplicateGroups.map((group) => {
			const canonical = chooseCanonical(group);
			return {
				canonicalId: canonical.id,
				fixture: `${canonical.homeTeam.name} vs ${canonical.awayTeam.name}`,
				date: canonical.date.toISOString(),
				duplicateIds: group
					.filter((match) => match.id !== canonical.id)
					.map((match) => match.id),
				bookmakers: [
					...new Set(group.flatMap((match) => match.odds.map((odd) => odd.bookmaker))),
				],
			};
		});

		if (!applyChanges) {
			console.log("Dry-run: nenhuma alteração foi feita.");
			console.log(JSON.stringify({ groupsFound: plan.length, groups: plan }, null, 2));
			console.log("Executa com --apply para fundir estes registos.");
			return;
		}

		let matchesRemoved = 0;
		let oddsMoved = 0;
		for (const group of duplicateGroups) {
			oddsMoved += await mergeGroup(group);
			matchesRemoved += group.length - 1;
		}

		console.log(
			JSON.stringify(
				{
					groupsMerged: duplicateGroups.length,
					matchesRemoved,
					oddsMoved,
				},
				null,
				2,
			),
		);
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error: unknown) => {
	console.error("Falha ao fundir jogos duplicados:", error);
	process.exitCode = 1;
});