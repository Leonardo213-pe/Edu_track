import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min } from 'class-validator';
export class CreateCourseDto {
  @IsString() @Length(1, 40) code!: string;
  @IsString() @Length(1, 160) name!: string;
  @IsString() @Length(1, 5000) description!: string;
  @IsString() @Length(1, 40) period!: string;
  @IsUUID() teacherId!: string;
}
export class RevisionDto { @Type(() => Number) @IsInt() @Min(0) revision!: number; }
export class EditCourseDto extends CreateCourseDto {
  @IsString() @MaxLength(50000) syllabus!: string;
  @IsInt() @Min(0) revision!: number;
}
export class UnitDto extends RevisionDto { @IsString() @Length(1, 160) title!: string; }
export class SessionDto extends UnitDto { @IsString() @MaxLength(5000) description!: string; }
export class OrderDto extends RevisionDto {
  @IsIn(['units', 'sessions', 'materials']) type!: 'units' | 'sessions' | 'materials';
  @IsUUID() parentId!: string;
  @IsArray() @ArrayMaxSize(1000) @ArrayUnique() @IsUUID('all', { each: true }) ids!: string[];
}
export class TransitionDto extends RevisionDto {
  @IsIn(['SUBMITTED', 'APPROVED', 'REJECTED', 'REOPENED', 'ARCHIVED']) decision!: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REOPENED' | 'ARCHIVED';
  @IsString() @MaxLength(5000) observations!: string;
}
export class MaterialDto extends RevisionDto {
  @IsString() @Length(1, 160) title!: string;
  @IsIn(['FILE', 'LINK', 'VIDEO']) kind!: 'FILE' | 'LINK' | 'VIDEO';
  @IsOptional() @IsUUID() materialId?: string;
  @IsOptional() @IsString() @MaxLength(2048) url?: string;
}
