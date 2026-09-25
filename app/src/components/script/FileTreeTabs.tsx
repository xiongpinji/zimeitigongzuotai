import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui';
import styles from './FileTreeTabs.module.css';

export type FileTreeView = 'all' | 'resources';

interface FileTreeTabsProps {
  value: FileTreeView;
  onValueChange: (value: FileTreeView) => void;
  allSlot: ReactNode;
  resourcesSlot: ReactNode;
}

export function FileTreeTabs({ value, onValueChange, allSlot, resourcesSlot }: FileTreeTabsProps) {
  return (
    <Tabs
      value={value}
      onValueChange={(v) => onValueChange(v as FileTreeView)}
      className={styles.tabs}
    >
      <div className={styles.tabsBar}>
        <TabsList className={styles.tabsList}>
          <TabsTrigger value="all">全部文件</TabsTrigger>
          <TabsTrigger value="resources">稿件资源</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="all" className={styles.tabsContent}>
        {allSlot}
      </TabsContent>
      <TabsContent value="resources" className={styles.tabsContent}>
        {resourcesSlot}
      </TabsContent>
    </Tabs>
  );
}
