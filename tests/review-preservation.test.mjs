import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {VERSION} from '../config.js';
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const baseline=JSON.parse(read('tests/fixtures/review-baseline.json'));
const hash=s=>createHash('sha256').update(s).digest('hex');
const extract=(source,a,b)=>source.slice(source.indexOf(a),source.indexOf(b));
test('original home, holdings and settings presentation remain unchanged',()=>{for(const block of baseline.blocks)assert.equal(hash(extract(read('app.js'),block.start,block.end)),block.hash);});
test("strategy cards collapse and expose participation controls",()=>{const app=read("app.js"),card=extract(app,"function strategyPage(","function invitesHtml(");assert.match(card,/<details class="strategy-card strategy-collapse"/);assert.match(card,/data-participation-panel/);assert.match(app,/暫不參與/);assert.ok(!card.includes("strategyReviewHtml"));});
test('existing Firestore authorization remains and strategy reviews are removed',()=>{const rules=read('firestore.rules');assert.match(rules,/function owner\(uid\)/);assert.match(rules,/match \/access\/{uid}/);assert.match(rules,/match \/sharedPortfolios\/{uid}/);assert.match(rules,/match \/strategies\/{uid}\/posts\/{postId}/);assert.match(rules,/match \/strategyParticipation\//);assert.ok(!rules.includes('strategyReviews'));});
test("participation is live, scoped to the current strategy revision, and quotes refresh while visible",()=>{const app=read("app.js"),store=read("store.js"),rules=read("firestore.rules");assert.match(app,/AUTO_QUOTE_INTERVAL=5\*60\*1000/);assert.match(app,/visibilityState==="visible"/);assert.match(store,/listenStrategyParticipation/);assert.match(store,/saveStrategyParticipation/);assert.match(rules,/match \/strategyParticipation\//);assert.match(rules,/request\.auth\.uid == memberUid/);assert.match(rules,/strategyUpdatedAt/);});

