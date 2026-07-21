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

for (const file of ['index.html', 'styles.css', 'app.js', 'data.js', '.nojekyll']) {
  assert(fs.existsSync(path.join(webRoot, file)), `web/${file} exists`);
}

const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const data = fs.readFileSync(path.join(webRoot, 'data.js'), 'utf8');

assert(html.includes('type="module" src="./app.js"'), 'HTML loads the module entry');
assert(html.includes('href="./styles.css"'), 'HTML loads relative GitHub Pages CSS');
assert(app.includes("from './data.js'"), 'app imports data with a relative URL');
assert(!/(openai|anthropic|llm-gateway|xiaohongshu|douyin|wechat|wx\.)/i.test(app + data), 'web runtime has no social, LLM, or WeChat dependency');
assert(!/https?:\/\//.test(html + css), 'HTML and CSS do not depend on external assets');

try {
  new vm.Script(app.replace(/^import .*?;\s*/m, 'const restaurants = [];\n'), { filename: 'web/app.js' });
  checks.push('web/app.js parses');
} catch (error) {
  errors.push(`web/app.js syntax error: ${error.message}`);
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

const requiredFeatures = ['searchRestaurants', 'renderResults', 'renderMap', 'openDetail', 'renderFavorites', 'submitReport', 'requestLocation'];
for (const feature of requiredFeatures) assert(new RegExp(`function ${feature}\\(`).test(app), `${feature} is implemented`);

const records = (data.match(/\bid:\s*'r\d+'/g) || []).length;
assert(records >= 6, 'web data includes at least six restaurants');

if (errors.length) {
  console.error(`Web validation failed with ${errors.length} error(s):`);
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Web validation passed: ${checks.length} checks.`);
console.log(`HTML IDs: ${ids.length}; restaurant records: ${records}.`);
