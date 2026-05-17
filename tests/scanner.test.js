import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTempRepo, cleanupRepo, writeFile } from './helpers.js';
import { scanRoutes, diffRoutes } from '../src/scanner/routes.js';
import { scanHandlers, diffHandlers } from '../src/scanner/handlers.js';
import { scanHooks } from '../src/scanner/hooks.js';
import { scanDbModels, diffDbModels } from '../src/scanner/db.js';
import { auditRequirement } from '../src/scanner/diff.js';

describe('scanRoutes', () => {
  let repo;
  beforeEach(() => { repo = makeTempRepo(); });
  afterEach(() => cleanupRepo(repo));

  it('finds express-style routes', () => {
    writeFile(repo, 'src/routes/auth.ts', `
import { Router } from 'express';
const app = Router();
app.get('/api/users', listUsers);
app.post('/api/login', login);
app.delete('/api/users/:id', removeUser);
`);
    const routes = scanRoutes(repo);
    const methods = routes.map(r => `${r.method} ${r.path}`);
    expect(methods).toContain('GET /api/users');
    expect(methods).toContain('POST /api/login');
    expect(methods).toContain('DELETE /api/users/:id');
  });

  it('finds Flask-style routes', () => {
    writeFile(repo, 'app.py', `
@app.route('/api/items', methods=['GET'])
def list_items():
    pass

@app.route('/api/items', methods=['POST'])
def create_item():
    pass
`);
    const routes = scanRoutes(repo);
    const paths = routes.map(r => r.path);
    expect(paths).toContain('/api/items');
  });

  it('finds Spring @GetMapping etc', () => {
    writeFile(repo, 'Controller.java', `
@GetMapping("/users")
public List<User> list() {}

@PostMapping(value = "/users")
public User create() {}
`);
    const routes = scanRoutes(repo);
    const methods = routes.map(r => `${r.method} ${r.path}`);
    expect(methods).toContain('GET /users');
    expect(methods).toContain('POST /users');
  });

  it('finds NestJS decorators', () => {
    writeFile(repo, 'src/auth.controller.ts', `
@Controller('auth')
export class AuthController {
  @Get('login')
  login() {}
  @Post('logout')
  logout() {}
}
`);
    const routes = scanRoutes(repo);
    const paths = routes.map(r => r.path);
    expect(paths).toContain('login');
    expect(paths).toContain('logout');
  });

  it('deduplicates identical method+path matches', () => {
    writeFile(repo, 'a.ts', `app.get('/x', h);`);
    writeFile(repo, 'b.ts', `app.get('/x', h);`);
    const routes = scanRoutes(repo);
    expect(routes.filter(r => r.path === '/x').length).toBe(1);
  });
});

describe('diffRoutes', () => {
  it('returns matched / missing / extra correctly', () => {
    const expected = [
      { method: 'GET', path: '/a' },
      { method: 'POST', path: '/b' }
    ];
    const actual = [
      { method: 'GET', path: '/a', file: 'src/a.ts' },
      { method: 'GET', path: '/c', file: 'src/c.ts' }
    ];
    const diff = diffRoutes(expected, actual);
    expect(diff.matched.map(m => m.path)).toEqual(['/a']);
    expect(diff.missing.map(m => m.path)).toEqual(['/b']);
    expect(diff.extra.map(m => m.path)).toEqual(['/c']);
  });
});

describe('scanHandlers', () => {
  let repo;
  beforeEach(() => { repo = makeTempRepo(); });
  afterEach(() => cleanupRepo(repo));

  it('finds JS/TS exports', () => {
    writeFile(repo, 'src/h.ts', `
export function loginHandler(req, res) {}
export const logoutHandler = () => {};
export class UserService {}
`);
    const handlers = scanHandlers(repo);
    const names = handlers.map(h => h.name);
    expect(names).toContain('loginHandler');
    expect(names).toContain('logoutHandler');
    expect(names).toContain('UserService');
  });

  it('finds Python def and Go func', () => {
    writeFile(repo, 'src/h.py', `def my_handler(): pass`);
    writeFile(repo, 'src/h.go', `func MyHandler() {}`);
    const handlers = scanHandlers(repo);
    const names = handlers.map(h => h.name);
    expect(names).toContain('my_handler');
    expect(names).toContain('MyHandler');
  });
});

