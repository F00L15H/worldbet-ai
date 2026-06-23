/** Evalúa si una apuesta ganó según el resultado del partido */

export interface SettleContext {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

export function settleBet(
  marketType: string,
  marketLabel: string,
  ctx: SettleContext
): 'won' | 'lost' | 'void' {
  const { homeTeam, awayTeam, homeScore, awayScore } = ctx;
  const total = homeScore + awayScore;
  const homeWins = homeScore > awayScore;
  const awayWins = awayScore > homeScore;
  const isDraw = homeScore === awayScore;
  const bothScored = homeScore > 0 && awayScore > 0;
  const label = marketLabel.trim();

  switch (marketType) {
    case 'ganador': {
      if (/empate/i.test(label)) return isDraw ? 'won' : 'lost';
      if (label.includes(homeTeam) || label.startsWith(homeTeam)) return homeWins ? 'won' : 'lost';
      if (label.includes(awayTeam) || label.startsWith(awayTeam)) return awayWins ? 'won' : 'lost';
      return 'void';
    }
    case 'doble_chance': {
      if (label.includes(homeTeam) && /empate/i.test(label)) return (homeWins || isDraw) ? 'won' : 'lost';
      if (label.includes(awayTeam) && /empate/i.test(label)) return (awayWins || isDraw) ? 'won' : 'lost';
      return 'void';
    }
    case 'goles': {
      const overMatch = label.match(/Over\s+([\d.]+)/i);
      const underMatch = label.match(/Under\s+([\d.]+)/i);
      if (overMatch) {
        const line = parseFloat(overMatch[1]);
        return total > line ? 'won' : 'lost';
      }
      if (underMatch) {
        const line = parseFloat(underMatch[1]);
        return total < line ? 'won' : 'lost';
      }
      return 'void';
    }
    case 'btts': {
      if (/sí|si/i.test(label)) return bothScored ? 'won' : 'lost';
      if (/no/i.test(label)) return !bothScored ? 'won' : 'lost';
      return 'void';
    }
    case 'marcador': {
      const scoreMatch = label.match(/(\d+)\s*-\s*(\d+)/);
      if (scoreMatch) {
        const h = parseInt(scoreMatch[1], 10);
        const a = parseInt(scoreMatch[2], 10);
        return (homeScore === h && awayScore === a) ? 'won' : 'lost';
      }
      return 'void';
    }
    case 'primer_gol': {
      if (homeScore === 0 && awayScore === 0) return 'void';
      if (label.includes(homeTeam)) return homeScore > 0 && (awayScore === 0 || homeScore <= awayScore) ? 'won' : 'lost';
      if (label.includes(awayTeam)) return awayScore > 0 && (homeScore === 0 || awayScore <= homeScore) ? 'won' : 'lost';
      return 'void';
    }
    default:
      return 'void';
  }
}

export function calcPayout(stake: number, odds: number, result: 'won' | 'lost' | 'void'): number {
  if (result === 'won') return stake * (odds - 1);
  if (result === 'void') return 0;
  return 0;
}
