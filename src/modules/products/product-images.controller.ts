import { ApiErrors } from '../../common/http/api-errors.decorator';
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
import { ImageUploadInterceptor } from './image-upload.interceptor';
import { ProductImagesService } from './product-images.service';

@Controller('products')
@ApiTags('product images')
export class ProductImagesController {
  constructor(private readonly images: ProductImagesService) {}

  @Post(':id/image')
  @ApiErrors(
    'VALIDATION_FAILED',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'UPLOAD_INVALID_TYPE',
    'UPLOAD_TOO_LARGE',
  )
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
    summary: 'Upload or replace a product image (ADMIN)',
    description:
      'Send exactly one file in the multipart field named file. JPEG, PNG and WebP are supported. The file must fit UPLOAD_MAX_BYTES (at most 5 MiB), contain one image frame, and have at most 16 million pixels. Do not send other form fields. The server checks and re-encodes the image, saves it, and replaces the previous image. Returns the product ID and image URL.',
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
  @ApiResponse({
    status: 413,
    description:
      'UPLOAD_TOO_LARGE: The image exceeds the configured file size limit.',
  })
  @ApiResponse({
    status: 415,
    description:
      'UPLOAD_INVALID_TYPE: The image format or content is not supported.',
  })
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
  @ApiErrors('VALIDATION_FAILED', 'NOT_FOUND')
  @ResponseMode('file')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOperation({
    summary: 'View a product image',
    description:
      'Returns the image file for an active product. Returns 404 if the product is missing, inactive or has no readable image. Pass the product ID, not a file path.',
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
