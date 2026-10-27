"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Fragment, type FormEvent } from "react";
import {
	BANKROLL_BET_TYPES,
	normalizeBetText,
} from "@/lib/bankroll-types";

type Summary = {
	initialBankroll: number;
	currentBankroll: number;
	totalProfit: number;
	totalStake: number;
	roi: number;
	wins: number;
	losses: number;
	pendingCount: number;
	pendingStake: number;
};

type PeriodSummary = Omit<Summary, "initialBankroll" | "currentBankroll">;

type Bet = {
	id: string;
	date: string;
	betType: string;
	selection: string;
	stake: number;
	profit: number;
	status: "GREEN" | "RED" | "PENDING" | "VOID";
};

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

type DashboardData = {
	summary: Summary;
	selectedYear: number;
	availableYears: number[];
	selectedMonthSummary: PeriodSummary | null;
	selectedMonth: string | null;
	availableMonths: string[];
	monthly: { month: string; profit: number }[];
	betTypePerformance: BetTypePerformance[];
	betTypes: string[];
	entries: {
		bets: Bet[];
		page: number;
		pageSize: number;
		total: number;
		totalPages: number;
	};
};

const euroFormatter = new Intl.NumberFormat("pt-PT", {
	style: "currency",
	currency: "EUR",
});
const percentFormatter = new Intl.NumberFormat("pt-PT", {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});
const DEFAULT_YEAR = 2026;
const PERFORMANCE_BET_TYPES = [
	"Multiplas",
	"Boosted ODD",
	"Simples",
	"Desafio Bunde",
] as const;
const EMPTY_BET_TYPE_PERFORMANCE: BetTypePerformance = {
	betType: "",
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

function formatCurrency(value: number): string {
	return euroFormatter.format(value);
}

function formatProfit(value: number): string {
	return `${value > 0 ? "+" : ""}${formatCurrency(value)}`;
}

function getLocalDateInputValue(year: number): string {
	const now = new Date();
	if (now.getFullYear() !== year) return `${year}-01-01`;
	const offset = now.getTimezoneOffset() * 60_000;
	return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

async function getErrorMessage(response: Response, fallback: string): Promise<string> {
	try {
		const result: unknown = await response.json();
		if (
			result &&
			typeof result === "object" &&
			"error" in result &&
			typeof result.error === "string"
		) {
			return result.error;
		}
	} catch {
		return fallback;
	}
	return fallback;
}

function monthLabel(value: string): string {
	const [year, month] = value.split("-").map(Number);
	return `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`;
}

function fullMonthLabel(value: string): string {
	const [year, month] = value.split("-").map(Number);
	const parts = new Intl.DateTimeFormat("pt-PT", {
		month: "long",
		timeZone: "UTC",
	}).formatToParts(new Date(Date.UTC(year, month - 1, 1)));
	const name = parts.find((part) => part.type === "month")?.value ?? "";
	return `${name.charAt(0).toLocaleUpperCase("pt-PT")}${name.slice(1)} ${year}`;
}

export default function BankrollDashboard() {
	const [data, setData] = useState<DashboardData | null>(null);
	const [selectedYear, setSelectedYear] = useState(DEFAULT_YEAR);
	const [selectedPerformanceType, setSelectedPerformanceType] =
		useState<string>("Multiplas");
	const [page, setPage] = useState(1);
	const [typeFilter, setTypeFilter] = useState("");
	const [statusFilter, setStatusFilter] = useState("");
	const [monthFilter, setMonthFilter] = useState("");
	const [searchFilter, setSearchFilter] = useState("");
	const [loading, setLoading] = useState(true);
	const [requestError, setRequestError] = useState("");
	const [manualDate, setManualDate] = useState("");
	const [manualType, setManualType] = useState("Simples");
	const [manualStake, setManualStake] = useState("");
	const [manualProfit, setManualProfit] = useState("");
	const [manualPending, setManualPending] = useState(false);
	const [savingBet, setSavingBet] = useState(false);
	const [editingBet, setEditingBet] = useState<Bet | null>(null);
	const [resolutionStatus, setResolutionStatus] = useState<
		"GREEN" | "RED" | "VOID"
	>("GREEN");
	const [resolutionProfit, setResolutionProfit] = useState("");
	const [savingResolution, setSavingResolution] = useState(false);
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [importing, setImporting] = useState(false);
	const [formMessage, setFormMessage] = useState("");
	const [formError, setFormError] = useState("");

	const loadDashboard = useCallback(async (signal?: AbortSignal, requestedPage = page) => {
		const query = new URLSearchParams({
			page: String(requestedPage),
			pageSize: "10",
			year: String(selectedYear),
		});
		if (typeFilter) query.set("type", typeFilter);
		if (statusFilter) query.set("status", statusFilter);
		if (monthFilter) query.set("month", monthFilter);
		if (searchFilter.trim()) query.set("q", searchFilter.trim());

		try {
			const response = await fetch(`/api/bankroll?${query}`, { signal });
			if (!response.ok) {
				throw new Error(
					await getErrorMessage(response, "Não foi possível carregar a banca."),
				);
			}
			const result = (await response.json()) as DashboardData;
			setData(result);
			setRequestError("");
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") return;
			setRequestError(
				error instanceof Error
					? error.message
					: "Ocorreu um erro ao carregar a banca.",
			);
		} finally {
			if (!signal?.aborted) setLoading(false);
		}
	}, [monthFilter, page, searchFilter, selectedYear, statusFilter, typeFilter]);

	useEffect(() => {
		const controller = new AbortController();
		void Promise.resolve().then(() => loadDashboard(controller.signal));
		return () => controller.abort();
	}, [loadDashboard]);

	useEffect(() => {
		void Promise.resolve().then(() =>
			setManualDate(getLocalDateInputValue(DEFAULT_YEAR)),
		);
	}, []);

	async function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSavingBet(true);
		setFormError("");
		setFormMessage("");

		try {
			const response = await fetch("/api/bankroll", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					date: new Date(`${manualDate}T12:00:00`).toISOString(),
					betType: manualType,
					stake: Number(manualStake),
					profit: manualPending ? 0 : Number(manualProfit),
					pending: manualPending,
				}),
			});
			if (!response.ok) {
				throw new Error(
					await getErrorMessage(response, "Não foi possível guardar a aposta."),
				);
			}
			setManualStake("");
			setManualProfit("");
			setManualPending(false);
			setFormMessage("Aposta guardada com sucesso.");
			if (page === 1) {
				setLoading(true);
				await loadDashboard();
			} else {
				setLoading(true);
				setPage(1);
			}
		} catch (error) {
			setFormError(
				error instanceof Error
					? error.message
					: "Ocorreu um erro ao guardar a aposta.",
			);
		} finally {
			setSavingBet(false);
		}
	}

	function startEditingBet(bet: Bet) {
		setEditingBet(bet);
		setResolutionStatus(
			bet.status === "PENDING"
				? "GREEN"
				: bet.status === "VOID"
					? "VOID"
					: bet.status,
		);
		setResolutionProfit(
			bet.status === "VOID" ? "0" : bet.profit === 0 ? "" : String(bet.profit),
		);
		setFormError("");
		setFormMessage("");
	}

	async function handleResolutionSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!editingBet) return;

		setSavingResolution(true);
		setFormError("");
		setFormMessage("");
		try {
			const response = await fetch(`/api/bankroll/${editingBet.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					status: resolutionStatus,
					profit:
						resolutionStatus === "VOID" ? 0 : Number(resolutionProfit),
				}),
			});
			if (!response.ok) {
				throw new Error(
					await getErrorMessage(
						response,
						"Não foi possível atualizar o resultado da aposta.",
					),
				);
			}

			setEditingBet(null);
			setFormMessage("Resultado da aposta atualizado.");
			setLoading(true);
			if (page === 1) {
				await loadDashboard();
			} else {
				setPage(1);
			}
		} catch (error) {
			setFormError(
				error instanceof Error
					? error.message
					: "Ocorreu um erro ao atualizar a aposta.",
			);
		} finally {
			setSavingResolution(false);
		}
	}

	async function handleImport(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!selectedFile) {
			setFormError("Selecione primeiro um ficheiro Excel ou CSV.");
			return;
		}

		setImporting(true);
		setFormError("");
		setFormMessage("");
		const formData = new FormData();
		formData.append("file", selectedFile);

		try {
			const response = await fetch("/api/bankroll/import", {
				method: "POST",
				body: formData,
			});
			const result: unknown = await response.json();
			if (!response.ok) {
				const message =
					result &&
					typeof result === "object" &&
					"error" in result &&
					typeof result.error === "string"
						? result.error
						: "Não foi possível importar o ficheiro.";
				throw new Error(message);
			}
			if (
				!result ||
				typeof result !== "object" ||
				!("imported" in result) ||
				typeof result.imported !== "number" ||
				!("skippedRows" in result) ||
				typeof result.skippedRows !== "number" ||
				!("parsedSheets" in result) ||
				!Array.isArray(result.parsedSheets) ||
				!result.parsedSheets.every((sheet) => typeof sheet === "string")
			) {
				throw new Error("A resposta da importação veio num formato inválido.");
			}
			setSelectedFile(null);
			const input = document.getElementById("bankroll-file") as HTMLInputElement | null;
			if (input) input.value = "";
			setFormMessage(
				`${result.imported} apostas importadas de ${result.parsedSheets.join(", ")}; ${result.skippedRows} linhas ignoradas.`,
			);
			if (page === 1) {
				setLoading(true);
				await loadDashboard();
			} else {
				setLoading(true);
				setPage(1);
			}
		} catch (error) {
			setFormError(
				error instanceof Error
					? error.message
					: "Ocorreu um erro ao importar o ficheiro.",
			);
		} finally {
			setImporting(false);
		}
	}

	const activeData = data?.selectedYear === selectedYear ? data : null;
	const summary = activeData?.summary;
	const periodSummary = monthFilter
		? activeData?.selectedMonthSummary
		: activeData?.summary;
	const selectedMonthLabel = monthFilter ? fullMonthLabel(monthFilter) : "";
	const chartValues = activeData?.monthly ?? [];
	const selectedTypePerformance =
		activeData?.betTypePerformance.find(
			(performance) =>
				normalizeBetText(performance.betType) ===
				normalizeBetText(selectedPerformanceType),
		) ?? EMPTY_BET_TYPE_PERFORMANCE;
	const yearOptions = [
		...new Set([
			selectedYear,
			...(activeData?.availableYears ?? [DEFAULT_YEAR]),
		]),
	].sort((first, second) => second - first);
	const maxMonthlyProfit = Math.max(
		1,
		...chartValues.map((month) => Math.abs(month.profit)),
	);

	return (
		<div className="min-h-screen">
			<header className="dashboard-header text-white">
				<div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-6 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10">
					<div className="flex items-center gap-4">
						<div className="brand-mark" aria-hidden="true">VB</div>
						<div>
							<p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300">
								Quant Lab / 02
							</p>
							<h1 className="text-2xl font-semibold leading-tight sm:text-3xl">
								Banca &amp; Apostas
							</h1>
							<p className="mt-1 text-sm text-emerald-50/70">
								Registe e acompanhe os resultados da sua banca.
							</p>
						</div>
					</div>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
						<label className="group relative flex h-12 cursor-pointer items-center gap-3 rounded-xl border border-white/15 bg-white/[0.07] px-3.5 text-emerald-50 shadow-sm backdrop-blur transition hover:border-emerald-300/50 hover:bg-white/10 focus-within:border-emerald-300/70 focus-within:ring-2 focus-within:ring-emerald-300/20">
							<span className="flex size-8 items-center justify-center rounded-lg bg-emerald-300/10 text-emerald-300 transition group-hover:bg-emerald-300/15">
								<svg
									aria-hidden="true"
									viewBox="0 0 24 24"
									fill="none"
									className="size-[18px]"
								>
									<rect x="3.75" y="5.75" width="16.5" height="14.5" rx="2.25" stroke="currentColor" strokeWidth="1.5" />
									<path d="M7.75 3.75v4M16.25 3.75v4M4 10h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
								</svg>
							</span>
							<span className="grid gap-0.5">
								<span className="text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-emerald-100/65">
									Período
								</span>
								<span aria-hidden="true" className="text-sm font-semibold leading-tight text-white">
									{selectedYear}
								</span>
							</span>
							<svg
								aria-hidden="true"
								viewBox="0 0 20 20"
								fill="none"
								className="ml-auto size-4 shrink-0 text-emerald-100/60 transition group-hover:text-emerald-100"
							>
								<path d="m5.5 7.5 4.5 4.5 4.5-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
							<select
								aria-label="Selecionar ano da banca"
								value={selectedYear}
								onChange={(event) => {
									const year = Number(event.target.value);
									setSelectedYear(year);
									setMonthFilter("");
									setPage(1);
									setManualDate(getLocalDateInputValue(year));
									setLoading(true);
								}}
								className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
							>
								{yearOptions.map((year) => (
									<option key={year} value={year} className="text-[var(--foreground)]">
										{year}
									</option>
								))}
							</select>
						</label>
						<Link
							href="/"
							className="inline-flex h-10 items-center justify-center rounded-md border border-white/20 px-4 text-sm font-semibold text-emerald-50 transition-colors hover:bg-white/10"
						>
							Voltar ao ValueBet Engine
						</Link>
					</div>
				</div>
			</header>

			<main className="mx-auto w-full max-w-7xl flex-1 space-y-7 px-5 pb-12 pt-8 sm:px-8 lg:px-10">
				<section aria-label="Resumo da banca" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
					<SummaryCard
						label="Banca inicial"
						value={summary ? formatCurrency(summary.initialBankroll) : "—"}
						description="Capital de referência"
					/>
					<SummaryCard
						label="Banca atual"
						value={summary ? formatCurrency(summary.currentBankroll) : "—"}
						description={`Banca inicial + P&L de ${selectedYear}`}
						emphasis
					/>
					<SummaryCard
						label={monthFilter ? `P&L · ${selectedMonthLabel}` : `Lucro / prejuízo · ${selectedYear}`}
						value={periodSummary ? formatProfit(periodSummary.totalProfit) : "—"}
						description={periodSummary ? `${formatCurrency(periodSummary.totalStake)} apostados${monthFilter ? " neste mês" : ` em ${selectedYear}`}` : "P&L líquido"}
						valueColor={
							periodSummary && periodSummary.totalProfit > 0
								? "text-[var(--accent-strong)]"
								: periodSummary && periodSummary.totalProfit < 0
									? "text-rose-700"
									: "text-[var(--foreground)]"
						}
					/>
					<SummaryCard
						label={monthFilter ? `ROI · ${selectedMonthLabel}` : `ROI · ${selectedYear}`}
						value={periodSummary ? `${percentFormatter.format(periodSummary.roi)}%` : "—"}
						description={monthFilter ? "Lucro líquido / stake do mês" : "Lucro líquido / stake do ano"}
						valueColor={
							periodSummary && periodSummary.roi > 0
								? "text-[var(--accent-strong)]"
								: periodSummary && periodSummary.roi < 0
									? "text-rose-700"
									: "text-[var(--foreground)]"
						}
					/>
					<SummaryCard
						label={monthFilter ? `Greens / Reds · ${selectedMonthLabel}` : `Greens / Reds · ${selectedYear}`}
						value={periodSummary ? `${periodSummary.wins} / ${periodSummary.losses}` : "—"}
						description={
							periodSummary
								? `${periodSummary.pendingCount} pendentes · ${formatCurrency(periodSummary.pendingStake)} em aberto`
								: monthFilter
									? "Apostas positivas / negativas no mês"
									: `Apostas positivas / negativas em ${selectedYear}`
						}
						valueColor="text-[var(--foreground)]"
					/>
				</section>

				{requestError && (
					<div className="flex flex-col gap-3 rounded-lg border border-rose-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
						<p className="text-sm text-rose-800">{requestError}</p>
						<button
							type="button"
							onClick={() => {
								setLoading(true);
								void loadDashboard();
							}}
							className="rounded-md bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100"
						>
							Tentar novamente
						</button>
					</div>
				)}

				<section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-sm sm:p-6">
					<div className="mb-5">
						<p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-strong)]">
							Desempenho
						</p>
						<h2 className="mt-1 text-lg font-semibold">Lucro / prejuízo mensal</h2>
					</div>
					{chartValues.length === 0 ? (
						<p className="rounded-md bg-[var(--surface-muted)] px-4 py-8 text-center text-sm text-[var(--muted)]">
							A carregar desempenho de {selectedYear}...
						</p>
					) : (
						<div className="space-y-3">
							{chartValues.map((month) => {
								const width = `${(Math.abs(month.profit) / maxMonthlyProfit) * 50}%`;
								return (
									<div
										key={month.month}
										className="grid grid-cols-[52px_minmax(0,1fr)_112px] items-center gap-3 text-xs sm:grid-cols-[72px_minmax(0,1fr)_140px] sm:text-sm"
									>
										<span className="font-medium capitalize text-[var(--muted)]">
											{monthLabel(month.month)}
										</span>
										<div className="relative h-6 rounded bg-[var(--surface-muted)]">
											<div className="absolute inset-y-0 left-1/2 w-px bg-[var(--line-strong)]" />
											<div
												className={`absolute inset-y-1 rounded-sm ${
													month.profit >= 0
														? "left-1/2 bg-[var(--accent)]"
														: "right-1/2 bg-rose-400"
												}`}
												style={{ width }}
											/>
										</div>
										<span
											className={`text-right font-mono tabular-nums ${
												month.profit > 0
													? "text-[var(--accent-strong)]"
													: month.profit < 0
														? "text-rose-700"
														: "text-[var(--muted)]"
											}`}
										>
											{formatProfit(month.profit)}
										</span>
									</div>
								);
							})}
						</div>
					)}
				</section>

				<section className="overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-sm">
					<div className="flex flex-col gap-4 border-b border-[var(--line)] px-5 pt-5 sm:px-6 sm:pt-6">
						<div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
							<div>
								<p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-strong)]">
									Desempenho
								</p>
								<h2 className="mt-1 text-lg font-semibold">
									Performance por Tipo de Aposta
								</h2>
							</div>
							<p className="text-xs text-[var(--muted)]">
								Resumo anual · {selectedYear}
							</p>
						</div>
						<div
							role="tablist"
							aria-label="Tipo de aposta"
							className="flex gap-2 overflow-x-auto pb-3"
						>
							{PERFORMANCE_BET_TYPES.map((betType) => (
								<button
									key={betType}
									id={`performance-tab-${normalizeBetText(betType).replace(/\s+/g, "-")}`}
									type="button"
									role="tab"
									aria-selected={
										normalizeBetText(selectedPerformanceType) ===
										normalizeBetText(betType)
									}
									onClick={() => setSelectedPerformanceType(betType)}
									className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
										normalizeBetText(selectedPerformanceType) ===
										normalizeBetText(betType)
											? "border-[var(--dark-panel)] bg-[var(--dark-panel)] text-white"
											: "border-[var(--line)] bg-white text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--foreground)]"
									}`}
								>
									{betType}
								</button>
							))}
						</div>
					</div>
					<div
						role="tabpanel"
						aria-labelledby={`performance-tab-${normalizeBetText(selectedPerformanceType).replace(/\s+/g, "-")}`}
						className="p-5 sm:p-6"
					>
						<div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_auto] lg:items-center">
							<div className="min-w-0">
								<span className="inline-flex max-w-full items-center rounded-full bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--foreground)]">
									{selectedPerformanceType}
								</span>
								<p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
									Lucro / prejuízo líquido
								</p>
								<p
									className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${
										selectedTypePerformance.netProfit > 0
											? "text-[var(--accent-strong)]"
											: selectedTypePerformance.netProfit < 0
												? "text-rose-700"
												: "text-[var(--foreground)]"
									}`}
								>
									{formatProfit(selectedTypePerformance.netProfit)}
								</p>
							</div>
							<div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
								<PerformanceMetric
									label="Total apostas"
									value={String(selectedTypePerformance.totalBets)}
								/>
								<PerformanceMetric
									label="Total apostado"
									value={formatCurrency(selectedTypePerformance.totalStake)}
								/>
								<PerformanceMetric
									label="ROI / Yield"
									value={`${percentFormatter.format(selectedTypePerformance.roi)}%`}
									valueClass={
										selectedTypePerformance.roi > 0
											? "text-[var(--accent-strong)]"
											: selectedTypePerformance.roi < 0
												? "text-rose-700"
												: ""
									}
								/>
								<PerformanceMetric
									label="Taxa de Greens"
									value={`${percentFormatter.format(selectedTypePerformance.winRate)}%`}
								/>
								<div className="min-w-0">
									<p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
										Greens / Reds
									</p>
									<p className="mt-1 text-sm font-semibold tabular-nums">
										<span className="text-[var(--accent-strong)]">
											{selectedTypePerformance.wins}G
										</span>
										{" / "}
										<span className="text-rose-700">
											{selectedTypePerformance.losses}R
										</span>
										{selectedTypePerformance.voidCount > 0 && (
											<span className="ml-1 text-xs font-medium text-[var(--muted)]">
												+ {selectedTypePerformance.voidCount} devolvidas
											</span>
										)}
									</p>
								</div>
								{selectedTypePerformance.pendingCount > 0 && (
									<div className="min-w-0">
										<p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">
											Pendentes
										</p>
										<p className="mt-1 text-sm font-semibold tabular-nums text-amber-800">
											{selectedTypePerformance.pendingCount} ·{" "}
											{formatCurrency(selectedTypePerformance.pendingStake)}
										</p>
									</div>
								)}
							</div>
							<button
								type="button"
								onClick={() => {
									setTypeFilter(selectedPerformanceType);
									setPage(1);
									setLoading(true);
									document
										.getElementById("bankroll-history")
										?.scrollIntoView({ behavior: "smooth", block: "start" });
								}}
								className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-[var(--line-strong)] px-4 text-sm font-semibold text-[var(--foreground)] transition-colors hover:border-[var(--accent-strong)] hover:bg-[var(--surface-muted)]"
							>
								Ver apostas na tabela
								<svg
									aria-hidden="true"
									viewBox="0 0 20 20"
									fill="none"
									className="size-4"
								>
									<path d="M4 10h12m0 0-4.5-4.5M16 10l-4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
								</svg>
							</button>
						</div>
					</div>
				</section>

				<section className="space-y-4">
					<div className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-sm sm:p-6">
						<div className="mb-5">
							<p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-strong)]">
								Registo manual
							</p>
							<h2 className="mt-1 text-lg font-semibold">Adicionar aposta</h2>
						</div>
						<form
							className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1.2fr_1fr_1fr_auto] xl:items-end"
							onSubmit={handleManualSubmit}
						>
							<label className="grid gap-1.5 text-sm font-medium">
								Data
								<input
									type="date"
									required
									min={`${selectedYear}-01-01`}
									max={`${selectedYear}-12-31`}
									value={manualDate}
									onChange={(event) => setManualDate(event.target.value)}
									className="h-10 rounded-md border border-[var(--line-strong)] bg-white px-3 outline-none focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-emerald-100"
								/>
							</label>
							<label className="grid gap-1.5 text-sm font-medium">
								Tipo de aposta
								<select
									required
									value={manualType}
									onChange={(event) => setManualType(event.target.value)}
									className="h-10 rounded-md border border-[var(--line-strong)] bg-white px-3 outline-none focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-emerald-100"
								>
									{BANKROLL_BET_TYPES.map((betType) => (
										<option key={betType} value={betType}>
											{betType}
										</option>
									))}
								</select>
							</label>
							<label className="grid gap-1.5 text-sm font-medium">
								Stake (€)
								<input
									type="number"
									required
									min="0.01"
									step="0.01"
									value={manualStake}
									onChange={(event) => setManualStake(event.target.value)}
									placeholder="0,00"
									className="h-10 rounded-md border border-[var(--line-strong)] bg-white px-3 outline-none focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-emerald-100"
								/>
							</label>
							<label className={`grid gap-1.5 text-sm font-medium ${manualPending ? "text-[var(--muted)]" : ""}`}>
								Lucro / prejuízo líquido (€)
								<input
									type="number"
									required={!manualPending}
									disabled={manualPending}
									step="0.01"
									value={manualProfit}
									onChange={(event) => setManualProfit(event.target.value)}
									placeholder={manualPending ? "A preencher ao resolver" : "-10,00 ou 15,00"}
									className="h-10 rounded-md border border-[var(--line-strong)] bg-white px-3 outline-none focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[var(--surface-muted)] disabled:text-[var(--muted)]"
								/>
							</label>
							<label className="flex min-h-10 items-center gap-3 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-sm font-medium sm:col-span-2 xl:col-span-4">
								<input
									type="checkbox"
									checked={manualPending}
									onChange={(event) => {
										setManualPending(event.target.checked);
										if (event.target.checked) setManualProfit("");
									}}
									className="size-4 accent-[var(--accent-strong)]"
								/>
								Aposta em aberto / Pendente
							</label>
							<button
								type="submit"
								disabled={savingBet}
								className="h-10 rounded-md bg-[var(--dark-panel)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:cursor-wait disabled:opacity-60 sm:col-span-2 xl:col-span-1"
							>
								{savingBet ? "A guardar..." : "Guardar aposta"}
							</button>
						</form>
					</div>

					<details className="group overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-sm">
						<summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] sm:px-6 [&::-webkit-details-marker]:hidden">
							<span className="inline-flex items-center gap-2.5">
								<svg
									aria-hidden="true"
									viewBox="0 0 24 24"
									fill="none"
									className="size-[18px] text-[var(--accent-strong)]"
								>
									<path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M4 14.5v4A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
								</svg>
								Importar Excel / CSV
								<span className="hidden font-normal text-[var(--muted)] sm:inline">
									Importação ocasional do histórico
								</span>
							</span>
							<svg
								aria-hidden="true"
								viewBox="0 0 20 20"
								fill="none"
								className="size-4 shrink-0 text-[var(--muted)] transition-transform group-open:rotate-180"
							>
								<path d="m5.5 7.5 4.5 4.5 4.5-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						</summary>
						<div className="border-t border-[var(--line)] p-5 sm:p-6">
							<div className="mb-4">
								<p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-strong)]">
									Importação de histórico
								</p>
								<h2 className="mt-1 text-lg font-semibold">Carregar Excel ou CSV</h2>
								<p className="mt-1 text-sm text-[var(--muted)]">
									Colunas utilizadas: A (data), E (tipo), F (stake) e G (resultado).
								</p>
							</div>
							<form
								className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
								onSubmit={handleImport}
							>
								<label
									htmlFor="bankroll-file"
									className="flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[var(--line-strong)] bg-[var(--surface-muted)] px-4 text-center transition-colors hover:border-[var(--accent)]"
								>
									<span className="text-sm font-semibold text-[var(--foreground)]">
										{selectedFile ? selectedFile.name : "Escolha um ficheiro para importar"}
									</span>
									<span className="mt-1 text-xs text-[var(--muted)]">
										.xlsx ou .csv · máximo 10 MB
									</span>
								</label>
								<input
									id="bankroll-file"
									type="file"
									accept=".xlsx,.csv"
									onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
									className="sr-only"
								/>
								<button
									type="submit"
									disabled={importing || !selectedFile}
									className="h-11 rounded-md border border-[var(--line-strong)] bg-white px-5 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
								>
									{importing ? "A importar..." : "Importar apostas"}
								</button>
							</form>
						</div>
					</details>
				</section>

				{(formError || formMessage) && (
					<div
						className={`rounded-lg border px-4 py-3 text-sm ${
							formError
								? "border-rose-200 bg-rose-50 text-rose-800"
								: "border-emerald-200 bg-emerald-50 text-emerald-900"
						}`}
						role={formError ? "alert" : "status"}
					>
						{formError || formMessage}
					</div>
				)}

				<section
					id="bankroll-history"
					className="scroll-mt-6 overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-sm"
				>
					<div className="flex flex-col gap-4 border-b border-[var(--line)] px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
						<div>
							<p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-strong)]">
								Histórico
							</p>
							<h2 className="mt-1 text-lg font-semibold">Apostas registadas</h2>
						</div>
						<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
							<label className="flex h-10 min-w-52 flex-1 items-center rounded-md border border-[var(--line)] bg-white px-3 text-sm sm:max-w-xs">
								<span className="sr-only">Pesquisar por tipo, notas ou seleção</span>
								<input
									type="search"
									value={searchFilter}
									onChange={(event) => {
										setSearchFilter(event.target.value);
										setPage(1);
										setLoading(true);
									}}
									placeholder="Pesquisar por tipo ou notas..."
									className="w-full bg-transparent outline-none placeholder:text-[var(--muted)]"
								/>
							</label>
							<label className="flex h-10 items-center rounded-md border border-[var(--line)] bg-white px-3 text-sm">
								<span className="sr-only">Filtrar por mês</span>
								<select
									value={monthFilter}
									onChange={(event) => {
										setMonthFilter(event.target.value);
										setPage(1);
										setLoading(true);
									}}
									className="max-w-52 bg-transparent pr-2 font-medium outline-none"
								>
									<option value="">Todos os meses</option>
									{activeData?.availableMonths.map((month) => (
										<option key={month} value={month}>
											{fullMonthLabel(month)}
										</option>
									))}
								</select>
							</label>
							<label className="flex h-10 items-center rounded-md border border-[var(--line)] bg-white px-3 text-sm">
								<span className="sr-only">Filtrar por tipo</span>
								<select
									value={typeFilter}
									onChange={(event) => {
										setTypeFilter(event.target.value);
										setPage(1);
										setLoading(true);
									}}
									className="max-w-44 bg-transparent pr-2 font-medium outline-none"
								>
									<option value="">Todos os tipos</option>
									{BANKROLL_BET_TYPES.map((betType) => (
										<option key={betType} value={betType}>
											{betType}
										</option>
									))}
								</select>
							</label>
							<label className="flex h-10 items-center rounded-md border border-[var(--line)] bg-white px-3 text-sm">
								<span className="sr-only">Filtrar por estado</span>
								<select
									value={statusFilter}
									onChange={(event) => {
										setStatusFilter(event.target.value);
										setPage(1);
										setLoading(true);
									}}
									className="bg-transparent pr-2 font-medium outline-none"
								>
									<option value="">Todos os estados</option>
									<option value="GREEN">Green</option>
									<option value="RED">Red</option>
									<option value="PENDING">Pendentes</option>
									<option value="VOID">Void</option>
								</select>
							</label>
						</div>
					</div>
					<div className="overflow-x-auto">
						<table className="w-full min-w-[760px] text-left text-sm">
							<thead className="bg-[var(--surface-muted)] text-xs uppercase tracking-wide text-[var(--muted)]">
								<tr>
									<th className="px-5 py-3 font-semibold sm:px-6">Data</th>
									<th className="px-5 py-3 font-semibold">Tipo</th>
									<th className="px-5 py-3 text-right font-semibold">Stake</th>
									<th className="px-5 py-3 text-right font-semibold">P&amp;L</th>
									<th className="px-5 py-3 text-right font-semibold sm:px-6">Estado</th>
									<th className="px-5 py-3 text-right font-semibold sm:px-6">Ação</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-[var(--line)]">
								{loading && !activeData ? (
									<tr>
										<td colSpan={6} className="px-6 py-10 text-center text-[var(--muted)]">
											A carregar histórico...
										</td>
									</tr>
								) : activeData?.entries.bets.length ? (
									activeData.entries.bets.map((bet) => (
										<Fragment key={bet.id}>
										<tr className="hover:bg-[var(--surface-muted)]">
											<td className="whitespace-nowrap px-5 py-3.5 text-[var(--muted)] sm:px-6">
												{new Intl.DateTimeFormat("pt-PT", {
													timeZone: "UTC",
												}).format(new Date(bet.date))}
											</td>
											<td className="px-5 py-3.5 font-medium">{bet.betType}</td>
											<td className="whitespace-nowrap px-5 py-3.5 text-right font-mono tabular-nums">
												{formatCurrency(bet.stake)}
											</td>
											<td className={`whitespace-nowrap px-5 py-3.5 text-right font-mono tabular-nums ${bet.status === "GREEN" ? "text-[var(--accent-strong)]" : bet.status === "RED" ? "text-rose-700" : "text-[var(--muted)]"}`}>
												{bet.status === "PENDING" ? "—" : formatProfit(bet.profit)}
											</td>
											<td className="px-5 py-3.5 text-right sm:px-6">
												<span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${bet.status === "GREEN" ? "bg-emerald-50 text-emerald-800" : bet.status === "RED" ? "bg-rose-50 text-rose-800" : bet.status === "PENDING" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"}`}>
													{bet.status === "GREEN" ? "Green" : bet.status === "RED" ? "Red" : bet.status === "PENDING" ? "Pendente" : "Void"}
												</span>
											</td>
											<td className="px-5 py-3.5 text-right sm:px-6">
												<button
													type="button"
													onClick={() => startEditingBet(bet)}
													className="rounded-md border border-[var(--line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--surface-muted)]"
												>
													{bet.status === "PENDING" ? "Resolver" : "Editar"}
												</button>
											</td>
										</tr>
										{editingBet?.id === bet.id && (
											<tr className="bg-[var(--surface-muted)]">
												<td colSpan={6} className="px-5 py-4 sm:px-6">
													<form
														onSubmit={handleResolutionSubmit}
														className="flex flex-col gap-3 sm:flex-row sm:items-end"
													>
														<label className="grid gap-1 text-xs font-semibold">
															Resultado
															<select
																value={resolutionStatus}
																onChange={(event) => {
																	const status = event.target.value as "GREEN" | "RED" | "VOID";
																	setResolutionStatus(status);
																	if (status === "VOID") setResolutionProfit("0");
																	else if (resolutionProfit === "0") setResolutionProfit("");
																}}
																className="h-10 min-w-36 rounded-md border border-[var(--line-strong)] bg-white px-3 text-sm font-normal"
															>
																<option value="GREEN">Green</option>
																<option value="RED">Red</option>
																<option value="VOID">Void / devolvida</option>
															</select>
														</label>
														<label className="grid gap-1 text-xs font-semibold">
															Lucro / prejuízo líquido (€)
															<input
																type="number"
																required={resolutionStatus !== "VOID"}
																disabled={resolutionStatus === "VOID"}
																step="0.01"
																value={resolutionProfit}
																onChange={(event) => setResolutionProfit(event.target.value)}
																placeholder={resolutionStatus === "RED" ? "-5,00" : "5,00"}
																className="h-10 rounded-md border border-[var(--line-strong)] bg-white px-3 text-sm font-normal disabled:bg-[var(--surface-muted)]"
															/>
														</label>
														<div className="flex gap-2">
															<button
																type="submit"
																disabled={savingResolution}
																className="h-10 rounded-md bg-[var(--dark-panel)] px-4 text-sm font-semibold text-white hover:bg-[var(--accent-strong)] disabled:opacity-60"
															>
																{savingResolution ? "A guardar..." : "Guardar"}
															</button>
															<button
																type="button"
																onClick={() => setEditingBet(null)}
																disabled={savingResolution}
																className="h-10 rounded-md border border-[var(--line-strong)] bg-white px-4 text-sm font-semibold hover:bg-[var(--surface-muted)]"
															>
																Cancelar
															</button>
														</div>
														<p className="text-xs text-[var(--muted)] sm:ml-auto">
															Green exige lucro positivo; Red, prejuízo negativo.
														</p>
													</form>
												</td>
											</tr>
										)}
										</Fragment>
									))
								) : (
									<tr>
										<td colSpan={6} className="px-6 py-10 text-center text-[var(--muted)]">
											{loading ? "A atualizar histórico..." : "Ainda não existem apostas para estes filtros."}
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
					<div className="flex flex-col gap-3 border-t border-[var(--line)] px-5 py-4 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
						<p>
							{activeData
								? `${activeData.entries.total} apostas · página ${activeData.entries.page} de ${Math.max(1, activeData.entries.totalPages)}`
								: "A carregar..."}
						</p>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => setPage((current) => Math.max(1, current - 1))}
								disabled={!activeData || page <= 1 || loading}
								className="rounded-md border border-[var(--line-strong)] px-3 py-2 font-medium text-[var(--foreground)] hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-40"
							>
								Anterior
							</button>
							<button
								type="button"
								onClick={() => setPage((current) => current + 1)}
								disabled={!activeData || page >= activeData.entries.totalPages || loading}
								className="rounded-md border border-[var(--line-strong)] px-3 py-2 font-medium text-[var(--foreground)] hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-40"
							>
								Seguinte
							</button>
						</div>
					</div>
				</section>
			</main>
		</div>
	);
}

