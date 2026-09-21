import { IsOptional, MinLength } from 'class-validator';

export class AcceptInvitationDto {
  /** Only required the first time — i.e. when the invited email has no account yet. */
  @IsOptional()
  @MinLength(8)
  password?: string;
}
