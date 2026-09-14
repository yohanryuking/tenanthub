import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  /**
   * Which organization to log into, identified by its slug (like choosing a
   * Slack workspace). Phase 1 requires this explicitly; Sprint 2 adds a
   * "list my orgs" step using auth_list_orgs_for_email so the UI can offer
   * a picker instead of asking the user to type it.
   */
  @IsString()
  @IsNotEmpty()
  orgSlug!: string;
}
