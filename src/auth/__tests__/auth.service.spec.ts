jest.mock('bcrypt-ts', () => ({
  compare: jest.fn(async (plain: string, hashed: string) => plain === hashed),
  hashSync: jest.fn((plain: string) => plain),
}));

import { AuthService } from '../auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtConfig } from '../../config/jwt.config';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';

function mockRepo() {
  const store: any[] = [];
  const repo: any = {};
  repo.count = jest.fn(async () => store.length);
  repo.save = jest.fn(async (e: any) => {
    if (Array.isArray(e)) {
      return Promise.all(
        e.map((i) => ((i.id = store.length + 1), store.push(i), i)),
      );
    }
    if (!e.id) e.id = store.length + 1;
    store.push(e);
    return e;
  });
  repo.findOne = jest.fn(async (...args: any[]) => {
    const opts = args.length === 1 ? args[0] : args[1];
    const where = opts?.where || {};
    return (
      store.find((u) => {
        if (where.username && u.username !== where.username) return false;
        if (where.id && u.id !== where.id) return false;
        if (where.role && u.role !== where.role) return false;
        if (typeof where.builtIn === 'boolean' && u.builtIn !== where.builtIn)
          return false;
        return true;
      }) || null
    );
  });
  repo.find = jest.fn(async () => store);
  repo.create = jest.fn((x: any) => x);
  repo.remove = jest.fn(async (u: any) => {
    const idx = store.indexOf(u);
    if (idx >= 0) store.splice(idx, 1);
  });
  repo.manager = {
    transaction: jest.fn(async (fn: any) => fn(repo)),
  };
  return repo as Repository<User>;
}

describe('AuthService', () => {
  const jwt = new JwtService();
  const cfg = {
    secret: 's',
    expiresIn: '1h',
    refreshExpiresIn: '7d',
  } as JwtConfig;
  const cs = {
    get: jest.fn((key: string) => {
      if (key === 'jwt') return cfg;
      if (key === 'ADMIN_USERNAME') return 'admin';
      if (key === 'ADMIN_PASSWORD') return 'admin';
      if (key === 'USER_USERNAME') return 'user';
      if (key === 'USER_PASSWORD') return 'user';
      return undefined;
    }),
  } as unknown as ConfigService;
  const repo = mockRepo();

  it('issues and refreshes tokens', async () => {
    const svc = new AuthService(repo, jwt, cs);
    await svc.seedIfEmpty();
    const user = await svc.validateUser('admin', 'admin');
    const loginRes = await svc.login(user);
    expect(loginRes.tokens.accessToken).toBeTruthy();
    const refreshed = await svc.refresh(loginRes.tokens.refreshToken);
    expect(refreshed.tokens.accessToken).toBeTruthy();
    expect(refreshed.user.username).toBe('admin');
  });

  it('creates and deletes non built-in user, blocks built-in delete', async () => {
    const svc = new AuthService(repo, jwt, cs);
    await svc.seedIfEmpty();
    const created = await svc.createUser({
      username: 'alice',
      password: '123',
      role: 'user',
    });
    expect(created.username).toBe('alice');
    const deleted = await svc.deleteSelf(created.id);
    expect(deleted.username).toBe('alice');
    await expect(svc.deleteSelf(1)).rejects.toThrow();
  });
});
