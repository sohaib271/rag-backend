import { CompanyController } from './company.controller.js';

describe('CompanyController', () => {
  let controller: CompanyController;

  beforeEach(() => {
    controller = new CompanyController({} as never, {} as never, {} as never);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
