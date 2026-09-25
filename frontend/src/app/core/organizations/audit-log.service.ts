import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

export interface AuditLogEntry {
  id: string;
  orgId: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
  actor: { id: string; email: string } | null;
}

export interface PagedAuditLog {
  items: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable({ providedIn: 'root' })
export class AuditLogService {
  constructor(private readonly http: HttpClient) {}

  list(page: number, pageSize: number) {
    const params = new HttpParams().set('page', page).set('pageSize', pageSize);
    return this.http.get<PagedAuditLog>(`${environment.apiUrl}/audit-log`, { params });
  }
}
