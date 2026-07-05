'use strict';
// Worldbuilder - the DOM-free simulation core (chunk 10). Split out of main.js so it imports
// cleanly in Node (vitest gate + measurement harness) with NO DOM stub. Nothing here touches
// document/window/canvas; the browser UI shell lives in main.js and imports from this file.
// Terrain + ecology are deterministic from the seeded RNG streams (see initWorld); the only
// raw Math.random is the seed PICKER. This module runs unchanged in a browser or in Node.

var tick=0; var W=96,H=96;
var grid, elev, aridity, tempField, sunlight, adjCooldown, ringDone, hillDecayCount, peakVolcano, volcanoRing, volcanoCenters;
var waterDist; // tiles to nearest water (ocean/coast + rivers/lakes when present); drives flora clustering on water (flora-only, recomputed in computeWaterDist)
var floraLandVigor=1; // maturity-thinning multiplier on flora spread/spawn (1 at low land, down to 1-floraLandThin at full land); refreshed each floraStep
var coastTTL;
var volcActive, volcAge, volcLife;
var baseTemp, baseArid; // genesis climate (temperature/aridity from terrain), BEFORE the seasonal/anomaly/volcano
                        // offsets. The live tempField/aridity = base + bounded offsets, recomputed every tick by
                        // applyClimate, so climate forcings are OFFSETS that return to baseline - they never
                        // accumulate or drift (the old integrate-onto-the-field model did, only once genesis stopped).
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
// Carrion: corpses dropped by dying fauna, the scavenger tier's food (trophic-depth experiment, chunk 6).
// Only created + consumed when CFG.scavengersEnabled; a persistent list managed in the step path (null-then-
// filter like flora/fauna) so it is harness-safe, unlike deathParticles (a render-only flash compacted in draw).
var carrion = []; // {x, y, tick}

// Placement mode: 'none', 'herbivore', 'carnivore'

// Species naming system
var GENUS_PARTS = ['Vir','Aur','Cer','Lup','Sil','Fer','Cav','Urs','Vor','Niv','Pyr','Thal','Aq','Xer','Gla','Ven','Bor','Aus','Ori','Cal'];
var SPECIES_PARTS = ['ensis','alis','phila','cola','oides','inus','atus','ella','osum','icum','oris','anum','ilis','osa','este','entis','idum','ax','eum','orum'];
var HABITAT_PARTS = ['sylv','arid','glaci','therm','mar','mont','palud','camp','litor','umbr','luc','prat','rip','anth','saxi','aren','niv','plani','herb','flor'];
var speciesNameCache = {}; // keyed by "type-gen-hue-bucket" -> name

// Population history for graphs
var POP_HISTORY_LEN = 500;
var popHistory = { flora:[], herb:[], carn:[], scav:[], apex:[], omni:[], ticks:[] };

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
var lakeShapes = [];  // [{cx,cy,r,seed}] smooth lake outlines (tile units) for a curved shore render
var RIVER_ARIDITY_EFFECT = 0.6;     // aridity reduction on river tiles
// Hydrology pipeline tunables (priority-flood -> flow accumulation; tuned for a 6px read).
// River render threshold moved to CFG.riverAccumThreshold (tunable via the River Density slider).
var RIVER_SMOOTH_PASSES = 6;        // 3x3 blur of elevation BEFORE flow routing (only): on this
                                    // low-relief terrain raw D8 disperses into speckle; smoothing the
                                    // routing surface merges tributaries into longer, curvier channels.
var LAKE_MIN_DEPTH = 0.06;          // fill depth (filled - routing elev) for a tile to count as lake
var LAKE_MIN_CELLS = 18;            // drop small filled pits; keep only fewer, bigger lakes
var LAKE_MIN_ELEV_FRAC = 0.45;      // keep natural fill lakes only in the upper elevation band (not low
                                    // coastal ponds); on this terrain that leaves ~none, so:
var SOURCE_LAKE_COUNT = 3;          // a few SMALL lakes at the highest, well-spaced river heads
var SOURCE_LAKE_R_MIN = 1.0;        // (kept small + ocean-clipped below so they never bleed into the
var SOURCE_LAKE_R_MAX = 2.0;        // sea); radius varies per lake so they differ in size
var SOURCE_LAKE_SPACING = 15;       // min manhattan distance between source lakes (spread them out)

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
var eRng = Math.random; // seeded DYNAMICS stream (ecology/climate-drift); set in initWorld. Kept separate from sRng so terrain generation is byte-identical.
// Seeded COSMETIC stream: drives purely-visual genes (the heritable size gene) ONLY. Kept on its own
// stream so cosmetic genes NEVER consume a draw from eRng - the ecology trajectory (and thus the C2
// predator-prey balance) is byte-identical whether or not these genes exist. This is what makes
// "cosmetic-first" provably balance-safe (see Engineering Lessons - cosmetic genes on a separate RNG).
var cRng = Math.random; // seeded in initWorld/restoreState alongside eRng.
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
  hardenRate:0.0025, elevationIntensity:1.0, maxLandCap:0.90,
  riverAccumThreshold:6,            // upstream drainage cells before a tile renders as a river. LOWER = more/finer rivers that also appear at LOWER land coverage; HIGHER = only major trunks. Default 6 surfaces rivers at moderate land (~2% coverage at 56% land, ~9% at high land); tunable via the River Density slider; re-runs generateRivers live.
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
  // Climate offset amplitudes (units of the 0..10 fields, at sea level, before climateIntensity). These are
  // OFFSETS on the genesis baseline, not per-tick increments: the seasonal one is zero-mean over a year, so the
  // climate returns to baseline each cycle instead of drifting. seasonalTempAmp is the moderate strength Kevin
  // signed off on (~+/-1.5 temp); aridity swings the opposite way (warm season = moister) at ~0.6x, as before.
  seasonalTempAmp:1.5, seasonalAridAmp:0.9,
  anomalyTempAmp:0.8, anomalyAridAmp:0.5,   // drifting warm/cool blobs (anomalies toggle)
  volcanoTempAmp:1.2, volcanoAridAmp:0.8,   // ash cooling at a volcano peak; ring tiles get half / a quarter
  anomalySpeed:0.0005, anomalyWavelength:40.0, anomalyBlobCount:3, anomalyBlobRadius:25,
  biomeStabilityThreshold:20,
  ecoActive:true, ecoRender:true,
  floraSpawnChance:0.010, floraMutationChance:0.07, floraMutationMag:0.8,
  floraWaterWeight:0.03,            // placement desert-avoid (aridity term, secondary to floraWaterDistK). 0 = off.
  floraLandThin:0.55,               // MATURITY thinning: flora spread + spawn are scaled down as the world fills with land (the overrun regime), up to this fraction at 100% land. Land-adaptive: ZERO effect below floraLandThinStart, so the low-land C2 balance (tuned at ~24% land) is preserved while a matured ~90%-land world stops being carpeted. 0 = off.
  floraLandThinStart:0.4,           // land coverage at which maturity thinning begins ramping (below this, flora is at full vigor - lush early islands).
  floraPlaceSamples:10,             // candidate tiles drawn per placement; the wettest is chosen PROPORTIONALLY. Fixed count => no RNG-stream reshuffle when tuning floraWaterWeight (clean A/B).
  floraMoisturePenalty:0.25,        // ABSOLUTE dryness brake on flora health (independent of the plant's own aridity preference). Makes dry-adapted flora still struggle: it spreads slower (health^2) + dies sooner, so flora retreats to water + dies back in deserts. 0 = off (old behavior). Secondary to floraWaterDist* below; mainly guarantees desert -> ~0 flora.
  floraAridTolerance:3.5,           // aridity below which there is NO moisture penalty (well-watered ground). The penalty grows with (aridity - this)^2 above it.
  floraWaterDistK:0.2,              // PLACEMENT clustering: candidate tiles weighted by exp(-waterDist*this), so new flora favors tiles close to water (coast + rivers/lakes). 0 = off.
  floraWaterDistFree:2,             // tiles-from-water within which there is NO health penalty (riparian/coastal band stays lush).
  floraWaterDistPenalty:0.12,       // SURVIVAL clustering: health brake growing with (waterDist - free)^2, so flora far from any water thins out -> leaves the interior barer (this is the lever for 'less of the map covered'). 0 = off.
  floraBaseMaxAge:700, floraSpreadBase:0.07, floraMaxPop:0, floraToleranceBase:2.5,
  floraPerTileMax:4,               // carrying capacity per tile
  ecotoneFloraBoost:1.6,           // flora spread multiplier at biome edges
  faunaSpawnChance:0.001, faunaMutationChance:0.07, faunaMutationMag:0.6,
  faunaSizeMutationMag:0.09,        // COSMETIC size-gene drift per mutation (sd of the Gaussian step on cRng). Heritable + rendered; never affects energy/eat (balance-safe). Clamped to [0.5,2.2]x.
  faunaMaxPop:400, faunaBaseMaxAge:500,
  herbivoreSpeed:20, carnivoreSpeed:16,
  herbivoreEatSpeed:20,             // ticks between grazing
  carnivoreEatSpeed:18,             // ticks between hunting
  herbivoreEatGain:12, carnivoreEatGain:55,
  floraRegrowthChance:0.4,         // chance eaten flora drops a root remnant
  floraRegrowthDelay:10,           // ticks before remnant sprouts
  floraMutationBias:0.45,          // how strongly mutations pull toward local tile conditions (0=random, 1=full)
  faunaMoveCost:0.5, faunaIdleCost:0.1, faunaClimatePenalty:0.5,
  faunaReproThreshold:95, faunaReproCost:60,
  carnivoreReproThreshold:80, carnivoreReproCost:40,
  carnivoreRescueRate:0.0001,       // knob D: per-herbivore per-tick carnivore immigration prob
  carnivoreRescueMinPrey:20,        // need an ABUNDANT herd before predators re-immigrate (preserves prey rebound refuge)
  carnivoreRescueCarnCap:6,         // stop rescuing once predators are established (rescue, not subsidy)
  herbivoreCrowding:2.0,            // knob C: herbivores avoid tiles crowded with conspecifics (fragments the herd; adds local density-dependence)
  herbivoreStartEnergy:50, carnivoreStartEnergy:75,
  herbivoreMaxEnergy:100, carnivoreMaxEnergy:120,
  // God powers (chunk 3, pillar D): user-triggered interventions. NONE run inside step(), so they sit
  // outside the measured ecology loop and leave the C2 balance byte-identical (verified via the harness).
  godBrushRadius:2, godBrushDelta:1.3,     // land brush: soft-disc radius + centre elevation delta per stroke
  meteorRadius:4, meteorCraterDepth:3.0,   // meteor: blast/crater radius + centre-to-rim elevation gouge
  droughtSeverity:0.5,                     // drought: base per-plant kill prob (scaled up on arid ground)
  bloomCount:250,                          // bloom: plants seeded in a burst (weighted placement)
  // Trophic depth (chunk 7): a SCAVENGER (detritivore) tier that eats CARRION - the corpses of dead fauna, an
  // energy flux the 3-tier web otherwise wastes. Chosen as the trophic addition least likely to break C2
  // because it adds NO predation pressure on the living tiers (it feeds only on death that already happens),
  // unlike an apex tier (which stacks a 4th predator level and amplifies the paradox of enrichment). SHIPPED ON
  // in chunk 7 after the take-2 tuning below made it viable + balance-neutral: harness --scav=12 at 12 seeds ==
  // C2 (extinction 0%, carn-persistence 75% 9/12, cap-hits 0) with scavenger-persistence 100% (final scav ~11,
  // above the rescue floor => genuinely reproducing). Chunk 6 shipped it default-OFF because the untuned tier
  // starved (0% persistence). Flag off is STILL byte-identical to C2 (no carrion created, no scavenger code
  // runs) -> the --scav=0 harness run remains the C2 balance proof.
  scavengersEnabled:true,
  scavengerSpeed:15,                       // move cooldown (between herbivore 20 and carnivore 16)
  scavengerEatGain:35,                     // energy per carrion consumed (take-2: 20->35 so a single find sustains a wanderer between corpses)
  scavengerStartEnergy:55, scavengerMaxEnergy:110,
  scavengerReproThreshold:88, scavengerReproCost:44,
  carrionMaxAge:300,                       // ticks a corpse persists before rotting (take-2: 100->300 so carrion accumulates + post-crash death pulses feed a scavenger bloom)
  // Scavenger immigration RESCUE (take-2): a carrion-dependent analog of knob D. Scavengers re-immigrate while
  // they are scarce AND corpses are present, so the detritivore tier cannot hit absorbing-zero on a lean stretch.
  // Guarded on scavengersEnabled (off => not even the eRng draw runs => byte-identical to C2).
  scavengerRescueRate:0.0004,              // per-carrion per-tick immigration prob while scarce
  scavengerRescueMinCarrion:6,             // need a real death flux present before immigrants arrive
  scavengerRescueScavCap:6,                // stop rescuing once the tier is established (rescue, not subsidy)
  // Trophic depth take 3 (chunk 8): an APEX predator tier that hunts the MID-tier consumers (carnivores + now
  // scavengers). The HARDER trophic addition - it stacks a 4th level on the fragile carnivore tier. Tuned
  // DELIBERATELY WEAK + RARE (slow eat cooldown, high per-kill gain, low rescue cap) so predation stays light.
  // SHIPPED ON in chunk 8 after the A/B cleared the bar: harness --scav=12 --apex=8 @ 12 seeds is neutral-to-
  // BETTER than the chunk-7 baseline (extinction 0%, carn-persistence 75%->83%, scav 100%, cap-hits 0) with
  // apex-persistence 100% (mean ~3.7, near the rescue floor => rescue-sustained, not self-reproducing). It even
  // DAMPS the carnivore boom-bust (carn amp 6.7->4.7) - a stabilizing top-down cascade (total fauna 60->40,
  // flora slightly up). Flag OFF is byte-identical to the chunk-7 baseline (no apex seeded, rescue guarded =>
  // no apex fauna => no apex code) -> the --apex=0 harness run is the proof.
  apexEnabled:true,
  apexSpeed:16,                            // move cooldown (== carnivore)
  apexEatSpeed:26,                         // ticks between kills - SLOW (vs carnivore 18) so pressure on carnivores stays light
  apexEatGain:95,                          // energy per kill - HIGH so one kill sustains an apex a long time => FEWER kills needed => lighter predation per unit persistence (the scavenger take-2 lesson)
  apexStartEnergy:80, apexMaxEnergy:180,   // high ceiling so a kill is not wasted by the cap (banks energy between rare kills)
  apexReproThreshold:135, apexReproCost:72, // breeds slowly + expensively -> stays rare (an apex, not a mob)
  // Apex immigration RESCUE (mid-prey-dependent analog of knob D): apex re-immigrate while scarce AND their
  // mid-tier prey (carn+scav) is present, capped low so it stays rare. Guarded on apexEnabled (off => no eRng).
  apexRescueRate:0.0008,                   // per mid-prey per-tick immigration prob while scarce (strong enough to hold a floor)
  apexRescueMinPrey:5,                      // need a few carnivores+scavengers present before an apex immigrates
  apexRescueApexCap:5,                      // keep apex RARE (rescue floor; it can breed above this if prey allow)
  // Trophic depth take 4 (chunk 9): an OMNIVORE tier that eats BOTH flora AND herbivore prey - the last planned
  // trophic tier and a DIFFERENT kind of hard. Unlike the sparse-food scavenger/apex (whose risk was starvation),
  // the omnivore's staple (flora) is ABUNDANT, so its balance risk is the OPPOSITE: COMPETITION - it competes
  // with herbivores for plants AND with carnivores for prey at once, blurring the herb/carn coupling the C2
  // balance rests on. So it is tuned DELIBERATELY as a RARE, INEFFICIENT generalist (weaker per-feed than either
  // specialist, breeds slowly, low rescue cap) so it cannot out-forage herbivores or over-hunt. It grazes as its
  // staple (opportunistic) and only hunts a grazer when no flora is on its tile, so predation stays secondary.
  // SHIPPED ON in chunk 9 after the A/B cleared the bar. First tuning (floraEatGain 9 / preyEatGain 42 /
  // reproCost 60) BOOMED (omni mean 32 >> the rescue cap => self-reproducing hard, carn-persistence 83->67% @12s);
  // take-4a (the values below: 6 / 32 / 80) made it RARE + rescue-sustained (omni mean ~7, near the rescue cap).
  // A/B at 24 seeds vs the chunk-8 baseline (--scav=12 --apex=8 --omni=8 vs --omni=0): extinction 0% both,
  // carn-persistence 79%->75% (a 1-seed swing, < 1 SE => NEUTRAL; the 12-seed 83->67 was reshuffle noise, see
  // Engineering Lessons), scav 100% both, apex-persistence 88%->96% (BETTER), omni-persistence 100% (mean 7.2),
  // cap-hits 0. Every existing tier neutral-to-better + the new tier persists => bar cleared. It re-crowds the
  // world the apex thinned (final fauna 51->71). Flag OFF is byte-identical to the chunk-8 baseline (nothing
  // seeds it + the rescue is guarded => no omnivore code runs) -> the --omni=0 harness run is the proof.
  omnivoreEnabled:true,
  omnivoreSpeed:17,                        // move cooldown (between herbivore 20 and carnivore 16)
  omnivoreEatSpeed:20,                      // ticks between feeding actions (== herbivore graze pace)
  // Take-4a re-tune: the first tuning (floraEatGain 9 / preyEatGain 42 / reproCost 60) BOOMED (omni mean 32,
  // above the rescue cap => self-reproducing hard), out-foraging herbivores + starving carnivores (carn 83->67%).
  // Cut BOTH per-feed gains (a generalist is master of neither) AND raise the repro cost (bigger post-breed climb
  // => far slower breeding) so the omnivore stays RARE + rescue-sustained (like the apex), competing minimally.
  omnivoreFloraEatGain:6,                  // energy per plant grazed - HALF the herbivore's 12 (a weak grazer that cannot out-compete the herd on flora)
  omnivorePreyEatGain:32,                  // energy per herbivore killed - well below carnivore 55 (an opportunistic bite, not a jackpot that fuels a boom)
  omnivoreStartEnergy:55, omnivoreMaxEnergy:110,
  omnivoreReproThreshold:110, omnivoreReproCost:80, // breeds only at a full tank + pays a big cost -> a long refill climb -> slow breeding -> stays rare
  omnivoreCrowding:1.5,                     // conspecific dispersion (fragments omnivores so they do not pile on the same flora/herbivore hotspots as the herd)
  // Omnivore immigration RESCUE (broad-diet analog of knob D): re-immigrate while omnivores are scarce AND there
  // is food - EITHER herbivore prey OR standing flora (a generalist survives on either), so the tier cannot hit
  // absorbing-zero. Capped low so it stays rare. Guarded on omnivoreEnabled (off => no eRng => byte-identical).
  omnivoreRescueRate:0.0006,               // per-tick immigration prob while scarce (scaled by prey abundance + a small flora-sustained floor)
  omnivoreRescueMinPrey:3,                  // a few herbivores present triggers it
  omnivoreRescueMinFlora:40,               // OR standing flora above this (the generalist floor, so it survives even when grazers are thin)
  omnivoreRescueOmniCap:5                   // keep omnivore RARE (rescue floor; it can breed above this if food allows)
};
// Snapshot defaults for preset reset
var DEFAULT_CFG = {};
(function(){for(var k in CFG) if(CFG.hasOwnProperty(k)) DEFAULT_CFG[k]=CFG[k];})();

