import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {VERSION} from '../config.js';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('installed app entry and scope stay inside the existing GitHub Pages project',()=>{
  const manifest=JSON.parse(read('manifest.json')),base='https://example.github.io/networth-app/manifest.json';
  assert.equal(manifest.display,'standalone');
  assert.equal(new URL(manifest.start_url,base).pathname,'/networth-app/index.html');
  assert.equal(new URL(manifest.id,base).pathname,'/networth-app/index.html');
  assert.equal(new URL(manifest.scope,base).pathname,'/networth-app/');
  assert.equal(manifest.theme_color,'#101614');assert.equal(manifest.background_color,'#101614');
  for(const icon of manifest.icons)assert.ok(fs.existsSync(new URL('../'+icon.src,import.meta.url)));
});
test('every app module and service-worker shell file exists and cache version matches the app',()=>{
  const sw=read('sw.js'),shell=JSON.parse(sw.match(/const SHELL=(\[.*?\]);/)[1]);
  assert.ok(sw.includes('wealth-tracker-v'+VERSION));
  for(const item of shell)assert.ok(fs.existsSync(new URL('../'+item,import.meta.url)),item);
  for(const name of ['app.js','store.js','backup.js'])for(const match of read(name).matchAll(/from ["'](\.\/[^"']+)["']/g))assert.ok(fs.existsSync(new URL('../'+match[1],import.meta.url)),match[1]);
  const html=read('index.html');assert.ok(html.includes('styles.css?v='+VERSION));assert.ok(html.includes('app.js?v='+VERSION));assert.ok(read('app.js').includes('./config.js?v='+VERSION));assert.ok(sw.includes('ignoreSearch:true'));assert.ok(html.includes('viewport-fit=cover'));assert.ok(html.includes('apple-mobile-web-app-capable'));assert.ok(html.includes('apple-mobile-web-app-title'));
});
test('comparison preview embeds the same complete app and has valid device-switching JavaScript',()=>{
  const html=read('device-preview.html');const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];new vm.Script(script);
  const payload=script.match(/const content=(.*?);\n/)[1];assert.equal(JSON.parse(payload),read('preview.html'));
  assert.ok(html.includes('id="desktop"'));assert.ok(html.includes('id="mobile"'));
  assert.ok(script.includes(".srcdoc=content"));assert.ok(!script.includes('firebasejs/'));
});
