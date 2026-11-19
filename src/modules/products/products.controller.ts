import { ApiErrors } from '../../common/http/api-errors.decorator';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { EmptyBodyPipe } from '../../common/http/empty-body.pipe';
import { UuidParamDto } from '../../common/http/dto/uuid-param.dto';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import {
  CreateProductDto,
  PatchProductDto,
  ProductQueryDto,
} from './products.dto';
import { productSchema } from './products.openapi';
import { ProductsService } from './products.service';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiErrors('VALIDATION_FAILED')
  @ApiOperation({
    summary: 'List products on sale',
    description:
      'Lists active products only; no login is required. Search by name or description, ignoring letter case. Price filters include the specified minimum and maximum. Products are sorted by name by default; use sort to change the order. Ties are ordered by product ID in the same direction. total counts all products matching your filters. ADMIN accounts should use /api/v1/admin/products to include inactive products.',
  })
  @ApiResponse({ status: 200, schema: productSchema(true) })
  list(
    @Query() query: ProductQueryDto,
    @Body(EmptyBodyPipe) body: Record<string, never>,
  ) {
    void body;
    return this.products.list(query);
  }

  @Get(':id')
  @ApiErrors('VALIDATION_FAILED', 'NOT_FOUND')
  @ApiOperation({
    summary: 'View a product on sale',
    description:
      'No login is required. Returns 404 if the product does not exist or is no longer on sale.',
  })
  @ApiResponse({ status: 200, schema: productSchema() })
  detail(
    @Param() params: UuidParamDto,
    @Query(EmptyBodyPipe) query: Record<string, never>,
    @Body(EmptyBodyPipe) body: Record<string, never>,
  ) {
    void query;
    void body;
    return this.products.detail(params.id);
  }

  @Post()
  @ApiErrors('VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a product (ADMIN)',
    description:
      'Send the product name, priceVnd and initialStock. Send prices as strings, such as "350000", and stock as a whole number, such as 10. initialStock must be between 0 and 2147483647. isActive defaults to true. Upload the image separately using the product image endpoint. Initial stock is not recorded as a manual stock adjustment.',
  })
  @ApiResponse({ status: 201, schema: productSchema() })
  create(
    @Body() dto: CreateProductDto,
    @Query(EmptyBodyPipe) query: Record<string, never>,
  ) {
    void query;
    return this.products.create(dto);
  }

  @Patch(':id')
  @ApiErrors(
    'VALIDATION_FAILED',
    'EMPTY_UPDATE',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
  )
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update a product or change its sale status (ADMIN)',
    description:
      'Send at least one of name, description, priceVnd or isActive. Set description=null to clear it. Set isActive=false to stop selling, or true to resume sales; this also works for inactive products. To change stock or the image, use the separate stock adjustment or image endpoint. Other fields are not accepted.',
  })
  @ApiResponse({ status: 200, schema: productSchema() })
  patch(
    @Param() params: UuidParamDto,
    @Body() dto: PatchProductDto,
    @Query(EmptyBodyPipe) query: Record<string, never>,
  ) {
    void query;
    return this.products.update(params.id, dto);
  }
}
