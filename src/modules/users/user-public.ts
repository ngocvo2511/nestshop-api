import { User } from './entities/user.entity';

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    fullName: user.fullName,
    phoneNumber: user.phoneNumber,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function roleAssignment(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
  };
}
