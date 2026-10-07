import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const inlineModule=source=>source.replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
const js=[inlineModule(read('review.js')),inlineModule(read('config.js')),inlineModule(read('core.js')),inlineModule(read('icons.js')),inlineModule(read('backup.js')),
  'const cloud={isAdmin:()=>false,connect:async()=>{throw new Error("這是獨立預覽，請使用示範版查看；正式版請依更新說明安裝。");}};const notifications={notificationStatus:()=>({configured:false,permission:"default",prefs:{strategy:true,daily:true},subscribed:false}),appOpened:async()=>{},strategyPublished:async()=>{},enableNotifications:async()=>{},disableNotifications:async()=>{},updateNotificationPreferences:async()=>{}};const refreshMarket=async()=>{throw new Error("獨立預覽使用示範行情。");};',
  inlineModule(read('app.js')).replace(/if\("serviceWorker"in navigator\)[^\n]*/,'').replace(/^if\(new URLSearchParams.*$/m,'startDemo();')].join('\n');
let html=read('index.html')
  .replace(/<title>.*?<\/title>/,'<title>Wealth Tracker · 新版互動預覽</title>')
  .replace(/<link[^>]*rel="(manifest|icon|apple-touch-icon)"[^>]*>/g,'')
  .replace('<link rel="stylesheet" href="styles.css?v='+read('config.js').match(/VERSION = "([^"]+)/)[1]+'">','<style>'+read('styles.css').replace(/@import[^;]*;/g,'')+'</style>')
  .replace('<script type="module" src="app.js?v='+read('config.js').match(/VERSION = "([^"]+)/)[1]+'"></script>',()=>'<script>'+js.replace(/<\/script/gi,'<\\/script')+'</script>');
const output=process.argv[2]||path.join(root,'preview.html');
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
console.log('Preview built:',output);
