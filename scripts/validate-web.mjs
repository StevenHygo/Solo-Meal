import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const webRoot = path.join(root, 'web');
const errors = [];
const checks = [];

function assert(condition, message) {
  if (condition) checks.push(message);
  else errors.push(message);
}

for (const file of ['index.html', 'styles.css', 'app.js', 'config.js', 'data.js', 'services/api-client.js', 'services/restaurant-repository.js', 'ops/index.html', 'ops/styles.css', 'ops/app.js', '.nojekyll']) {
  assert(fs.existsSync(path.join(webRoot, file)), `web/${file} exists`);
}

const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const config = fs.readFileSync(path.join(webRoot, 'config.js'), 'utf8');
const data = fs.readFileSync(path.join(webRoot, 'data.js'), 'utf8');
const apiClient = fs.readFileSync(path.join(webRoot, 'services', 'api-client.js'), 'utf8');
const restaurantRepository = fs.readFileSync(path.join(webRoot, 'services', 'restaurant-repository.js'), 'utf8');
const opsHtml = fs.readFileSync(path.join(webRoot, 'ops', 'index.html'), 'utf8');
const opsCss = fs.readFileSync(path.join(webRoot, 'ops', 'styles.css'), 'utf8');
const opsApp = fs.readFileSync(path.join(webRoot, 'ops', 'app.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function stripModuleSyntax(source) {
  return source
    .replace(/^import[\s\S]*?\bfrom\s+['"][^'"]+['"];\s*/gm, '')
    .replace(/^export\s+/gm, '');
}

assert(html.includes('type="module" src="./app.js"'), 'HTML loads the module entry');
assert(html.includes('href="./styles.css"'), 'HTML loads relative GitHub Pages CSS');
assert(html.includes('href="./assets/cuisine/rice-meal.svg"'), 'HTML uses a local SVG favicon');
assert(app.includes("from './config.js'"), 'app imports v1 config with a relative URL');
assert(app.includes("from './services/restaurant-repository.js'"), 'app imports the repository with a relative URL');
assert(!app.includes("from './data.js'"), 'app does not bypass the repository to read fixture data');
assert(restaurantRepository.includes("from '../data.js'"), 'repository owns the static fixture adapter');
assert(restaurantRepository.includes("from './api-client.js'"), 'repository owns the API adapter');
assert(!/(openai|anthropic|llm-gateway|xiaohongshu|douyin|wechat|wx\.)/i.test(app + data + apiClient + restaurantRepository), 'web runtime has no social, LLM, or WeChat dependency');
assert(!/https?:\/\//.test(html + css), 'HTML and CSS do not depend on external assets');
assert(html.includes('SOLO MEAL / V1 BETA'), 'HTML identifies the v1 Beta');
assert(html.includes('<h1>一个人也要<br /><em>好好吃饭</em></h1>'), 'public hero preserves the original brand line');
assert(packageJson.version === '1.0.0-beta.1', 'package version matches the v1 Beta release');
assert(/defaultMode:\s*'static'/.test(config), 'static data remains the default during migration');
assert(apiClient.includes("query.get('dataSource') === 'api'"), 'API mode requires an explicit runtime flag');
assert(restaurantRepository.includes('item.legacy_id || item.id'), 'API records preserve legacy restaurant IDs when available');
assert(restaurantRepository.includes("source: 'fallback'"), 'repository exposes static fallback metadata');
assert(restaurantRepository.includes("source: 'cache'"), 'repository exposes last-result cache metadata');
assert(restaurantRepository.includes('successfulSearches.get(cacheKey)'), 'API cache is scoped to the current query');
assert(app.includes("coordType: 'wgs84'"), 'browser geolocation is labeled as WGS84');
assert(app.includes('restaurantRepository.getCachedRestaurant'), 'local workflows read through the repository cache');
assert(app.includes('formatCacheTime(state.dataSource.cachedAt)'), 'cached results expose their successful query time');
assert(apiClient.includes("'/api/v1/feedback-reports'"), 'API client exposes the feedback endpoint');
assert(restaurantRepository.includes('async submitFeedback(input)'), 'repository owns feedback delivery and local fallback');
assert(app.includes("syncStatus: 'local'"), 'feedback starts with an explicit local delivery state');
assert(app.includes('syncPendingReports'), 'pending feedback requires an explicit retry action');

try {
  new vm.Script(stripModuleSyntax(app), { filename: 'web/app.js' });
  checks.push('web/app.js parses');
} catch (error) {
  errors.push(`web/app.js syntax error: ${error.message}`);
}

try {
  new vm.Script(stripModuleSyntax(config), { filename: 'web/config.js' });
  checks.push('web/config.js parses');
} catch (error) {
  errors.push(`web/config.js syntax error: ${error.message}`);
}

try {
  new vm.Script(stripModuleSyntax(data), { filename: 'web/data.js' });
  checks.push('web/data.js parses');
} catch (error) {
  errors.push(`web/data.js syntax error: ${error.message}`);
}

for (const [filename, source] of [['web/services/api-client.js', apiClient], ['web/services/restaurant-repository.js', restaurantRepository]]) {
  try {
    new vm.Script(stripModuleSyntax(source), { filename });
    checks.push(`${filename} parses`);
  } catch (error) {
    errors.push(`${filename} syntax error: ${error.message}`);
  }
}

try {
  new vm.Script(stripModuleSyntax(opsApp), { filename: 'web/ops/app.js' });
  checks.push('web/ops/app.js parses');
} catch (error) {
  errors.push(`web/ops/app.js syntax error: ${error.message}`);
}

assert(opsHtml.includes('type="module" src="./app.js"'), 'operator HTML loads its module entry');
assert(opsHtml.includes('name="robots" content="noindex,nofollow"'), 'operator page opts out of indexing');
assert(opsHtml.includes('http-equiv="Content-Security-Policy"'), 'operator page defines a content security policy');
const operatorUsesExternalAsset = /(?:src|href)=["']https?:\/\//.test(opsHtml)
  || /url\(\s*["']?https?:\/\//.test(opsCss);
assert(!operatorUsesExternalAsset, 'operator HTML and CSS do not depend on external assets');
assert(!/localStorage|sessionStorage/.test(opsApp), 'operator credentials are not persisted in browser storage');
assert(opsApp.includes("authorization: `Bearer ${state.token}`"), 'operator requests use bearer authorization');
assert(opsApp.includes("parsedUrl.protocol !== 'https:'"), 'operator API rejects insecure non-local endpoints');
assert(opsApp.includes("'/api/v1/admin/poi/imports'"), 'operator workbench imports authorized POI candidates');
assert(opsApp.includes('/api/v1/admin/poi/candidates'), 'operator workbench reads and reviews POI candidates');
assert(opsApp.includes('/api/v1/admin/coverage/'), 'operator workbench reads coverage quality gates');
assert(opsApp.includes("request('/api/v1/admin/coverage')"), 'operator workbench reads managed city and area states');
assert(opsApp.includes('/api/v1/admin/cities/${encodeURIComponent(id)}/status'), 'operator workbench updates city coverage states');
assert(opsApp.includes('/api/v1/admin/coverage/${encodeURIComponent(id)}/status'), 'operator workbench updates area coverage states');
assert(opsApp.includes('/api/v1/admin/evidence/expiring?'), 'operator workbench reads evidence freshness warnings');
assert(opsApp.includes('/api/v1/admin/restaurants?status='), 'operator workbench reads restaurant publication queues');
assert(opsApp.includes('/api/v1/admin/poi/candidates/${encodeURIComponent(state.draftCandidate.id)}/draft'), 'operator workbench creates drafts from new branch candidates');
assert(opsApp.includes("method: creating ? 'POST' : 'PUT'"), 'operator workbench creates and updates normalized drafts');
assert(opsApp.includes('/transitions'), 'operator workbench submits publication transitions');
assert(opsApp.includes("action === 'submit_review'"), 'operator workbench exposes review submission');
assert(opsApp.includes("action === 'publish'"), 'operator workbench exposes second-operator publication');
assert(opsApp.includes("action === 'withdraw'"), 'operator workbench exposes withdrawal');
assert(opsApp.includes('state.poiImportCandidates'), 'operator POI files remain in page memory only');
assert(opsApp.includes('maximumFractionDigits: 1'), 'operator quality percentages retain one decimal when needed');
assert(!/data-poi-action="publish"/.test(opsHtml + opsApp), 'POI candidate workflow cannot publish restaurants directly');
assert(opsHtml.includes('data-mode="restaurants"'), 'operator workbench has a restaurant publication mode');
assert(opsHtml.includes('id="restaurantDraftForm"'), 'operator workbench provides a structured restaurant draft form');
assert(opsHtml.includes('data-mode="operations"'), 'operator workbench has an audit and delivery mode');
assert(opsHtml.includes('id="coverageBand"'), 'operator workbench provides city and area coverage controls');
assert(opsHtml.includes('id="coverageReasonInput"'), 'coverage status changes require an operator reason');
assert(opsHtml.includes('id="expiryFilterForm"'), 'operator workbench provides evidence expiry filters');
assert(opsApp.includes('/api/v1/admin/outbox-events?status='), 'operator workbench reads outbox delivery queues');
assert(opsApp.includes('/api/v1/admin/audit-logs?'), 'operator workbench filters audit logs');
assert(opsApp.includes('/retry'), 'operator workbench retries failed outbox events');
assert(opsApp.includes('/api/v1/admin/exports/'), 'operator workbench downloads controlled CSV exports');
assert(opsCss.includes('@media (max-width: 560px)') && opsCss.includes('.compact-grid'), 'operator draft form has a mobile layout contract');
assert(opsCss.includes('.coverage-row { grid-template-columns: minmax(0, 1fr) 96px;'), 'coverage controls collapse for narrow mobile screens');
assert(opsCss.includes('.audit-row, .expiry-row { grid-template-columns: 64px minmax(0, 1fr);'), 'evidence expiry rows collapse for narrow mobile screens');

const opsIds = [...opsHtml.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert(new Set(opsIds).size === opsIds.length, 'operator HTML IDs are unique');
for (const id of new Set([...opsApp.matchAll(/el\('([^']+)'\)/g)].map(match => match[1]))) {
  assert(opsIds.includes(id), `operator HTML provides #${id}`);
}

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert(new Set(ids).size === ids.length, 'HTML IDs are unique');
for (const id of new Set([...app.matchAll(/el\('([^']+)'\)/g)].map(match => match[1]))) {
  assert(ids.includes(id), `HTML provides #${id}`);
}

const openBraces = (css.match(/{/g) || []).length;
const closeBraces = (css.match(/}/g) || []).length;
assert(openBraces === closeBraces, 'CSS braces are balanced');
assert((opsCss.match(/{/g) || []).length === (opsCss.match(/}/g) || []).length, 'operator CSS braces are balanced');

const requiredFeatures = ['searchRestaurants', 'renderResults', 'renderMap', 'renderCoverageState', 'renderLocationSuggestions', 'selectLocation', 'openDetail', 'renderFavorites', 'submitReport', 'requestLocation'];
for (const feature of requiredFeatures) assert(new RegExp(`(?:async\\s+)?function ${feature}\\(`).test(app), `${feature} is implemented`);

const records = (data.match(/\bid:\s*'r\d+'/g) || []).length;
assert(records >= 6, 'web data includes at least six restaurants');
assert((data.match(/\bcityCode:\s*'[^']+'/g) || []).length === records, 'every restaurant has a city code');
assert((data.match(/\bcoverageAreaCode:\s*'[^']+'/g) || []).length === records, 'every restaurant has a coverage area code');

const categoryMatches = [...config.matchAll(/\{ code: '([a-z_]+)', label: '([^']+)', icon: '([^']+)' \}/g)];
const categoryCodes = new Set(categoryMatches.map(match => match[1]));
assert(categoryMatches.length === 16, 'config defines exactly 16 cuisine categories');
assert(categoryCodes.size === categoryMatches.length, 'cuisine category codes are unique');
assert(categoryCodes.has('other'), 'cuisine config provides an other fallback');

const iconFiles = fs.readdirSync(path.join(webRoot, 'assets', 'cuisine')).filter(file => file.endsWith('.svg'));
assert(iconFiles.length === 16, 'cuisine asset directory contains exactly 16 SVG files');
for (const [, code, , relativeIconPath] of categoryMatches) {
  const iconPath = path.join(webRoot, relativeIconPath.replace(/^\.\//, ''));
  assert(fs.existsSync(iconPath), `${code} icon exists`);
  if (!fs.existsSync(iconPath)) continue;
  const svg = fs.readFileSync(iconPath, 'utf8');
  assert(Buffer.byteLength(svg) < 4096, `${code} icon is smaller than 4 KB`);
  assert(svg.includes('viewBox="0 0 24 24"'), `${code} icon uses the 24px viewBox`);
  assert(svg.includes('currentColor'), `${code} icon inherits currentColor`);
  assert(!/<(?:script|image|foreignObject)\b|\bhref=|javascript:/i.test(svg), `${code} icon has no active or external content`);
}

const restaurantCuisineCodes = [...data.matchAll(/\bcuisineCode:\s*'([^']+)'/g)].map(match => match[1]);
assert(restaurantCuisineCodes.length === records, 'every restaurant has a cuisine code');
for (const code of restaurantCuisineCodes) assert(categoryCodes.has(code), `restaurant cuisine ${code} exists in config`);

for (const status of ['live', 'beta', 'upcoming', 'paused', 'unsupported']) {
  assert(new RegExp(`\\b${status}: \\{`).test(config), `coverage status ${status} is configured`);
}

if (errors.length) {
  console.error(`Web validation failed with ${errors.length} error(s):`);
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Web validation passed: ${checks.length} checks.`);
console.log(`HTML IDs: ${ids.length}; restaurant records: ${records}.`);