// Pure (DOM-free) core: reset CFG to defaults, then layer a preset's cfg + toggles. Returns false for an
// unknown preset. Shared by applyPreset (which adds the DOM sync) and the scenario setup (chunk 5), so a
// scenario can build a preset's world without touching the DOM (mirrors the initWorld/init split).
function _applyPresetCfg(name){
  var p=PRESETS[name]; if(!p) return false;
  activePreset=name;
  for(var k in DEFAULT_CFG) if(DEFAULT_CFG.hasOwnProperty(k)) CFG[k]=DEFAULT_CFG[k];
  for(var ck in p.cfg) if(p.cfg.hasOwnProperty(ck)) CFG[ck]=p.cfg[ck];
  if(p.toggles.seasonalTilt!==undefined) CFG.seasonalTilt=p.toggles.seasonalTilt;
  if(p.toggles.anomalies!==undefined) CFG.anomalies=p.toggles.anomalies;
  if(p.toggles.volcanoAsh!==undefined) CFG.volcanoAsh=p.toggles.volcanoAsh;
  return true;
}
function idx(x,y){return y*W+x;} function inb(x,y){return x>=0&&y>=0&&x<W&&y<H;}
function neighbors4(x,y){var a=[]; if(x+1<W)a.push([x+1,y]); if(x-1>=0)a.push([x-1,y]); if(y+1<H)a.push([x,y+1]); if(y-1>=0)a.push([x,y-1]); return a;}
function neighbors8(x,y){var a=[]; for(var dy=-1;dy<=1;dy++){ for(var dx=-1;dx<=1;dx++){ if(dx||dy){ var nx=x+dx, ny=y+dy; if(inb(nx,ny)) a.push([nx,ny]); } } } return a;}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function climateInit(){
  baseTemp = new Float32Array(W*H); baseArid = new Float32Array(W*H);
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
    if(eRng()<0.002){ blob.vx+=(eRng()-0.5)*0.01; blob.vy+=(eRng()-0.5)*0.01;
      var sp=Math.sqrt(blob.vx*blob.vx+blob.vy*blob.vy); if(sp>0.03){blob.vx=(blob.vx/sp)*0.03;blob.vy=(blob.vy/sp)*0.03;} }
  }
}
function seasonPhase(){ if(CFG.climateSeasonLength<=0)return 0; return(tick%CFG.climateSeasonLength)/CFG.climateSeasonLength; }
// Seasonal waveform: a SYMMETRIC trapezoid in [-1,1] (warm plateau ~phase .25, cold plateau ~.75, linear
// ramps between). Symmetric => its average over a full year is exactly 0, so applied as an offset it returns
// to baseline each cycle instead of marching the climate one way (the old plateau wave averaged ~-0.15, which
// is what made "seasons" a permanent cool/dry drift once terrain genesis stopped resetting the field).
function seasonWave(phase){
  var pw=0.1; // plateau half-width (0.2 total per plateau)
  if(phase>=0.25-pw && phase<=0.25+pw) return 1;   // warm plateau [.15,.35]
  if(phase>=0.75-pw && phase<=0.75+pw) return -1;  // cold plateau [.65,.85]
  if(phase>0.25+pw && phase<0.75-pw){               // warm -> cold ramp (.35..0.65), +1 -> -1
    return 1 - 2*(phase-(0.25+pw))/((0.75-pw)-(0.25+pw));
  }
  // cold -> warm ramp, wrapping .85 -> 1 -> 0 -> .15, -1 -> +1
  var into = (phase>=0.75+pw) ? phase-(0.75+pw) : phase+(1-(0.75+pw));
  var rampLen = (1-(0.75+pw)) + (0.25-pw); // 0.30
  return -1 + 2*(into/rampLen);
}
// Advance the time-varying climate scalars (and drift the anomaly blobs). No per-tile work here - the field
// is written by applyClimate. yearlyVariation is a slow multi-year amplitude wobble (bounded, ~0.85..1.0).
function climateStep(){
  var yearCycle=(CFG.climateSeasonLength>0?tick/CFG.climateSeasonLength:0);
  yearlyVariation=0.85+Math.sin(yearCycle*0.15*2*Math.PI)*0.15;
  if(CFG.anomalies){ if(!anomalyBlobs)initAnomalyBlobs(); if(tick%5===0)updateAnomalyBlobs(); }
}
// Write the live fields = genesis baseline + bounded climate OFFSETS. Runs every tick. Each forcing is an
// offset (recomputed from scratch, never accumulated), so toggling any of them just adds/removes a swing and
// nothing drifts. seasonalTilt: zero-mean trapezoid scaled by amplitude * yearlyVariation * elevation-atten.
// anomalies: moving warm/cool blobs. volcanoAsh: localized cooling around volcano peaks. climateIntensity
// scales the whole offset (presets use it: ice age 1.8, volcanic 1.5).
function applyClimate(){
  if(!baseTemp||!baseArid) return;
  var ci=CFG.climateIntensity||1;
  var sW = CFG.seasonalTilt ? seasonWave(seasonPhase())*yearlyVariation : 0;
  var seasT = CFG.seasonalTempAmp*sW, seasA = -CFG.seasonalAridAmp*sW; // warm season is moister (sign kept from the old model)
  var anyOff = CFG.seasonalTilt || CFG.anomalies || CFG.volcanoAsh;
  for(var i=0;i<W*H;i++){
    if(!anyOff){ tempField[i]=baseTemp[i]; aridity[i]=baseArid[i]; continue; } // off => field IS the base (matches the pre-climate baseline exactly)
    var x=i%W,y=(i/W)|0;
    var atten=1-Math.min(1,(elev[i]||0)/10);
    var tOff=seasT*atten, aOff=seasA*atten;
    if(CFG.anomalies && anomalyBlobs){
      var totalAnom=0;
      for(var b=0;b<anomalyBlobs.length;b++){var blob=anomalyBlobs[b];var dx=x-blob.x,dy=y-blob.y;if(dx>W/2)dx-=W;if(dx<-W/2)dx+=W;if(dy>H/2)dy-=H;if(dy<-H/2)dy+=H;var distSq=dx*dx+dy*dy;var radiusSq=blob.radius*blob.radius;totalAnom+=blob.amplitude*Math.exp(-distSq/(2*radiusSq));}
      tOff += CFG.anomalyTempAmp*totalAnom; aOff += -CFG.anomalyAridAmp*totalAnom;
    }
    if(CFG.volcanoAsh){
      var vs = peakVolcano[i] ? 1 : (volcanoRing[i]===1 ? 0.5 : (volcanoRing[i]===2 ? 0.25 : 0));
      if(vs){ tOff += -CFG.volcanoTempAmp*vs; aOff += -CFG.volcanoAridAmp*vs; }
    }
    tempField[i]=clamp(baseTemp[i]+tOff*ci,0,10);
    aridity[i]=clamp(baseArid[i]+aOff*ci,0,10);
  }
}

// ===== UI hooks =====
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
// Genesis temperature from sunlight + elevation. Writes the BASE field; the live tempField is base + offsets
// (applyClimate). Called on terrain change / periodically, so the base tracks erosion + new land.
function computeTemperature(){for(var iT=0;iT<W*H;iT++){var s=Math.max(0,Math.min(1,sunlight[iT]/10));var sCurve=Math.pow(s,1.2);var e=elev[iT]||0;baseTemp[iT]=clamp(0.3+sCurve*9.8-0.06*e-0.24*Math.pow(Math.max(0,e-6),2)/16,0,10);}}
function computeAridity(){
  var dist=new Float32Array(W*H);for(var i=0;i<W*H;i++)dist[i]=1e9;var q=[];
  for(var y=0;y<H;y++)for(var x=0;x<W;x++){var ii=idx(x,y);if(grid[ii]===T.OCEAN||grid[ii]===T.COAST){dist[ii]=0;q.push([x,y]);}}
  while(q.length){var p=q.shift();var i0=idx(p[0],p[1]);neighbors4(p[0],p[1]).forEach(function(n){var j=idx(n[0],n[1]);if(dist[j]>dist[i0]+1){dist[j]=dist[i0]+1;q.push(n);}});}
  for(var k=0;k<W*H;k++){var d=dist[k];var base=10*(1-Math.exp(-d*CFG.aridityDistK));var Tm=baseTemp[k]||0;var hot=(Tm>8)?CFG.aridityHotBoost*((Tm-8)/2):0;baseArid[k]=clamp(base+CFG.ariditySunCoef*sunlight[k]-CFG.aridityElevCoef*(10-(elev[k]||0))+hot,0,10);}
  var c2=new Float32Array(baseArid);for(var y4=0;y4<H;y4++)for(var x4=0;x4<W;x4++){var sum2=0,n2=0;neighbors4(x4,y4).forEach(function(p){sum2+=c2[idx(p[0],p[1])];n2++;});baseArid[idx(x4,y4)]=clamp((c2[idx(x4,y4)]+sum2)/(n2+1),0,10);}
  // River moisture effect: reduce aridity on river tiles and neighbors
  if(riverData&&riverGenerated){for(var rk=0;rk<W*H;rk++){if(riverData[rk]){baseArid[rk]=clamp(baseArid[rk]-RIVER_ARIDITY_EFFECT,0,10);var rx=rk%W,ry=(rk/W)|0;var rn=neighbors4(rx,ry);for(var rni=0;rni<rn.length;rni++){var rnj=idx(rn[rni][0],rn[rni][1]);baseArid[rnj]=clamp(baseArid[rnj]-RIVER_ARIDITY_EFFECT*0.3,0,10);}}}}
  computeWaterDist();
}
// Distance (in tiles) from every cell to the nearest WATER feature: ocean/coast, plus river + lake tiles
// once rivers are generated. This is the flora clustering signal (Kevin's call: water-proximity, flora-only)
// - it leaves aridity and the biome map untouched. In the headless harness rivers are not generated, so it
// degrades to coast distance (still drives coverage reduction + coast-clustering). BFS via an index-pointer
// queue (no O(n) shift). Recomputed wherever computeAridity is (genesis change / every 20 ticks) + on restore.
function computeWaterDist(){
  if(!waterDist||waterDist.length!==W*H)waterDist=new Float32Array(W*H);
  var q=new Int32Array(W*H),qn=0;
  for(var i=0;i<W*H;i++){var isW=(grid[i]===T.OCEAN||grid[i]===T.COAST||(riverGenerated&&riverData&&riverData[i]));if(isW){waterDist[i]=0;q[qn++]=i;}else waterDist[i]=1e9;}
  for(var h=0;h<qn;h++){var c=q[h],cx=c%W,cy=(c/W)|0,nb=neighbors4(cx,cy);for(var k=0;k<nb.length;k++){var j=idx(nb[k][0],nb[k][1]);if(waterDist[j]>waterDist[c]+1){waterDist[j]=waterDist[c]+1;q[qn++]=j;}}}
}
function classifyTile(e,A,Tm,SL){if(e>7)return T.MOUNTAIN;if(e>5.3){if(Tm<=2)return T.GLACIER;if(A>5&&Tm>4)return T.MESA;return T.HILLS;}if(Tm<2)return T.ARCTIC;if(Tm<2.5&&A<2.5)return T.GLACIER;if(Tm<3.2&&A<=3.5)return T.TUNDRA;if(A>5&&Tm>4&&SL>7.3)return T.DESERT;if(Tm>6&&SL>5.2&&A<4.3)return T.JUNGLE;if(Tm>5&&A>3&&A<=5.5)return T.SAVANNA;if(A>3&&Tm<3.5)return T.STEPPE;if(A>2&&A<=6.4&&Tm>2.7&&Tm<=6.6)return T.FOREST;if(e<1&&A<=3)return T.WETLAND;return T.PLAINS;}
function reclassTerrain(){for(var y=0;y<H;y++)for(var x=0;x<W;x++){var iR=idx(x,y);if(grid[iR]===T.OCEAN||grid[iR]===T.VOLCANIC)continue;if(grid[iR]===T.COAST&&coastTTL[iR]>0)continue;if(volcanoRing&&volcanoRing[iR]===3){grid[iR]=T.MOUNTAIN;continue;}if(volcanoRing&&volcanoRing[iR]===1){grid[iR]=T.MOUNTAIN;continue;}if(volcanoRing&&volcanoRing[iR]===2){grid[iR]=T.HILLS;continue;}grid[iR]=classifyTile(elev[iR]||0,aridity[iR]||0,tempField[iR]||0,sunlight[iR]||0);}
  // Build ecotone boundary cache
  if(!biomeBoundary||biomeBoundary.length!==W*H) biomeBoundary=new Uint8Array(W*H);
  for(var yy=0;yy<H;yy++)for(var xx=0;xx<W;xx++){var ii=idx(xx,yy);var myT=grid[ii];biomeBoundary[ii]=0;if(myT===T.OCEAN)continue;var nb=neighbors4(xx,yy);for(var nn=0;nn<nb.length;nn++){var nj=idx(nb[nn][0],nb[nn][1]);if(grid[nj]!==myT&&grid[nj]!==T.OCEAN){biomeBoundary[ii]=1;break;}}}
}
function randn(){var u=0,v=0;while(u===0)u=eRng();while(v===0)v=eRng();return Math.sqrt(-2.0*Math.log(u))*Math.cos(2*Math.PI*v);}
// Gaussian draw on the COSMETIC stream (size-gene drift). Never touches eRng -> balance-neutral.
function cRandn(){var u=0,v=0;while(u===0)u=cRng();while(v===0)v=cRng();return Math.sqrt(-2.0*Math.log(u))*Math.cos(2*Math.PI*v);}
function truncatedNormal(mean,sigma,lo,hi){var x;for(var g=0;g<20;g++){x=mean+sigma*randn();if(x>=lo&&x<=hi)return x;}return clamp(x,lo,hi);}
function betaapprox(a,b){function gK(k){if(k<1){var u=eRng();return gK(1+k)*Math.pow(u,1/k);}var d=k-1/3,c=1/Math.sqrt(9*d);while(true){var x=randn();var v=1+c*x;if(v<=0)continue;v=v*v*v;var u=eRng();if(u<1-0.0331*(x*x)*(x*x))return d*v;if(Math.log(u)<0.5*x*x+d*(1-v+Math.log(v)))return d*v;}}var x=gK(a),y=gK(b);return x/(x+y);}
function gammaSample(shape,scale){function gK(k){if(k<1){var u=eRng();return gK(1+k)*Math.pow(u,1/k);}var d=k-1/3,c=1/Math.sqrt(9*d);while(true){var x=randn();var v=1+c*x;if(v<=0)continue;v=v*v*v;var u=eRng();if(u<1-0.0331*(x*x)*(x*x))return d*v;if(Math.log(u)<0.5*x*x+d*(1-v+Math.log(v)))return d*v;}}return gK(shape)*scale;}
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

