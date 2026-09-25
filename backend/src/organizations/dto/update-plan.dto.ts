import { IsIn } from 'class-validator';

export class UpdatePlanDto {
  @IsIn(['free', 'pro'])
  plan!: 'free' | 'pro';
}
