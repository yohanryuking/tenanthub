import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'pro';
  createdAt: string;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class OrganizationService {
  constructor(private readonly http: HttpClient) {}

  getCurrent() {
    return this.http.get<Organization>(`${environment.apiUrl}/organizations/me`);
  }

  updatePlan(plan: 'free' | 'pro') {
    return this.http.patch<Organization>(`${environment.apiUrl}/organizations/plan`, { plan });
  }
}
