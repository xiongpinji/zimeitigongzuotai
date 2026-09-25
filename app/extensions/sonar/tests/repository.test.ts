import { createMemoryRepository } from '@/background/repository';
import { repositoryContract } from './_repository-contract';

let seq = 0;
repositoryContract('memory repository', () =>
  createMemoryRepository({ now: () => 1_700_000_000_000, newId: () => `id-${++seq}` }),
);
