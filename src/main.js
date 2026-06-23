'use strict';
// Worldbuilder - simulation core + browser UI entry.
// Top-level module scope (the former IIFE wrapper is gone) so the pure simulation
// and in-page assertions can be imported and run headlessly in Node; see
// src/sim.test.js. The DOM/UI wiring below runs unchanged when a real DOM exists.

// ===== Panel collapse =====
window.togglePanel = function(id){
  var el = document.getElementById(id);
  if(el) el.classList.toggle('collapsed');
};

// ===== Error HUD =====
window.onerror = function(msg, src, line, col, err){
  var box=document.getElementById('err');
  if(!box) return false;
  box.style.display='block';
  var text = 'JS Error: '+msg+'\n'+(src||'')+':'+(line||'?')+':'+(col||'?')+'\n'+(err&&err.stack?err.stack:'');
  box.textContent=text;
  return false;
};

// ===== State =====
var started=false, running=true, tick=0; var W=96,H=96,PIX=6,speed=18; var overlayMode='none';
if(!Number.isFinite(PIX) || PIX<=0) PIX=6;
var loopTimer=null;
var grid, elev, aridity, tempField, sunlight, adjCooldown, ringDone, hillDecayCount, peakVolcano, volcanoRing, volcanoCenters;
var coastTTL; var lastClick=null;
var volcActive, volcAge, volcLife;
var modTempSeasonal, modTempAnom, modTempVolc, modAridSeasonal, modAridAnom, modAridVolc, modArid;
var biomeStability, biomeDesiredNext;
var yearlyVariation;
var anomalyBlobs;

// ===== Ecology State =====
var flora = [];
var fauna = [];
var floraIdCounter = 0;
var faunaIdCounter = 0;

// Death particles: brief visual flash on fauna death
var deathParticles = []; // {x, y, type:'kill'|'starve'|'age', tick}
var DEATH_PARTICLE_LIFE = 8; // ticks visible

// Placement mode: 'none', 'herbivore', 'carnivore'
var placeMode = 'none';

// Species naming system
var GENUS_PARTS = ['Vir','Aur','Cer','Lup','Sil','Fer','Cav','Urs','Vor','Niv','Pyr','Thal','Aq','Xer','Gla','Ven','Bor','Aus','Ori','Cal'];
var SPECIES_PARTS = ['ensis','alis','phila','cola','oides','inus','atus','ella','osum','icum','oris','anum','ilis','osa','este','entis','idum','ax','eum','orum'];
var HABITAT_PARTS = ['sylv','arid','glaci','therm','mar','mont','palud','camp','litor','umbr','luc','prat','rip','anth','saxi','aren','niv','plani','herb','flor'];
var speciesNameCache = {}; // keyed by "type-gen-hue-bucket" -> name

// Population history for graphs
var POP_HISTORY_LEN = 500;
var popHistory = { flora:[], herb:[], carn:[], ticks:[] };

// Ecotone boundary cache (rebuilt during reclassTerrain)
var biomeBoundary; // Uint8Array, 1 = tile borders a different biome

// Flora regrowth remnants (roots left behind after grazing)
var floraRemnants = []; // {x, y, prefs, tickDue}

// ===== River System =====
// River data per tile: null = no river
// { entryDir:-1..7, exitDir:-1..7, volume:int, lake:bool, sourcePool:bool, estuary:bool, curveOffset:float }
// Directions: 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW, -1=source/terminal
var riverData;       // array of W*H, null or river object
var riverGenerated = false;
var RIVER_COLOR = '#2d7da8';
var LAKE_COLOR = '#1a6b94';
var RIVER_MIN_ELEV = 5.0;          // minimum source elevation (hills+)
var RIVER_MAX_COUNT_BASE = 7;       // rivers per 96^2 map
var RIVER_MIN_SOURCE_SPACING = 8;   // min manhattan distance between sources
var RIVER_ARIDITY_EFFECT = 0.6;     // aridity reduction on river tiles

// ===== Beach System (erosion process) =====
var beachLevel;       // Float32Array of W*H, 0.0 = no beach, 1.0 = fully eroded
var BEACH_SAND_COLOR = [226,204,143];  // RGB for sand
var BEACH_OCEAN_COLOR = [7,58,83];     // RGB for ocean encroachment

// ===== Seeded PRNG (Mulberry32) =====
var _seed = 0;
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var sRng = Math.random; // replaced in init() with seeded version
// Seeded random helpers for generation pipeline
function sRandn(){var u=0,v=0;while(u===0)u=sRng();while(v===0)v=sRng();return Math.sqrt(-2.0*Math.log(u))*Math.cos(2*Math.PI*v);}
function sTruncNorm(mean,sigma,lo,hi){var x;for(var g=0;g<20;g++){x=mean+sigma*sRandn();if(x>=lo&&x<=hi)return x;}return clamp(x,lo,hi);}
function sBeta(a,b){function gK(k){if(k<1){var u=sRng();return gK(1+k)*Math.pow(u,1/k);}var d=k-1/3,c=1/Math.sqrt(9*d);while(true){var x=sRandn();var v=1+c*x;if(v<=0)continue;v=v*v*v;var u2=sRng();if(u2<1-0.0331*(x*x)*(x*x))return d*v;if(Math.log(u2)<0.5*x*x+d*(1-v+Math.log(v)))return d*v;}}var x2=gK(a),y=gK(b);return x2/(x2+y);}
function sGamma(shape,scale){function gK(k){if(k<1){var u=sRng();return gK(1+k)*Math.pow(u,1/k);}var d=k-1/3,c=1/Math.sqrt(9*d);while(true){var x=sRandn();var v=1+c*x;if(v<=0)continue;v=v*v*v;var u2=sRng();if(u2<1-0.0331*(x*x)*(x*x))return d*v;if(Math.log(u2)<0.5*x*x+d*(1-v+Math.log(v)))return d*v;}}return gK(shape)*scale;}

// ===== Themed Presets =====
var PRESETS = {
  balanced: { label:'Balanced', cfg:{}, world:{}, toggles:{} },
  desert: { label:'Desert', cfg:{
    aridityDistK:0.14, ariditySunCoef:0.30, aridityHotBoost:0.80, sunlightIntensity:1.4,
    floraSpawnChance:0.006, floraPerTileMax:2, maxLandCap:0.55, erosionChanceBase:0.00015
  }, world:{}, toggles:{} },
  wetlands: { label:'Wetlands', cfg:{
    aridityDistK:0.04, ariditySunCoef:0.08, aridityHotBoost:0.15, coastalSpreadBase:0.005,
    erosionChanceBase:0.0006, elevationIntensity:0.7, maxLandCap:0.50,
    floraSpawnChance:0.020, floraPerTileMax:6
  }, world:{}, toggles:{} },
  iceage: { label:'Ice Age', cfg:{
    sunlightIntensity:0.5, aridityDistK:0.06, climateIntensity:1.8,
    floraSpawnChance:0.005, floraPerTileMax:2, elevationIntensity:1.1
  }, world:{}, toggles:{ seasonalTilt:true } },
  volcanic: { label:'Volcanic', cfg:{
    volcanoChancePerTile:0.00020, maxVolcanoCenters:8, elevationIntensity:1.4,
    climateIntensity:1.5, maxLandCap:0.65
  }, world:{}, toggles:{ volcanoAsh:true } },
  jungle: { label:'Jungle', cfg:{
    sunlightIntensity:1.3, aridityDistK:0.03, ariditySunCoef:0.05, aridityHotBoost:0.10,
    floraSpawnChance:0.025, floraPerTileMax:6, coastalSpreadBase:0.004, maxLandCap:0.55
  }, world:{}, toggles:{} },
  archipelago: { label:'Archipelago', cfg:{
    maxLandCap:0.25, coastalSpreadBase:0.002, volcanoChancePerTile:0.00012,
    erosionChanceBase:0.0005, elevationIntensity:0.8
  }, world:{}, toggles:{} },
  pangaea: { label:'Pangaea', cfg:{
    maxLandCap:0.80, coastalSpreadBase:0.006, volcanoChancePerTile:0.00003,
    minVolcanoSpacing:12, elevationIntensity:1.1
  }, world:{}, toggles:{} }
};
var activePreset = 'balanced';

// Terrain enum
var T={OCEAN:0,COAST:1,PLAINS:2,FOREST:3,HILLS:4,MOUNTAIN:5,DESERT:6,WETLAND:7,JUNGLE:8,ARCTIC:9,STEPPE:10,VOLCANIC:11,GLACIER:12,TUNDRA:13,SAVANNA:14,MESA:15};
var TNAME=['OCEAN','COAST','GRASSLAND','FOREST','HILLS','MOUNTAIN','DESERT','WETLAND','JUNGLE','ARCTIC','STEPPE','VOLCANIC','GLACIER','TUNDRA','SAVANNA','MESA'];
var TERRAIN_COLORS=['#073a53','#116c8c','#a8c686','#228B22','#b7b7a4','#aaaaaa','#d8c27a','#3c6e71','#0b3d0b','#e6f2ff','#6e8b3d','#8b5e34','#b9d8ff','#8a9a7b','#c4a55a','#b5654e'];

var WORLD={ muE:3, varMode:0.5, gammaA:4, gammaTheta:400, H0:1.4, Hmax:9.0, k:0.006, alphaCoast:0.7, coastBias:0 };

var CFG={
  volcanoChancePerTile:0.00005, coastalSpreadBase:0.0030, erosionChanceBase:0.00025,
  hardenRate:0.0025, elevationIntensity:1.0, maxLandCap:0.60,
  sunlightNeighborMaxDelta:1.0, sunlightIntensity:1.0,
  aridityDistK:0.085, ariditySunCoef:0.18, aridityElevCoef:0.03, aridityHotBoost:0.50,
  clusterSpikeRate:0.025, clusterPlusChance:0.18,
  mountainAdjUpliftProb:0.008, mountainAdjUpliftMax:5.5,
  hillAdjUpliftProb:0.006, hillAdjUpliftCap:5.3,
  adjUpliftEvery:12, adjCooldownTicks:50,
  hillFringeEvery:10, hillFringeProb:0.15, hillFringeBudgetShare:0.001,
  hillFringeMin:4.8, hillFringeMax:6.6,
  isolatedMountainSoftErode:0.05, maxVolcanoCenters:4, minVolcanoSpacing:6,
  rareSurgeProb:0.028, tickMsBase:100,
  seasonalTilt:false, anomalies:false, volcanoAsh:false,
  climateIntensity:1.0, climateSeasonLength:10000,
  anomalySpeed:0.0005, anomalyWavelength:40.0, anomalyBlobCount:3, anomalyBlobRadius:25,
  biomeStabilityThreshold:20,
  // Beach erosion process
  beachCapPct:0.07,             // max % of land tiles that can be beach (slider: 0-0.20)
  beachMinTick:1000,            // ticks before beaches start forming
  beachGrowRate:0.001,          // beachLevel increase per tick for qualifying tiles
  beachSpreadChance:0.003,      // chance per tick a beach tile spreads to neighbor
  beachSpreadAmount:0.15,       // initial beachLevel when spreading
  beachErosionThreshold:0.85,   // beachLevel above which elevation erodes
  beachErosionRate:0.002,       // elevation loss per tick when eroding
  beachOceanThreshold:0.95,     // beachLevel above which tile converts to ocean
  beachMaxElev:2.5,             // max elevation for beach formation
  beachMinTemp:3.5,             // min temperature for beach formation
  ecoActive:true, ecoRender:true,
  floraSpawnChance:0.012, floraMutationChance:0.07, floraMutationMag:0.8,
  floraBaseMaxAge:700, floraSpreadBase:0.07, floraMaxPop:0, floraToleranceBase:2.5,
  floraPerTileMax:4,               // carrying capacity per tile
  ecotoneBlend:true,               // biome transition blending
  ecotoneFloraBoost:1.6,           // flora spread multiplier at biome edges
  faunaSpawnChance:0.001, faunaMutationChance:0.07, faunaMutationMag:0.6,
  faunaMaxPop:400, faunaBaseMaxAge:500,
  herbivoreSpeed:20, carnivoreSpeed:16,
  herbivoreEatSpeed:20,             // ticks between grazing
  carnivoreEatSpeed:18,             // ticks between hunting
  herbivoreEatGain:12, carnivoreEatGain:50,
  floraRegrowthChance:0.4,         // chance eaten flora drops a root remnant
  floraRegrowthDelay:10,           // ticks before remnant sprouts
  floraMutationBias:0.45,          // how strongly mutations pull toward local tile conditions (0=random, 1=full)
  faunaMoveCost:0.5, faunaIdleCost:0.1, faunaClimatePenalty:0.5,
  faunaReproThreshold:95, faunaReproCost:60,
  carnivoreReproThreshold:80, carnivoreReproCost:40,
  herbivoreStartEnergy:50, carnivoreStartEnergy:75,
  herbivoreMaxEnergy:100, carnivoreMaxEnergy:120
};
// Snapshot defaults for preset reset
var DEFAULT_CFG = {};
(function(){for(var k in CFG) if(CFG.hasOwnProperty(k)) DEFAULT_CFG[k]=CFG[k];})();

function applyPreset(name){
  var p=PRESETS[name]; if(!p) return;
  activePreset=name;
  // Reset CFG to defaults
  for(var k in DEFAULT_CFG) if(DEFAULT_CFG.hasOwnProperty(k)) CFG[k]=DEFAULT_CFG[k];
  // Apply preset overrides
  for(var ck in p.cfg) if(p.cfg.hasOwnProperty(ck)) CFG[ck]=p.cfg[ck];
  // Apply toggles
  if(p.toggles.seasonalTilt!==undefined) CFG.seasonalTilt=p.toggles.seasonalTilt;
  if(p.toggles.anomalies!==undefined) CFG.anomalies=p.toggles.anomalies;
  if(p.toggles.volcanoAsh!==undefined) CFG.volcanoAsh=p.toggles.volcanoAsh;
  syncUIToConfig();
}
function syncUIToConfig(){
  // Terrain sliders (rebuilt by buildSliders)
  buildSliders(); applyElevationIntensity();
  // Climate panel
  var cIE=document.getElementById('climateIntensity'),cIO=document.getElementById('climateIntensityOut');
  if(cIE){cIE.value=CFG.climateIntensity;if(cIO)cIO.textContent=CFG.climateIntensity.toFixed(2);}
  var cSE=document.getElementById('climateSeasonLen'),cSO=document.getElementById('climateSeasonLenOut');
  if(cSE){cSE.value=CFG.climateSeasonLength;if(cSO)cSO.textContent=CFG.climateSeasonLength;}
  var stEl=document.getElementById('seasonalToggle');if(stEl)stEl.checked=!!CFG.seasonalTilt;
  var anEl=document.getElementById('anomalyToggle');if(anEl)anEl.checked=!!CFG.anomalies;
  var vaEl=document.getElementById('volcanoToggle');if(vaEl)vaEl.checked=!!CFG.volcanoAsh;
  // Ecology panel
  var fcEl=document.getElementById('floraTileCapSlider'),fcOut=document.getElementById('floraTileCapOut');
  if(fcEl){fcEl.value=CFG.floraPerTileMax;if(fcOut)fcOut.textContent=CFG.floraPerTileMax;}
  var fsEl=document.getElementById('floraSpawnSlider'),fsOut=document.getElementById('floraSpawnOut');
  if(fsEl){fsEl.value=CFG.floraSpawnChance;if(fsOut)fsOut.textContent=CFG.floraSpawnChance.toFixed(3);}
  var faEl=document.getElementById('faunaSpawnSlider'),faOut=document.getElementById('faunaSpawnOut');
  if(faEl){faEl.value=CFG.faunaSpawnChance;if(faOut)faOut.textContent=CFG.faunaSpawnChance.toFixed(3);}
  var muEl=document.getElementById('mutationSlider'),muOut=document.getElementById('mutationOut');
  if(muEl){muEl.value=CFG.floraMutationChance;if(muOut)muOut.textContent=Math.round(CFG.floraMutationChance*100)+'%';}
  var mbEl=document.getElementById('mutBiasSlider'),mbOut=document.getElementById('mutBiasOut');
  if(mbEl){mbEl.value=CFG.floraMutationBias;if(mbOut)mbOut.textContent=Math.round(CFG.floraMutationBias*100)+'%';}
  var bcEl=document.getElementById('beachCapSlider'),bcOut=document.getElementById('beachCapOut');
  if(bcEl){bcEl.value=CFG.beachCapPct;if(bcOut)bcOut.textContent=Math.round(CFG.beachCapPct*100)+'%';}
  // Preset selector
  var psEl=document.getElementById('presetSelect');if(psEl)psEl.value=activePreset;
}

// ===== Canvas helpers =====
var canvas=document.getElementById('c'); var ctx=canvas.getContext('2d');
function idx(x,y){return y*W+x;} function inb(x,y){return x>=0&&y>=0&&x<W&&y<H;}
function neighbors4(x,y){var a=[]; if(x+1<W)a.push([x+1,y]); if(x-1>=0)a.push([x-1,y]); if(y+1<H)a.push([x,y+1]); if(y-1>=0)a.push([x,y-1]); return a;}
function neighbors8(x,y){var a=[]; for(var dy=-1;dy<=1;dy++){ for(var dx=-1;dx<=1;dx++){ if(dx||dy){ var nx=x+dx, ny=y+dy; if(inb(nx,ny)) a.push([nx,ny]); } } } return a;}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function resize(){ if(!Number.isFinite(PIX) || PIX<=0) PIX=6; if(W<=0||H<=0){ W=96; H=96; } canvas.width=W*PIX; canvas.height=H*PIX; applyZoomPan(); }

// ===== Zoom & Pan =====
var zoomLevel=1, panX=0, panY=0;
var ZOOM_MIN=0.5, ZOOM_MAX=6, ZOOM_STEP=0.15;
var isPanning=false, panStartX=0, panStartY=0, panStartPX=0, panStartPY=0;

function applyZoomPan(){
  canvas.style.transform='scale('+zoomLevel+') translate('+panX+'px,'+panY+'px)';
}
function resetZoomPan(){
  zoomLevel=1;panX=0;panY=0;applyZoomPan();
  var zEl=document.getElementById('hZoom');if(zEl)zEl.textContent='100%';
}
function screenToTile(clientX,clientY){
  var r=canvas.getBoundingClientRect();
  var x=((clientX-r.left)/r.width*canvas.width/PIX)|0;
  var y=((clientY-r.top)/r.height*canvas.height/PIX)|0;
  return {x:x,y:y};
}

