import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  app.enableCors({
    origin: config.get('FRONTEND_URL', 'http://localhost:5173'),
    credentials: true,
  });
  await app.listen(config.get('PORT', 3000));
}
await bootstrap();
