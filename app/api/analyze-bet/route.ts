import { NextResponse } from "next/server";
import { analyzeValueBet } from "@/lib/services/aiAdvisor";

type AnalyzeBetRequest = {
	homeTeam: string;
	awayTeam: string;
	betSelection: string;
	odd: number | null;
	ev: number;
};

function isAnalyzeBetRequest(value: unknown): value is AnalyzeBetRequest {
	if (!value || typeof value !== "object") return false;
	const request = value as Record<string, unknown>;
	return (
		typeof request.homeTeam === "string" &&
		request.homeTeam.trim().length > 0 &&
		request.homeTeam.length <= 100 &&
		typeof request.awayTeam === "string" &&
		request.awayTeam.trim().length > 0 &&
		request.awayTeam.length <= 100 &&
		typeof request.betSelection === "string" &&
		request.betSelection.trim().length > 0 &&
		request.betSelection.length <= 100 &&
		(request.odd === null ||
			(typeof request.odd === "number" &&
				Number.isFinite(request.odd) &&
				request.odd > 1)) &&
		typeof request.ev === "number" &&
		Number.isFinite(request.ev)
	);
}

export async function POST(request: Request) {
	try {
		const body: unknown = await request.json();
		if (!isAnalyzeBetRequest(body)) {
			return NextResponse.json(
				{ error: "Os dados da análise do confronto são inválidos." },
				{ status: 400 },
			);
		}

		const data = await analyzeValueBet(body);
		return NextResponse.json(data);
	} catch (error) {
		console.error("[AI_ADVISOR] Falha ao analisar aposta:", error);
		return NextResponse.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Não foi possível analisar o risco da aposta.",
			},
			{ status: 500 },
		);
	}
}
