import { IsEmail, IsIn, IsOptional } from 'class-validator';

export class CreateInvitationDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsIn(['admin', 'member'])
  role: 'admin' | 'member' = 'member';
}
