import { IsIn } from 'class-validator';

export class UpdateMembershipDto {
  @IsIn(['admin', 'member'])
  role!: 'admin' | 'member';
}
