import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CourseService } from '../../application/course-service';
import { CreateCourseDto, EditCourseDto, MaterialDto, OrderDto, RevisionDto, SessionDto, TransitionDto, UnitDto } from './course.dto';
import { CourseAuthGuard, CourseErrorFilter, UploadAuthorization, type CourseRequest } from './course-http';

const uuid = new ParseUUIDPipe();
@Controller('courses') @UseGuards(CourseAuthGuard) @UseFilters(CourseErrorFilter)
export class CourseController {
  constructor(@Inject(CourseService) private readonly courses: CourseService) {}

  @Get() list(@Req() request: CourseRequest) { return this.courses.list(request.academicUserId); }
  @Get('teachers') teachers(@Req() request: CourseRequest) { return this.courses.teachers(request.academicUserId); }
  @Post() create(@Req() request: CourseRequest, @Body() dto: CreateCourseDto) { return this.courses.create(request.academicUserId, dto); }
  @Get(':id') get(@Req() request: CourseRequest, @Param('id', uuid) id: string) { return this.courses.get(request.academicUserId, id); }
  @Get(':id/progress') progress(@Req() request: CourseRequest, @Param('id', uuid) id: string) { return this.courses.activity(request.academicUserId, id); }
  @Get(':id/history') history(@Req() request: CourseRequest, @Param('id', uuid) id: string) { return this.courses.history(request.academicUserId, id); }
  @Patch(':id') edit(@Req() request: CourseRequest, @Param('id', uuid) id: string, @Body() dto: EditCourseDto) {
    return this.courses.edit(request.academicUserId, id, dto.revision, dto);
  }

  @Post(':id/units') unit(@Req() request: CourseRequest, @Param('id', uuid) id: string, @Body() dto: UnitDto) {
    return this.courses.unit(request.academicUserId, id, dto.revision, dto.title);
  }
  @Patch(':id/units/:unitId') editUnit(@Req() request: CourseRequest, @Param('id', uuid) id: string, @Param('unitId', uuid) unitId: string, @Body() dto: UnitDto) {
    return this.courses.unit(request.academicUserId, id, dto.revision, dto.title, unitId);
  }
  @Delete(':id/units/:unitId') removeUnit(@Req() request: CourseRequest, @Param('id', uuid) id: string, @Param('unitId', uuid) unitId: string, @Query() dto: RevisionDto) {
    return this.courses.remove(request.academicUserId, id, dto.revision, 'units', unitId);
  }
  @Post(':id/units/:unitId/sessions') session(@Req() request: CourseRequest, @Param('id', uuid) id: string, @Param('unitId', uuid) unitId: string, @Body() dto: SessionDto) {
    return this.courses.session(request.academicUserId, id, dto.revision, unitId, dto);
  }
  @Patch(':id/sessions/:sessionId') editSession(@Req() request: CourseRequest, @Param('id', uuid) id: string, @Param('sessionId', uuid) sessionId: string, @Body() dto: SessionDto) {
    return this.courses.session(request.academicUserId, id, dto.revision, '', dto, sessionId);
  }
  @Delete(':id/sessions/:sessionId') removeSession(@Req() request: CourseRequest, @Param('id', uuid) id: string, @Param('sessionId', uuid) sessionId: string, @Query() dto: RevisionDto) {
    return this.courses.remove(request.academicUserId, id, dto.revision, 'sessions', sessionId);
  }
  @Post(':id/order') order(@Req() request: CourseRequest, @Param('id', uuid) id: string, @Body() dto: OrderDto) {
    return this.courses.reorder(request.academicUserId, id, dto.revision, dto.type, dto.parentId, dto.ids);
  }
  @Post(':id/transitions') transition(@Req() request: CourseRequest, @Param('id', uuid) id: string, @Body() dto: TransitionDto) {
    return this.courses.transition(request.academicUserId, id, dto.revision, dto.decision, dto.observations);
  }

  @Post(':id/sessions/:sessionId/materials')
  @UseInterceptors(UploadAuthorization, FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 6, fieldSize: 4096 } }))
  material(@Req() request: CourseRequest, @Param('id', uuid) id: string, @Param('sessionId', uuid) sessionId: string,
    @Body() dto: MaterialDto, @UploadedFile() file?: { buffer: Buffer; originalname: string; mimetype: string }) {
    return this.courses.material(request.academicUserId, id, dto.revision, sessionId, dto,
      file ? { bytes: file.buffer, filename: file.originalname, mimeType: file.mimetype } : undefined);
  }
  @Delete(':id/materials/:materialId') removeMaterial(@Req() request: CourseRequest, @Param('id', uuid) id: string, @Param('materialId', uuid) materialId: string, @Query() dto: RevisionDto) {
    return this.courses.remove(request.academicUserId, id, dto.revision, 'materials', materialId);
  }
  @Get(':id/materials/:materialId/versions/:versionId/file')
  async download(@Req() request: CourseRequest, @Res() response: Response, @Param('id', uuid) id: string,
    @Param('materialId', uuid) materialId: string, @Param('versionId', uuid) versionId: string) {
    const file = await this.courses.download(request.academicUserId, id, materialId, versionId);
    response.setHeader('Content-Type', file.mimeType); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.filename).replace(/'/g, '%27')}`);
    response.setHeader('Cache-Control', 'no-store'); response.send(Buffer.from(file.bytes));
  }
  @Post(':id/materials/:materialId/complete') @HttpCode(200)
  complete(@Req() request: CourseRequest, @Param('id', uuid) id: string, @Param('materialId', uuid) materialId: string) {
    return this.courses.complete(request.academicUserId, id, materialId);
  }
}
