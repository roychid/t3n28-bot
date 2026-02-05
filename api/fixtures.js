// api/fixtures.js
export default async function handler(req, res) {
  try {
    const API_KEY = "6dldc2bda07fldl768d9ad2d082f00d4"; // your key

    // get query params
    const team = req.query.team;   // team id
    const league = req.query.league || ""; // optional league
    const last = req.query.last || 5;     // last 5 games default

    if (!team) return res.status(400).json({ error: "Team ID required" });

    let url = `https://v3.football.api-sports.io/fixtures?team=${team}&last=${last}`;
    if (league) url += `&league=${league}`;

    const response = await fetch(url, {
      headers: {
        "x-apisports-key": API_KEY
      }
    });

    const data = await response.json();
    const fixtures = data.response || [];

    // Only return results if home/away wins or draw (ignore odds for now)
    res.status(200).json({ fixtures });
  } catch (err) {
    res.status(500).json({ error: "API error", details: err.message });
  }
}
