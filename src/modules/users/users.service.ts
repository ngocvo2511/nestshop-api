import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApiError } from '../../common/http/api-error';
import { transaction, databaseNow } from '../../database/transaction';
import { User } from './entities/user.entity';
import { RoleChangeAudit } from './entities/role-change-audit.entity';
import { ProfilePatchDto, RoleQueryDto } from './users.dto';
import { publicUser, roleAssignment } from './user-public';
import { AccountRole } from '../auth/roles.guard';

@Injectable()
export class UsersService {
  constructor(@Inject(DataSource) private readonly source: DataSource | null) {}

  private db(): DataSource {
    if (!this.source) throw new ApiError('SERVICE_UNAVAILABLE');
    return this.source;
  }

  async profile(userId: string) {
    const user = await this.db().getRepository(User).findOneBy({ id: userId });
    if (!user) throw new ApiError('NOT_FOUND');
    return publicUser(user);
  }

  async updateProfile(userId: string, dto: ProfilePatchDto) {
    if (dto.fullName === undefined && dto.phoneNumber === undefined)
      throw new ApiError('EMPTY_UPDATE');
    return transaction(this.source, async (manager) => {
      const user = await manager
        .createQueryBuilder(User, 'u')
        .where('u.id=:id', { id: userId })
        .setLock('pessimistic_write')
        .getOne();
      if (!user) throw new ApiError('NOT_FOUND');
      const changes: Partial<User> = { updatedAt: await databaseNow(manager) };
      if (dto.fullName !== undefined) changes.fullName = dto.fullName;
      if (dto.phoneNumber !== undefined) changes.phoneNumber = dto.phoneNumber;
      await manager.update(User, { id: userId }, changes);
      return publicUser(Object.assign(user, changes));
    });
  }

  async roles(query: RoleQueryDto) {
    const builder = this.db().getRepository(User).createQueryBuilder('u');
    if (query.role) builder.where('u.role=:role', { role: query.role });
    const [users, total] = await builder
      .orderBy('u.createdAt', 'DESC')
      .addOrderBy('u.id', 'DESC')
      .skip(query.offset)
      .take(query.limit)
      .getManyAndCount();
    return {
      items: users.map(roleAssignment),
      offset: query.offset,
      limit: query.limit,
      total,
    };
  }

  // The controller passes the verified ADMIN identity. Existing signed role claims stay authoritative until expiry.
  async changeRole(actorUserId: string, targetId: string, role: AccountRole) {
    return transaction(this.source, async (manager) => {
      const target = await manager
        .createQueryBuilder(User, 'u')
        .where('u.id=:id', { id: targetId })
        .setLock('pessimistic_write')
        .getOne();
      if (!target) throw new ApiError('NOT_FOUND');
      if (target.role === role)
        return { user: roleAssignment(target), changed: false, auditId: null };
      const now = await databaseNow(manager);
      const audit = manager.create(RoleChangeAudit, {
        actorUserId,
        affectedUserId: targetId,
        oldRole: target.role,
        newRole: role,
        createdAt: now,
      });
      await manager.update(User, { id: targetId }, { role, updatedAt: now });
      await manager.insert(RoleChangeAudit, audit);
      return {
        user: roleAssignment(Object.assign(target, { role })),
        changed: true,
        auditId: audit.id,
      };
    });
  }
}
