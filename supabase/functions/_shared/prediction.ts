/** Predicción simplificada para snapshots server-side (misma semilla que DemoDataGenerator) */

const FIFA_RANKINGS: Record<string, number> = {
  Argentina: 1, France: 2, England: 3, Brazil: 4, Belgium: 5, Portugal: 6,
  Netherlands: 7, Spain: 8, Germany: 13, Mexico: 15, 'United States': 16, Japan: 17,
  Morocco: 11, Colombia: 12, Uruguay: 14, 'Korea Republic': 22, Canada: 26,
};

function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; };
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

function poisson(lambda: number, k: number) {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

function buildRecommendation(homeTeam: string, awayTeam: string, matchNumber: number) {
  const seed = matchNumber * 9973;
  const rand = seededRandom(seed);
  const homeRank = FIFA_RANKINGS[homeTeam] ?? 40;
  const awayRank = FIFA_RANKINGS[awayTeam] ?? 40;
  const homeLambda = 1.2 + (awayRank - homeRank) * 0.02 + rand() * 0.4;
  const awayLambda = 1.0 + (homeRank - awayRank) * 0.02 + rand() * 0.4;

  let homeWin = 0, draw = 0, awayWin = 0;
  let bestScore = { home: 0, away: 0, prob: 0 };
  for (let i = 0; i <= 5; i++) {
    for (let j = 0; j <= 5; j++) {
      const p = poisson(homeLambda, i) * poisson(awayLambda, j);
      if (i > j) homeWin += p;
      else if (i === j) draw += p;
      else awayWin += p;
      if (p > bestScore.prob) bestScore = { home: i, away: j, prob: p };
    }
  }

  const outcomes = [
    { label: `${homeTeam} gana`, prob: homeWin },
    { label: 'Empate', prob: draw },
    { label: `${awayTeam} gana`, prob: awayWin },
  ].sort((a, b) => b.prob - a.prob);

  const primary = outcomes[0];
  const over25 = 1 - poisson(homeLambda + awayLambda, 0) - poisson(homeLambda + awayLambda, 1) - poisson(homeLambda + awayLambda, 2);
  const goalsPick = over25 >= 0.5 ? 'Over 2.5 goles' : 'Under 2.5 goles';

  return {
    primaryBet: primary.label,
    primaryProb: primary.prob,
    primaryOdds: 1 / Math.max(primary.prob, 0.05),
    likelyScore: `${bestScore.home}-${bestScore.away}`,
    goalsPick,
    summary: `${primary.label} (${(primary.prob * 100).toFixed(1)}%) · Marcador ${bestScore.home}-${bestScore.away} · ${goalsPick}`,
    modelWinner: primary.label,
    modelWinnerProb: primary.prob,
  };
}

export { buildRecommendation };