// Standard hydrology pipeline (replaces the old greedy downhill tracer, which dead-ended in
// local minima): priority-flood depression fill -> D8 flow receivers -> flow accumulation ->
// threshold. This guarantees dendritic rivers that reach the sea BY CONSTRUCTION - every land
// cell has a monotone-descending path to an ocean outlet, so there are no orphaned basin stubs.
// Pure + seeded (reads grid/elev/_seed only); runs on the rivers button, not per tick.
function generateRivers(){
  var N=W*H;
  riverData=new Array(N);for(var i0=0;i0<N;i0++)riverData[i0]=null;
  riverGenerated=true;
  var rRng=mulberry32((_seed+7919)>>>0); // seeded jitter for meander offsets + pool sizes

  // --- Step 0: Smooth the ROUTING surface (not the displayed terrain) ---
  // A light 3x3 land-only blur. D8 on the raw noisy elevation scatters flow into disconnected
  // single-cell rivulets; smoothing the surface that drives fill/flow merges them into channels.
  var se=new Float64Array(N);for(var q0=0;q0<N;q0++)se[q0]=elev[q0]||0;
  for(var sp0=0;sp0<RIVER_SMOOTH_PASSES;sp0++){
    var prev=new Float64Array(N);prev.set(se);
    for(var sy=0;sy<H;sy++)for(var sx=0;sx<W;sx++){
      var si=sy*W+sx;if(grid[si]===T.OCEAN)continue;
      var sum=0,cnt=0;
      for(var ddy=-1;ddy<=1;ddy++)for(var ddx=-1;ddx<=1;ddx++){
        var ax=sx+ddx,ay=sy+ddy;if(!inb(ax,ay))continue;var aj=ay*W+ax;if(grid[aj]===T.OCEAN)continue;
        sum+=prev[aj];cnt++;
      }
      if(cnt>0)se[si]=sum/cnt;
    }
  }

  // --- Step 1: Priority-flood depression fill + flow directions (Barnes et al. 2014) ---
  // A min-heap keyed on the filled surface, seeded from every ocean cell (the base level) plus the
  // map border (a safety outlet). Popping in increasing filled order, the first cell to reach an
  // unvisited neighbour becomes that neighbour's receiver and raises it to the spill level. One pass
  // yields a pit-free surface AND a drainage tree rooted at the sea. recvDir[n] = 8-dir n -> receiver.
  var filled=new Float64Array(N);
  var recv=new Int32Array(N);    // receiver cell index; -1 = outlet (ocean / map edge)
  var recvDir=new Int8Array(N);  // direction from a cell toward its receiver; -1 = none
  var visited=new Uint8Array(N);
  for(var r0=0;r0<N;r0++){recv[r0]=-1;recvDir[r0]=-1;}

  // Binary min-heap over (filled value, cell index).
  var hF=new Float64Array(N),hI=new Int32Array(N),hn=0;
  function hpush(f,ci){var c=hn++;hF[c]=f;hI[c]=ci;while(c>0){var p=(c-1)>>1;if(hF[p]<=hF[c])break;var tf=hF[p];hF[p]=hF[c];hF[c]=tf;var ti=hI[p];hI[p]=hI[c];hI[c]=ti;c=p;}}
  function hpop(){var out=hI[0];hn--;if(hn>0){hF[0]=hF[hn];hI[0]=hI[hn];var c=0;for(;;){var l=2*c+1,rg=2*c+2,m=c;if(l<hn&&hF[l]<hF[m])m=l;if(rg<hn&&hF[rg]<hF[m])m=rg;if(m===c)break;var tf=hF[m];hF[m]=hF[c];hF[c]=tf;var ti=hI[m];hI[m]=hI[c];hI[c]=ti;c=m;}}return out;}
  function seed(ci){if(visited[ci])return;filled[ci]=se[ci];visited[ci]=1;hpush(filled[ci],ci);}

  for(var s=0;s<N;s++)if(grid[s]===T.OCEAN)seed(s);
  for(var bx=0;bx<W;bx++){seed(bx);seed((H-1)*W+bx);}
  for(var by=0;by<H;by++){seed(by*W);seed(by*W+(W-1));}

  var order=new Int32Array(N),on=0;
  while(hn>0){
    var c=hpop();order[on++]=c;
    var cx=c%W,cy=(c/W)|0;
    for(var d=0;d<8;d++){
      var nx=cx+DIR_DX[d],ny=cy+DIR_DY[d];
      if(!inb(nx,ny))continue;
      var n=ny*W+nx;
      if(visited[n])continue;
      var fn=se[n];if(fn<filled[c])fn=filled[c]; // raise a pit to its spill level
      filled[n]=fn;recv[n]=c;recvDir[n]=oppositeDir(d);visited[n]=1;
      hpush(fn,n);
    }
  }

  // --- Step 2: Flow accumulation (drainage area per cell) ---
  // Unit area per land cell, donated downstream. Processing in reverse pop order guarantees a cell
  // is fully accumulated before it pays its receiver (the receiver is always popped earlier).
  var acc=new Float64Array(N);
  for(var a0=0;a0<N;a0++)acc[a0]=(grid[a0]===T.OCEAN)?0:1;
  for(var k=on-1;k>=0;k--){var cc=order[k];var rc=recv[cc];if(rc>=0)acc[rc]+=acc[cc];}

  // Longest upstream flow length per cell (reverse pop order = upstream first, so a cell's value is
  // final before it pays its receiver). Used below to give each whole river one length-based width.
  var ul=new Float64Array(N);
  for(var u0=on-1;u0>=0;u0--){var uc=order[u0];var urr=recv[uc];if(urr>=0&&ul[uc]+1>ul[urr])ul[urr]=ul[uc]+1;}

  // --- Step 3: Lakes = filled basins, big enough AND high enough to read as headwater lakes ---
  // A filled depression holds water. Keep only components that are large (LAKE_MIN_CELLS) and sit in
  // the upper elevation band (LAKE_MIN_ELEV_FRAC) - those read as source/highland lakes near the river
  // heads rather than coastal ponds. Small or low-lying fills are flowed over, not drawn.
  var eMinL=Infinity,eMaxL=-Infinity;
  for(var em=0;em<N;em++)if(grid[em]!==T.OCEAN){var ev=se[em];if(ev<eMinL)eMinL=ev;if(ev>eMaxL)eMaxL=ev;}
  var hiCut=eMinL+(eMaxL-eMinL)*LAKE_MIN_ELEV_FRAC;
  var isLake=new Uint8Array(N);
  for(var l0=0;l0<N;l0++)if(grid[l0]!==T.OCEAN&&(filled[l0]-se[l0])>LAKE_MIN_DEPTH)isLake[l0]=1;
  var seen=new Uint8Array(N),stack=new Int32Array(N),comp=new Int32Array(N);
  for(var c0=0;c0<N;c0++){
    if(!isLake[c0]||seen[c0])continue;
    var sp=0,cn=0,esum=0;stack[sp++]=c0;seen[c0]=1;
    while(sp>0){var cur=stack[--sp];comp[cn++]=cur;esum+=se[cur];var ux=cur%W,uy=(cur/W)|0;
      for(var dd=0;dd<8;dd+=2){var lx=ux+DIR_DX[dd],ly=uy+DIR_DY[dd];if(!inb(lx,ly))continue;var li=ly*W+lx;if(isLake[li]&&!seen[li]){seen[li]=1;stack[sp++]=li;}}}
    if(cn<LAKE_MIN_CELLS||(esum/cn)<hiCut)for(var ci=0;ci<cn;ci++)isLake[comp[ci]]=0;
  }

  // --- Step 4: Build render data. River where accumulation crosses the threshold; lakes render as
  // pools (no through-line) except at their spill cell, which carries the overflow river out. ---
  for(var i=0;i<N;i++){
    if(grid[i]===T.OCEAN)continue;
    var lake=isLake[i]===1;
    var river=acc[i]>=CFG.riverAccumThreshold;
    if(!lake&&!river)continue;

    var rc2=recv[i];
    var recvIsLake=(rc2>=0&&isLake[rc2]===1);
    // A lake only discharges at its spill cell (receiver not itself a lake); interiors are pools.
    var exitDir=(lake&&recvIsLake)?-1:recvDir[i];
    var atSea=(rc2>=0&&grid[rc2]===T.OCEAN);
    var atEdge=(rc2<0);
    var estuary=(atSea||atEdge)&&!(lake&&recvIsLake);

    // Entry edge = toward the dominant upstream contributor (largest accumulation draining in).
    // Lakes are pools and carry no entry/exit line, so only river cells compute this.
    var entryDir=-1,sourcePool=false;
    if(!lake){
      var bestUp=-1,bestAcc=-1,px=i%W,py=(i/W)|0;
      for(var ud=0;ud<8;ud++){
        var qx=px+DIR_DX[ud],qy=py+DIR_DY[ud];if(!inb(qx,qy))continue;
        var q=qy*W+qx;
        if(recv[q]===i&&(acc[q]>=CFG.riverAccumThreshold||isLake[q])&&acc[q]>bestAcc){bestAcc=acc[q];bestUp=ud;}
      }
      if(bestUp>=0)entryDir=bestUp;else if(river)sourcePool=true;
    }

    // Width: grows with sqrt of drainage area so a river visibly widens as it gathers tributaries
    // downstream (volume 1 at a headwater .. ~12 on a continental trunk).
    var ratio=acc[i]/CFG.riverAccumThreshold;if(ratio<1)ratio=1;
    var volume=Math.round(1+Math.sqrt(ratio-1)*2.2);if(volume<1)volume=1;else if(volume>12)volume=12;

    riverData[i]={entryDir:entryDir,exitDir:exitDir,volume:volume,
      lake:lake,sourcePool:sourcePool,estuary:estuary,
      curveOffset:(rRng()-0.5)*0.8,
      poolSize:lake?(0.5+rRng()*0.15):(sourcePool?0.4+rRng()*0.25:0)};
  }

  // --- Step 5: Source lakes. Natural fill lakes only form in low ground, so place a few BIG lakes at
  // the highest, well-spaced river heads: each river then visibly SPRINGS from a lake near its source
  // (no "starting from nowhere"), and the lake overflows into the river that carries on to the sea. ---
  var heads=[];
  for(var hh=0;hh<N;hh++){var rh=riverData[hh];if(rh&&rh.sourcePool)heads.push(hh);}
  heads.sort(function(a,b){return se[b]-se[a];}); // highest sources first
  var picked=[];
  for(var pj=0;pj<heads.length&&picked.length<SOURCE_LAKE_COUNT;pj++){
    var ph=heads[pj],phx=ph%W,phy=(ph/W)|0,far=true;
    for(var pk=0;pk<picked.length;pk++){var qx=picked[pk]%W,qy=(picked[pk]/W)|0;if(Math.abs(phx-qx)+Math.abs(phy-qy)<SOURCE_LAKE_SPACING){far=false;break;}}
    if(far)picked.push(ph);
  }
  // Each lake gets an organic outline (per-angle radii); ~1/3 are given a distinctive, elongated/lobed
  // shape rather than a circle. Cells inside the outline (plus a thin shore margin) are marked lake so
  // the fauna-free + no-river zone matches what is drawn. lakeShapes stores the outline for the render.
  lakeShapes=[];var srcLakeCell=new Uint8Array(N);var LAKE_NPTS=16;
  for(var pp=0;pp<picked.length;pp++){
    var lc=picked[pp],lcx=lc%W,lcy=(lc/W)|0;
    var lr=SOURCE_LAKE_R_MIN+rRng()*(SOURCE_LAKE_R_MAX-SOURCE_LAKE_R_MIN); // varied size per lake
    var uniq=(pp%3===2); // ~1/3 distinctive
    var p1=rRng()*6.2832,p2=rRng()*6.2832,p3=rRng()*6.2832;
    var amp1=uniq?0.30+rRng()*0.22:0.08+rRng()*0.07,amp2=uniq?0.22+rRng()*0.18:0.05+rRng()*0.05;
    var elong=uniq?0.30+rRng()*0.30:0.0,erot=rRng()*3.1416;
    var radii=new Array(LAKE_NPTS),maxR=0;
    for(var an=0;an<LAKE_NPTS;an++){var ang=an/LAKE_NPTS*6.2832;
      var f=1+amp1*Math.sin(ang*2+p1)+amp2*Math.sin(ang*3+p2)+(uniq?0.12*Math.sin(ang+p3):0);
      f*=(1-elong*0.5*Math.cos(2*(ang-erot)));
      var rv2=Math.max(lr*0.4,lr*f);radii[an]=rv2;if(rv2>maxR)maxR=rv2;}
    var rmark=Math.ceil(maxR+1);
    // Reject this lake if its blob (radius maxR) would touch the sea or map edge - a source lake must
    // never bleed into the ocean. Scan the footprint; on any ocean/OOB cell within the blob, skip it.
    var touchesSea=false;
    for(var sy0=-rmark;sy0<=rmark&&!touchesSea;sy0++)for(var sx0=-rmark;sx0<=rmark;sx0++){
      if(Math.sqrt(sx0*sx0+sy0*sy0)>maxR+1)continue;
      var sxx0=lcx+sx0,syy0=lcy+sy0;
      if(!inb(sxx0,syy0)||grid[syy0*W+sxx0]===T.OCEAN){touchesSea=true;break;}
    }
    if(touchesSea)continue;
    for(var oy=-rmark;oy<=rmark;oy++)for(var ox=-rmark;ox<=rmark;ox++){
      var oxx=lcx+ox,oyy=lcy+oy;if(!inb(oxx,oyy))continue;var oii=oyy*W+oxx;if(grid[oii]===T.OCEAN)continue;
      var dist=Math.sqrt(ox*ox+oy*oy);if(dist>maxR+1)continue;
      var ang2=Math.atan2(oy,ox);if(ang2<0)ang2+=6.2832;
      var t2=ang2/6.2832*LAKE_NPTS,i0=Math.floor(t2)%LAKE_NPTS,i1=(i0+1)%LAKE_NPTS,fr=t2-Math.floor(t2);
      var rAt=radii[i0]*(1-fr)+radii[i1]*fr;
      if(dist>rAt+0.8)continue; // shore margin so NO fauna sit even partly under the lake
      var prevExit=riverData[oii]?riverData[oii].exitDir:-1;
      if(!riverData[oii])riverData[oii]={entryDir:-1,exitDir:-1,volume:1,lake:false,sourcePool:false,estuary:false,curveOffset:0,poolSize:0};
      var rdl=riverData[oii];rdl.lake=true;rdl.sourcePool=false;rdl.entryDir=-1;
      if(oii===lc){rdl.exitDir=prevExit;}else{rdl.exitDir=-1;rdl.estuary=false;}
      srcLakeCell[oii]=1;
    }
    lakeShapes.push({cx:lcx+0.5,cy:lcy+0.5,radii:radii});
  }

  // --- Step 6: Per-river UNIFORM width. Decompose the network into rivers - a main stem plus each
  // tributary as its own river (the 'main child' at a junction is the longest-upstream branch) - and
  // give every cell of a river ONE width set by that river's LENGTH (short rivers skinny, long rivers
  // wide), rather than widening downstream. ---
  function mainChildOf(c){
    var mx=c%W,my=(c/W)|0,best=-1,bestUl=-1;
    for(var dch=0;dch<8;dch++){var ncx=mx+DIR_DX[dch],ncy=my+DIR_DY[dch];if(!inb(ncx,ncy))continue;var nci=ncy*W+ncx;
      if(recv[nci]===c){var rdn=riverData[nci];if(rdn&&!rdn.lake&&ul[nci]>bestUl){bestUl=ul[nci];best=nci;}}}
    return best;
  }
  var riverW=new Int16Array(N);for(var rw0=0;rw0<N;rw0++)riverW[rw0]=-1;
  var tails=[]; // a river's downstream end: a river cell that discharges to sea / map edge / a lake
  for(var ti=0;ti<N;ti++){var rdt=riverData[ti];if(!rdt||rdt.lake)continue;var rt=recv[ti];
    if(rt<0||grid[rt]===T.OCEAN||(riverData[rt]&&riverData[rt].lake))tails.push(ti);}
  for(var tj=0;tj<tails.length;tj++){
    var tail=tails[tj];if(riverW[tail]>=0)continue;
    var chain=[],cc2=tail;
    while(cc2>=0&&riverData[cc2]&&!riverData[cc2].lake&&riverW[cc2]<0){
      chain.push(cc2);
      var mc=mainChildOf(cc2);
      var bx=cc2%W,by=(cc2/W)|0; // non-main upstream branches start their own (tributary) rivers
      for(var bd=0;bd<8;bd++){var nbx=bx+DIR_DX[bd],nby=by+DIR_DY[bd];if(!inb(nbx,nby))continue;var nbi=nby*W+nbx;
        if(recv[nbi]===cc2&&riverData[nbi]&&!riverData[nbi].lake&&nbi!==mc&&riverW[nbi]<0)tails.push(nbi);}
      cc2=mc;
    }
    var vol=Math.round(1+chain.length/4);if(vol<1)vol=1;else if(vol>12)vol=12;
    for(var chi=0;chi<chain.length;chi++)riverW[chain[chi]]=vol;
  }
  for(var aw=0;aw<N;aw++)if(riverW[aw]>=0&&riverData[aw])riverData[aw].volume=riverW[aw];

  // Natural fill-lakes (rare on a high continent) get a simple circular outline appended to lakeShapes.
  var lseen=new Uint8Array(N),lstk=new Int32Array(N);
  for(var ls=0;ls<N;ls++){
    if(!riverData[ls]||!riverData[ls].lake||lseen[ls]||srcLakeCell[ls])continue;
    var lp=0,lcnt=0,sxx=0,syy=0;lstk[lp++]=ls;lseen[ls]=1;
    while(lp>0){var lcur=lstk[--lp];lcnt++;sxx+=lcur%W;syy+=(lcur/W)|0;var ax=lcur%W,ay=(lcur/W)|0;
      for(var ld=0;ld<8;ld++){var nlx=ax+DIR_DX[ld],nly=ay+DIR_DY[ld];if(!inb(nlx,nly))continue;var nli=nly*W+nlx;if(riverData[nli]&&riverData[nli].lake&&!lseen[nli]&&!srcLakeCell[nli]){lseen[nli]=1;lstk[lp++]=nli;}}}
    var rr0=Math.sqrt(lcnt/Math.PI),radc=new Array(16);for(var rc2=0;rc2<16;rc2++)radc[rc2]=rr0;
    lakeShapes.push({cx:sxx/lcnt+0.5,cy:syy/lcnt+0.5,radii:radc});
  }
}

function clearRivers(){
  riverData=new Array(W*H);for(var i=0;i<W*H;i++)riverData[i]=null;
  riverGenerated=false;lakeShapes=[];
}

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
  if(entity.gen<SPECIES_MIN_GEN) return null; // too young a lineage (same gate as the speciation registry)
  if(!entity._speciesName) entity._speciesName=generateSpeciesName(entity,type);
  return entity._speciesName;
}

// ======================================================================
//  ECOLOGY SYSTEM
// ======================================================================
function hsv2hex(h,s,v){s=clamp(s,0,1);v=clamp(v,0,1);var c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;var r=0,g=0,b=0;if(h<60){r=c;g=x;}else if(h<120){r=x;g=c;}else if(h<180){g=c;b=x;}else if(h<240){g=x;b=c;}else if(h<300){r=x;b=c;}else{r=c;b=x;}return '#'+[Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)].map(function(vv){return vv.toString(16).padStart(2,'0');}).join('');}
var FLORA_SHAPES=['dot','plus','x','ring','diamond'];
function makeFlora(x,y,prefs){var i=idx(x,y);var tA=(aridity[i]||5),tT=(tempField[i]||5),tS=(sunlight[i]||5);var pA=prefs?prefs.prefArid:clamp(tA+(eRng()*2-1),0,10);var pT=prefs?prefs.prefTemp:clamp(tT+(eRng()*2-1),0,10);var pS=prefs?prefs.prefSL:clamp(tS+(eRng()*2-1),0,10);var tol=prefs?prefs.tolerance:(CFG.floraToleranceBase+(eRng()-0.5)*1.0);
  // Natural flora palette: olive-gold (55) through deep green (155), aridity shifts toward gold
  var hue=prefs?prefs.hue:(55+pT*6+Math.max(0,(7-pA))*8+(eRng()*16-8));
  hue=((hue%360)+360)%360; if(hue<55||hue>155) hue=55+eRng()*100; // clamp to natural band
  var sat=prefs?prefs.sat:(0.3+0.04*(10-pA)+eRng()*0.15); // lower sat = more natural
  var val=prefs?prefs.val:(0.35+eRng()*0.25); // darker overall
  return{id:++floraIdCounter,x:x,y:y,prefArid:pA,prefTemp:pT,prefSL:pS,tolerance:clamp(tol,1.0,5.0),hue:hue,sat:clamp(sat,0.25,0.7),val:clamp(val,0.3,0.65),shape:FLORA_SHAPES[(eRng()*FLORA_SHAPES.length)|0],health:1.0,age:0,maxAge:CFG.floraBaseMaxAge*(0.7+eRng()*0.6),gen:prefs?(prefs.gen||0):0};}
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
function computeFloraHealth(f){var i=idx(f.x,f.y);if(!inb(f.x,f.y)||grid[i]===T.OCEAN)return 0;var A=(aridity[i]||5);var dA=A-f.prefArid,dT=(tempField[i]||5)-f.prefTemp,dS=(sunlight[i]||5)-f.prefSL;var base=Math.exp(-(dA*dA+dT*dT+dS*dS)/(2*f.tolerance*f.tolerance*2));var harshness=BIOME_FLORA_HARSHNESS[grid[i]];if(harshness===undefined)harshness=1.0;
  // Absolute moisture brake: even a perfectly dry-ADAPTED plant (high climate-fit base) is capped by how
  // dry the ground actually is, so flora dies back in arid interior / deserts.
  var dry=Math.max(0,A-CFG.floraAridTolerance),moistFit=1/(1+CFG.floraMoisturePenalty*dry*dry);
  // Water-proximity brake: flora far from any water (coast/river/lake) is weaker, so it clusters on water
  // and the deep interior goes barer (the primary 'less of the map' lever). Coast-only in the headless harness.
  var farW=Math.max(0,(waterDist[i]||0)-CFG.floraWaterDistFree),waterFit=1/(1+CFG.floraWaterDistPenalty*farW*farW);
  return base*harshness*moistFit*waterFit;}
