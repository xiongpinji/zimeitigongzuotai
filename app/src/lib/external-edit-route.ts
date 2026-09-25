export type ExternalEditRoute =
  | { kind: 'project' }
  | { kind: 'script' }
  | { kind: 'original' }
  | { kind: 'motion-card'; overlayId: string }
  | { kind: 'other' };

export function routeExternalEdit(relFile: string): ExternalEditRoute {
  const norm = relFile.replace(/\\/g, '/');
  if (norm === 'project.json') return { kind: 'project' };
  if (norm === 'script.md') return { kind: 'script' };
  if (norm === 'original.md') return { kind: 'original' };
  const m = norm.match(/^ai-cards\/([^/]+)\/motionCard\.tsx$/);
  if (m) return { kind: 'motion-card', overlayId: m[1] };
  return { kind: 'other' };
}
