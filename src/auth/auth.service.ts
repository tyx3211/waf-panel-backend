import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hashSync } from 'bcrypt-ts';
import { ConfigService } from '@nestjs/config';
import { JwtConfig } from '../config/jwt.config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { OnModuleInit } from '@nestjs/common';
import type { JwtSignOptions } from '@nestjs/jwt';
import type { JwtPayload } from './jwt.strategy';

export interface UserPayload {
  id: number;
  username: string;
  role: 'admin' | 'user';
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  refreshExpiresIn: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
    private readonly jwt: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureBuiltins();
  }

  async seedIfEmpty(): Promise<void> {
    await this.ensureBuiltins();
  }

  async ensureBuiltins(): Promise<void> {
    const adminUsername = this.getEnvValue('ADMIN_USERNAME', 'admin');
    const adminPassword = this.getEnvValue('ADMIN_PASSWORD', 'admin');
    const userUsername = this.getEnvValue('USER_USERNAME', 'user');
    const userPassword = this.getEnvValue('USER_PASSWORD', 'user');

    await this.upsertBuiltInUser({
      role: 'admin',
      username: adminUsername,
      password: adminPassword,
      displayName: 'Admin',
    });
    await this.upsertBuiltInUser({
      role: 'user',
      username: userUsername,
      password: userPassword,
      displayName: 'User',
    });
  }

  private getEnvValue(key: string, fallback: string): string {
    const value = this.configService.get<string>(key);
    if (!value || typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  private async upsertBuiltInUser(input: {
    role: 'admin' | 'user';
    username: string;
    password: string;
    displayName: string;
  }): Promise<void> {
    const existing = await this.repo.findOne({
      where: { role: input.role, builtIn: true },
    });
    if (!existing) {
      const conflict = await this.repo.findOne({
        where: { username: input.username },
      });
      if (conflict) {
        throw new Error(
          `built-in ${input.role} username conflicts with existing user`,
        );
      }
      const created = this.repo.create({
        username: input.username,
        passwordHash: hashSync(input.password, 8),
        role: input.role,
        displayName: input.displayName,
        builtIn: true,
      });
      await this.repo.save(created);
      this.logger.log(`created built-in ${input.role} user`);
      return;
    }

    let changed = false;
    if (existing.username !== input.username) {
      const conflict = await this.repo.findOne({
        where: { username: input.username },
      });
      if (conflict && conflict.id !== existing.id) {
        throw new Error(
          `built-in ${input.role} username conflicts with existing user`,
        );
      }
      existing.username = input.username;
      changed = true;
    }
    if (!(await compare(input.password, existing.passwordHash))) {
      existing.passwordHash = hashSync(input.password, 8);
      changed = true;
    }
    if (existing.displayName !== input.displayName) {
      existing.displayName = input.displayName;
      changed = true;
    }
    if (!existing.builtIn) {
      existing.builtIn = true;
      changed = true;
    }
    if (changed) {
      await this.repo.save(existing);
      this.logger.log(`updated built-in ${input.role} user`);
    }
  }

  async validateUser(username: string, password: string): Promise<UserPayload> {
    const user = await this.repo.findOne({ where: { username } });
    if (!user) throw new UnauthorizedException('invalid credentials');
    const ok = await compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('invalid credentials');
    return { id: user.id, username: user.username, role: user.role };
  }

  async login(payload: UserPayload) {
    return this.issueTokens(payload);
  }

  listUsers() {
    return this.repo.find({
      select: [
        'id',
        'username',
        'role',
        'displayName',
        'builtIn',
        'createdAt',
        'updatedAt',
      ],
    });
  }

  async createUser(dto: {
    username: string;
    password: string;
    role: 'admin' | 'user';
    displayName?: string;
  }) {
    const existed = await this.repo.findOne({
      where: { username: dto.username },
    });
    if (existed) throw new UnauthorizedException('user exists');
    const entity = this.repo.create({
      username: dto.username,
      passwordHash: hashSync(dto.password, 8),
      role: dto.role,
      displayName: dto.displayName,
      builtIn: false,
    });
    const saved = await this.repo.save(entity);
    const sanitized = { ...saved };
    delete (sanitized as Partial<User>).passwordHash;
    return sanitized;
  }

  async getUser(id: number) {
    const u = await this.repo.findOne({ where: { id } });
    if (!u) return null;
    const sanitized = { ...u };
    delete (sanitized as Partial<User>).passwordHash;
    return sanitized;
  }

  async refresh(
    refreshToken: string,
  ): Promise<{ tokens: Tokens; user: UserPayload }> {
    const cfg = this.configService.get<JwtConfig>('jwt')!;
    const decoded = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
      secret: cfg.secret,
    });
    if (decoded?.type !== 'refresh') {
      throw new UnauthorizedException('invalid refresh token');
    }
    const user: UserPayload = {
      id: decoded.id,
      username: decoded.username,
      role: decoded.role,
    };
    return this.issueTokens(user);
  }

  private async issueTokens(
    payload: UserPayload,
  ): Promise<{ tokens: Tokens; user: UserPayload }> {
    const cfg = this.configService.get<JwtConfig>('jwt')!;
    const accessExpire: JwtSignOptions['expiresIn'] =
      cfg.expiresIn as JwtSignOptions['expiresIn'];
    const refreshExpire: JwtSignOptions['expiresIn'] =
      cfg.refreshExpiresIn as JwtSignOptions['expiresIn'];
    const accessToken = await this.jwt.signAsync(
      { ...payload, type: 'access' },
      {
        expiresIn: accessExpire,
        secret: cfg.secret,
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { ...payload, type: 'refresh' },
      {
        expiresIn: refreshExpire,
        secret: cfg.secret,
      },
    );
    const tokens: Tokens = {
      accessToken,
      refreshToken,
      expiresIn: String(cfg.expiresIn),
      refreshExpiresIn: String(cfg.refreshExpiresIn),
    };
    return { tokens, user: payload };
  }

  deleteSelf(id: number) {
    return this.repo.manager.transaction(async (mgr) => {
      const user = await mgr.findOne(User, { where: { id } });
      if (!user) throw new UnauthorizedException('user not found');
      if (user.builtIn)
        throw new UnauthorizedException('built-in user cannot be deleted');
      await mgr.remove(user);
      const sanitized = { ...user };
      delete (sanitized as Partial<User>).passwordHash;
      return sanitized;
    });
  }
}
