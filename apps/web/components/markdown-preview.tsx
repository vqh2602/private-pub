import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownPreview({ content }: { content: string }) {
  return <div className="markdown-content">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>
      }}
    >
      {content}
    </ReactMarkdown>
  </div>;
}
