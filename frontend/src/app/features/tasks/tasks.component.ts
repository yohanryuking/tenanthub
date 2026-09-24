import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import { PagedTasks, Task } from '../../core/tasks/tasks.models';
import { TasksService } from '../../core/tasks/tasks.service';

const PAGE_SIZE = 5;

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './tasks.component.html',
  styleUrl: './tasks.component.scss',
})
export class TasksComponent implements OnInit, OnDestroy {
  private readonly tasksService = inject(TasksService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyed$ = new Subject<void>();

  readonly result = signal<PagedTasks | null>(null);
  readonly loading = signal(true);
  readonly editingId = signal<string | null>(null);
  readonly page = signal(1);

  readonly createForm = this.fb.nonNullable.group({
    title: ['', Validators.required],
  });

  readonly filterForm = this.fb.nonNullable.group({
    q: [''],
    done: [''] as [string],
  });

  get totalPages(): number {
    const r = this.result();
    return r ? Math.max(1, Math.ceil(r.total / r.pageSize)) : 1;
  }

  ngOnInit() {
    this.load();
    this.filterForm.valueChanges
      .pipe(debounceTime(300), takeUntil(this.destroyed$))
      .subscribe(() => {
        this.page.set(1);
        this.load();
      });
  }

  ngOnDestroy() {
    this.destroyed$.next();
    this.destroyed$.complete();
  }

  load() {
    this.loading.set(true);
    const { q, done } = this.filterForm.getRawValue();
    this.tasksService
      .list({
        page: this.page(),
        pageSize: PAGE_SIZE,
        q: q || undefined,
        done: done === '' ? undefined : done === 'true',
      })
      .subscribe({
        next: (result) => {
          this.result.set(result);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  addTask() {
    if (this.createForm.invalid) return;
    const { title } = this.createForm.getRawValue();
    this.tasksService.create(title).subscribe(() => {
      this.createForm.reset({ title: '' });
      this.page.set(1);
      this.load();
    });
  }

  toggleDone(task: Task) {
    this.tasksService.update(task.id, { done: !task.done }).subscribe(() => this.load());
  }

  startEdit(task: Task) {
    this.editingId.set(task.id);
  }

  saveTitle(task: Task, newTitle: string) {
    this.editingId.set(null);
    const trimmed = newTitle.trim();
    if (!trimmed || trimmed === task.title) return;
    this.tasksService.update(task.id, { title: trimmed }).subscribe(() => this.load());
  }

  remove(task: Task) {
    this.tasksService.remove(task.id).subscribe(() => this.load());
  }

  goToPage(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.page.set(page);
    this.load();
  }
}
