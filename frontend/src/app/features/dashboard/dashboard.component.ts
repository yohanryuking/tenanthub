import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { InvitationsService } from '../../core/organizations/invitations.service';
import { Task } from '../../core/tasks/tasks.models';
import { TasksService } from '../../core/tasks/tasks.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly tasksService = inject(TasksService);
  private readonly invitationsService = inject(InvitationsService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  readonly tasks = signal<Task[]>([]);
  readonly loading = signal(true);
  readonly invitationResult = signal<string | null>(null);

  readonly taskForm = this.fb.nonNullable.group({
    title: ['', Validators.required],
  });

  readonly inviteForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    role: ['member' as 'admin' | 'member', Validators.required],
  });

  ngOnInit() {
    this.loadTasks();
  }

  loadTasks() {
    this.loading.set(true);
    this.tasksService.list().subscribe({
      next: (tasks) => {
        this.tasks.set(tasks);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  addTask() {
    if (this.taskForm.invalid) return;
    const { title } = this.taskForm.getRawValue();
    this.tasksService.create(title).subscribe(() => {
      this.taskForm.reset({ title: '' });
      this.loadTasks();
    });
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

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
