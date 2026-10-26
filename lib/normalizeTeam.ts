/** Normalizes whitespace, case, and diacritics for alias lookup. */
function normalizeLookupKey(name: string): string {
	return name
		.trim()
		.replace(/\s+/g, " ")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();
}

const PRIMEIRA_LIGA_ALIASES: Record<string, string> = {};

const PRIMEIRA_LIGA_TEAMS: Record<string, readonly string[]> = {
	"Sporting CP": [
		"Sporting",
		"Sporting CP",
		"Sporting Clube de Portugal",
		"Sporting Lisbon",
	],
	"SL Benfica": [
		"Benfica",
		"SL Benfica",
		"Sport Lisboa e Benfica",
		"Benfica Lisbon",
	],
	"Académico de Viseu": [
		"Academico Viseu",
		"Académico de Viseu",
		"Academico de Viseu FC",
		"Académico Viseu",
	],
	"FC Porto": [
		"Porto",
		"FC Porto",
		"F.C. Porto",
		"Futebol Clube do Porto",
		"Porto FC",
	],
	"SC Braga": [
		"Braga",
		"SC Braga",
		"Sporting Clube de Braga",
		"Sporting de Braga",
	],
	"Vitória SC": [
		"Vitória SC",
		"Vitoria SC",
		"Vitória de Guimarães",
		"Vitoria de Guimaraes",
		"Guimarães",
		"Guimaraes",
	],
	"Gil Vicente FC": ["Gil Vicente", "Gil Vicente FC"],
	"Moreirense FC": ["Moreirense", "Moreirense FC"],
	"Rio Ave FC": ["Rio Ave", "Rio Ave FC"],
	"FC Famalicão": [
		"Famalicão",
		"Famalicao",
		"FC Famalicão",
		"FC Famalicao",
		"Famalicão FC",
	],
	"Estoril Praia": ["Estoril", "Estoril Praia", "GD Estoril Praia"],
	"Estrela da Amadora": [
		"CF Estrela",
		"CF Estrela da Amadora",
		"Estrela da Amadora",
		"Estrela Amadora",
		"Estrela",
	],
	"CS Marítimo": [
		"Marítimo",
		"Maritimo",
		"CS Marítimo",
		"CS Maritimo",
		"Club Sport Marítimo",
	],
	"Casa Pia AC": ["Casa Pia", "Casa Pia AC", "Casa Pia Atlético Clube"],
	"FC Arouca": ["Arouca", "FC Arouca"],
	"CD Nacional": [
		"CD Nacional Madeira",
		"Nacional da Madeira",
		"CD Nacional",
		"Nacional",
	],
	"Santa Clara": ["Santa Clara", "CD Santa Clara"],
	"AVS Futebol SAD": ["AVS", "AVS Futebol SAD", "AVS SAD"],
	"Boavista FC": ["Boavista", "Boavista FC"],
	"SC Farense": ["Farense", "SC Farense"],
	"GD Chaves": ["Chaves", "GD Chaves"],
	"Portimonense SC": ["Portimonense", "Portimonense SC"],
	"Paços de Ferreira": [
		"Paços de Ferreira",
		"Pacos de Ferreira",
		"Paços Ferreira",
		"FC Paços de Ferreira",
	],
	"FC Vizela": ["Vizela", "FC Vizela"],
	"CD Tondela": ["Tondela", "CD Tondela"],
	"B-SAD": ["B-SAD", "BSAD", "Belenenses SAD"],
	"CF Os Belenenses": ["Os Belenenses", "CF Os Belenenses", "Belenenses"],
};

for (const [canonicalName, aliases] of Object.entries(PRIMEIRA_LIGA_TEAMS)) {
	for (const alias of aliases) {
		PRIMEIRA_LIGA_ALIASES[normalizeLookupKey(alias)] = canonicalName;
	}
}

const TEAM_ALIASES_BY_LEAGUE: Record<string, Record<string, string>> = {
	PRIMEIRA_LIGA: PRIMEIRA_LIGA_ALIASES,
};

/**
 * Returns the league's canonical team name, or the trimmed input when unknown.
 */
export function normalizeTeamName(rawName: string, leagueCode: string): string {
	const aliases = TEAM_ALIASES_BY_LEAGUE[leagueCode.trim().toUpperCase()];
	const trimmedName = rawName.trim();
	return aliases?.[normalizeLookupKey(trimmedName)] ?? trimmedName;
}
