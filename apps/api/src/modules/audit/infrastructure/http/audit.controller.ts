import { ArgumentsHost, Catch, Controller, ExceptionFilter, Get, Inject, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { BearerGuard, type BearerRequest } from '../../../../platform/http/bearer-guard';
import { AuditService } from '../../application/audit-service';
import { AuditError } from '../../domain/audit';

@Catch(AuditError)
export class AuditErrorFilter implements ExceptionFilter {
  catch(error: AuditError, host: ArgumentsHost) {
    const status = error.code === 'FORBIDDEN' ? 403 : 400;
    host.switchToHttp().getResponse<Response>().status(status).json({ statusCode: status, code: error.code });
  }
}
export class AuditQueryDto {
  @IsOptional() @IsIn(['GRADE', 'ASSESSMENT']) entity?: string;
  @IsOptional() @IsUUID() entityId?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 50;
  @Type(() => Number) @IsInt() @Min(0) @Max(1000000) offset = 0;
}
@Controller('audit') @UseGuards(BearerGuard) @UseFilters(AuditErrorFilter)
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}
  @Get('entries') entries(@Req() request: BearerRequest, @Query() dto: AuditQueryDto) {
    return this.audit.entries(request.principalId, { entity: dto.entity, entityId: dto.entityId }, dto.limit, dto.offset);
  }
  @Get('verify') verify(@Req() request: BearerRequest) { return this.audit.verify(request.principalId); }
  @Get('anchors/verify') anchors(@Req() request: BearerRequest) { return this.audit.verifyAnchors(request.principalId); }
}
