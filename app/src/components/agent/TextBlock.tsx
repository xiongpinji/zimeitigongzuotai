import { useMemo } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';

export function TextBlock({ text }: { text: string }) {
  const html = useMemo(() => {
    try {
      const result = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeStringify, { allowDangerousHtml: true })
        .processSync(text);
      return String(result);
    } catch {
      return text;
    }
  }, [text]);

  return (
    <div
      className="agent-markdown"
      style={{ fontSize: 13, lineHeight: 1.6, color: '#EBEBF5' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
