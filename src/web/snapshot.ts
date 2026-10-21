/** A local, read-only historical archive viewer. Never initializes Mongo or a collector. */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { BlobServiceClient } from '@azure/storage-blob';
import { AzureCliCredential } from '@azure/identity';
import { keywordKey, type RankObservation } from '../domain/model.js';
import { MemoryTrackingRepository, type StoredStore } from '../domain/repository.js';
import { monitoringTargetSchema, parseStore, parseTrackingConfig } from '../domain/tracking-config.js';
import type { EvidenceReader } from './server.js';

const dateTime = z.string().datetime({offset:true});
const nullableNumber = z.number().finite().nullable();
const positive = z.number().int().positive();
const resultType = z.enum(['ad','organic','unknown']);
const point = z.object({latitude:z.number().min(-90).max(90).nullable(),longitude:z.number().min(-180).max(180).nullable(),distanceKm:z.number().nonnegative().nullable(),ring:z.enum(['inner','middle','outer']).nullable(),zoom:nullableNumber.optional()});
const geographic = z.object({status:z.enum(['unverified','matched','outside','mixed']),expectedArea:z.object({label:z.string(),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),radiusKm:z.number().positive(),source:z.string()}).nullable(),scope:z.enum(['observed_listings','detail_place']),checkedCount:z.number().int().nonnegative(),insideCount:z.number().int().nonnegative(),outsideCount:z.number().int().nonnegative(),unknownCount:z.number().int().nonnegative(),reason:z.enum(['expected_area_not_configured','no_observations','incomplete_coordinates','all_observed_places_inside','all_observed_places_outside','observed_places_mixed'])});
const occurrence = z.object({displayPosition:positive,organicRank:positive.nullable(),resultType,occurrenceId:z.string().nullable().optional()});
const observation = z.object({
 observationId:z.string().min(1),surface:z.enum(['web','android']),storeId:z.string(),placeId:z.string(),keyword:z.string().min(1),keywordKey:z.string(),keywordTier:z.enum(['core','longTail']).nullable(),pointId:z.string().min(1),point,
 locationMode:z.enum(['query_only','map_view','device_gps']),observedAt:dateTime,localDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),scanId:z.string(),queryId:z.string(),
 gridSpec:z.object({center:z.object({latitude:z.number(),longitude:z.number()}),radiusKm:z.number().positive(),size:z.number().int().positive()}).optional(),gridRunId:z.string().optional(),
 monitoringTarget:monitoringTargetSchema.optional(),
 rank:z.object({status:z.enum(['ranked','ad_only','not_found','not_found_in_prefix','not_evaluated','identity_unresolved','unreliable','blocked','failed']),displayPosition:positive.nullable(),organicRank:positive.nullable(),listingsObserved:z.number().int().nonnegative(),listingStatus:z.string(),stopReason:z.string().nullable(),targetOccurrences:z.array(occurrence).optional(),adDisplayPositions:z.array(positive).optional()}),
 quality:z.object({rankingReliable:z.boolean().nullable(),sequenceVerified:z.boolean().nullable(),classificationComplete:z.boolean().nullable(),screenshotCoverageComplete:z.boolean().nullable(),identityResolved:z.boolean().nullable(),organicCoverage:z.number().int().nonnegative().nullable(),endOfResults:z.boolean().nullable(),resultSurface:z.string().nullable(),geographicRelevance:geographic.nullable(),locationEvidence:z.object({injectionStatus:z.string().nullable(),deviceLocationStatus:z.string().nullable(),mapsLocationStatus:z.string().nullable()}).optional(),warnings:z.array(z.string())}).optional(),
 topListings:z.array(z.object({displayPosition:positive,organicRank:positive.nullable(),resultType,name:z.string().nullable(),placeId:z.string().nullable(),rating:nullableNumber,reviewCount:z.number().int().nonnegative().nullable(),distanceText:z.string().nullable().default(null)})),
 evidence:z.object({manifestKey:z.string().nullable(),resultKey:z.string().nullable(),screenshotKeys:z.array(z.string())}),
 source:z.object({adapterVersion:z.string().nullable(),profileHash:z.string().nullable(),attemptId:z.string().nullable().optional(),queryAttemptId:z.string().nullable().optional()}),ingestedAt:dateTime,
});
const artifact = z.object({key:z.string(),path:z.string().nullable().optional(),bytes:z.number().int().nonnegative(),sha256:z.string().regex(/^[a-f0-9]{64}$/u)});
const snapshot = z.object({version:z.literal(1),timezone:z.string(),stores:z.array(z.record(z.string(),z.unknown())),observations:z.array(observation),evidence:z.array(artifact),info:z.object({label:z.string().max(500).optional(),sourceDescription:z.string().max(5000).optional(),generatedAt:dateTime.optional(),coverageNote:z.string().max(5000).optional()}).default({})});
const SAFE_KEY = /^(?:tracking|android-maps|maps-keyword-capture|\d{4}-\d{2}-\d{2})\/[A-Za-z0-9_.+\-/%一-鿿]+\.png$/u;
function safeKey(key:string):boolean { return SAFE_KEY.test(key) && !key.split('/').some(p=>!p || p==='.' || p==='..') && !/%(?:2e|2f|5c)/iu.test(key); }
function localDate(instant:string,timeZone:string):string { const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant));const get=(type:string)=>parts.find(p=>p.type===type)!.value;return `${get('year')}-${get('month')}-${get('day')}`; }
class ReadOnlyRepository extends MemoryTrackingRepository {
 override async saveStore(_raw:unknown,_now?:Date):Promise<StoredStore> { throw new Error('read-only snapshot'); }
 override async setActive(_storeId:string,_active:boolean,_now?:Date):Promise<StoredStore|null> { throw new Error('read-only snapshot'); }
}
export async function loadSnapshot(file:string, options:{remote?:EvidenceReader}={}) {
 const parsed=snapshot.safeParse(JSON.parse(await readFile(file,'utf8')));
 if(!parsed.success) throw new Error(`Invalid snapshot: ${parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).slice(0,8).join('; ')}`);
 const data=parsed.data;
 // No captured cadence is implied by these inert API defaults: this process cannot execute scans.
 const idleSurface={point:{everyHours:24,keywords:'all'},grid:{enabled:false,atHour:0,keywords:'core'}};
 const config=parseTrackingConfig({schemaVersion:'tracking-config/v1',timezone:data.timezone,storeSource:{provider:'mongo'},stores:[],surfaces:{web:idleSurface,android:idleSurface},database:{provider:'mongo',database:'readonly-snapshot'}});
 const stores:StoredStore[]=data.stores.map(raw=>{
  const {createdAt,updatedAt,center,...rest}=raw;
  // Validate the unchanged editable fields, retaining unknown archive location explicitly.
  const checked=parseStore({...rest,center:center===null?{latitude:0,longitude:0}:center});
  return {...checked,center:center===null?null:checked.center,createdAt:dateTime.parse(createdAt),updatedAt:dateTime.parse(updatedAt)};
 });
 const byStore=new Map(stores.map(s=>[s.storeId,s]));
 if(byStore.size!==stores.length || new Set(stores.map(s=>s.placeId)).size!==stores.length) throw new Error('duplicate store identity');
 const indexed=new Map<string,z.infer<typeof artifact>>();
 for(const entry of data.evidence){
  if(!safeKey(entry.key)||indexed.has(entry.key))throw new Error('invalid or duplicate evidence key');
  if(entry.path && (!isAbsolute(entry.path)||!entry.path.endsWith('.png')))throw new Error('evidence path must be an absolute PNG path');
  indexed.set(entry.key,entry);
 }
 const ids=new Set<string>();
 for(const row of data.observations){
  if(ids.has(row.observationId))throw new Error('duplicate observation identity');ids.add(row.observationId);
  if(byStore.get(row.storeId)?.placeId!==row.placeId)throw new Error('observation store identity mismatch');
  if(row.keywordKey!==keywordKey(row.keyword))throw new Error('observation keyword identity mismatch');
  if(row.localDate!==localDate(row.observedAt,data.timezone))throw new Error('observation date does not match snapshot timezone');
  if(row.evidence.screenshotKeys.some(key=>!indexed.has(key)))throw new Error('unindexed screenshot evidence');
 }
 const repo=new ReadOnlyRepository(data.observations as RankObservation[]);
 for(const store of stores)repo.stores.set(store.storeId,store);
 const evidence:EvidenceReader={get:async(key)=>{
  const entry=indexed.get(key);if(!entry)throw new Error('unindexed screenshot');
  let bytes:Buffer|undefined;let downloaded=false;
  if(entry.path)try{bytes=await readFile(entry.path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(!bytes && options.remote){bytes=await options.remote.get(key);downloaded=true;}
  if(!bytes)throw new Error('screenshot is not cached and remote readback is unavailable');
  if(bytes.length!==entry.bytes)throw new Error('screenshot receipt size mismatch');
  if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('screenshot receipt checksum mismatch');
  if(!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw new Error('screenshot is not PNG');
  if(downloaded && entry.path){
   await mkdir(dirname(entry.path),{recursive:true});
   try{await writeFile(entry.path,bytes,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  }
  return bytes;
 }};
 const previewInfo={...data.info,mode:'read-only archive',observations:repo.observations.length,evidenceObjects:indexed.size,from:repo.observations.reduce((m,o)=>o.localDate<m?o.localDate:m,'9999-99-99'),to:repo.observations.reduce((m,o)=>o.localDate>m?o.localDate:m,'0000-00-00')};
 return {repo,config,evidence,previewInfo};
}

async function main(){
 const [file,portArg='0']=process.argv.slice(2);if(!file)throw new Error('Usage: tsx src/web/snapshot.ts <snapshot.json> [port]');
 const port=Number(portArg);if(!Number.isInteger(port)||port<0||port>65535)throw new Error('invalid port');
 let remote:EvidenceReader|undefined;
 // Explicit opt-in, read-only Azure login. No SAS/key or remote write APIs are used.
 const account=process.env.SNAPSHOT_AZURE_ACCOUNT, container=process.env.SNAPSHOT_AZURE_CONTAINER;
 if(account||container){
  if(!account||!container||!/^[a-z0-9]{3,24}$/u.test(account)||!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(container))throw new Error('invalid snapshot Azure account/container');
  const client=new BlobServiceClient(`https://${account}.blob.core.windows.net`,new AzureCliCredential()).getContainerClient(container);
  remote={get:async key=>{const blob=client.getBlobClient(key);const props=await blob.getProperties();if(!props.contentLength||props.contentLength>64*1024*1024)throw new Error('invalid screenshot size');return blob.downloadToBuffer(0,props.contentLength);}};
 }
 const loaded=await loadSnapshot(resolve(file),remote?{remote}:{});
 const {createHandler}=await import('./server.js');
 const server=createServer(createHandler({...loaded,readOnly:true}));
 server.listen(port,'127.0.0.1',()=>{const address=server.address();if(address&&typeof address!=='string')process.stdout.write(JSON.stringify({url:`http://127.0.0.1:${address.port}/`,readOnly:true,...loaded.previewInfo})+'\n');});
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{process.stderr.write('Snapshot preview failed. Check snapshot validation, paths and optional Azure login.\n');process.exitCode=1;});
