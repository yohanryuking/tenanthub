import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  // CORS_ORIGIN is a comma-separated allowlist (e.g. the deployed frontend's
  // URL). Unset in local dev, which reflects any origin — never leave it
  // unset in production, or any site can call this API with a user's token.
  const corsOrigin = process.env.CORS_ORIGIN;
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',').map((o) => o.trim()) : true,
  });

  const port = process.env.PORT ?? 3000;
  // Bind to 0.0.0.0, not just localhost — required for containerized hosts
  // (Render, Fly, etc.) to route traffic to the process.
  await app.listen(port, '0.0.0.0');
}
bootstrap();
