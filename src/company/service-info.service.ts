import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from '../entities/company.entity.js';
import { ServiceInfo } from '../entities/service-info.entity.js';

export type ServiceInfoInput = { companyId: string; name: string; price: number | string; avgTime: number };

@Injectable()
export class ServiceInfoService {
  constructor(
    @InjectRepository(ServiceInfo) private readonly services: Repository<ServiceInfo>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
  ) {}

  list(companyId: string) {
    return this.services.find({ where: { companyId }, order: { createdAt: 'ASC' } });
  }

  async create(input: ServiceInfoInput) {
    const values = this.validate(input);
    if (!await this.companies.existsBy({ id: input.companyId })) throw new NotFoundException('Company not found.');
    return this.services.save(this.services.create({ companyId: input.companyId, ...values }));
  }

  async update(id: string, input: Partial<Omit<ServiceInfoInput, 'companyId'>>) {
    const service = await this.services.findOneBy({ id });
    if (!service) throw new NotFoundException('Service not found.');
    const values = this.validate({
      companyId: service.companyId,
      name: input.name ?? service.name,
      price: input.price ?? service.price,
      avgTime: input.avgTime ?? service.avgTime,
    });
    Object.assign(service, values);
    return this.services.save(service);
  }

  async remove(id: string) {
    const result = await this.services.delete(id);
    if (!result.affected) throw new NotFoundException('Service not found.');
    return { deleted: true };
  }

  private validate(input: ServiceInfoInput) {
    const name = input.name?.trim();
    const price = Number(input.price);
    const avgTime = Number(input.avgTime);
    if (!name) throw new BadRequestException('Service name is required.');
    if (!Number.isFinite(price) || price < 0) throw new BadRequestException('Price must be zero or greater.');
    if (!Number.isInteger(avgTime) || avgTime < 1) throw new BadRequestException('Average time must be a positive number of minutes.');
    return { name, price: price.toFixed(2), avgTime };
  }
}
