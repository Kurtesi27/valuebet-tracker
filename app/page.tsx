"use client";

import { useEffect, useState } from "react";
import {
	calculateConsensusFairProbabilities,
	calculateExpectedValue,
	calculateKellyStake,
} from "@/lib/math/bettingEngine";

type MatchRecord = {
	id: string;
	date: string;
	league: string;
	estimatedProbHome: number;
	estimatedProbDraw: number;
	estimatedProbAway: number;
	probabilitySource?: "MARKET_FAIR" | "MODEL";
	homeTeam: { name: string };
	awayTeam: { name: string };
	odds: MarketOdd[];
};

type MarketOdd = {
	id: string;
	bookmaker: string;
	homeOdd: number;
	drawOdd: number;
	awayOdd: number;
	expectedValueHome: number;
	expectedValueDraw: number;
	expectedValueAway: number;
};

type ValueBetAnalysis = {
	riskLevel: "BAIXO" | "MEDIO" | "ELEVADO";
	absences: string;
	formTrend: string;
	context: string;
	verdict: string;
};

type AnalysisState = {
	loading: boolean;
	data?: ValueBetAnalysis;
	error?: string;
};

type ValueBetCandidate = {
	betSelection: string;
	odd: number | null;
	ev: number;
};

const bankroll = 500;
const bookmakers = [
	{ key: "BETANO", label: "BETANO" },
	{ key: "BETCLIC", label: "BETCLIC" },
] as const;
const outcomes = [
	{
		key: "home",
		label: "Casa",
		probabilityKey: "estimatedProbHome",
		oddKey: "homeOdd",
		valueKey: "expectedValueHome",
	},
	{
		key: "draw",
		label: "Empate",
		probabilityKey: "estimatedProbDraw",
		oddKey: "drawOdd",
		valueKey: "expectedValueDraw",
	},
	{
		key: "away",
		label: "Fora",
		probabilityKey: "estimatedProbAway",
		oddKey: "awayOdd",
		valueKey: "expectedValueAway",
	},
] as const;

const euroFormatter = new Intl.NumberFormat("pt-PT", {
	style: "currency",
	currency: "EUR",
	minimumFractionDigits: 2,
});

function formatPercent(value: number): string {
	return `${(value * 100).toLocaleString("pt-PT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}%`;
}

function formatExpectedValue(value: number): string {
	return `${value > 0 ? "+" : ""}${formatPercent(value)}`;
}

function hasValueBet(match: MatchRecord): boolean {
	return match.odds.some((odd) =>
		outcomes.some(
			(outcome) =>
				calculateExpectedValue(
					odd[outcome.oddKey],
					match[outcome.probabilityKey],
				).hasValue,
		),
	);
}

function findBookmakerOdds(
	match: MatchRecord,
	bookmaker: (typeof bookmakers)[number]["key"],
): MarketOdd | undefined {
	return match.odds.find(
		(odd) => odd.bookmaker.trim().toUpperCase() === bookmaker,
	);
}

function findAnalysisCandidate(match: MatchRecord): ValueBetCandidate {
	let bestBet: ValueBetCandidate | null = null;

	for (const bookmaker of bookmakers) {
		const odds = findBookmakerOdds(match, bookmaker.key);
		if (!odds) continue;

		for (const outcome of outcomes) {
			const odd = odds[outcome.oddKey];
			const value = calculateExpectedValue(
				odd,
				match[outcome.probabilityKey],
			);
			if (
				value.expectedValue > 0 &&
				(!bestBet || value.expectedValue > bestBet.ev)
			) {
				bestBet = {
					betSelection: `${outcome.label} (${bookmaker.label})`,
					odd,
					ev: value.expectedValue,
				};
			}
		}
	}

	if (bestBet) return bestBet;

	let favorite: ValueBetCandidate | null = null;
	for (const bookmaker of bookmakers) {
		const odds = findBookmakerOdds(match, bookmaker.key);
		if (!odds) continue;

		for (const outcome of outcomes) {
			const odd = odds[outcome.oddKey];
			if (
				Number.isFinite(odd) &&
				odd > 1 &&
				(!favorite || favorite.odd === null || odd < favorite.odd)
			) {
				favorite = {
					betSelection: `Análise geral do confronto; favorito de mercado: ${outcome.label} (${bookmaker.label})`,
					odd,
					ev: 0,
				};
			}
		}
	}

	return (
		favorite ?? {
			betSelection: "Análise geral do confronto; não existem odds disponíveis.",
			odd: null,
			ev: 0,
		}
	);
}

