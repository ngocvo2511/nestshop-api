import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { EmptyBodyPipe } from '../../common/http/empty-body.pipe';
import { UuidParamDto } from '../../common/http/dto/uuid-param.dto';
import { ContextRequest, ResponseMode } from '../../common/http/response-mode';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { ProductErrors } from './products.openapi';
import { ImageUploadInterceptor } from './image-upload.interceptor';
import { ProductImagesService } from './product-images.service';

@Controller('products')
@ApiTags('product images')
@ProductErrors()
export class ProductImagesController {
  constructor(private readonly images: ProductImagesService) {}

  @Post(':id/image')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @UseInterceptors(ImageUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      additionalProperties: false,
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'ADMIN replace one product image',
    description:
      'Exactly one file, no fields. JPEG/PNG/WebP <= configured cap <=5MiB; full decode/re-encode, matching MIME required, single frame and <=16M pixels. Generated filename; no client paths. Product lock serializes reference replacement; only unreferenced files are removed after commit. DB failure attempts safe orphan cleanup.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        meta: { type: 'object' },
        data: {
          type: 'object',
          properties: {
            productId: { type: 'string', format: 'uuid' },
            imageUrl: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 413, description: 'UPLOAD_TOO_LARGE' })
  @ApiResponse({ status: 415, description: 'UPLOAD_INVALID_TYPE' })
  upload(
    @Param() params: UuidParamDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: ContextRequest,
    @Body(EmptyBodyPipe) body: Record<string, never>,
    @Query(EmptyBodyPipe) query: Record<string, never>,
  ) {
    void body;
    void query;
    return this.images.upload(params.id, file, request.correlationId);
  }

  @Get(':id/image')
  @ResponseMode('file')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOperation({
    summary: 'Public active-only product image',
    description:
      'Reads only the stored generated reference. Missing/inactive product, missing/unsafe/symlink file reference return safe404 JSON. No arbitrary filename/path transport.',
  })
  @ApiResponse({ status: 200, schema: { type: 'string', format: 'binary' } })
  async read(
    @Param() params: UuidParamDto,
    @Query(EmptyBodyPipe) query: Record<string, never>,
    @Body(EmptyBodyPipe) body: Record<string, never>,
  ) {
    void query;
    void body;
    const image = await this.images.read(params.id);
    return new StreamableFile(image.buffer, {
      type: image.mime,
      disposition: 'inline',
      length: image.buffer.length,
    });
  }
}