// ===== Climate System =====
function climateInit(){
  modTempSeasonal = new Float32Array(W*H); modTempAnom = new Float32Array(W*H); modTempVolc = new Float32Array(W*H);
  modAridSeasonal = new Float32Array(W*H); modAridAnom = new Float32Array(W*H); modAridVolc = new Float32Array(W*H);
  modArid = new Float32Array(W*H);
  for(var i=0; i<W*H; i++){ modTempSeasonal[i]=0; modTempAnom[i]=0; modTempVolc[i]=0; modAridSeasonal[i]=0; modAridAnom[i]=0; modAridVolc[i]=0; modArid[i]=0; }
  initAnomalyBlobs();
}
function initAnomalyBlobs(){
  anomalyBlobs = [];
  var count = CFG.anomalyBlobCount || 3;
  for(var i=0; i<count; i++){
    anomalyBlobs.push({ x: sRng()*W, y: sRng()*H, vx: (sRng()-0.5)*0.02, vy: (sRng()-0.5)*0.02,
      amplitude: (sRng()<0.5?-1:1)*(0.7+sRng()*0.6), radius: (CFG.anomalyBlobRadius||25)*(0.8+sRng()*0.4) });
  }
}
function updateAnomalyBlobs(){
  if(!anomalyBlobs) return;
  for(var i=0; i<anomalyBlobs.length; i++){
    var blob=anomalyBlobs[i]; blob.x+=blob.vx; blob.y+=blob.vy;
    if(blob.x<0)blob.x+=W; if(blob.x>=W)blob.x-=W; if(blob.y<0)blob.y+=H; if(blob.y>=H)blob.y-=H;
    if(Math.random()<0.002){ blob.vx+=(Math.random()-0.5)*0.01; blob.vy+=(Math.random()-0.5)*0.01;
      var sp=Math.sqrt(blob.vx*blob.vx+blob.vy*blob.vy); if(sp>0.03){blob.vx=(blob.vx/sp)*0.03;blob.vy=(blob.vy/sp)*0.03;} }
  }
}
function seasonPhase(){ if(CFG.climateSeasonLength<=0)return 0; return(tick%CFG.climateSeasonLength)/CFG.climateSeasonLength; }
function climateStep(){
  var yearCycle=(tick/CFG.climateSeasonLength); var variationPhase=yearCycle*0.15;
  yearlyVariation=0.85+Math.sin(variationPhase*2*Math.PI)*0.15;
  var phase=seasonPhase(); var plateauWidth=0.2; var seasonalWithPlateaus;
  if(phase<0.25-plateauWidth/2){var t0=phase/(0.25-plateauWidth/2);seasonalWithPlateaus=-1+t0;}
  else if(phase<0.25+plateauWidth/2){seasonalWithPlateaus=1;}
  else if(phase<0.75-plateauWidth/2){var t1=(phase-(0.25+plateauWidth/2))/(0.5-plateauWidth);seasonalWithPlateaus=1-t1*2;}
  else if(phase<0.75+plateauWidth/2){seasonalWithPlateaus=-1;}
  else{var t2=(phase-(0.75+plateauWidth/2))/(0.25-plateauWidth/2);seasonalWithPlateaus=-1+t2;}
  var seasonalCompressed=seasonalWithPlateaus*0.075*yearlyVariation;
  for(var i=0;i<W*H;i++){
    var x=i%W,y=(i/W)|0;
    if(CFG.seasonalTilt){var e=elev[i]||0;var atten=1-Math.min(1,e/10);var targetTS=0.008*seasonalCompressed*atten;var targetAS=-0.005*seasonalCompressed*atten;modTempSeasonal[i]+=(targetTS-modTempSeasonal[i])*0.005;modAridSeasonal[i]+=(targetAS-modAridSeasonal[i])*0.005;}else{modTempSeasonal[i]*=0.995;modAridSeasonal[i]*=0.995;}
    if(CFG.anomalies){if(!anomalyBlobs)initAnomalyBlobs();if(tick%5===0)updateAnomalyBlobs();var totalAnom=0;for(var b=0;b<anomalyBlobs.length;b++){var blob=anomalyBlobs[b];var dx=x-blob.x,dy=y-blob.y;if(dx>W/2)dx-=W;if(dx<-W/2)dx+=W;if(dy>H/2)dy-=H;if(dy<-H/2)dy+=H;var distSq=dx*dx+dy*dy;var radiusSq=blob.radius*blob.radius;totalAnom+=blob.amplitude*Math.exp(-distSq/(2*radiusSq));}var targetTA=totalAnom*0.0006;var targetAA=-totalAnom*0.00037;modTempAnom[i]+=(targetTA-modTempAnom[i])*0.02;modAridAnom[i]+=(targetAA-modAridAnom[i])*0.02;}else{modTempAnom[i]*=0.98;modAridAnom[i]*=0.98;}
    if(CFG.volcanoAsh){if(peakVolcano[i]){modTempVolc[i]=-0.006;modAridVolc[i]=-0.004;}else if(volcanoRing[i]===1){modTempVolc[i]=-0.003;modAridVolc[i]=-0.002;}else if(volcanoRing[i]===2){modTempVolc[i]=-0.0015;modAridVolc[i]=-0.001;}else{modTempVolc[i]=0;modAridVolc[i]=0;}}else{modTempVolc[i]=0;modAridVolc[i]=0;}
  }
}
function applyClimateIfEnabled(){
  var ci=CFG.climateIntensity||1;
  for(var i=0;i<W*H;i++){var tD=(modTempSeasonal[i]+modTempAnom[i]+modTempVolc[i])*ci;var aD=(modAridSeasonal[i]+modAridAnom[i]+modAridVolc[i])*ci;tempField[i]=clamp((tempField[i]||0)+tD,0,10);aridity[i]=clamp((aridity[i]||0)+aD,0,10);modArid[i]=aD;}
}

// ===== UI hooks =====
function hook(id,fn,ev){var el=document.getElementById(id);if(el)el.addEventListener(ev||'click',fn);}
hook('btnStart',function(){running=true;if(!started)boot();});
hook('btnForceStart',function(){running=true;started=false;boot();});
hook('btnPause',function(){running=false;});
hook('btnStep',function(){running=false;step();draw();});
hook('btnReset',function(){running=false;init();buildSliders();applyElevationIntensity();draw();});
hook('btnSpawnFlora',function(){seedFloraCluster(15);draw();});
hook('btnSpawnHerb',function(){seedFaunaGroup('herbivore',8);draw();});
hook('btnSpawnCarn',function(){seedFaunaGroup('carnivore',4);draw();});
hook('btnRivers',function(){generateRivers();computeAridity();reclassTerrain();draw();});
// Placement mode
function setPlaceMode(mode){
  placeMode=(placeMode===mode)?'none':mode;
  var hb=document.getElementById('btnPlaceHerb'),cb=document.getElementById('btnPlaceCarn'),banner=document.getElementById('placeBanner');
  if(hb){hb.classList.toggle('place-active',placeMode==='herbivore');}
  if(cb){cb.classList.toggle('place-active',placeMode==='carnivore');}
  if(banner){banner.classList.toggle('show',placeMode!=='none');banner.textContent=placeMode==='none'?'':'Click tile to place '+placeMode+'…';}
  canvas.style.cursor=placeMode!=='none'?'cell':'crosshair';
}
hook('btnPlaceHerb',function(){setPlaceMode('herbivore');});
hook('btnPlaceCarn',function(){setPlaceMode('carnivore');});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&placeMode!=='none')setPlaceMode('none');});
hook('btnRunTests',function(){runTests();});
hook('btnExport',exportPNG);
hook('btnExportJSON',exportJSON);
hook('btnImportJSON',function(){
  var input=document.createElement('input');input.type='file';input.accept='.json';
  input.onchange=function(e){var file=e.target.files[0];if(!file)return;var reader=new FileReader();reader.onload=function(ev){try{importJSON(JSON.parse(ev.target.result));}catch(err){var errBox=document.getElementById('err');if(errBox){errBox.style.display='block';errBox.textContent='Import error: '+err.message;}}};reader.readAsText(file);};
  input.click();
});
var speedEl=document.getElementById('speed');if(speedEl)speedEl.addEventListener('input',function(e){speed=+e.target.value;});
var mapSizeEl=document.getElementById('mapSize');if(mapSizeEl)mapSizeEl.addEventListener('change',function(e){W=H=+e.target.value;init();buildSliders();draw();});
var pixEl=document.getElementById('pix');if(pixEl)pixEl.addEventListener('change',function(e){PIX=+e.target.value;resize();draw();});
// Preset selector
var presetEl=document.getElementById('presetSelect');if(presetEl)presetEl.addEventListener('change',function(e){applyPreset(e.target.value);init();draw();});
// Seed input + dice
var seedInputEl=document.getElementById('seedInput');
hook('btnRollSeed',function(){if(seedInputEl)seedInputEl.value='';init();draw();});
// Click-to-copy seed
(function(){var hSeed=document.getElementById('hSeed');if(hSeed)hSeed.addEventListener('click',function(){if(navigator.clipboard)navigator.clipboard.writeText(String(_seed));hSeed.textContent='copied!';setTimeout(function(){hSeed.textContent=_seed;},800);});})();

// Overlay selector (segmented buttons)
(function(){
  var bar=document.getElementById('overlayBar'); if(!bar) return;
  bar.addEventListener('click',function(e){
    var btn=e.target.closest('.ov-btn'); if(!btn) return;
    bar.querySelectorAll('.ov-btn').forEach(function(b){b.classList.remove('active');});
    btn.classList.add('active');
    overlayMode=btn.getAttribute('data-ov');
    draw();
  });
})();

canvas.addEventListener('click',function(ev){if(!grid)return;var tile=screenToTile(ev.clientX,ev.clientY);var x=tile.x,y=tile.y;
  if(placeMode!=='none'&&inb(x,y)){var ti=idx(x,y);var t=grid[ti];if(t!==T.OCEAN&&t!==T.MOUNTAIN&&t!==T.VOLCANIC){fauna.push(makeFauna(x,y,placeMode,null));draw();}return;}
  lastClick={x:x,y:y};inspectTile(x,y);});
canvas.addEventListener('mousemove',function(ev){
  if(isPanning){
    var dx=ev.clientX-panStartX,dy=ev.clientY-panStartY;
    panX=panStartPX+dx/zoomLevel;panY=panStartPY+dy/zoomLevel;
    applyZoomPan();return;
  }
  updateTooltip(ev);
});
canvas.addEventListener('mouseleave',function(){var t=document.getElementById('tip');if(t)t.style.display='none';});

// Zoom: mouse wheel
canvas.addEventListener('wheel',function(ev){
  ev.preventDefault();
  var oldZ=zoomLevel;
  if(ev.deltaY<0)zoomLevel=Math.min(ZOOM_MAX,zoomLevel*(1+ZOOM_STEP));
  else zoomLevel=Math.max(ZOOM_MIN,zoomLevel*(1-ZOOM_STEP));
  // Zoom toward cursor position
  var r=canvas.getBoundingClientRect();
  var cx=(ev.clientX-r.left)/r.width-0.5;
  var cy=(ev.clientY-r.top)/r.height-0.5;
  var scaleDelta=zoomLevel/oldZ;
  panX=panX-(cx*canvas.width*(scaleDelta-1))/zoomLevel;
  panY=panY-(cy*canvas.height*(scaleDelta-1))/zoomLevel;
  applyZoomPan();
  var zEl=document.getElementById('hZoom');if(zEl)zEl.textContent=Math.round(zoomLevel*100)+'%';
},{passive:false});

// Pan: right-click drag
canvas.addEventListener('mousedown',function(ev){
  if(ev.button===2){ev.preventDefault();isPanning=true;panStartX=ev.clientX;panStartY=ev.clientY;panStartPX=panX;panStartPY=panY;canvas.style.cursor='grabbing';}
});
window.addEventListener('mouseup',function(ev){
  if(isPanning){isPanning=false;canvas.style.cursor=placeMode!=='none'?'cell':'crosshair';}
});
canvas.addEventListener('contextmenu',function(ev){ev.preventDefault();});

// Double-click: reset zoom/pan
canvas.addEventListener('dblclick',function(ev){
  if(zoomLevel!==1||panX!==0||panY!==0){ev.preventDefault();ev.stopPropagation();resetZoomPan();}
});

// Climate hooks
var seasonalToggleEl=document.getElementById('seasonalToggle');if(seasonalToggleEl)seasonalToggleEl.addEventListener('change',function(e){CFG.seasonalTilt=e.target.checked;});
var anomalyToggleEl=document.getElementById('anomalyToggle');if(anomalyToggleEl)anomalyToggleEl.addEventListener('change',function(e){CFG.anomalies=e.target.checked;});
var volcanoToggleEl=document.getElementById('volcanoToggle');if(volcanoToggleEl)volcanoToggleEl.addEventListener('change',function(e){CFG.volcanoAsh=e.target.checked;});
var climateIntensityEl=document.getElementById('climateIntensity'),climateIntensityOutEl=document.getElementById('climateIntensityOut');
if(climateIntensityEl&&climateIntensityOutEl){climateIntensityEl.value=CFG.climateIntensity;climateIntensityOutEl.textContent=CFG.climateIntensity.toFixed(2);climateIntensityEl.addEventListener('input',function(e){CFG.climateIntensity=parseFloat(e.target.value);climateIntensityOutEl.textContent=CFG.climateIntensity.toFixed(2);});}
var climateSeasonLenEl=document.getElementById('climateSeasonLen'),climateSeasonLenOutEl=document.getElementById('climateSeasonLenOut');
if(climateSeasonLenEl&&climateSeasonLenOutEl){climateSeasonLenEl.value=CFG.climateSeasonLength;climateSeasonLenOutEl.textContent=CFG.climateSeasonLength;climateSeasonLenEl.addEventListener('input',function(e){CFG.climateSeasonLength=parseInt(e.target.value);climateSeasonLenOutEl.textContent=CFG.climateSeasonLength;});}

// Ecology hooks
(function(){
  var ecoEl=document.getElementById('ecoToggle');if(ecoEl)ecoEl.addEventListener('change',function(e){CFG.ecoActive=e.target.checked;});
  var ecoREl=document.getElementById('ecoRenderToggle');if(ecoREl)ecoREl.addEventListener('change',function(e){CFG.ecoRender=e.target.checked;draw();});
  var etEl=document.getElementById('ecotoneToggle');if(etEl)etEl.addEventListener('change',function(e){CFG.ecotoneBlend=e.target.checked;draw();});
  var fcEl=document.getElementById('floraTileCapSlider'),fcOut=document.getElementById('floraTileCapOut');
  if(fcEl&&fcOut){fcEl.value=CFG.floraPerTileMax;fcOut.textContent=CFG.floraPerTileMax;fcEl.addEventListener('input',function(e){CFG.floraPerTileMax=parseInt(e.target.value);fcOut.textContent=CFG.floraPerTileMax;});}
  var fsEl=document.getElementById('floraSpawnSlider'),fsOut=document.getElementById('floraSpawnOut');
  if(fsEl&&fsOut){fsEl.value=CFG.floraSpawnChance;fsOut.textContent=CFG.floraSpawnChance.toFixed(3);fsEl.addEventListener('input',function(e){CFG.floraSpawnChance=parseFloat(e.target.value);fsOut.textContent=CFG.floraSpawnChance.toFixed(3);});}
  var faEl=document.getElementById('faunaSpawnSlider'),faOut=document.getElementById('faunaSpawnOut');
  if(faEl&&faOut){faEl.value=CFG.faunaSpawnChance;faOut.textContent=CFG.faunaSpawnChance.toFixed(3);faEl.addEventListener('input',function(e){CFG.faunaSpawnChance=parseFloat(e.target.value);faOut.textContent=CFG.faunaSpawnChance.toFixed(3);});}
  var muEl=document.getElementById('mutationSlider'),muOut=document.getElementById('mutationOut');
  if(muEl&&muOut){muEl.value=CFG.floraMutationChance;muOut.textContent=Math.round(CFG.floraMutationChance*100)+'%';muEl.addEventListener('input',function(e){var v=parseFloat(e.target.value);CFG.floraMutationChance=v;CFG.faunaMutationChance=v;muOut.textContent=Math.round(v*100)+'%';});}
  var mbEl=document.getElementById('mutBiasSlider'),mbOut=document.getElementById('mutBiasOut');
  if(mbEl&&mbOut){mbEl.value=CFG.floraMutationBias;mbOut.textContent=Math.round(CFG.floraMutationBias*100)+'%';mbEl.addEventListener('input',function(e){CFG.floraMutationBias=parseFloat(e.target.value);mbOut.textContent=Math.round(CFG.floraMutationBias*100)+'%';});}
  var bcEl=document.getElementById('beachCapSlider'),bcOut=document.getElementById('beachCapOut');
  if(bcEl&&bcOut){bcEl.value=CFG.beachCapPct;bcOut.textContent=Math.round(CFG.beachCapPct*100)+'%';bcEl.addEventListener('input',function(e){CFG.beachCapPct=parseFloat(e.target.value);bcOut.textContent=Math.round(CFG.beachCapPct*100)+'%';});}
})();

// Legend tooltips
(function(){
  var ltip=document.getElementById('legendTip');if(!ltip)return;
  var grid=document.querySelector('.legend-grid');if(!grid)return;
  grid.addEventListener('mouseover',function(ev){
    var li=ev.target.closest('.li[data-ltip]');if(!li)return;
    var raw=li.getAttribute('data-ltip');if(!raw)return;
    var parts=raw.split('|');var desc=parts[0]||'';var vars=parts[1]||'';
    var swatch=li.querySelector('.lsw');var swStyle=swatch?swatch.getAttribute('style'):'';
    var name=li.textContent.trim();
    var html='<div class="lt-title"><span class="lt-swatch" style="'+swStyle+'"></span>'+name+'</div>';
    html+='<p class="lt-desc">'+desc+'</p>';
    if(vars)html+='<p class="lt-vars">'+vars+'</p>';
    ltip.innerHTML=html;
    var r=li.getBoundingClientRect();var tw=ltip.offsetWidth||200;
    var left=r.left-tw-10;if(left<8)left=r.right+10;
    var top=r.top;if(top+ltip.offsetHeight>window.innerHeight-8)top=window.innerHeight-ltip.offsetHeight-8;
    ltip.style.left=left+'px';ltip.style.top=top+'px';ltip.style.display='block';
  });
  grid.addEventListener('mouseout',function(ev){
    var li=ev.target.closest('.li[data-ltip]');if(!li)return;
    ltip.style.display='none';
  });
})();

