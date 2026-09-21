import { IsEmail } from 'class-validator';

export class ListOrgsDto {
  @IsEmail()
  email!: string;
}
