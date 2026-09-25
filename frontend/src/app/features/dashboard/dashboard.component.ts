import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { HasRoleDirective } from '../../core/auth/has-role.directive';
import { InvitationsService } from '../../core/organizations/invitations.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, HasRoleDirective],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  readonly auth = inject(AuthService);
  private readonly invitationsService = inject(InvitationsService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  readonly invitationResult = signal<string | null>(null);

  readonly inviteForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    role: ['member' as 'admin' | 'member', Validators.required],
  });

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

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
