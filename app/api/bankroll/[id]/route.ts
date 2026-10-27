import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

type ResolutionStatus = "GREEN" | "RED" | "VOID";

function isResolutionRequest(
	value: unknown,
): value is { status: ResolutionStatus; profit: number } {
	if (!value || typeof value !== "object") return false;
	const request = value as Record<string, unknown>;
	if (
		(request.status !== "GREEN" &&
			request.status !== "RED" &&
			request.status !== "VOID") ||
		typeof request.profit !== "number" ||
		!Number.isFinite(request.profit)
	) {
		return false;
	}

	if (request.status === "GREEN") return request.profit > 0;
	if (request.status === "RED") return request.profit < 0;
	return request.profit === 0;
}

export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	let body: unknown;
	try {
		body = await request.json();
	} catch (error) {
		console.warn("[BANKROLL] Invalid bet resolution JSON:", error);
		return NextResponse.json(
			{ error: "Os dados da resolução não são um JSON válido." },
			{ status: 400 },
		);
	}

	if (!isResolutionRequest(body)) {
		return NextResponse.json(
			{
				error:
					"Escolha GREEN com lucro positivo, RED com prejuízo negativo ou VOID com resultado zero.",
			},
			{ status: 400 },
		);
	}

	const { id } = await params;
	try {
		const bet = await prisma.betLog.findFirst({
			where: { id, matchId: null },
			select: { id: true },
		});
		if (!bet) {
			return NextResponse.json(
				{ error: "A aposta não foi encontrada." },
				{ status: 404 },
			);
		}

		await prisma.betLog.update({
			where: { id: bet.id },
			data: {
				status: body.status,
				result: body.status,
				profit: body.profit,
			},
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("[BANKROLL] Failed to resolve bet:", error);
		return NextResponse.json(
			{ error: "Não foi possível atualizar o resultado da aposta." },
			{ status: 500 },
		);
	}
}
