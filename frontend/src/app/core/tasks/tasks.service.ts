import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { PagedTasks, Task, TasksQuery } from './tasks.models';

@Injectable({ providedIn: 'root' })
export class TasksService {
  constructor(private readonly http: HttpClient) {}

  list(query: TasksQuery = {}) {
    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page);
    if (query.pageSize) params = params.set('pageSize', query.pageSize);
    if (query.done !== undefined) params = params.set('done', String(query.done));
    if (query.q) params = params.set('q', query.q);

    return this.http.get<PagedTasks>(`${environment.apiUrl}/tasks`, { params });
  }

  create(title: string) {
    return this.http.post<Task>(`${environment.apiUrl}/tasks`, { title });
  }

  update(id: string, patch: Partial<Pick<Task, 'title' | 'description' | 'done'>>) {
    return this.http.patch<Task>(`${environment.apiUrl}/tasks/${id}`, patch);
  }

  remove(id: string) {
    return this.http.delete<void>(`${environment.apiUrl}/tasks/${id}`);
  }

  /** Gated server-side by PlanGuard/@RequiresPlan('pro') — a free org gets a 403 here. */
  exportCsv() {
    return this.http.get(`${environment.apiUrl}/tasks/export.csv`, { responseType: 'text' });
  }
}
