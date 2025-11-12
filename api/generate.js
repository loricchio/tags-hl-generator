// =========================
// 5) Aliases seguros (cortos)
const aliases = [];
if(aShort && aShort !== A) aliases.push(aShort);
if(bShort && bShort !== B) aliases.push(bShort);


// Ensamble por tiers
const tiers = [
enMandatory, // tier 0
esMandatory, // tier 1
context, // tier 2
goalTags, // tier 3
aliases // tier 4
];


// Dedup inteligente
const out = [];
const seen = new Set();
const keyOf = (t) => normalize(t).replace(/[^a-z0-9 ]/g,'');


for(const tier of tiers){
for(const t of tier){
const key = keyOf(t);
if(!key || seen.has(key)) continue;
seen.add(key);
// Casing final: nombres propios en Title Case, genéricos en minúsculas
if(/highlights$/.test(t)){
out.push(t); // ya vienen en lowercase exigido
} else if(/^gol de /.test(t) || / vs /.test(t)){
const parts = t.split(' vs ');
if(parts.length===2){
out.push(`${titleCaseName(parts[0])} vs ${titleCaseName(parts[1])}`);
} else {
// gol de X o resumen/goles
if(/^gol de /.test(t)){
out.push('gol de ' + titleCaseName(t.slice(7)));
} else {
out.push(t.toLowerCase());
}
}
} else if(t === 'goles' || t === 'resumen'){
out.push(t.toLowerCase());
} else if(t === 'Disney Plus' || t === 'ESPN'){
out.push(t); // marca
} else {
out.push(titleCaseName(t));
}
}
}


// Asegurar que las 3 EN estén al inicio y no se recorten por el join
// (el joinWithinLimit respeta el orden)
return out;
}


function joinWithinLimit(tags, maxLen){
const sep = ', ';
// Siempre preservar las 5 obligatorias (3 EN + 2 ES) si existen
const mandatoryCount = 5;
let acc = '';
const out = [];
for(let i=0;i<tags.length;i++){
const t = tags[i];
const add = out.length ? sep + t : t;
if(acc.length + add.length > maxLen){
// si estamos aún dentro de las obligatorias, forzar inclusión
if(out.length < mandatoryCount){
out.push(t); acc += add; continue;
}
break;
}
out.push(t); acc += add;
}
return out.join(sep);
}
