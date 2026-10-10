import assert from 'node:assert/strict';
import fs from 'node:fs';

const externalPath = 'src/components/features/ExternalAdEngine.tsx';
const iptvPath = 'src/pages/TikVTVPage.tsx';
const external = fs.readFileSync(externalPath, 'utf8');
const iptv = fs.readFileSync(iptvPath, 'utf8');

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
assert.ok(external.includes("}, [unit]);"), 'ExternalAdEngine message listener must track the current unit');

const iptvTemplate = extractTemplate(iptv, 'adFrame.srcdoc = `', '`;');
validateEmbeddedScript(iptvTemplate, 'IPTV Adsterra banner');
assert.ok(iptv.includes("script.onerror=function(){report('empty','script-error');}"), 'IPTV banner must remove itself on script failure');
assert.ok(iptv.includes("else if(Date.now()-start>=12000)report('empty','no-creative-timeout')"), 'IPTV banner must remove itself when no creative appears');
assert.ok(iptv.includes("sponsored.style.cssText = 'display:none;"), 'IPTV Sponsored label must remain hidden until a creative is confirmed');
assert.ok(iptv.includes("candidate.contentWindow === event.source"), 'IPTV must verify the frame reporting the ad status');
assert.ok(iptv.includes("banner.remove();"), 'IPTV empty ad slots must be removed');

console.log('PASS ad slot contract: monitor scripts parse, no-fill slots collapse, and Sponsored labels require a detected creative.');
