import { CompanyService } from './company.service.js';

describe('CompanyService', () => {
  let service: CompanyService;

  beforeEach(() => {
    service = new CompanyService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
