import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { GET } from "../app/api/bankroll/route";
import { POST as importBets } from "../app/api/bankroll/import/route";
import { POST as createManualBet } from "../app/api/bankroll/route";
import { PATCH as resolveBet } from "../app/api/bankroll/[id]/route";
import { prisma } from "../lib/db";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

async function main() {
	const testType = `api-month-test-${Date.now()}`;
	const importType = `api-import-test-${Date.now()}`;
	const performanceSelection = `performance-test-${Date.now()}`;
	let manualPendingId: string | null = null;
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
			{
				matchId: null,
				betType: testType,
				stake: 30,
				profit: 0,
				status: "PENDING",
				result: "PENDING",
				date: new Date(Date.UTC(2001, 1, 20)),
			},
			{
				matchId: null,
				betType: "Múltiplas",
				selection: performanceSelection,
				stake: 10,
				profit: 5,
				status: "GREEN",
				date: new Date(Date.UTC(2001, 4, 3)),
			},
			{
				matchId: null,
				betType: "Multiplas",
				selection: performanceSelection,
				stake: 20,
				profit: -4,
				status: "RED",
				date: new Date(Date.UTC(2001, 4, 12)),
			},
			{
				matchId: null,
				betType: "Múltiplas",
				selection: performanceSelection,
				stake: 4,
				profit: 0,
				status: "VOID",
				date: new Date(Date.UTC(2001, 4, 15)),
			},
			{
				matchId: null,
				betType: "Múltiplas",
				selection: performanceSelection,
				stake: 12,
				profit: 0,
				status: "PENDING",
				result: "PENDING",
				date: new Date(Date.UTC(2001, 4, 20)),
			},
		],
	});

	try {
		const response = await GET(
			new Request(
				`http://localhost/api/bankroll?year=2001&month=2001-02&type=${testType}&pageSize=2`,
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
			!Array.isArray(result.monthly) ||
			!Array.isArray(result.betTypePerformance) ||
			!Array.isArray(result.availableMonths) ||
			typeof result.entries.totalPages !== "number"
		) {
			throw new Error("The bankroll API response has an invalid shape.");
		}
		assert.equal(result.selectedMonth, "2001-02");
		assert.equal(result.selectedYear, 2001);
		assert.equal(result.entries.total, 4);
		assert.equal(result.entries.totalPages, 2);
		assert.equal(result.entries.bets.length, 2);
		assert.equal(result.selectedMonthSummary.totalProfit, 5);
		assert.equal(result.selectedMonthSummary.totalStake, 35);
		assert.equal(result.selectedMonthSummary.wins, 2);
		assert.equal(result.selectedMonthSummary.losses, 1);
		assert.equal(result.selectedMonthSummary.pendingCount, 1);
		assert.equal(result.selectedMonthSummary.pendingStake, 30);
		assert.equal(result.summary.totalProfit, 105);
		assert.equal(result.summary.currentBankroll, 605);
		assert.equal(result.summary.totalStake, 164);
		const multiplePerformance = (
			result.betTypePerformance as Record<string, unknown>[]
		).find((performance) => performance.betType === "Multiplas");
		assert.ok(multiplePerformance);
		assert.equal(multiplePerformance.totalBets, 3);
		assert.equal(multiplePerformance.totalStake, 34);
		assert.equal(multiplePerformance.netProfit, 1);
		assert.equal(multiplePerformance.roi, (1 / 34) * 100);
		assert.equal(multiplePerformance.winRate, 50);
		assert.equal(multiplePerformance.wins, 1);
		assert.equal(multiplePerformance.losses, 1);
		assert.equal(multiplePerformance.voidCount, 1);
		assert.equal(multiplePerformance.pendingCount, 1);
		assert.equal(multiplePerformance.pendingStake, 12);
		assert.equal(result.monthly.length, 12);
		assert.deepEqual(result.availableMonths, [
			"2001-12",
			"2001-11",
			"2001-10",
			"2001-09",
			"2001-08",
			"2001-07",
			"2001-06",
			"2001-05",
			"2001-04",
			"2001-03",
			"2001-02",
			"2001-01",
		]);
		assert.ok((result.availableYears as number[]).includes(2001));

		const nextPage = await GET(
			new Request(
				`http://localhost/api/bankroll?year=2001&month=2001-02&type=${testType}&pageSize=2&page=2`,
			),
		);
		const nextPageResult: unknown = await nextPage.json();
		if (!isRecord(nextPageResult) || !isRecord(nextPageResult.entries)) {
			throw new Error("The paginated bankroll API response has an invalid shape.");
		}
		assert.equal(nextPageResult.entries.total, 4);
		assert.equal(nextPageResult.entries.page, 2);
		assert.equal(
			(nextPageResult.entries.bets as unknown[]).length,
			2,
		);

		const pendingResponse = await GET(
			new Request(
				`http://localhost/api/bankroll?year=2001&month=2001-02&type=${testType}&status=PENDING`,
			),
		);
		const pendingResult: unknown = await pendingResponse.json();
		if (!isRecord(pendingResult) || !isRecord(pendingResult.entries)) {
			throw new Error("The pending filter response has an invalid shape.");
		}
		assert.equal(pendingResult.entries.total, 1);

		const pendingBet = await prisma.betLog.findFirstOrThrow({
			where: { betType: testType, status: "PENDING" },
		});
		const resolveResponse = await resolveBet(
			new Request("http://localhost/api/bankroll/resolve", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "RED", profit: -30 }),
			}),
			{ params: Promise.resolve({ id: pendingBet.id }) },
		);
		assert.equal(resolveResponse.status, 200);
		const resolvedBet = await prisma.betLog.findUniqueOrThrow({
			where: { id: pendingBet.id },
		});
		assert.equal(resolvedBet.status, "RED");
		assert.equal(resolvedBet.profit, -30);

		const resolvedMonth = await GET(
			new Request(`http://localhost/api/bankroll?year=2001&month=2001-02&type=${testType}`),
		);
		const resolvedResult: unknown = await resolvedMonth.json();
		if (
			!isRecord(resolvedResult) ||
			!isRecord(resolvedResult.selectedMonthSummary) ||
			!isRecord(resolvedResult.summary)
		) {
			throw new Error("The resolved month summary has an invalid shape.");
		}
		assert.equal(resolvedResult.selectedMonthSummary.totalProfit, -25);
		assert.equal(resolvedResult.selectedMonthSummary.totalStake, 65);
		assert.equal(resolvedResult.selectedMonthSummary.wins, 2);
		assert.equal(resolvedResult.selectedMonthSummary.losses, 2);
		assert.equal(resolvedResult.selectedMonthSummary.pendingCount, 0);
		assert.equal(resolvedResult.summary.totalProfit, 75);
		assert.equal(resolvedResult.summary.currentBankroll, 575);

		const pendingForm = new Request("http://localhost/api/bankroll", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				date: "2001-02-21T12:00:00.000Z",
				betType: "Simples",
				stake: 7,
				pending: true,
			}),
		});
		const manualPendingResponse = await createManualBet(pendingForm);
		assert.equal(manualPendingResponse.status, 201);
		const manualPendingResult: unknown = await manualPendingResponse.json();
		if (!isRecord(manualPendingResult) || typeof manualPendingResult.id !== "string") {
			throw new Error("The pending manual entry response is invalid.");
		}
		manualPendingId = manualPendingResult.id;
		const manualPendingBet = await prisma.betLog.findUniqueOrThrow({
			where: { id: manualPendingResult.id },
		});
		assert.equal(manualPendingBet.status, "PENDING");
		assert.equal(manualPendingBet.profit, 0);
		assert.equal(manualPendingBet.result, "PENDING");

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
			new Request("http://localhost/api/bankroll?year=2001&month=2001-13"),
		);
		assert.equal(invalidMonth.status, 400);
		const mismatchedMonth = await GET(
			new Request("http://localhost/api/bankroll?year=2026&month=2001-02"),
		);
		assert.equal(mismatchedMonth.status, 400);
		const invalidYear = await GET(
			new Request("http://localhost/api/bankroll?year=not-a-year"),
		);
		assert.equal(invalidYear.status, 400);
		const emptyYear = await GET(
			new Request("http://localhost/api/bankroll?year=2027"),
		);
		const emptyYearResult: unknown = await emptyYear.json();
		if (
			!isRecord(emptyYearResult) ||
			!isRecord(emptyYearResult.summary) ||
			!isRecord(emptyYearResult.entries) ||
			!Array.isArray(emptyYearResult.monthly) ||
			!Array.isArray(emptyYearResult.betTypePerformance)
		) {
			throw new Error("The empty-year bankroll response has an invalid shape.");
		}
		assert.equal(emptyYearResult.summary.currentBankroll, 500);
		assert.equal(emptyYearResult.summary.totalProfit, 0);
		assert.equal(emptyYearResult.summary.roi, 0);
		assert.equal(emptyYearResult.summary.wins, 0);
		assert.equal(emptyYearResult.summary.losses, 0);
		assert.equal(emptyYearResult.entries.total, 0);
		assert.equal(emptyYearResult.betTypePerformance.length, 0);
		assert.equal(emptyYearResult.monthly.length, 12);
		assert.ok(
			(emptyYearResult.monthly as { profit: number }[]).every(
				(month) => month.profit === 0,
			),
		);

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

		console.info("Bankroll API, pending resolution, and import tests passed.");
	} finally {
		await prisma.betLog.deleteMany({
			where: {
				OR: [
					{ betType: { in: [testType, importType] } },
					{ selection: "Corner market selection" },
					{ selection: performanceSelection },
					...(manualPendingId ? [{ id: manualPendingId }] : []),
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