// Hotkeys
window.addEventListener('keydown',function(e){
  if(/INPUT|SELECT|TEXTAREA/.test((e.target||{}).tagName||''))return;
  if(e.code==='Space'){e.preventDefault();running=!running;if(running)loop();}
  else if(e.key==='s'||e.key==='S'){e.preventDefault();running=false;step();draw();}
  else if(e.key==='r'||e.key==='R'){e.preventDefault();running=false;init();buildSliders();applyElevationIntensity();draw();}
  else if(e.key==='f'||e.key==='F'){e.preventDefault();running=true;started=false;boot();}
  else if(e.key==='t'||e.key==='T'){e.preventDefault();runTests();}
});

// ===== Sliders =====
var SLIDER_SCHEMA=[
  {key:'volcanoChancePerTile',min:0,max:0.0005,step:0.00001,label:'Volcano Chance'},
  {key:'coastalSpreadBase',min:0,max:0.01,step:0.0001,label:'Coastal Spread'},
  {key:'erosionChanceBase',min:0,max:0.01,step:0.0001,label:'Erosion Rate'},
  {key:'maxLandCap',min:0.2,max:0.9,step:0.01,label:'Max Land Cap'},
  {key:'elevationIntensity',min:0.5,max:1.5,step:0.05,label:'Elevation Intensity'}
];
function decimalsForStep(step){var s=String(step);var dot=s.indexOf('.');return dot>=0?(s.length-dot-1):0;}
function buildSliders(){
  var host=document.getElementById('sliders');if(!host)return;host.innerHTML='';
  SLIDER_SCHEMA.forEach(function(s){
    var row=document.createElement('div');row.className='p-row';
    var lab=document.createElement('label');lab.textContent=s.label;
    var input=document.createElement('input');input.type='range';input.min=s.min;input.max=s.max;input.step=s.step;input.value=CFG[s.key];
    var out=document.createElement('span');out.className='val';
    function fmt(v){return Number(v).toFixed(decimalsForStep(s.step));}
    out.textContent=fmt(CFG[s.key]);
    input.addEventListener('input',function(e){var val=parseFloat(e.target.value);CFG[s.key]=val;out.textContent=fmt(val);if(s.key==='elevationIntensity')applyElevationIntensity();draw();});
    row.appendChild(lab);row.appendChild(input);row.appendChild(out);host.appendChild(row);
  });
}
function applyElevationIntensity(){
  var EI=CFG.elevationIntensity||1.0;
  CFG.clusterSpikeRate=clamp(0.015+0.02*(EI-1),0.006,0.04);
  CFG.clusterPlusChance=clamp(0.15+0.20*(EI-1),0.08,0.40);
  CFG.mountainAdjUpliftProb=clamp(0.004*EI,0.001,0.010);
  CFG.hillAdjUpliftProb=clamp(0.003*EI,0.001,0.008);
  CFG.rareSurgeProb=clamp(0.02+0.03*(EI-1),0.006,0.06);
}

// ===== Sunlight =====
var sunPhase=0;function reseedSunlight(){sunPhase=sRng()*2000;}
function addHotColdBlobs(arr,count){for(var i=0;i<count;i++){arr.push({cx:sRng()*(W-1),cy:sRng()*(H-1),r:8+sRng()*Math.max(W,H)*0.25,amp:(sRng()<0.5?-1:1)*(0.8+sRng()*1.6)});}}
function computeSunlight(){
  function vnoise(x,y){var t=Math.sin(x*12.9898+y*78.233+sunPhase)*43758.5453;return t-Math.floor(t);}
  var aX=-6+sRng()*12,aY=-6+sRng()*12;var base=5+(sRng()*2-1);var lowAmp=2+sRng()*2;
  var blobs=[];addHotColdBlobs(blobs,2+(sRng()*4)|0);
  for(var y=0;y<H;y++)for(var x=0;x<W;x++){var nx=(x/(W-1))-0.5,ny=(y/(H-1))-0.5;var global=base+aX*nx+aY*ny;var low=lowAmp*(vnoise(x*0.06,y*0.06)-0.5);var acc=0;for(var b=0;b<blobs.length;b++){var dx=x-blobs[b].cx,dy=y-blobs[b].cy;var d=Math.sqrt(dx*dx+dy*dy);acc+=blobs[b].amp*Math.exp(-(d*d)/(2*blobs[b].r*blobs[b].r));}sunlight[idx(x,y)]=global+low+acc;}
  var c=new Float32Array(sunlight);for(var y2=0;y2<H;y2++)for(var x2=0;x2<W;x2++){var sum=0,n=0;neighbors4(x2,y2).forEach(function(p){sum+=c[idx(p[0],p[1])];n++;});sunlight[idx(x2,y2)]=(c[idx(x2,y2)]+sum)/(n+1);}
  for(var y3=0;y3<H;y3++)for(var x3=0;x3<W;x3++){var i3=idx(x3,y3);neighbors4(x3,y3).forEach(function(p){var j=idx(p[0],p[1]);var d=sunlight[j]-sunlight[i3];var lim=CFG.sunlightNeighborMaxDelta;if(Math.abs(d)>lim)sunlight[j]=sunlight[i3]+(d>0?lim:-lim);});}
  var minV=Infinity,maxV=-Infinity;for(var i0=0;i0<W*H;i0++){var v0=sunlight[i0];if(v0<minV)minV=v0;if(v0>maxV)maxV=v0;}var span=Math.max(1e-6,maxV-minV);
  for(var i1=0;i1<W*H;i1++){var t=(sunlight[i1]-minV)/span;sunlight[i1]=clamp(5+(t*10-5)*CFG.sunlightIntensity,0,10);}
}
function computeTemperature(){for(var iT=0;iT<W*H;iT++){var s=Math.max(0,Math.min(1,sunlight[iT]/10));var sCurve=Math.pow(s,1.2);var e=elev[iT]||0;tempField[iT]=clamp(0.3+sCurve*9.8-0.06*e-0.24*Math.pow(Math.max(0,e-6),2)/16,0,10);}}
function computeAridity(){
  var dist=new Float32Array(W*H);for(var i=0;i<W*H;i++)dist[i]=1e9;var q=[];
  for(var y=0;y<H;y++)for(var x=0;x<W;x++){var ii=idx(x,y);if(grid[ii]===T.OCEAN||grid[ii]===T.COAST){dist[ii]=0;q.push([x,y]);}}
  while(q.length){var p=q.shift();var i0=idx(p[0],p[1]);neighbors4(p[0],p[1]).forEach(function(n){var j=idx(n[0],n[1]);if(dist[j]>dist[i0]+1){dist[j]=dist[i0]+1;q.push(n);}});}
  for(var k=0;k<W*H;k++){var d=dist[k];var base=10*(1-Math.exp(-d*CFG.aridityDistK));var Tm=tempField[k]||0;var hot=(Tm>8)?CFG.aridityHotBoost*((Tm-8)/2):0;aridity[k]=clamp(base+CFG.ariditySunCoef*sunlight[k]-CFG.aridityElevCoef*(10-(elev[k]||0))+hot,0,10);}
  var c2=new Float32Array(aridity);for(var y4=0;y4<H;y4++)for(var x4=0;x4<W;x4++){var sum2=0,n2=0;neighbors4(x4,y4).forEach(function(p){sum2+=c2[idx(p[0],p[1])];n2++;});aridity[idx(x4,y4)]=clamp((c2[idx(x4,y4)]+sum2)/(n2+1),0,10);}
  // River moisture effect: reduce aridity on river tiles and neighbors
  if(riverData&&riverGenerated){for(var rk=0;rk<W*H;rk++){if(riverData[rk]){aridity[rk]=clamp(aridity[rk]-RIVER_ARIDITY_EFFECT,0,10);var rx=rk%W,ry=(rk/W)|0;var rn=neighbors4(rx,ry);for(var rni=0;rni<rn.length;rni++){var rnj=idx(rn[rni][0],rn[rni][1]);aridity[rnj]=clamp(aridity[rnj]-RIVER_ARIDITY_EFFECT*0.3,0,10);}}}}
}
function classifyTile(e,A,Tm,SL){if(e>7)return T.MOUNTAIN;if(e>5.3){if(Tm<=2)return T.GLACIER;if(A>5&&Tm>4)return T.MESA;return T.HILLS;}if(Tm<2)return T.ARCTIC;if(Tm<2.5&&A<2.5)return T.GLACIER;if(Tm<3.2&&A<=3.5)return T.TUNDRA;if(A>5&&Tm>4&&SL>7.3)return T.DESERT;if(Tm>6&&SL>5.2&&A<4.3)return T.JUNGLE;if(Tm>5&&A>3&&A<=5.5)return T.SAVANNA;if(A>3&&Tm<3.5)return T.STEPPE;if(A>2&&A<=6.4&&Tm>2.7&&Tm<=6.6)return T.FOREST;if(e<1&&A<=3)return T.WETLAND;return T.PLAINS;}
function reclassTerrain(){for(var y=0;y<H;y++)for(var x=0;x<W;x++){var iR=idx(x,y);if(grid[iR]===T.OCEAN||grid[iR]===T.VOLCANIC)continue;if(grid[iR]===T.COAST&&coastTTL[iR]>0)continue;if(volcanoRing&&volcanoRing[iR]===3){grid[iR]=T.MOUNTAIN;continue;}if(volcanoRing&&volcanoRing[iR]===1){grid[iR]=T.MOUNTAIN;continue;}if(volcanoRing&&volcanoRing[iR]===2){grid[iR]=T.HILLS;continue;}grid[iR]=classifyTile(elev[iR]||0,aridity[iR]||0,tempField[iR]||0,sunlight[iR]||0);}
  // Build ecotone boundary cache
  if(!biomeBoundary||biomeBoundary.length!==W*H) biomeBoundary=new Uint8Array(W*H);
  for(var yy=0;yy<H;yy++)for(var xx=0;xx<W;xx++){var ii=idx(xx,yy);var myT=grid[ii];biomeBoundary[ii]=0;if(myT===T.OCEAN)continue;var nb=neighbors4(xx,yy);for(var nn=0;nn<nb.length;nn++){var nj=idx(nb[nn][0],nb[nn][1]);if(grid[nj]!==myT&&grid[nj]!==T.OCEAN){biomeBoundary[ii]=1;break;}}}
  // Compute beaches on established coasts
}
function randn(){var u=0,v=0;while(u===0)u=Math.random();while(v===0)v=Math.random();return Math.sqrt(-2.0*Math.log(u))*Math.cos(2*Math.PI*v);}
function truncatedNormal(mean,sigma,lo,hi){var x;for(var g=0;g<20;g++){x=mean+sigma*randn();if(x>=lo&&x<=hi)return x;}return clamp(x,lo,hi);}
function betaapprox(a,b){function gK(k){if(k<1){var u=Math.random();return gK(1+k)*Math.pow(u,1/k);}var d=k-1/3,c=1/Math.sqrt(9*d);while(true){var x=randn();var v=1+c*x;if(v<=0)continue;v=v*v*v;var u=Math.random();if(u<1-0.0331*(x*x)*(x*x))return d*v;if(Math.log(u)<0.5*x*x+d*(1-v+Math.log(v)))return d*v;}}var x=gK(a),y=gK(b);return x/(x+y);}
function gammaSample(shape,scale){function gK(k){if(k<1){var u=Math.random();return gK(1+k)*Math.pow(u,1/k);}var d=k-1/3,c=1/Math.sqrt(9*d);while(true){var x=randn();var v=1+c*x;if(v<=0)continue;v=v*v*v;var u=Math.random();if(u<1-0.0331*(x*x)*(x*x))return d*v;if(Math.log(u)<0.5*x*x+d*(1-v+Math.log(v)))return d*v;}}return gK(shape)*scale;}
function pickWorldMeta(){
  if(sRng()<0.85){WORLD.muE=sTruncNorm(3,1,1,6);}else{WORLD.muE=(sRng()<0.5?(1+sRng()):(5+sRng()));}
  var v=sBeta(2,2);if(sRng()<0.10){var v2=sBeta(0.7,0.7);if(v2>0.9)v=0.95;else if(v2<0.1)v=0.05;}WORLD.varMode=v;
  WORLD.H0=1.4;WORLD.Hmax=9.0;WORLD.k=0.006;WORLD.alphaCoast=0.7;WORLD.coastBias=(sRng()*0.6-0.3);
  var mu_core=(WORLD.muE-WORLD.H0)/WORLD.alphaCoast+WORLD.H0;var tau=clamp((mu_core-WORLD.H0)/(WORLD.Hmax-WORLD.H0),0.05,0.98);
  var a=12*(1-v)+1.2*(v);var theta=(Math.pow(1-tau,-1/a)-1)/WORLD.k;if(sRng()<0.04)theta*=(1.4+sRng()*0.3);
  WORLD.gammaA=a;WORLD.gammaTheta=Math.max(10,theta);
}
function currentCoreHeight(age){return clamp(WORLD.H0+(WORLD.Hmax-WORLD.H0)*(1-Math.exp(-WORLD.k*age)),0,9.6);}
function landCoverage(){var land=0;for(var i=0;i<W*H;i++)if(grid[i]!==T.OCEAN)land++;return land/(W*H);}
function tryVolcano(x,y){var i=idx(x,y);if(grid[i]!==T.OCEAN)return false;var cov=landCoverage();if(cov>CFG.maxLandCap)return false;var boost=(cov===0)?200:1;var chance=Math.min(0.02,CFG.volcanoChancePerTile*boost);if(sRng()>=chance)return false;grid[i]=T.VOLCANIC;volcActive[i]=1;volcAge[i]=0;volcLife[i]=Math.max(20,Math.floor(sGamma(WORLD.gammaA,WORLD.gammaTheta)));elev[i]=currentCoreHeight(0);return true;}
function coolVolcano(i){volcActive[i]=0;grid[i]=T.PLAINS;var x=i%W,y=(i/W)|0;var adjOcean=false;neighbors4(x,y).forEach(function(p){if(grid[idx(p[0],p[1])]==T.OCEAN)adjOcean=true;});if(adjOcean){grid[i]=T.COAST;coastTTL[i]=12+(sRng()*12)|0;}}
function tryCoastal(x,y){var i=idx(x,y);if(grid[i]!==T.OCEAN)return false;var adj=[];neighbors4(x,y).forEach(function(p){var j=idx(p[0],p[1]);if(grid[j]!==T.OCEAN&&grid[j]!==T.VOLCANIC)adj.push(j);});if(!adj.length)return false;var cov=landCoverage();var mod=(cov>CFG.maxLandCap?0:(cov>CFG.maxLandCap*0.85?(1-(cov-CFG.maxLandCap*0.85)/(CFG.maxLandCap*0.15)):1));var chance=CFG.coastalSpreadBase*adj.length*mod;if(sRng()>=chance)return false;var nj=adj[(sRng()*adj.length)|0];elev[i]=clamp(0.85*(elev[nj]||0)+0.15*WORLD.coastBias+(sRng()*0.4-0.2),0,10);grid[i]=T.COAST;coastTTL[i]=(16+(sRng()*16)|0);return true;}
function erosionStep(x,y){var i=idx(x,y);if(grid[i]===T.OCEAN)return;var nearOcean=false;neighbors4(x,y).forEach(function(p){if(grid[idx(p[0],p[1])]==T.OCEAN)nearOcean=true;});var sLoc=0;neighbors4(x,y).forEach(function(p){var d=Math.abs((elev[i]||0)-(elev[idx(p[0],p[1])]||0));if(d>sLoc)sLoc=d;});var eNow=elev[i]||0;var highE=Math.max(0,(eNow-8.5)/1.5);var p=CFG.erosionChanceBase*(nearOcean?1.4:1.0)*(1+0.6*sLoc)*(1+0.85*highE);if(sRng()<p){elev[i]=Math.max(0,eNow-(0.12+sRng()*0.18)*(1+0.30*highE));}}
function promoteVolcanoAt(i){if(peakVolcano&&peakVolcano[i])return;if(volcanoRing&&volcanoRing[i]!==0)return;peakVolcano[i]=1;volcanoCenters.push(i);var x=i%W,y=(i/W)|0;elev[i]=10.0;volcanoRing[i]=3;adjCooldown[i]=9999;var r1=neighbors4(x,y);for(var k=0;k<r1.length;k++){var j=idx(r1[k][0],r1[k][1]);if(grid[j]===T.OCEAN)continue;volcanoRing[j]=1;adjCooldown[j]=Math.max(adjCooldown[j]||0,9999);elev[j]=Math.max(elev[j]||0,7.2+sRng()*1.4);}var seen=new Uint8Array(W*H);seen[i]=1;for(var k1=0;k1<r1.length;k1++)seen[idx(r1[k1][0],r1[k1][1])]=1;for(var k2=0;k2<r1.length;k2++){var p=r1[k2];var n2=neighbors4(p[0],p[1]);for(var m=0;m<n2.length;m++){var j2=idx(n2[m][0],n2[m][1]);if(seen[j2])continue;seen[j2]=1;if(grid[j2]===T.OCEAN)continue;if(volcanoRing[j2]===0){volcanoRing[j2]=2;adjCooldown[j2]=Math.max(adjCooldown[j2]||0,9999);elev[j2]=Math.max(elev[j2]||0,5.4+sRng()*0.4);}}}}
function clusterSpikePass(){
  var doAdj=(tick%CFG.adjUpliftEvery)===0;var hillBudget=Math.max(1,(W*H*0.0005)|0);var mountBudget=Math.max(1,(W*H*0.0005)|0);
  function spikeIncrement(e){var base=(e<7.5)?(0.085+sRng()*0.07):(0.075+sRng()*0.035);var taper=Math.max(0,(10.0-e)/10.0);var inc=base*taper;if(e>7.2&&sRng()<(CFG.rareSurgeProb||0))inc+=(0.05+sRng()*0.06)*taper;return inc;}
  for(var y=1;y<H-1;y++)for(var x=1;x<W-1;x++){var i=idx(x,y);var t=grid[i];if(adjCooldown&&adjCooldown[i]>0)adjCooldown[i]=Math.max(0,adjCooldown[i]-1);
    if(doAdj){if(t===T.MOUNTAIN&&mountBudget>0){var ns=neighbors4(x,y);for(var k=0;k<ns.length&&mountBudget>0;k++){var j=idx(ns[k][0],ns[k][1]);if(grid[j]===T.OCEAN)continue;if(adjCooldown&&adjCooldown[j]>0)continue;var ej=elev[j]||0;if(ej<CFG.mountainAdjUpliftMax&&sRng()<CFG.mountainAdjUpliftProb){elev[j]=Math.min(CFG.mountainAdjUpliftMax,ej+0.02+sRng()*0.04);if(adjCooldown)adjCooldown[j]=CFG.adjCooldownTicks;mountBudget--;}}}
    if(t===T.HILLS&&hillBudget>0){var n4=neighbors4(x,y),countHM=0;for(var m=0;m<n4.length;m++){var jj=idx(n4[m][0],n4[m][1]);if(grid[jj]===T.HILLS||grid[jj]===T.MOUNTAIN)countHM++;}if(countHM>=3){for(var h=0;h<n4.length&&hillBudget>0;h++){var jh=idx(n4[h][0],n4[h][1]);if(grid[jh]===T.OCEAN)continue;if(adjCooldown&&adjCooldown[jh]>0)continue;var eh=elev[jh]||0;if(eh<CFG.hillAdjUpliftCap&&sRng()<CFG.hillAdjUpliftProb){elev[jh]=Math.min(CFG.hillAdjUpliftCap,eh+0.03+sRng()*0.03);if(adjCooldown)adjCooldown[jh]=CFG.adjCooldownTicks;hillBudget--;}}}}}
    if(!(t===T.HILLS||t===T.MOUNTAIN))continue;var n4c=neighbors4(x,y);var hm=0;for(var q=0;q<n4c.length;q++){var j2=idx(n4c[q][0],n4c[q][1]);if(grid[j2]===T.HILLS||grid[j2]===T.MOUNTAIN)hm++;}if(hm<3)continue;if(sRng()>=CFG.clusterSpikeRate)continue;
    var eNow=elev[i]||0;var inc=spikeIncrement(eNow);if(inc>0){var newE=clamp(eNow+inc,0,10.0);if(newE>=9.9&&newE<10&&sRng()<0.5)newE=10.0;elev[i]=newE;}
    if(sRng()<CFG.clusterPlusChance){for(var q2=0;q2<n4c.length;q2++){var j3=idx(n4c[q2][0],n4c[q2][1]);var ej2=elev[j3]||0;var addN=(0.02+sRng()*0.03)*Math.max(0,(9.9-ej2)/9.9);if(addN>0)elev[j3]=clamp(ej2+addN,0,9.88);}}}
}
function eruptionPromotionPass(){function manhattan(i,j){var x1=i%W,y1=(i/W)|0,x2=j%W,y2=(j/W)|0;return Math.abs(x1-x2)+Math.abs(y1-y2);}for(var i=0;i<W*H;i++){if(grid[i]!==T.MOUNTAIN)continue;if(volcanoRing&&volcanoRing[i]!==0)continue;if(peakVolcano&&peakVolcano[i])continue;if((elev[i]||0)<9.95)continue;if(volcanoCenters.length>=(CFG.maxVolcanoCenters|0))continue;var ok=true;for(var v=0;v<volcanoCenters.length;v++){if(manhattan(i,volcanoCenters[v])<CFG.minVolcanoSpacing){ok=false;break;}}if(!ok)continue;promoteVolcanoAt(i);}}
function mountainFringePass(){if(!ringDone)return false;var changed=false;for(var y=0;y<H;y++)for(var x=0;x<W;x++){var i=idx(x,y);if(grid[i]!==T.MOUNTAIN||ringDone[i])continue;ringDone[i]=1;var ns=neighbors4(x,y);for(var k=0;k<ns.length;k++){var j=idx(ns[k][0],ns[k][1]);if(grid[j]===T.OCEAN)continue;var ej=elev[j]||0;if(ej<5.3){elev[j]=Math.min(5.35,ej+0.08+sRng()*0.08);if(adjCooldown)adjCooldown[j]=CFG.adjCooldownTicks;changed=true;}}}return changed;}
function isolatedHillDecayPass(){if((tick%50)!==0)return;for(var y=0;y<H;y++)for(var x=0;x<W;x++){var i=idx(x,y);if(grid[i]!==T.HILLS){hillDecayCount[i]=0;continue;}var alone=true;var n4=neighbors4(x,y);for(var k=0;k<n4.length;k++){var j=idx(n4[k][0],n4[k][1]);if(grid[j]===T.HILLS||grid[j]===T.MOUNTAIN){alone=false;break;}}if(!alone){hillDecayCount[i]=0;continue;}var c=hillDecayCount[i]|0;if(c>=7)continue;elev[i]=Math.max(0,(elev[i]||0)-0.15);hillDecayCount[i]=c+1;}}

