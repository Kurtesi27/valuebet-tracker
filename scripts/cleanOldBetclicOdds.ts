import { prisma } from "@/lib/db";

const purgeAllBetclicOdds = process.argv.includes("--all");
const bookmakerNames = purgeAllBetclicOdds
	? ["BETCLIC", "Betclic", "BETCLIC_FR", "Betclic_FR", "Betclic (FR)"]
	: ["BETCLIC_FR", "Betclic_FR", "Betclic (FR)"];

async function main(): Promise<void> {
	try {
		const deleted = await prisma.marketOdd.deleteMany({
			where: { bookmaker: { in: bookmakerNames } },
		});

		console.log(`Registos MarketOdd eliminados: ${deleted.count}`);
		if (purgeAllBetclicOdds) {
			console.log("Foram removidas todas as odds Betclic, incluindo as francesas.");
		} else {
			console.log(
				"Foram removidos apenas identificadores antigos/franceses. Usa --all para purgar todas as odds Betclic.",
			);
		}
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error: unknown) => {
	console.error("Falha ao limpar odds antigas da Betclic:", error);
	process.exitCode = 1;
});
