import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { HasRoleDirective } from '../../core/auth/has-role.directive';
import { InvitationsService } from '../../core/organizations/invitations.service';
import { Organization, OrganizationService } from '../../core/organizations/organization.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, HasRoleDirective],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly invitationsService = inject(InvitationsService);
  private readonly organizationService = inject(OrganizationService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  readonly invitationResult = signal<string | null>(null);
  readonly organization = signal<Organization | null>(null);
  readonly planChanging = signal(false);

  readonly inviteForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    role: ['member' as 'admin' | 'member', Validators.required],
  });

  ngOnInit() {
    this.organizationService.getCurrent().subscribe((org) => this.organization.set(org));
  }

  invite() {
    if (this.inviteForm.invalid) return;
    const { email, role } = this.inviteForm.getRawValue();
    this.invitationResult.set(null);
    this.invitationsService.invite(email, role).subscribe({
      next: (invitation) => {
        this.invitationResult.set(
          `Invitación creada para ${invitation.email}. En un entorno real se ` +
            `enviaría por email — por ahora, el link de aceptación es ` +
            `/accept-invitation/${invitation.token}`,
        );
        this.inviteForm.reset({ email: '', role: 'member' });
      },
      error: () => this.invitationResult.set('No se pudo crear la invitación (¿sos admin?).'),
    });
  }

  togglePlan() {
    const current = this.organization();
    if (!current) return;
    const nextPlan = current.plan === 'free' ? 'pro' : 'free';
    this.planChanging.set(true);
    this.organizationService.updatePlan(nextPlan).subscribe({
      next: (org) => {
        this.organization.set(org);
        // Reflect the new plan in this session's own JWT right away —
        // otherwise the admin who just upgraded would have to log out and
        // back in before, say, the CSV export gate recognized it.
        this.auth.refresh().subscribe({
          complete: () => this.planChanging.set(false),
        });
      },
      error: () => this.planChanging.set(false),
    });
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
