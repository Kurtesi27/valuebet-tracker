import * as XLSX from "xlsx";

export type ImportedBet = {
	date: Date;
	betType: string;
	stake: number;
	profit: number;
	status: "GREEN" | "RED";
};

export type ImportRowFailure = {
	sheet: string;
	rowIndex: number;
	cells: unknown[];
	reason: string;
};

function correctBetYear(date: Date): Date {
	if (date.getUTCFullYear() !== 2024) return date;
	const corrected = new Date(date);
	corrected.setUTCFullYear(2026);
	return corrected;
}

function parseDate(value: unknown): Date | null {
	if (value instanceof Date && Number.isFinite(value.getTime())) {
		return correctBetYear(value);
	}

	if (typeof value === "number" && Number.isFinite(value)) {
		const parts = XLSX.SSF.parse_date_code(value);
		if (!parts) return null;
		const date = new Date(
			Date.UTC(
				parts.y,
				parts.m - 1,
				parts.d,
				parts.H,
				parts.M,
				Math.round(parts.S),
			),
		);
		return Number.isFinite(date.getTime()) ? correctBetYear(date) : null;
	}

	if (typeof value !== "string") return null;
	const text = value.replace(/[\u00a0\u202f]/g, " ").trim();
	if (text === "") return null;
	const localized = text.match(
		/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
	);
	if (localized) {
		const day = Number(localized[1]);
		const month = Number(localized[2]);
		let year = Number(localized[3]);
		if (year < 100) year += year < 50 ? 2000 : 1900;
		const hour = Number(localized[4] ?? 0);
		const minute = Number(localized[5] ?? 0);
		const second = Number(localized[6] ?? 0);
		const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
		if (
			date.getUTCFullYear() !== year ||
			date.getUTCMonth() !== month - 1 ||
			date.getUTCDate() !== day
		) {
			return null;
		}
		return correctBetYear(date);
	}

	const date = new Date(text);
	return Number.isFinite(date.getTime()) ? correctBetYear(date) : null;
}

