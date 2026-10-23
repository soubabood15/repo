import {Readable} from 'node:stream';
import {createGunzip} from 'node:zlib';
const error=(code,apiStatus)=>Object.assign(Error(code),{code,...(Number.isInteger(apiStatus)?{apiStatus}:{})});
const isWav=bytes=>bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE';
class Bytes{
 constructor(source){this.iterator=source[Symbol.asyncIterator]();this.buffer=Buffer.alloc(0);this.total=0}
 async next(){if(this.buffer.length)return true;const item=await this.iterator.next();if(item.done)return false;this.buffer=Buffer.from(item.value);this.total+=this.buffer.length;if(this.total>128*1024*1024)throw error('RECORDING_ARCHIVE_INVALID');return true}
 async read(size){const parts=[];let left=size;while(left>0&&await this.next()){const part=this.buffer.subarray(0,left);parts.push(part);left-=part.length;this.buffer=this.buffer.subarray(part.length)}return Buffer.concat(parts)}
 async *take(size){let left=size;while(left>0){if(!await this.next())throw error('RECORDING_ARCHIVE_INVALID');const part=this.buffer.subarray(0,left);left-=part.length;this.buffer=this.buffer.subarray(part.length);yield part}}
 async skip(size){for await(const _part of this.take(size)){} }
 async *rest(){while(await this.next()){const part=this.buffer;this.buffer=Buffer.alloc(0);yield part}}
}
function tarHeader(header){
 if(header.length!==512)return null;
 const octal=(start,length)=>header.toString('ascii',start,start+length).replace(/\0/g,'').trim();
 const checksum=octal(148,8),size=octal(124,12);if(!/^[0-7]+$/.test(checksum)||!/^0*[0-7]+$/.test(size))return null;
 let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:header[i];if(sum!==parseInt(checksum,8))return null;
 const name=header.toString('utf8',0,100).split('\0')[0],prefix=header.toString('utf8',345,500).split('\0')[0],path=(prefix?prefix+'/':'')+name;
 if(path.startsWith('/')||path.includes('\\')||path.split('/').includes('..'))throw error('RECORDING_ARCHIVE_INVALID');
 const length=parseInt(size,8);if(!Number.isSafeInteger(length)||length>128*1024*1024)throw error('RECORDING_ARCHIVE_INVALID');
 return {name:path.replace(/^\.\//,''),size:length,type:header.toString('ascii',156,157)};
}
export async function recordingStream(response,file){
 let decoded;try{
  let reader=new Bytes(response),head=await reader.read(512);
  if(head[0]===0x1f&&head[1]===0x8b){const initial=head,source=reader;const compressed=Readable.from((async function*(){yield initial;yield* source.rest()})()),gunzip=createGunzip();compressed.on('error',failure=>gunzip.destroy(failure));gunzip.on('close',()=>compressed.destroy());decoded=compressed.pipe(gunzip);reader=new Bytes(decoded);head=await reader.read(512)}
  const close=()=>{decoded?.destroy();response.destroy?.()};
  if(isWav(head)){const first=head,source=reader;return Readable.from((async function*(){try{yield first;yield* source.rest()}finally{close()}})())}
  const text=head.toString('utf8').replace(/^\uFEFF/,'').trimStart();
  if(text.startsWith('{')||text.startsWith('[')){const status=text.match(/"status"\s*:\s*(-?\d+)/);throw error('RECORDING_API_ERROR',status?Number(status[1]):undefined)}
  if(/^<!doctype|^<html/i.test(text))throw error('RECORDING_API_RESPONSE');
  const expected=file?.filename?.replace(/^\.\//,'');let header=tarHeader(head);
  if(header&&!expected)throw error('RECORDING_ARCHIVE_INVALID');
  for(let entries=0;header&&entries<128;entries++){
   const matches=header.name===expected||header.name.endsWith('/'+expected)||header.name===expected.split('/').at(-1);
   if(matches&&['0','\0',''].includes(header.type)){
    const first=await reader.read(Math.min(512,header.size));if(first.length>header.size||!isWav(first))throw error('RECORDING_FORMAT_UNSUPPORTED');
    const source=reader,remaining=header.size-first.length;return Readable.from((async function*(){try{yield first;yield* source.take(remaining)}finally{close()}})());
   }
   await reader.skip(Math.ceil(header.size/512)*512);head=await reader.read(512);if(head.every(byte=>byte===0))break;header=tarHeader(head);
  }
  throw error(header?'RECORDING_NOT_FOUND':'RECORDING_FORMAT_UNSUPPORTED');
 }catch(failure){decoded?.destroy();response.destroy?.();if(/^Z_/.test(failure.code||''))throw error('RECORDING_ARCHIVE_INVALID');throw failure}
}
