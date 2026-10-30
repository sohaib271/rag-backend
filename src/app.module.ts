import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyModule } from './company/company.module.js';
import { MalwareService } from './malware/malware.service.js';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5433),
        username: config.get<string>('DB_USERNAME', 'postgres'),
        password: config.get<string>('DB_PASSWORD', 'Sohaib123'),
        database: config.get<string>('DB_NAME', 'rag_db'),
        autoLoadEntities: true,
        synchronize: true,
      }),
    }),
    AuthModule,
    CompanyModule,
  ],
  controllers: [AppController],
  providers: [AppService, MalwareService],
})
export class AppModule {}