function PerformanceMetric({
	label,
	value,
	valueClass = "",
}: {
	label: string;
	value: string;
	valueClass?: string;
}) {
	return (
		<div className="min-w-0">
			<p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
				{label}
			</p>
			<p className={`mt-1 truncate text-sm font-semibold tabular-nums text-[var(--foreground)] ${valueClass}`}>
				{value}
			</p>
		</div>
	);
}

function SummaryCard({
	label,
	value,
	description,
	emphasis = false,
	valueColor = "text-[var(--foreground)]",
}: {
	label: string;
	value: string;
	description: string;
	emphasis?: boolean;
	valueColor?: string;
}) {
	return (
		<div
			className={`rounded-xl border p-5 shadow-sm ${
				emphasis
					? "border-[var(--accent-strong)] bg-[var(--dark-panel)] text-white"
					: "border-[var(--line)] bg-white"
			}`}
		>
			<p className={`text-xs font-semibold uppercase tracking-wide ${emphasis ? "text-emerald-200" : "text-[var(--muted)]"}`}>
				{label}
			</p>
			<p className={`mt-3 break-words font-mono text-2xl font-semibold tabular-nums ${emphasis ? "text-white" : valueColor}`}>
				{value}
			</p>
			<p className={`mt-2 text-xs ${emphasis ? "text-white/60" : "text-[var(--muted)]"}`}>
				{description}
			</p>
		</div>
	);
}
