import { HealthController } from './health/health.controller';

describe('HealthController', () => {
  it('reports ok', () => {
    const controller = new HealthController();
    expect(controller.check()).toEqual({
      status: 'ok',
      service: 'tenanthub-backend',
    });
  });
});
