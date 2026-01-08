import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig, { DatabaseConfig } from '../config/database.config';

@Module({
  imports: [
    ConfigModule.forFeature(databaseConfig),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule.forFeature(databaseConfig)],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const db = configService.get<DatabaseConfig>('database');
        if (!db) {
          throw new Error('database config not loaded');
        }
        return {
          type: 'postgres',
          host: db.host ?? '127.0.0.1',
          port: db.port ?? 5432,
          username: db.username ?? 'postgres',
          password: db.password ?? '',
          database: db.database ?? 'waf',
          ssl: db.ssl ? { rejectUnauthorized: false } : undefined,
          autoLoadEntities: true,
          synchronize: false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
