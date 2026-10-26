import { NextResponse } from "next/server";
import { syncBetanoMatches } from "@/lib/services/scrapers/betanoSync";
import { cleanupBeforeSync } from "@/lib/services/scrapers/syncCleanup";
import { scrapeBetclicOdds } from "@/scrapers/betclicScraper";

export async function POST() {
	try {
		const cleanupSummary = await cleanupBeforeSync();
		console.info("[SYNC] Limpeza concluída:", cleanupSummary);

		const betanoSummary = await syncBetanoMatches();
		const betclicSummary = await scrapeBetclicOdds();
		const errors = [...betanoSummary.errors, ...betclicSummary.errors];
		const betanoProcessed = betanoSummary.matchesProcessed;
		const betclicProcessed = betclicSummary.matchesProcessed;

		if (!betanoSummary.success || !betclicSummary.success) {
			return NextResponse.json(
				{
					success: false,
					error: errors.join("; ") || "Nenhum jogo foi sincronizado.",
				},
				{ status: 500 },
			);
		}

		return NextResponse.json(
			{ success: true, betanoProcessed, betclicProcessed },
			{ status: 200 },
		);
	} catch (err) {
		console.error("[SYNC] Falha ao sincronizar:", err);
		return NextResponse.json(
			{
				success: false,
				error: err instanceof Error ? err.message : String(err),
			},
			{ status: 500 },
		);
	}
}