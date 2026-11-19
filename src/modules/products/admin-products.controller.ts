import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../../common/http/api-errors.decorator';
import { EmptyBodyPipe } from '../../common/http/empty-body.pipe';
import { UuidParamDto } from '../../common/http/dto/uuid-param.dto';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AdminProductQueryDto } from './products.dto';
import { ProductsService } from './products.service';
import { productSchema } from './products.openapi';

@Controller('admin/products')
@ApiTags('admin products')
@ApiBearerAuth()
@Roles('ADMIN')
@UseGuards(AccessTokenGuard, RolesGuard)
export class AdminProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List all products (ADMIN)',
    description:
      'Lists active and inactive products. Use status=all (default), active or inactive. Search, price filters, sorting and pagination work like the public product list. To stop or resume sales, call PATCH /api/v1/products/:id with isActive=false or true.',
  })
  @ApiErrors('VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN')
  @ApiResponse({ status: 200, schema: productSchema(true) })
  list(
    @Query() query: AdminProductQueryDto,
    @Body(EmptyBodyPipe) body: Record<string, never>,
  ) {
    void body;
    return this.products.list(query, query.status);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'View a product, including inactive products (ADMIN)',
  })
  @ApiErrors('VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND')
  @ApiResponse({ status: 200, schema: productSchema() })
  detail(
    @Param() params: UuidParamDto,
    @Query(EmptyBodyPipe) query: Record<string, never>,
    @Body(EmptyBodyPipe) body: Record<string, never>,
  ) {
    void query;
    void body;
    return this.products.detail(params.id, true);
  }
}