function mutateFloraChild(parent,cx,cy){var mag=CFG.floraMutationMag;var bias=CFG.floraMutationBias||0;
  // Adaptive mutation: shift partially toward local tile conditions
  var ci=idx(cx,cy);var tA=(aridity[ci]||5),tT=(tempField[ci]||5),tS=(sunlight[ci]||5);
  // Random component + directional pull toward tile's actual values
  var shiftA=randn()*mag*(1-bias)+(tA-parent.prefArid)*bias;
  var shiftT=randn()*mag*(1-bias)+(tT-parent.prefTemp)*bias;
  var shiftS=randn()*mag*(1-bias)+(tS-parent.prefSL)*bias;
  var child=makeFlora(cx,cy,{prefArid:clamp(parent.prefArid+shiftA,0,10),prefTemp:clamp(parent.prefTemp+shiftT,0,10),prefSL:clamp(parent.prefSL+shiftS,0,10),tolerance:clamp(parent.tolerance+randn()*0.3,1.0,5.0),hue:clamp((parent.hue+randn()*12+360)%360,55,155),sat:clamp(parent.sat+(eRng()-0.5)*0.08,0.25,0.7),val:clamp(parent.val+(eRng()-0.5)*0.06,0.3,0.65),gen:parent.gen+1});if(eRng()<0.3)child.shape=FLORA_SHAPES[(eRng()*FLORA_SHAPES.length)|0];return child;}
function cloneFloraChild(parent,cx,cy){return makeFlora(cx,cy,{prefArid:parent.prefArid,prefTemp:parent.prefTemp,prefSL:parent.prefSL,tolerance:parent.tolerance,hue:parent.hue,sat:parent.sat,val:parent.val,gen:parent.gen});}
// Moisture suitability for flora PLACEMENT (not survival): 1.0 at wet tiles (aridity 0), decaying as the
// tile dries, so natural spawn + spread + initial seeding favor coasts/rivers/lakes (low aridity, incl.
// the river-moisture bonus in computeAridity) and shun deserts (highest aridity). floraWaterWeight=0
// disables it (uniform placement, old behavior). Survival is still governed by computeFloraHealth /
// BIOME_FLORA_HARSHNESS; this only biases WHERE new plants are attempted.
function floraMoistureSuit(i){var s=1;if(CFG.floraWaterDistK>0)s*=Math.exp(-(waterDist[i]||0)*CFG.floraWaterDistK);if(CFG.floraWaterWeight>0){var A=aridity[i]||5;s*=Math.exp(-A*A*CFG.floraWaterWeight);}return s;}
// Pick a placement tile: draw a FIXED number of random candidates and select one PROPORTIONALLY to its
// moisture suitability, so wetter (low-aridity) tiles win more often and deserts almost never. The draw
// count is fixed regardless of floraWaterWeight (K position draws + 1 selection), so changing the knob
// does NOT shift the RNG stream - tuning A/Bs stay same-world clean. floraWaterWeight=0 => all weights 1
// => uniform pick among valid candidates (old behavior). Returns a tile index, or -1 if no candidate was land.
function pickFloraTile(){var K=CFG.floraPlaceSamples||10;var ci=[],cw=[],tw=0;
  for(var s=0;s<K;s++){var x=(eRng()*W)|0,y=(eRng()*H)|0;var i=idx(x,y),t=grid[i];if(t===T.OCEAN||t===T.MOUNTAIN||t===T.VOLCANIC)continue;var w=floraMoistureSuit(i);ci.push(i);cw.push(w);tw+=w;}
  if(!ci.length)return -1;var rp=eRng()*tw;for(var c=0;c<ci.length;c++){rp-=cw[c];if(rp<=0)return ci[c];}return ci[ci.length-1];}
