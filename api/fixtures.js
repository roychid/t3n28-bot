import fetch from 'node-fetch';
const API_BASE = 'https://v3.football.api-sports.io';
function buildHeaders(){ return { 'x-apisports-key': process.env.API_SPORTS_KEY } }
async function apiFetch(path){ 
  const res = await fetch(API_BASE+path, { headers: buildHeaders() }); 
  if(!res.ok){ const t=await res.text().catch(()=> ''); throw new Error(`${res.status} ${res.statusText}: ${t}`); }
  return res.json();
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const { league, season, date } = req.body;
  if(!date) return res.status(400).json({error:'Missing date'});
  try{
    let path = `/fixtures?date=${encodeURIComponent(date)}`;
    if(league) path += `&league=${league}`;
    if(season) path += `&season=${season}`;
    const json = await apiFetch(path);
    const fixtures = (json.response||[]).map(r=>({
      id: r.fixture?.id,
      league: {id:r.league?.id,name:r.league?.name},
      home_team: r.teams?.home?.name||'',
      away_team: r.teams?.away?.name||'',
      fixtureDate: r.fixture?.date
    }));
    res.json(fixtures);
  }catch(err){
    console.error(err);
    res.status(500).json({error:'Failed to fetch fixtures'});
  }
}
