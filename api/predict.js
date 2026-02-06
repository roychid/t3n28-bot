import fetch from 'node-fetch';

// ----- Poisson Utilities -----
function factorial(n){ if(n<2)return 1; let f=1; for(let i=2;i<=n;i++) f*=i; return f }
function poissonPmf(k, lambda){ if(lambda<=0)return k===0?1:0; return Math.exp(-lambda)*Math.pow(lambda,k)/factorial(k) }
function computeLeagueAvg(history){ 
  if(!history||history.length===0)return 1.35;
  let total=0;
  for(const m of history) total += (Number(m.home_goals)||0)+(Number(m.away_goals)||0);
  return total/(history.length*2);
}
function computeTeamStrengths(history){
  const gf={}, ga={}, matches={};
  for(const m of history){
    const h=m.home_team, a=m.away_team;
    const hg=Number(m.home_goals)||0, ag=Number(m.away_goals)||0;
    gf[h]=(gf[h]||0)+hg; ga[h]=(ga[h]||0)+ag; matches[h]=(matches[h]||0)+1;
    gf[a]=(gf[a]||0)+ag; ga[a]=(ga[a]||0)+hg; matches[a]=(matches[a]||0)+1;
  }
  const leagueAvg = computeLeagueAvg(history);
  const stats={};
  for(const t of Object.keys(matches)){
    const mcount=matches[t];
    stats[t]={att:(gf[t]/mcount)/leagueAvg, def:(ga[t]/mcount)/leagueAvg};
  }
  return stats;
}
function expectedGoals(home,away,stats,leagueAvg,homeAdv=1.08){
  const hs=stats[home]||{att:1,def:1}, as=stats[away]||{att:1,def:1};
  return { lambdaH: leagueAvg*hs.att*as.def*homeAdv, lambdaA: leagueAvg*as.att*hs.def };
}
function outcomeProbabilities(lambdaH,lambdaA,maxGoals=6){
  let pH=0,pD=0,pA=0;
  for(let i=0;i<=maxGoals;i++) for(let j=0;j<=maxGoals;j++){
    const p=poissonPmf(i,lambdaH)*poissonPmf(j,lambdaA);
    if(i>j)pH+=p; else if(i===j)pD+=p; else pA+=p;
  }
  const total=pH+pD+pA;
  if(total<=0) return {home:0.33,draw:0.34,away:0.33};
  return {home:pH/total,draw:pD/total,away:pA/total};
}
function bestFromProbs(p){ if(!p) return '-'; return (p.home>=p.draw && p.home>=p.away)?'Home Win':(p.away>=p.home && p.away>=p.draw)?'Away Win':'Draw'; }

// ----- API Handler -----
export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const { fixture, options } = req.body;
  if(!fixture || !fixture.home_team || !fixture.away_team) return res.status(400).json({error:'Missing fixture data'});

  try{
    const history = options.history || [];
    const leagueAvg = computeLeagueAvg(history);
    const stats = computeTeamStrengths(history);
    const { lambdaH, lambdaA } = expectedGoals(fixture.home_team, fixture.away_team, stats, leagueAvg, options.home_advantage||1.08);
    const probabilities = outcomeProbabilities(lambdaH, lambdaA);

    res.json({
      probabilities,
      recommendation: bestFromProbs(probabilities),
      expected_goals:{home:lambdaH,away:lambdaA},
      used_history_count: history.length
    });
  }catch(err){
    console.error(err);
    res.status(500).json({error:'Prediction failed'});
  }
}
