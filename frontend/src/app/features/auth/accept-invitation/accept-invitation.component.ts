import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-accept-invitation',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './accept-invitation.component.html',
  styleUrl: '../login/login.component.scss',
})
export class AcceptInvitationComponent {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly token = this.route.snapshot.paramMap.get('token') ?? '';

  readonly form = this.fb.nonNullable.group({
    password: ['', [Validators.minLength(8)]],
  });

  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);

  submit() {
    this.error.set(null);
    this.submitting.set(true);
    const { password } = this.form.getRawValue();

    this.auth.acceptInvitation(this.token, password || undefined).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (err) => {
        this.submitting.set(false);
        this.error.set(
          err?.status === 410
            ? 'Esta invitación ya fue usada o expiró.'
            : err?.status === 400
              ? 'Esta es la primera vez que aceptás: ingresá una contraseña.'
              : 'No se pudo aceptar la invitación.',
        );
      },
    });
  }
}
