import { prisma } from "@/lib/db";
import { forceConsolidateTeams } from "@/scripts/forceConsolidateTeams";

export type SyncCleanupSummary = {
	teamsMerged: number;
	matchesMerged: number;
	matchesWithoutOddsDeleted: number;
};

export async function cleanupBeforeSync(): Promise<SyncCleanupSummary> {
	const consolidation = await forceConsolidateTeams();
	const matchesWithoutOdds = await prisma.match.deleteMany({
		where: {
			odds: { none: {} },
			bets: { none: {} },
		},
	});

	return {
		...consolidation,
		matchesWithoutOddsDeleted: matchesWithoutOdds.count,
	};
}
