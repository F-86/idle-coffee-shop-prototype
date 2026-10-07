import {build as viteBuild} from 'vite';
import {build as workerBuild} from 'esbuild';
import {resolve} from 'node:path';
import {root,verifySource} from './verify.mjs';
console.log(await verifySource());process.chdir(root);
await viteBuild({root});
await workerBuild({entryPoints:['worker/index.ts'],outfile:resolve(root,'dist/server/index.js'),bundle:true,format:'esm',platform:'browser',target:'es2022'});
console.log('Local QA client and Worker built without any hosting manifest or deployment.');
