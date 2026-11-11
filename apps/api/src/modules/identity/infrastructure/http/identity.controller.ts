import { Body, Controller, Get, Header, HttpCode, Inject, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IdentityService } from '../../application/identity-service';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';
import { CreateUserDto, ListUsersDto, LoginDto } from './identity.dto';

@Controller('identity')
export class IdentityController {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}
  @Post('login') @HttpCode(200) @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  login(@Body() dto: LoginDto) { return this.identity.login(dto.email, dto.password); }
  @Get('me') @UseGuards(AuthGuard) @Header('Cache-Control', 'no-store')
  me(@Req() request: AuthenticatedRequest) { return request.user; }
  @Post('users') @UseGuards(AuthGuard) @Header('Cache-Control', 'no-store')
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateUserDto) {
    return this.identity.createUser(request.user, dto);
  }
  @Get('users') @UseGuards(AuthGuard) @Header('Cache-Control', 'no-store')
  list(@Req() request: AuthenticatedRequest, @Query() dto: ListUsersDto) {
    return this.identity.listUsers(request.user, dto.limit, dto.offset);
  }
}
