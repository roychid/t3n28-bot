import fetch from 'node-fetch';

const API_BASE = 'https://v3.football.api-sports.io';
function buildHeaders() { 
  return { 'x-apisports-key': process.env.API_SPORTS_KEY }; 
}

async function apiFetch(path) {
  const res = await fetch(API_BASE + path, { headers: buildHeaders() });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${t}`);
  }
  return res.json();
}

/* ----------------------------
   Poisson Utilities
---------------------------- */
function factorial(n) { if (n < 2) return 1; let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; }
function poissonPmf(k, lambda) { if (lambda <= 0) return k === 0 ? 1 : 0; return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k); }
function computeLeagueAvg(history) {
  if (!history || history.length === 0) return 1.35;
  let total = 0;
  for (const m of history) total += (Number(m.home_goals) || 0) + (Number(m.away_goals) || 0);
  return total / (history.length * 2);
}
function computeTeamStrengths(history) {
  const gf = {}, ga = {}, matches = {};
  for (const m of history) {
    const h = m.home_team, a = m.away_team;
    const hg = Number(m.home_goals) || 0, ag = Number(m.away_goals) || 0;
    gf[h] = (gf[h] || 0) + hg; ga[h] = (ga[h] || 0) + ag; matches[h] = (matches[h] || 0) + 1;
    gf[a] = (gf[a] || 0) + ag; ga[a] = (ga[a] || 0) + hg; matches[a] = (matches[a] || 0) + 1;
  }
  const leagueAvg = computeLeagueAvg(history);
  const stats = {};
  for (const t of Object.keys(matches)) {
    const mcount = matches[t];
    stats[t] = { att: (gf[t] / mcount) / leagueAvg, def: (ga[t] / mcount) / leagueAvg };
  }
  return stats;
}
function expectedGoals(home, away, stats, leagueAvg, homeAdv = 1.08) {
  const hs = stats[home] || { att: 1, def: 1 };
  const as = stats[away] || { att: 1, def: 1 };
  return { lambdaH: leagueAvg * hs.att * as.def * homeAdv, lambdaA: leagueAvg * as.att * hs.def };
}
function outcomeProbabilities(lambdaH, lambdaA, maxGoals = 6) {
  let pH = 0, pD = 0, pA = 0;
  for (let i = 0; i <= maxGoals; i++) for (let j = 0; j <= maxGoals; j++) {
    const p = poissonPmf(i, lambdaH) * poissonPmf(j, lambdaA);
    if (i > j) pH += p; else if (i === j) pD += p; else pA += p;
  }
  const total = pH + pD + pA;
  if (total <= 0) return { home: 0.33, draw: 0.34, away: 0.33 };
  return { home: pH / total, draw: pD / total, away: pA / total };
}
function bestFromProbs(p) { if (!p) return '-'; return (p.home >= p.draw && p.home >= p.away) ? 'Home Win' : (p.away >= p.home && p.away >= p.draw) ? 'Away Win' : 'Draw'; }

/* ----------------------------
   API-Sports Helpers
---------------------------- */
async function fetchTeamFixtures(teamId, season, last = 40) {
  if (!teamId) return [];
  const path = `/fixtures?team=${teamId}&season=${season || ''}&status=FT&last=${last}`;
  const json = await apiFetch(path);
  return (json.response || []).map(r => ({
    home_team: r.teams?.home?.name || '',
    away_team: r.teams?.away?.name || '',
    home_goals: r.goals?.home ?? (r.score?.fulltime?.home ?? 0),
    away_goals: r.goals?.away ?? (r.score?.fulltime?.away ?? 0),
  }));
}

async function fetchLeagueFixtures(league, season, last = 40) {
  if (!league) return [];
  const path = `/fixtures?league=${league}&season=${season}&status=FT&last=${last}`;
  const json = await apiFetch(path);
  return (json.response || []).map(r => ({
    home_team: r.teams?.home?.name || '',
    away_team: r.teams?.away?.name || '',
    home_goals: r.goals?.home ?? (r.score?.fulltime?.home ?? 0),
    away_goals: r.goals?.away ?? (r.score?.fulltime?.away ?? 0),
  }));
}

/* ----------------------------
   API Handler
---------------------------- */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { fixture, options = {} } = req.body;
  const { league, season, home_advantage = 1.08, last = 40 } = options;

  if (!fixture || !fixture.home_team || !fixture.away_team) {
    return res.status(400).json({ error: 'Missing fixture data' });
  }

  try {
    let history = [];

    // 1) Fetch team histories
    if (fixture.home_id) history = history.concat(await fetchTeamFixtures(fixture.home_id, season, last));
    if (fixture.away_id) history = history.concat(await fetchTeamFixtures(fixture.away_id, season, last));

    // Remove duplicates
    const seen = new Set();
    history = history.filter(m => {
      const k = `${m.home_team}|${m.away_team}|${m.home_goals}|${m.away_goals}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    // 2) If still empty, fallback to league matches
    if (!history.length && league) {
      const leagueHistory = await fetchLeagueFixtures(league, season, last);
      history = history.concat(leagueHistory);
    }

    // 3) Compute Poisson
    const leagueAvg = computeLeagueAvg(history);
    const stats = computeTeamStrengths(history);
    const { lambdaH, lambdaA } = expectedGoals(fixture.home_team, fixture.away_team, stats, leagueAvg, home_advantage);
    const probabilities = outcomeProbabilities(lambdaH, lambdaA);

    const recommendation = bestFromProbs(probabilities);
    const confidence = Math.round(Math.max(probabilities.home, probabilities.draw, probabilities.away) * 100);

    res.json({
      probabilities,
      recommendation,
      expected_goals: { home: lambdaH, away: lambdaA },
      used_history_count: history.length,
      confidence
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Prediction failed', probabilities: { home: 0.33, draw: 0.34, away: 0.33 }, recommendation: '-', used_history_count: 0 });
  }
}
