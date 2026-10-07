import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export const root=fileURLToPath(new URL('../',import.meta.url));
export async function verifySource(){
 const manifest=JSON.parse(await readFile(resolve(root,'SOURCE-MANIFEST.json'),'utf8'));
 if(manifest.sourceCommit!=='94c1ba2515e0f34fe64baa98cd932e4a28589849')throw Error('Unexpected source version');
 for(const file of manifest.files){if(file.path.startsWith('/')||file.path.split('/').includes('..'))throw Error('Unsafe manifest path');const data=await readFile(resolve(root,file.path));if(data.length!==file.bytes||createHash('sha256').update(data).digest('hex')!==file.sha256)throw Error('Source changed: '+file.path);}
 for(const forbidden of ['.openai','.git','.env','.sites-runtime','.wrangler']){try{await lstat(resolve(root,forbidden));throw Error('Private/runtime input in QA export: '+forbidden);}catch(e){if(e.code!=='ENOENT')throw e;}}
 return {sourceCommit:manifest.sourceCommit,verifiedFiles:manifest.files.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await verifySource()));
