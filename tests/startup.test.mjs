import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const script=fs.readFileSync(new URL('../redirect.js',import.meta.url),'utf8');
test('legacy startup redirects immediately without a migration interstitial',()=>{
  assert.doesNotMatch(html,/搬遷|正在前往|主畫面圖示|content="2;/);
  assert.match(html,/http-equiv="refresh" content="0; url=https:\/\/wealth-tracker-app.pages.dev\/"/);
  assert.match(html,/<script src="\.\/redirect.js"><\/script>/);
  assert.ok(html.indexOf('<script')<html.indexOf('<body>'));
  const body=html.split('<body>')[1].split('</body>')[0].replace(/<noscript>[\s\S]*?<\/noscript>/,'').trim();
  assert.equal(body,'');
});
test('redirect preserves notification query and page hash using history replacement',()=>{
  for(const [search,hash] of [['',''],['?demo=1','#assets'],['?strategyOwner=owner&strategyId=post','#sharing']]){
    const destinations=[];
    vm.runInNewContext(script,{URL,window:{location:{search,hash,replace:value=>destinations.push(value)}}});
    assert.deepEqual(destinations,['https://wealth-tracker-app.pages.dev/'+search+hash]);
  }
});
