import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { UserRole } from '../entities/user.entity.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { Roles, RolesGuard } from './roles.guard.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(@Body() body: { email: string; password: string }, @Res({ passthrough: true }) response: any) {
    const result = await this.auth.login(body.email, body.password);
    response.cookie('access_token', result.token, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000, path: '/',
    });
    return { user: result.user };
  }

  @Post('signup')
  async signup(
    @Body() body: { name: string; email: string; password: string },
    @Res({ passthrough: true }) response: any,
  ) {
    const result = await this.auth.signUpAdmin(body);
    response.cookie('access_token', result.token, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000, path: '/',
    });
    return { user: result.user };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) response: any) {
    response.clearCookie('access_token', { path: '/' });
    return { loggedOut: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: AuthenticatedRequest) { return request.user; }

  @Get('customers')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  customers() { return this.auth.listCustomers(); }

  @Post('customers')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  createCustomer(@Body() body: { name: string; email: string; password: string }) {
    return this.auth.createCustomer(body);
  }
}
