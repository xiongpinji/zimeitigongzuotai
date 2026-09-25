import { Alert } from '../../ui';

export function ErrorBlock({ message }: { message: string }) {
  return <Alert variant="error" description={message} />;
}
