import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
	BANKROLL_BET_TYPES,
	normalizeBetText,
} from "@/lib/bankroll-types";

const INITIAL_BANKROLL = 500;
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
		const month = searchParams.get("month")?.trim();
		const search = searchParams.get("q")?.trim().slice(0, 100) ?? "";
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
		const monthStart =
			month
				? new Date(Date.UTC(monthYear, monthNumber - 1, 1))
				: undefined;
		const nextMonthStart =
			month
				? new Date(Date.UTC(monthYear, monthNumber, 1))
				: undefined;
		const where = {
			matchId: null,
		};

		const allBets = await prisma.betLog.findMany({
				where,
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
			});

		const normalizedSearch = normalizeBetText(search);
		const filteredBets = allBets.filter((bet) => {
			if (type && normalizeBetText(bet.betType) !== normalizeBetText(type)) {
				return false;
			}
			if (status === "GREEN" || status === "RED") {
				if (bet.status !== status) return false;
			}
			if (
				monthStart &&
				nextMonthStart &&
				(bet.date < monthStart || bet.date >= nextMonthStart)
			) {
				return false;
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

		const totalProfit = allBets.reduce((sum, bet) => sum + bet.profit, 0);
		const totalStake = allBets.reduce((sum, bet) => sum + bet.stake, 0);
		const selectedMonthBets = month
			? allBets.filter(
					(bet) =>
						bet.date.getUTCFullYear() === monthYear &&
						bet.date.getUTCMonth() + 1 === monthNumber,
				)
			: [];
		const selectedMonthProfit = selectedMonthBets.reduce(
			(sum, bet) => sum + bet.profit,
			0,
		);
		const selectedMonthStake = selectedMonthBets.reduce(
			(sum, bet) => sum + bet.stake,
			0,
		);
		const monthlyProfits = new Map<string, number>();
		for (const bet of allBets) {
			const month = `${bet.date.getUTCFullYear()}-${String(
				bet.date.getUTCMonth() + 1,
			).padStart(2, "0")}`;
			monthlyProfits.set(month, (monthlyProfits.get(month) ?? 0) + bet.profit);
		}
		const availableMonths = [...monthlyProfits.keys()].sort((first, second) =>
			second.localeCompare(first),
		);

		return NextResponse.json({
			summary: {
				initialBankroll: INITIAL_BANKROLL,
				currentBankroll: INITIAL_BANKROLL + totalProfit,
				totalProfit,
				totalStake,
				roi: totalStake > 0 ? (totalProfit / totalStake) * 100 : 0,
				wins: allBets.filter((bet) => bet.status === "GREEN").length,
				losses: allBets.filter((bet) => bet.status === "RED").length,
			},
			selectedMonthSummary: month
				? {
						totalProfit: selectedMonthProfit,
						totalStake: selectedMonthStake,
						roi:
							selectedMonthStake > 0
								? (selectedMonthProfit / selectedMonthStake) * 100
								: 0,
						wins: selectedMonthBets.filter((bet) => bet.status === "GREEN").length,
						losses: selectedMonthBets.filter((bet) => bet.status === "RED").length,
					}
				: null,
			selectedMonth: month ?? null,
			availableMonths,
			monthly: [...monthlyProfits].map(([month, profit]) => ({ month, profit })),
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
	profit: number;
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
		typeof request.profit === "number" &&
		Number.isFinite(request.profit)
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
		const bet = await prisma.betLog.create({
			data: {
				matchId: null,
				date: new Date(body.date),
				betType: canonicalBetType(body.betType) ?? BANKROLL_BET_TYPES[0],
				stake: body.stake,
				profit: body.profit,
				status: body.profit > 0 ? "GREEN" : "RED",
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
