import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { prisma } from "../lib/db";
import { parseBetHistory } from "../lib/bankroll-import";

const EXPECTED_TOTAL_PROFIT = 1430.68;
const EXPECTED_JANUARY_PROFIT = 3.23;
const EXPECTED_SHEETS = Array.from({ length: 12 }, (_, index) =>
	String(index + 1).padStart(2, "0"),
);
const CENT_TOLERANCE = 0.001;

function roundToCents(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function main() {
	const args = process.argv.slice(2);
	const apply = args.includes("--apply");
	const fileArg = args.find((argument) => argument !== "--apply");
	if (!fileArg) {
		throw new Error(
			"Usage: npm run reimport:bankroll -- [--apply] <path-to-workbook.xlsx>",
		);
	}

	const filePath = resolve(fileArg);
	const { bets, skippedRows, parsedSheets, failures } = parseBetHistory(
		await readFile(filePath),
	);
	const monthlyProfit = new Map<number, number>();
	for (const bet of bets) {
		const month = bet.date.getUTCMonth() + 1;
		monthlyProfit.set(month, (monthlyProfit.get(month) ?? 0) + bet.profit);
	}

	const totalProfit = roundToCents(
		bets.reduce((total, bet) => total + bet.profit, 0),
	);
	const januaryProfit = roundToCents(monthlyProfit.get(1) ?? 0);
	const hasAllMonthlySheets = EXPECTED_SHEETS.every((sheet) =>
		parsedSheets.includes(sheet),
	);
	const totalMatches =
		Math.abs(totalProfit - EXPECTED_TOTAL_PROFIT) < CENT_TOLERANCE;
	const januaryMatches =
		Math.abs(januaryProfit - EXPECTED_JANUARY_PROFIT) < CENT_TOLERANCE;

	console.info(
		JSON.stringify(
			{
				file: basename(filePath),
				parsedSheets,
				importedRows: bets.length,
				skippedRows,
				totalProfit,
				januaryProfit,
				monthlyProfit: Object.fromEntries(
					[...monthlyProfit.entries()].sort(([first], [second]) => first - second),
				),
			},
			null,
			2,
		),
	);

	if (failures.length > 0) {
		throw new Error(
			`${failures.length} rows failed parsing. Review the console diagnostics before re-importing.`,
		);
	}
	if (!hasAllMonthlySheets) {
		throw new Error("The workbook must contain all 12 monthly sheets (01-12).");
	}
	if (!totalMatches || !januaryMatches) {
		throw new Error(
			`Totals do not match the workbook dashboard (expected €${EXPECTED_TOTAL_PROFIT.toFixed(2)} total and €${EXPECTED_JANUARY_PROFIT.toFixed(2)} in January). No database rows were changed.`,
		);
	}
	if (!apply) {
		console.info(
			"Dry run passed. Re-run with --apply to replace BetLog and import these bets.",
		);
		return;
	}

	const result = await prisma.$transaction(async (transaction) => {
		await transaction.betLog.deleteMany();
		return transaction.betLog.createMany({
			data: bets.map((bet) => ({ ...bet, matchId: null })),
		});
	});

	console.info(
		`Replaced BetLog and imported ${result.count} bets from ${basename(filePath)}.`,
	);
}

void main()
	.catch((error: unknown) => {
		console.error("[BANKROLL_REIMPORT] Failed:", error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
