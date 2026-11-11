import { IsEmail, IsIn, IsInt, IsString, Length, Max, MaxLength, Min } from 'class-validator';
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
