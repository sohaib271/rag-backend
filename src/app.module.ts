import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyModule } from './company/company.module.js';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5433, // This matches the Docker port we used!
      username: 'postgres',
      password: 'Sohaib123',
      database: 'rag_db',
      autoLoadEntities: true,
      synchronize: true, // Automatically creates tables based on your TypeScript code
    }),
    CompanyModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
