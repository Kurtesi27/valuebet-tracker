import { prisma } from "@/lib/db";

const corruptedTeamNames = new Set(["dora", "estrela ama", "gil vicent"]);
const optionalTeamNames = new Set(["dora", "estrela ama", "gil vicent"]);

function normalizeTeamName(name: string): string {
	return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-PT");
}

async function main(): Promise<void> {
	try {
		const matches = await prisma.match.findMany({
			select: {
				id: true,
				homeTeam: { select: { name: true } },
				awayTeam: { select: { name: true } },
				odds: { select: { id: true }, take: 1 },
			},
		});

		const matchesToDelete = matches.filter(
			(match) =>
				match.odds.length === 0 ||
				corruptedTeamNames.has(normalizeTeamName(match.homeTeam.name)) ||
				corruptedTeamNames.has(normalizeTeamName(match.awayTeam.name)),
		);
		const matchIdsToDelete = matchesToDelete.map((match) => match.id);

		const betsForMatches = matchIdsToDelete.length
			? await prisma.betLog.count({
					where: { matchId: { in: matchIdsToDelete } },
				})
			: 0;
		if (betsForMatches > 0) {
			throw new Error(
				`A limpeza foi cancelada: ${betsForMatches} aposta(s) referenciam jogos a apagar. Remova ou resolva essas apostas antes de voltar a executar o script.`,
			);
		}

		const teamsToDelete = await prisma.team.findMany({
			where: {
				name: { in: [...optionalTeamNames] },
			},
			select: { id: true },
		});
		const teamIdsToDelete = teamsToDelete.map((team) => team.id);

		const counts = await prisma.$transaction(async (transaction) => {
			const deletedOrphanOdds = await transaction.$executeRaw`
				DELETE FROM "MarketOdd"
				WHERE "matchId" NOT IN (SELECT "id" FROM "Match")
			`;

			const deletedRelatedOdds = matchIdsToDelete.length
				? await transaction.marketOdd.deleteMany({
						where: { matchId: { in: matchIdsToDelete } },
					})
				: { count: 0 };

			const deletedMatches = matchIdsToDelete.length
				? await transaction.match.deleteMany({
						where: { id: { in: matchIdsToDelete } },
					})
				: { count: 0 };

			const deletedTeams = teamIdsToDelete.length
				? await transaction.team.deleteMany({
						where: {
							id: { in: teamIdsToDelete },
							homeMatches: { none: {} },
							awayMatches: { none: {} },
						},
					})
				: { count: 0 };

			return {
				marketOdds: Number(deletedOrphanOdds) + deletedRelatedOdds.count,
				matches: deletedMatches.count,
				teams: deletedTeams.count,
			};
		});

		console.log(`MarketOdds apagadas: ${counts.marketOdds}`);
		console.log(`Matches apagados: ${counts.matches}`);
		console.log(`Teams apagadas: ${counts.teams}`);
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error: unknown) => {
	console.error("Falha ao eliminar jogos corrompidos:", error);
	process.exitCode = 1;
});