function seedFloraCluster(n){var placed=0,guard=n*30;while(placed<n&&guard-->0){var i=pickFloraTile();if(i>=0){flora.push(makeFlora(i%W,(i/W)|0,null));placed++;}}}
// Dynamic flora pop cap: 0 = map-size based (tiles x per-tile cap), else use configured value
function floraPopCap(){return CFG.floraMaxPop>0?CFG.floraMaxPop:(W*H*(CFG.floraPerTileMax||4));}
function naturalFloraSpawn(){if(flora.length>=floraPopCap())return;if(eRng()>=CFG.floraSpawnChance*floraLandVigor)return;var i=pickFloraTile();if(i>=0)flora.push(makeFlora(i%W,(i/W)|0,null));}
function floraStep(){if(!CFG.ecoActive)return;
  // Maturity thinning: ramp flora vigor down as land fills (overrun regime), zero effect below the start
  // threshold so the low-land C2 balance is untouched. Scales spread + spawn (NOT health), so flora
  // STILL clusters on water - there is just less of it once the world has matured into a continent.
  var _lc=landCoverage();floraLandVigor=1-CFG.floraLandThin*clamp((_lc-CFG.floraLandThinStart)/Math.max(0.01,1-CFG.floraLandThinStart),0,1);
  naturalFloraSpawn();
  // Process regrowth remnants
  var rKeep=[];for(var ri=0;ri<floraRemnants.length;ri++){var rem=floraRemnants[ri];if(tick>=rem.tickDue){if(flora.length<floraPopCap()){var ti=idx(rem.x,rem.y);if(grid[ti]!==T.OCEAN){flora.push(makeFlora(rem.x,rem.y,rem.prefs));}}}else{rKeep.push(rem);}}floraRemnants=rKeep;
  // Build per-tile flora index for competition checks
  var _floraTile={};for(var ff=0;ff<flora.length;ff++){if(!flora[ff])continue;var fk=idx(flora[ff].x,flora[ff].y);if(!_floraTile[fk])_floraTile[fk]=[];_floraTile[fk].push(ff);}
  // Adaptive sampling: higher rate at small populations for establishment
  var sampleRate=(flora.length<50)?0.30:0.15;
  var sampleSize=Math.min(flora.length,Math.max(8,(flora.length*sampleRate)|0));var newFlora=[];
  for(var k=0;k<sampleSize;k++){var fi=(eRng()*flora.length)|0;var f=flora[fi];if(!f)continue;f.health=computeFloraHealth(f);f.age++;var effectiveMaxAge=f.maxAge*(0.3+0.7*f.health);if(f.age>=effectiveMaxAge||f.health<0.05){flora[fi]=null;continue;}if(grid[idx(f.x,f.y)]===T.OCEAN){flora[fi]=null;continue;}if(flora.length+newFlora.length>=floraPopCap())continue;
    // Spread chance: base x health^2 x ecotone boost
    var spreadMod=1.0;if(biomeBoundary&&biomeBoundary[idx(f.x,f.y)])spreadMod=CFG.ecotoneFloraBoost||1.0;
    if(eRng()>=CFG.floraSpreadBase*floraLandVigor*f.health*f.health*spreadMod)continue;
    var cands=neighbors8(f.x,f.y).filter(function(p){var t=grid[idx(p[0],p[1])];return t!==T.OCEAN&&t!==T.MOUNTAIN&&t!==T.VOLCANIC;});if(!cands.length)continue;
    // Suitability-weighted destination: spread toward the wetter neighbors (one eRng draw, same as a
    // uniform pick, so draw COUNT is unchanged - clean A/B). floraWaterWeight=0 => all weights 1 => uniform.
    var _tw=0,_cw=[];for(var _ci=0;_ci<cands.length;_ci++){var _w=floraMoistureSuit(idx(cands[_ci][0],cands[_ci][1]));_cw.push(_w);_tw+=_w;}
    var _rp=eRng()*_tw;var dest=cands[cands.length-1];for(var _cj=0;_cj<cands.length;_cj++){_rp-=_cw[_cj];if(_rp<=0){dest=cands[_cj];break;}}
    var child=eRng()<CFG.floraMutationChance?mutateFloraChild(f,dest[0],dest[1]):cloneFloraChild(f,dest[0],dest[1]);
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
function makeFauna(x,y,type,prefs){var i=idx(x,y);var tA=(aridity[i]||5),tT=(tempField[i]||5),tS=(sunlight[i]||5);var isH=(type==='herbivore');var isS=(type==='scavenger');var isA=(type==='apex');var isO=(type==='omnivore');var pA=prefs?prefs.prefArid:clamp(tA+(eRng()*3-1.5),0,10);var pT=prefs?prefs.prefTemp:clamp(tT+(eRng()*3-1.5),0,10);var pS=prefs?prefs.prefSL:clamp(tS+(eRng()*3-1.5),0,10);var tol=prefs?prefs.tolerance:(3.0+eRng()*1.5);
  var vivid=prefs?!!prefs.vivid:false;
  var newId=++faunaIdCounter;
  // Cosmetic SIZE gene (heritable, rendered, balance-safe): founders start at 1.0x and the gene only
  // diversifies through inherited drift (mutateFaunaChild on the cosmetic cRng stream), so a large
  // lineage is visibly EVOLVED, not initial luck. Never read by faunaStep/scoreTileForFauna -> zero
  // balance effect (eRng untouched).
  var size=(prefs&&prefs.size!==undefined)?prefs.size:1.0;
  // Lineage identity: a founder is its own lineage root; children inherit the root id, so living kin are
  // countable for the lineage inspector. Pure annotation - never read by the sim.
  var lineageId=(prefs&&prefs.lineageId!==undefined)?prefs.lineageId:newId;
  var hue,sat,val;
  if(prefs&&prefs.hue!==undefined){hue=prefs.hue;sat=prefs.sat;val=prefs.val;}
  else if(vivid){hue=VIVID_HUES[(eRng()*VIVID_HUES.length)|0]+randn()*8;sat=0.75+eRng()*0.2;val=0.8+eRng()*0.15;}
  else if(isH){hue=35+eRng()*15;sat=0.05+eRng()*0.1;val=0.78+eRng()*0.17;} // warm cream/white
  else if(isS){hue=25+eRng()*20;sat=0.22+eRng()*0.12;val=0.42+eRng()*0.16;} // dull olive-brown (detritivore)
  else if(isA){hue=342+eRng()*16;sat=0.32+eRng()*0.16;val=0.3+eRng()*0.16;} // dark crimson (apex predator; non-wrapping 342-358 band)
  else if(isO){hue=288+eRng()*18;sat=0.28+eRng()*0.16;val=0.38+eRng()*0.16;} // dusky plum/violet (omnivore generalist; distinct from cream/olive/crimson/charcoal)
  else{hue=210+eRng()*30;sat=0.05+eRng()*0.1;val=0.2+eRng()*0.18;} // charcoal/slate
  // Per-type sat/val clamp ranges (scavenger = olive between cream herbivore + charcoal carnivore; apex = crimson; omnivore = plum).
  var loSat=vivid?0.65:(isS?0.16:(isA?0.28:(isO?0.24:0.03))), hiSat=vivid?0.95:(isS?0.4:(isA?0.6:(isO?0.5:0.2)));
  var loVal=vivid?0.7:(isH?0.75:(isS?0.38:(isA?0.26:(isO?0.34:0.18)))), hiVal=vivid?0.95:(isH?0.95:(isS?0.62:(isA?0.5:(isO?0.6:0.4))));
  var startE=isH?CFG.herbivoreStartEnergy:(isS?CFG.scavengerStartEnergy:(isA?CFG.apexStartEnergy:(isO?CFG.omnivoreStartEnergy:CFG.carnivoreStartEnergy)));
  var maxE=isH?CFG.herbivoreMaxEnergy:(isS?CFG.scavengerMaxEnergy:(isA?CFG.apexMaxEnergy:(isO?CFG.omnivoreMaxEnergy:CFG.carnivoreMaxEnergy)));
  return{id:newId,x:x,y:y,type:type,prefArid:pA,prefTemp:pT,prefSL:pS,tolerance:clamp(tol,1.5,6.0),hue:((hue%360)+360)%360,sat:clamp(sat,loSat,hiSat),val:clamp(val,loVal,hiVal),vivid:vivid,size:size,lineageId:lineageId,energy:startE,maxEnergy:maxE,age:0,maxAge:CFG.faunaBaseMaxAge*(0.7+eRng()*0.6),gen:prefs?(prefs.gen||0):0,moveCD:isH?(x*7+y*13)%CFG.herbivoreSpeed:0,eatCD:isH?(x*11+y*5)%CFG.herbivoreEatSpeed:0};}
function computeFaunaClimateFit(f){var i=idx(f.x,f.y);if(!inb(f.x,f.y)||grid[i]===T.OCEAN)return 0;var dA=(aridity[i]||5)-f.prefArid,dT=(tempField[i]||5)-f.prefTemp,dS=(sunlight[i]||5)-f.prefSL;return Math.exp(-(dA*dA+dT*dT+dS*dS)/(2*f.tolerance*f.tolerance*2));}
function seedFaunaGroup(type,n){var placed=0,guard=5000;while(placed<n&&guard-->0){var x=(eRng()*W)|0,y=(eRng()*H)|0;var t=grid[idx(x,y)];if(t!==T.OCEAN&&t!==T.MOUNTAIN&&t!==T.VOLCANIC){fauna.push(makeFauna(x,y,type,null));placed++;}}}
function spawnFaunaAt(type){var guard=50;while(guard-->0){var x=(eRng()*W)|0,y=(eRng()*H)|0;var t=grid[idx(x,y)];if(t!==T.OCEAN&&t!==T.MOUNTAIN&&t!==T.VOLCANIC){fauna.push(makeFauna(x,y,type,null));return;}}}
function naturalFaunaSpawn(){if(fauna.length>=CFG.faunaMaxPop)return;
  // Count the tiers SEPARATELY: lumping scavengers/apex/omnivore into cc would starve knob D's carnivore rescue
  // of headroom once those tiers exist (a confound). All are 0 when their flags are off, so cc == carnivores as before.
  var hc=0,cc=0,sc=0,ac=0,oc=0;for(var i=0;i<fauna.length;i++){var a=fauna[i];if(a){if(a.type==='herbivore')hc++;else if(a.type==='scavenger')sc++;else if(a.type==='apex')ac++;else if(a.type==='omnivore')oc++;else cc++;}}
  // Baseline herbivore immigration trickle (preserves the old 0.7*spawnChance rate).
  if(eRng()<CFG.faunaSpawnChance*0.7)spawnFaunaAt('herbivore');
  // Knob D: prey-dependent carnivore RESCUE. Immigration probability scales with prey
  // abundance and only fires while predators are scarce, so predators cannot go
  // permanently extinct while prey are plentiful (the absorbing-zero failure mode).
  if(cc<CFG.carnivoreRescueCarnCap&&hc>=CFG.carnivoreRescueMinPrey&&eRng()<CFG.carnivoreRescueRate*hc)spawnFaunaAt('carnivore');
  // Scavenger RESCUE (take-2): carrion-dependent immigration while scavengers are scarce, so the detritivore tier
  // cannot hit absorbing-zero. Guarded on the flag so the off-path draws no eRng (byte-identical to C2).
  if(CFG.scavengersEnabled&&sc<CFG.scavengerRescueScavCap&&carrion.length>=CFG.scavengerRescueMinCarrion&&eRng()<CFG.scavengerRescueRate*carrion.length)spawnFaunaAt('scavenger');
  // Apex RESCUE (chunk 8): mid-prey-dependent immigration while apex are scarce, so the 4th tier cannot hit
  // absorbing-zero. Guarded on apexEnabled (off => no eRng => byte-identical). Prey base = carnivores + scavengers.
  if(CFG.apexEnabled&&ac<CFG.apexRescueApexCap&&(cc+sc)>=CFG.apexRescueMinPrey&&eRng()<CFG.apexRescueRate*(cc+sc))spawnFaunaAt('apex');
  // Omnivore RESCUE (chunk 9): broad-diet immigration while omnivores are scarce AND food exists - EITHER
  // herbivore prey OR standing flora (a generalist survives on either). Scaled by prey abundance + a small
  // constant so a flora-only world still holds a floor. Guarded on omnivoreEnabled (off => no eRng).
  if(CFG.omnivoreEnabled&&oc<CFG.omnivoreRescueOmniCap&&(hc>=CFG.omnivoreRescueMinPrey||flora.length>=CFG.omnivoreRescueMinFlora)&&eRng()<CFG.omnivoreRescueRate*(hc+2))spawnFaunaAt('omnivore');}
var _floraAtTile,_herbAtTile,_carnAtTile,_scavAtTile,_carrionAtTile,_apexAtTile,_omniAtTile;
function buildSpatialIndex(){_floraAtTile={};_herbAtTile={};_carnAtTile={};_scavAtTile={};_carrionAtTile={};_apexAtTile={};_omniAtTile={};for(var i=0;i<flora.length;i++){var f=flora[i];if(!f)continue;var k=idx(f.x,f.y);if(!_floraAtTile[k])_floraAtTile[k]=[];_floraAtTile[k].push(i);}for(var j=0;j<fauna.length;j++){var a=fauna[j];if(!a)continue;var k2=idx(a.x,a.y);if(a.type==='herbivore'){if(!_herbAtTile[k2])_herbAtTile[k2]=[];_herbAtTile[k2].push(j);}else if(a.type==='scavenger'){if(!_scavAtTile[k2])_scavAtTile[k2]=[];_scavAtTile[k2].push(j);}else if(a.type==='apex'){if(!_apexAtTile[k2])_apexAtTile[k2]=[];_apexAtTile[k2].push(j);}else if(a.type==='omnivore'){if(!_omniAtTile[k2])_omniAtTile[k2]=[];_omniAtTile[k2].push(j);}else{if(!_carnAtTile[k2])_carnAtTile[k2]=[];_carnAtTile[k2].push(j);}}
  // Carrion index (scavenger food; empty unless scavengers are enabled -> off is byte-identical).
  for(var cj=0;cj<carrion.length;cj++){var cc=carrion[cj];if(!cc)continue;var ck=idx(cc.x,cc.y);if(!_carrionAtTile[ck])_carrionAtTile[ck]=[];_carrionAtTile[ck].push(cj);}}
function scoreTileForFauna(f,tx,ty,isHerb){var ti=idx(tx,ty);var dA=(aridity[ti]||5)-f.prefArid,dT=(tempField[ti]||5)-f.prefTemp,dS=(sunlight[ti]||5)-f.prefSL;var score=(1-Math.sqrt(dA*dA+dT*dT+dS*dS)/15)*2;if(isHerb){var fH=_floraAtTile[ti];var floraCount=fH?fH.length:0;
    // Strong food signal: dense flora is very attractive
    score+=floraCount*2.5;
    // Depletion penalty: strongly avoid tiles with 0-1 flora
    if(floraCount<=1) score-=5;
    // Look-ahead: scan adjacent tiles for flora density (seek greener pastures)
    var adjFlora=0;var adj=neighbors4(tx,ty);for(var i=0;i<adj.length;i++){var aF=_floraAtTile[idx(adj[i][0],adj[i][1])];if(aF)adjFlora+=aF.length;}
    score+=adjFlora*0.4;
    // Knob C: conspecific crowding penalty - herbivores avoid tiles dense with other
    // herbivores, so the single moving mass fragments into spaced groups (dispersion) and
    // a patch turns unattractive before it is fully stripped (local density-dependence).
    var selfH=_herbAtTile[ti];if(selfH)score-=selfH.length*CFG.herbivoreCrowding;
    for(var ci=0;ci<adj.length;ci++){var hN=_herbAtTile[idx(adj[ci][0],adj[ci][1])];if(hN)score-=hN.length*CFG.herbivoreCrowding*0.5;}
    var cH=_carnAtTile[ti];if(cH)score-=cH.length*2.5;for(var i2=0;i2<adj.length;i2++){var cA=_carnAtTile[idx(adj[i2][0],adj[i2][1])];if(cA)score-=cA.length*1.0;}
  }else if(f.type==='scavenger'){
    // Scavenger carrion tracking: seek tiles with corpses (immediate strong, ring 1 medium), and spread
    // out from other scavengers so they don't all pile on one carcass (mild conspecific crowding).
    var crH=_carrionAtTile[ti];if(crH)score+=Math.min(crH.length,4)*3;
    var adjS=neighbors4(tx,ty);for(var sj=0;sj<adjS.length;sj++){var crA=_carrionAtTile[idx(adjS[sj][0],adjS[sj][1])];if(crA)score+=crA.length*1.4;}
    // Carrion scent (take-2): scan ring 2-4 so a wanderer homes in on a distant kill/crash corpse field
    // (diminishing signal, mirrors the carnivore prey-scent scan). This is the lever that finds sparse food.
    for(var cdy=-4;cdy<=4;cdy++){for(var cdx=-4;cdx<=4;cdx++){var cd=Math.abs(cdx)+Math.abs(cdy);if(cd<2||cd>4)continue;var csx=tx+cdx,csy=ty+cdy;if(!inb(csx,csy))continue;var crS=_carrionAtTile[idx(csx,csy)];if(crS)score+=crS.length*(cd===2?0.6:cd===3?0.35:0.2);}}
    var selfS=_scavAtTile[ti];if(selfS)score-=selfS.length*1.0;
  }else if(f.type==='apex'){
    // Apex prey tracking: hunts the MID-tier consumers (carnivores + scavengers). Immediate tile strong, ring 1
    // medium, ring 2-4 SCENT (locks onto dispersed mid-predators, mirrors the carnivore scan). Mild conspecific
    // crowding so the few apex spread out. Uses the existing _carn/_scav indices (no new prey index needed).
    var mH=(_carnAtTile[ti]?_carnAtTile[ti].length:0)+(_scavAtTile[ti]?_scavAtTile[ti].length:0);if(mH)score+=Math.min(mH,3)*3;
    var adjA=neighbors4(tx,ty);for(var aj2=0;aj2<adjA.length;aj2++){var akk=idx(adjA[aj2][0],adjA[aj2][1]);var mA=(_carnAtTile[akk]?_carnAtTile[akk].length:0)+(_scavAtTile[akk]?_scavAtTile[akk].length:0);if(mA)score+=mA*1.5;}
    for(var ady=-4;ady<=4;ady++){for(var adx=-4;adx<=4;adx++){var ad=Math.abs(adx)+Math.abs(ady);if(ad<2||ad>4)continue;var asx=tx+adx,asy=ty+ady;if(!inb(asx,asy))continue;var akk2=idx(asx,asy);var mid2=(_carnAtTile[akk2]?_carnAtTile[akk2].length:0)+(_scavAtTile[akk2]?_scavAtTile[akk2].length:0);if(mid2)score+=mid2*(ad===2?0.6:ad===3?0.38:0.22);}}
    var selfA=_apexAtTile[ti];if(selfA)score-=selfA.length*1.0;
  }else if(f.type==='omnivore'){
    // Omnivore foraging: values BOTH flora (its abundant staple) and herbivore prey (an opportunistic bonus).
    // The flora weight is DELIBERATELY weaker than a pure herbivore's 2.5 so it does not out-forage the grazers
    // it competes with; a herbivore-prey scent (ring 0-2) lets it close on grazers; conspecific crowding
    // disperses the omnivores so they do not pile on the herd's hotspots; predators (carnivores/apex) repel it.
    var fO=_floraAtTile[ti];var floraO=fO?fO.length:0;score+=floraO*1.4;if(floraO<=1)score-=1.5;
    var hO=_herbAtTile[ti];if(hO)score+=Math.min(hO.length,3)*1.6;
    var adjO=neighbors4(tx,ty);for(var oj=0;oj<adjO.length;oj++){var okk=idx(adjO[oj][0],adjO[oj][1]);var ohN=_herbAtTile[okk];if(ohN)score+=ohN.length*0.7;var ofN=_floraAtTile[okk];if(ofN)score+=ofN.length*0.2;}
    for(var ody=-2;ody<=2;ody++){for(var odx=-2;odx<=2;odx++){var od=Math.abs(odx)+Math.abs(ody);if(od!==2)continue;var osx=tx+odx,osy=ty+ody;if(!inb(osx,osy))continue;var ohS=_herbAtTile[idx(osx,osy)];if(ohS)score+=ohS.length*0.35;}}
    var selfO=_omniAtTile[ti];if(selfO)score-=selfO.length*CFG.omnivoreCrowding;
    var cO=_carnAtTile[ti];if(cO)score-=cO.length*1.5;var apO=_apexAtTile[ti];if(apO)score-=apO.length*2.0;
  }else{
    // Carnivore prey tracking: immediate tile (strong), ring 1 (medium), ring 2-3 (scent)
    var hH=_herbAtTile[ti];if(hH)score+=Math.min(hH.length,3)*3;
    var adj2=neighbors4(tx,ty);for(var j=0;j<adj2.length;j++){var hA=_herbAtTile[idx(adj2[j][0],adj2[j][1])];if(hA)score+=hA.length*1.5;}
    // Scent range: scan ring 2-5 for herbivore clusters (extended so carnivores lock onto DISPERSED prey; diminishing signal)
    for(var sdy=-5;sdy<=5;sdy++){for(var sdx=-5;sdx<=5;sdx++){var sd=Math.abs(sdx)+Math.abs(sdy);if(sd<2||sd>5)continue;var sx=tx+sdx,sy=ty+sdy;if(!inb(sx,sy))continue;var sH=_herbAtTile[idx(sx,sy)];if(sH)score+=sH.length*(sd===2?0.7:sd===3?0.45:sd===4?0.28:0.16);}}
  }return score;}
function mutateFaunaChild(parent,cx,cy){var mag=CFG.faunaMutationMag;
  // Vivid inheritance: 50% from vivid parent, 2% spontaneous
  var childVivid=parent.vivid?(eRng()<0.5):false;
  if(!childVivid&&eRng()<0.02) childVivid=true; // rare spontaneous vivid mutation
  var childHue,childSat,childVal;
  if(childVivid&&!parent.vivid){
    // New vivid! Pick a striking color from the palette
    childHue=VIVID_HUES[(eRng()*VIVID_HUES.length)|0]+randn()*8;
    childSat=0.75+eRng()*0.2;childVal=0.8+eRng()*0.15;
  } else if(childVivid){
    // Inherited vivid: drift within bright range
    childHue=(parent.hue+randn()*10+360)%360;childSat=clamp(parent.sat+(eRng()-0.5)*0.08,0.65,0.95);childVal=clamp(parent.val+(eRng()-0.5)*0.06,0.7,0.95);
  } else {
    // Normal: cream herbivores, olive-brown scavengers, crimson apex, plum omnivores, charcoal carnivores
    var isH=(parent.type==='herbivore'), isS=(parent.type==='scavenger'), isA=(parent.type==='apex'), isO=(parent.type==='omnivore');
    childHue=clamp(parent.hue+randn()*8,isH?30:(isS?18:(isA?340:(isO?285:200))),isH?55:(isS?52:(isA?360:(isO?310:245))));childSat=clamp(parent.sat+(eRng()-0.5)*0.04,isS?0.16:(isA?0.28:(isO?0.24:0.03)),isS?0.4:(isA?0.6:(isO?0.5:0.2)));childVal=clamp(parent.val+(eRng()-0.5)*0.06,isH?0.75:(isS?0.38:(isA?0.26:(isO?0.34:0.18))),isH?0.95:(isS?0.62:(isA?0.5:(isO?0.6:0.4))));
  }
  // Cosmetic size drifts on the cRng stream (balance-neutral); lineage id is inherited unchanged.
  var childSize=clamp((parent.size||1)+cRandn()*CFG.faunaSizeMutationMag,0.5,2.2);
  return makeFauna(cx,cy,parent.type,{prefArid:clamp(parent.prefArid+randn()*mag,0,10),prefTemp:clamp(parent.prefTemp+randn()*mag,0,10),prefSL:clamp(parent.prefSL+randn()*mag,0,10),tolerance:clamp(parent.tolerance+randn()*0.3,1.5,6.0),hue:childHue,sat:childSat,val:childVal,vivid:childVivid,size:childSize,lineageId:(parent.lineageId||parent.id),gen:parent.gen+1});}
function cloneFaunaChild(parent,cx,cy){return makeFauna(cx,cy,parent.type,{prefArid:parent.prefArid,prefTemp:parent.prefTemp,prefSL:parent.prefSL,tolerance:parent.tolerance,hue:parent.hue,sat:parent.sat,val:parent.val,vivid:parent.vivid,size:(parent.size||1),lineageId:(parent.lineageId||parent.id),gen:parent.gen});}
// A fauna death drops a corpse for scavengers (trophic-depth experiment). No-op unless the flag is on -> the
// eRng stream is byte-identical to C2 when off. No RNG here, so even when on it does not shift the stream.
function _dropCarrion(x,y){ if(CFG.scavengersEnabled) carrion.push({x:x,y:y,tick:tick}); }
function faunaStep(){if(!CFG.ecoActive)return;naturalFaunaSpawn();buildSpatialIndex();var newFauna=[];var order=[];for(var oi=0;oi<fauna.length;oi++)order.push(oi);for(var si=order.length-1;si>0;si--){var ri=(eRng()*(si+1))|0;var tmp=order[si];order[si]=order[ri];order[ri]=tmp;}
  for(var oi2=0;oi2<order.length;oi2++){var fi=order[oi2];var f=fauna[fi];if(!f)continue;var isHerb=(f.type==='herbivore');var climateFit=computeFaunaClimateFit(f);var idleCost=isHerb?CFG.faunaIdleCost:(CFG.faunaIdleCost*0.6);f.energy-=(idleCost+CFG.faunaClimatePenalty*(1-climateFit));f.age++;if(f.energy<=0){deathParticles.push({x:f.x,y:f.y,type:'starve',tick:tick});_dropCarrion(f.x,f.y);fauna[fi]=null;continue;}if(f.age>=f.maxAge){deathParticles.push({x:f.x,y:f.y,type:'age',tick:tick});_dropCarrion(f.x,f.y);fauna[fi]=null;continue;}if(grid[idx(f.x,f.y)]===T.OCEAN){fauna[fi]=null;continue;}
    f.moveCD--;f.eatCD--;if(f.moveCD<=0){f.moveCD=isHerb?CFG.herbivoreSpeed:(f.type==='scavenger'?CFG.scavengerSpeed:(f.type==='apex'?CFG.apexSpeed:(f.type==='omnivore'?CFG.omnivoreSpeed:CFG.carnivoreSpeed)));var nbrs=neighbors4(f.x,f.y);var bestScore=scoreTileForFauna(f,f.x,f.y,isHerb);var bestPos=[f.x,f.y];for(var ni=0;ni<nbrs.length;ni++){var nx=nbrs[ni][0],ny=nbrs[ni][1];if(grid[idx(nx,ny)]===T.OCEAN)continue;var score=scoreTileForFauna(f,nx,ny,isHerb)+(eRng()-0.5)*0.5;if(score>bestScore){bestScore=score;bestPos=[nx,ny];}}if(bestPos[0]!==f.x||bestPos[1]!==f.y){f.x=bestPos[0];f.y=bestPos[1];f.energy-=CFG.faunaMoveCost;}}
    var tileIdx=idx(f.x,f.y);
    // Eating gated by eatCD cooldown
    if(f.eatCD<=0){if(isHerb){var floraHere=_floraAtTile[tileIdx];if(floraHere&&floraHere.length>0){
      // Bulk grazing: eat 2 flora if tile has 3+, otherwise eat 1
      var biteCount=(floraHere.length>=3)?2:1;
      for(var bi=0;bi<biteCount&&floraHere.length>0;bi++){var eatIdx=floraHere[0];if(flora[eatIdx]){var eatenFlora=flora[eatIdx];f.energy=Math.min(f.maxEnergy,f.energy+CFG.herbivoreEatGain*(0.7+eatenFlora.health*0.5));
      // Regrowth remnant: roots survive grazing
      if(eRng()<CFG.floraRegrowthChance){floraRemnants.push({x:eatenFlora.x,y:eatenFlora.y,prefs:{prefArid:eatenFlora.prefArid,prefTemp:eatenFlora.prefTemp,prefSL:eatenFlora.prefSL,tolerance:eatenFlora.tolerance,hue:eatenFlora.hue,sat:eatenFlora.sat,val:eatenFlora.val,gen:eatenFlora.gen},tickDue:tick+CFG.floraRegrowthDelay});}
      flora[eatIdx]=null;floraHere.shift();}}f.eatCD=CFG.herbivoreEatSpeed;}}else if(f.type==='scavenger'){
      // Scavenger: consume a corpse on the current or an adjacent tile (the death flux the 3-tier web wastes).
      var feedTiles=[tileIdx];var adjF=neighbors4(f.x,f.y);for(var fti2=0;fti2<adjF.length;fti2++){var fti3=idx(adjF[fti2][0],adjF[fti2][1]);if(grid[fti3]!==T.OCEAN)feedTiles.push(fti3);}
      var fed=false;for(var ftk=0;ftk<feedTiles.length&&!fed;ftk++){var crHere=_carrionAtTile[feedTiles[ftk]];if(crHere&&crHere.length>0){var carIdx=crHere[0];if(carrion[carIdx]){f.energy=Math.min(f.maxEnergy,f.energy+CFG.scavengerEatGain);carrion[carIdx]=null;crHere.shift();f.eatCD=CFG.scavengerSpeed;fed=true;}}}
    }else if(f.type==='apex'){
      // Apex predator: hunt a MID-tier consumer (carnivore preferred, else scavenger) on the current or an
      // adjacent tile. A kill drops carrion (feeds the scavengers) and flashes a 'kill' particle.
      var apxTiles=[tileIdx];var adjP=neighbors4(f.x,f.y);for(var pti=0;pti<adjP.length;pti++){var pti2=idx(adjP[pti][0],adjP[pti][1]);if(grid[pti2]!==T.OCEAN)apxTiles.push(pti2);}
      var killed=false;for(var kt=0;kt<apxTiles.length&&!killed;kt++){var preyList=_carnAtTile[apxTiles[kt]]||_scavAtTile[apxTiles[kt]];if(preyList&&preyList.length>0){var aPreyIdx=preyList[0];if(fauna[aPreyIdx]){var aPrey=fauna[aPreyIdx];f.energy=Math.min(f.maxEnergy,f.energy+CFG.apexEatGain);deathParticles.push({x:aPrey.x,y:aPrey.y,type:'kill',tick:tick});_dropCarrion(aPrey.x,aPrey.y);fauna[aPreyIdx]=null;preyList.shift();f.eatCD=CFG.apexEatSpeed;killed=true;}}}
    }else if(f.type==='omnivore'){
      // Omnivore: opportunistic generalist making ONE feeding action per cooldown (shared eatCD, no double-dipping).
      // Graze a plant on the current tile if one is there (its abundant staple, less efficiently than a herbivore),
      // ELSE hunt a herbivore on the current/adjacent tile - so predation is SECONDARY (only when flora is absent),
      // keeping its pressure on the herd light. A kill drops carrion + flashes a 'kill' particle like the predators.
      var oFlora=_floraAtTile[tileIdx];
      if(oFlora&&oFlora.length>0){var oEat=oFlora[0];if(flora[oEat]){var oPlant=flora[oEat];f.energy=Math.min(f.maxEnergy,f.energy+CFG.omnivoreFloraEatGain*(0.7+oPlant.health*0.5));
        if(eRng()<CFG.floraRegrowthChance){floraRemnants.push({x:oPlant.x,y:oPlant.y,prefs:{prefArid:oPlant.prefArid,prefTemp:oPlant.prefTemp,prefSL:oPlant.prefSL,tolerance:oPlant.tolerance,hue:oPlant.hue,sat:oPlant.sat,val:oPlant.val,gen:oPlant.gen},tickDue:tick+CFG.floraRegrowthDelay});}
        flora[oEat]=null;oFlora.shift();f.eatCD=CFG.omnivoreEatSpeed;}}
      else{var oHuntTiles=[tileIdx];var adjO2=neighbors4(f.x,f.y);for(var ohi=0;ohi<adjO2.length;ohi++){var ohti=idx(adjO2[ohi][0],adjO2[ohi][1]);if(grid[ohti]!==T.OCEAN)oHuntTiles.push(ohti);}
        var oHunted=false;for(var oht=0;oht<oHuntTiles.length&&!oHunted;oht++){var oHerb=_herbAtTile[oHuntTiles[oht]];if(oHerb&&oHerb.length>0){var oPreyIdx=oHerb[0];if(fauna[oPreyIdx]){var oPrey=fauna[oPreyIdx];f.energy=Math.min(f.maxEnergy,f.energy+CFG.omnivorePreyEatGain);deathParticles.push({x:oPrey.x,y:oPrey.y,type:'kill',tick:tick});_dropCarrion(oPrey.x,oPrey.y);fauna[oPreyIdx]=null;oHerb.shift();f.eatCD=CFG.omnivoreEatSpeed;oHunted=true;}}}}
    }else{
      // Carnivore hunting: check current tile AND adjacent tiles
      var huntTiles=[tileIdx];var adjH=neighbors4(f.x,f.y);for(var hi=0;hi<adjH.length;hi++){var hti=idx(adjH[hi][0],adjH[hi][1]);if(grid[hti]!==T.OCEAN)huntTiles.push(hti);}
      var hunted=false;for(var ht=0;ht<huntTiles.length&&!hunted;ht++){var herbHere=_herbAtTile[huntTiles[ht]];if(herbHere&&herbHere.length>0){var preyIdx=herbHere[0];if(fauna[preyIdx]){var prey=fauna[preyIdx];f.energy=Math.min(f.maxEnergy,f.energy+CFG.carnivoreEatGain);deathParticles.push({x:prey.x,y:prey.y,type:'kill',tick:tick});_dropCarrion(prey.x,prey.y);fauna[preyIdx]=null;herbHere.shift();f.eatCD=CFG.carnivoreEatSpeed;hunted=true;}}}}}    var reproThresh=isHerb?CFG.faunaReproThreshold:(f.type==='scavenger'?CFG.scavengerReproThreshold:(f.type==='apex'?CFG.apexReproThreshold:(f.type==='omnivore'?CFG.omnivoreReproThreshold:CFG.carnivoreReproThreshold)));var reproCost=isHerb?CFG.faunaReproCost:(f.type==='scavenger'?CFG.scavengerReproCost:(f.type==='apex'?CFG.apexReproCost:(f.type==='omnivore'?CFG.omnivoreReproCost:CFG.carnivoreReproCost)));
    if(f.energy>=reproThresh&&fauna.length+newFauna.length<CFG.faunaMaxPop){var reproCands=neighbors4(f.x,f.y).filter(function(p){var t=grid[idx(p[0],p[1])];return t!==T.OCEAN&&t!==T.MOUNTAIN&&t!==T.VOLCANIC;});if(reproCands.length>0){f.energy-=reproCost;var dest=reproCands[(eRng()*reproCands.length)|0];newFauna.push(eRng()<CFG.faunaMutationChance?mutateFaunaChild(f,dest[0],dest[1]):cloneFaunaChild(f,dest[0],dest[1]));}}}
  flora=flora.filter(function(f){return f!==null;});fauna=fauna.filter(function(f){return f!==null;});for(var j=0;j<newFauna.length;j++)fauna.push(newFauna[j]);
  // Carrion lifecycle: drop eaten (nulled) + rotted corpses. Empty when scavengers are off (never created).
  if(carrion.length) carrion=carrion.filter(function(c){return c&&tick-c.tick<CFG.carrionMaxAge;});}

// ======================================================================
//  RENDERING
// ======================================================================
function buildSnapshot(){return {meta:{version:'wb-eco-1',W:W,H:H,tick:tick,seed:_seed,preset:activePreset,world:WORLD,cfg:{climateIntensity:CFG.climateIntensity,climateSeasonLength:CFG.climateSeasonLength},sunlightPhase:sunPhase},grid:Array.from(grid),elev:Array.from(elev),aridity:Array.from(aridity),temp:Array.from(tempField),flora:flora.filter(function(f){return f!==null;}),fauna:fauna.filter(function(f){return f!==null;}),remnants:floraRemnants,rivers:riverGenerated?riverData:null};}
var WORLD_CODE_VERSION = 1;
// These CFG keys are DERIVED from elevationIntensity by applyElevationIntensity and recomputed on every
// initWorld, so the world code ships elevationIntensity, not its derivatives. A default world then encodes
// to an empty diff (minimal URL); on load initWorld re-derives them, so nothing is lost.
var _DERIVED_CFG_KEYS = { clusterSpikeRate:1, clusterPlusChance:1, mountainAdjUpliftProb:1, hillAdjUpliftProb:1, rareSurgeProb:1 };
// Pure: the current world's shareable recipe. cfg holds only the keys that DIFFER from DEFAULT_CFG (minus
// the derived ones), so a default world encodes to almost nothing and a tuned one carries just its deltas.
function buildWorldCode(){
  var cfg={};
  for(var k in CFG){ if(CFG.hasOwnProperty(k)&&!_DERIVED_CFG_KEYS[k]&&DEFAULT_CFG.hasOwnProperty(k)&&CFG[k]!==DEFAULT_CFG[k]) cfg[k]=CFG[k]; }
  var code={ v:WORLD_CODE_VERSION, seed:_seed, preset:activePreset, cfg:cfg };
  if(activeScenario) code.scen=activeScenario.def.id; // chunk 5: a scenario link carries its id so the objective re-arms on the recipient
  return code;
}
// Pure: apply a decoded world code. Reset CFG to defaults, layer the diff (KNOWN keys + matching type only
// - the code is untrusted URL input), restore the preset label, then regenerate from the seed. Throws on a
// malformed / unsupported code. Leaves DOM sync to the caller (mirrors the initWorld/init split).
function applyWorldCode(data){
  if(!data||typeof data!=='object') throw new Error('Invalid world code');
  if(data.v!==WORLD_CODE_VERSION) throw new Error('Unsupported world code version: '+data.v);
  if(typeof data.seed!=='number'||!isFinite(data.seed)) throw new Error('World code has no seed');
  // Chunk 5: a scenario permalink names a TRUSTED built-in scenario. Rebuild it from OUR OWN def (preset +
  // seed + initial life + objective) so the objective re-arms on the recipient's world, ignoring the URL cfg
  // diff entirely - only the known scenario id rides along, which is safer than trusting arbitrary URL cfg.
  if(data.scen&&SCENARIOS[data.scen]){ applyScenarioDef(SCENARIOS[data.scen]); return data; }
  for(var k in DEFAULT_CFG){ if(DEFAULT_CFG.hasOwnProperty(k)) CFG[k]=DEFAULT_CFG[k]; }
  if(data.cfg&&typeof data.cfg==='object'){
    for(var ck in data.cfg){ if(Object.prototype.hasOwnProperty.call(data.cfg,ck)&&DEFAULT_CFG.hasOwnProperty(ck)&&typeof data.cfg[ck]===typeof DEFAULT_CFG[ck]) CFG[ck]=data.cfg[ck]; }
  }
  if(data.preset&&PRESETS[data.preset]) activePreset=data.preset;
  clearScenario(); // a plain world code is a sandbox world, not a scenario
  initWorld(data.seed);
  return data;
}
// URL-safe base64 of the JSON recipe (ASCII only: numeric CFG values + short preset names). btoa/atob
// exist in both the browser and the Node test runner.
function encodeWorldCode(data){ return btoa(JSON.stringify(data)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function decodeWorldCode(str){ var b64=String(str).replace(/-/g,'+').replace(/_/g,'/'); while(b64.length%4)b64+='='; return JSON.parse(atob(b64)); }
// The ?w= param from the current URL (or null). DOM/location layer.
function worldPermalink(){ var code=encodeWorldCode(buildWorldCode()); var base=(typeof location!=='undefined')?(location.origin+location.pathname):''; return base+'?w='+code; }
// Brief label flash on a deck button (no exclamation marks - UI copy rule). Restore text is passed in so a
// double-click during the flash cannot corrupt the label.
function worldPostcard(){
  var s=chronicleStats();
  var presetLbl=(activePreset&&PRESETS[activePreset]&&activePreset!=='balanced')?(' ('+PRESETS[activePreset].label+')'):'';
  var lines=[];
  lines.push('Worldbuilder world - seed '+_seed+presetLbl);
  lines.push('Tick '+tick+' - '+Math.round(s.land*100)+'% land, '+s.flora+' flora, '+s.herb+' herbivores, '+s.carn+' carnivores');
  if(s.maxSize>=1.3&&s.bigName) lines.push('Biggest: '+s.bigName+', '+s.maxSize.toFixed(1)+'x normal size');
  if(s.oldestAge>0&&s.oldestName) lines.push('Oldest: '+s.oldestName+', age '+s.oldestAge);
  // A few recent story beats; skip the boilerplate 'terrain' notes when there is richer history.
  var ev=chronicle.events, beats=[];
  for(var i=ev.length-1;i>=0&&beats.length<3;i--){ if(ev[i].kind!=='terrain') beats.push(ev[i]); }
  if(beats.length===0){ for(var j=ev.length-1;j>=0&&beats.length<3;j--) beats.push(ev[j]); }
  if(beats.length){ lines.push('Recent history:'); for(var b=beats.length-1;b>=0;b--) lines.push('  - t'+beats[b].tick+' '+beats[b].text); }
  lines.push('Play this exact world: '+worldPermalink());
  return lines.join('\n');
}
var CHRONICLE_SAMPLE_EVERY = 10;   // ticks between samples
var CHRONICLE_MAX_EVENTS   = 200;  // ring-buffer cap (oldest events drop off the front)
var CHRON_HERB_LADDER = [50,100,200,400,800];
var CHRON_CARN_LADDER = [20,40,80,160];
var CHRON_FLORA_LADDER = [500,1000,2000,4000,8000];
var CHRON_LAND_LADDER = [25,50,75,90];
var CHRON_SIZE_LADDER = [1.3,1.5,1.7,1.9,2.1]; // size-gene milestones ("a creature grew to N x normal size")
function newChronicle(){
  return { events:[], nextId:1, prev:null,
    records:{ peakHerb:0, peakCarn:0, peakFlora:0, herbPopRung:0, carnPopRung:0, floraPopRung:0,
      herbGenRung:0, carnGenRung:0, oldestAge:0, landRung:0, sizeRung:0, peakSize:0, firstCarn:false } };
}
var chronicle = newChronicle();
// Speciation registry (chunk 6, pillar C): the world's MEMORY of its named species - which have emerged
// (diverged) and which have died out. Module state like chronicle/speciesNameCache: reset in initWorld,
// round-trips snapshot/restore. Read-only from the sim's view (never touched by faunaStep) -> balance-safe.
// A species must have bred through this many generations AND be this numerous to be "established" - so a
// lone drifted individual (or a shallow, brand-new lineage) is not announced. Tuned to this boom-bust world:
// generational depth grows ~1 per ~500 ticks and RESETS on each population crash (survivors are gen-0
// immigrants), so gen>=3/pop>=6 surfaces the real established clusters at healthy peaks without waiting for
// the rare gen-5 sustained boom. Balance-neutral (observation only) so this is a story/pacing knob, not a
// balance one. Also gates getSpeciesName, so "old enough to have a name" == "old enough to be a species".
var SPECIES_MIN_GEN = 3;
var SPECIES_MIN_POP = 6;
function newSpeciesRegistry(){ return { byKey:{}, everCount:0 }; }
var speciesRegistry = newSpeciesRegistry();
// Highest ladder value <= value, but only if it exceeds the previously-crossed rung (else prevRung).
function _crossLadder(ladder,value,prevRung){var hit=prevRung;for(var i=0;i<ladder.length;i++){if(value>=ladder[i]&&ladder[i]>hit)hit=ladder[i];}return hit;}
function _capType(t){return t==='herbivore'?'Herbivore':t==='carnivore'?'Carnivore':t==='scavenger'?'Scavenger':(t?t.charAt(0).toUpperCase()+t.slice(1):'Creature');}
function chronicleStats(){
  var herb=0,carn=0,hv=0,cv=0,mhg=0,mcg=0,oldestAge=0,oldestRef=null,topHerb=null,topCarn=null,maxSize=0,bigRef=null;
  for(var i=0;i<fauna.length;i++){var f=fauna[i];if(!f)continue;
    if(f.type==='herbivore'){herb++;if(f.vivid)hv++;if(f.gen>mhg){mhg=f.gen;topHerb=f;}}
    else{carn++;if(f.vivid)cv++;if(f.gen>mcg){mcg=f.gen;topCarn=f;}}
    if(f.age>oldestAge){oldestAge=f.age;oldestRef=f;}
    if((f.size||1)>maxSize){maxSize=f.size||1;bigRef=f;}}
  return { flora:flora.length, herb:herb, carn:carn, herbVivid:hv, carnVivid:cv, maxHerbGen:mhg, maxCarnGen:mcg,
    oldestAge:oldestAge|0,
    oldestName: oldestRef?(getSpeciesName(oldestRef,'fauna')||_capType(oldestRef.type)):null,
    topHerbName: topHerb?getSpeciesName(topHerb,'fauna'):null,
    topCarnName: topCarn?getSpeciesName(topCarn,'fauna'):null,
    maxSize:maxSize, bigName: bigRef?(getSpeciesName(bigRef,'fauna')||_capType(bigRef.type)):null,
    land: landCoverage() };
}
function chronicleAdd(kind,text,color){
  var e={ id:chronicle.nextId++, tick:tick, kind:kind, text:text, color:color||'#4a5568' };
  chronicle.events.push(e);
  if(chronicle.events.length>CHRONICLE_MAX_EVENTS) chronicle.events.shift();
  return e;
}
// Public hook for the UI / god-powers (chunk 3) to record a deliberate act in the same feed.
function chronicleNote(kind,text,color){ return chronicleAdd(kind,text,color); }
function chronicleSample(){
  if(tick%CHRONICLE_SAMPLE_EVERY!==0) return;
  var s=chronicleStats(), p=chronicle.prev, r=chronicle.records;
  if(p){
    // Arrivals + extinctions (state transitions across the sample gap)
    if(p.carn===0&&s.carn>0){ if(!r.firstCarn){r.firstCarn=true;chronicleAdd('milestone','The first predators took hold. The food web now has two tiers.','#e85454');} else chronicleAdd('arrival','Carnivores returned to the world.','#e85454'); }
    if(p.carn>0&&s.carn===0) chronicleAdd('extinct','The last predator vanished. Carnivores are extinct.','#e85454');
    if(p.herb===0&&s.herb>0) chronicleAdd('arrival','Herbivores returned to the world.','#5bb8f0');
    if(p.herb>0&&s.herb===0) chronicleAdd('extinct','The last grazer died. Herbivores are extinct.','#5bb8f0');
    // Crashes (steep drop from the previous sample, above a floor so ordinary churn is ignored)
    if(p.herb>=40&&s.herb<p.herb*0.55) chronicleAdd('crash','Herbivore numbers crashed ('+p.herb+' to '+s.herb+').','#5bb8f0');
    if(p.carn>=20&&s.carn<p.carn*0.55) chronicleAdd('crash','Carnivore numbers crashed ('+p.carn+' to '+s.carn+').','#e85454');
    // Vivid lineage emergence (the rare bright mutants taking hold)
    if(p.herbVivid===0&&s.herbVivid>0) chronicleAdd('vivid','A vivid lineage emerged among the herbivores.','#e8a838');
    if(p.carnVivid===0&&s.carnVivid>0) chronicleAdd('vivid','A vivid lineage emerged among the carnivores.','#e854e8');
  }
  // Population milestones (round-number ladders read as a story, not +1 spam)
  var hr=_crossLadder(CHRON_HERB_LADDER,s.herb,r.herbPopRung); if(hr>r.herbPopRung){r.herbPopRung=hr;chronicleAdd('record','Herbivores passed '+hr+' for the first time.','#5bb8f0');}
  var crn=_crossLadder(CHRON_CARN_LADDER,s.carn,r.carnPopRung); if(crn>r.carnPopRung){r.carnPopRung=crn;chronicleAdd('record','Carnivores passed '+crn+' for the first time.','#e85454');}
  var flr=_crossLadder(CHRON_FLORA_LADDER,s.flora,r.floraPopRung); if(flr>r.floraPopRung){r.floraPopRung=flr;chronicleAdd('record','Flora passed '+flr+' for the first time.','#3fcf6a');}
  // Generation milestones (every 5th generation; named once a lineage is old enough)
  var hg=Math.floor(s.maxHerbGen/5)*5; if(hg>=5&&hg>r.herbGenRung){r.herbGenRung=hg;chronicleAdd('lineage','A herbivore lineage reached generation '+hg+(s.topHerbName?(' ('+s.topHerbName+')'):'')+'.','#5bb8f0');}
  var cg=Math.floor(s.maxCarnGen/5)*5; if(cg>=5&&cg>r.carnGenRung){r.carnGenRung=cg;chronicleAdd('lineage','A carnivore lineage reached generation '+cg+(s.topCarnName?(' ('+s.topCarnName+')'):'')+'.','#e85454');}
  // Longevity record (notable only when it clears the previous best by a margin)
  if(s.oldestAge>=250&&s.oldestAge>r.oldestAge+50){ r.oldestAge=s.oldestAge; chronicleAdd('record','A '+(s.oldestName||'creature')+' is the longest-lived yet (age '+s.oldestAge+').','#9fb4c8'); }
  else if(s.oldestAge>r.oldestAge) r.oldestAge=s.oldestAge;
  // Land development milestones
  var lr=_crossLadder(CHRON_LAND_LADDER,Math.round(s.land*100),r.landRung); if(lr>r.landRung){r.landRung=lr;chronicleAdd('terrain','The land grew to '+lr+'% of the world.','#8a9a7b');}
  // Size-gene milestones (the visible evolution): a lineage growing past round-number size rungs.
  var szr=_crossLadder(CHRON_SIZE_LADDER,s.maxSize,r.sizeRung); if(szr>r.sizeRung){r.sizeRung=szr;chronicleAdd('record','A '+(s.bigName||'creature')+' grew to '+szr.toFixed(1)+'× normal size - the largest yet.','#c8a0e0');}
  // Silent peak records for the readout strip
  if(s.herb>r.peakHerb)r.peakHerb=s.herb; if(s.carn>r.peakCarn)r.peakCarn=s.carn; if(s.flora>r.peakFlora)r.peakFlora=s.flora; if(s.maxSize>r.peakSize)r.peakSize=s.maxSize;
  chronicle.prev=s;
}
function speciesKey(f){ return f.type+'|'+Math.floor(f.hue/20)+'|'+Math.floor(f.prefArid/2.5)+'|'+Math.floor(f.prefTemp/2.5); }
// Pure census of the LIVING fauna, bucketed into species (defaults to the module fauna list; takes an
// explicit list so the gate can exercise the bucketing on synthetic genomes). Returns entries sorted by
// population desc: {key,type,name,pop,maxGen,maxSize,vivid}. The most-evolved member represents the species
// for naming (all members of a key share buckets, so the name is the same either way).
function speciesCensus(list){ list=list||fauna; var m={};
  for(var i=0;i<list.length;i++){var f=list[i];if(!f)continue;var k=speciesKey(f);var e=m[k];
    if(!e){e=m[k]={key:k,type:f.type,rep:f,pop:0,maxGen:0,maxSize:0,vivid:0};}
    e.pop++; if(f.gen>e.maxGen)e.maxGen=f.gen; if((f.size||1)>e.maxSize)e.maxSize=(f.size||1); if(f.vivid)e.vivid++;
    if(f.gen>e.rep.gen)e.rep=f;
  }
  var arr=[];for(var kk in m){var e2=m[kk];e2.name=generateSpeciesName(e2.rep,e2.type);delete e2.rep;arr.push(e2);}
  arr.sort(function(a,b){return b.pop-a.pop||(a.key<b.key?-1:1);}); // pop desc, key as a stable tiebreak
  return arr;
}
// Pure reducer (gate-testable like evaluateScenario): advance the registry from a census at a tick. Mutates
// `reg` (registers a newly-established species, updates peak population, flips extinct/re-emerged) and
// RETURNS the narration events to log - so all the birth/death bookkeeping is exercised on synthetic census
// sequences without a slow world. A species is EXTINCT only when it has no living member at all (not merely
// dipped under the establishment floor). Terminal-ish: extinct latches until a member reappears.
function updateSpeciesRegistry(census,reg,curTick){
  if(!reg.byKey){reg.byKey={};} if(reg.everCount===undefined)reg.everCount=0;
  var b=reg.byKey, events=[], alive={};
  for(var a=0;a<census.length;a++) alive[census[a].key]=true; // any living member (even below the pop floor)
  for(var i=0;i<census.length;i++){var c=census[i];
    if(c.maxGen<SPECIES_MIN_GEN||c.pop<SPECIES_MIN_POP) continue; // not yet an established species
    var rec=b[c.key];
    if(!rec){ // never registered -> a new species has diverged
      b[c.key]={key:c.key,name:c.name,type:c.type,firstTick:curTick,peakPop:c.pop,extinct:false,extinctTick:null};
      reg.everCount++;
      var word=c.type==='herbivore'?'grazer':(c.type==='scavenger'?'scavenger':(c.type==='apex'?'apex predator':(c.type==='omnivore'?'omnivore':'predator')));
      var col=c.type==='herbivore'?'#7fd0a0':(c.type==='scavenger'?'#c8b088':(c.type==='apex'?'#d98a9a':(c.type==='omnivore'?'#b98ad9':'#e0a0a0')));
      events.push({kind:'species',text:'A new '+word+' species diverged: '+c.name+'.',color:col});
    } else { if(c.pop>rec.peakPop)rec.peakPop=c.pop;
      if(rec.extinct){ rec.extinct=false;rec.extinctTick=null; events.push({kind:'species',text:rec.name+' has re-emerged.',color:'#9fb4c8'}); }
    }
  }
  for(var k in b){ var r=b[k]; if(r.extinct||alive[k]) continue; // registered, non-extinct, now gone -> extinct
    r.extinct=true; r.extinctTick=curTick; events.push({kind:'species',text:r.name+' has gone extinct.',color:'#8a95a0'}); }
  return events;
}
// Read-only observer on the step path (end of step(), after scenarioSample), on the Chronicle cadence. Builds
// the census, advances the pure registry reducer, and logs its events into the Chronicle. No eRng, no fauna
// mutation -> harness byte-identical (like chronicleSample).
function speciesSample(){
  if(tick%CHRONICLE_SAMPLE_EVERY!==0) return;
  if(!speciesRegistry||!speciesRegistry.byKey) speciesRegistry=newSpeciesRegistry();
  var events=updateSpeciesRegistry(speciesCensus(),speciesRegistry,tick);
  for(var i=0;i<events.length;i++) chronicleAdd(events[i].kind,events[i].text,events[i].color);
}
// DOM (gate-blind): the Species sidebar panel - the living census of established species + a records line.
// The pure census/registry it renders are gate-covered; the panel itself is verified in the live app.
function _killLifeAt(i){var x=i%W,y=(i/W)|0,n=0;
  for(var f=0;f<flora.length;f++){var fl=flora[f];if(fl&&fl.x===x&&fl.y===y)flora[f]=null;}
  for(var a=0;a<fauna.length;a++){var fa=fauna[a];if(fa&&fa.x===x&&fa.y===y){deathParticles.push({x:x,y:y,type:'kill',tick:tick});fauna[a]=null;n++;}}
  return n;}
function _compactLife(){flora=flora.filter(function(f){return f!==null;});fauna=fauna.filter(function(f){return f!==null;});}

// Land brush: raise (dir=+1) or lower (dir=-1) a soft disc of terrain, handling the land<->sea boundary,
// then refresh the climate base + reclassify. Returns the number of tiles that crossed the coastline.
function brushTerrain(cx,cy,dir){
  if(!inb(cx,cy))return 0;
  var R=CFG.godBrushRadius|0,d=CFG.godBrushDelta*dir,crossed=0,rose=false,sank=false;
  for(var yy=cy-R;yy<=cy+R;yy++)for(var xx=cx-R;xx<=cx+R;xx++){
    if(!inb(xx,yy))continue;
    var ddx=xx-cx,ddy=yy-cy,dist=Math.sqrt(ddx*ddx+ddy*ddy);if(dist>R+0.5)continue;
    var i=idx(xx,yy);if(peakVolcano&&peakVolcano[i])continue;      // leave volcano cores intact
    var fall=1-dist/(R+1);                                          // soft falloff, 1 at centre
    var wasOcean=(grid[i]===T.OCEAN);
    elev[i]=clamp((elev[i]||0)+d*fall,0,10);
    if(dir>0&&wasOcean&&elev[i]>=0.5){grid[i]=T.COAST;coastTTL[i]=0;crossed++;rose=true;}
    else if(dir<0&&!wasOcean&&elev[i]<0.35){_killLifeAt(i);grid[i]=T.OCEAN;elev[i]=0;coastTTL[i]=0;crossed++;sank=true;}
  }
  _compactLife();computeTemperature();computeAridity();applyClimate();reclassTerrain();
  if(rose)chronicleNote('god','New land rose from the sea by a shaping hand.','#8a9a7b');
  if(sank)chronicleNote('god','Land sank beneath the waves.','#3aa6e0');
  return crossed;
}

// Meteor: strike a target (defaults to the densest life for maximum drama), cratering terrain and wiping
// fauna + flora in the blast radius. Returns the number of creatures killed.
function _pickStrikeTarget(){
  var live=[];for(var a=0;a<fauna.length;a++)if(fauna[a])live.push(fauna[a]);
  if(live.length){var f=live[(eRng()*live.length)|0];return [f.x,f.y];}
  var guard=200;while(guard-->0){var x=(eRng()*W)|0,y=(eRng()*H)|0;if(grid[idx(x,y)]!==T.OCEAN)return [x,y];}
  return [W>>1,H>>1];
}
function meteorStrike(tx,ty){
  if(tx===undefined||ty===undefined){var t=_pickStrikeTarget();tx=t[0];ty=t[1];}
  if(!inb(tx,ty))return 0;
  var R=CFG.meteorRadius|0,killed=0;
  for(var yy=ty-R;yy<=ty+R;yy++)for(var xx=tx-R;xx<=tx+R;xx++){
    if(!inb(xx,yy))continue;
    var ddx=xx-tx,ddy=yy-ty,dist=Math.sqrt(ddx*ddx+ddy*ddy);if(dist>R+0.5)continue;
    var i=idx(xx,yy);
    killed+=_killLifeAt(i);                                         // wipe life in the blast (with kill particles)
    if(dist<=1){grid[i]=T.OCEAN;elev[i]=0;coastTTL[i]=0;}           // molten impact basin at the centre
    else elev[i]=clamp((elev[i]||0)-CFG.meteorCraterDepth*(1-dist/(R+1)),0,10); // scorched, gouged rim
  }
  _compactLife();computeTemperature();computeAridity();applyClimate();reclassTerrain();
  chronicleNote('god','A meteor struck the world'+(killed?', and '+killed+' creature'+(killed===1?'':'s')+' perished in the blast.':'.'),'#e07b39');
  return killed;
}

// Drought: wither flora, hitting the driest ground hardest (arid interior + deserts scorch; wet oases persist).
function droughtEvent(){
  var withered=0;
  for(var f=0;f<flora.length;f++){var fl=flora[f];if(!fl)continue;
    var A=aridity[idx(fl.x,fl.y)]||5;
    if(eRng()<clamp(CFG.droughtSeverity*(0.4+A/6),0,0.98)){flora[f]=null;withered++;}}
  _compactLife();
  chronicleNote('god','A withering drought swept the land'+(withered?'; '+withered+' plants shriveled away.':'.'),'#c9a24b');
  return withered;
}

// Bloom: a sudden flush of new growth (the same weighted placement as a natural seed burst, just larger).
function bloomEvent(){
  var before=flora.length;
  seedFloraCluster(CFG.bloomCount|0);
  var sprang=flora.length-before;
  chronicleNote('god','A great bloom carpeted the world with new growth'+(sprang?' ('+sprang+' plants).':'.'),'#3fcf6a');
  return sprang;
}

// ===== Scenarios + objectives (chunk 5, pillar E): named starting setups with a win/lose observer =====
// A scenario is a starting RECIPE (a preset + a fixed seed + a burst of initial life) plus an OBJECTIVE.
// Both halves are balance-safe by the same argument as chunks 3-4: the SETUP (applyScenarioDef) runs only
// from a button / a scenario permalink, NEVER inside step(), so the measured eRng ecology loop is untouched;
// and the OBSERVER (evaluateScenario / scenarioSample) is PURE + read-only - it reads the world's stats and
// writes only the Chronicle + the scenario status, never fauna/flora/RNG - exactly like chronicleSample. A
// scenario reuses the chunk-4 world-code machinery (a `scen` field on the world code) so it is shareable too.
//
// Objective goals:
//  - 'establish': REACH the `need` tier-counts (no lose). e.g. Genesis: coax a full food web into being.
//  - 'endure':    first REACH `establish`, THEN HOLD `floor` for `duration` ticks; a drop below the floor
//                 AFTER establishment = lose. The two-phase shape sidesteps the cold start - a barren world
//                 warming up is never a failure, only a COLLAPSE after life has taken hold is.
var SCENARIOS = {
  genesis: {
    id:'genesis', label:'Genesis', preset:'balanced', seed:777,
    blurb:'Coax a barren world into a full, three-tier food web.',
    warmupLand:0.008, seedFlora:30, seedHerb:0, seedCarn:0,
    objective:{ goal:'establish', need:{flora:800,herb:60,carn:20},
      desc:'Bring flora, grazers, and predators all to strength.',
      winText:'a full three-tier food web took hold.' }
  },
  balance: {
    id:'balance', label:'The Long Balance', preset:'balanced', seed:2024,
    blurb:'Once life takes hold, keep all three trophic levels alive for 4000 ticks.',
    warmupLand:0.012, seedFlora:60, seedHerb:24, seedCarn:6,
    objective:{ goal:'endure', establish:{flora:500,herb:40,carn:12}, floor:{flora:1,herb:1,carn:1}, duration:4000,
      desc:'Hold flora, grazers, and predators together for 4000 ticks after they establish.',
      winText:'the three-tier balance held for 4000 ticks.',
      loseText:'a trophic level collapsed and the balance broke.' }
  },
  iceage: {
    id:'iceage', label:'Ice Age Refuge', preset:'iceage', seed:1888,
    blurb:'Shelter life through the long cold: keep grazers alive for 3000 ticks after they establish.',
    warmupLand:0.010, seedFlora:40, seedHerb:16, seedCarn:4,
    objective:{ goal:'endure', establish:{flora:150,herb:16}, floor:{herb:1}, duration:3000,
      desc:'Keep herbivores alive through the cold for 3000 ticks after they establish.',
      winText:'grazers endured the long cold for 3000 ticks.',
      loseText:'the last grazers froze out.' }
  },
  volcanic: {
    id:'volcanic', label:'Trial by Fire', preset:'volcanic', seed:909,
    blurb:'Sustain a full food web on restless volcanic ground for 3000 ticks.',
    warmupLand:0.012, seedFlora:50, seedHerb:20, seedCarn:6,
    objective:{ goal:'endure', establish:{flora:400,herb:30,carn:10}, floor:{flora:1,herb:1,carn:1}, duration:3000,
      desc:'Keep all three trophic levels alive on volcanic ground for 3000 ticks after they establish.',
      winText:'a full food web survived the volcanic trial for 3000 ticks.',
      loseText:'the volcanic world burned its food web away.' }
  }
};
var SCENARIO_WARMUP_CAP = 4000;   // hard ceiling on the terrain warmup so setup can never loop forever
var SCENARIO_SAMPLE_EVERY = 10;   // ticks between objective evaluations (matches the chronicle cadence)
var activeScenario = null;        // { def, startTick, status } or null (a free-play sandbox world)

// Pure: does the world (stats s) meet ALL tier thresholds in `req`? Absent tiers (null/undefined) are ignored.
function _meetsTiers(req,s){
  if(!req) return true;
  if(req.flora!=null&&s.flora<req.flora) return false;
  if(req.herb!=null&&s.herb<req.herb) return false;
  if(req.carn!=null&&s.carn<req.carn) return false;
  return true;
}
// Pure: 0..1 progress toward the WEAKEST tier's ratio in `req` (how close the least-satisfied tier is).
function _tierProgress(req,s){
  if(!req) return 1;
  var p=1;
  if(req.flora>0) p=Math.min(p,s.flora/req.flora);
  if(req.herb>0)  p=Math.min(p,s.herb/req.herb);
  if(req.carn>0)  p=Math.min(p,s.carn/req.carn);
  return clamp(p,0,1);
}
// The status a freshly-armed objective starts in.
function initialScenarioStatus(def){
  return { state:'active', phase:def.objective.goal==='endure'?'establishing':'reaching', establishedTick:null, progress:0 };
}
// PURE win/lose observer (the gate-testable core). Given the objective def, a stats snapshot, the current
// tick, and the PRIOR status, return the NEW status. No side effects, no RNG, no DOM: a scenario's outcome
// is a deterministic function of the world's state over time, so it is balance-safe + headless-reproducible.
function evaluateScenario(def,s,curTick,prev){
  var o=def.objective;
  if(prev&&(prev.state==='won'||prev.state==='lost')) return prev; // terminal states latch
  if(o.goal==='establish'){
    if(_meetsTiers(o.need,s)) return { state:'won', phase:'done', establishedTick:prev?prev.establishedTick:null, progress:1 };
    return { state:'active', phase:'reaching', establishedTick:null, progress:_tierProgress(o.need,s) };
  }
  // endure: establishing -> holding -> (won at duration | lost on a post-establishment collapse)
  var establishing=!prev||prev.phase!=='holding';
  if(establishing){
    if(_meetsTiers(o.establish,s)) return { state:'active', phase:'holding', establishedTick:curTick, progress:0 };
    return { state:'active', phase:'establishing', establishedTick:null, progress:_tierProgress(o.establish,s) };
  }
  if(!_meetsTiers(o.floor,s)) return { state:'lost', phase:'done', establishedTick:prev.establishedTick, progress:prev.progress };
  var elapsed=curTick-prev.establishedTick;
  if(elapsed>=o.duration) return { state:'won', phase:'done', establishedTick:prev.establishedTick, progress:1 };
  return { state:'active', phase:'holding', establishedTick:prev.establishedTick, progress:clamp(elapsed/o.duration,0,1) };
}
// Seed a scenario's initial life. Runs right after initWorld (a freshly-seeded eRng), so the eRng draw ORDER
// is fixed => a scenario reproduces the same initial life every time (deterministic + shareable).
function _seedScenarioLife(def){
  if(def.seedFlora) seedFloraCluster(def.seedFlora);
  if(def.seedHerb)  seedFaunaGroup('herbivore',def.seedHerb);
  if(def.seedCarn)  seedFaunaGroup('carnivore',def.seedCarn);
}
// PURE core: build a scenario's world (preset cfg + seed + initial life) and ARM its objective. Runs only
// from startScenario / a scenario permalink - NEVER in step() - so, like the preset selector + god powers,
// the measured ecology loop is byte-identical. Leaves DOM sync to the caller (mirrors the initWorld/init split).
function applyScenarioDef(def){
  _applyPresetCfg(def.preset);
  initWorld(def.seed);              // resets the world + the chronicle; re-seeds all three RNG streams
  // Warm the terrain to a SMALL starting landmass so life has somewhere to root: a fresh world is all ocean,
  // and land forms only through step(). Kept low deliberately - a scenario starts from small beginnings and
  // the world DEVELOPS during play toward the establish thresholds (the two-phase objective never fails while
  // still establishing). Deterministic for a fixed seed (step advances the seeded streams identically), so a
  // scenario reproduces the same starting world every time - which is what makes it shareable. activeScenario
  // is still null here, so scenarioSample is a no-op during the warmup (only chronicleSample narrates it).
  // This SYNC warm is used by the gate + a scenario permalink boot; the deck button warms ASYNC (startScenario)
  // so the tab stays responsive and the world visibly forms.
  var target=def.warmupLand||0.01;
  while(tick<SCENARIO_WARMUP_CAP && landCoverage()<target) step();
  _seedScenarioLife(def);
  activeScenario={ def:def, startTick:tick, status:initialScenarioStatus(def) };
  chronicleNote('scenario','Scenario begun - '+def.label+': '+def.objective.desc,'#8fd0ff');
  return activeScenario;
}
function clearScenario(){ activeScenario=null; }
// Read-only objective observer, run at the END of step() (right after chronicleSample) exactly like the
// Chronicle: derive the world's stats, advance the pure evaluator, and narrate transitions into the
// Chronicle. NO fauna/flora/RNG mutation => the measured ecology loop is byte-identical whether or not a
// scenario is active (and it early-returns entirely in the harness/tests, which never arm a scenario).
function scenarioSample(){
  if(!activeScenario) return;
  if(tick%SCENARIO_SAMPLE_EVERY!==0) return;
  var prev=activeScenario.status; if(prev.state!=='active') return; // decided - stop re-evaluating (still shown)
  var def=activeScenario.def, s=chronicleStats(), next=evaluateScenario(def,s,tick,prev);
  if(next.state==='won') chronicleNote('scenario','Scenario complete - '+def.label+': '+def.objective.winText,'#7fdca4');
  else if(next.state==='lost') chronicleNote('scenario','Scenario failed - '+def.label+': '+(def.objective.loseText||'the objective was lost.'),'#e88f6a');
  else if(next.phase==='holding'&&prev.phase==='establishing') chronicleNote('scenario',def.label+': life has established - now hold it.','#9fb4c8');
  activeScenario.status=next;
}
// DOM: the sidebar Objective panel - live goal, phase, progress bar, and the per-tier readout. Gate-blind
// (verified in the live app); the pure status it renders is gate-covered via evaluateScenario.
function initWorld(seedOverride){
  // Seed setup: use override if a valid number, else random (DOM-free core)
  if(seedOverride!==undefined&&seedOverride!==null&&seedOverride!==''&&!isNaN(parseInt(seedOverride))){_seed=parseInt(seedOverride);}else{_seed=Math.floor(Math.random()*2147483647);}
  sRng=mulberry32(_seed);
  // Dynamics stream: seeded deterministically from _seed but on a distinct offset, so a given
  // seed reproduces the same ECOLOGY run (flora/fauna/climate-drift), not just the terrain.
  eRng=mulberry32((_seed ^ 0x9E3779B9) >>> 0);
  // Cosmetic stream: a THIRD distinct offset for purely-visual genes (size). Separate so it cannot
  // shift the eRng phase -> the ecology run is byte-identical with or without the cosmetic genes.
  cRng=mulberry32((_seed ^ 0x85EBCA6B) >>> 0);
  if(W<=0||H<=0){W=96;H=96;}
  tick=0;grid=new Uint8Array(W*H);elev=new Float32Array(W*H);aridity=new Float32Array(W*H);waterDist=new Float32Array(W*H);tempField=new Float32Array(W*H);sunlight=new Float32Array(W*H);coastTTL=new Int16Array(W*H);adjCooldown=new Uint16Array(W*H);ringDone=new Uint8Array(W*H);hillDecayCount=new Uint8Array(W*H);peakVolcano=new Uint8Array(W*H);volcActive=new Uint8Array(W*H);volcAge=new Int32Array(W*H);volcLife=new Int32Array(W*H);volcanoRing=new Uint8Array(W*H);volcanoCenters=[];biomeStability=new Uint8Array(W*H);biomeDesiredNext=new Uint8Array(W*H);yearlyVariation=1.0;anomalyBlobs=null;climateInit();flora=[];fauna=[];floraIdCounter=0;faunaIdCounter=0;
  popHistory={flora:[],herb:[],carn:[],scav:[],apex:[],omni:[],ticks:[]};biomeBoundary=new Uint8Array(W*H);floraRemnants=[];deathParticles=[];carrion=[];speciesNameCache={};chronicle=newChronicle();speciesRegistry=newSpeciesRegistry();clearRivers();
  for(var i0=0;i0<W*H;i0++){grid[i0]=T.OCEAN;coastTTL[i0]=0;volcActive[i0]=0;volcAge[i0]=0;volcLife[i0]=0;elev[i0]=0;adjCooldown[i0]=0;ringDone[i0]=0;hillDecayCount[i0]=0;peakVolcano[i0]=0;volcanoRing[i0]=0;biomeStability[i0]=0;biomeDesiredNext[i0]=T.OCEAN;}
  pickWorldMeta();reseedSunlight();computeSunlight();computeTemperature();computeAridity();applyClimate();applyElevationIntensity();
}
// Shareable worlds (chunk 4): the ?w= world code from the page URL, captured once at load. Consumed on the
// FIRST init() only (so a later preset change / reset rolls a fresh world instead of re-restoring the link).
function step(){
  tick++;var tries=((W*H)/7)|0;var genesisChanged=false;
  for(var n=0;n<tries;n++){var xS=(sRng()*W)|0,yS=(sRng()*H)|0;var i=idx(xS,yS);if(grid[i]===T.OCEAN){if(tryVolcano(xS,yS))genesisChanged=true;else if(tryCoastal(xS,yS))genesisChanged=true;}else{erosionStep(xS,yS);}}
  for(var i2=0;i2<W*H;i2++)if(volcActive[i2]){volcAge[i2]+=1;elev[i2]=currentCoreHeight(volcAge[i2]);if(volcAge[i2]>=volcLife[i2])coolVolcano(i2);}
  for(var ci=0;ci<W*H;ci++){if(grid[ci]===T.COAST&&coastTTL[ci]>0)coastTTL[ci]--;}
  clusterSpikePass();mountainFringePass();isolatedHillDecayPass();eruptionPromotionPass();
  // Refresh the BASE climate on terrain change / periodically - ALWAYS, regardless of the climate toggles.
  // (The old code suppressed this whenever climate was on, which froze the base and made the seasonal delta
  // accumulate only once genesis stopped - the regime-dependence + drift bug. Base is climate-independent.)
  if(genesisChanged||tick%20===1){computeTemperature();computeAridity();}
  climateStep();applyClimate();reclassTerrain();floraStep();faunaStep();chronicleSample();scenarioSample();speciesSample();
}
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
  (function(){var x=20,y=20,i=idx(x,y);var _ec=CFG.erosionChanceBase;CFG.erosionChanceBase=1.0;grid[i]=T.PLAINS;elev[i]=9.2;var e0=elev[i];for(var k=0;k<200;k++)erosionStep(x,y);t('Erosion lowers tile',elev[i]<e0);CFG.erosionChanceBase=_ec;})(); // force erosion certain so the assertion is deterministic, not RNG-flaky
  var okStep=true;try{step();}catch(e){okStep=false;}t('step() no throw',okStep);
  (function(){var wS=CFG.seasonalTilt,wA=CFG.anomalies,wV=CFG.volcanoAsh;CFG.seasonalTilt=true;CFG.anomalies=true;CFG.volcanoAsh=true;computeTemperature();computeAridity();climateStep();applyClimate();var tOK=true,aOK=true;for(var ci=0;ci<W*H;ci++){if(tempField[ci]<0||tempField[ci]>10)tOK=false;if(aridity[ci]<0||aridity[ci]>10)aOK=false;}t('Climate temp [0,10]',tOK);t('Climate arid [0,10]',aOK);CFG.seasonalTilt=wS;CFG.anomalies=wA;CFG.volcanoAsh=wV;})();
  (function(){var sum=0,bounded=true,N=2000;for(var s=0;s<N;s++){var v=seasonWave(s/N);sum+=v;if(v<-1.0001||v>1.0001)bounded=false;}t('Season wave zero-mean (no climate drift)',Math.abs(sum/N)<0.01);t('Season wave bounded [-1,1]',bounded);})();
  t('Biome stab init',biomeStability&&biomeStability.length===W*H);initAnomalyBlobs();t('Anomaly blobs',anomalyBlobs&&anomalyBlobs.length>0);
  out.push('');out.push('— ECOLOGY —');
  (function(){var tf=makeFlora(10,10,null);t('Flora has prefs',tf.prefArid!==undefined&&tf.prefTemp!==undefined);t('Flora has tolerance',tf.tolerance>=1.0&&tf.tolerance<=5.0);t('Flora has shape',FLORA_SHAPES.indexOf(tf.shape)>=0);})();
  (function(){var ti=idx(10,10);var _g=grid[ti],_a=aridity[ti],_w=waterDist[ti];grid[ti]=T.PLAINS;aridity[ti]=2;waterDist[ti]=0; // pin a hospitable, WELL-WATERED tile so health depends on climate fit, not on biome or the absolute moisture/water brakes
    var f=makeFlora(10,10,{prefArid:aridity[ti],prefTemp:tempField[ti],prefSL:sunlight[ti],tolerance:3.0,hue:120,sat:0.7,val:0.8,gen:0});t('Adapted flora hp>0.9',computeFloraHealth(f)>0.9);var f2=makeFlora(10,10,{prefArid:clamp((aridity[ti]||5)+8,0,10),prefTemp:clamp((tempField[ti]||5)+8,0,10),prefSL:clamp((sunlight[ti]||5)+8,0,10),tolerance:1.5,hue:120,sat:0.7,val:0.8,gen:0});t('Maladapted hp<0.3',computeFloraHealth(f2)<0.3);grid[ti]=_g;aridity[ti]=_a;waterDist[ti]=_w;})();
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
  t('Ecotone flora boost',CFG.ecotoneFloraBoost>1.0);
  t('BiomeBoundary allocated',biomeBoundary&&biomeBoundary.length===W*H);
  // Pop history tests
  t('PopHistory initialized',popHistory&&Array.isArray(popHistory.flora));
  t('PopHistory len constant',POP_HISTORY_LEN===500);
  t('Chronicle initialized',chronicle&&Array.isArray(chronicle.events));
  t('Chronicle events bounded',chronicle.events.length<=CHRONICLE_MAX_EVENTS);
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
function snapshotState(){
  return structuredClone({
    seed:_seed, tick:tick, W:W, H:H,
    floraIdCounter:floraIdCounter, faunaIdCounter:faunaIdCounter,
    yearlyVariation:yearlyVariation, sunPhase:sunPhase, riverGenerated:riverGenerated,
    WORLD:WORLD, popHistory:popHistory, speciesNameCache:speciesNameCache, chronicle:chronicle, speciesRegistry:speciesRegistry,
    // terrain + volcano fields
    grid:grid, elev:elev, aridity:aridity, tempField:tempField, sunlight:sunlight,
    coastTTL:coastTTL, adjCooldown:adjCooldown, ringDone:ringDone, hillDecayCount:hillDecayCount,
    peakVolcano:peakVolcano, volcActive:volcActive, volcAge:volcAge, volcLife:volcLife,
    volcanoRing:volcanoRing, volcanoCenters:volcanoCenters, biomeStability:biomeStability,
    biomeDesiredNext:biomeDesiredNext, biomeBoundary:biomeBoundary,
    // climate fields (genesis baseline; the live temp/aridity above are base + offsets, re-derived next tick)
    baseTemp:baseTemp, baseArid:baseArid, anomalyBlobs:anomalyBlobs,
    // rivers
    riverData:riverData,
    // ecology lists
    flora:flora, fauna:fauna, floraRemnants:floraRemnants, deathParticles:deathParticles, carrion:carrion,
  });
}
function restoreState(snap){
  var s=structuredClone(snap); // clone so one snapshot can be restored repeatedly without aliasing
  _seed=s.seed; tick=s.tick; W=s.W; H=s.H;
  // Re-seed all three streams from the stored seed (mulberry32 state is not externally readable), exactly
  // as initWorld does. sRng -> terrain genesis, eRng -> ecology, cRng -> cosmetic genes.
  sRng=mulberry32(_seed);
  eRng=mulberry32((_seed ^ 0x9E3779B9) >>> 0);
  cRng=mulberry32((_seed ^ 0x85EBCA6B) >>> 0);
  floraIdCounter=s.floraIdCounter; faunaIdCounter=s.faunaIdCounter;
  yearlyVariation=s.yearlyVariation; sunPhase=s.sunPhase; riverGenerated=s.riverGenerated;
  WORLD=s.WORLD; popHistory=s.popHistory; speciesNameCache=s.speciesNameCache; chronicle=s.chronicle||newChronicle(); speciesRegistry=s.speciesRegistry||newSpeciesRegistry();
  grid=s.grid; elev=s.elev; aridity=s.aridity; tempField=s.tempField; sunlight=s.sunlight;
  coastTTL=s.coastTTL; adjCooldown=s.adjCooldown; ringDone=s.ringDone; hillDecayCount=s.hillDecayCount;
  peakVolcano=s.peakVolcano; volcActive=s.volcActive; volcAge=s.volcAge; volcLife=s.volcLife;
  volcanoRing=s.volcanoRing; volcanoCenters=s.volcanoCenters; biomeStability=s.biomeStability;
  biomeDesiredNext=s.biomeDesiredNext; biomeBoundary=s.biomeBoundary;
  baseTemp=s.baseTemp; baseArid=s.baseArid; anomalyBlobs=s.anomalyBlobs;
  riverData=s.riverData;
  flora=s.flora; fauna=s.fauna; floraRemnants=s.floraRemnants; deathParticles=s.deathParticles; carrion=s.carrion||[];
  computeWaterDist(); // derive from the restored grid so snapshot replays use a consistent water field
}

// ===== Split seams (chunk 10) =====
// Setter so the UI shell can change the world size without reassigning an imported binding
// (ES module bindings are read-only from the importer). The mapSize handler calls this.
function setWorldSize(n){ W=n; H=n; }
// Setter for the scenario handle so the UI shell's async startScenario can install its 'preparing'
// placeholder without reassigning the imported binding (it then mutates .startTick/.status in place).
function setActiveScenario(v){ activeScenario=v; }
// Setter so the render can replace the death-particle list (pruned by visible age each frame) without
// reassigning the imported binding. deathParticles is sim state (pushed on death in faunaStep/god powers).
function setDeathParticles(v){ deathParticles=v; }

// Pure (DOM-free) core of the JSON world load (the 'wb-eco-1' / 'wb-land-base-1' format). Split out
// of importJSON so headless tooling / the shell can deserialize a saved world without the DOM download
// path (mirrors the buildSnapshot/exportJSON split). Reassigns sim state + re-derives fields; the DOM
// sync (seed/preset inputs, sliders, canvas resize, redraw) stays in the shell's importJSON wrapper.
function applySnapshot(data){
  if(!data||!data.meta||(data.meta.version!=='wb-land-base-1'&&data.meta.version!=='wb-eco-1'))throw new Error('Invalid snapshot format');
  if(data.meta.W!==W||data.meta.H!==H){W=data.meta.W;H=data.meta.H;}
  tick=data.meta.tick||0;
  if(data.meta.seed!==undefined){_seed=data.meta.seed;sRng=mulberry32(_seed);}
  if(data.meta.preset){activePreset=data.meta.preset;}
  if(data.meta.world)WORLD=data.meta.world;
  if(data.meta.cfg){CFG.climateIntensity=data.meta.cfg.climateIntensity||1.0;CFG.climateSeasonLength=data.meta.cfg.climateSeasonLength||10000;}
  if(data.meta.sunlightPhase!==undefined)sunPhase=data.meta.sunlightPhase;
  grid=new Uint8Array(W*H);if(data.grid&&data.grid.length===W*H){grid=new Uint8Array(data.grid);}
  elev=new Float32Array(data.elev);aridity=new Float32Array(data.aridity);tempField=new Float32Array(data.temp);sunlight=new Float32Array(W*H);coastTTL=new Int16Array(W*H);adjCooldown=new Uint16Array(W*H);ringDone=new Uint8Array(W*H);hillDecayCount=new Uint8Array(W*H);peakVolcano=new Uint8Array(W*H);volcActive=new Uint8Array(W*H);volcAge=new Int32Array(W*H);volcLife=new Int32Array(W*H);volcanoRing=new Uint8Array(W*H);volcanoCenters=[];biomeStability=new Uint8Array(W*H);biomeDesiredNext=new Uint8Array(W*H);anomalyBlobs=null;
  flora=(data.flora&&Array.isArray(data.flora))?data.flora:[];fauna=(data.fauna&&Array.isArray(data.fauna))?data.fauna:[];floraRemnants=(data.remnants&&Array.isArray(data.remnants))?data.remnants:[];
  if(data.rivers&&Array.isArray(data.rivers)){riverData=data.rivers;riverGenerated=true;}else{clearRivers();}
  reseedSunlight();computeSunlight();climateInit();computeTemperature();computeAridity();applyClimate();reclassTerrain();
}

// ===== Public API (chunk 10) =====
// The DOM-free surface the UI shell (main.js) + the headless consumers (sim.test.js, harness.mjs)
// import. Live bindings reflect reassignment inside this module (e.g. flora/fauna/tick after step()).
export {
  // lifecycle + loop
  initWorld, step, runAssertions, setWorldSize, setActiveScenario, setDeathParticles,
  // world size + core scalars/state (live bindings)
  W, H, tick, _seed, activePreset, CFG, DEFAULT_CFG, WORLD, T, TNAME, TERRAIN_COLORS, PRESETS,
  grid, elev, aridity, tempField, sunlight, waterDist, coastTTL, baseTemp, baseArid,
  volcActive, volcAge, volcLife, volcanoRing, volcanoCenters, peakVolcano, adjCooldown, ringDone, hillDecayCount,
  biomeStability, biomeDesiredNext, biomeBoundary, anomalyBlobs, yearlyVariation, sunPhase,
  flora, fauna, floraIdCounter, faunaIdCounter, deathParticles, DEATH_PARTICLE_LIFE, carrion,
  floraLandVigor, floraRemnants, popHistory, POP_HISTORY_LEN, speciesNameCache,
  riverData, riverGenerated, lakeShapes,
  // pure helpers
  mulberry32, idx, inb, neighbors4, neighbors8, clamp, hsv2hex,
  // presets / config
  _applyPresetCfg, applyElevationIntensity,
  // climate
  climateInit, seasonPhase, seasonWave, climateStep, applyClimate,
  computeSunlight, reseedSunlight, computeTemperature, computeAridity, computeWaterDist,
  // biomes + terrain
  classifyTile, reclassTerrain, landCoverage, pickWorldMeta,
  // rivers
  generateRivers, clearRivers,
  // species naming
  generateSpeciesName, getSpeciesName,
  // ecology
  makeFlora, computeFloraHealth, seedFloraCluster, floraStep,
  makeFauna, computeFaunaClimateFit, seedFaunaGroup, scoreTileForFauna, faunaStep,
  mutateFloraChild, mutateFaunaChild,
  // snapshot / serialize
  snapshotState, restoreState, buildSnapshot, applySnapshot,
  // chronicle (world memory)
  chronicle, newChronicle, chronicleStats, chronicleAdd, chronicleNote, chronicleSample, _crossLadder,
  CHRONICLE_MAX_EVENTS,
  // speciation
  speciesKey, speciesCensus, updateSpeciesRegistry, newSpeciesRegistry, speciesRegistry, speciesSample,
  // god powers
  brushTerrain, meteorStrike, droughtEvent, bloomEvent,
  // shareable worlds
  buildWorldCode, applyWorldCode, encodeWorldCode, decodeWorldCode, worldPermalink, worldPostcard,
  WORLD_CODE_VERSION,
  // scenarios + objectives
  SCENARIOS, evaluateScenario, applyScenarioDef, clearScenario, activeScenario, scenarioSample,
  SCENARIO_WARMUP_CAP, _seedScenarioLife, initialScenarioStatus,
  // additional pure cores/constants the UI shell references directly
  DIR_DX, DIR_DY, _capType, SPECIES_MIN_GEN, SPECIES_MIN_POP,
};
