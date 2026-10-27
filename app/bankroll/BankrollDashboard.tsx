"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { BANKROLL_BET_TYPES } from "@/lib/bankroll-types";

type Summary = {
	initialBankroll: number;
	currentBankroll: number;
	totalProfit: number;
	totalStake: number;
	roi: number;
	wins: number;
	losses: number;
};

type PeriodSummary = Omit<Summary, "initialBankroll" | "currentBankroll">;

type Bet = {
	id: string;
	date: string;
	betType: string;
	selection: string;
	stake: number;
	profit: number;
	status: "GREEN" | "RED";
};

type DashboardData = {
	summary: Summary;
	selectedMonthSummary: PeriodSummary | null;
	selectedMonth: string | null;
	availableMonths: string[];
	monthly: { month: string; profit: number }[];
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

function formatCurrency(value: number): string {
	return euroFormatter.format(value);
}

function formatProfit(value: number): string {
	return `${value > 0 ? "+" : ""}${formatCurrency(value)}`;
}

function getLocalDateInputValue(): string {
	const now = new Date();
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
	const [savingBet, setSavingBet] = useState(false);
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [importing, setImporting] = useState(false);
	const [formMessage, setFormMessage] = useState("");
	const [formError, setFormError] = useState("");

	const loadDashboard = useCallback(async (signal?: AbortSignal, requestedPage = page) => {
		const query = new URLSearchParams({
			page: String(requestedPage),
			pageSize: "10",
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
	}, [monthFilter, page, searchFilter, statusFilter, typeFilter]);

	useEffect(() => {
		const controller = new AbortController();
		void Promise.resolve().then(() => loadDashboard(controller.signal));
		return () => controller.abort();
	}, [loadDashboard]);

	useEffect(() => {
		void Promise.resolve().then(() => setManualDate(getLocalDateInputValue()));
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
					profit: Number(manualProfit),
				}),
			});
			if (!response.ok) {
				throw new Error(
					await getErrorMessage(response, "Não foi possível guardar a aposta."),
				);
			}
			setManualStake("");
			setManualProfit("");
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

	const summary = data?.summary;
	const periodSummary = monthFilter
		? data?.selectedMonthSummary
		: data?.summary;
	const selectedMonthLabel = monthFilter ? fullMonthLabel(monthFilter) : "";
	const chartValues = data?.monthly.slice(-12) ?? [];
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
					<Link
						href="/"
						className="inline-flex h-10 items-center justify-center rounded-md border border-white/20 px-4 text-sm font-semibold text-emerald-50 transition-colors hover:bg-white/10"
					>
						Voltar ao ValueBet Engine
					</Link>
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
						description="Inicial + lucro/prejuízo"
						emphasis
					/>
					<SummaryCard
						label={monthFilter ? `P&L · ${selectedMonthLabel}` : "Lucro / prejuízo"}
						value={periodSummary ? formatProfit(periodSummary.totalProfit) : "—"}
						description={periodSummary ? `${formatCurrency(periodSummary.totalStake)} apostados${monthFilter ? " neste mês" : ""}` : "P&L líquido"}
						valueColor={
							periodSummary && periodSummary.totalProfit > 0
								? "text-[var(--accent-strong)]"
								: periodSummary && periodSummary.totalProfit < 0
									? "text-rose-700"
									: "text-[var(--foreground)]"
						}
					/>
					<SummaryCard
						label={monthFilter ? `ROI · ${selectedMonthLabel}` : "ROI global"}
						value={periodSummary ? `${percentFormatter.format(periodSummary.roi)}%` : "—"}
						description={monthFilter ? "Lucro líquido / stake do mês" : "Lucro líquido / total apostado"}
						valueColor={
							periodSummary && periodSummary.roi > 0
								? "text-[var(--accent-strong)]"
								: periodSummary && periodSummary.roi < 0
									? "text-rose-700"
									: "text-[var(--foreground)]"
						}
					/>
					<SummaryCard
						label={monthFilter ? `Greens / Reds · ${selectedMonthLabel}` : "Greens / Reds"}
						value={periodSummary ? `${periodSummary.wins} / ${periodSummary.losses}` : "—"}
						description={monthFilter ? "Apostas positivas / negativas no mês" : "Apostas positivas / negativas"}
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
							Registe apostas para visualizar o desempenho mensal.
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

				<section className="grid gap-6 lg:grid-cols-2">
					<div className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-sm sm:p-6">
						<div className="mb-5">
							<p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-strong)]">
								Registo manual
							</p>
							<h2 className="mt-1 text-lg font-semibold">Adicionar aposta</h2>
						</div>
						<form className="grid gap-4 sm:grid-cols-2" onSubmit={handleManualSubmit}>
							<label className="grid gap-1.5 text-sm font-medium">
								Data
								<input
									type="date"
									required
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
							<label className="grid gap-1.5 text-sm font-medium">
								Lucro / prejuízo líquido (€)
								<input
									type="number"
									required
									step="0.01"
									value={manualProfit}
									onChange={(event) => setManualProfit(event.target.value)}
									placeholder="-10,00 ou 15,00"
									className="h-10 rounded-md border border-[var(--line-strong)] bg-white px-3 outline-none focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-emerald-100"
								/>
							</label>
							<button
								type="submit"
								disabled={savingBet}
								className="h-11 rounded-md bg-[var(--dark-panel)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:cursor-wait disabled:opacity-60 sm:col-span-2"
							>
								{savingBet ? "A guardar..." : "Guardar aposta"}
							</button>
						</form>
					</div>

					<div className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-sm sm:p-6">
						<div className="mb-5">
							<p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-strong)]">
								Importação de histórico
							</p>
							<h2 className="mt-1 text-lg font-semibold">Carregar Excel ou CSV</h2>
							<p className="mt-1 text-sm text-[var(--muted)]">
								Colunas utilizadas: A (data), E (tipo), F (stake) e G (resultado).
							</p>
						</div>
						<form className="flex h-[calc(100%-5.5rem)] flex-col gap-4" onSubmit={handleImport}>
							<label
								htmlFor="bankroll-file"
								className="flex min-h-32 flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[var(--line-strong)] bg-[var(--surface-muted)] px-4 text-center transition-colors hover:border-[var(--accent)]"
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
								className="h-11 rounded-md border border-[var(--line-strong)] bg-white px-4 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
							>
								{importing ? "A importar..." : "Importar apostas"}
							</button>
						</form>
					</div>
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

				<section className="overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-sm">
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
									{data?.availableMonths.map((month) => (
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
								</select>
							</label>
						</div>
					</div>
					<div className="overflow-x-auto">
						<table className="w-full min-w-[640px] text-left text-sm">
							<thead className="bg-[var(--surface-muted)] text-xs uppercase tracking-wide text-[var(--muted)]">
								<tr>
									<th className="px-5 py-3 font-semibold sm:px-6">Data</th>
									<th className="px-5 py-3 font-semibold">Tipo</th>
									<th className="px-5 py-3 text-right font-semibold">Stake</th>
									<th className="px-5 py-3 text-right font-semibold">P&amp;L</th>
									<th className="px-5 py-3 text-right font-semibold sm:px-6">Estado</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-[var(--line)]">
								{loading && !data ? (
									<tr>
										<td colSpan={5} className="px-6 py-10 text-center text-[var(--muted)]">
											A carregar histórico...
										</td>
									</tr>
								) : data?.entries.bets.length ? (
									data.entries.bets.map((bet) => (
										<tr key={bet.id} className="hover:bg-[var(--surface-muted)]">
											<td className="whitespace-nowrap px-5 py-3.5 text-[var(--muted)] sm:px-6">
												{new Intl.DateTimeFormat("pt-PT", {
													timeZone: "UTC",
												}).format(new Date(bet.date))}
											</td>
											<td className="px-5 py-3.5 font-medium">{bet.betType}</td>
											<td className="whitespace-nowrap px-5 py-3.5 text-right font-mono tabular-nums">
												{formatCurrency(bet.stake)}
											</td>
											<td className={`whitespace-nowrap px-5 py-3.5 text-right font-mono tabular-nums ${bet.status === "GREEN" ? "text-[var(--accent-strong)]" : "text-rose-700"}`}>
												{formatProfit(bet.profit)}
											</td>
											<td className="px-5 py-3.5 text-right sm:px-6">
												<span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${bet.status === "GREEN" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
													{bet.status === "GREEN" ? "Green" : "Red"}
												</span>
											</td>
										</tr>
									))
								) : (
									<tr>
										<td colSpan={5} className="px-6 py-10 text-center text-[var(--muted)]">
											{loading ? "A atualizar histórico..." : "Ainda não existem apostas para estes filtros."}
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
					<div className="flex flex-col gap-3 border-t border-[var(--line)] px-5 py-4 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
						<p>
							{data
								? `${data.entries.total} apostas · página ${data.entries.page} de ${Math.max(1, data.entries.totalPages)}`
								: "A carregar..."}
						</p>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => setPage((current) => Math.max(1, current - 1))}
								disabled={page <= 1 || loading}
								className="rounded-md border border-[var(--line-strong)] px-3 py-2 font-medium text-[var(--foreground)] hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-40"
							>
								Anterior
							</button>
							<button
								type="button"
								onClick={() => setPage((current) => current + 1)}
								disabled={!data || page >= data.entries.totalPages || loading}
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
