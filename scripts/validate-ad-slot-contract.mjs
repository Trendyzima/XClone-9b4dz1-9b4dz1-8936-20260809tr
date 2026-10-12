import assert from 'node:assert/strict';
import fs from 'node:fs';

const externalPath = 'src/components/features/ExternalAdEngine.tsx';
const iptvPath = 'src/pages/TikVTVPage.tsx';
const appPath = 'src/App.tsx';
const external = fs.readFileSync(externalPath, 'utf8');
const iptv = fs.readFileSync(iptvPath, 'utf8');
const app = fs.readFileSync(appPath, 'utf8');
const ownedAds = fs.readFileSync('src/components/features/TestagramAdSlot.tsx', 'utf8');

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
assert.ok(external.includes('minHeight: filled ? ad.height : 0'), 'ExternalAdEngine must not reserve vertical space until a creative is confirmed');
assert.ok(external.includes('loading="eager"'), 'ExternalAdEngine must not lazy-load after the visibility probe has fired');
assert.ok(!external.includes('relative h-px w-full overflow-hidden'), 'ExternalAdEngine must not collapse the slot to one pixel while waiting');
assert.ok(!external.includes('-z-10 overflow-hidden opacity-0'), 'ExternalAdEngine must not hide the publisher frame while waiting for creative detection');
assert.ok(external.includes("report('empty','script-error')"), 'ExternalAdEngine must distinguish script errors from no-fill timeouts');
assert.ok(external.includes("}, [unit]);"), 'ExternalAdEngine message listener must track the current unit');
assert.ok(external.includes('data-zoneid="6052126"'), 'ExoClick display slot must preserve the approved publisher zone ID');
assert.ok(!external.includes('external-ad-top'), 'External ads must not create a global top-of-page placement');
assert.ok(!external.includes('data-testid="exoclick-page-placement"'), 'The global top-page placement hook must be removed');
assert.ok(!app.includes("import { ExternalAdEngine } from '@/components/features/ExternalAdEngine';"), 'The shared application shell must not inject ads above every route');
assert.ok(!app.includes('surface="top"'), 'No route may inject the external ad engine as a global top banner');
assert.ok(external.includes("surface: 'sidebar' | 'overlay' | 'feed'"), 'External ads must be restricted to content-native feed, sidebar, and player-overlay surfaces');
assert.ok(external.includes("if (surface === 'feed') return <AdFrame unit=\"exoclick-display\" feedNative />;"), 'External display inventory must be placed as a native sponsored feed item');
assert.ok(external.includes('checkout|orders|cart|payment|purchases|withdraw|withdrawals'), 'External ads must be suppressed on transactional routes');
assert.ok(external.includes('ad-[^/]+'), 'External ads must be suppressed on ad-management routes');

const iptvTemplate = extractTemplate(iptv, 'adFrame.srcdoc = `', '`;');
validateEmbeddedScript(iptvTemplate, 'IPTV Adsterra banner');
assert.ok(iptv.includes("script.onerror=function(){report('empty','script-error');}"), 'IPTV banner must remove itself on script failure');
assert.ok(iptv.includes("else if(Date.now()-start>=12000)report('empty','no-creative-timeout')"), 'IPTV banner must remove itself when no creative appears');
assert.ok(iptv.includes("sponsored.style.cssText = 'display:none;"), 'IPTV Sponsored label must remain hidden until a creative is confirmed');
assert.ok(iptv.includes("candidate.contentWindow === event.source"), 'IPTV must verify the frame reporting the ad status');
assert.ok(iptv.includes("banner.remove();"), 'IPTV empty ad slots must be removed');
assert.ok(iptv.includes("request.adTagUrl = 'https://s.magsrv.com/v1/vast.php?idzone=6052130';"), 'ExoClick VAST publisher URL must remain byte-for-byte unchanged');
assert.ok(iptv.includes("exoButton.textContent = 'Play sponsored video';"), 'ExoClick VAST must be requested from an explicit viewer action');
assert.ok(iptv.includes("exoButton.addEventListener('click'"), 'ExoClick VAST CTA must own the user-initiated request path');
assert.ok(!iptv.includes('if (allowFullscreenIma) startAd(card)'), 'ExoClick VAST must not depend on a hidden fullscreen opt-in');
assert.ok(iptv.includes("width:min(360px,calc(100% - 24px))") && iptv.includes("overlay.clientWidth || 320"), 'ExoClick VAST must render and request inventory at bounded inline-player dimensions');
assert.ok(!iptv.includes("position:absolute;inset:0;z-index:9999;width:100%;height:100%;min-height:100dvh"), 'ExoClick VAST must not take over the full vertical-video slide');

const apiWorkflowPath = '.github/workflows/adsterra-publisher-api-check.yml';
const apiWorkflow = fs.readFileSync(apiWorkflowPath, 'utf8');
assert.ok(apiWorkflow.includes('workflow_dispatch:'), 'Adsterra credential validation must be manually triggered');
assert.ok(apiWorkflow.includes('${{ secrets.api_token_1 }}'), 'Adsterra API workflow must read the api_token_1 Actions secret');
assert.ok(apiWorkflow.includes('https://api3.adsterratools.com/publisher/domains.json'), 'Adsterra workflow must call the documented publisher domains endpoint');
assert.ok(apiWorkflow.includes('X-API-Key:'), 'Adsterra token must be sent in the request header, not URL');
assert.ok(!apiWorkflow.includes('set -x'), 'Adsterra workflow must not enable shell tracing around secrets');
assert.ok(apiWorkflow.includes('Response body suppressed'), 'Adsterra workflow must suppress API response bodies in error logs');
assert.ok(apiWorkflow.includes('jq -e .'), 'Adsterra workflow must validate a successful JSON response');

assert.ok(ownedAds.includes('const requiredVisibleMs = 1000'), 'Owned ad impressions must require one continuous second of visibility');
assert.ok(ownedAds.includes('entry.intersectionRatio >= 0.5'), 'Owned ad viewability must require at least 50% visibility');
assert.ok(ownedAds.includes("document.addEventListener('visibilitychange'"), 'Owned ad viewability must respond to background/foreground transitions');
assert.ok(ownedAds.includes('window.setTimeout(confirmViewable, requiredVisibleMs)'), 'Owned ad viewability must defer event recording until the dwell-time threshold');
assert.ok(ownedAds.includes('continuousVisibleMs'), 'Owned ad viewable events must include the observed dwell time');

console.log('PASS ad slot contract: external ad monitors parse, placements are guarded, owned ad viewability requires sustained visibility, and Adsterra credentials stay protected.');
