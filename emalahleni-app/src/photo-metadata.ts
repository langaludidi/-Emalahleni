import {sha256Hex} from './hash';

export interface PhotoProposal {latitude:number|null;longitude:number|null;date:string;dateSource:string;timezone:string;sha256:string;filename:string;}
export function dateFromCamera(value:unknown):string{
 if(typeof value!=='string')return '';
 const match=value.match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})(?:[ T]|$)/);if(!match)return '';
 const candidate=`${match[1]}-${match[2]}-${match[3]}`;const parsed=new Date(candidate+'T00:00:00Z');
 return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===candidate?candidate:'';
}
export function proposalFromTags(tags:Record<string,unknown>|undefined,gps:{latitude?:number;longitude?:number}|undefined,sha256:string,filename:string):PhotoProposal{
 const coordinate=(v:unknown,limit:number)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=limit?v:null;
 let date='',dateSource='';for(const key of ['DateTimeOriginal','CreateDate','GPSDateStamp']){date=dateFromCamera(tags?.[key]);if(date){dateSource=key;break;}}
 return {latitude:coordinate(gps?.latitude,90),longitude:coordinate(gps?.longitude,180),date,dateSource,timezone:typeof tags?.OffsetTimeOriginal==='string'?tags.OffsetTimeOriginal:'Unspecified camera timezone',sha256,filename};
}
export async function extractPhoto(file:File):Promise<PhotoProposal>{
 if(!['image/jpeg','image/png'].includes(file.type)||file.size>5*1024*1024)throw Error('Choose a JPEG or PNG photograph up to 5 MB.');
 const bytes=await file.arrayBuffer();const exifr=await import('exifr');
 const [tags,gps]=await Promise.all([exifr.parse(bytes,{pick:['DateTimeOriginal','CreateDate','GPSDateStamp','OffsetTimeOriginal'],reviveValues:false}).catch(()=>undefined),exifr.gps(bytes).catch(()=>undefined)]);
 const hash=await sha256Hex(bytes);
 return proposalFromTags(tags,gps,hash,file.name);
}

