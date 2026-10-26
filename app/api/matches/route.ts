import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { calculateConsensusFairProbabilities } from "@/lib/math/bettingEngine";

export async function GET() {
	try {
		const now = new Date();
		const matches = await prisma.match.findMany({
			where: {
				date: { gt: now },
			},
			orderBy: { date: "asc" },
			include: {
				homeTeam: true,
				awayTeam: true,
				odds: {
					where: {
						bookmaker: {
							in: ["BETANO", "Betano", "BETCLIC", "Betclic"],
						},
					},
					orderBy: { updatedAt: "desc" },
				},
			},
		});

		const matchesWithProbabilities = matches.map((match) => {
			const seenBookmakers = new Set<string>();
			const distinctBookmakerOdds = match.odds.filter((odd) => {
				const bookmaker = odd.bookmaker.trim().toUpperCase();
				if (seenBookmakers.has(bookmaker)) return false;
				seenBookmakers.add(bookmaker);
				return true;
			});
			const marketProbabilities =
				calculateConsensusFairProbabilities(distinctBookmakerOdds);

			return marketProbabilities
				? {
						...match,
						estimatedProbHome: marketProbabilities.homeProb,
						estimatedProbDraw: marketProbabilities.drawProb,
						estimatedProbAway: marketProbabilities.awayProb,
						probabilitySource: "MARKET_FAIR" as const,
					}
				: { ...match, probabilitySource: "MODEL" as const };
		});

		return NextResponse.json(matchesWithProbabilities);
	} catch (error) {
		console.error("Failed to load matches:", error);
		return NextResponse.json(
			{ error: "Não foi possível carregar os jogos." },
			{ status: 500 },
		);
	}
}