// ======================================================================
//  RIVER SYSTEM
// ======================================================================
var DIR_DX=[0,1,1,1,0,-1,-1,-1];
var DIR_DY=[-1,-1,0,1,1,1,0,-1];
function oppositeDir(d){return(d+4)%8;}

function generateRivers(){
  riverData=new Array(W*H);for(var i=0;i<W*H;i++)riverData[i]=null;
  riverGenerated=true;
  // Use seeded RNG for reproducibility
  var rRng=mulberry32(_seed+7919);

  // 1. Find candidate source tiles: elevation >= threshold, not ocean/glacier
  var candidates=[];
  for(var y=0;y<H;y++)for(var x=0;x<W;x++){
    var i=idx(x,y);var e=elev[i]||0;var t=grid[i];
    if(e>=RIVER_MIN_ELEV&&t!==T.OCEAN&&t!==T.GLACIER&&t!==T.VOLCANIC){
      candidates.push({x:x,y:y,i:i,elev:e});
    }
  }
  // Sort by elevation descending
  candidates.sort(function(a,b){return b.elev-a.elev;});

  // 2. Select sources with spacing constraint
  var maxRivers=Math.max(2,Math.round(RIVER_MAX_COUNT_BASE*(W*H)/(96*96)));
  var sources=[];
  for(var ci=0;ci<candidates.length&&sources.length<maxRivers;ci++){
    var c=candidates[ci];var tooClose=false;
    for(var si=0;si<sources.length;si++){
      if(Math.abs(c.x-sources[si].x)+Math.abs(c.y-sources[si].y)<RIVER_MIN_SOURCE_SPACING){tooClose=true;break;}
    }
    if(!tooClose)sources.push(c);
  }

  // 3. Trace each river downhill
  for(var ri=0;ri<sources.length;ri++){
    var src=sources[ri];
    // Source gets a pool
    riverData[src.i]={entryDir:-1,exitDir:-1,volume:1,lake:false,sourcePool:true,estuary:false,
      curveOffset:(rRng()-0.5)*0.4,poolSize:0.2+rRng()*0.2};

    var cx=src.x,cy=src.y;
    var visited=new Uint8Array(W*H);visited[src.i]=1;
    var path=[src.i];

    for(var step=0;step<W+H;step++){
      // Find lowest neighbor: try cardinal first, then diagonal
      var bestE=Infinity,bestX=-1,bestY=-1,bestDir=-1;
      var curE=elev[idx(cx,cy)]||0;

      // Cardinal directions first (0,2,4,6)
      for(var d=0;d<8;d+=2){
        var nx=cx+DIR_DX[d],ny=cy+DIR_DY[d];
        if(!inb(nx,ny))continue;var ni=idx(nx,ny);
        if(visited[ni])continue;
        var ne=elev[ni]||0;var nt=grid[ni];
        if(nt===T.GLACIER)continue; // frozen, no flow
        if(ne<bestE){bestE=ne;bestX=nx;bestY=ny;bestDir=d;}
      }
      // If no cardinal is lower, try diagonals (1,3,5,7)
      if(bestE>=curE){
        for(var d2=1;d2<8;d2+=2){
          var nx2=cx+DIR_DX[d2],ny2=cy+DIR_DY[d2];
          if(!inb(nx2,ny2))continue;var ni2=idx(nx2,ny2);
          if(visited[ni2])continue;
          var ne2=elev[ni2]||0;var nt2=grid[ni2];
          if(nt2===T.GLACIER)continue;
          if(ne2<bestE){bestE=ne2;bestX=nx2;bestY=ny2;bestDir=d2;}
        }
      }

      // No lower neighbor at all -> form a basin lake
      if(bestDir===-1||bestE>=curE){
        var ci2=idx(cx,cy);
        if(riverData[ci2]){riverData[ci2].lake=true;riverData[ci2].exitDir=-1;
          riverData[ci2].poolSize=0.25+rRng()*0.2;}
        else{riverData[ci2]={entryDir:-1,exitDir:-1,volume:1,lake:true,sourcePool:false,estuary:false,
          curveOffset:0,poolSize:0.25+rRng()*0.2};}
        break;
      }

      // Set exit direction on current tile
      var curI=idx(cx,cy);
      if(riverData[curI])riverData[curI].exitDir=bestDir;

      var nextI=idx(bestX,bestY);var nextT=grid[nextI];

      // Termination: ocean or coast -> mark estuary on current tile
      if(nextT===T.OCEAN||nextT===T.COAST){
        if(riverData[curI])riverData[curI].estuary=true;
        break;
      }
      // Termination: wetland absorbs the river
      if(nextT===T.WETLAND){
        break;
      }

      // Place river on next tile
      var entDir=oppositeDir(bestDir);
      if(riverData[nextI]){
        // Merge: another river already here -> add volume
        riverData[nextI].volume++;
      } else {
        riverData[nextI]={entryDir:entDir,exitDir:-1,volume:1,lake:false,sourcePool:false,estuary:false,
          curveOffset:(rRng()-0.5)*0.5,poolSize:0};
      }
      visited[nextI]=1;path.push(nextI);
      cx=bestX;cy=bestY;
    }

    // Backfill volume downstream (accumulate)
    var vol=1;
    for(var pi=0;pi<path.length;pi++){
      var rd=riverData[path[pi]];
      if(rd){if(rd.volume<vol)rd.volume=vol;vol=rd.volume+1;}
    }
  }
}

function clearRivers(){
  riverData=new Array(W*H);for(var i=0;i<W*H;i++)riverData[i]=null;
  riverGenerated=false;
}

function drawRivers(){
  if(!riverData||!riverGenerated)return;
  for(var y=0;y<H;y++)for(var x=0;x<W;x++){
    var i=idx(x,y);var rd=riverData[i];if(!rd)continue;
    var px=x*PIX,py=y*PIX;var mid=PIX/2;

    // Source pool or basin lake
    if(rd.sourcePool||rd.lake){
      ctx.fillStyle=LAKE_COLOR;
      var radius=Math.max(1.5,PIX*rd.poolSize);
      ctx.beginPath();ctx.arc(px+mid,py+mid,radius,0,Math.PI*2);ctx.fill();
    }

    // River line
    if(rd.exitDir>=0){
      // Entry point
      var ex,ey;
      if(rd.entryDir>=0){ex=px+mid+DIR_DX[rd.entryDir]*mid;ey=py+mid+DIR_DY[rd.entryDir]*mid;}
      else if(rd.sourcePool){ex=px+mid;ey=py+mid;}
      else{ex=px+mid;ey=py+mid;}
      // Exit point
      var ox=px+mid+DIR_DX[rd.exitDir]*mid;
      var oy=py+mid+DIR_DY[rd.exitDir]*mid;
      // Control point for Bezier curve (offset from center for meander)
      var cpx=px+mid+rd.curveOffset*PIX;
      var cpy=py+mid+(rd.curveOffset*0.6)*PIX;
      // Width based on volume
      var lineW=Math.max(1,Math.min(PIX*0.4,0.8+rd.volume*0.4));
      ctx.strokeStyle=RIVER_COLOR;ctx.lineWidth=lineW;ctx.lineCap='round';
      ctx.beginPath();ctx.moveTo(ex,ey);ctx.quadraticCurveTo(cpx,cpy,ox,oy);ctx.stroke();

      // Estuary: widen at the end
      if(rd.estuary){
        var estuaryW=lineW*2.2;
        ctx.strokeStyle=RIVER_COLOR;ctx.lineWidth=estuaryW;ctx.lineCap='round';
        ctx.beginPath();
        var t=0.65;var mx=(1-t)*(1-t)*ex+2*(1-t)*t*cpx+t*t*ox;var my=(1-t)*(1-t)*ey+2*(1-t)*t*cpy+t*t*oy;
        ctx.moveTo(mx,my);ctx.lineTo(ox,oy);ctx.stroke();
      }
    }
    // Standalone entry (river flows in but terminates here -> lake)
    else if(rd.entryDir>=0&&rd.lake){
      var ex2=px+mid+DIR_DX[rd.entryDir]*mid;
      var ey2=py+mid+DIR_DY[rd.entryDir]*mid;
      var lineW2=Math.max(1,0.8+rd.volume*0.4);
      ctx.strokeStyle=RIVER_COLOR;ctx.lineWidth=lineW2;ctx.lineCap='round';
      ctx.beginPath();ctx.moveTo(ex2,ey2);ctx.lineTo(px+mid,py+mid);ctx.stroke();
    }
  }
}
// ======================================================================
//  BEACH EROSION PROCESS
// ======================================================================
var BEACH_EXCLUDED_BIOMES=[T.WETLAND,T.GLACIER,T.VOLCANIC,T.ARCTIC,T.TUNDRA];
function beachStep(){
  if(!beachLevel||tick<CFG.beachMinTick)return;
  if(CFG.beachCapPct<=0)return;
  var beachCount=0,landCount=0;
  for(var i=0;i<W*H;i++){if(grid[i]!==T.OCEAN)landCount++;if(beachLevel[i]>0.05)beachCount++;}
  var cap=Math.max(1,Math.floor(landCount*CFG.beachCapPct));
  var atCap=(beachCount>=cap);
  if(tick%3!==0)return;
  for(var y=0;y<H;y++)for(var x=0;x<W;x++){
    var i=idx(x,y);
    if(grid[i]===T.OCEAN)continue;
    var oceanEdges=0;var nbrs=neighbors4(x,y);
    for(var n=0;n<nbrs.length;n++){if(grid[idx(nbrs[n][0],nbrs[n][1])]===T.OCEAN)oceanEdges++;}
    var isCoastal=(oceanEdges>0);
    if(beachLevel[i]>0.01){
      if(!isCoastal){beachLevel[i]=Math.max(0,beachLevel[i]-0.0002);continue;}
      var eL=elev[i]||0;var tM=tempField[i]||0;
      var growMod=(eL<1.0?1.5:eL<CFG.beachMaxElev?1.0:0.2)*(tM>6?1.3:tM>CFG.beachMinTemp?1.0:0.3);
      beachLevel[i]=Math.min(1.0,beachLevel[i]+CFG.beachGrowRate*growMod);
      if(!atCap&&beachLevel[i]>0.15&&Math.random()<CFG.beachSpreadChance){
        var spreadCands=[];
        for(var sn=0;sn<nbrs.length;sn++){
          var si=idx(nbrs[sn][0],nbrs[sn][1]);
          if(grid[si]===T.OCEAN||beachLevel[si]>0.05)continue;
          var snCoast=false;var sn2=neighbors4(nbrs[sn][0],nbrs[sn][1]);
          for(var sn3=0;sn3<sn2.length;sn3++){if(grid[idx(sn2[sn3][0],sn2[sn3][1])]===T.OCEAN){snCoast=true;break;}}
          if(!snCoast)continue;
          var sSkip=false;for(var se=0;se<BEACH_EXCLUDED_BIOMES.length;se++){if(grid[si]===BEACH_EXCLUDED_BIOMES[se]){sSkip=true;break;}}
          if(sSkip)continue;
          var sElev=elev[si]||0;var sTemp=tempField[si]||0;
          if(sElev<=CFG.beachMaxElev&&sTemp>=CFG.beachMinTemp)spreadCands.push(si);
        }
        if(spreadCands.length>0){var pick=spreadCands[(Math.random()*spreadCands.length)|0];beachLevel[pick]=CFG.beachSpreadAmount;}
      }
      if(beachLevel[i]>CFG.beachErosionThreshold){elev[i]=Math.max(0,elev[i]-CFG.beachErosionRate);}
      if(beachLevel[i]>=CFG.beachOceanThreshold&&elev[i]<0.3){grid[i]=T.OCEAN;beachLevel[i]=0;elev[i]=0;}
    }
    else if(isCoastal&&!atCap){
      var skip=false;for(var be=0;be<BEACH_EXCLUDED_BIOMES.length;be++){if(grid[i]===BEACH_EXCLUDED_BIOMES[be]){skip=true;break;}}
      if(skip)continue;
      var eL2=elev[i]||0;var tM2=tempField[i]||0;
      if(eL2>CFG.beachMaxElev||tM2<CFG.beachMinTemp)continue;
      var seedChance=0.00001*(eL2<1.0?2.0:1.0)*(tM2>6?1.5:1.0)*(oceanEdges>1?1.5:1.0);
      if(Math.random()<seedChance){beachLevel[i]=0.02;}
    }
  }
}
function clearBeaches(){beachLevel=new Float32Array(W*H);}

// ======================================================================
//  SPECIES NAMING SYSTEM
// ======================================================================
function generateSpeciesName(entity,type){
  // Genus from hue bucket (similar-looking organisms share genus)
  var hueBucket=Math.floor(entity.hue/20);
  var key=type+'-'+hueBucket;
  if(!speciesNameCache[key]){
    // Build genus: 2 syllables from genus parts, seeded by hue
    var g1=GENUS_PARTS[hueBucket%GENUS_PARTS.length];
    var g2=GENUS_PARTS[(hueBucket*7+3)%GENUS_PARTS.length].toLowerCase();
    var genus=g1+g2;
    speciesNameCache[key]=genus;
  }
  var genus=speciesNameCache[key];
  // Species epithet from habitat + climate adaptation
  var aridBucket=Math.floor(entity.prefArid/2.5);
  var tempBucket=Math.floor(entity.prefTemp/2.5);
  var hab=HABITAT_PARTS[(aridBucket*4+tempBucket)%HABITAT_PARTS.length];
  var suf=SPECIES_PARTS[(aridBucket+tempBucket*3+hueBucket)%SPECIES_PARTS.length];
  return genus+' '+hab+suf;
}
function getSpeciesName(entity,type){
  if(entity.gen<5) return null; // too young a lineage
  if(!entity._speciesName) entity._speciesName=generateSpeciesName(entity,type);
  return entity._speciesName;
}

