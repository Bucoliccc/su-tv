import { writeFile } from 'node:fs/promises';

const OFFICE_URL='https://remax.com.tr/tr/ofis/detay/su';
const TEAM_URL='https://remax.com.tr/tr/ofis/detay/su/ekibimiz';
const LAND_IMAGE='./assets/satilik-arsa.jpg';
const BS=String.fromCharCode(92),Q='"';

function clean(v){return String(v==null?'':v).trim()}
function deescape(s){
  for(let n=0;n<5;n++){
    const before=s;
    s=s.split(BS+Q).join(Q);
    s=s.split(BS+BS).join(BS);
    if(s===before)break;
  }
  return s;
}
function stripDescriptions(raw){
  let pos=0;
  while(true){
    const d=raw.indexOf('description',pos);
    if(d<0)break;
    const e=raw.indexOf('employeeName',d);
    if(e<0)break;
    const start=raw.lastIndexOf(',',d);
    const end=raw.lastIndexOf(',',e);
    if(start<0||end<=start)break;
    raw=raw.slice(0,start)+raw.slice(end);
    pos=start+1;
  }
  return raw;
}
function extractListingPage(html){
  const marker=html.indexOf('officeDetailPropertyListingData');
  if(marker<0)throw new Error('RE/MAX portföy verisi bulunamadı.');
  const dataAt=html.indexOf('data',marker);
  const arrStart=html.indexOf('[',dataAt);
  const recordAt=html.indexOf('recordCount',arrStart);
  const arrEnd=html.lastIndexOf(']',recordAt);
  if(arrStart<0||recordAt<0||arrEnd<arrStart)throw new Error('RE/MAX portföy sayfası çözümlenemedi.');
  return JSON.parse(deescape(stripDescriptions(html.slice(arrStart,arrEnd+1))));
}
function titleOf(p){
  if(Array.isArray(p.title))return clean((p.title.find(x=>Number(x?.languageId)===1)||p.title[0]||{}).text);
  return clean(p.title);
}
function largeImage(url){return typeof url==='string'?url.replace('/T/','/L/'):url}
function decodeHtml(s){
  return clean(s).replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
}
async function fetchText(url){
  const r=await fetch(url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (REMAX SU Portfolio Display)','accept-language':'tr-TR,tr;q=0.9'}});
  if(!r.ok)throw new Error(url+' HTTP '+r.status);
  return r.text();
}
async function fetchActiveTeam(){
  const html=await fetchText(TEAM_URL);
  const team=new Map();
  const rx=/<a[^>]+href=["']\/tr\/danisman\/[^"']+["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["'][^>]+alt=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi;
  for(const m of html.matchAll(rx)){
    const photo=decodeHtml(m[1]), name=decodeHtml(m[2]);
    if(name)team.set(name,photo||null);
  }
  if(!team.size)throw new Error('RE/MAX Su güncel ekip listesi okunamadı.');
  return team;
}
async function fetchPage(page){
  return extractListingPage(await fetchText(page===1?OFFICE_URL:OFFICE_URL+'?page='+page));
}

const activeTeam=await fetchActiveTeam();
const all=[];
for(let page=1;page<=10;page++){
  const pageItems=await fetchPage(page);
  all.push(...pageItems);
  if(pageItems.length<20)break;
}
const seen=new Set(),items=[];
for(const p of all){
  const code=clean(p.code).toUpperCase();
  if(!/^P\d{8}$/.test(code)||seen.has(code))continue;
  seen.add(code);
  const agentName=clean(p.employeeName);
  if(!activeTeam.has(agentName))continue;
  const isLand=Number(p.mainCategoryId)===3;
  const remoteImages=Array.isArray(p.images)?p.images.filter(x=>typeof x==='string'&&x.startsWith('https://')).map(largeImage):[];
  if(!isLand&&!remoteImages.length)continue;
  const image=isLand?LAND_IMAGE:remoteImages[0];
  items.push({
    portfolioNo:code,
    title:titleOf(p),
    status:clean(p.operationName).toUpperCase(),
    location:clean(p.address).replaceAll('/',' / '),
    sqm:clean(p.m2Area),
    room:clean(p.roomOptions),
    floor:clean(p.floor),
    category:clean(p.categoryName),
    image,
    images:isLand?[LAND_IMAGE]:remoteImages.slice(0,6),
    isLand,
    agentName,
    agentPhoto:activeTeam.get(agentName)||null,
    listingId:p.id
  });
}
if(!items.length)throw new Error('Kullanılabilir portföy bulunamadı.');
await writeFile('portfolios.json',JSON.stringify({source:OFFICE_URL,updatedAt:new Date().toISOString(),count:items.length,activeAgents:[...activeTeam.keys()],items},null,2));
console.log('Generated',items.length,'portfolios');
