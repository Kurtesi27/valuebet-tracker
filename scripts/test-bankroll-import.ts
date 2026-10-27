import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseBetHistory } from "../lib/bankroll-import";

const workbook = XLSX.utils.book_new();
const summarySheet = XLSX.utils.aoa_to_sheet([
	["Mês", "Início", "P/L"],
	["Janeiro", 500, 300],
	["Painel", "Boosted ODD", 10],
]);
XLSX.utils.book_append_sheet(workbook, summarySheet, "Painel");

const monthlyRows = [
	["Outubro 2026"],
	["Data", "Competição", "Mandante", "Visitante", "Forma de Trabalho", "Entrada", "Resultado"],
	["27/10/2026", "", "", "", "Múltiplas", "€ 1.200,50", "-$ 5,00"],
	["28/10/2026", "", "", "", "Simples", "10.00", "12.50"],
	[new Date(Date.UTC(2026, 9, 29)), "", "", "", "Boosted ODD", 5, 0],
	["30/10/2026", "", "", "", "Desafio Bunde", 3, null],
	["not a date", "", "", "", "Invalid", "3", "1"],
	["31/10/2026", "", "", "", "", 10, 4],
	["31/10/2026", "", "", "", "Bonus", 0, 4],
	[null, null, null, null, null, null, null],
];
XLSX.utils.book_append_sheet(
	workbook,
	XLSX.utils.aoa_to_sheet(monthlyRows),
	"10",
);
XLSX.utils.book_append_sheet(
	workbook,
	XLSX.utils.aoa_to_sheet([
		["Março 2026"],
		["Data", "", "", "", "Forma de Trabalho", "Entrada", "Resultado"],
		[45200, "", "", "", "Simples", "$ 5,00", "+$ 8,25"],
	]),
	"3",
);
XLSX.utils.book_append_sheet(
	workbook,
	XLSX.utils.aoa_to_sheet([
		["Data", "", "", "", "Forma de Trabalho", "Entrada", "Resultado"],
		["01/10/2026", "", "", "", "Não mensal", 50, 25],
	]),
	"Métodos",
);
XLSX.utils.book_append_sheet(
	workbook,
	XLSX.utils.aoa_to_sheet([
		["Dashboard"],
		["Data", "", "", "", "Forma de Trabalho", "Entrada", "Resultado"],
		["01/10/2026", "", "", "", "Resumo", 50, 25],
	]),
	"Painel mensal",
);

const result = parseBetHistory(
	XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
);
assert.equal(result.bets.length, 6);
assert.equal(result.skippedRows, 2);
assert.deepEqual(result.parsedSheets, ["10", "3"]);
assert.equal(result.bets[0].stake, 1200.5);
assert.equal(result.bets[0].profit, -5);
assert.equal(result.bets[0].status, "RED");
assert.equal(result.bets[1].profit, 12.5);
assert.equal(result.bets[1].status, "GREEN");
assert.equal(result.bets[2].date.toISOString().slice(0, 10), "2026-10-29");
assert.equal(result.bets[2].status, "RED");
assert.equal(result.bets[3].profit, 0);
assert.equal(result.bets[3].status, "RED");
assert.equal(result.bets[4].stake, 0);
assert.equal(result.bets[4].profit, 4);
assert.equal(result.bets[5].stake, 5);
assert.equal(result.bets[5].profit, 8.25);
assert.equal(result.bets[5].date.toISOString().slice(0, 10), "2023-10-01");

const csvResult = parseBetHistory(
	Buffer.from(
		'Outubro 2026,,,,,,\nData,,,,Forma de Trabalho,Entrada,Resultado\n27/10/24,,,,Simples,"$ 1,50","(3,25)"',
	),
);
assert.equal(csvResult.bets.length, 1);
assert.equal(csvResult.bets[0].stake, 1.5);
assert.equal(csvResult.bets[0].profit, -3.25);
assert.equal(csvResult.bets[0].date.toISOString(), "2026-10-27T00:00:00.000Z");
assert.deepEqual(csvResult.parsedSheets, ["Sheet1"]);

const yearCorrectionWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
	yearCorrectionWorkbook,
	XLSX.utils.aoa_to_sheet([
		["Outubro 2024"],
		["Data", "", "", "", "Forma de Trabalho", "Entrada", "Resultado"],
		["01/10/24", "", "", "", "Short year", 1, 1],
		["02/10/2024", "", "", "", "Full year", 1, 1],
		[
			45568 + (14 * 60 * 60 + 35 * 60 + 42) / 86_400,
			"",
			"",
			"",
			"Date cell",
			1,
			1,
		],
		[45566, "", "", "", "Excel serial", 1, 1],
	]),
	"10",
);
const correctedDates = parseBetHistory(
	XLSX.write(yearCorrectionWorkbook, { type: "buffer", bookType: "xlsx" }),
).bets.map((bet) => bet.date.toISOString());
assert.deepEqual(correctedDates, [
	"2026-10-01T00:00:00.000Z",
	"2026-10-02T00:00:00.000Z",
	"2026-10-03T14:35:42.000Z",
	"2026-10-01T00:00:00.000Z",
]);

console.info("Bankroll spreadsheet import tests passed.");