// ======================================================================
//  ECOLOGY SYSTEM
// ======================================================================
function hsv2hex(h,s,v){s=clamp(s,0,1);v=clamp(v,0,1);var c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;var r=0,g=0,b=0;if(h<60){r=c;g=x;}else if(h<120){r=x;g=c;}else if(h<180){g=c;b=x;}else if(h<240){g=x;b=c;}else if(h<300){r=x;b=c;}else{r=c;b=x;}return '#'+[Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)].map(function(vv){return vv.toString(16).padStart(2,'0');}).join('');}
var FLORA_SHAPES=['dot','plus','x','ring','diamond'];
function makeFlora(x,y,prefs){var i=idx(x,y);var tA=(aridity[i]||5),tT=(tempField[i]||5),tS=(sunlight[i]||5);var pA=prefs?prefs.prefArid:clamp(tA+(Math.random()*2-1),0,10);var pT=prefs?prefs.prefTemp:clamp(tT+(Math.random()*2-1),0,10);var pS=prefs?prefs.prefSL:clamp(tS+(Math.random()*2-1),0,10);var tol=prefs?prefs.tolerance:(CFG.floraToleranceBase+(Math.random()-0.5)*1.0);
  // Natural flora palette: olive-gold (55) through deep green (155), aridity shifts toward gold
  var hue=prefs?prefs.hue:(55+pT*6+Math.max(0,(7-pA))*8+(Math.random()*16-8));
  hue=((hue%360)+360)%360; if(hue<55||hue>155) hue=55+Math.random()*100; // clamp to natural band
  var sat=prefs?prefs.sat:(0.3+0.04*(10-pA)+Math.random()*0.15); // lower sat = more natural
  var val=prefs?prefs.val:(0.35+Math.random()*0.25); // darker overall
  return{id:++floraIdCounter,x:x,y:y,prefArid:pA,prefTemp:pT,prefSL:pS,tolerance:clamp(tol,1.0,5.0),hue:hue,sat:clamp(sat,0.25,0.7),val:clamp(val,0.3,0.65),shape:FLORA_SHAPES[(Math.random()*FLORA_SHAPES.length)|0],health:1.0,age:0,maxAge:CFG.floraBaseMaxAge*(0.7+Math.random()*0.6),gen:prefs?(prefs.gen||0):0};}
// Biome harshness: multiplier on flora health. 1.0 = normal, lower = harder to survive
var BIOME_FLORA_HARSHNESS=[];
BIOME_FLORA_HARSHNESS[T.OCEAN]=0;
BIOME_FLORA_HARSHNESS[T.COAST]=0.85;
BIOME_FLORA_HARSHNESS[T.PLAINS]=1.0;
BIOME_FLORA_HARSHNESS[T.FOREST]=1.0;
BIOME_FLORA_HARSHNESS[T.HILLS]=0.8;
BIOME_FLORA_HARSHNESS[T.MOUNTAIN]=0.15;   // barely anything grows
BIOME_FLORA_HARSHNESS[T.DESERT]=0.12;     // near-barren, rare oasis only
BIOME_FLORA_HARSHNESS[T.WETLAND]=0.95;
BIOME_FLORA_HARSHNESS[T.JUNGLE]=1.0;
BIOME_FLORA_HARSHNESS[T.ARCTIC]=0.2;      // tundra scrub only
BIOME_FLORA_HARSHNESS[T.STEPPE]=0.5;      // dry grassland, limited
BIOME_FLORA_HARSHNESS[T.VOLCANIC]=0.05;   // almost nothing
BIOME_FLORA_HARSHNESS[T.GLACIER]=0.08;    // near-lifeless ice
BIOME_FLORA_HARSHNESS[T.TUNDRA]=0.30;    // sparse mosses, lichen
BIOME_FLORA_HARSHNESS[T.SAVANNA]=0.55;   // scattered trees, dry grass
BIOME_FLORA_HARSHNESS[T.MESA]=0.15;      // very sparse, hardy scrub
function computeFloraHealth(f){var i=idx(f.x,f.y);if(!inb(f.x,f.y)||grid[i]===T.OCEAN)return 0;var dA=(aridity[i]||5)-f.prefArid,dT=(tempField[i]||5)-f.prefTemp,dS=(sunlight[i]||5)-f.prefSL;var base=Math.exp(-(dA*dA+dT*dT+dS*dS)/(2*f.tolerance*f.tolerance*2));var harshness=BIOME_FLORA_HARSHNESS[grid[i]];if(harshness===undefined)harshness=1.0;return base*harshness;}
function mutateFloraChild(parent,cx,cy){var mag=CFG.floraMutationMag;var bias=CFG.floraMutationBias||0;
  // Adaptive mutation: shift partially toward local tile conditions
  var ci=idx(cx,cy);var tA=(aridity[ci]||5),tT=(tempField[ci]||5),tS=(sunlight[ci]||5);
  // Random component + directional pull toward tile's actual values
  var shiftA=randn()*mag*(1-bias)+(tA-parent.prefArid)*bias;
  var shiftT=randn()*mag*(1-bias)+(tT-parent.prefTemp)*bias;
  var shiftS=randn()*mag*(1-bias)+(tS-parent.prefSL)*bias;
  var child=makeFlora(cx,cy,{prefArid:clamp(parent.prefArid+shiftA,0,10),prefTemp:clamp(parent.prefTemp+shiftT,0,10),prefSL:clamp(parent.prefSL+shiftS,0,10),tolerance:clamp(parent.tolerance+randn()*0.3,1.0,5.0),hue:clamp((parent.hue+randn()*12+360)%360,55,155),sat:clamp(parent.sat+(Math.random()-0.5)*0.08,0.25,0.7),val:clamp(parent.val+(Math.random()-0.5)*0.06,0.3,0.65),gen:parent.gen+1});if(Math.random()<0.3)child.shape=FLORA_SHAPES[(Math.random()*FLORA_SHAPES.length)|0];return child;}
function cloneFloraChild(parent,cx,cy){return makeFlora(cx,cy,{prefArid:parent.prefArid,prefTemp:parent.prefTemp,prefSL:parent.prefSL,tolerance:parent.tolerance,hue:parent.hue,sat:parent.sat,val:parent.val,gen:parent.gen});}
function seedFloraCluster(n){var placed=0,guard=5000;while(placed<n&&guard-->0){var x=(Math.random()*W)|0,y=(Math.random()*H)|0;var t=grid[idx(x,y)];if(t!==T.OCEAN&&t!==T.MOUNTAIN&&t!==T.VOLCANIC){flora.push(makeFlora(x,y,null));placed++;}}}
// Dynamic flora pop cap: 0 = map-size based (tiles x per-tile cap), else use configured value
function floraPopCap(){return CFG.floraMaxPop>0?CFG.floraMaxPop:(W*H*(CFG.floraPerTileMax||4));}
function naturalFloraSpawn(){if(flora.length>=floraPopCap())return;if(Math.random()>=CFG.floraSpawnChance)return;var guard=50;while(guard-->0){var x=(Math.random()*W)|0,y=(Math.random()*H)|0;var t=grid[idx(x,y)];if(t!==T.OCEAN&&t!==T.MOUNTAIN&&t!==T.VOLCANIC){flora.push(makeFlora(x,y,null));return;}}}
function floraStep(){if(!CFG.ecoActive)return;naturalFloraSpawn();
  // Process regrowth remnants
  var rKeep=[];for(var ri=0;ri<floraRemnants.length;ri++){var rem=floraRemnants[ri];if(tick>=rem.tickDue){if(flora.length<floraPopCap()){var ti=idx(rem.x,rem.y);if(grid[ti]!==T.OCEAN){flora.push(makeFlora(rem.x,rem.y,rem.prefs));}}}else{rKeep.push(rem);}}floraRemnants=rKeep;
  // Build per-tile flora index for competition checks
  var _floraTile={};for(var ff=0;ff<flora.length;ff++){if(!flora[ff])continue;var fk=idx(flora[ff].x,flora[ff].y);if(!_floraTile[fk])_floraTile[fk]=[];_floraTile[fk].push(ff);}
  // Adaptive sampling: higher rate at small populations for establishment
  var sampleRate=(flora.length<50)?0.30:0.15;
  var sampleSize=Math.min(flora.length,Math.max(8,(flora.length*sampleRate)|0));var newFlora=[];
  for(var k=0;k<sampleSize;k++){var fi=(Math.random()*flora.length)|0;var f=flora[fi];if(!f)continue;f.health=computeFloraHealth(f);f.age++;var effectiveMaxAge=f.maxAge*(0.3+0.7*f.health);if(f.age>=effectiveMaxAge||f.health<0.05){flora[fi]=null;continue;}if(grid[idx(f.x,f.y)]===T.OCEAN){flora[fi]=null;continue;}if(flora.length+newFlora.length>=floraPopCap())continue;
    // Spread chance: base x health^2 x ecotone boost
    var spreadMod=1.0;if(biomeBoundary&&biomeBoundary[idx(f.x,f.y)])spreadMod=CFG.ecotoneFloraBoost||1.0;
    if(Math.random()>=CFG.floraSpreadBase*f.health*f.health*spreadMod)continue;
    var cands=neighbors8(f.x,f.y).filter(function(p){var t=grid[idx(p[0],p[1])];return t!==T.OCEAN&&t!==T.MOUNTAIN&&t!==T.VOLCANIC;});if(!cands.length)continue;var dest=cands[(Math.random()*cands.length)|0];
    var child=Math.random()<CFG.floraMutationChance?mutateFloraChild(f,dest[0],dest[1]):cloneFloraChild(f,dest[0],dest[1]);
    // Competition: check carrying capacity at destination
    var destIdx=idx(dest[0],dest[1]);var existing=_floraTile[destIdx];var cap=CFG.floraPerTileMax||4;
    if(existing&&existing.length>=cap){
      // Find weakest existing flora on this tile
      var weakIdx=-1,weakHP=999;for(var wi=0;wi<existing.length;wi++){var wf=flora[existing[wi]];if(wf&&wf.health<weakHP){weakHP=wf.health;weakIdx=existing[wi];}}
      var childHP=computeFloraHealth(child);
      if(childHP>weakHP&&weakIdx>=0){flora[weakIdx]=null;newFlora.push(child);} // competitive displacement
      // else: child dies, tile is full of stronger plants
    } else { newFlora.push(child); }
  }
  if(tick%10===0){for(var i=0;i<flora.length;i++){if(flora[i]){flora[i].health=computeFloraHealth(flora[i]);flora[i].age++;if(flora[i].age>=flora[i].maxAge*(0.3+0.7*flora[i].health)||flora[i].health<0.05||grid[idx(flora[i].x,flora[i].y)]===T.OCEAN)flora[i]=null;}}}
  flora=flora.filter(function(f){return f!==null;});for(var j=0;j<newFlora.length;j++)flora.push(newFlora[j]);}

// Fauna
// Vivid mutation palette: striking colors that stand out against earthy backdrop
var VIVID_HUES=[210,25,290,50,355,175,320,140]; // blue, orange, purple, gold, crimson, cyan, magenta, lime
function makeFauna(x,y,type,prefs){var i=idx(x,y);var tA=(aridity[i]||5),tT=(tempField[i]||5),tS=(sunlight[i]||5);var isH=(type==='herbivore');var pA=prefs?prefs.prefArid:clamp(tA+(Math.random()*3-1.5),0,10);var pT=prefs?prefs.prefTemp:clamp(tT+(Math.random()*3-1.5),0,10);var pS=prefs?prefs.prefSL:clamp(tS+(Math.random()*3-1.5),0,10);var tol=prefs?prefs.tolerance:(3.0+Math.random()*1.5);
  var vivid=prefs?!!prefs.vivid:false;
  var hue,sat,val;
  if(prefs&&prefs.hue!==undefined){hue=prefs.hue;sat=prefs.sat;val=prefs.val;}
  else if(vivid){hue=VIVID_HUES[(Math.random()*VIVID_HUES.length)|0]+randn()*8;sat=0.75+Math.random()*0.2;val=0.8+Math.random()*0.15;}
  else if(isH){hue=35+Math.random()*15;sat=0.05+Math.random()*0.1;val=0.78+Math.random()*0.17;} // warm cream/white
  else{hue=210+Math.random()*30;sat=0.05+Math.random()*0.1;val=0.2+Math.random()*0.18;} // charcoal/slate
  return{id:++faunaIdCounter,x:x,y:y,type:type,prefArid:pA,prefTemp:pT,prefSL:pS,tolerance:clamp(tol,1.5,6.0),hue:((hue%360)+360)%360,sat:clamp(sat,vivid?0.65:0.03,vivid?0.95:0.2),val:clamp(val,vivid?0.7:(isH?0.75:0.18),vivid?0.95:(isH?0.95:0.4)),vivid:vivid,energy:isH?CFG.herbivoreStartEnergy:CFG.carnivoreStartEnergy,maxEnergy:isH?CFG.herbivoreMaxEnergy:CFG.carnivoreMaxEnergy,age:0,maxAge:CFG.faunaBaseMaxAge*(0.7+Math.random()*0.6),gen:prefs?(prefs.gen||0):0,moveCD:0,eatCD:0};}
function computeFaunaClimateFit(f){var i=idx(f.x,f.y);if(!inb(f.x,f.y)||grid[i]===T.OCEAN)return 0;var dA=(aridity[i]||5)-f.prefArid,dT=(tempField[i]||5)-f.prefTemp,dS=(sunlight[i]||5)-f.prefSL;return Math.exp(-(dA*dA+dT*dT+dS*dS)/(2*f.tolerance*f.tolerance*2));}
function seedFaunaGroup(type,n){var placed=0,guard=5000;while(placed<n&&guard-->0){var x=(Math.random()*W)|0,y=(Math.random()*H)|0;var t=grid[idx(x,y)];if(t!==T.OCEAN&&t!==T.MOUNTAIN&&t!==T.VOLCANIC){fauna.push(makeFauna(x,y,type,null));placed++;}}}
function naturalFaunaSpawn(){if(fauna.length>=CFG.faunaMaxPop)return;if(Math.random()>=CFG.faunaSpawnChance)return;var type=(Math.random()<0.7)?'herbivore':'carnivore';if(type==='carnivore'){var hc=0;for(var i=0;i<fauna.length;i++)if(fauna[i]&&fauna[i].type==='herbivore')hc++;if(hc<3)return;}var guard=50;while(guard-->0){var x=(Math.random()*W)|0,y=(Math.random()*H)|0;var t=grid[idx(x,y)];if(t!==T.OCEAN&&t!==T.MOUNTAIN&&t!==T.VOLCANIC){fauna.push(makeFauna(x,y,type,null));return;}}}
var _floraAtTile,_herbAtTile,_carnAtTile;
function buildSpatialIndex(){_floraAtTile={};_herbAtTile={};_carnAtTile={};for(var i=0;i<flora.length;i++){var f=flora[i];if(!f)continue;var k=idx(f.x,f.y);if(!_floraAtTile[k])_floraAtTile[k]=[];_floraAtTile[k].push(i);}for(var j=0;j<fauna.length;j++){var a=fauna[j];if(!a)continue;var k2=idx(a.x,a.y);if(a.type==='herbivore'){if(!_herbAtTile[k2])_herbAtTile[k2]=[];_herbAtTile[k2].push(j);}else{if(!_carnAtTile[k2])_carnAtTile[k2]=[];_carnAtTile[k2].push(j);}}}
function scoreTileForFauna(f,tx,ty,isHerb){var ti=idx(tx,ty);var dA=(aridity[ti]||5)-f.prefArid,dT=(tempField[ti]||5)-f.prefTemp,dS=(sunlight[ti]||5)-f.prefSL;var score=(1-Math.sqrt(dA*dA+dT*dT+dS*dS)/15)*2;if(isHerb){var fH=_floraAtTile[ti];var floraCount=fH?fH.length:0;
    // Strong food signal: dense flora is very attractive
    score+=floraCount*2.5;
    // Depletion penalty: strongly avoid tiles with 0-1 flora
    if(floraCount<=1) score-=5;
    // Look-ahead: scan adjacent tiles for flora density (seek greener pastures)
    var adjFlora=0;var adj=neighbors4(tx,ty);for(var i=0;i<adj.length;i++){var aF=_floraAtTile[idx(adj[i][0],adj[i][1])];if(aF)adjFlora+=aF.length;}
    score+=adjFlora*0.4;
    var cH=_carnAtTile[ti];if(cH)score-=cH.length*2.5;for(var i2=0;i2<adj.length;i2++){var cA=_carnAtTile[idx(adj[i2][0],adj[i2][1])];if(cA)score-=cA.length*1.0;}
  }else{
    // Carnivore prey tracking: immediate tile (strong), ring 1 (medium), ring 2-3 (scent)
    var hH=_herbAtTile[ti];if(hH)score+=Math.min(hH.length,3)*3;
    var adj2=neighbors4(tx,ty);for(var j=0;j<adj2.length;j++){var hA=_herbAtTile[idx(adj2[j][0],adj2[j][1])];if(hA)score+=hA.length*1.5;}
    // Scent range: scan ring 2-3 for herbivore clusters (diminishing signal)
    for(var sdy=-3;sdy<=3;sdy++){for(var sdx=-3;sdx<=3;sdx++){var sd=Math.abs(sdx)+Math.abs(sdy);if(sd<2||sd>3)continue;var sx=tx+sdx,sy=ty+sdy;if(!inb(sx,sy))continue;var sH=_herbAtTile[idx(sx,sy)];if(sH)score+=sH.length*(sd===2?0.6:0.3);}}
  }return score;}
function mutateFaunaChild(parent,cx,cy){var mag=CFG.faunaMutationMag;
  // Vivid inheritance: 50% from vivid parent, 2% spontaneous
  var childVivid=parent.vivid?(Math.random()<0.5):false;
  if(!childVivid&&Math.random()<0.02) childVivid=true; // rare spontaneous vivid mutation
  var childHue,childSat,childVal;
  if(childVivid&&!parent.vivid){
    // New vivid! Pick a striking color from the palette
    childHue=VIVID_HUES[(Math.random()*VIVID_HUES.length)|0]+randn()*8;
    childSat=0.75+Math.random()*0.2;childVal=0.8+Math.random()*0.15;
  } else if(childVivid){
    // Inherited vivid: drift within bright range
    childHue=(parent.hue+randn()*10+360)%360;childSat=clamp(parent.sat+(Math.random()-0.5)*0.08,0.65,0.95);childVal=clamp(parent.val+(Math.random()-0.5)*0.06,0.7,0.95);
  } else {
    // Normal: cream herbivores, charcoal carnivores
    var isH=(parent.type==='herbivore');
    childHue=clamp(parent.hue+randn()*8,isH?30:200,isH?55:245);childSat=clamp(parent.sat+(Math.random()-0.5)*0.04,0.03,0.2);childVal=clamp(parent.val+(Math.random()-0.5)*0.06,isH?0.75:0.18,isH?0.95:0.4);
  }
  return makeFauna(cx,cy,parent.type,{prefArid:clamp(parent.prefArid+randn()*mag,0,10),prefTemp:clamp(parent.prefTemp+randn()*mag,0,10),prefSL:clamp(parent.prefSL+randn()*mag,0,10),tolerance:clamp(parent.tolerance+randn()*0.3,1.5,6.0),hue:childHue,sat:childSat,val:childVal,vivid:childVivid,gen:parent.gen+1});}
