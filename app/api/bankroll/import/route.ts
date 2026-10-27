import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseBetHistory } from "@/lib/bankroll-import";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".xlsx", ".csv"]);

export async function POST(request: Request) {
	let formData: FormData;
	try {
		formData = await request.formData();
	} catch (error) {
		console.warn("[BANKROLL_IMPORT] Invalid multipart request:", error);
		return NextResponse.json(
			{ error: "Não foi possível ler o ficheiro enviado." },
			{ status: 400 },
		);
	}

	const uploadedFile = formData.get("file");
	if (!(uploadedFile instanceof File)) {
		return NextResponse.json(
			{ error: "Selecione um ficheiro Excel (.xlsx) ou CSV." },
			{ status: 400 },
		);
	}

	const extension = uploadedFile.name.match(/\.[^.]+$/)?.[0].toLowerCase();
	if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
		return NextResponse.json(
			{ error: "Formato inválido. Envie um ficheiro .xlsx ou .csv." },
			{ status: 400 },
		);
	}
	if (uploadedFile.size === 0 || uploadedFile.size > MAX_FILE_SIZE) {
		return NextResponse.json(
			{ error: "O ficheiro deve ter conteúdo e não pode exceder 10 MB." },
			{ status: 400 },
		);
	}

	try {
		const buffer = Buffer.from(await uploadedFile.arrayBuffer());
		const { bets, skippedRows, parsedSheets } = parseBetHistory(buffer);
		if (bets.length === 0) {
			return NextResponse.json(
				{
					error:
						"Não foram encontradas apostas válidas. Confirme se as colunas A, E, F e G contêm os dados esperados.",
					skippedRows,
					parsedSheets,
				},
				{ status: 422 },
			);
		}

		const result = await prisma.betLog.createMany({
			data: bets.map((bet) => ({ ...bet, matchId: null })),
		});

		return NextResponse.json({
			success: true,
			imported: result.count,
			skippedRows,
			parsedSheets,
		});
	} catch (error) {
		console.error("[BANKROLL_IMPORT] Failed to import bet history:", error);
		return NextResponse.json(
			{ error: "Não foi possível processar ou guardar o histórico enviado." },
			{ status: 500 },
		);
	}
}
