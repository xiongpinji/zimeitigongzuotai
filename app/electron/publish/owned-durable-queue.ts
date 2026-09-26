/** Product-only queue entry: the generic store itself is not cross-process CAS safe. */
import { assertSingleInstanceOwner } from '../single-instance-gate';
import { openDurableQueue, type DurablePublishQueue, type DurableQueueOptions } from './durable-queue';

export function openOwnedDurableQueue(options: DurableQueueOptions): DurablePublishQueue {
  assertSingleInstanceOwner();
  return openDurableQueue(options);
}
