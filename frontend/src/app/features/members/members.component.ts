import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { HasRoleDirective } from '../../core/auth/has-role.directive';
import { Membership, MembershipsService } from '../../core/organizations/memberships.service';

@Component({
  selector: 'app-members',
  standalone: true,
  imports: [RouterLink, HasRoleDirective],
  templateUrl: './members.component.html',
  styleUrl: './members.component.scss',
})
export class MembersComponent implements OnInit {
  private readonly membershipsService = inject(MembershipsService);
  readonly auth = inject(AuthService);

  readonly members = signal<Membership[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.membershipsService.list().subscribe({
      next: (members) => {
        this.members.set(members);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  changeRole(member: Membership, role: 'admin' | 'member') {
    if (role === member.role) return;
    this.error.set(null);
    this.membershipsService.updateRole(member.id, role).subscribe({
      next: () => this.load(),
      error: (err) => {
        this.error.set(
          err?.status === 409
            ? 'No se puede quitar el último admin de la organización.'
            : 'No se pudo cambiar el rol.',
        );
      },
    });
  }

  isSelf(member: Membership): boolean {
    return member.userId === this.auth.claims()?.sub;
  }
}