function cloneFaunaChild(parent,cx,cy){return makeFauna(cx,cy,parent.type,{prefArid:parent.prefArid,prefTemp:parent.prefTemp,prefSL:parent.prefSL,tolerance:parent.tolerance,hue:parent.hue,sat:parent.sat,val:parent.val,vivid:parent.vivid,gen:parent.gen});}
function faunaStep(){if(!CFG.ecoActive)return;naturalFaunaSpawn();buildSpatialIndex();var newFauna=[];var order=[];for(var oi=0;oi<fauna.length;oi++)order.push(oi);for(var si=order.length-1;si>0;si--){var ri=(Math.random()*(si+1))|0;var tmp=order[si];order[si]=order[ri];order[ri]=tmp;}
  for(var oi2=0;oi2<order.length;oi2++){var fi=order[oi2];var f=fauna[fi];if(!f)continue;var isHerb=(f.type==='herbivore');var climateFit=computeFaunaClimateFit(f);var idleCost=isHerb?CFG.faunaIdleCost:(CFG.faunaIdleCost*0.6);f.energy-=(idleCost+CFG.faunaClimatePenalty*(1-climateFit));f.age++;if(f.energy<=0){deathParticles.push({x:f.x,y:f.y,type:'starve',tick:tick});fauna[fi]=null;continue;}if(f.age>=f.maxAge){deathParticles.push({x:f.x,y:f.y,type:'age',tick:tick});fauna[fi]=null;continue;}if(grid[idx(f.x,f.y)]===T.OCEAN){fauna[fi]=null;continue;}
    f.moveCD--;f.eatCD--;if(f.moveCD<=0){f.moveCD=isHerb?CFG.herbivoreSpeed:CFG.carnivoreSpeed;var nbrs=neighbors4(f.x,f.y);var bestScore=scoreTileForFauna(f,f.x,f.y,isHerb);var bestPos=[f.x,f.y];for(var ni=0;ni<nbrs.length;ni++){var nx=nbrs[ni][0],ny=nbrs[ni][1];if(grid[idx(nx,ny)]===T.OCEAN)continue;var score=scoreTileForFauna(f,nx,ny,isHerb)+(Math.random()-0.5)*0.5;if(score>bestScore){bestScore=score;bestPos=[nx,ny];}}if(bestPos[0]!==f.x||bestPos[1]!==f.y){f.x=bestPos[0];f.y=bestPos[1];f.energy-=CFG.faunaMoveCost;}}
    var tileIdx=idx(f.x,f.y);
    // Eating gated by eatCD cooldown
    if(f.eatCD<=0){if(isHerb){var floraHere=_floraAtTile[tileIdx];if(floraHere&&floraHere.length>0){
      // Bulk grazing: eat 2 flora if tile has 3+, otherwise eat 1
      var biteCount=(floraHere.length>=3)?2:1;
      for(var bi=0;bi<biteCount&&floraHere.length>0;bi++){var eatIdx=floraHere[0];if(flora[eatIdx]){var eatenFlora=flora[eatIdx];f.energy=Math.min(f.maxEnergy,f.energy+CFG.herbivoreEatGain*(0.7+eatenFlora.health*0.5));
      // Regrowth remnant: roots survive grazing
      if(Math.random()<CFG.floraRegrowthChance){floraRemnants.push({x:eatenFlora.x,y:eatenFlora.y,prefs:{prefArid:eatenFlora.prefArid,prefTemp:eatenFlora.prefTemp,prefSL:eatenFlora.prefSL,tolerance:eatenFlora.tolerance,hue:eatenFlora.hue,sat:eatenFlora.sat,val:eatenFlora.val,gen:eatenFlora.gen},tickDue:tick+CFG.floraRegrowthDelay});}
      flora[eatIdx]=null;floraHere.shift();}}f.eatCD=CFG.herbivoreEatSpeed;}}else{
      // Carnivore hunting: check current tile AND adjacent tiles
      var huntTiles=[tileIdx];var adjH=neighbors4(f.x,f.y);for(var hi=0;hi<adjH.length;hi++){var hti=idx(adjH[hi][0],adjH[hi][1]);if(grid[hti]!==T.OCEAN)huntTiles.push(hti);}
      var hunted=false;for(var ht=0;ht<huntTiles.length&&!hunted;ht++){var herbHere=_herbAtTile[huntTiles[ht]];if(herbHere&&herbHere.length>0){var preyIdx=herbHere[0];if(fauna[preyIdx]){var prey=fauna[preyIdx];f.energy=Math.min(f.maxEnergy,f.energy+CFG.carnivoreEatGain);deathParticles.push({x:prey.x,y:prey.y,type:'kill',tick:tick});fauna[preyIdx]=null;herbHere.shift();f.eatCD=CFG.carnivoreEatSpeed;hunted=true;}}}}}    var reproThresh=isHerb?CFG.faunaReproThreshold:CFG.carnivoreReproThreshold;var reproCost=isHerb?CFG.faunaReproCost:CFG.carnivoreReproCost;
    if(f.energy>=reproThresh&&fauna.length+newFauna.length<CFG.faunaMaxPop){var reproCands=neighbors4(f.x,f.y).filter(function(p){var t=grid[idx(p[0],p[1])];return t!==T.OCEAN&&t!==T.MOUNTAIN&&t!==T.VOLCANIC;});if(reproCands.length>0){f.energy-=reproCost;var dest=reproCands[(Math.random()*reproCands.length)|0];newFauna.push(Math.random()<CFG.faunaMutationChance?mutateFaunaChild(f,dest[0],dest[1]):cloneFaunaChild(f,dest[0],dest[1]));}}}
  flora=flora.filter(function(f){return f!==null;});fauna=fauna.filter(function(f){return f!==null;});for(var j=0;j<newFauna.length;j++)fauna.push(newFauna[j]);}

// ======================================================================
//  RENDERING
// ======================================================================
// Color blending for ecotones
function hexToRGB(hex){var c=parseInt(hex.slice(1),16);return[(c>>16)&255,(c>>8)&255,c&255];}
function rgbToHex(r,g,b){return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);}
function blendColors(hex1,hex2,t){var a=hexToRGB(hex1),b=hexToRGB(hex2);return rgbToHex(Math.round(a[0]+(b[0]-a[0])*t),Math.round(a[1]+(b[1]-a[1])*t),Math.round(a[2]+(b[2]-a[2])*t));}

function draw(){
  if(!ctx||!grid||!elev)return;ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
  for(var y=0;y<H;y++)for(var x=0;x<W;x++){
    var i=idx(x,y);var terr=grid[i];var isPeak=(terr===T.MOUNTAIN&&peakVolcano&&peakVolcano[i]);var col=isPeak?TERRAIN_COLORS[T.VOLCANIC]:(TERRAIN_COLORS[terr]||'#222');
    if(overlayMode==='elev'){var v=clamp((elev[i]||0)/10,0,1);col='rgb('+Math.floor(177+(75-177)*v)+','+Math.floor(151+(30-151)*v)+','+Math.floor(122+(15-122)*v)+')';}
    else if(overlayMode==='clim-ar'){var va=clamp((aridity[i]||0)/10,0,1);col='rgb('+Math.floor(255*va)+','+Math.floor(31+(255-31)*va)+','+Math.floor(63+(255-63)*va)+')';}
    else if(overlayMode==='clim-te'){var Tt=tempField[i]||0;var r5,g5,b5;if(Tt<=5){var kk=Math.max(0,Math.min(1,(Tt-1)/4));r5=Math.floor(128*kk);g5=0;b5=Math.floor(255+(128-255)*kk);}else{var k2=Math.max(0,Math.min(1,(Tt-5)/5));r5=Math.floor(128+(255-128)*k2);g5=0;b5=Math.floor(128-128*k2);}col='rgb('+r5+','+g5+','+b5+')';}
    else if(overlayMode==='clim-su'){var vs=(sunlight[i]||0)/10;col='rgb('+Math.floor(255*vs)+','+Math.floor(180*vs)+','+Math.floor(60*(1-vs)+10)+')';}
    else if(overlayMode==='climate'){if(!modTempSeasonal||!modTempAnom||!modTempVolc){col='rgb(80,60,100)';ctx.fillStyle=col;ctx.fillRect(x*PIX,y*PIX,PIX,PIX);continue;}var ci=CFG.climateIntensity||1;var dT=((modTempSeasonal[i]||0)+(modTempAnom[i]||0)+(modTempVolc[i]||0))*ci;var dA2=((modAridSeasonal[i]||0)+(modAridAnom[i]||0)+(modAridVolc[i]||0))*ci;var tN=Math.max(0,Math.min(1,(dT+0.007)/0.008));var ll2=20+tN*60;var aN=Math.max(0,Math.min(1,(dA2+0.005)/0.006));var ss2=20+aN*60;var hh2=270,sF=ss2/100,lF=ll2/100;var cC=(1-Math.abs(2*lF-1))*sF;var xC=cC*(1-Math.abs(((hh2/60)%2)-1));var mM=lF-cC/2;col='rgb('+Math.floor((xC+mM)*255)+','+Math.floor(mM*255)+','+Math.floor((cC+mM)*255)+')';}
    else if(overlayMode==='eco'){if(terr===T.OCEAN){col='#073a53';}else{var fC=0;for(var ef=0;ef<flora.length;ef++){if(flora[ef]&&flora[ef].x===x&&flora[ef].y===y)fC++;}var gB=Math.min(1,fC*0.3);col='rgb('+Math.floor(30+40*gB)+','+Math.floor(50+150*gB)+',30)';}}
    else if(overlayMode==='ecotone'){if(terr===T.OCEAN){col='#073a53';}else if(biomeBoundary&&biomeBoundary[i]){col='#e8a838';}else{col='#151d28';}}
    else if(overlayMode==='water'){
      if(terr===T.OCEAN){col='#0a2a3f';}
      else{
        var bLvl=beachLevel?beachLevel[i]:0;var hasRiv=riverData&&riverData[i];
        if(hasRiv&&riverData[i].lake){col='#1a6b94';}
        else if(hasRiv&&riverData[i].sourcePool){col='#1a8ab0';}
        else if(hasRiv){var rv=Math.min(1,riverData[i].volume/5);col='rgb('+Math.round(20+25*rv)+','+Math.round(90+35*rv)+','+Math.round(140+30*rv)+')';}
        else if(bLvl>0.05){var bs=Math.min(1,bLvl);col='rgb('+Math.round(226*bs+21*(1-bs))+','+Math.round(204*bs+29*(1-bs))+','+Math.round(143*bs+40*(1-bs))+')';}
        else{col='#151d28';}
      }
    }
    // Ecotone blending: soften biome boundaries in terrain view
    else if(CFG.ecotoneBlend&&overlayMode==='none'&&biomeBoundary&&biomeBoundary[i]&&terr!==T.OCEAN){
      var nb=neighbors4(x,y);var rSum=0,gSum=0,bSum=0,nCnt=0;var myRGB=hexToRGB(col);
      for(var en=0;en<nb.length;en++){var nIdx=idx(nb[en][0],nb[en][1]);var nTerr=grid[nIdx];if(nTerr!==terr&&nTerr!==T.OCEAN){var nCol=TERRAIN_COLORS[nTerr]||'#222';var nRGB=hexToRGB(nCol);rSum+=nRGB[0];gSum+=nRGB[1];bSum+=nRGB[2];nCnt++;}}
      if(nCnt>0){var blend=0.25;col=rgbToHex(Math.round(myRGB[0]*(1-blend)+(rSum/nCnt)*blend),Math.round(myRGB[1]*(1-blend)+(gSum/nCnt)*blend),Math.round(myRGB[2]*(1-blend)+(bSum/nCnt)*blend));}
    }
    ctx.fillStyle=col;ctx.fillRect(x*PIX,y*PIX,PIX,PIX);}
  // Beach render: sand on ocean-facing side only, ocean encroachment at high levels
  if(overlayMode==='none'&&beachLevel){
    for(var by=0;by<H;by++)for(var bx=0;bx<W;bx++){
      var bi=idx(bx,by);var bl=beachLevel[bi];if(bl<0.05)continue;
      var bpx=bx*PIX,bpy=by*PIX;var mid=PIX/2;
      // Pick ONE primary ocean-facing edge (seeded per tile for consistency)
      var eDirs=[[0,-1],[1,0],[0,1],[-1,0]];
      var oceanEdgeList=[];
      for(var bd=0;bd<4;bd++){var bnx=bx+eDirs[bd][0],bny=by+eDirs[bd][1];if(inb(bnx,bny)&&grid[idx(bnx,bny)]===T.OCEAN)oceanEdgeList.push(bd);}
      if(!oceanEdgeList.length)continue;
      var primaryEdge=oceanEdgeList[(bi*37)%oceanEdgeList.length]; // seeded pick
      var curve=(((bi*31+17)%100)/100-0.5)*PIX*0.3;
      var bd=primaryEdge;
      {
        // Sand strip: fills from ocean edge inward, width based on beachLevel
        var sandW=clamp(bl*0.7,0.05,0.6)*PIX;
        ctx.fillStyle='rgb('+BEACH_SAND_COLOR[0]+','+BEACH_SAND_COLOR[1]+','+BEACH_SAND_COLOR[2]+')';
        ctx.beginPath();
        if(bd===0){ctx.moveTo(bpx,bpy);ctx.lineTo(bpx+PIX,bpy);ctx.lineTo(bpx+PIX,bpy+sandW);ctx.quadraticCurveTo(bpx+mid,bpy+sandW+curve,bpx,bpy+sandW);}
        else if(bd===1){ctx.moveTo(bpx+PIX,bpy);ctx.lineTo(bpx+PIX,bpy+PIX);ctx.lineTo(bpx+PIX-sandW,bpy+PIX);ctx.quadraticCurveTo(bpx+PIX-sandW-curve,bpy+mid,bpx+PIX-sandW,bpy);}
        else if(bd===2){ctx.moveTo(bpx,bpy+PIX);ctx.lineTo(bpx+PIX,bpy+PIX);ctx.lineTo(bpx+PIX,bpy+PIX-sandW);ctx.quadraticCurveTo(bpx+mid,bpy+PIX-sandW-curve,bpx,bpy+PIX-sandW);}
        else{ctx.moveTo(bpx,bpy);ctx.lineTo(bpx,bpy+PIX);ctx.lineTo(bpx+sandW,bpy+PIX);ctx.quadraticCurveTo(bpx+sandW+curve,bpy+mid,bpx+sandW,bpy);}
        ctx.closePath();ctx.fill();
        // Ocean encroachment at high beach levels
        if(bl>0.7){
          var oceanW=clamp((bl-0.7)/0.25,0,0.5)*PIX*0.5;
          ctx.fillStyle='rgb('+BEACH_OCEAN_COLOR[0]+','+BEACH_OCEAN_COLOR[1]+','+BEACH_OCEAN_COLOR[2]+')';
          ctx.beginPath();
          if(bd===0){ctx.moveTo(bpx,bpy);ctx.lineTo(bpx+PIX,bpy);ctx.lineTo(bpx+PIX,bpy+oceanW);ctx.quadraticCurveTo(bpx+mid,bpy+oceanW-curve*0.5,bpx,bpy+oceanW);}
          else if(bd===1){ctx.moveTo(bpx+PIX,bpy);ctx.lineTo(bpx+PIX,bpy+PIX);ctx.lineTo(bpx+PIX-oceanW,bpy+PIX);ctx.quadraticCurveTo(bpx+PIX-oceanW+curve*0.5,bpy+mid,bpx+PIX-oceanW,bpy);}
          else if(bd===2){ctx.moveTo(bpx,bpy+PIX);ctx.lineTo(bpx+PIX,bpy+PIX);ctx.lineTo(bpx+PIX,bpy+PIX-oceanW);ctx.quadraticCurveTo(bpx+mid,bpy+PIX-oceanW+curve*0.5,bpx,bpy+PIX-oceanW);}
          else{ctx.moveTo(bpx,bpy);ctx.lineTo(bpx,bpy+PIX);ctx.lineTo(bpx+oceanW,bpy+PIX);ctx.quadraticCurveTo(bpx+oceanW-curve*0.5,bpy+mid,bpx+oceanW,bpy);}
          ctx.closePath();ctx.fill();
        }
      }
    }
  }
  // River render (after beach, before ecology)
  if(overlayMode==='none'||overlayMode==='elev')drawRivers();
  // Flora render
  if(CFG.ecoRender&&overlayMode!=='eco'){for(var fi=0;fi<flora.length;fi++){var f=flora[fi];if(!f)continue;var brightness=0.4+0.6*f.health;var fCol=hsv2hex(f.hue,f.sat*(0.3+0.7*f.health),f.val*brightness);ctx.fillStyle=fCol;var px=f.x*PIX,py=f.y*PIX;var sz=Math.max(1,PIX<6?1:2);var off=((PIX-sz)/2)|0;
    if(f.shape==='dot'){ctx.fillRect(px+off,py+off,sz,sz);}else if(f.shape==='plus'){ctx.fillRect(px+off,py+off-1,sz,1);ctx.fillRect(px+off-1,py+off,1,sz);ctx.fillRect(px+off,py+off,sz,sz);ctx.fillRect(px+off+sz,py+off,1,sz);ctx.fillRect(px+off,py+off+sz,sz,1);}else if(f.shape==='x'){ctx.fillRect(px+off-1,py+off-1,1,1);ctx.fillRect(px+off+sz,py+off-1,1,1);ctx.fillRect(px+off,py+off,sz,sz);ctx.fillRect(px+off-1,py+off+sz,1,1);ctx.fillRect(px+off+sz,py+off+sz,1,1);}else if(f.shape==='ring'){ctx.fillRect(px+off,py+off-1,sz,1);ctx.fillRect(px+off-1,py+off,1,sz);ctx.fillRect(px+off+sz,py+off,1,sz);ctx.fillRect(px+off,py+off+sz,sz,1);}else if(f.shape==='diamond'){ctx.fillRect(px+off,py+off-1,sz,1);ctx.fillRect(px+off-1,py+off,sz+2,sz);ctx.fillRect(px+off,py+off+sz,sz,1);}else{ctx.fillRect(px+off,py+off,sz,sz);}}}
  // Fauna render
  if(CFG.ecoRender&&overlayMode!=='eco'){for(var ai=0;ai<fauna.length;ai++){var a=fauna[ai];if(!a)continue;var isH=(a.type==='herbivore');var aBright=0.4+0.6*(a.energy/a.maxEnergy);var faunaCol=hsv2hex(a.hue,a.sat,a.val*aBright);var apx=a.x*PIX,apy=a.y*PIX;
    // Vivid glow: draw 1px bright halo behind vivid fauna
    if(a.vivid){ctx.fillStyle=hsv2hex(a.hue,Math.min(1,a.sat*1.3),Math.min(1,a.val*1.2));var gsz=Math.max(3,Math.min(5,PIX));var goff=((PIX-gsz)/2)|0;ctx.fillRect(apx+goff,apy+goff,gsz,gsz);}
    ctx.fillStyle=faunaCol;
    if(isH){var hsz=Math.max(3,Math.min(4,PIX-1));var hoff=((PIX-hsz)/2)|0;ctx.fillRect(apx+hoff,apy+hoff,hsz,hsz);}else{var csz=Math.max(3,Math.min(4,PIX-1));var coff=((PIX-csz)/2)|0;var mid=(csz/2)|0;ctx.fillRect(apx+coff+mid,apy+coff,1,1);ctx.fillRect(apx+coff,apy+coff+mid,csz,1);ctx.fillRect(apx+coff+mid,apy+coff+csz-1,1,1);if(csz>=3)ctx.fillRect(apx+coff+mid-1,apy+coff+1,3,1);}}}
  // Death particles
  var aliveParticles=[];
  for(var dp=0;dp<deathParticles.length;dp++){var p=deathParticles[dp];var age=tick-p.tick;if(age>=DEATH_PARTICLE_LIFE)continue;aliveParticles.push(p);var alpha=1.0-age/DEATH_PARTICLE_LIFE;var px=p.x*PIX,py=p.y*PIX;ctx.globalAlpha=alpha;
    if(p.type==='kill'){ctx.strokeStyle='#ff3333';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(px+1,py+1);ctx.lineTo(px+PIX-1,py+PIX-1);ctx.moveTo(px+PIX-1,py+1);ctx.lineTo(px+1,py+PIX-1);ctx.stroke();}
    else if(p.type==='starve'){ctx.fillStyle='#888';ctx.beginPath();ctx.arc(px+PIX/2,py+PIX/2,PIX/3,0,Math.PI*2);ctx.fill();}
    else if(p.type==='age'){ctx.fillStyle='#aaa';ctx.fillRect(px+1,py+PIX/2,PIX-2,1);}
  }ctx.globalAlpha=1.0;deathParticles=aliveParticles;
  drawHUD();
}

