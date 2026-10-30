import type { UserRole } from '../entities/user.entity.js';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

export type AuthenticatedRequest = {
  headers: { cookie?: string };
  user: AuthUser;
};
