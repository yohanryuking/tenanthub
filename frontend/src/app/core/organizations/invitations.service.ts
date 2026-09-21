import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

export interface Invitation {
  id: string;
  email: string;
  role: 'admin' | 'member';
  expiresAt: string;
  token: string;
}

@Injectable({ providedIn: 'root' })
export class InvitationsService {
  constructor(private readonly http: HttpClient) {}

  invite(email: string, role: 'admin' | 'member') {
    return this.http.post<Invitation>(`${environment.apiUrl}/organizations/invitations`, {
      email,
      role,
    });
  }
}
