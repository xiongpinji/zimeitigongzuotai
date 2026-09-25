import 'fake-indexeddb/auto';
import { createIdbRepository } from '@/background/idb-repository';
import { repositoryContract } from './_repository-contract';

let db = 0;
let seq = 0;
// 每个测试用全新的库名，保证空库与隔离。
repositoryContract('idb repository', () =>
  createIdbRepository({
    now: () => 1_700_000_000_000,
    newId: () => `id-${++seq}`,
    dbName: `sonar-test-${++db}`,
  }),
);
