import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuditLogService, PagedAuditLog } from '../../core/organizations/audit-log.service';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-audit-log',
  standalone: true,
  imports: [RouterLink, DatePipe],
  templateUrl: './audit-log.component.html',
  styleUrl: './audit-log.component.scss',
})
export class AuditLogComponent implements OnInit {
  private readonly auditLogService = inject(AuditLogService);

  readonly result = signal<PagedAuditLog | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly page = signal(1);

  get totalPages(): number {
    const r = this.result();
    return r ? Math.max(1, Math.ceil(r.total / r.pageSize)) : 1;
  }

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.auditLogService.list(this.page(), PAGE_SIZE).subscribe({
      next: (result) => {
        this.result.set(result);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.status === 403 ? 'Solo un admin puede ver la auditoría.' : 'No se pudo cargar.');
      },
    });
  }

  goToPage(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.page.set(page);
    this.load();
  }
}