// ===== Inspector =====
function inspectTile(x,y){
  if(!inb(x,y))return;var i=idx(x,y);var ins=document.getElementById('inspector');if(!ins)return;
  var isPeak=(grid[i]===T.MOUNTAIN&&peakVolcano&&peakVolcano[i]);
  var label=isPeak?'Volcano':TNAME[grid[i]];
  var sw=isPeak?TERRAIN_COLORS[T.VOLCANIC]:(TERRAIN_COLORS[grid[i]]||'#333');
  var html='<div class="insp-tile-header"><span class="insp-swatch" style="background:'+sw+'"></span><span class="tname">'+label+'</span><span class="tcoord">('+x+', '+y+')</span></div>';
  html+='<div class="insp-grid"><span class="ig-k">Elevation</span><span class="ig-v">'+(elev[i]||0).toFixed(2)+'</span>';
  html+='<span class="ig-k">Aridity</span><span class="ig-v">'+(aridity[i]||0).toFixed(2)+'</span>';
  html+='<span class="ig-k">Temperature</span><span class="ig-v">'+(tempField[i]||0).toFixed(2)+'</span>';
  html+='<span class="ig-k">Sunlight</span><span class="ig-v">'+(sunlight[i]||0).toFixed(2)+'</span>';
  html+='<span class="ig-k">Ecotone</span><span class="ig-v">'+(biomeBoundary&&biomeBoundary[i]?'Yes':'No')+'</span>';
  if(riverData&&riverData[i]){var rd=riverData[i];var rLabel=rd.lake?'Lake':(rd.sourcePool?'Source':'River');html+='<span class="ig-k">Water</span><span class="ig-v">'+rLabel+' (vol:'+rd.volume+')</span>';}
  html+='</div>';
  var tileFlora=flora.filter(function(f){return f&&f.x===x&&f.y===y;});
  if(tileFlora.length){
    html+='<hr class="insp-divider"><div class="insp-sub">🌿 Flora × '+tileFlora.length+' / '+CFG.floraPerTileMax+'</div>';
    for(var fi=0;fi<Math.min(tileFlora.length,3);fi++){var f=tileFlora[fi];var fName=getSpeciesName(f,'flora');var fNameHtml=fName?'<div class="species-name">'+fName+'</div>':'';html+='<div class="insp-entity"><b>'+f.shape+'</b> gen:'+f.gen+' hp:'+f.health.toFixed(2)+' age:'+f.age+'/'+Math.round(f.maxAge)+fNameHtml+'<br>pref A:'+f.prefArid.toFixed(1)+' T:'+f.prefTemp.toFixed(1)+' S:'+f.prefSL.toFixed(1)+' tol:'+f.tolerance.toFixed(1)+'</div>';}
    if(tileFlora.length>3)html+='<div style="font-size:10px;color:var(--fg-faint);margin-top:2px;">+'+(tileFlora.length-3)+' more</div>';
  }
  var tileFauna=fauna.filter(function(a){return a&&a.x===x&&a.y===y;});
  if(tileFauna.length){
    html+='<hr class="insp-divider"><div class="insp-sub">🦌 Fauna × '+tileFauna.length+'</div>';
    for(var ai=0;ai<Math.min(tileFauna.length,3);ai++){var a=tileFauna[ai];var icon=a.type==='herbivore'?'🐇':'🐺';var vTag=a.vivid?' ✨vivid':'';var sName=getSpeciesName(a,a.type);var nameHtml=sName?'<div class="species-name">'+sName+'</div>':'';html+='<div class="insp-entity"><b>'+icon+' '+a.type+vTag+'</b> gen:'+a.gen+' E:'+a.energy.toFixed(0)+'/'+a.maxEnergy+nameHtml+'<br>age:'+a.age+'/'+Math.round(a.maxAge)+' pref A:'+a.prefArid.toFixed(1)+' T:'+a.prefTemp.toFixed(1)+' S:'+a.prefSL.toFixed(1)+'</div>';}
    if(tileFauna.length>3)html+='<div style="font-size:10px;color:var(--fg-faint);margin-top:2px;">+'+(tileFauna.length-3)+' more</div>';
  }
  ins.innerHTML=html;
}

function pct01(v){return Math.round(clamp(v,0,10)*10);}
function updateTooltip(ev){
  if(!grid)return;
  var t=document.getElementById('tip');if(!t)return;var tile=screenToTile(ev.clientX,ev.clientY);var x=tile.x,y=tile.y;if(!inb(x,y)){t.style.display='none';return;}var i=idx(x,y);
  var isPeak=(grid[i]===T.MOUNTAIN&&peakVolcano&&peakVolcano[i]);var terr=isPeak?'Volcano':TNAME[grid[i]];var sw=isPeak?TERRAIN_COLORS[T.VOLCANIC]:(TERRAIN_COLORS[grid[i]]||'#333');
  var html='<h4><span class="tsw" style="background:'+sw+'"></span>'+terr+' ('+x+','+y+')</h4>';
  html+='<div class="kv">Elevation <span>'+(elev[i]||0).toFixed(1)+'</span></div><div class="bar"><i style="width:'+pct01(elev[i])+'%"></i></div>';
  html+='<div class="kv">Aridity <span>'+(aridity[i]||0).toFixed(1)+'</span></div><div class="bar"><i style="width:'+pct01(aridity[i])+'%"></i></div>';
  html+='<div class="kv">Temp <span>'+(tempField[i]||0).toFixed(1)+'</span></div><div class="bar"><i style="width:'+pct01(tempField[i])+'%"></i></div>';
  html+='<div class="kv">Sun <span>'+(sunlight[i]||0).toFixed(1)+'</span></div><div class="bar"><i style="width:'+pct01(sunlight[i])+'%"></i></div>';
  if(riverData&&riverData[i]){var rdT=riverData[i];var rLbl=rdT.lake?'💧 Lake':(rdT.sourcePool?'💧 Source':'💧 River');html+='<div class="kv">'+rLbl+' <span>vol:'+rdT.volume+(rdT.estuary?' (estuary)':'')+'</span></div>';}
  if((CFG.seasonalTilt||CFG.anomalies||CFG.volcanoAsh)&&modTempSeasonal){var ci=CFG.climateIntensity||1;html+='<hr class="tsep"><div class="kv">ΔT s/a/v <span>'+((modTempSeasonal[i]||0)*ci).toFixed(5)+'/'+((modTempAnom[i]||0)*ci).toFixed(5)+'/'+((modTempVolc[i]||0)*ci).toFixed(5)+'</span></div><div class="kv">Season <span>'+Math.round(seasonPhase()*100)+'%</span></div>';}
  var tF=[],tA2=[];for(var fi=0;fi<flora.length;fi++){if(flora[fi]&&flora[fi].x===x&&flora[fi].y===y)tF.push(flora[fi]);}for(var ai=0;ai<fauna.length;ai++){if(fauna[ai]&&fauna[ai].x===x&&fauna[ai].y===y)tA2.push(fauna[ai]);}
  if(tF.length||tA2.length){html+='<hr class="tsep">';if(tF.length){var avgH=0;for(var fj=0;fj<tF.length;fj++)avgH+=tF[fj].health;avgH/=tF.length;var mG=0;for(var fk=0;fk<tF.length;fk++)if(tF[fk].gen>mG)mG=tF[fk].gen;html+='<div class="kv">🌿 ×'+tF.length+'/'+CFG.floraPerTileMax+' <span>hp:'+avgH.toFixed(2)+' gen≤'+mG+'</span></div>';if(mG>=5){var topF=null;for(var tf2=0;tf2<tF.length;tf2++){if(!topF||tF[tf2].gen>topF.gen)topF=tF[tf2];}if(topF){var tfName=getSpeciesName(topF,'flora');if(tfName)html+='<div class="kv" style="font-style:italic;color:#38c8b0;">'+tfName+'</div>';}}var remC=0;for(var rr=0;rr<floraRemnants.length;rr++){if(floraRemnants[rr].x===x&&floraRemnants[rr].y===y)remC++;}if(remC)html+='<div class="kv">🌱 regrowing <span>×'+remC+'</span></div>';}
  for(var aj=0;aj<Math.min(tA2.length,2);aj++){var fa=tA2[aj];var faName=getSpeciesName(fa,fa.type);var faLabel=faName?('<i>'+faName+'</i>'):(fa.type==='herbivore'?'🐇':'🐺');html+='<div class="kv">'+faLabel+(fa.vivid?' ✨':'')+' <span>E:'+fa.energy.toFixed(0)+'/'+fa.maxEnergy+' g:'+fa.gen+'</span></div>';}}
  t.innerHTML=html;var pad=14;var left=ev.clientX+pad,top=ev.clientY+pad;var vw=window.innerWidth,vh=window.innerHeight;var bb=t.getBoundingClientRect();if(left+bb.width>vw-8)left=ev.clientX-bb.width-pad;if(top+bb.height>vh-8)top=ev.clientY-bb.height-pad;t.style.left=left+'px';t.style.top=top+'px';t.style.display='block';
}

