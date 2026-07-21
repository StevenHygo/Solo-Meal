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

for (const file of ['index.html', 'styles.css', 'app.js', 'config.js', 'data.js', '.nojekyll']) {
  assert(fs.existsSync(path.join(webRoot, file)), `web/${file} exists`);
}

const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const config = fs.readFileSync(path.join(webRoot, 'config.js'), 'utf8');
const data = fs.readFileSync(path.join(webRoot, 'data.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert(html.includes('type="module" src="./app.js"'), 'HTML loads the module entry');
assert(html.includes('href="./styles.css"'), 'HTML loads relative GitHub Pages CSS');
assert(html.includes('href="./assets/cuisine/rice-meal.svg"'), 'HTML uses a local SVG favicon');
assert(app.includes("from './data.js'"), 'app imports data with a relative URL');
assert(app.includes("from './config.js'"), 'app imports v1 config with a relative URL');
assert(!/(openai|anthropic|llm-gateway|xiaohongshu|douyin|wechat|wx\.)/i.test(app + data), 'web runtime has no social, LLM, or WeChat dependency');
assert(!/https?:\/\//.test(html + css), 'HTML and CSS do not depend on external assets');
assert(html.includes('SOLO MEAL / V1 BETA'), 'HTML identifies the v1 Beta');
assert(packageJson.version === '1.0.0-beta.1', 'package version matches the v1 Beta release');

try {
  const appWithoutImports = app.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '');
  new vm.Script(`const restaurants = [];\nconst WEB_VERSION = '';\nconst cities = [];\nconst coverageStatus = {};\nconst cuisineCategories = [];\nconst getCity = () => {};\nconst getCoverageArea = () => {};\nconst getCuisine = () => ({ icon: '', label: '' });\nconst locationSuggestions = [];\n${appWithoutImports}`, { filename: 'web/app.js' });
  checks.push('web/app.js parses');
} catch (error) {
  errors.push(`web/app.js syntax error: ${error.message}`);
}

try {
  new vm.Script(config.replaceAll('export ', ''), { filename: 'web/config.js' });
  checks.push('web/config.js parses');
} catch (error) {
  errors.push(`web/config.js syntax error: ${error.message}`);
}

try {
  new vm.Script(data.replace(/^export\s+/, ''), { filename: 'web/data.js' });
  checks.push('web/data.js parses');
} catch (error) {
  errors.push(`web/data.js syntax error: ${error.message}`);
}

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert(new Set(ids).size === ids.length, 'HTML IDs are unique');
for (const id of new Set([...app.matchAll(/el\('([^']+)'\)/g)].map(match => match[1]))) {
  assert(ids.includes(id), `HTML provides #${id}`);
}

const openBraces = (css.match(/{/g) || []).length;
const closeBraces = (css.match(/}/g) || []).length;
assert(openBraces === closeBraces, 'CSS braces are balanced');

const requiredFeatures = ['searchRestaurants', 'renderResults', 'renderMap', 'renderCoverageState', 'renderLocationSuggestions', 'selectLocation', 'openDetail', 'renderFavorites', 'submitReport', 'requestLocation'];
for (const feature of requiredFeatures) assert(new RegExp(`function ${feature}\\(`).test(app), `${feature} is implemented`);

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
