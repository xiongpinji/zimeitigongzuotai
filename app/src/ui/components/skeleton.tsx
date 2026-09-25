import React from 'react';
import { cn } from '../lib/utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Enable frosted glass effect */
  glass?: boolean;
}

export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, glass, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'animate-pulse rounded-lg',
          glass
            ? 'bg-white/5 backdrop-blur-sm'
            : 'bg-white/[0.08]',
          className
        )}
        {...props}
      />
    );
  }
);
Skeleton.displayName = 'Skeleton';
