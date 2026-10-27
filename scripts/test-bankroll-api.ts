import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { GET } from "../app/api/bankroll/route";
import { POST as importBets } from "../app/api/bankroll/import/route";
import { prisma } from "../lib/db";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

async function main() {
	const testType = `api-month-test-${Date.now()}`;
	const importType = `api-import-test-${Date.now()}`;
	await prisma.betLog.createMany({
		data: [
			{
				matchId: null,
				betType: testType,
				stake: 10,
				profit: 15,
				status: "GREEN",
				date: new Date(Date.UTC(2001, 1, 3)),
			},
			{
				matchId: null,
				betType: testType,
				stake: 20,
				profit: -20,
				status: "RED",
				date: new Date(Date.UTC(2001, 1, 12)),
			},
			{
				matchId: null,
				betType: testType,
				stake: 5,
				profit: 10,
				status: "GREEN",
				date: new Date(Date.UTC(2001, 1, 28, 23, 59, 59)),
			},
			{
				matchId: null,
				betType: testType,
				stake: 99,
				profit: 99,
				status: "GREEN",
				date: new Date(Date.UTC(2001, 2, 1)),
			},
			{
				matchId: null,
				betType: "Múltiplas",
				selection: "Corner market selection",
				stake: 6,
				profit: 4,
				status: "GREEN",
				date: new Date(Date.UTC(2026, 9, 4)),
			},
		],
	});

	try {
		const response = await GET(
			new Request(
				`http://localhost/api/bankroll?month=2001-02&type=${testType}&pageSize=2`,
			),
		);
		assert.equal(response.status, 200);

		const result: unknown = await response.json();
		if (
			!isRecord(result) ||
			!isRecord(result.summary) ||
			!isRecord(result.selectedMonthSummary) ||
			!isRecord(result.entries) ||
			!Array.isArray(result.entries.bets) ||
			!Array.isArray(result.availableMonths) ||
			typeof result.entries.totalPages !== "number"
		) {
			throw new Error("The bankroll API response has an invalid shape.");
		}
		assert.equal(result.selectedMonth, "2001-02");
		assert.equal(result.entries.total, 3);
		assert.equal(result.entries.totalPages, 2);
		assert.equal(result.entries.bets.length, 2);
		assert.equal(result.selectedMonthSummary.totalProfit, 5);
		assert.equal(result.selectedMonthSummary.totalStake, 35);
		assert.equal(result.selectedMonthSummary.wins, 2);
		assert.equal(result.selectedMonthSummary.losses, 1);
		assert.ok((result.availableMonths as string[]).includes("2001-02"));

		const nextPage = await GET(
			new Request(
				`http://localhost/api/bankroll?month=2001-02&type=${testType}&pageSize=2&page=2`,
			),
		);
		const nextPageResult: unknown = await nextPage.json();
		if (!isRecord(nextPageResult) || !isRecord(nextPageResult.entries)) {
			throw new Error("The paginated bankroll API response has an invalid shape.");
		}
		assert.equal(nextPageResult.entries.total, 3);
		assert.equal(nextPageResult.entries.page, 2);
		assert.equal(
			(nextPageResult.entries.bets as unknown[]).length,
			1,
		);

		const normalizedTypeSearch = await GET(
			new Request(
				"http://localhost/api/bankroll?type=Multiplas&q=CORNER&pageSize=10",
			),
		);
		const normalizedResult: unknown = await normalizedTypeSearch.json();
		if (!isRecord(normalizedResult) || !isRecord(normalizedResult.entries)) {
			throw new Error("The normalized type search response has an invalid shape.");
		}
		assert.equal(normalizedResult.entries.total, 1);
		const normalizedBets = normalizedResult.entries.bets as Record<
			string,
			unknown
		>[];
		assert.equal(normalizedBets[0]?.betType, "Múltiplas");
		assert.equal(normalizedBets[0]?.selection, "Corner market selection");

		const invalidMonth = await GET(
			new Request("http://localhost/api/bankroll?month=2001-13"),
		);
		assert.equal(invalidMonth.status, 400);

		const workbook = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(
			workbook,
			XLSX.utils.aoa_to_sheet([["Painel"], ["Mês", "Início", "P/L"]]),
			"Painel",
		);
		XLSX.utils.book_append_sheet(
			workbook,
			XLSX.utils.aoa_to_sheet([
				["Outubro 2026"],
				["Data", "", "", "", "Forma de Trabalho", "Entrada", "Resultado"],
				["01/10/2026", "", "", "", importType, "$ 5,00", "-$ 5,00"],
				["02/10/2026", "", "", "", importType, "$ 5,00", "$ 8,00"],
			]),
			"10",
		);
		const workbookBuffer = XLSX.write(workbook, {
			type: "buffer",
			bookType: "xlsx",
		});
		const formData = new FormData();
		formData.append(
			"file",
			new File([workbookBuffer], "bankroll-import.xlsx", {
				type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			}),
		);
		const importResponse = await importBets(
			new Request("http://localhost/api/bankroll/import", {
				method: "POST",
				body: formData,
			}),
		);
		assert.equal(importResponse.status, 200);
		const importResult: unknown = await importResponse.json();
		if (!isRecord(importResult) || !Array.isArray(importResult.parsedSheets)) {
			throw new Error("The import API response has an invalid shape.");
		}
		assert.equal(importResult.imported, 2);
		assert.deepEqual(importResult.parsedSheets, ["10"]);
		const importedBets = await prisma.betLog.findMany({
			where: { betType: importType },
			orderBy: { date: "asc" },
		});
		assert.equal(importedBets.length, 2);
		assert.equal(importedBets[0].profit, -5);
		assert.equal(importedBets[1].profit, 8);

		console.info("Bankroll month filtering and multi-sheet import tests passed.");
	} finally {
		await prisma.betLog.deleteMany({
			where: {
				OR: [
					{ betType: { in: [testType, importType] } },
					{ selection: "Corner market selection" },
				],
			},
		});
		await prisma.$disconnect();
	}
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
