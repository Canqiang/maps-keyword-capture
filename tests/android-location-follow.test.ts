import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {nativeLocationControlState} from '../src/android/ui.js';
const original=readFileSync(new URL('./fixtures/android/home-compass-20261024/home.xml',import.meta.url),'utf8');
const control=original.match(/<[A-Za-z][^>]*content-desc="Exit compass mode"[^>]*>/u)![0];
describe('native location follow evidence',()=>{
 it.each(['Enter compass mode','Exit compass mode'])('recognizes one native following control: %s',label=>{
  expect(nativeLocationControlState(original.replaceAll('Exit compass mode',label),true)).toBe('following');
 });
 it.each(['disabled','foreign','hidden','no-bounds','unknown'])('rejects invalid control: %s',variant=>{
  const changed=variant==='disabled'?control.replace('enabled="true"','enabled="false"'):variant==='foreign'?control.replace('package="com.google.android.apps.maps"','package="other.app"'):variant==='hidden'?control.replace('displayed="true"','displayed="false"'):variant==='no-bounds'?control.replace(/bounds="[^"]*"/u,'bounds=""'):control.replace('Exit compass mode','Your location');
  expect(changed).not.toBe(control);expect(nativeLocationControlState(original.replace(control,changed),true)).toBeNull();
 });
 it.each(['Enter compass mode','Exit compass mode','Re-center map to your location'])('rejects conflicting or duplicate control: %s',label=>{
  const extra=`<node package="com.google.android.apps.maps" content-desc="${label}" enabled="true" bounds="[0,0][20,20]"/>`;
  expect(nativeLocationControlState(original.replace('</hierarchy>',extra+'</hierarchy>'),true)).toBeNull();
 });
});
