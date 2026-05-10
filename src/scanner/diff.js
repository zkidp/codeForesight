import { scanRoutes, diffRoutes } from './routes.js';
import { scanHandlers, diffHandlers } from './handlers.js';
import { scanHooks, diffHooks } from './hooks.js';
import { scanDbModels, diffDbModels } from './db.js';

export function auditRequirement(prd, repo) {
  const expects = prd.expects || {};
  const actual = {
    routes: scanRoutes(repo),
    handlers: scanHandlers(repo),
    hooks: scanHooks(repo),
    db_models: scanDbModels(repo)
  };
  const result = {
    routes: diffRoutes(expects.routes, actual.routes),
    handlers: diffHandlers(expects.handlers, actual.handlers),
    hooks: diffHooks(expects.hooks, actual.hooks),
    db_models: diffDbModels(expects.db_models, actual.db_models)
  };
  result.summary = summarize(result);
  return result;
}

function summarize(d) {
  let matched = 0, missing = 0, extra = 0, deviations = 0;
  for (const k of ['routes', 'handlers', 'hooks', 'db_models']) {
    matched += d[k].matched.length;
    missing += d[k].missing.length;
    extra += d[k].extra?.length || 0;
    deviations += d[k].matched.filter(m => m.deviation).length;
  }
  const total = matched + missing;
  const completion = total ? matched / total : 1;
  return { matched, missing, extra, deviations, completion: Math.round(completion * 1000) / 10 };
}