function parseAmount(value: unknown): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value !== "string") return null;

	let text = value
		.trim()
		.replace(/[€$£\s\u00a0']/g, "")
		.replace(/[−–]/g, "-");
	if (text === "") return null;

	const parenthesized = text.startsWith("(") && text.endsWith(")");
	if (parenthesized) text = text.slice(1, -1);
	if (text.endsWith("-")) text = `-${text.slice(0, -1)}`;
	if (text.startsWith("+")) text = text.slice(1);

	const comma = text.lastIndexOf(",");
	const dot = text.lastIndexOf(".");
	let decimalSeparator = "";
	if (comma !== -1 && dot !== -1) {
		decimalSeparator = comma > dot ? "," : ".";
	} else if (comma !== -1 || dot !== -1) {
		const separator = comma !== -1 ? "," : ".";
		const digitsAfter = text.length - text.lastIndexOf(separator) - 1;
		if (digitsAfter !== 3) decimalSeparator = separator;
	}

	if (decimalSeparator) {
		const thousandsSeparator = decimalSeparator === "," ? "." : ",";
		text = text.replaceAll(thousandsSeparator, "");
		if (decimalSeparator === ",") text = text.replace(",", ".");
	} else {
		text = text.replace(/[,.]/g, "");
	}

	if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
	const amount = Number(text) * (parenthesized ? -1 : 1);
	return Number.isFinite(amount) ? amount : null;
}

function normalizeHeader(value: unknown): string {
	return String(value ?? "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function isExcludedSheet(name: string): boolean {
	const normalized = normalizeHeader(name);
	return ["painel", "metodos", "graficos", "camp", "equipes"].some(
		(prefix) => normalized === prefix || normalized.startsWith(`${prefix} `),
	);
}

function hasBetLogHeaders(rows: unknown[][]): boolean {
	const headers = rows[1] as unknown[] | undefined;
	if (!headers) return false;

	const dateHeader = normalizeHeader(headers[0]);
	const typeHeader = normalizeHeader(headers[4]);
	const stakeHeader = normalizeHeader(headers[5]);
	const profitHeader = normalizeHeader(headers[6]);

	return (
		["data", "date"].includes(dateHeader) &&
		(typeHeader.includes("forma de trabalho") ||
			typeHeader.includes("bet type") ||
			typeHeader === "type") &&
		(stakeHeader.includes("entrada") || stakeHeader.includes("stake")) &&
		(profitHeader.includes("resultado") || profitHeader.includes("profit"))
	);
}

function isMonthlyBetLogSheet(
	name: string,
	rows: unknown[][],
): boolean {
	if (isExcludedSheet(name)) return false;
	return /^(0?[1-9]|1[0-2])$/.test(name.trim()) || hasBetLogHeaders(rows);
}

export function parseBetHistory(buffer: Buffer): {
	bets: ImportedBet[];
	skippedRows: number;
	parsedSheets: string[];
	failures: ImportRowFailure[];
} {
	const workbook = XLSX.read(buffer, {
		type: "buffer",
		cellDates: false,
		raw: true,
	});
	if (workbook.SheetNames.length === 0) {
		throw new Error("O ficheiro não contém nenhuma folha de cálculo.");
	}

	const bets: ImportedBet[] = [];
	let skippedRows = 0;
	const parsedSheets: string[] = [];
	const failures: ImportRowFailure[] = [];

	for (const sheetName of workbook.SheetNames) {
		const worksheet = workbook.Sheets[sheetName];
		if (!worksheet) continue;

		const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
			header: 1,
			raw: true,
			defval: null,
			blankrows: true,
		});
		if (!isMonthlyBetLogSheet(sheetName, rows)) continue;
		parsedSheets.push(sheetName);

		for (let rowOffset = 2; rowOffset < rows.length; rowOffset += 1) {
			const row = rows[rowOffset];
			if (!row) continue;
			const values = row as unknown[];
			const relevantCells = [values[0], values[4], values[5], values[6]];
			if (
				relevantCells.every(
					(value) => value === null || String(value).replace(/[\u00a0\u202f]/g, " ").trim() === "",
				)
			) {
				continue;
			}

			const date = parseDate(values[0]);
			const betType =
				typeof values[4] === "string"
					? values[4].trim()
					: String(values[4] ?? "").trim();
			const stake = parseAmount(values[5]);
			const rawProfit = values[6];
			const profit =
				rawProfit === null ||
				String(rawProfit).replace(/[\u00a0\u202f]/g, " ").trim() === ""
					? 0
					: parseAmount(rawProfit);

			let reason: string | null = null;
			if (!date) reason = "invalid or missing date";
			else if (!betType || betType.length > 80) reason = "invalid or missing bet type";
			else if (stake === null) reason = "invalid or missing stake";
			else if (stake < 0) reason = "stake must not be negative";
			if (reason) {
				skippedRows += 1;
				const failure = {
					sheet: sheetName,
					rowIndex: rowOffset + 1,
					cells: relevantCells,
					reason,
				};
				failures.push(failure);
				console.warn(
					`[BANKROLL_IMPORT] Skipped row: ${JSON.stringify(failure)}`,
				);
				continue;
			}
			if (profit === null) {
				skippedRows += 1;
				const failure = {
					sheet: sheetName,
					rowIndex: rowOffset + 1,
					cells: relevantCells,
					reason: "invalid profit",
				};
				failures.push(failure);
				console.warn(
					`[BANKROLL_IMPORT] Skipped row: ${JSON.stringify(failure)}`,
				);
				continue;
			}

			if (!date || !betType || stake === null) continue;

			bets.push({
				date,
				betType,
				stake,
				profit,
				status: profit > 0 ? "GREEN" : "RED",
			});
		}
	}

	return { bets, skippedRows, parsedSheets, failures };
}
