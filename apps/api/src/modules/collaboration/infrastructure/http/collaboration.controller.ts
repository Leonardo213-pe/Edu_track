import { ArgumentsHost, Body, Catch, Controller, Delete, ExceptionFilter, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { BearerGuard, type BearerRequest } from '../../../../platform/http/bearer-guard';
import { CollaborationService } from '../../application/collaboration-service';
import { CollaborationError } from '../../domain/forum';

const statuses: Record<CollaborationError['code'], number> = { INVALID_INPUT: 400, FORBIDDEN: 403, NOT_FOUND: 404, LOCKED: 409 };
@Catch(CollaborationError)
export class CollaborationErrorFilter implements ExceptionFilter {
  catch(error: CollaborationError, host: ArgumentsHost) {
    host.switchToHttp().getResponse<Response>().status(statuses[error.code]).json({ statusCode: statuses[error.code], code: error.code });
  }
}
export class ForumDto {
  @IsString() @Length(1, 160) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsUUID() unitId?: string;
}
export class ThreadDto { @IsString() @Length(1, 160) title!: string; @IsString() @Length(1, 10000) body!: string; }
export class ReplyDto { @IsString() @Length(1, 10000) body!: string; }
export class ModerateMessageDto { @IsBoolean() hidden!: boolean; @IsOptional() @IsString() @MaxLength(500) reason?: string; }
export class ModerateThreadDto { @IsOptional() @IsBoolean() locked?: boolean; @IsOptional() @IsBoolean() pinned?: boolean; }
export class InboxDto { @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 50; }
export class ReadDto { @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) ids?: string[]; }

const uuid = new ParseUUIDPipe();
@Controller('collaboration') @UseGuards(BearerGuard) @UseFilters(CollaborationErrorFilter)
export class CollaborationController {
  constructor(@Inject(CollaborationService) private readonly collaboration: CollaborationService) {}
  @Get('courses/:courseId/forums') forums(@Req() request: BearerRequest, @Param('courseId', uuid) courseId: string) {
    return this.collaboration.forums(request.principalId, courseId);
  }
  @Post('courses/:courseId/forums') createForum(@Req() request: BearerRequest, @Param('courseId', uuid) courseId: string, @Body() dto: ForumDto) {
    return this.collaboration.createForum(request.principalId, courseId, dto);
  }
  @Get('forums/:forumId/threads') threads(@Req() request: BearerRequest, @Param('forumId', uuid) forumId: string) {
    return this.collaboration.threads(request.principalId, forumId);
  }
  @Post('forums/:forumId/threads') createThread(@Req() request: BearerRequest, @Param('forumId', uuid) forumId: string, @Body() dto: ThreadDto) {
    return this.collaboration.createThread(request.principalId, forumId, dto);
  }
  @Get('threads/:threadId') thread(@Req() request: BearerRequest, @Param('threadId', uuid) threadId: string) {
    return this.collaboration.thread(request.principalId, threadId);
  }
  @Post('threads/:threadId/messages') reply(@Req() request: BearerRequest, @Param('threadId', uuid) threadId: string, @Body() dto: ReplyDto) {
    return this.collaboration.reply(request.principalId, threadId, dto.body);
  }
  @Post('threads/:threadId/subscription') @HttpCode(200) subscribe(@Req() request: BearerRequest, @Param('threadId', uuid) threadId: string) {
    return this.collaboration.subscription(request.principalId, threadId, true);
  }
  @Delete('threads/:threadId/subscription') unsubscribe(@Req() request: BearerRequest, @Param('threadId', uuid) threadId: string) {
    return this.collaboration.subscription(request.principalId, threadId, false);
  }
  @Patch('threads/:threadId') moderateThread(@Req() request: BearerRequest, @Param('threadId', uuid) threadId: string, @Body() dto: ModerateThreadDto) {
    return this.collaboration.moderateThread(request.principalId, threadId, dto);
  }
  @Patch('messages/:messageId') moderateMessage(@Req() request: BearerRequest, @Param('messageId', uuid) messageId: string, @Body() dto: ModerateMessageDto) {
    return this.collaboration.moderateMessage(request.principalId, messageId, dto);
  }
  @Get('notifications') inbox(@Req() request: BearerRequest, @Query() dto: InboxDto) { return this.collaboration.inbox(request.principalId, dto.limit); }
  @Post('notifications/read') @HttpCode(200) read(@Req() request: BearerRequest, @Body() dto: ReadDto) {
    return this.collaboration.markRead(request.principalId, dto.ids ?? null);
  }
}
