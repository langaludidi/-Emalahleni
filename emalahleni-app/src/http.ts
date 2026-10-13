export class HttpError extends Error { constructor(public status: number, public code: string) { super(code); } }
export async function readBytes(request: Request, limit: number) {
  const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'BODY_REQUIRED');
  const chunks:Uint8Array[]=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw new HttpError(413,'BODY_TOO_LARGE');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const value of chunks){bytes.set(value,offset);offset+=value.length;}return bytes;
}