describe('diffHandlers', () => {
  let repo;
  beforeEach(() => { repo = makeTempRepo(); });
  afterEach(() => cleanupRepo(repo));

  it('matches by name, marks deviation if location differs', () => {
    const expected = ['src/handlers/auth.ts:loginHandler'];
    const actual = [{ name: 'loginHandler', file: 'src/other/place.ts' }];
    const diff = diffHandlers(expected, actual);
    expect(diff.matched).toHaveLength(1);
    expect(diff.matched[0].deviation).toContain('expected at');
  });

  it('reports missing when not found anywhere', () => {
    const expected = ['src/h.ts:missingFn'];
    const actual = [{ name: 'otherFn', file: 'src/h.ts' }];
    const diff = diffHandlers(expected, actual);
    expect(diff.missing).toHaveLength(1);
    expect(diff.matched).toHaveLength(0);
  });
});

describe('scanHooks', () => {
  let repo;
  beforeEach(() => { repo = makeTempRepo(); });
  afterEach(() => cleanupRepo(repo));

  it('finds React useXxx hooks', () => {
    writeFile(repo, 'src/hooks/useAuth.ts', `
export function useAuth() {
  return { user: null };
}
`);
    const hooks = scanHooks(repo);
    const names = hooks.map(h => h.name);
    expect(names).toContain('useAuth');
  });
});

describe('scanDbModels', () => {
  let repo;
  beforeEach(() => { repo = makeTempRepo(); });
  afterEach(() => cleanupRepo(repo));

  it('finds prisma models', () => {
    writeFile(repo, 'prisma/schema.prisma', `
model User {
  id String @id
}

model Session {
  id String @id
}
`);
    const models = scanDbModels(repo);
    const names = models.map(m => m.name);
    expect(names).toContain('User');
    expect(names).toContain('Session');
  });

  it('finds Django models', () => {
    writeFile(repo, 'app/models.py', `
class User(models.Model):
    pass

class Profile(models.Model):
    pass
`);
    const models = scanDbModels(repo);
    expect(models.map(m => m.name)).toEqual(expect.arrayContaining(['User', 'Profile']));
  });

  it('finds Mongoose models', () => {
    writeFile(repo, 'src/models/User.ts', `
const UserModel = mongoose.model('User', schema);
`);
    const models = scanDbModels(repo);
    expect(models.map(m => m.name)).toContain('User');
  });
});

describe('diffDbModels', () => {
  it('matches by name, missing reported separately', () => {
    const diff = diffDbModels(['User', 'Missing'], [{ name: 'User', file: 'a.ts' }]);
    expect(diff.matched).toHaveLength(1);
    expect(diff.missing.map(m => m.name)).toEqual(['Missing']);
  });
});

describe('auditRequirement', () => {
  let repo;
  beforeEach(() => { repo = makeTempRepo(); });
  afterEach(() => cleanupRepo(repo));

  it('produces summary with completion percentage', () => {
    writeFile(repo, 'src/routes/auth.ts', `app.post('/login', login);`);
    const prd = {
      expects: {
        routes: [{ method: 'POST', path: '/login' }, { method: 'POST', path: '/logout' }],
        handlers: [],
        hooks: [],
        db_models: []
      }
    };
    const audit = auditRequirement(prd, repo);
    expect(audit.summary.matched).toBe(1);
    expect(audit.summary.missing).toBe(1);
    expect(audit.summary.completion).toBe(50);
  });

  it('returns 100% when no expects.* declared (vacuously true)', () => {
    const prd = { expects: {} };
    const audit = auditRequirement(prd, repo);
    expect(audit.summary.matched).toBe(0);
    expect(audit.summary.missing).toBe(0);
    expect(audit.summary.completion).toBe(100);
  });
});
