import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.readCookie(request.headers.cookie, 'access_token');
    if (!token) throw new UnauthorizedException('Please log in.');
    request.user = this.auth.verifyToken(token);
    return true;
  }
  private readCookie(header: string | undefined, name: string) {
    return header?.split(';').map((part) => part.trim().split('=')).find(([key]) => key === name)?.[1];
  }
}
