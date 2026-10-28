const OFFICE_URL='https://remax.com.tr/tr/ofis/detay/su';
const LAND_IMAGE='/assets/satilik-arsa.jpg';
const BS=String.fromCharCode(92),Q='"';

const AGENT_PHOTOS={
  'Zafer Güney':'https://i.remax.com.tr/photos/employee/20/907446705aed48b5bfaaff4f0ff4f440.jpg',
  'Mehmet Solmazgül':'https://i.remax.com.tr/photos/employee/63/b6d0ede8c9214b2c9f663ed9174021d7.jpg',
  'Hasan Can Kulaksız':'https://i.remax.com.tr/photos/employee/97/3a5858677ff2442db1084f61105274ee.jpg',
  'Veli Alagöz':'https://i.remax.com.tr/photos/employee/26/868baf4b07014b2dab540052fe09ce57.jpg',
  'Sude Sonkur':'https://i.remax.com.tr/photos/employee/79/3d104db7ddc64baba5279c9ca41cb812.jpg',
  'Vezir Emre Kocaoğlu':'https://i.remax.com.tr/photos/employee/13/90702998ffc746acb9fefa2d070b3058.jpg',
  'Filiz Alagöz':'https://i.remax.com.tr/photos/employee/06/af5ff9bb353c472b8efdc49c38481418.jpg',
  'Yağızhan Güney Duratnir':'https://i.remax.com.tr/photos/employee/73/e13a748af3bf4790b32fca81977aa585.jpg'
};

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
  if(arrStart<0||recordAt<0)throw new Error('RE/MAX portföy sayfası çözümlenemedi.');
  const arrEnd=html.lastIndexOf(']',recordAt);
  if(arrEnd<arrStart)throw new Error('RE/MAX portföy dizisi sonu bulunamadı.');
  return JSON.parse(deescape(stripDescriptions(html.slice(arrStart,arrEnd+1))));
}
function titleOf(p){
  if(Array.isArray(p.title)){
    return clean((p.title.find(x=>Number(x?.languageId)===1)||p.title[0]||{}).text);
  }
  return clean(p.title);
}
function largeImage(url){
  return typeof url==='string'?url.replace('/T/','/L/'):url;
}
async function fetchPage(page){
  const url=page===1?OFFICE_URL:OFFICE_URL+'?page='+page;
  const r=await fetch(url,{
    redirect:'follow',
    headers:{
      'user-agent':'Mozilla/5.0 (REMAX SU Portfolio Display)',
      'accept-language':'tr-TR,tr;q=0.9'
    }
  });
  if(!r.ok)throw new Error('RE/MAX sayfası HTTP '+r.status+' (sayfa '+page+')');
  return extractListingPage(await r.text());
}

export default async function handler(req,res){
  try{
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

      const isLand=Number(p.mainCategoryId)===3;
      const remoteImages=Array.isArray(p.images)?p.images.filter(x=>typeof x==='string'&&x.startsWith('https://')).map(largeImage):[];
      if(!isLand&&!remoteImages.length)continue;

      const agentName=clean(p.employeeName);
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
        agentPhoto:AGENT_PHOTOS[agentName]||null,
        listingId:p.id
      });
    }

    if(!items.length)throw new Error('RE/MAX Su sayfasında kullanılabilir portföy bulunamadı.');

    res.setHeader('cache-control','s-maxage=300, stale-while-revalidate=900');
    res.status(200).json({
      source:OFFICE_URL,
      updatedAt:new Date().toISOString(),
      count:items.length,
      items
    });
  }catch(e){
    res.status(502).json({
      error:'RE/MAX Su portföyleri alınamadı',
      detail:e&&e.message?e.message:String(e),
      items:[]
    });
  }
}
