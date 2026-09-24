# Frontend

This project was generated with [Angular CLI](https://github.com/angular/angular-cli) version 18.2.21.

## Development server

Run `ng serve` for a dev server. Navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

## Code scaffolding

Run `ng generate component component-name` to generate a new component. You can also use `ng generate directive|pipe|service|class|guard|interface|enum|module`.

## Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory.

## Running unit tests

Run `ng test` to execute the unit tests via [Karma](https://karma-runner.github.io).

## Running end-to-end tests

Playwright drives a real browser against a real backend — start the
backend first (`cd ../backend && npm run start:dev`, with a migrated
Postgres behind it), then:

```bash
npm run e2e
```

This starts the Angular dev server itself (`playwright.config.ts`), so you
only need to have the backend running separately. See `e2e/tasks.spec.ts`
for the covered flows (create → view → edit → complete → delete, filters,
pagination).

## Further help

To get more help on the Angular CLI use `ng help` or go check out the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
