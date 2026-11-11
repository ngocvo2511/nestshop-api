import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In, QueryFailedError } from 'typeorm';
import { Configuration } from '../../config/configuration';
import { ApiError } from '../../common/http/api-error';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { LoginDto, RegisterDto } from './auth.dto';
import { hashPassword, verifyPassword } from './password';
import { AccessTokenService } from './access-token.service';
import { publicUser } from '../users/user-public';
import { databaseNow, transaction } from '../../database/transaction';
export function refreshHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DataSource) private readonly source: DataSource | null,
    private readonly config: ConfigService<Configuration, true>,
    private readonly access: AccessTokenService,
  ) {}

  private db(): DataSource {
    if (!this.source) throw new ApiError('SERVICE_UNAVAILABLE');
    return this.source;
  }

  private async transaction<T>(
    operation: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return transaction(this.source, operation);
  }

  async register(dto: RegisterDto) {
    const passwordHash = await hashPassword(dto.password);
    try {
      const repo = this.db().getRepository(User);
      const user = await repo.save(
        repo.create({
          email: dto.email,
          passwordHash,
          role: 'CUSTOMER',
          isActive: true,
          fullName: dto.fullName ?? null,
          phoneNumber: dto.phoneNumber ?? null,
        }),
      );
      return publicUser(user);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string; constraint?: string }).code ===
          '23505' &&
        (error.driverError as { constraint?: string }).constraint ===
          'users_email_key'
      )
        throw new ApiError('EMAIL_IN_USE');
      throw error;
    }
  }

  async login(dto: LoginDto) {
    return this.transaction(async (manager) => {
      const user = await manager
        .createQueryBuilder(User, 'u')
        .addSelect('u.passwordHash')
        .where('u.email = :email', { email: dto.email })
        .setLock('pessimistic_write')
        .getOne();
      const valid = await verifyPassword(dto.password, user?.passwordHash);
      if (!user || !valid || !user.isActive)
        throw new ApiError('INVALID_CREDENTIALS');
      return this.issue(manager, user, randomUUID(), await this.now(manager));
    });
  }

  async refresh(raw: string) {
    const hash = refreshHash(raw);
    // Lookup confers no authority; user is always locked before token rows.
    const owner = await this.db()
      .getRepository(RefreshToken)
      .findOneBy({ tokenHash: hash });
    if (!owner) throw new ApiError('INVALID_REFRESH_TOKEN');
    const outcome = await this.transaction(async (manager) => {
      const user = await manager
        .createQueryBuilder(User, 'u')
        .where('u.id = :id', { id: owner.userId })
        .setLock('pessimistic_write')
        .getOne();
      const family = await manager
        .createQueryBuilder(RefreshToken, 't')
        .addSelect('t.tokenHash')
        .where('t.userId = :user AND t.familyId = :family', {
          user: owner.userId,
          family: owner.familyId,
        })
        .orderBy('t.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();
      const token = family.find((row) => row.tokenHash === hash);
      const now = await this.now(manager);
      if (
        !token ||
        family.some(
          (row) =>
            row.status === 'REVOKED' &&
            ['LOGOUT', 'PASSWORD_CHANGE'].includes(row.revocationReason ?? ''),
        )
      )
        return { error: 'INVALID_REFRESH_TOKEN' } as const;
      if (token.consumedAt) {
        await manager.update(
          RefreshToken,
          { userId: owner.userId, familyId: owner.familyId },
          { status: 'REVOKED', revokedAt: now, revocationReason: 'REPLAY' },
        );
        return { error: 'REFRESH_REPLAY' } as const;
      }
      if (
        !user?.isActive ||
        token.status !== 'ACTIVE' ||
        token.expiresAt <= now ||
        family.some((row) => row.status === 'REVOKED')
      )
        return { error: 'INVALID_REFRESH_TOKEN' } as const;
      await manager.update(RefreshToken, { id: token.id }, { consumedAt: now });
      return { pair: await this.issue(manager, user, token.familyId, now) };
    });
    // Expected rejection is deliberately outside the transaction: replay revocation is durable.
    if ('error' in outcome) throw new ApiError(outcome.error!);
    return outcome.pair;
  }

  private async now(manager: EntityManager): Promise<Date> {
    return databaseNow(manager);
  }

  async logout(raw: string): Promise<void> {
    const owner = await this.db()
      .getRepository(RefreshToken)
      .findOneBy({ tokenHash: refreshHash(raw) });
    if (!owner) return;
    await this.transaction(async (manager) => {
      const user = await manager
        .createQueryBuilder(User, 'u')
        .where('u.id=:id', { id: owner.userId })
        .setLock('pessimistic_write')
        .getOne();
      if (!user) return;
      const family = await this.lockTokens(
        manager,
        owner.userId,
        owner.familyId,
      );
      const now = await this.now(manager);
      if (
        !family.some((token) => token.id === owner.id) ||
        family.some((token) => token.status === 'REVOKED') ||
        !family.some(
          (token) =>
            token.status === 'ACTIVE' &&
            !token.consumedAt &&
            token.expiresAt > now,
        )
      )
        return;
      await this.revokeOrdinary(manager, family, 'LOGOUT', now);
    });
  }

  async changePassword(
    userId: string,
    dto: { currentPassword: string; newPassword: string },
  ): Promise<void> {
    if (dto.currentPassword === dto.newPassword)
      throw new ApiError('VALIDATION_FAILED', [
        { field: 'newPassword', rules: ['differentPassword'] },
      ]);
    await this.transaction(async (manager) => {
      const user = await manager
        .createQueryBuilder(User, 'u')
        .addSelect('u.passwordHash')
        .where('u.id=:id', { id: userId })
        .setLock('pessimistic_write')
        .getOne();
      if (!user?.isActive) throw new ApiError('UNAUTHORIZED');
      if (!(await verifyPassword(dto.currentPassword, user.passwordHash)))
        throw new ApiError('INVALID_CURRENT_PASSWORD');
      const passwordHash = await hashPassword(dto.newPassword);
      const tokens = await this.lockTokens(manager, userId);
      const now = await this.now(manager);
      await manager.update(
        User,
        { id: userId },
        { passwordHash, updatedAt: now },
      );
      await this.revokeOrdinary(manager, tokens, 'PASSWORD_CHANGE', now);
    });
  }

  private lockTokens(
    manager: EntityManager,
    userId: string,
    familyId?: string,
  ) {
    const query = manager
      .createQueryBuilder(RefreshToken, 't')
      .where('t.userId=:userId', { userId });
    if (familyId) query.andWhere('t.familyId=:familyId', { familyId });
    return query.orderBy('t.id', 'ASC').setLock('pessimistic_write').getMany();
  }

  private async revokeOrdinary(
    manager: EntityManager,
    tokens: RefreshToken[],
    reason: 'LOGOUT' | 'PASSWORD_CHANGE',
    now: Date,
  ) {
    // Preserve an earlier ordinary revocation and its timestamp; replay classification may be superseded.
    const ids = tokens
      .filter(
        (token) =>
          token.status !== 'REVOKED' || token.revocationReason === 'REPLAY',
      )
      .map((token) => token.id);
    if (ids.length)
      await manager.update(
        RefreshToken,
        { id: In(ids) },
        { status: 'REVOKED', revokedAt: now, revocationReason: reason },
      );
  }

  private async issue(
    manager: EntityManager,
    user: User,
    familyId: string,
    now: Date,
  ) {
    const cfg = this.config.get('jwt', { infer: true });
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + cfg.refreshTtlSeconds * 1000);
    const accessToken = await this.access.sign(user, now);
    await manager.insert(
      RefreshToken,
      manager.create(RefreshToken, {
        userId: user.id,
        familyId,
        tokenHash: refreshHash(refreshToken),
        status: 'ACTIVE',
        consumedAt: null,
        revokedAt: null,
        revocationReason: null,
        createdAt: now,
        expiresAt,
      }),
    );
    return {
      user: publicUser(user),
      accessToken,
      tokenType: 'Bearer',
      expiresIn: cfg.accessTtlSeconds,
      refreshToken,
      refreshExpiresAt: expiresAt.toISOString(),
    };
  }
}
