/** Motor Poisson + Dixon-Coles alineado con PredictionEngine del cliente */

const FIFA_RANKINGS: Record<string, number> = {
  Argentina: 1, France: 2, England: 3, Brazil: 4, Belgium: 5, Portugal: 6,
  Netherlands: 7, Spain: 8, Germany: 13, Mexico: 15, 'United States': 16, Japan: 17,
  Morocco: 11, Colombia: 12, Uruguay: 14, 'Korea Republic': 22, Canada: 26,
};

const HOME_ADVANTAGE_GOALS = 0.12;
const DIXON_COLES_RHO = -0.13;
const LEAGUE_AVG = 1.35;

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

function dixonColesTau(i: number, j: number, homeLambda: number, awayLambda: number, rho = DIXON_COLES_RHO) {
  if (i === 0 && j === 0) return 1 - homeLambda * awayLambda * rho;
  if (i === 0 && j === 1) return 1 + homeLambda * rho;
  if (i === 1 && j === 0) return 1 + awayLambda * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

function predictScore(homeLambda: number, awayLambda: number) {
  homeLambda += HOME_ADVANTAGE_GOALS;
  let homeWin = 0, draw = 0, awayWin = 0;
  let bestScore = { home: 0, away: 0, prob: 0 };
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const tau = dixonColesTau(i, j, homeLambda, awayLambda);
      const p = tau * poisson(homeLambda, i) * poisson(awayLambda, j);
      if (i > j) homeWin += p;
      else if (i === j) draw += p;
      else awayWin += p;
      if (p > bestScore.prob) bestScore = { home: i, away: j, prob: p };
    }
  }
  const total = homeWin + draw + awayWin || 1;
  return {
    homeWin: homeWin / total,
    draw: draw / total,
    awayWin: awayWin / total,
    bestScore,
    homeLambda,
    awayLambda,
  };
}

function teamStrength(team: string, seed: number) {
  const rank = FIFA_RANKINGS[team] ?? 40;
  const rand = seededRandom(seed + team.length * 7);
  return {
    attack: 1.5 - rank * 0.015 + rand() * 0.3,
    defense: 0.7 + rank * 0.008 + rand() * 0.2,
  };
}

function pickConfidence(prob: number) {
  if (prob >= 0.50) return 'ALTA';
  if (prob >= 0.28) return 'MEDIA';
  return 'CULEBRA';
}

function buildRecommendation(homeTeam: string, awayTeam: string, matchNumber: number) {
  const seed = matchNumber * 9973;
  const home = teamStrength(homeTeam, seed);
  const away = teamStrength(awayTeam, seed + 1);
  const homeLambda = home.attack * away.defense * LEAGUE_AVG;
  const awayLambda = away.attack * home.defense * LEAGUE_AVG;
  const pred = predictScore(homeLambda, awayLambda);

  const outcomes = [
    { label: `${homeTeam} gana`, prob: pred.homeWin, type: 'ganador' },
    { label: 'Empate', prob: pred.draw, type: 'ganador' },
    { label: `${awayTeam} gana`, prob: pred.awayWin, type: 'ganador' },
  ].sort((a, b) => b.prob - a.prob);

  const primary = outcomes[0];
  let over25 = 0;
  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      if (h + a > 2) over25 += poisson(pred.homeLambda, h) * poisson(pred.awayLambda, a);
    }
  }
  const goalsPick = over25 >= 0.5 ? 'Over 2.5 goles' : 'Under 2.5 goles';

  return {
    primaryBet: primary.label,
    primaryType: primary.type,
    primaryProb: primary.prob,
    primaryOdds: Math.min(99, 0.92 / Math.max(primary.prob, 0.05)),
    primaryConfidence: pickConfidence(primary.prob),
    primaryAction: '🎯 Apuesta recomendada',
    primaryReason: 'Ganador más probable según Poisson + Dixon-Coles',
    likelyScore: `${pred.bestScore.home}-${pred.bestScore.away}`,
    likelyScoreProb: pred.bestScore.prob,
    goalsPick,
    goalsPickProb: over25 >= 0.5 ? over25 : 1 - over25,
    modelWinner: primary.label,
    modelWinnerProb: primary.prob,
    summary: `${primary.label} (${(primary.prob * 100).toFixed(1)}%) · Marcador ${pred.bestScore.home}-${pred.bestScore.away} · ${goalsPick}`,
  };
}

export { buildRecommendation };
