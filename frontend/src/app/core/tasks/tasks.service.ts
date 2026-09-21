import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { Task } from './tasks.models';

@Injectable({ providedIn: 'root' })
export class TasksService {
  constructor(private readonly http: HttpClient) {}

  list() {
    return this.http.get<Task[]>(`${environment.apiUrl}/tasks`);
  }

  create(title: string) {
    return this.http.post<Task>(`${environment.apiUrl}/tasks`, { title });
  }
}
