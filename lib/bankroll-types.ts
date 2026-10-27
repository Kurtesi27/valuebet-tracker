export const BANKROLL_BET_TYPES = [
	"Simples",
	"Multiplas",
	"Boosted ODD",
	"Desafio Bunde",
] as const;

export function normalizeBetText(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLocaleLowerCase("pt-PT")
		.replace(/\s+/g, " ")
		.trim();
}
