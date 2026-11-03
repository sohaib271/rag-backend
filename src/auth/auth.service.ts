import { BadRequestException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Repository } from 'typeorm';
import { User, UserRole } from '../entities/user.entity.js';
import type { AuthUser } from './auth.types.js';

const scrypt = promisify(nodeScrypt);

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const email = this.normalizeEmail(this.config.get('ADMIN_EMAIL', 'admin@example.com'));
    if (await this.users.existsBy({ role: UserRole.ADMIN })) return;
    const password = this.config.get('ADMIN_PASSWORD', 'Admin123!');
    await this.users.save(this.users.create({
      name: this.config.get('ADMIN_NAME', 'System Admin'),
      email,
      passwordHash: await this.hashPassword(password),
      role: UserRole.ADMIN,
    }));
  }

  async login(email: string, password: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.users.createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: normalizedEmail })
      .getOne();
    if (!user || !await this.verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    const safeUser = this.toAuthUser(user);
    return { user: safeUser, token: this.signToken(safeUser) };
  }

  async createCustomer(input: { name: string; email: string; password: string }) {
    return this.createUser(input, UserRole.CUSTOMER);
  }

  async signUpAdmin(input: { name: string; email: string; password: string }) {
    const user = await this.createUser(input, UserRole.ADMIN);
    return { user, token: this.signToken(user) };
  }

  private async createUser(
    input: { name: string; email: string; password: string },
    role: UserRole,
  ) {
    const name = input.name?.trim();
    const email = this.normalizeEmail(input.email);
    this.validateCredentials(name, email, input.password);
    if (await this.users.existsBy({ email })) throw new BadRequestException('Email is already registered.');
    const saved = await this.users.save(this.users.create({
      name,
      email,
      passwordHash: await this.hashPassword(input.password),
      role,
    }));
    return this.toAuthUser(saved);
  }

  listCustomers() {
    return this.users.find({ where: { role: UserRole.CUSTOMER }, order: { createdAt: 'DESC' } });
  }

  verifyToken(token: string): AuthUser {
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) throw new UnauthorizedException('Invalid session.');
    const expected = this.signature(`${header}.${payload}`);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
      throw new UnauthorizedException('Invalid session.');
    }
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as AuthUser & { exp: number };
      if (data.exp < Math.floor(Date.now() / 1000)) throw new Error('expired');
      return { id: data.id, name: data.name, email: data.email, role: data.role };
    } catch {
      throw new UnauthorizedException('Session has expired.');
    }
  }

  private signToken(user: AuthUser) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8 })).toString('base64url');
    return `${header}.${payload}.${this.signature(`${header}.${payload}`)}`;
  }

  private signature(value: string) {
    return createHmac('sha256', this.config.get('JWT_SECRET', 'development-only-change-me'))
      .update(value).digest('base64url');
  }

  private async hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const derived = await scrypt(password, salt, 64) as Buffer;
    return `${salt}:${derived.toString('hex')}`;
  }

  private async verifyPassword(password: string, stored: string) {
    const [salt, key] = stored.split(':');
    if (!salt || !key) return false;
    const derived = await scrypt(password ?? '', salt, 64) as Buffer;
    const expected = Buffer.from(key, 'hex');
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }

  private normalizeEmail(email: string) { return (email ?? '').trim().toLowerCase(); }
  private validateCredentials(name: string, email: string, password: string) {
    if (!name) throw new BadRequestException('Name is required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('A valid email is required.');
    if (!password || password.length < 8) throw new BadRequestException('Password must contain at least 8 characters.');
  }
  private toAuthUser(user: User): AuthUser {
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }
}
