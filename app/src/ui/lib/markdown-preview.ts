import type { MDEditorProps } from '@uiw/react-md-editor';
import remarkGfm from 'remark-gfm';

type MarkdownPreviewOptions = NonNullable<MDEditorProps['previewOptions']>;

export function buildSafeMarkdownPreviewOptions(): MarkdownPreviewOptions {
  return {
    remarkPlugins: [remarkGfm],
    disallowedElements: ['style', 'script', 'iframe', 'object', 'embed', 'link', 'meta'],
    rehypeRewrite: (node) => {
      if (node.type !== 'element' || !node.properties) {
        return;
      }

      delete node.properties.style;

      for (const key of Object.keys(node.properties)) {
        if (key.toLowerCase().startsWith('on')) {
          delete node.properties[key];
        }
      }
    },
  };
}
