import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { OrgOption } from '../../../core/auth/auth.models';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    orgSlug: ['', Validators.required],
    password: ['', Validators.required],
  });

  readonly orgs = signal<OrgOption[]>([]);
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);

  onEmailBlur() {
    const email = this.form.controls.email.value;
    if (!email || this.form.controls.email.invalid) return;

    this.auth.listOrgs(email).subscribe({
      next: (orgs) => {
        this.orgs.set(orgs);
        if (orgs.length === 1) {
          this.form.controls.orgSlug.setValue(orgs[0].org_slug);
        }
      },
      error: () => this.orgs.set([]),
    });
  }

  submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.error.set(null);
    this.submitting.set(true);
    const { email, orgSlug, password } = this.form.getRawValue();

    this.auth.login(orgSlug, email, password).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: () => {
        this.submitting.set(false);
        this.error.set('Email, contraseña u organización incorrectos.');
      },
    });
  }
}
