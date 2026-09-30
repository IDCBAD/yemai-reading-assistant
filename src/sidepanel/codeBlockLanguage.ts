export interface CodeBlockFormat {
  label: string;
  language: string | null;
  tone: 'code' | 'markdown' | 'plain';
}

const LANGUAGES: Record<string, string> = {
  bash: 'Bash', c: 'C', cpp: 'C++', csharp: 'C#', css: 'CSS',
  diff: 'Diff', dockerfile: 'Dockerfile', go: 'Go', java: 'Java',
  javascript: 'JavaScript', json: 'JSON', kotlin: 'Kotlin',
  markdown: 'Markdown', php: 'PHP', powershell: 'PowerShell',
  python: 'Python', ruby: 'Ruby', rust: 'Rust', sql: 'SQL',
  swift: 'Swift', typescript: 'TypeScript', xml: 'HTML / XML', yaml: 'YAML',
};

const ALIASES: Record<string, string> = {
  cjs: 'javascript', cs: 'csharp', 'c++': 'cpp', h: 'c', hpp: 'cpp',
  html: 'xml', htm: 'xml', svg: 'xml', js: 'javascript', jsx: 'javascript',
  jsonc: 'json', md: 'markdown', mdx: 'markdown', mjs: 'javascript',
  ps1: 'powershell', py: 'python', sh: 'bash', shell: 'bash',
  ts: 'typescript', tsx: 'typescript', txt: 'text', yml: 'yaml', zsh: 'bash',
};

export function describeCodeBlock(rawLanguage: string | undefined, source: string): CodeBlockFormat {
  const tag = rawLanguage?.trim().toLowerCase() ?? '';
  if (!tag && source.length <= 20_000 && /^[\[{]/u.test(source.trimStart())) {
    try {
      JSON.parse(source);
      return { label: 'JSON', language: 'json', tone: 'code' };
    } catch {
      // A missing language marker is not enough to infer another code language.
    }
  }
  if (!tag || ['text', 'txt', 'plaintext', 'plain', 'none'].includes(tag)) {
    return { label: 'Text', language: null, tone: 'plain' };
  }
  const language = ALIASES[tag] ?? tag;
  if (language === 'text') return { label: 'Text', language: null, tone: 'plain' };
  const label = LANGUAGES[language];
  if (!label) return { label: tag.slice(0, 32), language: null, tone: 'plain' };
  return { label, language, tone: language === 'markdown' ? 'markdown' : 'code' };
}
