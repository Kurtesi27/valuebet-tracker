import { prisma } from "@/lib/db";
import { normalizeTeamName } from "@/lib/normalizeTeam";

type ConsolidationResult = {
	teamsMerged: number;
	matchesMerged: number;
};

function teamKey(name: string): string {
	return name
		.trim()
		.replace(/\s+/g, " ")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLocaleLowerCase("pt-PT");
}

function matchDayKey(date: Date): string {
	return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}

export async function forceConsolidateTeams(): Promise<ConsolidationResult> {
	return prisma.$transaction(async (transaction) => {
		const teams = await transaction.team.findMany({
			orderBy: { name: "asc" },
			select: { id: true, name: true },
		});
		const teamsByCanonicalName = new Map<string, typeof teams>();

		for (const team of teams) {
			const canonicalName = normalizeTeamName(team.name, "PRIMEIRA_LIGA");
			const key = teamKey(canonicalName);
			const group = teamsByCanonicalName.get(key) ?? [];
			group.push(team);
			teamsByCanonicalName.set(key, group);
		}

		let teamsMerged = 0;
		for (const group of teamsByCanonicalName.values()) {
			const canonicalName = normalizeTeamName(
				group[0].name,
				"PRIMEIRA_LIGA",
			);
			const keeper =
				group.find((team) => team.name.trim() === canonicalName) ?? group[0];
			const duplicateIds = group
				.filter((team) => team.id !== keeper.id)
				.map((team) => team.id);

			if (duplicateIds.length === 0 && keeper.name !== canonicalName) {
				await transaction.team.update({
					where: { id: keeper.id },
					data: { name: canonicalName },
				});
				continue;
			}
			if (duplicateIds.length === 0) continue;

			await transaction.match.updateMany({
				where: { homeTeamId: { in: duplicateIds } },
				data: { homeTeamId: keeper.id },
			});
			await transaction.match.updateMany({
				where: { awayTeamId: { in: duplicateIds } },
				data: { awayTeamId: keeper.id },
			});
			await transaction.team.deleteMany({
				where: { id: { in: duplicateIds } },
			});
			if (keeper.name !== canonicalName) {
				await transaction.team.update({
					where: { id: keeper.id },
					data: { name: canonicalName },
				});
			}
			teamsMerged += duplicateIds.length;
		}

		const matches = await transaction.match.findMany({
			include: {
				odds: true,
				bets: { select: { id: true } },
			},
			orderBy: [{ date: "asc" }, { createdAt: "asc" }],
		});
		const fixtures = new Map<string, typeof matches>();

		for (const match of matches) {
			const key = `${match.homeTeamId}|${match.awayTeamId}|${matchDayKey(match.date)}`;
			const group = fixtures.get(key) ?? [];
			group.push(match);
			fixtures.set(key, group);
		}

		let matchesMerged = 0;
		for (const group of fixtures.values()) {
			if (group.length < 2) continue;

			const ordered = [...group].sort(
				(first, second) =>
					second.odds.length - first.odds.length ||
					second.bets.length - first.bets.length ||
					first.createdAt.getTime() - second.createdAt.getTime(),
			);
			const keeper = ordered[0];
			const oddsByBookmaker = new Map(
				keeper.odds.map((odd) => [odd.bookmaker.trim().toUpperCase(), odd]),
			);

			for (const duplicate of ordered.slice(1)) {
				for (const odd of duplicate.odds) {
					const bookmaker = odd.bookmaker.trim().toUpperCase();
					const existing = oddsByBookmaker.get(bookmaker);
					if (!existing) {
						await transaction.marketOdd.update({
							where: { id: odd.id },
							data: { matchId: keeper.id },
						});
						oddsByBookmaker.set(bookmaker, odd);
					} else {
						if (odd.updatedAt > existing.updatedAt) {
							await transaction.marketOdd.update({
								where: { id: existing.id },
								data: {
									homeOdd: odd.homeOdd,
									drawOdd: odd.drawOdd,
									awayOdd: odd.awayOdd,
									expectedValueHome: odd.expectedValueHome,
									expectedValueDraw: odd.expectedValueDraw,
									expectedValueAway: odd.expectedValueAway,
								},
							});
							oddsByBookmaker.set(bookmaker, odd);
						}
						await transaction.marketOdd.delete({
							where: { id: odd.id },
						});
					}
				}

				await transaction.betLog.updateMany({
					where: { matchId: duplicate.id },
					data: { matchId: keeper.id },
				});
				await transaction.match.delete({ where: { id: duplicate.id } });
				matchesMerged += 1;
			}
		}

		return { teamsMerged, matchesMerged };
	}, { timeout: 60_000 });
}

if (require.main === module) {
	forceConsolidateTeams()
		.then((summary) => {
			console.log(`Teams consolidadas: ${summary.teamsMerged}`);
			console.log(`Matches consolidados: ${summary.matchesMerged}`);
		})
		.catch((error: unknown) => {
			console.error("Falha ao consolidar equipas e jogos:", error);
			process.exitCode = 1;
		})
		.finally(async () => prisma.$disconnect());
}
