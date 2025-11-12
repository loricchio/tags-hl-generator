// =========================
// File: generate.js
// =========================
// Serverless handler (Next.js API Route / Vercel / Node ESM)


// --- Configuración de CORS ---
const ALLOWED_ORIGINS = [
'https://loricchio.github.io',
'https://*.vercel.app',
'http://localhost:3000',
'http://127.0.0.1:3000'
];


function cors(req, res){
const origin = req.headers.origin || '';
const allowed = ALLOWED_ORIGINS.some(p => {
if(p.includes('*')){
const base = p.replace('https://', '').replace('http://', '').replace('*.', '');
return origin.endsWith(base);
}
return origin === p;
});
if(allowed){
res.setHeader('Access-Control-Allow-Origin', origin);
res.setHeader('Vary', 'Origin');
}
res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}


export default async function handler(req, res){
cors(req,res);
if(req.method === 'OPTIONS'){ res.status(204).end(); return; }
if(req.method !== 'POST'){
res.status(405).json({ error: 'Method not allowed' }); return;
}
try{
const { teamA, teamB, competition = '', scorers = [], lang = 'es', maxLen = 500 } = req.body || {};


if(!teamA || !teamB){
res.status(400).json({ error: 'Faltan equipos.' }); return;
}


// --- Cargar nicknames/teams ---
const data = await loadNicknames();
const teamsMap = data.teams || {};

