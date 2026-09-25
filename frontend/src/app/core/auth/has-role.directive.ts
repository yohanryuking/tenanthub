import {
  Directive,
  Input,
  TemplateRef,
  ViewContainerRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { AuthService } from './auth.service';
import { AccessTokenClaims } from './auth.models';

/**
 * Structural directive mirroring the backend's @Roles()/RolesGuard: hides
 * UI the caller's role wouldn't be allowed to act on anyway. This is
 * defense in depth for UX, never the actual barrier — every action it
 * gates (invite, change a role) is independently enforced server-side.
 *
 * Usage: `<section *appHasRole="'admin'">...</section>`, optionally with
 * an else template: `*appHasRole="'admin'; else readOnly"`.
 */
@Directive({
  selector: '[appHasRole]',
  standalone: true,
})
export class HasRoleDirective {
  private readonly templateRef = inject(TemplateRef<unknown>);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly auth = inject(AuthService);

  private readonly requiredRole = signal<AccessTokenClaims['role'] | null>(null);
  private readonly elseTemplate = signal<TemplateRef<unknown> | null>(null);

  @Input({ required: true, alias: 'appHasRole' })
  set role(value: AccessTokenClaims['role']) {
    this.requiredRole.set(value);
  }

  @Input({ alias: 'appHasRoleElse' })
  set elseRef(value: TemplateRef<unknown> | null) {
    this.elseTemplate.set(value);
  }

  constructor() {
    effect(() => {
      const required = this.requiredRole();
      const hasRole = required !== null && this.auth.claims()?.role === required;
      const elseRef = this.elseTemplate();

      this.viewContainer.clear();
      if (hasRole) {
        this.viewContainer.createEmbeddedView(this.templateRef);
      } else if (elseRef) {
        this.viewContainer.createEmbeddedView(elseRef);
      }
    });
  }
}
