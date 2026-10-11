import assert from 'node:assert/strict';
import fs from 'node:fs';

const externalPath = 'src/components/features/ExternalAdEngine.tsx';
const iptvPath = 'src/pages/TikVTVPage.tsx';
const appPath = 'src/App.tsx';
const external = fs.readFileSync(externalPath, 'utf8');
const iptv = fs.readFileSync(iptvPath, 'utf8');
const app = fs.readFileSync(appPath, 'utf8');

function extractTemplate(source, marker, endMarker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Missing template marker: ${marker}`);
  const start = markerIndex + marker.length;
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Missing template terminator: ${endMarker}`);
  return source.slice(start, end);
}

function validateEmbeddedScript(html, label) {
  assert.ok(html.includes('</script>'), `${label}: generated HTML must close its monitor script`);
  assert.ok(!html.includes('<\\/script>'), `${label}: escaped closing tag would stop the monitor script from executing`);
  const start = html.indexOf('<script>(function(){');
  const end = html.indexOf('</script>', start);
  assert.ok(start >= 0 && end > start, `${label}: monitor script boundaries must exist`);
  assert.doesNotThrow(() => new Function(html.slice(start + '<script>'.length, end)), `${label}: monitor JavaScript must parse`);
  assert.ok(html.includes('creative-detected'), `${label}: filled status must be observable`);
  assert.ok(html.includes('no-creative-timeout'), `${label}: no-fill timeout must be observable`);
}

const externalTemplate = extractTemplate(external, 'const srcDoc = useMemo(() => `', '`, [ad]);');
const externalHtml = Function('ad', `return \`${externalTemplate}\`;`)({
  width: 320,
  height: 50,
  html: '<div id="ad-test-probe"></div>',
});
validateEmbeddedScript(externalHtml, 'ExternalAdEngine');
assert.ok(external.includes("window.dispatchEvent(new CustomEvent('testagram:ad-slot-status'"), 'ExternalAdEngine must expose a runtime status event');
assert.ok(external.includes('data-ad-status={adStatus}'), 'ExternalAdEngine must expose its current slot status');
assert.ok(external.includes('minHeight: nearViewport ? ad.height : 0'), 'ExternalAdEngine must defer slot height reservation until near the viewport to avoid blank page gaps');
assert.ok(external.includes('loading="eager"'), 'ExternalAdEngine must not lazy-load after the visibility probe has fired');
assert.ok(!external.includes('relative h-px w-full overflow-hidden'), 'ExternalAdEngine must not collapse the slot to one pixel while waiting');
assert.ok(!external.includes('-z-10 overflow-hidden opacity-0'), 'ExternalAdEngine must not hide the publisher frame while waiting for creative detection');
assert.ok(external.includes("report('empty','script-error')"), 'ExternalAdEngine must distinguish script errors from no-fill timeouts');
assert.ok(external.includes("}, [unit]);"), 'ExternalAdEngine message listener must track the current unit');
assert.ok(external.includes("data-zoneid=\\\"6052126\\\""), 'ExoClick display slot must preserve the approved publisher zone ID');
assert.ok(external.includes('data-testid="exoclick-page-placement"'), 'ExoClick page placement must have a stable test hook');
assert.ok(external.includes('return <div className="external-ad-top mx-auto w-full max-w-full py-1" data-testid="exoclick-page-placement">\\n      <AdFrame unit="exoclick-display" />'), 'Top page placement must use ExoClick display inventory');
assert.ok(app.includes("import { ExternalAdEngine } from '@/components/features/ExternalAdEngine';"), 'Shared application shell must import the external ad engine');
assert.ok(app.includes('<ExternalAdEngine key={location.pathname} surface="top"/>'), 'Shared application shell must remount the ad slot on eligible route navigation');
assert.ok(external.includes('checkout|orders|cart|payment|purchases|withdraw|withdrawals'), 'External ads must be suppressed on transactional routes');

const iptvTemplate = extractTemplate(iptv, 'adFrame.srcdoc = `', '`;');
validateEmbeddedScript(iptvTemplate, 'IPTV Adsterra banner');
assert.ok(iptv.includes("script.onerror=function(){report('empty','script-error');}"), 'IPTV banner must remove itself on script failure');
assert.ok(iptv.includes("else if(Date.now()-start>=12000)report('empty','no-creative-timeout')"), 'IPTV banner must remove itself when no creative appears');
assert.ok(iptv.includes("sponsored.style.cssText = 'display:none;"), 'IPTV Sponsored label must remain hidden until a creative is confirmed');
assert.ok(iptv.includes("candidate.contentWindow === event.source"), 'IPTV must verify the frame reporting the ad status');
assert.ok(iptv.includes("banner.remove();"), 'IPTV empty ad slots must be removed');

console.log('PASS ad slot contract: monitor scripts parse, offscreen slots do not reserve blank space, no-fill slots collapse, and Sponsored labels require a detected creative signal.');
