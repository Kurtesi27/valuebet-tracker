export type MatchProbabilities = {
	homeProb: number;
	drawProb: number;
	awayProb: number;
};

export type ExpectedValueResult = {
	expectedValue: number;
	hasValue: boolean;
	impliedProbability: number;
	fairOdd: number;
};

function logFactorial(value: number): number {
	let result = 0;

	for (let factor = 2; factor <= value; factor += 1) {
		result += Math.log(factor);
	}

	return result;
}

export function poissonProbability(lambda: number, k: number): number {
	if (
		!Number.isFinite(lambda) ||
		lambda < 0 ||
		!Number.isInteger(k) ||
		k < 0
	) {
		return 0;
	}

	if (lambda === 0) {
		return k === 0 ? 1 : 0;
	}

	// P(X = k) = exp(-lambda) * lambda^k / k!, calculated in log space.
	return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
}

export function calculateMatchProbabilities(
	homeExpectedGoals: number,
	awayExpectedGoals: number,
): MatchProbabilities {
	let homeProb = 0;
	let drawProb = 0;
	let awayProb = 0;

	for (let homeGoals = 0; homeGoals <= 5; homeGoals += 1) {
		const homeScoreProbability = poissonProbability(
			homeExpectedGoals,
			homeGoals,
		);

		for (let awayGoals = 0; awayGoals <= 5; awayGoals += 1) {
			const scoreProbability =
				homeScoreProbability *
				poissonProbability(awayExpectedGoals, awayGoals);

			if (homeGoals > awayGoals) {
				homeProb += scoreProbability;
			} else if (homeGoals === awayGoals) {
				drawProb += scoreProbability;
			} else {
				awayProb += scoreProbability;
			}
		}
	}

	// Normalize after truncating the independent Poisson distributions at five goals.
	const totalProbability = homeProb + drawProb + awayProb;
	if (totalProbability === 0) {
		return { homeProb: 0, drawProb: 0, awayProb: 0 };
	}

	return {
		homeProb: homeProb / totalProbability,
		drawProb: drawProb / totalProbability,
		awayProb: awayProb / totalProbability,
	};
}

export function calculateExpectedValue(
	odd: number,
	fairProbability: number,
	minEdge = 0.02,
): ExpectedValueResult {
	if (
		!Number.isFinite(odd) ||
		odd <= 1 ||
		!Number.isFinite(fairProbability) ||
		fairProbability <= 0 ||
		fairProbability >= 1
	) {
		return {
			expectedValue: 0,
			hasValue: false,
			impliedProbability: 0,
			fairOdd: 0,
		};
	}

	const impliedProbability = 1 / odd;
	const expectedValue = fairProbability * odd - 1;

	return {
		expectedValue,
		hasValue: expectedValue >= minEdge,
		impliedProbability,
		fairOdd: 1 / fairProbability,
	};
}

export function calculateKellyStake(
	bankroll: number,
	odd: number,
	fairProbability: number,
	fraction = 0.125,
	maxStakePercent = 0.03,
): { stake: number; percentage: number } {
	if (
		!Number.isFinite(bankroll) ||
		bankroll <= 0 ||
		!Number.isFinite(odd) ||
		odd <= 1 ||
		!Number.isFinite(fairProbability) ||
		fairProbability <= 0 ||
		fairProbability >= 1 ||
		!Number.isFinite(fraction) ||
		fraction <= 0 ||
		!Number.isFinite(maxStakePercent) ||
		maxStakePercent <= 0
	) {
		return { stake: 0, percentage: 0 };
	}

	const b = odd - 1;
	const q = 1 - fairProbability;
	const fStar = (b * fairProbability - q) / b;
	if (fStar <= 0) return { stake: 0, percentage: 0 };

	const recommendedFraction = Math.min(
		fStar * fraction,
		maxStakePercent,
	);
	const stake = Math.round(bankroll * recommendedFraction * 100) / 100;

	return {
		stake,
		percentage: recommendedFraction * 100,
	};
}

export type FairProbabilities = {
  fairHomeProb: number;
  fairDrawProb: number;
  fairAwayProb: number;
  marketMargin: number; // Ex: 0.025 para 2.5% de margem/vig
};

export function devig1X2(
	homeOdd: number,
	drawOdd: number,
	awayOdd: number,
): MatchProbabilities | null {
	if (
		![homeOdd, drawOdd, awayOdd].every(
			(odd) => Number.isFinite(odd) && odd > 1,
		)
	) {
		return null;
	}

	const invH = 1 / homeOdd;
	const invD = 1 / drawOdd;
	const invA = 1 / awayOdd;
	const overround = invH + invD + invA;
	if (!Number.isFinite(overround) || overround <= 0) return null;

	return {
		homeProb: invH / overround,
		drawProb: invD / overround,
		awayProb: invA / overround,
	};
}

/**
 * Remove a margem da casa de apostas (vig/juice) usando o método multiplicativo proporcional.
 * Utilizado primariamente com a Pinnacle ou casas 'sharp'.
 */
export function devigOdds(
  homeOdd: number,
  drawOdd: number,
  awayOdd: number
): FairProbabilities {
  if (homeOdd <= 1 || drawOdd <= 1 || awayOdd <= 1) {
    return { fairHomeProb: 0, fairDrawProb: 0, fairAwayProb: 0, marketMargin: 0 };
  }

  // Probabilidades implícitas brutas (a soma é > 1.0 devido à margem)
  const rawHome = 1 / homeOdd;
  const rawDraw = 1 / drawOdd;
  const rawAway = 1 / awayOdd;

  const sumRaw = rawHome + rawDraw + rawAway;
  const marketMargin = sumRaw - 1;

  // Normalização para obter a probabilidade justa (Fair Probability)
  return {
    fairHomeProb: rawHome / sumRaw,
    fairDrawProb: rawDraw / sumRaw,
    fairAwayProb: rawAway / sumRaw,
    marketMargin,
  };
}

export function calculateConsensusFairProbabilities(
	marketOdds: ReadonlyArray<{
		homeOdd: number;
		drawOdd: number;
		awayOdd: number;
	}>,
): MatchProbabilities | null {
	const deviggedList = marketOdds
		.map((market) =>
			devig1X2(market.homeOdd, market.drawOdd, market.awayOdd),
		)
		.filter((probabilities) => probabilities !== null);
	if (deviggedList.length === 0) return null;

	const sum = deviggedList.reduce(
		(acc, curr) => ({
			homeProb: acc.homeProb + curr.homeProb,
			drawProb: acc.drawProb + curr.drawProb,
			awayProb: acc.awayProb + curr.awayProb,
		}),
		{ homeProb: 0, drawProb: 0, awayProb: 0 },
	);
	const total = deviggedList.length;

	return {
		homeProb: sum.homeProb / total,
		drawProb: sum.drawProb / total,
		awayProb: sum.awayProb / total,
	};
}