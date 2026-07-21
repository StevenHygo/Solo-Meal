import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const root = process.cwd();
const miniRoot = path.join(root, 'miniprogram');
const errors = [];
const checks = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
  else checks.push(message);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`Invalid JSON: ${path.relative(root, file)} (${error.message})`);
    return null;
  }
}

const projectConfig = readJson(path.join(root, 'project.config.json'));
const appConfig = readJson(path.join(miniRoot, 'app.json'));
assert(projectConfig?.miniprogramRoot === 'miniprogram/', 'project.config points to miniprogram/');
assert(Array.isArray(appConfig?.pages) && appConfig.pages.length >= 5, 'app.json declares all v0 pages');
assert(appConfig?.permission?.['scope.userLocation']?.desc, 'app.json explains location permission usage');
assert(appConfig?.requiredPrivateInfos?.includes('getLocation'), 'app.json declares getLocation private API');

for (const page of appConfig?.pages || []) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) {
    const file = path.join(miniRoot, `${page}.${extension}`);
    assert(fs.existsSync(file), `${page}.${extension} exists`);
    if (extension === 'json' && fs.existsSync(file)) readJson(file);
  }

  const jsFile = path.join(miniRoot, `${page}.js`);
  const wxmlFile = path.join(miniRoot, `${page}.wxml`);
  if (!fs.existsSync(jsFile) || !fs.existsSync(wxmlFile)) continue;

  const jsSource = fs.readFileSync(jsFile, 'utf8');
  const wxmlSource = fs.readFileSync(wxmlFile, 'utf8');
  try {
    new vm.Script(jsSource, { filename: jsFile });
    checks.push(`${page}.js parses`);
  } catch (error) {
    errors.push(`${page}.js syntax error: ${error.message}`);
  }

  const handlers = [...wxmlSource.matchAll(/(?:bind|catch)[a-zA-Z]+="([a-zA-Z0-9_]+)"/g)].map(match => match[1]);
  for (const handler of new Set(handlers)) {
    assert(new RegExp(`\\b${handler}\\s*\\(`).test(jsSource), `${page} implements ${handler}()`);
  }

  for (const tag of ['view', 'text', 'button', 'block', 'textarea']) {
    const opens = (wxmlSource.match(new RegExp(`<${tag}\\b`, 'g')) || []).length;
    const closes = (wxmlSource.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    assert(opens === closes, `${page}.wxml balances <${tag}> tags`);
  }

  const wxssFile = path.join(miniRoot, `${page}.wxss`);
  const wxssSource = fs.readFileSync(wxssFile, 'utf8');
  const openBraces = (wxssSource.match(/{/g) || []).length;
  const closeBraces = (wxssSource.match(/}/g) || []).length;
  assert(openBraces === closeBraces, `${page}.wxss balances rule braces`);
}

const storage = new Map();
globalThis.wx = {
  getStorageSync: key => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: key => storage.delete(key)
};

const require = createRequire(import.meta.url);
const repo = require(path.join(root, 'miniprogram/utils/repository.js'));
const all = repo.getRestaurants();
assert(all.length >= 6, 'mock repository has enough restaurants for filter states');
assert(repo.search({ budget: 30 }).every(item => item.priceMin <= 30), 'budget filter is enforced');
assert(repo.search({ openNow: true }).every(item => item.openNow), 'open-now filter is enforced');
assert(repo.search({ cuisine: 'noodles' }).every(item => item.cuisineCode === 'noodles'), 'cuisine filter is enforced');
assert(repo.search({ fastMeal: true }).every(item => item.mealMinutes[1] <= 40), 'fast-meal filter is enforced');
assert(repo.search({ maxDistance: 1000 }).every(item => item.distance <= 1000), 'distance filter is enforced');

const favoriteId = all[0].id;
assert(repo.toggleFavorite(favoriteId) === true, 'favorite can be added');
assert(repo.isFavorite(favoriteId), 'favorite persists');
assert(repo.toggleFavorite(favoriteId) === false, 'favorite can be removed');

const forbiddenRuntimeDependencies = /openai|anthropic|llm-gateway|xiaohongshu|douyin|social-sdk/i;
const runtimeFiles = [];
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (/\.(js|json)$/.test(entry.name)) runtimeFiles.push(full);
  }
}
collect(miniRoot);
for (const file of runtimeFiles) {
  const source = fs.readFileSync(file, 'utf8');
  assert(!forbiddenRuntimeDependencies.test(source), `${path.relative(root, file)} has no social/LLM runtime dependency`);
}

if (errors.length) {
  console.error(`Validation failed with ${errors.length} error(s):`);
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Validation passed: ${checks.length} checks.`);
console.log(`Pages: ${appConfig.pages.length}; restaurants: ${all.length}; runtime files: ${runtimeFiles.length}.`);