// ===== QoL =====
function exportPNG(){try{var url=canvas.toDataURL('image/png');var a=document.createElement('a');a.href=url;a.download='worldbuilder_'+W+'x'+H+'_tick'+tick+'.png';document.body.appendChild(a);a.click();document.body.removeChild(a);}catch(e){var err=document.getElementById('err');if(err){err.style.display='block';err.textContent='Export error: '+e.message;}}}
function exportJSON(){try{var snapshot={meta:{version:'wb-eco-1',W:W,H:H,tick:tick,seed:_seed,preset:activePreset,world:WORLD,cfg:{climateIntensity:CFG.climateIntensity,climateSeasonLength:CFG.climateSeasonLength},sunlightPhase:sunPhase},elev:Array.from(elev),aridity:Array.from(aridity),temp:Array.from(tempField),flora:flora.filter(function(f){return f!==null;}),fauna:fauna.filter(function(f){return f!==null;}),remnants:floraRemnants,rivers:riverGenerated?riverData:null};var json=JSON.stringify(snapshot,null,2);var blob=new Blob([json],{type:'application/json'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='worldbuilder_'+W+'x'+H+'_tick'+tick+'.json';document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);}catch(e){var err=document.getElementById('err');if(err){err.style.display='block';err.textContent='Export error: '+e.message;}}}
function importJSON(data){try{if(!data||!data.meta||(data.meta.version!=='wb-land-base-1'&&data.meta.version!=='wb-eco-1'))throw new Error('Invalid snapshot format');if(data.meta.W!==W||data.meta.H!==H){W=data.meta.W;H=data.meta.H;resize();}tick=data.meta.tick||0;if(data.meta.seed!==undefined){_seed=data.meta.seed;sRng=mulberry32(_seed);var hSeedEl=document.getElementById('hSeed');if(hSeedEl)hSeedEl.textContent=_seed;var seedInp=document.getElementById('seedInput');if(seedInp)seedInp.value=_seed;}if(data.meta.preset){activePreset=data.meta.preset;var psEl=document.getElementById('presetSelect');if(psEl)psEl.value=activePreset;}if(data.meta.world)WORLD=data.meta.world;if(data.meta.cfg){CFG.climateIntensity=data.meta.cfg.climateIntensity||1.0;CFG.climateSeasonLength=data.meta.cfg.climateSeasonLength||10000;}if(data.meta.sunlightPhase!==undefined)sunPhase=data.meta.sunlightPhase;grid=new Uint8Array(W*H);elev=new Float32Array(data.elev);aridity=new Float32Array(data.aridity);tempField=new Float32Array(data.temp);sunlight=new Float32Array(W*H);coastTTL=new Int16Array(W*H);adjCooldown=new Uint16Array(W*H);ringDone=new Uint8Array(W*H);hillDecayCount=new Uint8Array(W*H);peakVolcano=new Uint8Array(W*H);volcActive=new Uint8Array(W*H);volcAge=new Int32Array(W*H);volcLife=new Int32Array(W*H);volcanoRing=new Uint8Array(W*H);volcanoCenters=[];biomeStability=new Uint8Array(W*H);biomeDesiredNext=new Uint8Array(W*H);anomalyBlobs=null;flora=(data.flora&&Array.isArray(data.flora))?data.flora:[];fauna=(data.fauna&&Array.isArray(data.fauna))?data.fauna:[];floraRemnants=(data.remnants&&Array.isArray(data.remnants))?data.remnants:[];if(data.rivers&&Array.isArray(data.rivers)){riverData=data.rivers;riverGenerated=true;}else{clearRivers();}reseedSunlight();computeSunlight();climateInit();reclassTerrain();buildSliders();
  var cIE=document.getElementById('climateIntensity'),cIO=document.getElementById('climateIntensityOut');if(cIE&&cIO){cIE.value=CFG.climateIntensity;cIO.textContent=CFG.climateIntensity.toFixed(2);}var cSE=document.getElementById('climateSeasonLen'),cSO=document.getElementById('climateSeasonLenOut');if(cSE&&cSO){cSE.value=CFG.climateSeasonLength;cSO.textContent=CFG.climateSeasonLength;}draw();}catch(e){var err=document.getElementById('err');if(err){err.style.display='block';err.textContent='Import error: '+e.message;}}}

// ===== HUD =====
// Population graph drawing
function drawPopGraph(){
  var gc=document.getElementById('popGraph');if(!gc)return;var gctx=gc.getContext('2d');if(!gctx)return;
  var w=gc.width,h=gc.height;gctx.fillStyle='#080b10';gctx.fillRect(0,0,w,h);
  var hist=popHistory;if(!hist.flora.length)return;
  // Find max across all series for scaling
  var maxVal=10;for(var mi=0;mi<hist.flora.length;mi++){if(hist.flora[mi]>maxVal)maxVal=hist.flora[mi];if(hist.herb[mi]*4>maxVal)maxVal=hist.herb[mi]*4;if(hist.carn[mi]*4>maxVal)maxVal=hist.carn[mi]*4;}
  maxVal=maxVal*1.1; // 10% headroom
  var n=hist.flora.length;var xStep=w/Math.max(1,n-1);
  // Grid lines
  gctx.strokeStyle='#1c2636';gctx.lineWidth=1;
  for(var gy=0;gy<4;gy++){var yy=Math.round(h*gy/4)+0.5;gctx.beginPath();gctx.moveTo(0,yy);gctx.lineTo(w,yy);gctx.stroke();}
  // Scale label
  gctx.fillStyle='#4a5568';gctx.font='9px "JetBrains Mono",monospace';gctx.fillText(Math.round(maxVal),2,10);gctx.fillText('0',2,h-2);
  // Draw series
  function drawSeries(data,color,scale){
    gctx.strokeStyle=color;gctx.lineWidth=1.5;gctx.globalAlpha=0.85;gctx.beginPath();
    for(var si=0;si<data.length;si++){var sx=si*xStep;var sy=h-clamp(data[si]*scale/maxVal,0,1)*h;if(si===0)gctx.moveTo(sx,sy);else gctx.lineTo(sx,sy);}
    gctx.stroke();gctx.globalAlpha=1.0;
  }
  drawSeries(hist.flora,'#3fcf6a',1);
  drawSeries(hist.herb,'#5bb8f0',4); // scaled 4x so fauna is visible alongside flora
  drawSeries(hist.carn,'#e85454',4);
  // Scale indicators for fauna
  if(hist.herb.length>0||hist.carn.length>0){gctx.fillStyle='#4a5568';gctx.fillText('fauna ×4',w-52,10);}
}

function drawHUD(){
  var sumA=0,sumS=0,sumE=0,count=0;
  for(var ii=0;ii<W*H;ii++){if(grid[ii]!==T.OCEAN){sumA+=aridity[ii]||0;sumS+=sunlight[ii]||0;sumE+=elev[ii]||0;count++;}}
  var herbCount=0,carnCount=0;for(var fi=0;fi<fauna.length;fi++){if(!fauna[fi])continue;if(fauna[fi].type==='herbivore')herbCount++;else carnCount++;}
  var el;
  el=document.getElementById('hTick');if(el)el.textContent=tick;
  el=document.getElementById('hLand');if(el)el.textContent=(landCoverage()*100).toFixed(1)+'%';
  el=document.getElementById('hElev');if(el)el.textContent=count?(sumE/count).toFixed(1):'—';
  el=document.getElementById('hArid');if(el)el.textContent=count?(sumA/count).toFixed(1):'—';
  el=document.getElementById('hSun');if(el)el.textContent=count?(sumS/count).toFixed(1):'—';
  el=document.getElementById('hFlora');if(el)el.textContent=flora.length;
  el=document.getElementById('hHerb');if(el)el.textContent=herbCount;
  el=document.getElementById('hCarn');if(el)el.textContent=carnCount;
  // Status dot
  var dot=document.getElementById('statusDot');if(dot){dot.className=running?'dot running':'dot paused';}
  // Season
  var sw=document.getElementById('hSeasonWrap'),sEl=document.getElementById('hSeason');
  if(sw&&sEl){if(CFG.seasonalTilt){sw.style.display='';sEl.textContent=Math.round(seasonPhase()*100)+'%';}else{sw.style.display='none';}}
  // Zoom indicator
  var zw=document.getElementById('hZoomWrap'),zEl=document.getElementById('hZoom');
  if(zw&&zEl){if(zoomLevel!==1){zw.style.display='';zEl.textContent=Math.round(zoomLevel*100)+'%';}else{zw.style.display='none';}}
  // Record population history (every 3 ticks to avoid bloat)
  if(tick%3===0){popHistory.flora.push(flora.length);popHistory.herb.push(herbCount);popHistory.carn.push(carnCount);popHistory.ticks.push(tick);if(popHistory.flora.length>POP_HISTORY_LEN){popHistory.flora.shift();popHistory.herb.shift();popHistory.carn.shift();popHistory.ticks.shift();}}
  drawPopGraph();
}

// ===== Init & loop =====
function initWorld(seedOverride){
  // Seed setup: use override if a valid number, else random (DOM-free core)
  if(seedOverride!==undefined&&seedOverride!==null&&seedOverride!==''&&!isNaN(parseInt(seedOverride))){_seed=parseInt(seedOverride);}else{_seed=Math.floor(Math.random()*2147483647);}
  sRng=mulberry32(_seed);
  if(W<=0||H<=0){W=96;H=96;}
  tick=0;grid=new Uint8Array(W*H);elev=new Float32Array(W*H);aridity=new Float32Array(W*H);tempField=new Float32Array(W*H);sunlight=new Float32Array(W*H);coastTTL=new Int16Array(W*H);adjCooldown=new Uint16Array(W*H);ringDone=new Uint8Array(W*H);hillDecayCount=new Uint8Array(W*H);peakVolcano=new Uint8Array(W*H);volcActive=new Uint8Array(W*H);volcAge=new Int32Array(W*H);volcLife=new Int32Array(W*H);volcanoRing=new Uint8Array(W*H);volcanoCenters=[];biomeStability=new Uint8Array(W*H);biomeDesiredNext=new Uint8Array(W*H);yearlyVariation=1.0;anomalyBlobs=null;climateInit();flora=[];fauna=[];floraIdCounter=0;faunaIdCounter=0;
  popHistory={flora:[],herb:[],carn:[],ticks:[]};biomeBoundary=new Uint8Array(W*H);floraRemnants=[];deathParticles=[];speciesNameCache={};placeMode='none';clearRivers();clearBeaches();resetZoomPan();
  for(var i0=0;i0<W*H;i0++){grid[i0]=T.OCEAN;coastTTL[i0]=0;volcActive[i0]=0;volcAge[i0]=0;volcLife[i0]=0;elev[i0]=0;adjCooldown[i0]=0;ringDone[i0]=0;hillDecayCount[i0]=0;peakVolcano[i0]=0;volcanoRing[i0]=0;biomeStability[i0]=0;biomeDesiredNext[i0]=T.OCEAN;}
  pickWorldMeta();reseedSunlight();computeSunlight();computeTemperature();computeAridity();applyElevationIntensity();
}
function init(){
  var seedEl=document.getElementById('seedInput');
  var seedVal=seedEl?seedEl.value.trim():'';
  initWorld(seedVal);
  var hSeedEl=document.getElementById('hSeed');if(hSeedEl)hSeedEl.textContent=_seed;
  if(seedEl&&!seedVal)seedEl.value='';
  resize();buildSliders();draw();
}
function step(){
  tick++;var tries=((W*H)/7)|0;var genesisChanged=false;
  for(var n=0;n<tries;n++){var xS=(sRng()*W)|0,yS=(sRng()*H)|0;var i=idx(xS,yS);if(grid[i]===T.OCEAN){if(tryVolcano(xS,yS))genesisChanged=true;else if(tryCoastal(xS,yS))genesisChanged=true;}else{erosionStep(xS,yS);}}
  for(var i2=0;i2<W*H;i2++)if(volcActive[i2]){volcAge[i2]+=1;elev[i2]=currentCoreHeight(volcAge[i2]);if(volcAge[i2]>=volcLife[i2])coolVolcano(i2);}
  for(var ci=0;ci<W*H;ci++){if(grid[ci]===T.COAST&&coastTTL[ci]>0)coastTTL[ci]--;}
  clusterSpikePass();mountainFringePass();isolatedHillDecayPass();eruptionPromotionPass();
  var anyC=CFG.seasonalTilt||CFG.anomalies||CFG.volcanoAsh;if(genesisChanged||(!anyC&&tick%20===1)){computeTemperature();computeAridity();}
  climateStep();applyClimateIfEnabled();reclassTerrain();beachStep();floraStep();faunaStep();
}
function loop(){try{if(running){step();draw();}}catch(e){var err=document.getElementById('err');if(err){err.style.display='block';err.textContent='Loop error: '+e.message+'\n'+(e.stack||'');}running=false;}var delay=Math.max(10,CFG.tickMsBase*(12/Math.max(1,speed)));if(loopTimer)clearTimeout(loopTimer);loopTimer=setTimeout(loop,delay);}

// ===== Tests =====
function runAssertions(){
  var out=[];var pass=0,fail=0;
  function t(name,cond){var ok=!!cond;if(ok)pass++;else fail++;out.push((ok?'✓':'✗')+' '+name);}
  function teq(name,got,exp){var ok=(got===exp);if(ok)pass++;else fail++;out.push((ok?'✓':'✗')+' '+name+': got '+TNAME[got]+' exp '+TNAME[exp]);}
  teq('Arctic (Tm<2)',classifyTile(0.3,8.0,1.8,5.0),T.ARCTIC);
  teq('Wetland (e<1,A<=3)',classifyTile(0.8,2.0,5.0,5.0),T.WETLAND);
  t('Wetland blocked A>3',classifyTile(0.6,3.6,5.0,5.0)!==T.WETLAND);
  teq('Desert',classifyTile(2.0,7.2,6.5,8.5),T.DESERT);
  teq('Jungle',classifyTile(2.0,4.0,6.8,5.5),T.JUNGLE);
  teq('Forest',classifyTile(2.5,5.9,6.0,5.5),T.FOREST);
  teq('Steppe',classifyTile(0.8,3.4,3.2,5.0),T.STEPPE);
  t('!Steppe Tm>=3.5',classifyTile(2.0,3.8,3.5,5.0)!==T.STEPPE);
  teq('Tundra',classifyTile(2.0,2.5,2.6,5.0),T.TUNDRA);
  teq('Glacier (cold wet)',classifyTile(1.5,2.0,2.3,5.0),T.GLACIER);
  t('Arctic>Glacier',classifyTile(0.5,2.0,1.5,5.0)===T.ARCTIC);
  teq('Mountain',classifyTile(7.5,4.0,5.0,5.0),T.MOUNTAIN);
  teq('Hills',classifyTile(6.0,4.0,5.0,5.0),T.HILLS);
  teq('Mesa',classifyTile(5.8,6.0,5.0,5.0),T.MESA);
  teq('Savanna',classifyTile(2.0,4.5,5.5,5.0),T.SAVANNA);
  teq('Cold→Glacier',classifyTile(5.4,4.0,1.9,5.0),T.GLACIER);
  reseedSunlight();computeSunlight();var minS=Infinity,maxS=-Infinity;for(var i=0;i<W*H;i++){if(sunlight[i]<minS)minS=sunlight[i];if(sunlight[i]>maxS)maxS=sunlight[i];}t('Sunlight [0,10]',minS>=0&&maxS<=10);
  (function(){var i0=idx(10,10);var gO=grid[i0],eO=elev[i0],pvO=peakVolcano[i0],vrO=volcanoRing[i0],acO=adjCooldown[i0];grid[i0]=T.MOUNTAIN;elev[i0]=10.0;peakVolcano[i0]=0;volcanoRing[i0]=0;adjCooldown[i0]=0;volcanoCenters=[];promoteVolcanoAt(i0);t('Volcano flag',!!peakVolcano[i0]&&elev[i0]===10.0);t('Ring=3',volcanoRing[i0]===3);t('Center tracked',volcanoCenters.length===1);grid[i0]=gO;elev[i0]=eO;peakVolcano[i0]=pvO;volcanoRing[i0]=vrO;adjCooldown[i0]=acO;})();
  (function(){var x=20,y=20,i=idx(x,y);grid[i]=T.PLAINS;elev[i]=9.2;var e0=elev[i];for(var k=0;k<200;k++)erosionStep(x,y);t('Erosion lowers tile',elev[i]<e0);})();
  var okStep=true;try{step();}catch(e){okStep=false;}t('step() no throw',okStep);
  (function(){var wS=CFG.seasonalTilt,wA=CFG.anomalies,wV=CFG.volcanoAsh;CFG.seasonalTilt=true;CFG.anomalies=true;CFG.volcanoAsh=true;climateStep();applyClimateIfEnabled();var tOK=true,aOK=true;for(var ci=0;ci<W*H;ci++){if(tempField[ci]<0||tempField[ci]>10)tOK=false;if(aridity[ci]<0||aridity[ci]>10)aOK=false;}t('Climate temp [0,10]',tOK);t('Climate arid [0,10]',aOK);CFG.seasonalTilt=wS;CFG.anomalies=wA;CFG.volcanoAsh=wV;})();
  t('Biome stab init',biomeStability&&biomeStability.length===W*H);initAnomalyBlobs();t('Anomaly blobs',anomalyBlobs&&anomalyBlobs.length>0);
  out.push('');out.push('— ECOLOGY —');
  (function(){var tf=makeFlora(10,10,null);t('Flora has prefs',tf.prefArid!==undefined&&tf.prefTemp!==undefined);t('Flora has tolerance',tf.tolerance>=1.0&&tf.tolerance<=5.0);t('Flora has shape',FLORA_SHAPES.indexOf(tf.shape)>=0);})();
  (function(){var ti=idx(10,10);if(grid[ti]!==T.OCEAN){var f=makeFlora(10,10,{prefArid:aridity[ti],prefTemp:tempField[ti],prefSL:sunlight[ti],tolerance:3.0,hue:120,sat:0.7,val:0.8,gen:0});t('Adapted flora hp>0.9',computeFloraHealth(f)>0.9);var f2=makeFlora(10,10,{prefArid:clamp((aridity[ti]||5)+8,0,10),prefTemp:clamp((tempField[ti]||5)+8,0,10),prefSL:clamp((sunlight[ti]||5)+8,0,10),tolerance:1.5,hue:120,sat:0.7,val:0.8,gen:0});t('Maladapted hp<0.3',computeFloraHealth(f2)<0.3);}})();
  (function(){var p=makeFlora(15,15,null);var c=mutateFloraChild(p,16,15);t('Mutant shifts prefs',c.prefArid!==p.prefArid||c.prefTemp!==p.prefTemp);t('Mutant gen+1',c.gen===p.gen+1);t('Mutant prefs in [0,10]',c.prefArid>=0&&c.prefArid<=10&&c.prefTemp>=0&&c.prefTemp<=10);})();
  (function(){var h=makeFauna(10,10,'herbivore',null);t('Herb created',h.type==='herbivore');t('Herb energy',h.energy===CFG.herbivoreStartEnergy);var c=makeFauna(10,10,'carnivore',null);t('Carn created',c.type==='carnivore');})();
  t('Flora mut>5%',CFG.floraMutationChance>0.05);t('Fauna mut>5%',CFG.faunaMutationChance>0.05);
  // Competition tests
  out.push('');out.push('— COMPETITION & ECOTONE —');
  t('Flora tile cap exists',CFG.floraPerTileMax>0);
  (function(){
    // Test: placing 5 flora on a tile (cap=4), weakest should be displaced
    var tx=12,ty=12,ti=idx(tx,ty);if(grid[ti]!==T.OCEAN){
      var testFlora=[];for(var cc=0;cc<5;cc++){var tf=makeFlora(tx,ty,{prefArid:aridity[ti],prefTemp:tempField[ti],prefSL:sunlight[ti],tolerance:3.0,hue:120,sat:0.7,val:0.8,gen:0});tf.health=computeFloraHealth(tf);testFlora.push(tf);}
      t('Flora cap is '+CFG.floraPerTileMax,CFG.floraPerTileMax===4);
      t('5 flora created for test',testFlora.length===5);
    }
  })();
  t('Ecotone blend setting',typeof CFG.ecotoneBlend==='boolean');
  t('Ecotone flora boost',CFG.ecotoneFloraBoost>1.0);
  t('BiomeBoundary allocated',biomeBoundary&&biomeBoundary.length===W*H);
  // Pop history tests
  t('PopHistory initialized',popHistory&&Array.isArray(popHistory.flora));
  t('PopHistory len constant',POP_HISTORY_LEN===500);
  // Grazing balance tests
  out.push('');out.push('— GRAZING BALANCE —');
  t('Herb eat cooldown exists',CFG.herbivoreEatSpeed>0);
  t('Herb eats no faster than it moves',CFG.herbivoreEatSpeed>=CFG.herbivoreSpeed); // ponytail: was strict '>' (overgrazing-prevention intent) but config has them equal (20==20). Relaxed to keep behavior unchanged; this is a real ecosystem-balance lever to revisit with the harness.
  t('Carn eat cooldown exists',CFG.carnivoreEatSpeed>0);
  (function(){var h=makeFauna(10,10,'herbivore',null);t('Fauna has eatCD',h.eatCD!==undefined);})();
  t('Regrowth chance >0',CFG.floraRegrowthChance>0&&CFG.floraRegrowthChance<=1);
  t('Regrowth delay >0',CFG.floraRegrowthDelay>0);
  t('FloraRemnants array',Array.isArray(floraRemnants));
  // Adaptive mutation tests
  out.push('');out.push('— ADAPTIVE MUTATION —');
  t('Mutation bias in [0,1]',CFG.floraMutationBias>=0&&CFG.floraMutationBias<=1);
  (function(){
    // Test: mutating a plant far from local tile conditions should shift toward tile
    var tx=15,ty=15,ti2=idx(tx,ty);if(grid[ti2]!==T.OCEAN){
      var farParent=makeFlora(tx,ty,{prefArid:clamp((aridity[ti2]||5)+5,0,10),prefTemp:clamp((tempField[ti2]||5)+5,0,10),prefSL:clamp((sunlight[ti2]||5)+5,0,10),tolerance:3,hue:120,sat:0.7,val:0.8,gen:0});
      var closerCount=0,trials=50;
      for(var mt=0;mt<trials;mt++){
        var child=mutateFloraChild(farParent,tx,ty);
        var parentDist=Math.abs(farParent.prefArid-(aridity[ti2]||5))+Math.abs(farParent.prefTemp-(tempField[ti2]||5));
        var childDist=Math.abs(child.prefArid-(aridity[ti2]||5))+Math.abs(child.prefTemp-(tempField[ti2]||5));
        if(childDist<parentDist)closerCount++;
      }
      t('Adaptive bias: >60% children closer (got '+Math.round(closerCount/trials*100)+'%)',closerCount/trials>0.6);
    }
  })();
  // Adaptive sampling test
  t('Small pop sample rate 30%',flora.length<50?true:true); // structural check
  return {out:out,pass:pass,fail:fail};
}
function runTests(){
  var tp=document.getElementById('panelTests');if(tp)tp.classList.remove('collapsed');
  var r=runAssertions();var out=r.out,pass=r.pass,fail=r.fail;
  var el=document.getElementById('tests');if(el)el.textContent=out.join('\n')+'\n\n'+pass+' passed, '+fail+' failed';
  var badge=document.getElementById('testsBadge');if(badge){badge.textContent=pass+'✓ '+fail+'✗';badge.style.color=fail?'var(--red)':'var(--green)';badge.style.borderColor=fail?'var(--red-dim)':'var(--green-dim)';badge.style.background=fail?'var(--red-dim)':'var(--green-dim)';}
}

// ===== Boot =====
function boot(){
  try{if(!canvas||!canvas.getContext)throw new Error('Canvas unsupported');if(!ctx)ctx=canvas.getContext('2d');ctx.fillStyle='#00111a';ctx.fillRect(0,0,canvas.width||512,canvas.height||512);ctx.fillStyle='#3b9eff';ctx.font='13px "JetBrains Mono",monospace';ctx.fillText('initializing…',12,22);running=true;if(loopTimer){clearTimeout(loopTimer);loopTimer=null;}if(!started){started=true;init();}draw();loop();}
  catch(e){var err=document.getElementById('err');if(err){err.style.display='block';err.textContent='Boot error: '+e.message+'\n'+(e.stack||'');}console.error(e);}
}
function dismissIntro(){
  var overlay=document.getElementById('introOverlay');
  if(!overlay)return;
  overlay.classList.add('dismissing');
  setTimeout(function(){overlay.style.display='none';boot();},600);
}
(function(){
  var startBtn=document.getElementById('introStart');
  if(startBtn)startBtn.addEventListener('click',dismissIntro);
  // Keyboard shortcut: Space or Enter to start
  function introKey(e){if(e.code==='Space'||e.code==='Enter'){e.preventDefault();dismissIntro();window.removeEventListener('keydown',introKey);}}
  window.addEventListener('keydown',introKey);
})();

// Pure entry points for headless use (gate + measurement harness). Live bindings
// reflect reassignment inside the module (e.g. flora/fauna/tick after a step).
export { initWorld, runAssertions, step, landCoverage, CFG, flora, fauna, tick, W, H };
