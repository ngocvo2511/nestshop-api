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
import { ProductErrors, productSchema } from './products.openapi';
import { ProductsService } from './products.service';

@ApiTags('products')
@ProductErrors()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOperation({
    summary: 'Public active-only catalog',
    description:
      'Literal case-insensitive name/description substring; inclusive VND bounds. Sort allowlist only, default name ASC, matching id tie-break direction. Total uses the same filters. No inactive visibility override for Admin.',
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
  @ApiOperation({
    summary: 'Public active product detail',
    description:
      'Missing and inactive both return safe404 NOT_FOUND for every caller.',
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
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'ADMIN create catalog product with initial stock',
    description:
      'Positive integer VND decimal string, JSON integer initialStock 0..2147483647. Reject unknown/stockAvailable/imagePath/imageUrl/role/id fields. isActive defaults true. No inventory adjustment audit on creation.',
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
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'ADMIN update catalog fields only',
    description:
      'Nonempty name/description/priceVnd/isActive subset. Only description nullable. May target inactive products. Reject all stock/image/protected fields. Stock and image reference are preserved; stock adjustments and images use their dedicated audited/validated routes.',
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
