import { IsEmail, IsNotEmpty, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsNotEmpty()
  @MinLength(2)
  orgName!: string;

  @IsNotEmpty()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message:
      'orgSlug must be lowercase letters, numbers and hyphens only (e.g. "acme-inc")',
  })
  orgSlug!: string;

  @IsEmail()
  email!: string;

  @MinLength(8)
  password!: string;
}
