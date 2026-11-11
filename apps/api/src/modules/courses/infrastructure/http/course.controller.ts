import { ArgumentsHost, Body, CanActivate, Catch, Controller, ExceptionFilter, ExecutionContext, Get, Header, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Patch, Post, Req, Res, UnauthorizedException, UploadedFile, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../../../identity/public';
import { CourseService } from '../../application/course-service';
import { CourseError } from '../../domain/course';
import { CreateCourseDto, EditCourseDto, MaterialDto, OrderDto, SessionDto, TransitionDto, UnitDto } from './course.dto';
type CourseRequest = Request & { academicUserId: string };
@Injectable()
export class CourseAuthGuard implements CanActivate {
  constructor(@Inject(IDENTITY_DIRECTORY) private readonly identity: IdentityDirectory) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CourseRequest>();
    request.res?.setHeader('Cache-Control', 'no-store');
    const token = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1]; if (!token) throw new UnauthorizedException();
    request.academicUserId = (await this.identity.authenticate(token)).id; return true;
  }
}
@Catch(CourseError)
export class CourseErrorFilter implements ExceptionFilter {
  catch(error: CourseError, host: ArgumentsHost) {
    const status = { INVALID_INPUT: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID_STATE: 409, INCOMPLETE_COURSE: 400, FILE_REJECTED: 400 }[error.code];
    host.switchToHttp().getResponse<Response>().status(status).json({ statusCode: status, code: error.code });
  }
}
@Controller('courses') @UseGuards(CourseAuthGuard) @UseFilters(CourseErrorFilter)
export class CourseController {
  constructor(@Inject(CourseService) private readonly courses: CourseService) {}
  @Get() list(@Req() request: CourseRequest) { return this.courses.list(request.academicUserId); }
  @Get('teachers') teachers(@Req() request: CourseRequest) { return this.courses.teachers(request.academicUserId); }
  @Post() create(@Req() request: CourseRequest, @Body() dto: CreateCourseDto) { return this.courses.create(request.academicUserId, dto); }
  @Get(':id') get(@Req() request: CourseRequest, @Param('id', ParseUUIDPipe) id: string) { return this.courses.get(request.academicUserId, id); }
  @Get(':id/progress') progress(@Req() request: CourseRequest, @Param('id', ParseUUIDPipe) id: string) { return this.courses.activity(request.academicUserId, id); }
  @Patch(':id') edit(@Req() request: CourseRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EditCourseDto) { return this.courses.edit(request.academicUserId, id, dto.revision, dto); }
  @Post(':id/units') unit(@Req() request: CourseRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UnitDto) { return this.courses.unit(request.academicUserId, id, dto.revision, dto.title); }
  @Patch(':id/units/:unitId') editUnit(@Req() request: CourseRequest, @Param('id', ParseUUIDPipe) id: string, @Param('unitId', ParseUUIDPipe) unitId: string, @Body() dto: UnitDto) { return this.courses.unit(request.academicUserId, id, dto.revision, dto.title, unitId); }
  @Post(':id/units/:unitId/sessions') session(@Req() request: CourseRequest, @Param('id', ParseUUIDPipe) id: string, @Param('unitId', ParseUUIDPipe) unitId: string, @Body() dto: SessionDto) { return this.courses.session(request.academicUserId, id, dto.revision, unitId, dto.title, dto.description); }
  @Patch(':id/sessions/:sessionId') editSession(@Req() request: CourseRequest, @Param('id', ParseUUIDPipe) id: string, @Param('sessionId', ParseUUIDPipe) sessionId: string, @Body() dto: SessionDto) { return this.courses.session(request.academicUserId, id, dto.revision, '', dto.title, dto.description, sessionId); }
  @Post(':id/order') order(@Req() request: CourseRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OrderDto) { return this.courses.reorder(request.academicUserId, id, dto.revision, dto.type, dto.parentId, dto.ids); }
  @Post(':id/transitions') transition(@Req() request: CourseRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransitionDto) { return this.courses.transition(request.academicUserId, id, dto.revision, dto.decision, dto.observations); }
  @Post(':id/sessions/:sessionId/materials')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 6, fieldSize: 4096 } }))
  material(@Req() request: CourseRequest, @Param('id', ParseUUIDPipe) id: string, @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: MaterialDto, @UploadedFile() file?: { buffer: Buffer; originalname: string; mimetype: string }) {
    return this.courses.material(request.academicUserId, id, dto.revision, sessionId, dto,
      file ? { bytes: file.buffer, filename: file.originalname, mimeType: file.mimetype } : undefined);
  }
  @Get(':id/materials/:materialId/versions/:versionId/file')
  async download(@Req() request: CourseRequest, @Res() response: Response, @Param('id', ParseUUIDPipe) id: string,
    @Param('materialId', ParseUUIDPipe) materialId: string, @Param('versionId', ParseUUIDPipe) versionId: string) {
    const file = await this.courses.download(request.academicUserId, id, materialId, versionId);
    response.setHeader('Content-Type', file.mimeType); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.filename).replace(/'/g, '%27')}`);
    response.setHeader('Cache-Control', 'no-store'); response.send(Buffer.from(file.bytes));
  }
  @Post(':id/materials/:materialId/complete') @HttpCode(200)
  complete(@Req() request: CourseRequest, @Param('id', ParseUUIDPipe) id: string, @Param('materialId', ParseUUIDPipe) materialId: string) { return this.courses.complete(request.academicUserId, id, materialId); }
}
