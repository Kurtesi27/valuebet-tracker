import { scrapeBetanoPrimeiraLiga } from "../lib/services/scrapers/betanoScraper";

async function main() {
  console.log("--> A executar scrape da Betano 100% silencioso...");
  const t0 = Date.now();

  const jogos = await scrapeBetanoPrimeiraLiga();

  console.log(`\nTempo total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`Jogos capturados: ${jogos.length}\n`);

  jogos.forEach((j, i) => {
    console.log(`[${i + 1}] ${j.homeTeam} vs ${j.awayTeam} | 1: ${j.odds.home} | X: ${j.odds.draw} | 2: ${j.odds.away}`);
  });
}

main();