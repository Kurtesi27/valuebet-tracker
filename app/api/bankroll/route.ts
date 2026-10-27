import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
	BANKROLL_BET_TYPES,
	normalizeBetText,
} from "@/lib/bankroll-types";

const INITIAL_BANKROLL = 500;
const DEFAULT_YEAR = 2026;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

function parsePositiveInteger(value: string | null, fallback: number): number {
	if (!value || !/^\d+$/.test(value)) return fallback;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function canonicalBetType(value: string): string | undefined {
	return BANKROLL_BET_TYPES.find(
		(betType) => normalizeBetText(betType) === normalizeBetText(value),
	);
}

type BetTypePerformance = {
	betType: string;
	totalBets: number;
	totalStake: number;
	netProfit: number;
	roi: number;
	winRate: number;
	wins: number;
	losses: number;
	voidCount: number;
	pendingCount: number;
	pendingStake: number;
};

export async function GET(request: Request) {
	try {
		const searchParams = new URL(request.url).searchParams;
		const page = parsePositiveInteger(searchParams.get("page"), 1);
		const pageSize = Math.min(
			parsePositiveInteger(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE),
			MAX_PAGE_SIZE,
		);
		const type = searchParams.get("type")?.trim();
		const status = searchParams.get("status");
		const yearValue = searchParams.get("year");
		const year = yearValue === null ? DEFAULT_YEAR : Number(yearValue);
		const month = searchParams.get("month")?.trim();
		const search = searchParams.get("q")?.trim().slice(0, 100) ?? "";
		if (
			!Number.isInteger(year) ||
			year < 100 ||
			year > 9998 ||
			(yearValue !== null && !/^\d{4}$/.test(yearValue))
		) {
			return NextResponse.json(
				{ error: "O ano selecionado não é válido." },
				{ status: 400 },
			);
		}
		if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
			return NextResponse.json(
				{ error: "O mês selecionado não é válido." },
				{ status: 400 },
			);
		}
		const [monthYear, monthNumber] = month?.split("-").map(Number) ?? [];
		if (month && monthYear < 1) {
			return NextResponse.json(
				{ error: "O mês selecionado não é válido." },
				{ status: 400 },
			);
		}
		if (month && monthYear !== year) {
			return NextResponse.json(
				{ error: "O mês selecionado não pertence ao ano ativo." },
				{ status: 400 },
			);
		}
		const monthStart =
			month
				? new Date(Date.UTC(monthYear, monthNumber - 1, 1))
				: undefined;
		const nextMonthStart =
			month
				? new Date(Date.UTC(monthYear, monthNumber, 1))
				: undefined;
		const yearStart = new Date(Date.UTC(year, 0, 1));
		const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));
		const yearWhere = {
			matchId: null,
			date: {
				gte: yearStart,
				lt: nextYearStart,
			},
		};
		const monthWhere = monthStart && nextMonthStart
			? {
					matchId: null,
					date: { gte: monthStart, lt: nextMonthStart },
				}
			: yearWhere;

		const [allBets, monthBets, recordedDates] = await Promise.all([
			prisma.betLog.findMany({
				where: yearWhere,
				orderBy: [{ date: "desc" }, { createdAt: "desc" }],
				select: {
					id: true,
					date: true,
					betType: true,
					selection: true,
					stake: true,
					profit: true,
					status: true,
				},
			}),
			monthStart && nextMonthStart
				? prisma.betLog.findMany({
						where: monthWhere,
						orderBy: [{ date: "desc" }, { createdAt: "desc" }],
						select: {
							id: true,
							date: true,
							betType: true,
							selection: true,
							stake: true,
							profit: true,
							status: true,
						},
					})
				: Promise.resolve([]),
			prisma.betLog.findMany({
				where: { matchId: null },
				select: { date: true },
			}),
		]);

		const normalizedSearch = normalizeBetText(search);
		const historyBets = month ? monthBets : allBets;
		const filteredBets = historyBets.filter((bet) => {
			if (type && normalizeBetText(bet.betType) !== normalizeBetText(type)) {
				return false;
			}
			if (
				status === "GREEN" ||
				status === "RED" ||
				status === "PENDING" ||
				status === "VOID"
			) {
				if (bet.status !== status) return false;
			}
			if (
				normalizedSearch &&
				![bet.betType, bet.selection].some((value) =>
					normalizeBetText(value).includes(normalizedSearch),
				)
			) {
				return false;
			}
			return true;
		});
		const total = filteredBets.length;
		const bets = filteredBets.slice((page - 1) * pageSize, page * pageSize);

		const settledBets = allBets.filter(
			(bet) => bet.status === "GREEN" || bet.status === "RED",
		);
		const totalProfit = settledBets.reduce((sum, bet) => sum + bet.profit, 0);
		const totalStake = settledBets.reduce((sum, bet) => sum + bet.stake, 0);
		const pendingBets = allBets.filter((bet) => bet.status === "PENDING");
		const pendingStake = pendingBets.reduce((sum, bet) => sum + bet.stake, 0);
		const performanceByType = new Map<string, BetTypePerformance>();
		for (const bet of allBets) {
			const normalizedType = normalizeBetText(bet.betType) || "outro";
			let performance = performanceByType.get(normalizedType);
			if (!performance) {
				const betType =
					(canonicalBetType(bet.betType) ?? bet.betType?.trim()) || "Outro";
				performance = {
					betType,
					totalBets: 0,
					totalStake: 0,
					netProfit: 0,
					roi: 0,
					winRate: 0,
					wins: 0,
					losses: 0,
					voidCount: 0,
					pendingCount: 0,
					pendingStake: 0,
				};
				performanceByType.set(normalizedType, performance);
			}
			if (bet.status === "PENDING") {
				performance.pendingCount += 1;
				performance.pendingStake += bet.stake;
				continue;
			}
			if (
				bet.status !== "GREEN" &&
				bet.status !== "RED" &&
				bet.status !== "VOID"
			) {
				continue;
			}
			performance.totalBets += 1;
			performance.totalStake += bet.stake;
			if (bet.status === "GREEN") {
				performance.netProfit += bet.profit;
				performance.wins += 1;
			} else if (bet.status === "RED") {
				performance.netProfit += bet.profit;
				performance.losses += 1;
			} else {
				performance.voidCount += 1;
			}
		}
		const betTypePerformance = [...performanceByType.values()]
			.map((performance) => ({
				...performance,
				roi:
					performance.totalStake > 0
						? (performance.netProfit / performance.totalStake) * 100
						: 0,
				winRate:
					performance.wins + performance.losses > 0
						? (performance.wins /
								(performance.wins + performance.losses)) *
							100
						: 0,
			}))
			.sort(
				(first, second) =>
					second.netProfit - first.netProfit ||
					first.betType.localeCompare(second.betType, "pt-PT"),
			);
		const selectedMonthBets = month ? monthBets : [];
		const selectedMonthSettledBets = selectedMonthBets.filter(
			(bet) => bet.status === "GREEN" || bet.status === "RED",
		);
		const selectedMonthPendingBets = selectedMonthBets.filter(
			(bet) => bet.status === "PENDING",
		);
		const selectedMonthProfit = selectedMonthSettledBets.reduce(
			(sum, bet) => sum + bet.profit,
			0,
		);
		const selectedMonthStake = selectedMonthSettledBets.reduce(
			(sum, bet) => sum + bet.stake,
			0,
		);
		const selectedMonthPendingStake = selectedMonthPendingBets.reduce(
			(sum, bet) => sum + bet.stake,
			0,
		);
		const monthlyProfits = new Map<string, number>(
			Array.from({ length: 12 }, (_, index) => [
				`${year}-${String(index + 1).padStart(2, "0")}`,
				0,
			]),
		);
		for (const bet of allBets) {
			const month = `${bet.date.getUTCFullYear()}-${String(
				bet.date.getUTCMonth() + 1,
			).padStart(2, "0")}`;
			monthlyProfits.set(
				month,
				(monthlyProfits.get(month) ?? 0) +
					(bet.status === "GREEN" || bet.status === "RED" ? bet.profit : 0),
			);
		}
		const availableMonths = [...monthlyProfits.keys()].sort((first, second) =>
			second.localeCompare(first),
		);
		const currentYear = new Date().getFullYear();
		const availableYears = new Set<number>([
			DEFAULT_YEAR,
			currentYear,
			currentYear + 1,
			currentYear + 2,
			year,
		]);
		for (const record of recordedDates) {
			availableYears.add(record.date.getUTCFullYear());
		}

		return NextResponse.json({
			summary: {
				initialBankroll: INITIAL_BANKROLL,
				currentBankroll: INITIAL_BANKROLL + totalProfit,
				totalProfit,
				totalStake,
				roi: totalStake > 0 ? (totalProfit / totalStake) * 100 : 0,
				wins: settledBets.filter((bet) => bet.status === "GREEN").length,
				losses: settledBets.filter((bet) => bet.status === "RED").length,
				pendingCount: pendingBets.length,
				pendingStake,
			},
			selectedYear: year,
			availableYears: [...availableYears].sort((first, second) => second - first),
			selectedMonthSummary: month
				? {
						totalProfit: selectedMonthProfit,
						totalStake: selectedMonthStake,
						roi:
							selectedMonthStake > 0
								? (selectedMonthProfit / selectedMonthStake) * 100
								: 0,
						wins: selectedMonthSettledBets.filter((bet) => bet.status === "GREEN").length,
						losses: selectedMonthSettledBets.filter((bet) => bet.status === "RED").length,
						pendingCount: selectedMonthPendingBets.length,
						pendingStake: selectedMonthPendingStake,
					}
				: null,
			selectedMonth: month ?? null,
			availableMonths,
			monthly: [...monthlyProfits].map(([month, profit]) => ({ month, profit })),
			betTypePerformance,
			betTypes: BANKROLL_BET_TYPES,
			entries: {
				bets,
				page,
				pageSize,
				total,
				totalPages: Math.ceil(total / pageSize),
			},
		});
	} catch (error) {
		console.error("[BANKROLL] Failed to load tracker data:", error);
		return NextResponse.json(
			{ error: "Não foi possível carregar os dados da banca." },
			{ status: 500 },
		);
	}
}

