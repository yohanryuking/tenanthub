import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

// Shared across requests so N requests failing with 401 at once trigger a
// single refresh call, not N of them racing to rotate the same token.
let refreshInFlight: Observable<unknown> | null = null;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const isApiRequest = req.url.startsWith(environment.apiUrl);
  const isAuthEndpoint = req.url.includes('/auth/');
  const token = auth.getAccessToken();

  const authedReq =
    isApiRequest && token
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req;

  return next(authedReq).pipe(
    catchError((error: unknown) => {
      const shouldTryRefresh =
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        isApiRequest &&
        !isAuthEndpoint &&
        auth.getRefreshToken() !== null;

      if (!shouldTryRefresh) {
        return throwError(() => error);
      }

      refreshInFlight ??= auth.refresh().pipe(
        catchError((refreshError) => {
          auth.logout();
          router.navigate(['/login']);
          return throwError(() => refreshError);
        }),
      );

      return refreshInFlight.pipe(
        switchMap(() => {
          refreshInFlight = null;
          const retried = req.clone({
            setHeaders: { Authorization: `Bearer ${auth.getAccessToken()}` },
          });
          return next(retried);
        }),
        catchError((refreshError) => {
          refreshInFlight = null;
          return throwError(() => refreshError);
        }),
      );
    }),
  );
};
