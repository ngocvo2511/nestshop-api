import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductImagesController } from './product-images.controller';
import { ProductImagesService } from './product-images.service';
import { ImageStorage } from './image-storage';
import { ImageUploadInterceptor } from './image-upload.interceptor';
import { SafeJsonLogger } from '../../common/logging/safe-json.logger';

@Module({
  imports: [AuthModule],
  controllers: [ProductsController, ProductImagesController],
  providers: [
    ProductsService,
    ProductImagesService,
    ImageStorage,
    ImageUploadInterceptor,
    SafeJsonLogger,
  ],
})
export class ProductsModule {}
