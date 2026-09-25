import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

export interface Membership {
  id: string;
  orgId: string;
  userId: string;
  role: 'admin' | 'member';
  createdAt: string;
  user: { id: string; email: string };
}

@Injectable({ providedIn: 'root' })
export class MembershipsService {
  constructor(private readonly http: HttpClient) {}

  list() {
    return this.http.get<Membership[]>(`${environment.apiUrl}/memberships`);
  }

  updateRole(id: string, role: 'admin' | 'member') {
    return this.http.patch<Membership>(`${environment.apiUrl}/memberships/${id}`, { role });
  }
}
