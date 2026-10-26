import { loadEnvConfig } from "@next/env";
import {
	calculateConsensusFairProbabilities,
	calculateExpectedValue,
	calculateKellyStake,
	calculateMatchProbabilities,
} from "@/lib/math/bettingEngine";

type Selection = "home" | "draw" | "away";

type BookmakerOdds = {
	bookmaker: string;
	homeOdd: number;
	drawOdd: number;
	awayOdd: number;
};

const bankroll = 500;
const selections: { key: Selection; label: string }[] = [
	{ key: "home", label: "Casa" },
	{ key: "draw", label: "Empate" },
	{ key: "away", label: "Fora" },
];

function formatPercent(value: number): string {
	return `${(value * 100).toLocaleString("pt-PT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}%`;
}

async function main(): Promise<void> {
	loadEnvConfig(process.cwd());
	const { prisma } = await import("@/lib/db");

	try {
		await prisma.$transaction([
			prisma.betLog.deleteMany(),
			prisma.marketOdd.deleteMany(),
			prisma.match.deleteMany(),
			prisma.team.deleteMany(),
		]);

		const sporting = await prisma.team.create({
			data: {
				name: "Sporting CP",
				league: "Primeira Liga",
				homeGoalsAvg: 2.4,
				awayGoalsAvg: 1.9,
				homeConcededAvg: 0.6,
				awayConcededAvg: 0.8,
			},
		});

		const braga = await prisma.team.create({
			data: {
				name: "SC Braga",
				league: "Primeira Liga",
				homeGoalsAvg: 1.8,
				awayGoalsAvg: 1.5,
				homeConcededAvg: 1.1,
				awayConcededAvg: 1.3,
			},
		});

		const homeExpectedGoals =
			(sporting.homeGoalsAvg + braga.awayConcededAvg) / 2;
		const awayExpectedGoals =
			(braga.awayGoalsAvg + sporting.homeConcededAvg) / 2;
		const probabilities = calculateMatchProbabilities(
			homeExpectedGoals,
			awayExpectedGoals,
		);

		const matchDate = new Date();
		matchDate.setDate(matchDate.getDate() + 1);

		const match = await prisma.match.create({
			data: {
				date: matchDate,
				league: "Primeira Liga",
				homeTeamId: sporting.id,
				awayTeamId: braga.id,
				estimatedProbHome: probabilities.homeProb,
				estimatedProbDraw: probabilities.drawProb,
				estimatedProbAway: probabilities.awayProb,
			},
		});

		const bookmakers: BookmakerOdds[] = [
			{
				bookmaker: "Betclic",
				homeOdd: 1.8,
				drawOdd: 3.6,
				awayOdd: 4.2,
			},
			{
				bookmaker: "Betano",
				homeOdd: 1.95,
				drawOdd: 3.5,
				awayOdd: 3.9,
			},
		];

		const fairProbabilities = calculateConsensusFairProbabilities(bookmakers);
		if (!fairProbabilities) {
			throw new Error("Não foi possível calcular as probabilidades de consenso.");
		}

		const results = bookmakers.map((bookmaker) => {
			const market = {
				home: calculateExpectedValue(
					bookmaker.homeOdd,
					fairProbabilities.homeProb,
				),
				draw: calculateExpectedValue(
					bookmaker.drawOdd,
					fairProbabilities.drawProb,
				),
				away: calculateExpectedValue(
					bookmaker.awayOdd,
					fairProbabilities.awayProb,
				),
			};

			return { bookmaker, market };
		});

		await prisma.marketOdd.createMany({
			data: results.map(({ bookmaker, market }) => ({
				matchId: match.id,
				bookmaker: bookmaker.bookmaker,
				homeOdd: bookmaker.homeOdd,
				drawOdd: bookmaker.drawOdd,
				awayOdd: bookmaker.awayOdd,
				expectedValueHome: market.home.expectedValue,
				expectedValueDraw: market.draw.expectedValue,
				expectedValueAway: market.away.expectedValue,
			})),
		});

		console.log("\n=== Sporting CP vs SC Braga ===");
		console.log(`Data: ${matchDate.toLocaleDateString("pt-PT")}`);
		console.log(
			`Golos esperados: Sporting ${homeExpectedGoals.toFixed(2)} - ${awayExpectedGoals.toFixed(2)} Braga`,
		);
		console.log("\nProbabilidades justas consensuais:");
		console.log(`Casa: ${formatPercent(fairProbabilities.homeProb)}`);
		console.log(`Empate: ${formatPercent(fairProbabilities.drawProb)}`);
		console.log(`Fora: ${formatPercent(fairProbabilities.awayProb)}`);

		for (const { bookmaker, market } of results) {
			console.log(`\n${bookmaker.bookmaker}`);

			for (const selection of selections) {
				const odd = bookmaker[`${selection.key}Odd`];
				const value = market[selection.key];
				const fairProbability = fairProbabilities[
					`${selection.key}Prob`
				];
				const valueLabel = value.hasValue ? "Value Bet: Sim" : "Value Bet: Não";

				console.log(
					`${selection.label}: odd ${odd.toFixed(2)} | EV ${formatPercent(value.expectedValue)} | ${valueLabel}`,
				);

				if (value.hasValue) {
					const stake = calculateKellyStake(
						bankroll,
						odd,
						fairProbability,
					);

					console.log(
						`  Stake sugerida: ${formatPercent(stake.percentage / 100)} da banca (${stake.stake.toFixed(2)} € de ${bankroll} €)`,
					);
				}
			}
		}
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error: unknown) => {
	console.error("Erro ao executar o teste do motor de apostas:", error);
	process.exitCode = 1;
});
