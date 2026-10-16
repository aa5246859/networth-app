import test from 'node:test';
import assert from 'node:assert/strict';
import {num,stamp,taipeiDay} from '../core.js';

test('reused numeric formatters keep the existing precision, rounding and unknown-value display',()=>{
  const cases=[0,-0,1,-1,0.7274591794336837,0.00000019,1.005,-1.005,999.99999,1000000.1234567,1e12,NaN,Infinity,null,'123'];
  for(let round=0;round<2;round++)for(const digits of [0,1,2,4,6])for(const value of cases){
    const expected=typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('zh-TW',{maximumFractionDigits:digits}):'—';
    assert.equal(num(value,digits),expected);
  }
});

test('reused date formatters retain Taipei midnight boundaries and never reuse an old timestamp',()=>{
  const moments=[['2026-10-16T15:59:00Z','2026-10-16','10/16 23:59'],['2026-10-16T16:00:00Z','2026-10-17','10/17 00:00'],['2026-10-16T18:40:00Z','2026-10-17','10/17 02:40']];
  for(let round=0;round<2;round++)for(const [input,day,time] of moments){assert.equal(taipeiDay(new Date(input)),day);assert.equal(stamp(input).replace(/\u2009/g,' '),time);}
  for(const value of [null,undefined,'','invalid',0])assert.equal(stamp(value),'時間未確認');
});