type ManualBetRequest = {
	date: string;
	betType: string;
	stake: number;
	profit?: number;
	pending?: boolean;
};

function isManualBetRequest(value: unknown): value is ManualBetRequest {
	if (!value || typeof value !== "object") return false;
	const request = value as Record<string, unknown>;
	const date = typeof request.date === "string" ? new Date(request.date) : null;
	return (
		date !== null &&
		Number.isFinite(date.getTime()) &&
		typeof request.betType === "string" &&
		canonicalBetType(request.betType) !== undefined &&
		typeof request.stake === "number" &&
		Number.isFinite(request.stake) &&
		request.stake > 0 &&
		(request.pending === undefined || typeof request.pending === "boolean") &&
		(request.pending === true ||
			(typeof request.profit === "number" &&
				Number.isFinite(request.profit)))
	);
}

export async function POST(request: Request) {
	let body: unknown;
	try {
		body = await request.json();
	} catch (error) {
		console.warn("[BANKROLL] Invalid manual bet JSON:", error);
		return NextResponse.json(
			{ error: "Os dados da aposta não são um JSON válido." },
			{ status: 400 },
		);
	}

	if (!isManualBetRequest(body)) {
		return NextResponse.json(
			{ error: "Preencha uma data, tipo, stake positiva e resultado válido." },
			{ status: 400 },
		);
	}

	try {
		const status = body.pending
			? "PENDING"
			: (body.profit ?? 0) > 0
				? "GREEN"
				: "RED";
		const bet = await prisma.betLog.create({
			data: {
				matchId: null,
				date: new Date(body.date),
				betType: canonicalBetType(body.betType) ?? BANKROLL_BET_TYPES[0],
				stake: body.stake,
				profit: body.pending ? 0 : (body.profit ?? 0),
				status,
				result: status,
			},
			select: { id: true },
		});
		return NextResponse.json({ success: true, id: bet.id }, { status: 201 });
	} catch (error) {
		console.error("[BANKROLL] Failed to create manual bet:", error);
		return NextResponse.json(
			{ error: "Não foi possível guardar a aposta." },
			{ status: 500 },
		);
	}
}
