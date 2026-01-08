import { Injectable, UnauthorizedException } from '@nestjs/common';
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
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
    private readonly jwt: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.seedIfEmpty();
  }

  async seedIfEmpty(): Promise<void> {
    const count = await this.repo.count();
    if (count > 0) return;
    const admin = this.repo.create({
      username: process.env.ADMIN_USERNAME || 'admin',
      passwordHash: hashSync(process.env.ADMIN_PASSWORD || 'admin', 8),
      role: 'admin',
      displayName: 'Admin',
      builtIn: true,
    });
    const user = this.repo.create({
      username: process.env.USER_USERNAME || 'user',
      passwordHash: hashSync(process.env.USER_PASSWORD || 'user', 8),
      role: 'user',
      displayName: 'User',
      builtIn: true,
    });
    await this.repo.save([admin, user]);
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
