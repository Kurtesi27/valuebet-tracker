import { prisma } from "../lib/db";

async function main() {
	const oldYearStart = new Date(Date.UTC(2024, 0, 1));
	const newYearStart = new Date(Date.UTC(2025, 0, 1));
	const affectedBets = await prisma.betLog.findMany({
		where: {
			date: {
				gte: oldYearStart,
				lt: newYearStart,
			},
		},
		select: {
			id: true,
			date: true,
		},
	});

	if (affectedBets.length === 0) {
		console.info("No BetLog dates from 2024 need correction.");
		return;
	}

	await prisma.$transaction(
		affectedBets.map((bet) => {
			const correctedDate = new Date(bet.date);
			correctedDate.setUTCFullYear(2026);
			return prisma.betLog.update({
				where: { id: bet.id },
				data: { date: correctedDate },
			});
		}),
	);

	console.info(`Updated ${affectedBets.length} BetLog dates from 2024 to 2026.`);
}

void main()
	.catch((error: unknown) => {
		console.error("Failed to update BetLog dates:", error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
