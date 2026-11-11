import { IsBoolean, IsEmail, IsIn, IsInt, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ROLES, type Role } from '../../public';
export class LoginDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @Length(1, 128) password!: string;
}
export class CreateUserDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @Length(1, 100) displayName!: string;
  @IsString() @Length(12, 128) password!: string;
  @IsIn(ROLES) role!: Role;
}
export class ListUsersDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @Type(() => Number) @IsInt() @Min(0) @Max(1000000) offset = 0;
}
export class UpdateUserDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @Length(1, 100) displayName!: string;
  @IsIn(ROLES) role!: Role;
  @IsBoolean() active!: boolean;
  @IsInt() @Min(0) version!: number;
}
export class UpdateProfileDto {
  @IsString() @Length(1, 100) displayName!: string;
  @IsInt() @Min(0) version!: number;
}
export class ChangePasswordDto {
  @IsString() @Length(1, 128) currentPassword!: string;
  @IsString() @Length(12, 128) newPassword!: string;
}
export class RecoveryDto { @IsEmail() @MaxLength(254) email!: string; }
export class ResetPasswordDto {
  @IsString() @Length(64, 64) token!: string;
  @IsString() @Length(12, 128) password!: string;
}
