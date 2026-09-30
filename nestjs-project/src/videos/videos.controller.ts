import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { VideosService } from './videos.service';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { PresignPartDto } from './dto/presign-part.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { JwtPayload } from '../auth/auth.types';

@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post('upload/initiate')
  @HttpCode(HttpStatus.CREATED)
  async initiateUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateUploadDto,
  ) {
    return this.videosService.initiateUpload(user.sub, dto);
  }

  @Post('upload/presign-part')
  @HttpCode(HttpStatus.OK)
  async presignPart(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PresignPartDto,
  ) {
    return this.videosService.presignPart(user.sub, dto);
  }

  @Post('upload/complete')
  @HttpCode(HttpStatus.OK)
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CompleteUploadDto,
  ) {
    return this.videosService.completeUpload(user.sub, dto);
  }

  @Public()
  @Get(':idOrSlug')
  async getVideoDetails(@Param('idOrSlug') idOrSlug: string) {
    return this.videosService.findByIdOrSlug(idOrSlug);
  }

  @Public()
  @Get(':idOrSlug/stream')
  async streamVideo(
    @Param('idOrSlug') idOrSlug: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const rangeHeader = req.headers.range;
    const { stream, contentLength, contentRange, acceptRanges, contentType } =
      await this.videosService.getStream(idOrSlug, rangeHeader);

    res.setHeader('Content-Type', contentType || 'video/mp4');
    res.setHeader('Accept-Ranges', acceptRanges || 'bytes');

    if (contentRange) {
      res.status(HttpStatus.PARTIAL_CONTENT);
      res.setHeader('Content-Range', contentRange);
      if (contentLength !== undefined) {
        res.setHeader('Content-Length', contentLength);
      }
    } else {
      res.status(HttpStatus.OK);
      if (contentLength !== undefined) {
        res.setHeader('Content-Length', contentLength);
      }
    }

    stream.pipe(res);
  }

  @Public()
  @Get(':idOrSlug/download')
  async downloadVideo(
    @Param('idOrSlug') idOrSlug: string,
    @Res() res: Response,
  ) {
    const { stream, filename, contentLength, contentType } =
      await this.videosService.getDownloadStream(idOrSlug);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    if (contentLength !== undefined) {
      res.setHeader('Content-Length', contentLength);
    }

    stream.pipe(res);
  }

  @Public()
  @Get(':idOrSlug/thumbnail')
  async getThumbnail(
    @Param('idOrSlug') idOrSlug: string,
    @Res() res: Response,
  ) {
    const { stream, contentLength, contentType } =
      await this.videosService.getThumbnailStream(idOrSlug);

    res.setHeader('Content-Type', contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (contentLength !== undefined) {
      res.setHeader('Content-Length', contentLength);
    }

    stream.pipe(res);
  }
}
