import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {recognizeScreen} from '../src/android/screen-reader.js';
it('returns primary OCR and bounded error evidence when optional crop OCR exceeds its budget',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ocr-deadline-')),old=process.env.PATH;
 try{
  // CI installs Pillow for the system Python used by the runtime contracts.
  if(process.platform==='linux')await symlink('/usr/bin/python3',join(dir,'python3'));
  await writeFile(join(dir,'tesseract'),`#!/usr/bin/env python3
import sys,time
if '--version' in sys.argv: print('tesseract test')
elif '--list-langs' in sys.argv: print('eng\\nchi_sim\\nchi_tra')
else:
 if sys.argv[sys.argv.index('--psm')+1] != '4': time.sleep(8)
 print('level\\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\twidth\\theight\\tconf\\ttext')
 print('5\\t1\\t1\\t1\\t1\\t1\\t120\\t1560\\t900\\t90\\t90\\t4.19% (18) - Chinese')
`,{mode:0o700});
  process.env.PATH=dir+':'+old;
  const o=await recognizeScreen({png:readFileSync(new URL('./fixtures/android/rating-reread-20261023/keke-36.png',import.meta.url)),timeoutMs:3000,languages:'eng',scale:3});
  expect(o.lines[0]!.text).toBe('4.19% (18) - Chinese');
  expect(o.ratingRereads?.[0]?.error).toBe('TimeoutExpired');
 }finally{process.env.PATH=old;await rm(dir,{recursive:true,force:true});}
});