function isValueBetAnalysis(value: unknown): value is ValueBetAnalysis {
	if (!value || typeof value !== "object") return false;
	const analysis = value as Record<string, unknown>;
	return (
		(analysis.riskLevel === "BAIXO" ||
			analysis.riskLevel === "MEDIO" ||
			analysis.riskLevel === "ELEVADO") &&
		typeof analysis.absences === "string" &&
		typeof analysis.formTrend === "string" &&
		typeof analysis.context === "string" &&
		typeof analysis.verdict === "string"
	);
}

function LoadingCard() {
	return (
		<div className="animate-pulse overflow-hidden rounded-lg border border-[var(--line)] bg-white">
			<div className="h-12 bg-[var(--surface-muted)]" />
			<div className="grid gap-6 p-5 lg:grid-cols-2">
				<div className="space-y-3">
					<div className="h-7 w-2/3 rounded bg-[var(--line)]" />
					<div className="h-7 w-1/2 rounded bg-[var(--line)]" />
					<div className="h-16 rounded bg-[var(--surface-muted)]" />
				</div>
				<div className="h-36 rounded bg-[var(--surface-muted)]" />
			</div>
		</div>
	);
}

export default function Home() {
	const [matches, setMatches] = useState<MatchRecord[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [onlyValue, setOnlyValue] = useState(false);
	const [selectedLeague, setSelectedLeague] = useState("all");
	const [reloadKey, setReloadKey] = useState(0);
	const [isSyncing, setIsSyncing] = useState(false);
	const [syncError, setSyncError] = useState<string | null>(null);
	const [analysisByMatch, setAnalysisByMatch] = useState<
		Record<string, AnalysisState>
	>({});

	useEffect(() => {
		const controller = new AbortController();

		async function loadMatches() {
			setIsLoading(true);
			setError(null);

			try {
				const response = await fetch("/api/matches", {
					signal: controller.signal,
				});
				if (!response.ok) {
					throw new Error("Não foi possível carregar os jogos.");
				}

				const data: MatchRecord[] = await response.json();
				setMatches(data);
			} catch (loadError) {
				if (!controller.signal.aborted) {
					setError(
						loadError instanceof Error
							? loadError.message
							: "Ocorreu um erro inesperado.",
					);
				}
			} finally {
				if (!controller.signal.aborted) {
					setIsLoading(false);
				}
			}
		}

		void loadMatches();
		return () => controller.abort();
	}, [reloadKey]);

	async function handleSync() {
		setIsSyncing(true);
		setSyncError(null);

		try {
			const response = await fetch("/api/sync", { method: "POST" });
			if (!response.ok) {
				let data: { error?: string } | null = null;
				try {
					data = (await response.json()) as { error?: string };
				} catch {
					data = null;
				}
				throw new Error(
					data?.error ??
						`Não foi possível sincronizar as odds (HTTP ${response.status}).`,
				);
			}

			const result: { success?: boolean } = await response.json();
			if (!result.success) {
				throw new Error("A sincronização não foi concluída com sucesso.");
			}
		} catch (syncFailure) {
			setSyncError(
				syncFailure instanceof Error
					? syncFailure.message
					: "Ocorreu um erro ao sincronizar as odds.",
			);
		} finally {
			setReloadKey((key) => key + 1);
			setIsSyncing(false);
		}
	}

	async function handleAnalyzeBet(
		match: MatchRecord,
		candidate: ValueBetCandidate,
	) {
		setAnalysisByMatch((current) => ({
			...current,
			[match.id]: { loading: true },
		}));

		try {
			const response = await fetch("/api/analyze-bet", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					homeTeam: match.homeTeam.name,
					awayTeam: match.awayTeam.name,
					betSelection: candidate.betSelection,
					odd: candidate.odd,
					ev: candidate.ev,
				}),
			});
			const data: unknown = await response.json();

			if (!response.ok) {
				throw new Error(
					data &&
						typeof data === "object" &&
						"error" in data &&
						typeof data.error === "string"
						? data.error
						: "Não foi possível analisar o risco da aposta.",
				);
			}
			if (!isValueBetAnalysis(data)) {
				throw new Error("A resposta da análise veio num formato inválido.");
			}

			setAnalysisByMatch((current) => ({
				...current,
				[match.id]: { loading: false, data },
			}));
		} catch (error) {
			setAnalysisByMatch((current) => ({
				...current,
				[match.id]: {
					loading: false,
					error:
						error instanceof Error
							? error.message
							: "Ocorreu um erro ao analisar a aposta.",
				},
			}));
		}
	}

	const leagues = [...new Set(matches.map((match) => match.league))].sort();
	const matchesWithConsensus = matches.map((match) => {
		const seenBookmakers = new Set<string>();
		const distinctBookmakerOdds = match.odds.filter((odd) => {
			const bookmaker = odd.bookmaker.trim().toUpperCase();
			if (seenBookmakers.has(bookmaker)) return false;
			seenBookmakers.add(bookmaker);
			return true;
		});
		const consensus = calculateConsensusFairProbabilities(
			distinctBookmakerOdds,
		);

		return consensus
			? {
					...match,
					estimatedProbHome: consensus.homeProb,
					estimatedProbDraw: consensus.drawProb,
					estimatedProbAway: consensus.awayProb,
					probabilitySource: "MARKET_FAIR" as const,
				}
			: match;
	});
	const activeValueCount = matchesWithConsensus.reduce(
		(total, match) =>
			total +
			match.odds.reduce((count, odd) => count + outcomes.filter((outcome) =>
				calculateExpectedValue(
					odd[outcome.oddKey],
					match[outcome.probabilityKey],
				).hasValue,
			).length, 0),
		0,
	);
	const visibleMatches = matchesWithConsensus.filter((match) => {
		const inSelectedLeague =
			selectedLeague === "all" || match.league === selectedLeague;
		return inSelectedLeague && (!onlyValue || hasValueBet(match));
	});

	return (
		<div className="min-h-screen">
			<header className="dashboard-header text-white">
				<div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-7 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10">
					<div className="flex items-start gap-4">
						<div className="brand-mark" aria-hidden="true">VB</div>
						<div>
							<p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300">
								Quant Lab / 01
							</p>
							<h1 className="text-2xl font-semibold leading-tight sm:text-3xl">
								ValueBet Engine
							</h1>
							<p className="mt-1 text-sm text-emerald-50/70">
								Quantitative Sports Betting &amp; EV Tracker
							</p>
						</div>
					</div>

					<div className="relative flex flex-col gap-4 border-t border-white/15 pt-5 sm:flex-row sm:items-center sm:border-l sm:border-t-0 sm:pt-0 lg:ml-auto">
						<div className="grid grid-cols-2 sm:w-fit">
							<div className="pr-6 sm:px-7">
								<p className="text-xs font-medium uppercase tracking-[0.1em] text-emerald-50/65">
									Banca teórica
								</p>
								<p className="mt-1 font-mono text-2xl font-medium tabular-nums">
									{euroFormatter.format(bankroll)}
								</p>
							</div>
							<div className="border-l border-white/15 pl-6 sm:px-7">
								<p className="text-xs font-medium uppercase tracking-[0.1em] text-emerald-50/65">
									Value Bets ativas
								</p>
								<p className="mt-1 flex items-baseline gap-2 font-mono text-2xl font-medium tabular-nums">
									{activeValueCount}
									<span className="font-sans text-xs font-medium text-emerald-300">
										seleções
									</span>
								</p>
							</div>
						</div>
						<button
							type="button"
							onClick={handleSync}
							disabled={isSyncing}
							className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-emerald-400 px-4 text-sm font-semibold text-[#10251a] transition-colors hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-70"
						>
							{isSyncing && (
								<span
									className="size-4 animate-spin rounded-full border-2 border-[#10251a]/30 border-t-[#10251a]"
									aria-hidden="true"
								/>
							)}
							{isSyncing ? "A sincronizar..." : "Sincronizar Odds Reais"}
						</button>
						{syncError && (
							<p className="text-xs text-rose-200 sm:absolute sm:right-0 sm:top-full sm:z-10 sm:mt-2" role="alert">
								{syncError}
							</p>
						)}
					</div>
				</div>
			</header>

			<main className="mx-auto w-full max-w-7xl flex-1 px-5 pb-12 pt-8 sm:px-8 lg:px-10">
				<section className="mb-6 flex flex-col gap-4 border-b border-[var(--line)] pb-5 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-strong)]">
							Mercados monitorizados
						</p>
						<h2 className="mt-1 text-xl font-semibold text-[var(--foreground)]">
							Próximos jogos
						</h2>
					</div>
					<div className="flex flex-wrap items-center gap-3">
						<div className="flex h-10 items-center gap-3 rounded-md border border-[var(--line)] bg-white px-3 text-sm font-medium text-[var(--foreground)]">
							<span>Apenas +EV</span>
							<button
								type="button"
								role="switch"
								aria-checked={onlyValue}
								aria-label="Filtrar apenas Value Bets"
								onClick={() => setOnlyValue((current) => !current)}
								className={`relative h-5 w-9 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${onlyValue ? "bg-[var(--accent)]" : "bg-[#b9c5bd]"}`}
							>
								<span
									className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform ${onlyValue ? "translate-x-4" : "translate-x-0"}`}
								/>
							</button>
						</div>
						<label className="flex h-10 items-center rounded-md border border-[var(--line)] bg-white px-3 text-sm">
							<span className="sr-only">Filtrar por liga</span>
							<select
								value={selectedLeague}
								onChange={(event) => setSelectedLeague(event.target.value)}
								className="max-w-44 cursor-pointer bg-transparent pr-2 font-medium text-[var(--foreground)] outline-none"
							>
								<option value="all">Todas as ligas</option>
								{leagues.map((league) => (
									<option key={league} value={league}>
										{league}
									</option>
								))}
							</select>
						</label>
					</div>
				</section>

				{isLoading ? (
					<div className="space-y-4" aria-label="A carregar jogos">
						<LoadingCard />
						<LoadingCard />
					</div>
				) : error ? (
					<div className="rounded-lg border border-rose-200 bg-white px-6 py-10 text-center">
						<p className="font-semibold text-[var(--foreground)]">
							Não foi possível carregar os jogos
						</p>
						<p className="mt-1 text-sm text-[var(--muted)]">{error}</p>
						<button
							type="button"
							onClick={() => setReloadKey((key) => key + 1)}
							className="mt-4 rounded-md bg-[var(--dark-panel)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]"
						>
							Tentar novamente
						</button>
					</div>
				) : visibleMatches.length === 0 ? (
					<div className="rounded-lg border border-dashed border-[var(--line-strong)] bg-white/70 px-6 py-14 text-center">
						<div className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--surface-muted)] font-mono text-lg font-semibold text-[var(--accent-strong)]">
							—
						</div>
						<h3 className="mt-4 text-base font-semibold text-[var(--foreground)]">
							{matches.length === 0
								? "Ainda não existem jogos registados"
								: "Sem jogos para estes filtros"}
						</h3>
						<p className="mt-1 text-sm text-[var(--muted)]">
							{matches.length === 0
								? "Os jogos e mercados disponíveis aparecerão aqui."
								: "Altera os filtros para veres outros mercados."}
						</p>
					</div>
				) : (
					<div className="space-y-4">
						{visibleMatches.map((match, index) => {
							const analysisCandidate = findAnalysisCandidate(match);
							const analysis = analysisByMatch[match.id];

							return <article
								key={match.id}
								className="match-card overflow-hidden rounded-lg border border-[var(--line)] bg-white"
								style={{ animationDelay: `${index * 70}ms` }}
							>
								<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--line)] bg-[var(--surface-muted)] px-5 py-3">
									<div className="flex flex-wrap items-center gap-2.5">
										<span className="font-mono text-xs font-semibold uppercase text-[var(--foreground)]">
											{new Date(match.date).toLocaleDateString("pt-PT", {
												weekday: "short",
												day: "2-digit",
												month: "short",
											})}
										</span>
										<span className="size-1 rounded-full bg-[var(--line-strong)]" />
										<span className="text-xs font-medium text-[var(--muted)]">
											{match.league}
										</span>
									</div>
									<span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
										{match.probabilitySource === "MARKET_FAIR"
											? "Fair odds / sem vigorish"
											: "Estimativa do modelo"}
									</span>
								</div>

								<div className="grid gap-6 p-5 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10 lg:px-6 lg:py-6">
									<div>
										<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
											<div className="space-y-2.5">
												<div className="flex items-center gap-3">
													<span className="team-mark" aria-hidden="true">
														{match.homeTeam.name.slice(0, 1)}
													</span>
													<h3 className="text-lg font-semibold text-[var(--foreground)]">
														{match.homeTeam.name}
													</h3>
												</div>
												<div className="flex items-center gap-3">
													<span className="team-mark team-mark-away" aria-hidden="true">
														{match.awayTeam.name.slice(0, 1)}
													</span>
													<h3 className="text-lg font-semibold text-[var(--foreground)]">
														{match.awayTeam.name}
													</h3>
												</div>
											</div>
											<p className="font-mono text-xs font-medium uppercase text-[var(--muted)] sm:pr-2">
												VS
											</p>
										</div>

										<div className="mt-5 grid grid-cols-3 gap-2 border-t border-[var(--line)] pt-4">
											{outcomes.map((outcome) => (
												<div
													key={outcome.key}
													className="rounded-md bg-[var(--surface-muted)] px-3 py-2.5"
												>
													<p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
														{outcome.label}
													</p>
													<p className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--foreground)]">
														{formatPercent(match[outcome.probabilityKey])}
													</p>
												</div>
											))}
										</div>
									</div>

									<div className="min-w-0 border-t border-[var(--line)] pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
										<div className="mb-3 flex items-center justify-between">
											<h4 className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
												Odds por bookmaker
											</h4>
											<span className="font-mono text-[10px] uppercase text-[var(--muted)]">
											Value Bet: EV ≥ 2%
											</span>
										</div>
										<div className="overflow-x-auto">
											<table className="w-full min-w-[480px] border-separate border-spacing-y-1 text-left">
												<thead>
													<tr className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
														<th className="w-[24%] pb-1 pl-2">Bookmaker</th>
														{outcomes.map((outcome, index) => (
															<th key={outcome.key} className="pb-1 text-center">
																{index === 0 ? "1 / Casa" : index === 1 ? "X" : "2 / Fora"}
															</th>
														))}
													</tr>
												</thead>
												<tbody>
													{bookmakers.map((bookmaker) => {
														const odd = findBookmakerOdds(match, bookmaker.key);
														return (
															<tr key={bookmaker.key}>
																<th className="rounded-l-md bg-[var(--surface-muted)] px-2 py-2 text-xs font-semibold text-[var(--foreground)]">
																	{bookmaker.label}
																</th>
																{outcomes.map((outcome, index) => {
																	const rival = bookmakers.find(
																		(candidate) => candidate.key !== bookmaker.key,
																	);
																	const rivalOdd = rival
																		? findBookmakerOdds(match, rival.key)
																		: undefined;
																	const oddValue = odd?.[outcome.oddKey];
																	const probability = match[outcome.probabilityKey];
																	const valueResult =
																		oddValue === undefined
																			? undefined
																			: calculateExpectedValue(
																					oddValue,
																					probability,
																				);
																	const value = valueResult?.expectedValue;
																	const rivalOddValue = rivalOdd?.[outcome.oddKey];
																	const isBest =
																		oddValue !== undefined &&
																		(rivalOddValue === undefined ||
																			oddValue > rivalOddValue);
																	const isValue = valueResult?.hasValue ?? false;
																	const stake =
																		isValue && oddValue !== undefined
																			? calculateKellyStake(
																					bankroll,
																					oddValue,
																					probability,
																				)
																			: { stake: 0, percentage: 0 };

																	return (
																		<td
																			key={outcome.key}
																			className={`px-1 py-1 ${index === outcomes.length - 1 ? "rounded-r-md" : ""} ${isBest || isValue ? "bg-emerald-100" : "bg-[var(--surface-muted)]"}`}
																		>
																			<div className="text-center">
																				<p className={`font-mono text-sm font-semibold tabular-nums ${isBest || isValue ? "text-emerald-800" : "text-[var(--foreground)]"}`}>
																					{oddValue === undefined ? "-" : oddValue.toFixed(2)}
																				</p>
																				{value !== undefined && (
																					<p className={`font-mono text-[10px] font-semibold tabular-nums ${isValue ? "text-emerald-700" : "text-[var(--muted)]"}`}>
																						{formatExpectedValue(value)}
																						{isValue && <span className="ml-1 uppercase">Value</span>}
																					</p>
																				)}
																				{isValue && (
																					<p className="mt-0.5 whitespace-nowrap text-[9px] font-semibold text-emerald-800">
																						{euroFormatter.format(stake.stake)} · {formatPercent(stake.percentage / 100)} da banca
																					</p>
																				)}
																			</div>
																		</td>
																	);
																})}
															</tr>
														);
													})}
												</tbody>
											</table>
										</div>
										<div className="mt-3">
											<button
												type="button"
												onClick={() =>
													void handleAnalyzeBet(match, analysisCandidate)
												}
												disabled={analysis?.loading}
												className="rounded-md border border-[var(--line)] px-2.5 py-1.5 text-xs font-semibold text-[var(--accent-strong)] transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-wait disabled:opacity-60"
											>
												{analysis?.loading
													? "A analisar contexto..."
													: "🔍 Analisar Risco (IA)"}
											</button>
											{analysis?.error && (
												<p className="mt-2 text-xs text-rose-700" role="alert">
													{analysis.error}
												</p>
											)}
											{analysis?.data && (
												<div className="mt-3 space-y-2 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-3 text-xs text-[var(--foreground)]">
													<div
														className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
															analysis.data.riskLevel === "BAIXO"
																? "bg-emerald-100 text-emerald-800"
																: analysis.data.riskLevel === "MEDIO"
																	? "bg-amber-100 text-amber-800"
																	: "bg-rose-100 text-rose-800"
														}`}
													>
														Risco {analysis.data.riskLevel}
													</div>
													<p><strong>🚑 Baixas / Disponibilidade:</strong> {analysis.data.absences}</p>
													<p><strong>📊 Momento Recente:</strong> {analysis.data.formTrend}</p>
													<p><strong>⚠️ Contexto / Desgaste:</strong> {analysis.data.context}</p>
													<p><strong>💡 Veredito:</strong> {analysis.data.verdict}</p>
												</div>
											)}
										</div>
									</div>
								</div>
							</article>;
						})}
					</div>
				)}
			</main>
		</div>
	);
}