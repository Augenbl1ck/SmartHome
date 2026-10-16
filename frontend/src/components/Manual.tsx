import type { ReactNode } from 'react';

function rich(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-foreground font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="text-foreground">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

export default function Manual({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: string[] = [];

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc pl-5 space-y-1 text-sm">
        {list.map((item) => <li key={item}>{rich(item)}</li>)}
      </ul>,
    );
    list = [];
  };

  lines.forEach((line, index) => {
    if (line.startsWith('- ')) {
      list.push(line.slice(2));
      return;
    }
    flushList();
    if (!line.trim()) return;
    if (line.startsWith('# ')) {
      blocks.push(<h1 key={index} className="text-2xl font-bold">{rich(line.slice(2))}</h1>);
    } else if (line.startsWith('## ')) {
      blocks.push(<h2 key={index} className="text-lg font-semibold pt-2">{rich(line.slice(3))}</h2>);
    } else if (/^\d+\. /.test(line)) {
      blocks.push(<p key={index} className="text-sm">{rich(line)}</p>);
    } else {
      blocks.push(<p key={index} className="text-sm text-muted-foreground">{rich(line)}</p>);
    }
  });
  flushList();

  return <article className="max-w-3xl space-y-3">{blocks}</article>;
}
