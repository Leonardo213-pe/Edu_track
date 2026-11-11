import { Body, Controller, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IdentityService } from '../../application/identity-service';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';
import { ChangePasswordDto, CreateUserDto, ListUsersDto, LoginDto, RecoveryDto, ResetPasswordDto, UpdateProfileDto, UpdateUserDto } from './identity.dto';

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
  @Post('logout') @UseGuards(AuthGuard) @HttpCode(204)
  logout(@Req() request: AuthenticatedRequest) { return this.identity.logout(request.user); }
  @Patch('me') @UseGuards(AuthGuard) @Header('Cache-Control', 'no-store')
  updateProfile(@Req() request: AuthenticatedRequest, @Body() dto: UpdateProfileDto) {
    return this.identity.updateProfile(request.user, dto.displayName, dto.version);
  }
  @Patch('users/:id') @UseGuards(AuthGuard) @Header('Cache-Control', 'no-store')
  updateUser(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.identity.updateUser(request.user, id, dto);
  }
  @Post('password/change') @UseGuards(AuthGuard) @HttpCode(204)
  changePassword(@Req() request: AuthenticatedRequest, @Body() dto: ChangePasswordDto) {
    return this.identity.changePassword(request.user, dto.currentPassword, dto.newPassword);
  }
  @Post('password/recovery') @HttpCode(202) @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async recovery(@Body() dto: RecoveryDto) {
    await this.identity.requestRecovery(dto.email);
    return { message: 'Si la cuenta está activa, recibirás instrucciones para recuperar el acceso.' };
  }
  @Post('password/reset') @HttpCode(204) @Throttle({ default: { limit: 5, ttl: 60000 } })
  resetPassword(@Body() dto: ResetPasswordDto) { return this.identity.resetPassword(dto.token, dto.password); }
  @Get('security-events') @UseGuards(AuthGuard) @Header('Cache-Control', 'no-store')
  securityEvents(@Req() request: AuthenticatedRequest, @Query() dto: ListUsersDto) {
    return this.identity.securityEvents(request.user, dto.limit, dto.offset);
  }
}
