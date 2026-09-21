import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: '../login/login.component.scss',
})
export class RegisterComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly form = this.fb.nonNullable.group({
    orgName: ['', [Validators.required, Validators.minLength(2)]],
    orgSlug: ['', [Validators.required, Validators.pattern(SLUG_PATTERN)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);

  onOrgNameChange(name: string) {
    if (this.form.controls.orgSlug.dirty) return;
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    this.form.controls.orgSlug.setValue(slug);
  }

  submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.error.set(null);
    this.submitting.set(true);
    const { orgName, orgSlug, email, password } = this.form.getRawValue();

    this.auth.register(orgName, orgSlug, email, password).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (err) => {
        this.submitting.set(false);
        this.error.set(
          err?.status === 409
            ? 'Ese slug de organización o email ya está en uso.'
            : 'No se pudo crear la cuenta. Revisá los datos.',
        );
      },
    });
  }
}
