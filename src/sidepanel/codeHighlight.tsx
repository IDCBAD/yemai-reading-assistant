import { createElement, type ReactNode } from 'react';
import { createLowlight } from 'lowlight';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const lowlight = createLowlight({
  bash, c, cpp, csharp, css, diff, dockerfile, go, java, javascript,
  json, kotlin, markdown, php, powershell, python, ruby, rust, sql,
  swift, typescript, xml, yaml,
});

type HighlightNode = ReturnType<typeof lowlight.highlight>['children'][number];

function renderNode(node: HighlightNode, key: string): ReactNode {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element' || node.tagName !== 'span') return null;
  const classes = node.properties.className;
  const className = Array.isArray(classes)
    ? classes.filter((value): value is string => typeof value === 'string' && /^hljs-[a-z-]+$/u.test(value)).join(' ')
    : '';
  return createElement('span', { className, key }, node.children.map((child, index) =>
    renderNode(child, `${key}-${index}`)));
}

export function highlightCode(source: string, language: string): ReactNode {
  if (!lowlight.registered(language)) return source;
  return lowlight.highlight(language, source).children.map((node, index) => renderNode(node, String(index)));
}
